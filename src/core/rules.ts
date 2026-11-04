/**
 * Ceyrom rule engine. Pure data in, pure data out — no DOM, no timers — so the browser,
 * the AI and the authoritative server all run exactly the same code.
 */
import { BOARD, COIN_R, STRIKER_R, powerToSpeed } from './constants';
import { Body, Kind, World, makeBody } from './physics';
import { makeRng } from './rng';

export type Variant = 'standard' | 'freestyle';
export type CoinKind = 'white' | 'black' | 'queen';
export type PresetId = 'competitive' | 'casual' | 'gedara' | 'freestyle';

export interface RuleConfig {
  preset: PresetId | 'custom';
  variant: Variant;
  /** Match points needed to win. 0 = a single board decides the match. */
  targetPoints: number;
  /** Queen may only be pocketed after the team has pocketed one of its own coins. */
  queenNeedsOwnCoin: boolean;
  /** Pocketing the striker costs a coin (or a due). */
  strikerPenalty: boolean;
  /** Seconds per shot, 0 = no clock. */
  shotClock: number;
  /** Queen's 3 points only count while the winner's score is below this. */
  queenCap: number;
}

export const PRESETS: Record<PresetId, RuleConfig> = {
  competitive: { preset: 'competitive', variant: 'standard', targetPoints: 25, queenNeedsOwnCoin: true, strikerPenalty: true, shotClock: 30, queenCap: 22 },
  casual: { preset: 'casual', variant: 'standard', targetPoints: 0, queenNeedsOwnCoin: true, strikerPenalty: true, shotClock: 0, queenCap: 22 },
  gedara: { preset: 'gedara', variant: 'standard', targetPoints: 0, queenNeedsOwnCoin: false, strikerPenalty: false, shotClock: 0, queenCap: 22 },
  freestyle: { preset: 'freestyle', variant: 'freestyle', targetPoints: 0, queenNeedsOwnCoin: false, strikerPenalty: true, shotClock: 0, queenCap: 999 },
};

export const FREESTYLE_POINTS: Record<CoinKind, number> = { white: 20, black: 10, queen: 50 };

export interface CoinRec {
  id: number;
  kind: CoinKind;
  x: number;
  y: number;
  a: number;
  on: boolean;
  /** Team credited with this coin when pocketed (-1 while on board). */
  by: number;
  /** Order of pocketing within the board (for returning the latest coin first). */
  order: number;
}

export interface ShotInput {
  /** Striker position along the shooter's baseline, -1 (their left) .. 1 (their right). */
  t: number;
  /** Aim direction in board coordinates (need not be normalised). */
  dx: number;
  dy: number;
  /** 0..1 */
  power: number;
}

export interface SeatStats {
  shots: number;
  pocketed: number;
  fouls: number;
  queens: number;
  best: number;
}

export interface BoardResult {
  board: number;
  winner: number; // team, -1 draw
  points: number;
  queenTo: number; // team or -1
}

export type Note =
  | 'foul.striker'
  | 'foul.lastCoin'
  | 'foul.oppLastCoin'
  | 'queen.pocketed'
  | 'queen.covered'
  | 'queen.returned'
  | 'queen.early'
  | 'due.added'
  | 'due.paid'
  | 'turn.continue'
  | 'turn.timeout'
  | 'board.over'
  | 'match.over';

export interface ShotOutcome {
  seat: number;
  team: number;
  pocketed: { id: number; kind: Kind }[];
  returned: number[];
  foul: boolean;
  notes: Note[];
  continued: boolean;
  boardOver: boolean;
  matchOver: boolean;
  /** Own coins (or any, in freestyle) that stayed down for the shooter. */
  scored: number;
}

export interface ShotRecord {
  seat: number;
  board: number;
  input: ShotInput;
  coins: CoinRec[];
  scored: number;
}

