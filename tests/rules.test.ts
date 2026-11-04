import { describe, expect, it } from 'vitest';
import { BOARD, COIN_R } from '../src/core/constants';
import { World } from '../src/core/physics';
import { PRESETS, colorOf, createMatch, directionValid, initialCoins, nextBoard, placementValid, playShot, resolveShot, strikerPos, validateShot } from '../src/core/rules';
import { fakeWorld, stateWith } from './helpers';

function noOverlap(w: World) {
  const act = w.bodies.filter((b) => b.active);
  for (let i = 0; i < act.length; i++)
    for (let j = i + 1; j < act.length; j++) {
      const d = Math.sqrt((act[i].x - act[j].x) ** 2 + (act[i].y - act[j].y) ** 2);
      expect(d).toBeGreaterThan(act[i].r + act[j].r - 0.75);
    }
}

describe('layout and simulation', () => {
  it('lays out 9 white, 9 black and the queen without overlap', () => {
    const coins = initialCoins(3);
    expect(coins.filter((c) => c.kind === 'white')).toHaveLength(9);
    expect(coins.filter((c) => c.kind === 'black')).toHaveLength(9);
    expect(coins.filter((c) => c.kind === 'queen')).toHaveLength(1);
    for (let i = 0; i < coins.length; i++)
      for (let j = i + 1; j < coins.length; j++)
        expect(Math.hypot(coins[i].x - coins[j].x, coins[i].y - coins[j].y)).toBeGreaterThanOrEqual(COIN_R * 2);
  });

  it('is deterministic for identical inputs', () => {
    const s = createMatch(PRESETS.competitive, 2, 9);
    const input = { t: 0.13, dx: 0.02, dy: -1, power: 0.9 };
    const a = playShot(s, input);
    const b = playShot(s, input);
    expect(JSON.stringify(a.state.coins)).toEqual(JSON.stringify(b.state.coins));
  });

  it('never leaves bodies overlapping or outside the board after a hard break', () => {
    for (let k = 0; k < 6; k++) {
      const s = createMatch(PRESETS.casual, 2, k + 1);
      const r = playShot(s, { t: -0.3 + k * 0.1, dx: 0.04 * (k - 3), dy: -1, power: 1 });
      noOverlap(r.world);
      for (const b of r.world.bodies.filter((b) => b.active)) {
        expect(Math.abs(b.x)).toBeLessThanOrEqual(BOARD.half - b.r + 0.01);
        expect(Math.abs(b.y)).toBeLessThanOrEqual(BOARD.half - b.r + 0.01);
      }
      expect(r.world.isResting()).toBe(true);
    }
  });

});

