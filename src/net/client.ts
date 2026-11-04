/**
 * WebSocket client with automatic reconnection (exponential backoff + jitter)
 * and room resumption after network drops.
 */
import type { ClientMsg, ServerMsg } from '../core/protocol';
import { useProfile, useSettings } from '../store/stores';
import { loadSession, saveSession } from '../store/storage';

type Listener = (m: ServerMsg) => void;
export type NetStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'failed';

class NetClient {
  ws: WebSocket | null = null;
  status: NetStatus = 'idle';
  private listeners = new Set<Listener>();
  private statusListeners = new Set<(s: NetStatus) => void>();
  private queue: ClientMsg[] = [];
  private attempts = 0;
  private everOpened = false;
  private wantOpen = false;
  private timer: number | null = null;
  token: string | null = null;
  playerId: string | null = null;
  room: string | null = null;
  rtt = 0;
  private pingTimer: number | null = null;

  url(): string {
    const custom = useSettings.getState().serverUrl.trim();
    if (custom) return custom.replace(/^http/, 'ws').replace(/\/?$/, '') + '/ws';
    const envUrl = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? '';
    if (envUrl) return envUrl.replace(/^http/, 'ws').replace(/\/?$/, '') + '/ws';
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  httpBase(): string {
    return this.url().replace(/^ws/, 'http').replace(/\/ws$/, '');
  }

  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onStatus(l: (s: NetStatus) => void): () => void {
    this.statusListeners.add(l);
    return () => this.statusListeners.delete(l);
  }

  private setStatus(s: NetStatus): void {
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }

  connect(): void {
    this.wantOpen = true;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.token = this.token ?? loadSession<string>('ceyrom.token') ?? localStorageToken();
    this.room = this.room ?? loadSession<string>('ceyrom.room');
    this.setStatus(this.attempts ? 'reconnecting' : 'connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.everOpened = true;
      this.setStatus('open');
      const p = useProfile.getState();
      this.rawSend({ type: 'hello', token: this.token ?? undefined, name: p.name || 'Player', avatar: p.avatar, country: p.country });
      if (this.room) this.rawSend({ type: 'resume', code: this.room });
      for (const m of this.queue.splice(0)) this.rawSend(m);
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.rawSend({ type: 'ping', t: performance.now() }), 5000);
    };
    ws.onmessage = (ev) => {
      let m: ServerMsg;
      try {
        m = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (m.type === 'welcome') {
        this.token = m.token;
        this.playerId = m.profile.id;
        saveSession('ceyrom.token', m.token);
        try {
          localStorage.setItem('ceyrom.token', m.token);
        } catch {
          /* ignore */
        }
      }
      if (m.type === 'pong') this.rtt = performance.now() - m.t;
      if (m.type === 'room') {
        this.room = m.room.code;
        saveSession('ceyrom.room', m.room.code);
      }
      for (const l of this.listeners) l(m);
    };
    ws.onclose = () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.ws = null;
      if (this.wantOpen) this.scheduleReconnect();
      else this.setStatus('idle');
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private scheduleReconnect(): void {
    this.attempts++;
    // a server that never answered is probably not there: say so quickly
    if (this.attempts > 8 || (!this.everOpened && this.attempts > 2)) {
      this.setStatus('failed');
      return;
    }
    this.setStatus('reconnecting');
    const delay = Math.min(10000, 500 * 2 ** (this.attempts - 1)) * (0.75 + Math.random() * 0.5);
    if (this.timer) clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.connect(), delay);
  }

  retry(): void {
    this.attempts = 0;
    this.everOpened = false;
    this.connect();
  }

  private rawSend(m: ClientMsg): void {
    this.ws?.send(JSON.stringify(m));
  }

  send(m: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.rawSend(m);
    else if (m.type !== 'preview' && m.type !== 'ping') {
      this.queue.push(m);
      this.connect();
    }
  }

  leaveRoom(): void {
    this.send({ type: 'leave' });
    this.room = null;
    saveSession('ceyrom.room', null);
  }

  disconnect(): void {
    this.wantOpen = false;
    this.ws?.close();
  }
}

function localStorageToken(): string | null {
  try {
    return localStorage.getItem('ceyrom.token');
  } catch {
    return null;
  }
}

export const net = new NetClient();
