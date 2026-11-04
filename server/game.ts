/**
 * Ceyrom authoritative game server: identities, rooms, matchmaking, turn clocks,
 * shot validation and simulation, reconnection, ratings and results.
 * Transport-agnostic: anything with send()/close() can be a connection.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PHYS } from '../src/core/constants';
import { EMOJIS, stateDigest } from '../src/core/protocol';
import type { ClientMsg, PublicProfile, RoomInfo, RoomMode, ServerMsg } from '../src/core/protocol';
import { MatchState, PRESETS, RuleConfig, createMatch, nextBoard, playShot, resolveTimeout, teamOf, validateShot } from '../src/core/rules';
import type { PlayerRecord, Store } from './store';

export interface Socket {
  send(data: string): void;
  close(code?: number): void;
}

interface Conn {
  sock: Socket;
  id: string | null;
  room: Room | null;
  spectator: boolean;
  tokens: number;
  lastRefill: number;
  lastChat: number;
  invalid: number;
  queued: RoomMode | null;
}

interface Seat {
  playerId: string | null;
  name: string;
  avatar: number;
  rating: number;
  conn: Conn | null;
  connected: boolean;
  grace: NodeJS.Timeout | null;
  lastSeq: number;
}

interface Room {
  code: string;
  mode: RoomMode;
  rules: RuleConfig;
  isPrivate: boolean;
  hostId: string;
  seats: Seat[];
  spectators: Set<Conn>;
  status: 'waiting' | 'playing' | 'finished';
  state: MatchState | null;
  matchId: string;
  turnTimer: NodeJS.Timeout | null;
  deadline: number;
  boardTimer: NodeJS.Timeout | null;
  rematch: Set<string>;
  createdAt: number;
  finished: boolean;
}

export interface ServerOptions {
  secret: string;
  graceMs?: number;
  /** Extra time allowed after a shot for clients to animate it. */
  animSlackMs?: number;
  boardPauseMs?: number;
  now?: () => number;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const clean = (s: unknown, max: number) =>
  String(s ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, max);

export class GameServer {
  rooms = new Map<string, Room>();
  queues: Record<RoomMode, Conn[]> = { '1v1': [], '2v2': [] };
  conns = new Set<Conn>();
  private graceMs: number;
  private animSlack: number;
  private boardPause: number;
  private now: () => number;

  constructor(
    private store: Store,
    private opts: ServerOptions,
  ) {
    this.graceMs = opts.graceMs ?? 60000;
    this.animSlack = opts.animSlackMs ?? 1500;
    this.boardPause = opts.boardPauseMs ?? 2800;
    this.now = opts.now ?? Date.now;
  }

  // ───────────────────────────── identity ─────────────────────────────

  sign(id: string): string {
    const mac = createHmac('sha256', this.opts.secret).update(id).digest('base64url');
    return `${id}.${mac}`;
  }

  verify(token: string | undefined): string | null {
    if (!token || typeof token !== 'string') return null;
    const [id, mac] = token.split('.');
    if (!id || !mac || !/^[a-f0-9]{16}$/.test(id)) return null;
    const good = createHmac('sha256', this.opts.secret).update(id).digest('base64url');
    const a = Buffer.from(mac);
    const b = Buffer.from(good);
    return a.length === b.length && timingSafeEqual(a, b) ? id : null;
  }

  publicProfile(p: PlayerRecord): PublicProfile {
    const { id, name, avatar, country, rating, bestRating, wins, losses, matches } = p;
    return { id, name, avatar, country, rating, bestRating, wins, losses, matches };
  }

  // ───────────────────────────── connections ─────────────────────────────

  connect(sock: Socket): Conn {
    const c: Conn = { sock, id: null, room: null, spectator: false, tokens: 40, lastRefill: this.now(), lastChat: 0, invalid: 0, queued: null };
    this.conns.add(c);
    return c;
  }