export interface MatchState {
  config: RuleConfig;
  seats: number; // 2 | 4
  board: number;
  breaker: number;
  turn: number;
  scores: [number, number];
  boardPoints: [number, number];
  coins: CoinRec[];
  queen: { state: 'board' | 'pending' | 'covered'; team: number };
  dues: [number, number];
  shotNo: number;
  pocketCounter: number;
  phase: 'aiming' | 'boardOver' | 'matchOver';
  winner: number; // team, -1 = none/draw
  results: BoardResult[];
  stats: SeatStats[];
  bestShot: ShotRecord | null;
  seed: number;
}

// ───────────────────────────── geometry helpers ─────────────────────────────

export const teamOf = (seat: number) => seat % 2;

/** Board side a seat sits on: 0 bottom, 1 right, 2 top, 3 left. */
export function sideOf(state: Pick<MatchState, 'seats'>, seat: number): number {
  return state.seats === 2 ? seat * 2 : seat;
}

/** Rotate a bottom-player local vector into board coordinates for a side. */
export function toBoard(side: number, x: number, y: number): { x: number; y: number } {
  switch (side & 3) {
    case 0:
      return { x, y };
    case 1:
      return { x: y, y: -x };
    case 2:
      return { x: -x, y: -y };
    default:
      return { x: -y, y: x };
  }
}

export function toLocal(side: number, x: number, y: number): { x: number; y: number } {
  return toBoard((4 - (side & 3)) & 3, x, y);
}

export function strikerPos(side: number, t: number): { x: number; y: number } {
  const c = Math.max(-1, Math.min(1, t));
  return toBoard(side, c * BOARD.baseHalf, BOARD.baseline);
}

export function colorOf(state: MatchState, team: number): 'white' | 'black' {
  return team === teamOf(state.breaker) ? 'white' : 'black';
}

/** True when the striker at t does not overlap any coin on the board. */
export function placementValid(state: MatchState, side: number, t: number): boolean {
  if (!(t >= -1 && t <= 1)) return false;
  const p = strikerPos(side, t);
  const rr = (STRIKER_R + COIN_R) * (STRIKER_R + COIN_R);
  for (const c of state.coins) {
    if (!c.on) continue;
    const dx = c.x - p.x;
    const dy = c.y - p.y;
    if (dx * dx + dy * dy < rr) return false;
  }
  return true;
}

/** Shots must travel forward from the baseline (sideways allowed, backwards not). */
export function directionValid(side: number, dx: number, dy: number): boolean {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-9) return false;
  const l = toLocal(side, dx / len, dy / len);
  return l.y < -0.035;
}

export function validateShot(state: MatchState, input: ShotInput): string | null {
  if (state.phase !== 'aiming') return 'phase';
  if (!input || typeof input !== 'object') return 'input';
  const { t, dx, dy, power } = input;
  if (![t, dx, dy, power].every((v) => typeof v === 'number' && Number.isFinite(v))) return 'input';
  if (power < 0 || power > 1) return 'power';
  const side = sideOf(state, state.turn);
  if (!placementValid(state, side, t)) return 'placement';
  if (!directionValid(side, dx, dy)) return 'direction';
  return null;
}

// ───────────────────────────── layout ─────────────────────────────

/** Traditional opening: queen centre, inner ring of six, outer ring of twelve, whites forming a 'Y'. */
export function initialCoins(seed: number): CoinRec[] {
  const rng = makeRng(seed);
  const d = COIN_R * 2 + 0.08;
  const coins: CoinRec[] = [];
  let wid = 2;
  let bid = 11;
  const push = (kind: CoinKind, x: number, y: number) => {
    const id = kind === 'queen' ? 1 : kind === 'white' ? wid++ : bid++;
    coins.push({ id, kind, x, y, a: rng() * Math.PI * 2, on: true, by: -1, order: 0 });
  };
  push('queen', 0, 0);
  // hex directions (angle 90° = straight up for the Y)
  for (let i = 0; i < 6; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 3;
    const kind: CoinKind = i % 2 === 0 ? 'white' : 'black';
    push(kind, Math.cos(ang) * d, Math.sin(ang) * d);
  }
  for (let i = 0; i < 6; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 3;
    const kind: CoinKind = i % 2 === 0 ? 'white' : 'black';
    push(kind, Math.cos(ang) * 2 * d, Math.sin(ang) * 2 * d);
  }
  for (let i = 0; i < 6; i++) {
    const ang = -Math.PI / 2 + Math.PI / 6 + (i * Math.PI) / 3;
    const r = Math.sqrt(3) * d;
    const kind: CoinKind = i % 2 === 0 ? 'black' : 'white';
    push(kind, Math.cos(ang) * r, Math.sin(ang) * r);
  }
  return coins.sort((a, b) => a.id - b.id);
}

