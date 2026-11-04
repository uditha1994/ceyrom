/**
 * Ceyrom server entry: static hosting for the built client, a small JSON API,
 * and the WebSocket endpoint at /ws.
 *
 *   PORT=8787 CEYROM_DATA=./data CEYROM_SECRET=... node dist-server/server.mjs
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { GameServer } from './game';
import { JsonStore } from './store';

const PORT = Number(process.env.PORT ?? 8787);
const DATA = resolve(process.env.CEYROM_DATA ?? './data');
const here = fileURLToPath(new URL('.', import.meta.url));
const STATIC = resolve(process.env.CEYROM_STATIC ?? join(here, '..', 'dist'));
const ORIGINS = (process.env.CEYROM_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

function secret(): string {
  if (process.env.CEYROM_SECRET) return process.env.CEYROM_SECRET;
  const file = join(DATA, 'secret.key');
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    mkdirSync(DATA, { recursive: true });
    const s = randomBytes(32).toString('hex');
    writeFileSync(file, s, { mode: 0o600 });
    return s;
  }
}

const store = new JsonStore(join(DATA, 'ceyrom-db.json'));
const game = new GameServer(store, { secret: secret() });

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const cors = (origin: string | undefined) => {
  if (!origin) return {};
  if (ORIGINS.length === 0 || ORIGINS.includes(origin)) return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
  return {};
};

const http = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const headers = { 'X-Content-Type-Options': 'nosniff', ...cors(req.headers.origin) };
  if (url.pathname === '/api/health') {
    res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, ...game.stats() }));
  }
  if (url.pathname === '/api/leaderboard') {
    const scope = url.searchParams.get('scope') ?? 'global';
    const me = url.searchParams.get('me') ?? undefined;
    res.writeHead(200, { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'max-age=15' });
    return res.end(JSON.stringify({ rows: game.leaderboard(scope, me) }));
  }
  // static client (SPA fallback to index.html)
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path.endsWith('/')) path += 'index.html';
  let file = join(STATIC, path);
  if (!file.startsWith(STATIC) || !existsSync(file) || statSync(file).isDirectory()) file = join(STATIC, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404, headers);
    return res.end('Ceyrom server is running. Build the client with `npm run build` to serve it here.');
  }
  const immutable = file.includes(`${join(STATIC, 'assets')}`);
  res.writeHead(200, { ...headers, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
  res.end(readFileSync(file));
});

const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 16 * 1024 });
wss.on('connection', (ws, req) => {
  const origin = req.headers.origin;
  if (ORIGINS.length && origin && !ORIGINS.includes(origin)) return ws.close(4003);
  const conn = game.connect({ send: (d) => ws.readyState === ws.OPEN && ws.send(d), close: (code) => ws.close(code) });
  let alive = true;
  ws.on('pong', () => (alive = true));
  const hb = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 15000);
  ws.on('message', (data) => game.handle(conn, String(data)));
  ws.on('close', () => {
    clearInterval(hb);
    game.disconnect(conn);
  });
});

http.listen(PORT, () => console.log(`[ceyrom] listening on :${PORT} (static: ${STATIC}, data: ${DATA})`));

for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, () => {
    store.flush();
    process.exit(0);
  });