  send(c: Conn | null, m: ServerMsg): void {
    if (!c) return;
    try {
      c.sock.send(JSON.stringify(m));
    } catch {
      /* socket gone */
    }
  }

  private broadcast(room: Room, m: ServerMsg, except?: Conn): void {
    const data = JSON.stringify(m);
    for (const s of room.seats) if (s.conn && s.conn !== except) safeSend(s.conn, data);
    for (const c of room.spectators) if (c !== except) safeSend(c, data);
  }

  private rateOk(c: Conn): boolean {
    const t = this.now();
    c.tokens = Math.min(60, c.tokens + ((t - c.lastRefill) / 1000) * 30);
    c.lastRefill = t;
    if (c.tokens < 1) return false;
    c.tokens -= 1;
    return true;
  }

  handle(c: Conn, raw: string): void {
    if (raw.length > 8000) return c.sock.close(1009);
    let m: ClientMsg;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (!m || typeof m !== 'object' || typeof m.type !== 'string') return;
    if (!this.rateOk(c)) return this.send(c, { type: 'error', code: 'rate_limited' });
    if (m.type !== 'hello' && m.type !== 'ping' && !c.id) return this.send(c, { type: 'error', code: 'generic' });
    switch (m.type) {
      case 'hello':
        return this.hello(c, m);
      case 'ping':
        return this.send(c, { type: 'pong', t: Number(m.t) || 0, server: this.now() });
      case 'create':
        return this.create(c, m.mode, m.rules, m.isPrivate !== false);
      case 'join':
        return this.join(c, clean(m.code, 6).toUpperCase(), !!m.spectate);
      case 'resume':
        return this.resume(c, clean(m.code, 6).toUpperCase());
      case 'quick':
        return this.quick(c, m.mode);
      case 'cancelQuick':
        return this.dequeue(c);
      case 'leave':
        return this.leave(c);
      case 'start':
        return this.startRequest(c);
      case 'preview':
        return this.preview(c, m);
      case 'shoot':
        return this.shoot(c, m.input, Number(m.seq));
      case 'chat':
        return this.chat(c, m.text);
      case 'emoji':
        return this.emoji(c, m.emoji);
      case 'rematch':
        return this.rematch(c);
    }
  }

  disconnect(c: Conn): void {
    this.conns.delete(c);
    this.dequeue(c);
    const room = c.room;
    if (!room) return;
    if (c.spectator) {
      room.spectators.delete(c);
      this.sendRoom(room);
      return;
    }
    const seat = room.seats.find((s) => s.conn === c);
    if (!seat) return;
    seat.conn = null;
    seat.connected = false;
    const idx = room.seats.indexOf(seat);
    this.broadcast(room, { type: 'presence', seat: idx, connected: false, graceMs: this.graceMs });
    this.sendRoom(room);
    if (seat.grace) clearTimeout(seat.grace);
    seat.grace = setTimeout(() => this.graceExpired(room, idx), this.graceMs);
  }

  private graceExpired(room: Room, idx: number): void {
    const seat = room.seats[idx];
    seat.grace = null;
    if (seat.connected) return;
    if (room.status === 'playing' && room.state) {
      this.finish(room, 1 - teamOf(idx), true);
    } else if (room.status === 'waiting') {
      room.seats[idx] = emptySeat();
      if (room.hostId === seat.playerId) room.hostId = room.seats.find((s) => s.playerId)?.playerId ?? '';
      if (room.seats.every((s) => !s.playerId) && room.spectators.size === 0) this.closeRoom(room);
      else this.sendRoom(room);
    }
  }

