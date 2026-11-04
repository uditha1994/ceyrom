import { World, makeBody } from '../src/core/physics';
import { MatchState, PRESETS, createMatch } from '../src/core/rules';

/** A match state with only the listed coins on the board (others count as pocketed). */
export function stateWith(coins: { id: number; kind: 'white' | 'black' | 'queen'; x: number; y: number }[], preset = PRESETS.competitive): MatchState {
  const s = createMatch(preset, 2, 1);
  s.coins = s.coins.map((c) => ({ ...c, on: false, by: c.kind === 'white' ? 0 : c.kind === 'black' ? 1 : -1, order: 0 }));
  for (const k of coins) {
    const c = s.coins.find((x) => x.id === k.id)!;
    Object.assign(c, { x: k.x, y: k.y, on: true, by: -1 });
  }
  s.shotNo = 5;
  return s;
}

/** A pocketing world built by hand: these ids drop. */
export function fakeWorld(s: MatchState, dropIds: number[], striker = false): World {
  const w = new World([makeBody(0, 'striker', 0, 250), ...s.coins.filter((c) => c.on).map((c) => makeBody(c.id, c.kind, c.x, c.y))], false);
  for (const id of dropIds) {
    const b = w.bodies.find((b) => b.id === id)!;
    b.active = false;
    w.pocketLog.push({ id, kind: b.kind, pocket: 0, step: 1 });
  }
  if (striker) {
    w.bodies[0].active = false;
    w.pocketLog.push({ id: 0, kind: 'striker', pocket: 0, step: 2 });
  }
  return w;
}
