/** XP, levels, achievements and local rating. Cosmetic rewards only — no gameplay effect. */
import type { Difficulty } from '../core/ai';
import { MatchState, teamOf } from '../core/rules';
import { MatchSummary, Profile, SessionConfig, levelFor } from '../store/stores';

export const ACHIEVEMENTS = ['first_win', 'queen_cover', 'hat_trick', 'clean_win', 'expert_win', 'ten_wins', 'online_win', 'daily', 'tutorial', 'family_table', 'freestyle_100'] as const;
export type AchievementId = (typeof ACHIEVEMENTS)[number];

export const AI_RATING: Record<Difficulty, number> = { beginner: 850, easy: 1000, medium: 1200, hard: 1400, expert: 1650 };

export function elo(rating: number, opp: number, score: number, k = 32): number {
  const exp = 1 / (1 + 10 ** ((opp - rating) / 400));
  return Math.round(rating + k * (score - exp));
}

export interface Rewards {
  xp: number;
  achievements: AchievementId[];
  ratingDelta: number;
  patch: Partial<Profile>;
}

export function computeRewards(profile: Profile, session: SessionConfig, state: MatchState, ratingAfter?: number): Rewards {
  const myTeam = teamOf(session.mySeat);
  const mySeats = session.kind === 'local' ? state.stats.map((_, i) => i) : [session.mySeat];
  const stats = mySeats.map((s) => state.stats[s]).filter(Boolean);
  const pocketed = stats.reduce((a, s) => a + s.pocketed, 0);
  const queens = stats.reduce((a, s) => a + s.queens, 0);
  const fouls = stats.reduce((a, s) => a + s.fouls, 0);
  const best = Math.max(0, ...stats.map((s) => s.best));
  const won = session.kind === 'local' ? null : state.winner === -1 ? null : state.winner === myTeam;
  const diffMul = session.difficulty ? { beginner: 0.6, easy: 0.8, medium: 1, hard: 1.25, expert: 1.5 }[session.difficulty] : 1;
  let xp = 40 + pocketed * 3 + queens * 15;
  if (won) xp += 60;
  xp = Math.round(xp * (session.kind === 'ai' ? diffMul : session.kind === 'online' ? 1.4 : 1));

  const ach = new Set(profile.achievements);
  const fresh: AchievementId[] = [];
  const grant = (a: AchievementId) => {
    if (!ach.has(a)) {
      ach.add(a);
      fresh.push(a);
    }
  };
  const wins = profile.wins + (won ? 1 : 0);
  if (won) grant('first_win');
  if (queens > 0) grant('queen_cover');
  if (best >= 3) grant('hat_trick');
  if (won && fouls === 0) grant('clean_win');
  if (won && session.difficulty === 'expert' && session.kind === 'ai') grant('expert_win');
  if (wins >= 10) grant('ten_wins');
  if (won && session.kind === 'online') grant('online_win');
  if (session.kind === 'local' && session.seats === 4) grant('family_table');
  if (state.config.variant === 'freestyle' && state.boardPoints[myTeam] + 0 >= 100) grant('freestyle_100');

  let rating = profile.rating;
  if (session.kind === 'ai' && won !== null && session.difficulty) rating = elo(profile.rating, AI_RATING[session.difficulty], won ? 1 : 0, 24);
  if (session.kind === 'online' && ratingAfter !== undefined) rating = ratingAfter;

  const opponent =
    session.kind === 'local'
      ? session.players.map((p) => p.name).join(' · ')
      : session.players
          .filter((_, i) => teamOf(i) !== myTeam)
          .map((p) => p.name)
          .join(' & ');
  const summary: MatchSummary = { at: Date.now(), mode: session.kind, opponent, won, score: [state.scores[myTeam], state.scores[1 - myTeam]], difficulty: session.difficulty };
  const modes = { ...profile.modes, [session.kind]: (profile.modes[session.kind] ?? 0) + 1 };
  return {
    xp,
    achievements: fresh,
    ratingDelta: rating - profile.rating,
    patch: {
      xp: profile.xp + xp,
      matches: profile.matches + 1,
      wins,
      losses: profile.losses + (won === false ? 1 : 0),
      draws: profile.draws + (won === null && session.kind !== 'local' ? 1 : 0),
      rating,
      bestRating: Math.max(profile.bestRating, rating),
      modes,
      history: [summary, ...profile.history].slice(0, 40),
      achievements: [...ach],
      pocketed: profile.pocketed + pocketed,
      queens: profile.queens + queens,
    },
  };
}

export const favouriteMode = (p: Profile): string | null => {
  const e = Object.entries(p.modes).sort((a, b) => b[1] - a[1]);
  return e[0]?.[0] ?? null;
};

export { levelFor };
