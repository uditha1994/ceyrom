import { describe, expect, it } from 'vitest';
import { POCKETS } from '../src/core/constants';
import { World, makeBody, kineticEnergy } from '../src/core/physics';

describe('physics', () => {
  it('loses energy (friction) and eventually rests', () => {
    const s = makeBody(0, 'striker', 0, 200);
    s.vy = -5000;
    const w = new World([s]);
    let prev = kineticEnergy(w.bodies);
    for (let i = 0; i < 4000 && !w.isResting(); i++) {
      w.step();
      const e = kineticEnergy(w.bodies);
      expect(e).toBeLessThanOrEqual(prev + 1e-6);
      prev = e;
    }
    expect(w.isResting()).toBe(true);
  });

  it('does not tunnel a fast striker through a coin', () => {
    const s = makeBody(0, 'striker', 0, 300);
    s.vy = -5400;
    const c = makeBody(2, 'white', 0, 0);
    const w = new World([s, c]);
    w.runToRest();
    expect(w.pocketLog.length + (c.vy !== 0 || c.y !== 0 ? 1 : 0)).toBeGreaterThan(0);
    expect(w.events.some((e) => e.type === 'hit')).toBe(true);
  });

  it('pockets a coin sent straight into a corner', () => {
    const P = POCKETS[1];
    const c = makeBody(2, 'white', P.x - 150, P.y + 150);
    c.vx = 900;
    c.vy = -900;
    const w = new World([c]);
    w.runToRest();
    expect(w.pocketLog.map((p) => p.pocket)).toEqual([1]);
  });
});