export function createMatch(config: RuleConfig, seats: 2 | 4, seed = 1): MatchState {
  return {
    config: { ...config },
    seats,
    board: 1,
    breaker: 0,
    turn: 0,
    scores: [0, 0],
    boardPoints: [0, 0],
    coins: initialCoins(seed),
    queen: { state: 'board', team: -1 },
    dues: [0, 0],
    shotNo: 0,
    pocketCounter: 0,
    phase: 'aiming',
    winner: -1,
    results: [],
    stats: Array.from({ length: seats }, () => ({ shots: 0, pocketed: 0, fouls: 0, queens: 0, best: 0 })),
    bestShot: null,
    seed,
  };
}

export function cloneState(s: MatchState): MatchState {
  return structuredClone(s);
}

/** Find the free spot closest to the centre for a returned coin. */
export function freeSpotNearCentre(coins: CoinRec[], ignoreId = -1): { x: number; y: number } {
  const min2 = (COIN_R * 2 + 0.2) * (COIN_R * 2 + 0.2);
  const free = (x: number, y: number) => {
    for (const c of coins) {
      if (!c.on || c.id === ignoreId) continue;
      const dx = c.x - x;
      const dy = c.y - y;
      if (dx * dx + dy * dy < min2) return false;
    }
    return true;
  };
  if (free(0, 0)) return { x: 0, y: 0 };
  for (let ring = 1; ring < 60; ring++) {
    const r = ring * 3;
    const steps = Math.max(8, Math.floor((2 * Math.PI * r) / 3));
    for (let k = 0; k < steps; k++) {
      const ang = (k / steps) * Math.PI * 2;
      const x = Math.cos(ang) * r;
      const y = Math.sin(ang) * r;
      if (free(x, y)) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

function returnCoin(state: MatchState, coin: CoinRec, returned: number[]): void {
  const p = freeSpotNearCentre(state.coins, coin.id);
  coin.x = p.x;
  coin.y = p.y;
  coin.on = true;
  coin.by = -1;
  coin.order = 0;
  returned.push(coin.id);
}

/** Latest pocketed coin of a colour credited to the team. */
function latestPocketed(state: MatchState, kind: CoinKind, team: number): CoinRec | undefined {
  let best: CoinRec | undefined;
  for (const c of state.coins) if (!c.on && c.kind === kind && c.by === team && (!best || c.order > best.order)) best = c;
  return best;
}

export const onBoardCount = (state: MatchState, kind: CoinKind) => state.coins.filter((c) => c.on && c.kind === kind).length;

// ───────────────────────────── shot pipeline ─────────────────────────────

/** Build a physics world for a shot. */
export function shotWorld(state: MatchState, input: ShotInput, recordEvents = true): World {
  const side = sideOf(state, state.turn);
  const p = strikerPos(side, input.t);
  const bodies: Body[] = [];
  const striker = makeBody(0, 'striker', p.x, p.y);
  const len = Math.sqrt(input.dx * input.dx + input.dy * input.dy) || 1;
  const sp = powerToSpeed(input.power);
  striker.vx = (input.dx / len) * sp;
  striker.vy = (input.dy / len) * sp;
  bodies.push(striker);
  for (const c of state.coins) if (c.on) bodies.push(makeBody(c.id, c.kind, c.x, c.y, c.a));
  return new World(bodies, recordEvents);
}

/** Simulate a shot to rest and resolve it. Used by the server and the AI. */
export function playShot(state: MatchState, input: ShotInput): { state: MatchState; outcome: ShotOutcome; world: World } {
  const world = shotWorld(state, input, false);
  world.runToRest();
  const next = cloneState(state);
  const outcome = resolveShot(next, input, world);
  return { state: next, outcome, world };
}

/**
 * Apply a finished world to the match state (mutates `state`).
 * This is where every carrom rule lives.
 */
export function resolveShot(state: MatchState, input: ShotInput | null, world: World | null): ShotOutcome {
  const seat = state.turn;
  const team = teamOf(seat);
  const opp = 1 - team;
  const pre = state.coins.map((c) => ({ ...c }));
  const notes: Note[] = [];
  const returned: number[] = [];

  // copy final positions back
  const pocketedIds = new Set<number>();
  let strikerPocketed = false;
  if (world) {
    for (const b of world.bodies) {
      if (b.kind === 'striker') continue;
      const c = state.coins.find((k) => k.id === b.id);
      if (!c) continue;
      c.x = b.x;
      c.y = b.y;
      c.a = b.a;
    }
    for (const p of world.pocketLog) {
      if (p.kind === 'striker') strikerPocketed = true;
      else pocketedIds.add(p.id);
    }
  }
  const order = world ? world.pocketLog.filter((p) => p.kind !== 'striker') : [];
  const pocketed = order.map((p) => ({ id: p.id, kind: p.kind }));
  for (const p of order) {
    const c = state.coins.find((k) => k.id === p.id)!;
    c.on = false;
    c.order = ++state.pocketCounter;
  }

  const stats = state.stats[seat];
  if (input) stats.shots++;
  state.shotNo++;

  let foul = false;
  let continued = false;
  let scored = 0;

  if (!world) notes.push('turn.timeout');

  if (state.config.variant === 'freestyle') {
    const fresh = order.map((p) => state.coins.find((k) => k.id === p.id)!);
    if (strikerPocketed) {
      foul = true;
      notes.push('foul.striker');
      stats.fouls++;
      for (const c of fresh) returnCoin(state, c, returned);
      if (state.queen.state === 'pending' && state.queen.team === team) {
        const q = state.coins.find((k) => k.kind === 'queen')!;
        returnCoin(state, q, returned);
        state.queen = { state: 'board', team: -1 };
        notes.push('queen.returned');
      }
      state.boardPoints[team] = Math.max(0, state.boardPoints[team] - 10);
    } else {
      const queenNow = fresh.find((c) => c.kind === 'queen');
      const others = fresh.filter((c) => c.kind !== 'queen');
      if (state.queen.state === 'pending' && state.queen.team === team && !queenNow) {
        if (others.length > 0) {
          state.queen = { state: 'covered', team };
          state.boardPoints[team] += FREESTYLE_POINTS.queen;
          stats.queens++;
          notes.push('queen.covered');
        } else {
          const q = state.coins.find((k) => k.kind === 'queen')!;
          returnCoin(state, q, returned);
          state.queen = { state: 'board', team: -1 };
          notes.push('queen.returned');
        }
      }
      for (const c of others) {
        c.by = team;
        state.boardPoints[team] += FREESTYLE_POINTS[c.kind];
      }
      if (queenNow) {
        queenNow.by = team;
        const remaining = state.coins.filter((c) => c.on).length;
        if (others.length > 0 || remaining === 0) {
          state.queen = { state: 'covered', team };
          state.boardPoints[team] += FREESTYLE_POINTS.queen;
          stats.queens++;
          notes.push('queen.covered');
        } else {
          state.queen = { state: 'pending', team };
          notes.push('queen.pocketed');
        }
      }
      scored = fresh.length;
      continued = fresh.length > 0;
    }
  } else {
    const own = colorOf(state, team);
    const theirs = colorOf(state, opp);
    const fresh = order.map((p) => state.coins.find((k) => k.id === p.id)!);
    const ownFresh = fresh.filter((c) => c.kind === own);
    const oppFresh = fresh.filter((c) => c.kind === theirs);
    const queenFresh = fresh.find((c) => c.kind === 'queen');
    for (const c of ownFresh) c.by = team;
    for (const c of oppFresh) c.by = opp;
    const queenWasPending = state.queen.state === 'pending' && state.queen.team === team;
    const q = state.coins.find((k) => k.kind === 'queen')!;

    const penalise = () => {
      if (!state.config.strikerPenalty) return;
      const back = latestPocketed(state, own, team);
      if (back) returnCoin(state, back, returned);
      else {
        state.dues[team]++;
        notes.push('due.added');
      }
    };

    if (strikerPocketed) {
      foul = true;
      notes.push('foul.striker');
      stats.fouls++;
      for (const c of ownFresh) returnCoin(state, c, returned);
      if (queenFresh || queenWasPending) {
        returnCoin(state, q, returned);
        state.queen = { state: 'board', team: -1 };
        notes.push('queen.returned');
      }
      penalise();
    } else {
      // 1) queen awaiting cover from the previous stroke
      if (queenWasPending && !queenFresh) {
        if (ownFresh.length > 0) {
          state.queen = { state: 'covered', team };
          q.by = team;
          stats.queens++;
          notes.push('queen.covered');
        } else {
          returnCoin(state, q, returned);
          state.queen = { state: 'board', team: -1 };
          notes.push('queen.returned');
        }
      }
      // 2) queen pocketed this stroke
      if (queenFresh) {
        const hadOwn = state.coins.some((c) => !c.on && c.kind === own && c.by === team);
        if (state.config.queenNeedsOwnCoin && !hadOwn) {
          returnCoin(state, q, returned);
          notes.push('queen.early');
        } else if (ownFresh.length > 0) {
          state.queen = { state: 'covered', team };
          q.by = team;
          stats.queens++;
          notes.push('queen.covered');
        } else {
          state.queen = { state: 'pending', team };
          q.by = team;
          notes.push('queen.pocketed');
        }
      }
      // 3) pay dues with freshly pocketed own coins
      while (state.dues[team] > 0) {
        const c = ownFresh.find((k) => !k.on && !returned.includes(k.id));
        if (!c) break;
        returnCoin(state, c, returned);
        state.dues[team]--;
        notes.push('due.paid');
      }
      const queenOpen = state.queen.state !== 'covered';
      // 4) pocketing your last coin before the queen is covered
      if (queenOpen && onBoardCount(state, own) === 0 && ownFresh.length > 0) {
        foul = true;
        notes.push('foul.lastCoin');
        stats.fouls++;
        for (const c of ownFresh) if (!c.on) returnCoin(state, c, returned);
        if (state.queen.state === 'pending' && state.queen.team === team) {
          returnCoin(state, q, returned);
          state.queen = { state: 'board', team: -1 };
          notes.push('queen.returned');
        }
        penalise();
      }
      // 5) pocketing the opponent's last coin before the queen is covered
      if (queenOpen && onBoardCount(state, theirs) === 0 && oppFresh.length > 0) {
        if (!foul) {
          foul = true;
          stats.fouls++;
          penalise();
        }
        notes.push('foul.oppLastCoin');
        for (const c of oppFresh) if (!c.on) returnCoin(state, c, returned);
      }
      if (!foul) {
        scored = ownFresh.filter((c) => !c.on).length;
        continued = scored > 0 || state.queen.state === 'pending';
      }
    }
  }

  if (state.queen.state === 'pending' && state.queen.team !== team) {
    // cannot happen in normal flow; keep the state consistent
    state.queen = { state: 'board', team: -1 };
  }

  stats.pocketed += scored;
  if (scored > stats.best) stats.best = scored;
  if (input && scored > 0 && (!state.bestShot || scored > state.bestShot.scored))
    state.bestShot = { seat, board: state.board, input: { ...input }, coins: pre, scored };

  if (continued) notes.push('turn.continue');

  const outcome: ShotOutcome = {
    seat,
    team,
    pocketed,
    returned,
    foul,
    notes,
    continued,
    boardOver: false,
    matchOver: false,
    scored,
  };

  checkBoardEnd(state, outcome);
  if (!outcome.boardOver && !continued) state.turn = (state.turn + 1) % state.seats;
  return outcome;
}

/** A shot clock expiry: the turn passes, a pending queen goes back. */
export function resolveTimeout(state: MatchState): ShotOutcome {
  const team = teamOf(state.turn);
  const out = resolveShot(state, null, null);
  if (state.queen.state === 'pending' && state.queen.team === team) {
    const q = state.coins.find((k) => k.kind === 'queen')!;
    returnCoin(state, q, out.returned);
    state.queen = { state: 'board', team: -1 };
    out.notes.push('queen.returned');
  }
  return out;
}

function checkBoardEnd(state: MatchState, outcome: ShotOutcome): void {
  const cfg = state.config;
  let winner = -2;
  let points = 0;
  if (cfg.variant === 'freestyle') {
    if (state.coins.every((c) => !c.on) && state.queen.state !== 'pending') {
      const [a, b] = state.boardPoints;
      winner = a === b ? -1 : a > b ? 0 : 1;
      points = winner >= 0 ? state.boardPoints[winner] : 0;
      state.scores[0] += state.boardPoints[0];
      state.scores[1] += state.boardPoints[1];
    }
  } else if (state.queen.state === 'covered') {
    const cleared = [0, 1].filter((t) => onBoardCount(state, colorOf(state, t)) === 0);
    if (cleared.length) {
      winner = cleared.includes(outcome.team) ? outcome.team : cleared[0];
      const loser = 1 - winner;
      points = onBoardCount(state, colorOf(state, loser)) + state.dues[loser];
      if (state.queen.team === winner && state.scores[winner] < cfg.queenCap) points += 3;
      state.scores[winner] += points;
    }
  }
  if (winner === -2) return;
  state.results.push({ board: state.board, winner, points, queenTo: state.queen.team });
  outcome.boardOver = true;
  outcome.notes.push('board.over');
  state.phase = 'boardOver';
  const done =
    cfg.targetPoints <= 0 || state.scores[0] >= cfg.targetPoints || state.scores[1] >= cfg.targetPoints || state.board >= 12;
  if (done) {
    state.phase = 'matchOver';
    const [a, b] = state.scores;
    state.winner = cfg.targetPoints <= 0 ? winner : a === b ? -1 : a > b ? 0 : 1;
    outcome.matchOver = true;
    outcome.notes.push('match.over');
  }
}

/** Set up the next board after a board ends. Breaks rotate around the table. */
export function nextBoard(state: MatchState): void {
  if (state.phase !== 'boardOver') return;
  state.board++;
  state.breaker = (state.breaker + 1) % state.seats;
  state.turn = state.breaker;
  state.coins = initialCoins(state.seed + state.board * 7919);
  state.queen = { state: 'board', team: -1 };
  state.dues = [0, 0];
  state.boardPoints = [0, 0];
  state.shotNo = 0;
  state.pocketCounter = 0;
  state.phase = 'aiming';
}

/** Coins still to pocket for a team (standard) — used by the HUD. */
export function remainingFor(state: MatchState, team: number): number {
  if (state.config.variant === 'freestyle') return state.coins.filter((c) => c.on).length;
  return onBoardCount(state, colorOf(state, team));
}

export const ruleSummaryKey = (cfg: RuleConfig) => `rules.preset.${cfg.preset}`;