  private hello(c: Conn, m: Extract<ClientMsg, { type: 'hello' }>): void {
    let id = this.verify(m.token);
    let p = id ? this.store.getPlayer(id) : undefined;
    const name = clean(m.name, 18) || 'Player';
    const avatar = Math.max(0, Math.min(7, Number(m.avatar) | 0));
    const country = /^[A-Z]{2}$|^OTHER$/.test(String(m.country)) ? String(m.country) : 'LK';
    if (!p) {
      id = randomBytes(8).toString('hex');
      p = { id, name, avatar, country, rating: 1200, bestRating: 1200, wins: 0, losses: 0, matches: 0, createdAt: this.now(), lastSeen: this.now(), history: [], friends: [] };
    }
    p.name = name;
    p.avatar = avatar;
    p.country = country;
    p.lastSeen = this.now();
    this.store.savePlayer(p);
    c.id = p.id;
    this.send(c, { type: 'welcome', token: this.sign(p.id), profile: this.publicProfile(p) });
  }

  // ───────────────────────────── rooms ─────────────────────────────

  private newCode(): string {
    for (let k = 0; k < 100; k++) {
      let code = '';
      const bytes = randomBytes(4);
      for (let i = 0; i < 4; i++) code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
      if (!this.rooms.has(code)) return code;
    }
    return randomBytes(3).toString('hex').toUpperCase();
  }

  private sanitizeRules(r: Partial<RuleConfig> | undefined): RuleConfig {
    const base = PRESETS[(r?.preset as keyof typeof PRESETS) ?? 'competitive'] ?? PRESETS.competitive;
    const out: RuleConfig = { ...base };
    if (r && r.variant === 'standard' && base.variant === 'standard') {
      if (typeof r.queenNeedsOwnCoin === 'boolean') out.queenNeedsOwnCoin = r.queenNeedsOwnCoin;
      if (typeof r.strikerPenalty === 'boolean') out.strikerPenalty = r.strikerPenalty;
      if ([0, 13, 25].includes(Number(r.targetPoints))) out.targetPoints = Number(r.targetPoints);
      if (r.preset === 'custom') out.preset = 'custom';
    }
    const clock = Number(r?.shotClock);
    out.shotClock = [20, 30, 45, 60].includes(clock) ? clock : 30;
    return out;
  }

  private makeRoom(mode: RoomMode, rules: RuleConfig, isPrivate: boolean, hostId: string): Room {
    const room: Room = {
      code: this.newCode(),
      mode,
      rules,
      isPrivate,
      hostId,
      seats: Array.from({ length: mode === '2v2' ? 4 : 2 }, emptySeat),
      spectators: new Set(),
      status: 'waiting',
      state: null,
      matchId: '',
      turnTimer: null,
      deadline: 0,
      boardTimer: null,
      rematch: new Set(),
      createdAt: this.now(),
      finished: false,
    };
    this.rooms.set(room.code, room);
    return room;
  }

  private create(c: Conn, mode: RoomMode, rules: RuleConfig, isPrivate: boolean): void {
    if (mode !== '1v1' && mode !== '2v2') return this.send(c, { type: 'error', code: 'generic' });
    this.leave(c);
    const room = this.makeRoom(mode, this.sanitizeRules(rules), isPrivate, c.id!);
    this.seat(c, room, 0);
  }

  private seat(c: Conn, room: Room, idx: number): void {
    const p = this.store.getPlayer(c.id!)!;
    const s = room.seats[idx];
    if (s.grace) clearTimeout(s.grace);
    room.seats[idx] = { playerId: p.id, name: p.name, avatar: p.avatar, rating: p.rating, conn: c, connected: true, grace: null, lastSeq: s.playerId === p.id ? s.lastSeq : 0 };
    c.room = room;
    c.spectator = false;
    this.sendRoom(room);
  }

  private join(c: Conn, code: string, spectate: boolean): void {
    const room = this.rooms.get(code);
    if (!room) return this.send(c, { type: 'error', code: 'room_not_found' });
    // returning player?
    const mine = room.seats.findIndex((s) => s.playerId === c.id);
    if (mine >= 0) return this.resume(c, code);
    if (c.room && c.room !== room) this.leave(c);
    const free = room.seats.findIndex((s) => !s.playerId);
    if (spectate || free < 0 || room.status !== 'waiting') {
      if (!spectate && (free < 0 || room.status !== 'waiting')) return this.send(c, { type: 'error', code: 'room_full' });
      room.spectators.add(c);
      c.room = room;
      c.spectator = true;
      this.sendRoom(room);
      if (room.state && room.status === 'playing') this.send(c, { type: 'start', room: this.info(room), state: room.state, turnMs: this.turnLeft(room) });
      return;
    }
    this.seat(c, room, free);
  }

