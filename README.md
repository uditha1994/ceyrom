# Ceyrom

**Ceyrom** (Ceylon + carrom) is a browser carrom game built around how Sri Lankans play at home and in clubs.
It has its own physics engine, the full rule set, an AI with five levels, pass-and-play, server-authoritative
online play, and English, Sinhala and Tamil throughout.

Other names considered: *Pettiya*, *Thatu*, *Gedara Carrom*. Ceyrom was chosen because it's short, easy to remember, and has a free namespace.

## Run it

```bash
npm install
npm run dev            # client on http://localhost:5173 (proxies /ws and /api to :8787)
npm run dev:server     # game server on :8787 (needed for online play only)
```

Production:

```bash
npm run build          # client → dist/, server → dist-server/server.mjs
PORT=8787 CEYROM_SECRET=$(openssl rand -hex 32) npm start
```

The server serves the built client too, so one process is a complete deployment. Useful environment variables:

| Variable | Meaning |
| --- | --- |
| `PORT` | HTTP + WebSocket port (default 8787) |
| `CEYROM_SECRET` | HMAC key for player tokens. If unset, one is generated in `CEYROM_DATA/secret.key` |
| `CEYROM_DATA` | Folder for the data file and secret (default `./data`) |
| `CEYROM_ORIGINS` | Comma-separated allowed browser origins, used when the client is hosted elsewhere (e.g. Vercel) |
| `VITE_SERVER_URL` | Build-time server address for a client hosted on another domain |

`npm run build:single` produces `dist-single/index.html`, one self-contained file for offline play (computer, pass-and-play, practice, tutorial, daily challenge).

```bash
npm test               # physics, rules, AI and server tests (Vitest)
npm run typecheck
```

## How it's built

```
src/core/        Pure TypeScript, no DOM. Shared by browser and server.
  physics.ts     Deterministic rigid-disc simulator (fixed 240 Hz step, adaptive sub-steps)
  rules.ts       Rule engine: turns, fouls, queen and cover, dues, scoring, boards, match end
  ai.ts          AI planner (ghost-ball aiming, rebounds, simulated look-ahead)
  protocol.ts    WebSocket message types
src/game/        Browser game layer
  controller.ts  Game loop, input, AI turns, online prediction and reconciliation, HUD feed
  renderer.ts    Canvas renderer (interpolation, trails, powder puffs, pocket animations, aim guide)
  textures.ts    Procedural wood board, ICF markings, lotus centre, liyawela frame carving, coins
  audio.ts       WebAudio-synthesised sounds and generative music (no audio files)
src/ui/          React screens and components; Zustand stores
locales/         en / si / ta translation files (i18next). No UI text is hard-coded.
server/          Node + ws authoritative server, JSON-file store behind a Store interface
tests/           Vitest suites
```

### Physics

- Units are millimetres, grams and seconds on a 74 cm ICF board: pocket Ø 44.5 mm, coin Ø 31 mm at 5.5 g, striker Ø 41.2 mm at 15 g.
- Fixed 1/240 s step that doesn't depend on frame rate. The renderer interpolates, so rendering at 60 or 120 fps looks the same.
- Each step is split so no body moves more than 3 mm per sub-step. This is the continuous collision detection: no tunnelling, no overlaps, no teleporting.
- Impulse contacts with restitution, Coulomb tangential friction and spin. Walls lose energy and add spin. Sliding friction slows everything to a stop.
- The step uses only `+ − × ÷ √`, which IEEE-754 makes exact. The same shot gives bit-identical results in every browser and on the server. The test suite checks this.

### Rules (standard)

Own coin pocketed: shoot again. Striker pocketed: foul, one of your pocketed coins goes back (or you owe a due), turn ends.
Queen: optionally only after your first coin. It must be covered on the same or the next stroke, or it returns to the centre.
You can't pocket your last coin, or the opponent's last coin, before the queen is covered.
The board winner scores the opponent's remaining coins plus dues, plus 3 for the queen while their score is under 22.
Presets:
- **Competitive**: first to 25, 30 s shot clock
- **Casual**: one board
- **Gedara**: home rules, queen any time, no striker penalty
- **Freestyle**: white 20, black 10, queen 50
- **Custom** rules for private rooms

### Online

The server is authoritative. A client sends only `{striker position, direction, power, seq}`. The server checks:

- turn ownership
- phase
- legal placement and forward direction
- input ranges
- a monotonic sequence number, which blocks duplicate or replayed submissions

The server then simulates the shot, applies the rules and broadcasts the input with the resulting state.
The shooter's screen starts animating immediately as a prediction. Everyone else replays the same input. At rest, all clients snap to the server's state. Because the physics is deterministic, the snap is invisible.

Online play also includes:

- **Rooms**: 4-letter codes, invite links (`#room-CODE`), public matchmaking (1v1 and 2v2), spectators, rematch
- **Chat**: localized quick-chat phrases, each shown in the reader's own language
- **Shot clock**: server-side
- **Disconnects**: reconnection with signed tokens, and a 60 s grace before forfeit
- **Limits**: per-connection rate limiting
- **Ratings**: Elo, with results stored exactly once per match
- **Leaderboards**: global, Sri Lanka, weekly, monthly and "played with"

### AI

The AI makes candidate shots for every target coin and pocket: straight ghost-ball lines from many baseline positions, plus rebound shots at Hard and Expert. It ranks them by cut angle and distance, then simulates the best few with the same physics everyone uses.
Results are scored by pocketed coins, fouls, queen and cover, and the position left for the next shot.

Difficulty changes three things:

- how many shots it considers (4 to 44)
- how strategic it is
- how steady its hand is (aim error from about 3° at Beginner to 0.2° at Expert)

It never changes the physics.

## Status against the brief

Done and tested here:

- Phases 1, 2 and 4
- Phase 3 online play, tested locally (two browsers)
- Phase 5: profiles, XP and levels, achievements, cosmetic unlocks (four boards, four strikers), match history, leaderboards

Also included from the extras list:

- Gedara mode
- daily challenge
- replay of the last shot
- ghost trail of the previous shot
- AI coach in practice
- shot of the match
- spectator reactions
- offline play
- low-data mode

Not done yet:

- PostgreSQL and Redis. `server/store.ts` is a JSON file behind a `Store` interface, enough for one server instance. Swap it out before scaling.
- OAuth login. Players are anonymous guests with signed tokens.
- Tournaments (Village Tournament, Ceylon Championship), friend invites beyond share links, voice chat.
- Bundled font files. Fonts load from Google Fonts with system fallbacks.
- A native-speaker review of the Sinhala and Tamil text. The translations are careful but machine-authored.
