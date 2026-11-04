import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PRESETS, RuleConfig } from '../../core/rules';
import type { RoomInfo, RoomMode, ServerMsg } from '../../core/protocol';
import { NetStatus, net } from '../../net/client';
import { PlayerInfo, useApp, useProfile } from '../../store/stores';
import { Avatar } from '../components/Art';
import { IconCopy, IconEye, IconGlobe, IconLock, IconShare } from '../components/Icons';
import { Button, Field, Screen, Segmented, TopBar } from '../components/Kit';
import { RulesPicker } from './Setup';

export const QUICK_CHAT = ['hello', 'goodShot', 'unlucky', 'wellPlayed', 'thinking', 'rematch'] as const;

interface ChatLine {
  id: number;
  name: string;
  text: string;
}

let chatId = 0;

export function Lobby() {
  const { t } = useTranslation();
  const startSession = useApp((s) => s.startSession);
  const toast = useApp((s) => s.toast);
  const profileName = useProfile((s) => s.name);
  const [status, setStatus] = useState<NetStatus>(net.status);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [you, setYou] = useState<{ seat: number; spectator: boolean }>({ seat: -1, spectator: false });
  const [queue, setQueue] = useState<{ mode: RoomMode; waiting: number } | null>(null);
  const [code, setCode] = useState(() => (location.hash.startsWith('#room-') ? location.hash.slice(6).toUpperCase() : ''));
  const [mode, setMode] = useState<RoomMode>('1v1');
  const [rules, setRules] = useState<RuleConfig>({ ...PRESETS.competitive });
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [msg, setMsg] = useState('');
  const [view, setView] = useState<'home' | 'create'>('home');
  const autoJoin = useRef(code.length > 0);

  useEffect(() => {
    const offS = net.onStatus(setStatus);
    const off = net.on((m: ServerMsg) => {
      switch (m.type) {
        case 'welcome':
          if (autoJoin.current && code) {
            autoJoin.current = false;
            net.send({ type: 'join', code });
          }
          break;
        case 'room':
          setRoom(m.room);
          setYou(m.you);
          setQueue(null);
          break;
        case 'queue':
          setQueue({ mode: m.mode, waiting: m.waiting });
          break;
        case 'chat':
          setChat((c) => [...c.slice(-40), { id: ++chatId, name: m.name, text: m.text }]);
          break;
        case 'error':
          toast(t(`net.err.${m.code}`, { defaultValue: t('net.err.generic') }), 'bad');
          if (m.code === 'room_not_found') setRoom(null);
          break;
        case 'start': {
          const spectator = you.spectator || m.room.seats.every((s) => s.playerId !== net.playerId);
          const mySeat = spectator ? 0 : m.room.seats.find((s) => s.playerId === net.playerId)?.seat ?? 0;
          const players: PlayerInfo[] = m.room.seats.map((s) => ({
            name: s.name,
            avatar: s.avatar,
            controller: !spectator && s.playerId === net.playerId ? 'human' : 'remote',
            id: s.playerId ?? undefined,
            rating: s.rating,
          }));
          startSession({
            kind: 'online',
            rules: m.room.rules,
            seats: m.room.mode === '2v2' ? 4 : 2,
            players,
            mySeat,
            seed: m.state.seed,
            roomCode: m.room.code,
            initialState: m.state,
            initialTurnMs: m.turnMs,
          });
          break;
        }
      }
    });
    net.connect();
    if (net.status === 'open' && autoJoin.current && code) {
      autoJoin.current = false;
      net.send({ type: 'join', code });
    }
    return () => {
      off();
      offS();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [you.spectator]);

  const leave = () => {
    net.leaveRoom();
    setRoom(null);
    setChat([]);
    if (location.hash.startsWith('#room-')) history.replaceState(null, '', location.pathname);
  };

  const inviteLink = room ? `${location.origin}${location.pathname}#room-${room.code}` : '';
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(t('lobby.copied'), 'good');
    } catch {
      toast(text, 'info');
    }
  };
  const share = async () => {
    if (!room) return;
    try {
      if (navigator.share) await navigator.share({ title: 'Ceyrom', text: t('lobby.shareText', { code: room.code }), url: inviteLink });
      else await copy(inviteLink);
    } catch {
      /* user cancelled */
    }
  };

  const sendChat = (text: string) => {
    const v = text.trim().slice(0, 140);
    if (!v) return;
    net.send({ type: 'chat', text: v });
    setMsg('');
  };

  const offline = status === 'failed' || status === 'idle';
  const isHost = room && room.hostId === net.playerId;
  const full = room && room.seats.every((s) => s.playerId);

  return (
    <Screen id="screen-lobby">
      <TopBar title={t('lobby.title')} onBack={room ? leave : undefined} right={<span className={`net-dot ${status}`} aria-label={t(`net.status.${status}`)} title={t(`net.status.${status}`)} />} />
      <div className="lobby">
        {offline && (
          <div className="notice-card">
            <strong>{t('lobby.offlineTitle')}</strong>
            <p className="muted">{t('lobby.offlineBody')}</p>
            <Button onClick={() => net.retry()}>{t('common.retry')}</Button>
          </div>
        )}
        {(status === 'connecting' || status === 'reconnecting') && !room && <p className="muted pulse">{t(`net.status.${status}`)}</p>}

        {status === 'open' && !room && !queue && view === 'home' && (
          <div className="lobby-home">
            <section className="lobby-card">
              <h2>
                <IconGlobe size={20} /> {t('lobby.quick')}
              </h2>
              <p className="muted">{t('lobby.quickHint')}</p>
              <div className="row">
                <Button onClick={() => net.send({ type: 'quick', mode: '1v1' })} id="btn-quick-1v1">
                  {t('ai.oneVsOne')}
                </Button>
                <Button variant="secondary" onClick={() => net.send({ type: 'quick', mode: '2v2' })}>
                  {t('ai.twoVsTwo')}
                </Button>
              </div>
            </section>
            <section className="lobby-card">
              <h2>
                <IconLock size={20} /> {t('lobby.private')}
              </h2>
              <p className="muted">{t('lobby.privateHint')}</p>
              <Button onClick={() => setView('create')} id="btn-create">
                {t('lobby.create')}
              </Button>
            </section>
            <section className="lobby-card">
              <h2>{t('lobby.join')}</h2>
              <form
                className="join-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (code.trim()) net.send({ type: 'join', code: code.trim().toUpperCase() });
                }}
              >
                <label htmlFor="join-code" className="sr-only">
                  {t('lobby.code')}
                </label>
                <input id="join-code" className="input code-input" value={code} maxLength={6} placeholder="ABCD" onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} autoComplete="off" autoCapitalize="characters" />
                <Button type="submit" disabled={code.length < 4}>
                  {t('lobby.joinBtn')}
                </Button>
                <Button variant="ghost" icon={<IconEye size={18} />} disabled={code.length < 4} onClick={() => net.send({ type: 'join', code, spectate: true })}>
                  {t('lobby.watch')}
                </Button>
              </form>
            </section>
          </div>
        )}

        {status === 'open' && !room && !queue && view === 'create' && (
          <section className="lobby-card">
            <h2>{t('lobby.create')}</h2>
            <Field label={t('lobby.mode')}>
              <Segmented
                id="room-mode"
                label={t('lobby.mode')}
                value={mode}
                onChange={setMode}
                options={[
                  { value: '1v1', label: t('ai.oneVsOne') },
                  { value: '2v2', label: t('ai.twoVsTwo') },
                ]}
              />
            </Field>
            <Field label={t('rules.title')}>
              <RulesPicker value={rules} onChange={setRules} allowCustom />
            </Field>
            <Field label={t('rules.shotClock')}>
              <Segmented
                id="room-clock"
                label={t('rules.shotClock')}
                value={rules.shotClock}
                onChange={(v) => setRules({ ...rules, shotClock: v })}
                options={[
                  { value: 20, label: '20s' },
                  { value: 30, label: '30s' },
                  { value: 45, label: '45s' },
                ]}
              />
            </Field>
            <div className="row">
              <Button variant="ghost" onClick={() => setView('home')}>
                {t('common.cancel')}
              </Button>
              <Button onClick={() => (net.send({ type: 'create', mode, rules, isPrivate: true }), setView('home'))} id="btn-create-room">
                {t('lobby.createBtn')}
              </Button>
            </div>
          </section>
        )}

        {queue && !room && (
          <section className="lobby-card center">
            <div className="matchmaking" aria-hidden>
              <span />
              <span />
              <span />
            </div>
            <h2>{t('lobby.searching')}</h2>
            <p className="muted">{t('lobby.inQueue', { n: queue.waiting, mode: queue.mode })}</p>
            <Button variant="secondary" onClick={() => (net.send({ type: 'cancelQuick' }), setQueue(null))}>
              {t('common.cancel')}
            </Button>
          </section>
        )}

        {room && (
          <div className="room">
            <section className="lobby-card">
              <div className="room-code-row">
                <div>
                  <small className="muted">{t('lobby.roomCode')}</small>
                  <div className="room-code" aria-label={t('lobby.roomCode')}>
                    {room.code}
                  </div>
                </div>
                <div className="row tight">
                  <Button variant="secondary" size="sm" icon={<IconCopy size={18} />} onClick={() => void copy(room.code)}>
                    {t('lobby.copy')}
                  </Button>
                  <Button variant="secondary" size="sm" icon={<IconShare size={18} />} onClick={() => void share()}>
                    {t('lobby.invite')}
                  </Button>
                </div>
              </div>
              <p className="muted">
                {t(`rules.preset.${room.rules.preset}`)} · {room.mode} · {t('lobby.spectators', { count: room.spectators })}
              </p>
              <ul className="seat-list">
                {room.seats.map((s) => (
                  <li key={s.seat} className={s.playerId ? 'filled' : ''}>
                    {s.playerId ? <Avatar id={s.avatar} size={40} /> : <span className="seat-empty" aria-hidden />}
                    <span>
                      <strong>{s.playerId ? s.name : t('lobby.openSeat')}</strong>
                      <small className="muted">
                        {room.mode === '2v2' ? t('local.team', { n: (s.seat % 2) + 1 }) : t('lobby.seat', { n: s.seat + 1 })}
                        {s.playerId ? ` · ${s.rating}` : ''}
                        {s.playerId === room.hostId ? ` · ${t('lobby.host')}` : ''}
                        {s.playerId && !s.connected ? ` · ${t('game.offline')}` : ''}
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
              {you.spectator && <p className="badge">{t('lobby.watching')}</p>}
              <div className="row">
                <Button variant="ghost" onClick={leave}>
                  {t('lobby.leave')}
                </Button>
                {isHost && (
                  <Button onClick={() => net.send({ type: 'start' })} disabled={!full} id="btn-start-room">
                    {full ? t('lobby.start') : t('lobby.waiting')}
                  </Button>
                )}
                {room.status === 'finished' && !isHost && (
                  <Button onClick={() => net.send({ type: 'rematch' })}>{t('results.rematch')}</Button>
                )}
              </div>
            </section>
            <section className="lobby-card chat">
              <h2>{t('lobby.chat')}</h2>
              <ul className="chat-log" aria-live="polite">
                {chat.length === 0 && <li className="muted">{t('lobby.chatEmpty', { name: profileName })}</li>}
                {chat.map((c) => (
                  <li key={c.id}>
                    <strong>{c.name}</strong> {c.text.startsWith('qc:') ? t(`quick.${c.text.slice(3)}`) : c.text}
                  </li>
                ))}
              </ul>
              <div className="quick-chat">
                {QUICK_CHAT.map((q) => (
                  <button key={q} type="button" className="chip" onClick={() => net.send({ type: 'chat', text: `qc:${q}` })}>
                    {t(`quick.${q}`)}
                  </button>
                ))}
              </div>
              <form
                className="chat-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  sendChat(msg);
                }}
              >
                <label htmlFor="chat-input" className="sr-only">
                  {t('lobby.chat')}
                </label>
                <input id="chat-input" className="input" value={msg} maxLength={140} onChange={(e) => setMsg(e.target.value)} placeholder={t('lobby.chatPlaceholder')} autoComplete="off" />
                <Button type="submit" size="sm">
                  {t('lobby.send')}
                </Button>
              </form>
            </section>
          </div>
        )}
      </div>
    </Screen>
  );
}
