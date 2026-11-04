import { create } from 'zustand';
import type { Difficulty } from '../core/ai';
import type { MatchState, RuleConfig } from '../core/rules';
import { load, save, uid } from './storage';

// ───────────────────────────── settings ─────────────────────────────

export type Lang = 'en' | 'si' | 'ta';

export interface Settings {
  lang: Lang;
  theme: 'system' | 'dark' | 'light';
  music: number;
  sfx: number;
  muted: boolean;
  musicOn: boolean;
  vibration: boolean;
  guide: 'full' | 'short' | 'off';
  controls: 'slingshot' | 'point';
  quality: 'high' | 'low';
  motion: 'system' | 'reduce' | 'full';
  fps: 60 | 120;
  board: string;
  striker: string;
  lowData: boolean;
  onboarded: boolean;
  serverUrl: string;
}

const DEFAULT_SETTINGS: Settings = {
  lang: 'en',
  theme: 'system',
  music: 0.35,
  sfx: 0.8,
  muted: false,
  musicOn: true,
  vibration: true,
  guide: 'full',
  controls: 'slingshot',
  quality: 'high',
  motion: 'system',
  fps: 120,
  board: 'jak',
  striker: 'ivory',
  lowData: false,
  onboarded: false,
  serverUrl: '',
};

interface SettingsStore extends Settings {
  set: (p: Partial<Settings>) => void;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  ...load('ceyrom.settings', DEFAULT_SETTINGS),
  set: (p) => {
    set(p);
    const { set: _s, ...rest } = get();
    void _s;
    save('ceyrom.settings', rest);
  },
}));

export function prefersReducedMotion(): boolean {
  const m = useSettings.getState().motion;
  if (m === 'reduce') return true;
  if (m === 'full') return false;
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// ───────────────────────────── profile ─────────────────────────────

export interface MatchSummary {
  at: number;
  mode: SessionKind;
  opponent: string;
  won: boolean | null;
  score: [number, number];
  difficulty?: Difficulty;
}

export interface Profile {
  id: string;
  name: string;
  avatar: number;
  country: string;
  xp: number;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  rating: number;
  bestRating: number;
  modes: Record<string, number>;
  history: MatchSummary[];
  achievements: string[];
  daily: Record<string, number>;
  pocketed: number;
  queens: number;
}

const DEFAULT_PROFILE: Profile = {
  id: uid(),
  name: '',
  avatar: 0,
  country: 'LK',
  xp: 0,
  matches: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  rating: 1200,
  bestRating: 1200,
  modes: {},
  history: [],
  achievements: [],
  daily: {},
  pocketed: 0,
  queens: 0,
};

export const levelFor = (xp: number) => Math.floor(Math.sqrt(xp / 120)) + 1;
export const xpForLevel = (lvl: number) => (lvl - 1) * (lvl - 1) * 120;

interface ProfileStore extends Profile {
  update: (p: Partial<Profile> | ((p: Profile) => Partial<Profile>)) => void;
}

export const useProfile = create<ProfileStore>((set, get) => {
  const initial = load('ceyrom.profile', DEFAULT_PROFILE);
  if (!initial.id) initial.id = uid();
  save('ceyrom.profile', initial);
  return {
    ...initial,
    update: (p) => {
      const cur = get();
      const patch = typeof p === 'function' ? p(cur) : p;
      set(patch);
      const { update: _u, ...rest } = get();
      void _u;
      save('ceyrom.profile', rest);
    },
  };
});

// ───────────────────────────── navigation / session ─────────────────────────────

export type SessionKind = 'ai' | 'local' | 'online' | 'practice' | 'tutorial' | 'challenge';

export interface PlayerInfo {
  name: string;
  avatar: number;
  controller: 'human' | 'ai' | 'remote';
  difficulty?: Difficulty;
  id?: string;
  rating?: number;
}

export interface SessionConfig {
  kind: SessionKind;
  rules: RuleConfig;
  seats: 2 | 4;
  players: PlayerInfo[];
  mySeat: number;
  seed: number;
  drill?: string;
  roomCode?: string;
  difficulty?: Difficulty;
  initialState?: MatchState;
  initialTurnMs?: number | null;
}

export interface MatchResult {
  session: SessionConfig;
  state: MatchState;
  myTeam: number;
  xp: number;
  achievements: string[];
  ratingDelta?: number;
  forfeit?: boolean;
  shots: number;
}

export type Screen =
  | 'splash'
  | 'onboarding'
  | 'menu'
  | 'mode'
  | 'aiSetup'
  | 'localSetup'
  | 'lobby'
  | 'game'
  | 'results'
  | 'profile'
  | 'leaderboard'
  | 'settings'
  | 'practice';

interface AppStore {
  screen: Screen;
  back: Screen[];
  session: SessionConfig | null;
  result: MatchResult | null;
  toasts: { id: number; text: string; tone: 'info' | 'good' | 'bad' }[];
  go: (s: Screen, opts?: { replace?: boolean }) => void;
  goBack: () => void;
  startSession: (s: SessionConfig) => void;
  finish: (r: MatchResult) => void;
  toast: (text: string, tone?: 'info' | 'good' | 'bad') => void;
}

let toastId = 0;
export const useApp = create<AppStore>((set, get) => ({
  screen: 'splash',
  back: [],
  session: null,
  result: null,
  toasts: [],
  go: (s, opts) =>
    set((st) => ({ screen: s, back: opts?.replace ? st.back : [...st.back.slice(-12), st.screen] })),
  goBack: () => {
    const b = [...get().back];
    let prev = b.pop() ?? 'menu';
    while ((prev === 'game' || prev === 'splash' || prev === 'results') && b.length) prev = b.pop()!;
    if (prev === 'game' || prev === 'splash') prev = 'menu';
    set({ screen: prev, back: b });
  },
  startSession: (session) => set((st) => ({ session, screen: 'game', back: [...st.back, st.screen] })),
  finish: (result) => set({ result, screen: 'results' }),
  toast: (text, tone = 'info') => {
    const id = ++toastId;
    set((st) => ({ toasts: [...st.toasts.slice(-3), { id, text, tone }] }));
    setTimeout(() => set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) })), 3200);
  },
}));