  private resume(c: Conn, code: string): void {
    const room = this.rooms.get(code);
    if (!room) return this.send(c, { type: 'error', code: 'room_not_found' });
    const idx = room.seats.findIndex((s) => s.playerId === c.id);
    if (idx < 0) return this.send(c, { type: 'error', code: 'room_not_found' });
    const seat = room.seats[idx];
    if (seat.conn && seat.conn !== c) {
      // older tab: replace it
      const old = seat.conn;
      old.room = null;
      old.sock.close(4000);
    }
    if (seat.grace) clearTimeout(seat.grace);
    seat.grace = null;
    seat.conn = c;
    seat.connected = true;
    c.room = room;
    c.spectator = false;
    this.broadcast(room, { type: 'presence', seat: idx, connected: true, graceMs: 0 }, c);
    this.sendRoom(room);
    if (room.state && room.status === 'playing') this.send(c, { type: 'state', state: room.state, turnMs: this.turnLeft(room) });
  }

  private leave(c: Conn): void {
    this.dequeue(c);
    const room = c.room;
    if (!room) return;
    if (c.spectator) {
      room.spectators.delete(c);
      c.room = null;
      this.sendRoom(room);
      return;
    }
    const idx = room.seats.findIndex((s) => s.conn === c);
    c.room = null;
    if (idx < 0) return;
    if (room.status === 'playing') {
      // a deliberate leave mid-match behaves like a disconnect: grace, then forfeit
      const seat = room.seats[idx];
      seat.conn = null;
      seat.connected = false;
      this.broadcast(room, { type: 'presence', seat: idx, connected: false, graceMs: this.graceMs });
      if (seat.grace) clearTimeout(seat.grace);
      seat.grace = setTimeout(() => this.graceExpired(room, idx), this.graceMs);
      return;
    }
    room.seats[idx] = emptySeat();
    if (room.hostId === c.id) room.hostId = room.seats.find((s) => s.playerId)?.playerId ?? '';
    if (room.seats.every((s) => !s.playerId)) this.closeRoom(room);
    else this.sendRoom(room);
  }

  private closeRoom(room: Room): void {
    if (room.turnTimer) clearTimeout(room.turnTimer);
    if (room.boardTimer) clearTimeout(room.boardTimer);
    for (const s of room.seats) if (s.grace) clearTimeout(s.grace);
    for (const c of room.spectators) c.room = null;
    this.rooms.delete(room.code);
  }

  info(room: Room): RoomInfo {
    return {
      code: room.code,
      mode: room.mode,
      rules: room.rules,
      isPrivate: room.isPrivate,
      hostId: room.hostId,
      seats: room.seats.map((s, seat) => ({ seat, playerId: s.playerId, name: s.name, avatar: s.avatar, rating: s.rating, connected: s.connected })),
      spectators: room.spectators.size,
      status: room.status,
      rematch: [...room.rematch],
    };
  }

  private sendRoom(room: Room): void {
    const info = this.info(room);
    room.seats.forEach((s, seat) => s.conn && this.send(s.conn, { type: 'room', room: info, you: { seat, spectator: false } }));
    for (const c of room.spectators) this.send(c, { type: 'room', room: info, you: { seat: -1, spectator: true } });
  }

  // ───────────────────────────── matchmaking ─────────────────────────────

