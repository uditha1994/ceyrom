/** Wire protocol shared by the browser client and the authoritative server. */
import type { MatchState, RuleConfig, ShotInput, ShotOutcome } from './rules';

export type RoomMode = '1v1' | '2v2';

export interface SeatInfo {
  seat: number;
  playerId: string | null;
  name: string;
  avatar: number;
  rating: number;
  connected: boolean;
}

export interface RoomInfo {
  code: string;
  mode: RoomMode;
  rules: RuleConfig;
  isPrivate: boolean;
  hostId: string;
  seats: SeatInfo[];
  spectators: number;
  status: 'waiting' | 'playing' | 'finished';
  rematch: string[];
}

export interface PublicProfile {
  id: string;
  name: string;
  avatar: number;
  country: string;
  rating: number;
  bestRating: number;
  wins: number;
  losses: number;
  matches: number;
}

export type ClientMsg =
  | { type: 'hello'; token?: string; name: string; avatar: number; country: string }
  | { type: 'create'; mode: RoomMode; rules: RuleConfig; isPrivate: boolean }
  | { type: 'join'; code: string; spectate?: boolean }
  | { type: 'quick'; mode: RoomMode }
  | { type: 'cancelQuick' }
  | { type: 'leave' }
  | { type: 'start' }
  | { type: 'preview'; t: number; dx: number; dy: number; power: number }
  | { type: 'shoot'; input: ShotInput; seq: number }
  | { type: 'chat'; text: string }
  | { type: 'emoji'; emoji: string }
  | { type: 'rematch' }
  | { type: 'resume'; code: string }
  | { type: 'ping'; t: number };

export type ServerMsg =
  | { type: 'welcome'; token: string; profile: PublicProfile }
  | { type: 'error'; code: string }
  | { type: 'room'; room: RoomInfo; you: { seat: number; spectator: boolean } }
  | { type: 'queue'; mode: RoomMode; waiting: number }
  | { type: 'start'; room: RoomInfo; state: MatchState; turnMs: number | null }
  | { type: 'state'; state: MatchState; turnMs: number | null }
  | { type: 'preview'; seat: number; t: number; dx: number; dy: number; power: number }
  | { type: 'shot'; seat: number; seq: number; input: ShotInput; before: string; state: MatchState; outcome: ShotOutcome; turnMs: number | null }
  | { type: 'timeout'; state: MatchState; outcome: ShotOutcome; turnMs: number | null }
  | { type: 'chat'; seat: number; name: string; text: string }
  | { type: 'emoji'; seat: number; emoji: string }
  | { type: 'presence'; seat: number; connected: boolean; graceMs: number }
  | { type: 'over'; state: MatchState; winner: number; forfeit: boolean; ratings: Record<string, { before: number; after: number }> }
  | { type: 'pong'; t: number; server: number };

export const EMOJIS = ['👏', '🔥', '😮', '😅', '🙏', '🎯'] as const;

/** Cheap, stable digest of coin positions (lets clients detect desyncs). */
export function stateDigest(s: MatchState): string {
  let h = 2166136261;
  const str = s.coins.map((c) => `${c.id}:${c.on ? 1 : 0}:${c.x.toFixed(3)}:${c.y.toFixed(3)}`).join('|') + `#${s.turn}#${s.shotNo}`;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