// ───────────────────────────── HUD (written by the game controller) ─────────────────────────────

export interface HudPlayer {
  name: string;
  avatar: number;
  team: number;
  color: 'white' | 'black' | null;
  remaining: number;
  pocketed: number;
  controller: 'human' | 'ai' | 'remote';
  connected: boolean;
  side: number;
}

export interface HudNote {
  id: number;
  key: string;
  params?: Record<string, string | number>;
  tone: 'info' | 'good' | 'bad' | 'queen';
}

export interface HudState {
  players: HudPlayer[];
  turn: number;
  mySeat: number;
  scores: [number, number];
  boardPoints: [number, number];
  board: number;
  target: number;
  variant: 'standard' | 'freestyle';
  queen: 'board' | 'pending' | 'covered';
  queenTeam: number;
  clockMs: number | null;
  clockTotal: number;
  thinking: boolean;
  power: number;
  t: number;
  validPlacement: boolean;
  canShoot: boolean;
  phase: 'aim' | 'moving' | 'transition' | 'over' | 'replay' | 'waiting';
  notes: HudNote[];
  banner: { id: number; key: string; params?: Record<string, string | number> } | null;
  reactions: { id: number; seat: number; emoji: string }[];
  replayable: boolean;
  shotsThisBoard: number;
  tutorialStep: number;
  challenge: { shots: number; limit: number; left: number; done: boolean; failed: boolean } | null;
  coachBusy: boolean;
  network: 'ok' | 'reconnecting' | 'offline' | null;
  spectators: number;
}

export const initialHud: HudState = {
  players: [],
  turn: 0,
  mySeat: 0,
  scores: [0, 0],
  boardPoints: [0, 0],
  board: 1,
  target: 0,
  variant: 'standard',
  queen: 'board',
  queenTeam: -1,
  clockMs: null,
  clockTotal: 0,
  thinking: false,
  power: 0,
  t: 0,
  validPlacement: true,
  canShoot: false,
  phase: 'aim',
  notes: [],
  banner: null,
  reactions: [],
  replayable: false,
  shotsThisBoard: 0,
  tutorialStep: 0,
  challenge: null,
  coachBusy: false,
  network: null,
  spectators: 0,
};

export const useHud = create<HudState & { patch: (p: Partial<HudState>) => void }>((set) => ({
  ...initialHud,
  patch: (p) => set(p),
}));
