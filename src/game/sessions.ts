import type { Difficulty } from '../core/ai';
import { PRESETS, PresetId, RuleConfig } from '../core/rules';
import { load, save } from '../store/storage';
import { PlayerInfo, SessionConfig, useProfile } from '../store/stores';

export interface AiPrefs {
  difficulty: Difficulty;
  preset: PresetId;
  seats: 2 | 4;
  clock: boolean;
}

export const loadAiPrefs = () => load<AiPrefs>('ceyrom.lastAi', { difficulty: 'easy', preset: 'casual', seats: 2, clock: false });
export const saveAiPrefs = (p: AiPrefs) => save('ceyrom.lastAi', p);

const AI_NAMES: Record<Difficulty, string[]> = {
  beginner: ['Podi Malli', 'Chooti', 'Kumari'],
  easy: ['Nangi', 'Sunil Aiya', 'Mala'],
  medium: ['Ranjan', 'Fathima', 'Kavin'],
  hard: ['Mahesh', 'Priya', 'Nimal Mama'],
  expert: ['Seeya', 'Achchi', 'Captain Ruwan'],
};

export function rulesFor(preset: PresetId, clock: boolean): RuleConfig {
  const r = { ...PRESETS[preset] };
  if (preset !== 'competitive') r.shotClock = clock ? 30 : 0;
  else r.shotClock = clock ? 30 : 0;
  return r;
}

function me(): PlayerInfo {
  const p = useProfile.getState();
  return { name: p.name || 'You', avatar: p.avatar, controller: 'human', id: p.id };
}

export function makeAiSession(prefs: AiPrefs): SessionConfig {
  const names = AI_NAMES[prefs.difficulty];
  const ai = (i: number): PlayerInfo => ({ name: names[i % names.length], avatar: (3 + i * 2) % 8, controller: 'ai', difficulty: prefs.difficulty });
  const players = prefs.seats === 2 ? [me(), ai(0)] : [me(), ai(0), { ...ai(1), name: names[1] }, ai(2)];
  return { kind: 'ai', rules: rulesFor(prefs.preset, prefs.clock), seats: prefs.seats, players, mySeat: 0, seed: (Math.random() * 1e9) | 0, difficulty: prefs.difficulty };
}

export function makeLocalSession(names: string[], seats: 2 | 4, preset: PresetId, clock: boolean): SessionConfig {
  const players: PlayerInfo[] = names.slice(0, seats).map((n, i) => ({ name: n, avatar: (i * 3 + 1) % 8, controller: 'human' }));
  return { kind: 'local', rules: rulesFor(preset, clock), seats, players, mySeat: 0, seed: (Math.random() * 1e9) | 0 };
}

export function makeSolo(kind: 'practice' | 'tutorial' | 'challenge', drill?: string): SessionConfig {
  return { kind, rules: PRESETS.freestyle, seats: 2, players: [me(), { name: '—', avatar: 0, controller: 'human' }], mySeat: 0, seed: 1, drill };
}
