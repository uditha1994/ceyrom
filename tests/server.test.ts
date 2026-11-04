import { describe, expect, it } from 'vitest';
import { GameServer } from '../server/game';
import { MemoryStore } from '../server/store';
import type { ServerMsg } from '../src/core/protocol';
import { PRESETS } from '../src/core/rules';

function client(server: GameServer) {
  const inbox: ServerMsg[] = [];
  let closed = false;
  const conn = server.connect({ send: (d) => inbox.push(JSON.parse(d)), close: () => (closed = true) });
  const send = (m: object) => server.handle(conn, JSON.stringify(m));
  const last = <T extends ServerMsg['type']>(type: T) => [...inbox].reverse().find((m) => m.type === type) as Extract<ServerMsg, { type: T }> | undefined;
  return { conn, inbox, send, last, get closed() { return closed; } };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setup(graceMs = 60000) {
  const server = new GameServer(new MemoryStore(), { secret: 'test-secret', graceMs, animSlackMs: 0, boardPauseMs: 0 });
  const a = client(server);
  const b = client(server);
  a.send({ type: 'hello', name: 'Amali', avatar: 1, country: 'LK' });
  b.send({ type: 'hello', name: 'Bilal', avatar: 2, country: 'LK' });
  a.send({ type: 'create', mode: '1v1', rules: { ...PRESETS.competitive, shotClock: 30 }, isPrivate: true });
  const code = a.last('room')!.room.code;
  b.send({ type: 'join', code });
  return { server, a, b, code };
}

describe('game server', () => {
  it('issues signed tokens and rejects forged ones', () => {
    const server = new GameServer(new MemoryStore(), { secret: 's' });
    const c = client(server);
    c.send({ type: 'hello', name: 'X', avatar: 0, country: 'LK' });
    const w = c.last('welcome')!;
    expect(server.verify(w.token)).toBe(w.profile.id);
    expect(server.verify(w.token.slice(0, -2) + 'aa')).toBeNull();
    expect(server.verify('0123456789abcdef.forged')).toBeNull();
  });

  it('creates and joins a private room, only the host can start', () => {
    const { a, b } = setup();
    expect(b.last('room')!.room.seats.filter((s) => s.playerId)).toHaveLength(2);
    b.send({ type: 'start' });
    expect(b.last('error')!.code).toBe('not_host');
    a.send({ type: 'start' });
    expect(a.last('start')).toBeTruthy();
    expect(b.last('start')!.state.turn).toBe(0);
  });

  it('validates turn ownership, rejects illegal shots and duplicate submissions', () => {
    const { a, b } = setup();
    a.send({ type: 'start' });
    b.send({ type: 'shoot', input: { t: 0, dx: 0, dy: 1, power: 0.5 }, seq: 1 });
    expect(b.last('error')!.code).toBe('not_your_turn');
    a.send({ type: 'shoot', input: { t: 0, dx: 0, dy: 1, power: 0.5 }, seq: 1 }); // backwards
    expect(a.last('error')!.code).toBe('invalid_shot');
    a.send({ type: 'shoot', input: { t: 0, dx: 0, dy: -1, power: 0.9 }, seq: 2 });
    const shot = b.last('shot')!;
    expect(shot.seat).toBe(0);
    const n = b.inbox.length;
    a.send({ type: 'shoot', input: { t: 0, dx: 0, dy: -1, power: 0.9 }, seq: 2 });
    expect(b.inbox.length).toBe(n); // replayed seq ignored
  });

  it('broadcasts the authoritative state that clients can reproduce', async () => {
    const { a, b } = setup();
    a.send({ type: 'start' });
    const start = b.last('start')!;
    a.send({ type: 'shoot', input: { t: 0.1, dx: 0.02, dy: -1, power: 1 }, seq: 1 });
    const shot = b.last('shot')!;
    const { playShot } = await import('../src/core/rules');
    const local = playShot(start.state, shot.input);
    expect(JSON.stringify(local.state.coins)).toBe(JSON.stringify(shot.state.coins));
  });

  it('lets a disconnected player resume, then forfeits after the grace period', async () => {
    const { server, a, b, code } = setup(80);
    a.send({ type: 'start' });
    server.disconnect(b.conn);
    expect(a.last('presence')).toMatchObject({ seat: 1, connected: false });
    const b2 = client(server);
    b2.send({ type: 'hello', token: b.last('welcome')!.token, name: 'Bilal', avatar: 2, country: 'LK' });
    b2.send({ type: 'resume', code });
    expect(b2.last('state')).toBeTruthy();
    expect(a.last('presence')).toMatchObject({ seat: 1, connected: true });
    server.disconnect(b2.conn);
    await wait(150);
    const over = a.last('over')!;
    expect(over.forfeit).toBe(true);
    expect(over.winner).toBe(0);
    const id = a.last('welcome')!.profile.id;
    expect(over.ratings[id].after).toBeGreaterThan(over.ratings[id].before);
    expect(server.leaderboard('global')[0].id).toBe(id);
  });

  it('pairs quick-match players', () => {
    const server = new GameServer(new MemoryStore(), { secret: 's' });
    const a = client(server);
    const b = client(server);
    a.send({ type: 'hello', name: 'A', avatar: 0, country: 'LK' });
    b.send({ type: 'hello', name: 'B', avatar: 0, country: 'IN' });
    a.send({ type: 'quick', mode: '1v1' });
    expect(a.last('queue')!.waiting).toBe(1);
    b.send({ type: 'quick', mode: '1v1' });
    expect(a.last('start')).toBeTruthy();
    expect(b.last('start')!.room.seats.every((s) => s.playerId)).toBe(true);
  });

  it('rate-limits floods', () => {
    const server = new GameServer(new MemoryStore(), { secret: 's' });
    const a = client(server);
    a.send({ type: 'hello', name: 'A', avatar: 0, country: 'LK' });
    for (let i = 0; i < 120; i++) a.send({ type: 'ping', t: i });
    expect(a.inbox.some((m) => m.type === 'error' && m.code === 'rate_limited')).toBe(true);
  });
});
