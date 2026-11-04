/** Practice drills, tutorial layouts and the seeded daily challenge. */
import { BOARD, COIN_R, POCKETS } from '../core/constants';
import { CoinRec, CoinKind, initialCoins } from '../core/rules';
import { makeRng, hashString } from '../core/rng';

export const DRILLS = ['break', 'straight', 'cut', 'rebound', 'queen', 'cluster'] as const;
export type DrillId = (typeof DRILLS)[number];

function layout(list: [CoinKind, number, number][]): CoinRec[] {
  const all = initialCoins(5);
  const used = new Set<number>();
  for (const c of all) c.on = false;
  for (const [kind, x, y] of list) {
    const c = all.find((k) => k.kind === kind && !used.has(k.id))!;
    used.add(c.id);
    Object.assign(c, { x, y, on: true, by: -1 });
  }
  return all;
}

export function drillCoins(id: string): CoinRec[] {
  switch (id) {
    case 'straight':
      return layout([['white', -132, -78]]);
    case 'cut':
      return layout([
        ['white', -250, -120],
        ['white', 190, -250],
      ]);
    case 'rebound':
      return layout([
        ['white', -296, 296],
        ['black', -40, 120],
      ]);
    case 'queen':
      return layout([
        ['queen', 0, 0],
        ['white', -110, -210],
        ['white', 170, -150],
        ['black', 60, -60],
      ]);
    case 'cluster':
      return layout([
        ['white', 160, -180],
        ['white', 160 + COIN_R * 2.01, -180],
        ['black', 160 + COIN_R, -180 - COIN_R * 1.75],
        ['black', 160, -180 + COIN_R * 2.01],
        ['white', -120, -60],
      ]);
    default:
      return initialCoins(Date.now() & 0xffff);
  }
}

export const TUTORIAL_STEPS = ['move', 'aim', 'pot', 'queen', 'fouls'] as const;

export function tutorialCoins(step: number): CoinRec[] {
  if (step <= 1) return layout([['white', -132, -78], ['black', 120, -160]]);
  if (step === 2) return layout([['white', -132, -78]]);
  if (step === 3)
    return layout([
      ['queen', -90, -150],
      ['white', 150, -170],
      ['white', -200, -40],
    ]);
  return layout([['white', 0, -120]]);
}

export function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const CHALLENGE_LIMIT = 7;

/** Five whites to clear in seven strokes, with a few blacks in the way. Same for everyone each day. */
export function challengeCoins(key = todayKey()): CoinRec[] {
  const rng = makeRng(hashString('ceyrom-daily-' + key));
  const list: [CoinKind, number, number][] = [];
  const placed: { x: number; y: number }[] = [];
  const ok = (x: number, y: number) => {
    if (placed.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < (COIN_R * 2 + 14) ** 2)) return false;
    if (POCKETS.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < 70 * 70)) return false;
    if (Math.abs(y - BOARD.baseline) < 45) return false;
    return Math.abs(x) < BOARD.half - 40 && Math.abs(y) < BOARD.half - 40;
  };
  const add = (kind: CoinKind, n: number) => {
    let guard = 0;
    while (n > 0 && guard++ < 500) {
      const x = (rng() * 2 - 1) * 300;
      const y = -310 + rng() * 480;
      if (!ok(x, y)) continue;
      placed.push({ x, y });
      list.push([kind, x, y]);
      n--;
    }
  };
  add('white', 5);
  add('black', 4);
  return layout(list);
}