describe('rules', () => {
  it('validates placement, direction and turn phase', () => {
    const s = createMatch(PRESETS.competitive, 2, 1);
    expect(placementValid(s, 0, 0)).toBe(true);
    expect(directionValid(0, 0, -1)).toBe(true);
    expect(directionValid(0, 0, 1)).toBe(false);
    expect(directionValid(2, 0, 1)).toBe(true);
    expect(validateShot(s, { t: 2, dx: 0, dy: -1, power: 0.5 })).toBe('placement');
    expect(validateShot(s, { t: 0, dx: 0, dy: -1, power: 1.5 })).toBe('power');
    const p = strikerPos(0, 0);
    s.coins[3] = { ...s.coins[3], x: p.x, y: p.y };
    expect(placementValid(s, 0, 0)).toBe(false);
  });

  it('pocketing your own coin continues the turn; opponent coin passes it', () => {
    const s = stateWith([
      { id: 2, kind: 'white', x: 0, y: 0 },
      { id: 3, kind: 'white', x: 100, y: 0 },
      { id: 11, kind: 'black', x: -100, y: 0 },
      { id: 12, kind: 'black', x: -100, y: 100 },
      { id: 1, kind: 'queen', x: 0, y: 100 },
    ]);
    const o = resolveShot(s, { t: 0, dx: 0, dy: -1, power: 1 }, fakeWorld(s, [2]));
    expect(o.continued).toBe(true);
    expect(s.turn).toBe(0);
    const o2 = resolveShot(s, { t: 0, dx: 0, dy: -1, power: 1 }, fakeWorld(s, [11]));
    expect(o2.continued).toBe(false);
    expect(s.turn).toBe(1);
  });

  it('striker foul returns a coin and adds a due when none are pocketed', () => {
    const s = createMatch(PRESETS.competitive, 2, 1);
    s.shotNo = 3;
    const o = resolveShot(s, { t: 0, dx: 0, dy: -1, power: 1 }, fakeWorld(s, [2], true));
    expect(o.foul).toBe(true);
    expect(s.coins.find((c) => c.id === 2)!.on).toBe(true);
    expect(s.dues[0]).toBe(1);
    // next own coin pays the due
    s.turn = 0;
    resolveShot(s, { t: 0, dx: 0, dy: -1, power: 1 }, fakeWorld(s, [3]));
    expect(s.dues[0]).toBe(0);
    expect(s.coins.find((c) => c.id === 3)!.on).toBe(true);
  });

  it('queen must be covered on the next stroke', () => {
    const s = stateWith([
      { id: 3, kind: 'white', x: 100, y: 0 },
      { id: 4, kind: 'white', x: 150, y: 0 },
      { id: 11, kind: 'black', x: -100, y: 0 },
      { id: 1, kind: 'queen', x: 0, y: 0 },
    ]);
    resolveShot(s, { t: 0, dx: 0, dy: -1, power: 1 }, fakeWorld(s, [1]));
    expect(s.queen.state).toBe('pending');
    expect(s.turn).toBe(0);
    resolveShot(s, { t: 0, dx: 0, dy: -1, power: 1 }, fakeWorld(s, []));
    expect(s.queen.state).toBe('board');
    expect(s.coins.find((c) => c.id === 1)!.on).toBe(true);
    expect(s.turn).toBe(1);
  });

  it('covering the queen with the last coin wins the board with queen points', () => {
    const s = stateWith([
      { id: 3, kind: 'white', x: 100, y: 0 },
      { id: 11, kind: 'black', x: -100, y: 0 },
      { id: 12, kind: 'black', x: -100, y: 60 },
      { id: 1, kind: 'queen', x: 0, y: 0 },
    ]);
    resolveShot(s, { t: 0, dx: 0, dy: -1, power: 1 }, fakeWorld(s, [1, 3]));
    expect(s.queen.state).toBe('covered');
    expect(s.results[0]).toMatchObject({ winner: 0, points: 2 + 3 });
    expect(s.phase).toBe('boardOver');
    nextBoard(s);
    expect(s.board).toBe(2);
    expect(s.breaker).toBe(1);
    expect(colorOf(s, 1)).toBe('white');
  });

  it('pocketing your last coin before the queen is a foul', () => {
    const s = stateWith([
      { id: 3, kind: 'white', x: 100, y: 0 },
      { id: 11, kind: 'black', x: -100, y: 0 },
      { id: 1, kind: 'queen', x: 0, y: 0 },
    ]);
    const o = resolveShot(s, { t: 0, dx: 0, dy: -1, power: 1 }, fakeWorld(s, [3]));
    expect(o.foul).toBe(true);
    expect(o.notes).toContain('foul.lastCoin');
    expect(s.coins.find((c) => c.id === 3)!.on).toBe(true);
  });

  it('single-board casual match ends after one board', () => {
    const s = stateWith(
      [
        { id: 3, kind: 'white', x: 100, y: 0 },
        { id: 11, kind: 'black', x: -100, y: 0 },
      ],
      PRESETS.casual,
    );
    s.queen = { state: 'covered', team: 1 };
    s.coins.find((c) => c.kind === 'queen')!.on = false;
    const o = resolveShot(s, { t: 0, dx: 0, dy: -1, power: 1 }, fakeWorld(s, [3]));
    expect(o.matchOver).toBe(true);
    expect(s.winner).toBe(0);
    expect(s.results[0].points).toBe(1);
  });

  it('freestyle scores 20/10/50', () => {
    const s = stateWith(
      [
        { id: 3, kind: 'white', x: 100, y: 0 },
        { id: 11, kind: 'black', x: -100, y: 0 },
        { id: 12, kind: 'black', x: -100, y: 60 },
        { id: 1, kind: 'queen', x: 0, y: 0 },
      ],
      PRESETS.freestyle,
    );
    s.boardPoints = [0, 0];
    resolveShot(s, { t: 0, dx: 0, dy: -1, power: 1 }, fakeWorld(s, [3, 11, 1]));
    expect(s.boardPoints[0]).toBe(20 + 10 + 50);
  });
});
