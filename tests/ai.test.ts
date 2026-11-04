import { describe, expect, it } from 'vitest';
import { chooseShot } from '../src/core/ai';
import { PRESETS, createMatch, playShot, validateShot } from '../src/core/rules';
import { stateWith } from './helpers';

describe('ai', () => {
  it('pockets an easy straight coin at expert level', async () => {
    const s = stateWith([
      { id: 3, kind: 'white', x: 230, y: -230 },
      { id: 11, kind: 'black', x: -150, y: 0 },
      { id: 12, kind: 'black', x: -100, y: 60 },
      { id: 1, kind: 'queen', x: 0, y: 0 },
      { id: 4, kind: 'white', x: 100, y: 120 },
    ]);
    let hits = 0;
    for (let k = 0; k < 4; k++) {
      const plan = await chooseShot(s, 'expert', 100 + k);
      expect(validateShot(s, plan.input)).toBeNull();
      const r = playShot(s, plan.input);
      if (r.outcome.scored > 0) hits++;
    }
    expect(hits).toBeGreaterThanOrEqual(3);
  });

  it('can finish whole matches against itself', async () => {
    for (const diff of ['beginner', 'hard'] as const) {
      let s = createMatch(PRESETS.casual, 2, 42);
      let shots = 0;
      while (s.phase === 'aiming' && shots < 400) {
        const plan = await chooseShot(s, diff, shots * 31 + 7);
        expect(validateShot(s, plan.input)).toBeNull();
        s = playShot(s, plan.input).state;
        shots++;
      }
      expect(s.phase).toBe('matchOver');
    }
  }, 120000);
});