  private quick(c: Conn, mode: RoomMode): void {
    if (mode !== '1v1' && mode !== '2v2') return;
    this.leave(c);
    this.dequeue(c);
    const q = this.queues[mode];
    // one entry per player
    for (const other of q) if (other.id === c.id) this.dequeue(other);
    q.push(c);
    c.queued = mode;
    const need = mode === '2v2' ? 4 : 2;
    if (q.length >= need) {
      // pair players with the closest ratings first
      const rating = (k: Conn) => this.store.getPlayer(k.id!)?.rating ?? 1200;
      const group = q.splice(0, need).sort((a, b) => rating(b) - rating(a));
      const ordered = mode === '2v2' ? [group[0], group[1], group[3], group[2]] : group;
      const room = this.makeRoom(mode, { ...PRESETS.competitive, targetPoints: 0, preset: 'casual', shotClock: 30 }, false, ordered[0].id!);
      ordered.forEach((k, i) => {
        k.queued = null;
        this.seat(k, room, i);
      });
      this.startMatch(room);
    } else {
      for (const k of q) this.send(k, { type: 'queue', mode, waiting: q.length });
    }
  }

  private dequeue(c: Conn): void {
    if (!c.queued) return;
    const q = this.queues[c.queued];
    const i = q.indexOf(c);
    if (i >= 0) q.splice(i, 1);
    for (const k of q) this.send(k, { type: 'queue', mode: c.queued, waiting: q.length });
    c.queued = null;
  }

  // ───────────────────────────── match flow ─────────────────────────────

  private startRequest(c: Conn): void {
    const room = c.room;
    if (!room || c.spectator) return;
    if (room.hostId !== c.id) return this.send(c, { type: 'error', code: 'not_host' });
    if (room.status === 'playing') return;
    if (room.seats.some((s) => !s.playerId)) return this.send(c, { type: 'error', code: 'not_ready' });
    this.startMatch(room);
  }

  private startMatch(room: Room): void {
    room.state = createMatch(room.rules, room.mode === '2v2' ? 4 : 2, randomBytes(4).readUInt32LE(0) & 0x7fffffff);
    room.status = 'playing';
    room.finished = false;
    room.rematch.clear();
    room.matchId = randomBytes(8).toString('hex');
    for (const s of room.seats) s.lastSeq = 0;
    this.armClock(room, 600);
    this.broadcast(room, { type: 'start', room: this.info(room), state: room.state, turnMs: this.turnLeft(room) });
  }

  private clockMs(room: Room): number {
    return (room.rules.shotClock || 60) * 1000;
  }

  private armClock(room: Room, extraMs: number): void {
    if (room.turnTimer) clearTimeout(room.turnTimer);
    const ms = this.clockMs(room) + extraMs;
    room.deadline = this.now() + ms;
    room.turnTimer = setTimeout(() => this.timeout(room), ms);
  }

  turnLeft(room: Room): number | null {
    if (room.status !== 'playing') return null;
    return Math.max(0, room.deadline - this.now());
  }

  private timeout(room: Room): void {
    room.turnTimer = null;
    if (!room.state || room.status !== 'playing' || room.state.phase !== 'aiming') return;
    const outcome = resolveTimeout(room.state);
    this.armClock(room, 400);
    this.broadcast(room, { type: 'timeout', state: room.state, outcome, turnMs: this.turnLeft(room) });
  }

  private seatOf(c: Conn): number {
    const room = c.room;
    if (!room || c.spectator) return -1;
    return room.seats.findIndex((s) => s.conn === c);
  }

