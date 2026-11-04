/**
 * Persistence. A small JSON-file store behind a repository interface; swap `JsonStore`
 * for a PostgreSQL implementation without touching the game server.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PublicProfile } from '../src/core/protocol';

export interface PlayerRecord extends PublicProfile {
  createdAt: number;
  lastSeen: number;
  history: { at: number; match: string; won: boolean | null; delta: number }[];
  friends: string[];
}

export interface MatchRecord {
  id: string;
  at: number;
  mode: string;
  preset: string;
  players: string[];
  winner: number;
  scores: [number, number];
  forfeit: boolean;
}

export interface Store {
  getPlayer(id: string): PlayerRecord | undefined;
  savePlayer(p: PlayerRecord): void;
  allPlayers(): PlayerRecord[];
  hasMatch(id: string): boolean;
  saveMatch(m: MatchRecord): void;
  flush(): void;
}

export class JsonStore implements Store {
  private players = new Map<string, PlayerRecord>();
  private matches = new Map<string, MatchRecord>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private file: string) {
    try {
      if (existsSync(file)) {
        const data = JSON.parse(readFileSync(file, 'utf8')) as { players: PlayerRecord[]; matches: MatchRecord[] };
        for (const p of data.players ?? []) this.players.set(p.id, p);
        for (const m of data.matches ?? []) this.matches.set(m.id, m);
      }
    } catch (e) {
      console.error('[store] could not read', file, e);
    }
  }

  getPlayer(id: string) {
    return this.players.get(id);
  }

  savePlayer(p: PlayerRecord) {
    this.players.set(p.id, p);
    this.schedule();
  }

  allPlayers() {
    return [...this.players.values()];
  }

  hasMatch(id: string) {
    return this.matches.has(id);
  }

  saveMatch(m: MatchRecord) {
    this.matches.set(m.id, m);
    this.schedule();
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 1500);
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      const recent = [...this.matches.values()].sort((a, b) => b.at - a.at).slice(0, 5000);
      writeFileSync(tmp, JSON.stringify({ players: [...this.players.values()], matches: recent }));
      renameSync(tmp, this.file);
    } catch (e) {
      console.error('[store] write failed', e);
    }
  }
}

export class MemoryStore extends JsonStore {
  constructor() {
    super('/dev/null/none');
  }
  flush() {
    /* in-memory only (tests) */
  }
}