  private preview(c: Conn, m: Extract<ClientMsg, { type: 'preview' }>): void {
    const room = c.room;
    const seat = this.seatOf(c);
    if (!room?.state || seat < 0 || room.state.turn !== seat) return;
    const num = (v: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number(v) || 0));
    this.broadcast(room, { type: 'preview', seat, t: num(m.t, -1, 1), dx: num(m.dx, -1, 1), dy: num(m.dy, -1, 1), power: num(m.power, 0, 1) }, c);
  }

  shoot(c: Conn, input: unknown, seq: number): void {
    const room = c.room;
    const seat = this.seatOf(c);
    if (!room || !room.state || room.status !== 'playing') return this.send(c, { type: 'error', code: 'invalid_shot' });
    if (seat < 0 || room.state.turn !== seat) {
      this.send(c, { type: 'error', code: 'not_your_turn' });
      this.send(c, { type: 'state', state: room.state, turnMs: this.turnLeft(room) });
      return;
    }
    const s = room.seats[seat];
    if (!Number.isInteger(seq) || seq <= s.lastSeq) return; // duplicate or replayed submission
    const shot = input as { t: number; dx: number; dy: number; power: number };
    const err = shot && typeof shot === 'object' ? validateShot(room.state, { t: shot.t, dx: shot.dx, dy: shot.dy, power: shot.power }) : 'input';
    if (err) {
      c.invalid++;
      this.send(c, { type: 'error', code: 'invalid_shot' });
      this.send(c, { type: 'state', state: room.state, turnMs: this.turnLeft(room) });
      if (c.invalid > 12) c.sock.close(4002); // persistent garbage: drop the client
      return;
    }
    s.lastSeq = seq;
    const clean = { t: Number(shot.t), dx: Number(shot.dx), dy: Number(shot.dy), power: Number(shot.power) };
    const before = stateDigest(room.state);
    const { state, outcome, world } = playShot(room.state, clean);
    room.state = state;
    const animMs = world.steps * PHYS.dt * 1000 + this.animSlack;
    if (outcome.matchOver) {
      if (room.turnTimer) clearTimeout(room.turnTimer);
      room.turnTimer = null;
      this.broadcast(room, { type: 'shot', seat, seq, input: clean, before, state, outcome, turnMs: null });
      setTimeout(() => this.finish(room, state.winner, false), Math.min(animMs, 15000));
      return;
    }
    if (outcome.boardOver) {
      if (room.turnTimer) clearTimeout(room.turnTimer);
      room.turnTimer = null;
      this.broadcast(room, { type: 'shot', seat, seq, input: clean, before, state, outcome, turnMs: null });
      room.boardTimer = setTimeout(() => {
        room.boardTimer = null;
        if (!room.state || room.status !== 'playing') return;
        nextBoard(room.state);
        this.armClock(room, 600);
        this.broadcast(room, { type: 'state', state: room.state, turnMs: this.turnLeft(room) });
      }, animMs + this.boardPause);
      return;
    }
    this.armClock(room, animMs);
    this.broadcast(room, { type: 'shot', seat, seq, input: clean, before, state, outcome, turnMs: this.turnLeft(room) });
  }

  private chat(c: Conn, text: unknown): void {
    const room = c.room;
    if (!room) return;
    const t = this.now();
    if (t - c.lastChat < 700) return this.send(c, { type: 'error', code: 'rate_limited' });
    c.lastChat = t;
    const msg = clean(text, 140);
    if (!msg) return;
    const p = this.store.getPlayer(c.id!);
    this.broadcast(room, { type: 'chat', seat: this.seatOf(c), name: p?.name ?? 'Player', text: msg });
  }

  private emoji(c: Conn, e: unknown): void {
    const room = c.room;
    if (!room || !(EMOJIS as readonly string[]).includes(String(e))) return;
    const t = this.now();
    if (t - c.lastChat < 400) return;
    c.lastChat = t;
    this.broadcast(room, { type: 'emoji', seat: this.seatOf(c), emoji: String(e) }, c);
  }

  private rematch(c: Conn): void {
    const room = c.room;
    if (!room || c.spectator || room.status !== 'finished') return;
    room.rematch.add(c.id!);
    this.sendRoom(room);
    if (room.seats.every((s) => s.playerId && room.rematch.has(s.playerId) && s.connected)) this.startMatch(room);
  }

  // ───────────────────────────── results ─────────────────────────────

  finish(room: Room, winner: number, forfeit: boolean): void {
    if (room.finished || !room.state) return; // results are recorded exactly once
    room.finished = true;
    room.status = 'finished';
    if (room.turnTimer) clearTimeout(room.turnTimer);
    if (room.boardTimer) clearTimeout(room.boardTimer);
    room.turnTimer = room.boardTimer = null;
    const state = room.state;
    if (forfeit) {
      state.winner = winner;
      state.phase = 'matchOver';
    }
    const ids = room.seats.map((s) => s.playerId!);
    const players = ids.map((id) => this.store.getPlayer(id)!).filter(Boolean);
    const ratings: Record<string, { before: number; after: number }> = {};
    if (players.length === ids.length && !this.store.hasMatch(room.matchId)) {
      const teamAvg = (t: number) => {
        const r = players.filter((_, i) => teamOf(i) === t).map((p) => p.rating);
        return r.reduce((a, b) => a + b, 0) / r.length;
      };
      players.forEach((p, i) => {
        const team = teamOf(i);
        const score = winner === -1 ? 0.5 : winner === team ? 1 : 0;
        const exp = 1 / (1 + 10 ** ((teamAvg(1 - team) - teamAvg(team)) / 400));
        const k = p.matches < 20 ? 40 : 24;
        const after = Math.round(p.rating + k * (score - exp));
        ratings[p.id] = { before: p.rating, after };
        p.rating = after;
        p.bestRating = Math.max(p.bestRating, after);
        p.matches++;
        if (score === 1) p.wins++;
        else if (score === 0) p.losses++;
        p.history = [{ at: this.now(), match: room.matchId, won: score === 0.5 ? null : score === 1, delta: after - ratings[p.id].before }, ...p.history].slice(0, 200);
        for (const other of ids) if (other !== p.id && !p.friends.includes(other)) p.friends.push(other);
        p.friends = p.friends.slice(-200);
        this.store.savePlayer(p);
      });
      this.store.saveMatch({ id: room.matchId, at: this.now(), mode: room.mode, preset: room.rules.preset, players: ids, winner, scores: [...state.scores] as [number, number], forfeit });
      room.seats.forEach((s) => (s.rating = ratings[s.playerId!]?.after ?? s.rating));
    }
    this.broadcast(room, { type: 'over', state, winner, forfeit, ratings });
    this.sendRoom(room);
  }

  // ───────────────────────────── leaderboard ─────────────────────────────

  leaderboard(scope: string, me?: string): (PublicProfile & { rank: number })[] {
    let list = this.store.allPlayers().filter((p) => p.matches > 0);
    const window = scope === 'weekly' ? 7 : scope === 'monthly' ? 30 : 0;
    if (scope === 'lk') list = list.filter((p) => p.country === 'LK');
    if (scope === 'friends') {
      const mine = me ? this.store.getPlayer(me) : undefined;
      const set = new Set([...(mine?.friends ?? []), me]);
      list = list.filter((p) => set.has(p.id));
    }
    let rows: (PlayerRecord & { score: number })[];
    if (window) {
      const since = this.now() - window * 86400000;
      rows = list
        .map((p) => {
          const recent = p.history.filter((h) => h.at >= since);
          return { ...p, score: recent.reduce((a, h) => a + h.delta, 0) + recent.filter((h) => h.won).length * 0.01, wins: recent.filter((h) => h.won).length, matches: recent.length };
        })
        .filter((p) => p.matches > 0);
    } else rows = list.map((p) => ({ ...p, score: p.rating }));
    rows.sort((a, b) => b.score - a.score);
    return rows.slice(0, 50).map((p, i) => ({ ...this.publicProfile(p), rank: i + 1 }));
  }

  stats() {
    return { rooms: this.rooms.size, connections: this.conns.size, queued: { '1v1': this.queues['1v1'].length, '2v2': this.queues['2v2'].length } };
  }
}

function emptySeat(): Seat {
  return { playerId: null, name: '', avatar: 0, rating: 0, conn: null, connected: false, grace: null, lastSeq: 0 };
}

function safeSend(c: Conn, data: string) {
  try {
    c.sock.send(data);
  } catch {
    /* ignore */
  }
}
