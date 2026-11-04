import { CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EMOJIS } from '../../core/protocol';
import { MatchState, teamOf } from '../../core/rules';
import { audio } from '../../game/audio';
import { GameController } from '../../game/controller';
import { DRILLS, TUTORIAL_STEPS, todayKey } from '../../game/drills';
import { computeRewards } from '../../game/progress';
import { fmtNumber } from '../../i18n';
import { net } from '../../net/client';
import { HudPlayer, useApp, useHud, useProfile, useSettings } from '../../store/stores';
import { Avatar, CoinDot } from '../components/Art';
import { IconBulb, IconPause, IconRefresh, IconReplay, IconSmile, IconSound, IconMute, IconWifiOff, IconStriker } from '../components/Icons';
import { Button, Dialog, Segmented, Toggle } from '../components/Kit';

export function GameScreen() {
  const { t } = useTranslation();
  const session = useApp((s) => s.session)!;
  const finish = useApp((s) => s.finish);
  const go = useApp((s) => s.go);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const ctrl = useRef<GameController | null>(null);
  const [paused, setPaused] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [tutorialDone, setTutorialDone] = useState(false);

  const onEnd = useCallback(
    (state: MatchState, extra: { forfeit?: boolean; ratings?: Record<string, { before: number; after: number }>; shots: number }) => {
      const prof = useProfile.getState();
      const myId = net.playerId ?? '';
      const ratingAfter = extra.ratings?.[myId]?.after;
      const r = computeRewards(prof, session, state, ratingAfter);
      prof.update(r.patch);
      finish({ session, state, myTeam: teamOf(session.mySeat), xp: r.xp, achievements: r.achievements, ratingDelta: r.ratingDelta, forfeit: extra.forfeit, shots: extra.shots });
    },
    [session, finish],
  );

  useEffect(() => {
    const canvas = canvasRef.current!;
    const c = new GameController(canvas, session, {
      onEnd,
      onTutorialDone: () => {
        const p = useProfile.getState();
        if (!p.achievements.includes('tutorial')) p.update({ achievements: [...p.achievements, 'tutorial'], xp: p.xp + 60 });
        setTutorialDone(true);
      },
    }, bgRef.current);
    ctrl.current = c;
    const ro = new ResizeObserver(() => {
      const r = wrapRef.current!.getBoundingClientRect();
      const size = Math.floor(Math.min(r.width, r.height));
      c.resize(size, size);
    });
    ro.observe(wrapRef.current!);
    const r = wrapRef.current!.getBoundingClientRect();
    c.resize(Math.floor(Math.min(r.width, r.height)), Math.floor(Math.min(r.width, r.height)));
    c.start();
    if (location.search.includes('debug')) (window as unknown as { __ceyrom: unknown }).__ceyrom = c;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'range') return;
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        if (!document.querySelector('dialog[open]')) {
          setPaused(true);
          e.preventDefault();
        }
        return;
      }
      if (document.querySelector('dialog[open]')) return;
      if ((e.key === 'r' || e.key === 'R') && session.kind === 'practice') c.resetPractice();
      if ((e.key === 'h' || e.key === 'H') && session.kind === 'practice') void c.suggest();
      if (c.key(e)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      ro.disconnect();
      window.removeEventListener('keydown', onKey);
      c.destroy();
      ctrl.current = null;
    };
  }, [session, onEnd]);

  useEffect(() => ctrl.current?.setPaused(paused), [paused]);

  const leave = () => {
    if (session.kind === 'online') net.leaveRoom();
    setConfirmLeave(false);
    setPaused(false);
    go('menu', { replace: true });
  };

  const onPointer = (e: React.PointerEvent<HTMLCanvasElement>, type: 'down' | 'move' | 'up') => {
    const c = ctrl.current;
    if (!c) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (type === 'down') {
      if (c.pointerDown(x, y, e.pointerId)) e.currentTarget.setPointerCapture(e.pointerId);
    } else if (type === 'move') c.pointerMove(x, y, e.pointerId);
    else c.pointerUp(e.pointerId);
  };

  const kind = session.kind;
  return (
    <div className={`game game-${kind} seats-${session.seats}`} id="screen-game">
      <GameTopBar onPause={() => setPaused(true)} />
      <PlayerColumn which="them" />
      <div className="board-cell">
        <div className="board-wrap" ref={wrapRef}>
          <div className="board-stack">
          <canvas ref={bgRef} className="board-bg" aria-hidden />
          <canvas
            ref={canvasRef}
            className="board-canvas"
            aria-label={t('game.boardLabel')}
            role="img"
            onPointerDown={(e) => onPointer(e, 'down')}
            onPointerMove={(e) => onPointer(e, 'move')}
            onPointerUp={(e) => onPointer(e, 'up')}
            onPointerCancel={(e) => onPointer(e, 'up')}
            onContextMenu={(e) => e.preventDefault()}
          />
          </div>
          <Notes />
          <Banner />
          <Reactions />
          {kind === 'tutorial' && !tutorialDone && <TutorialCard ctrl={ctrl} />}
          {kind === 'tutorial' && tutorialDone && (
            <div className="board-overlay">
              <div className="overlay-card rise">
                <h2>{t('tutorial.doneTitle')}</h2>
                <p>{t('tutorial.doneBody')}</p>
                <Button size="lg" onClick={() => go('menu', { replace: true })}>
                  {t('common.continue')}
                </Button>
              </div>
            </div>
          )}
          {kind === 'challenge' && <ChallengeCard ctrl={ctrl} />}
          <WaitingOverlay />
        </div>
      </div>
      <PlayerColumn which="us" />
      <Controls ctrl={ctrl} onEmoji={() => setEmojiOpen((v) => !v)} emojiOpen={emojiOpen} closeEmoji={() => setEmojiOpen(false)} />

      <Dialog
        open={paused && !confirmLeave}
        onClose={() => setPaused(false)}
        title={t('pause.title')}
        actions={
          <>
            <Button variant="danger" onClick={() => setConfirmLeave(true)}>
              {t('pause.leave')}
            </Button>
            <Button onClick={() => setPaused(false)} id="btn-resume">
              {t('pause.resume')}
            </Button>
          </>
        }
      >
        <QuickSettings />
        <RulesSummary />
        {kind === 'online' && <p className="muted">{t('pause.onlineNote')}</p>}
      </Dialog>
      <Dialog
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        title={t('pause.leaveTitle')}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirmLeave(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={leave} id="btn-confirm-leave">
              {t('pause.leave')}
            </Button>
          </>
        }
      >
        <p>{kind === 'online' ? t('pause.leaveOnline') : t('pause.leaveBody')}</p>
      </Dialog>
    </div>
  );
}

function GameTopBar({ onPause }: { onPause: () => void }) {
  const { t } = useTranslation();
  const session = useApp((s) => s.session)!;
  const board = useHud((s) => s.board);
  const target = useHud((s) => s.target);
  const scores = useHud((s) => s.scores);
  const variant = useHud((s) => s.variant);
  const queen = useHud((s) => s.queen);
  const queenTeam = useHud((s) => s.queenTeam);
  const network = useHud((s) => s.network);
  const muted = useSettings((s) => s.muted);
  const setS = useSettings((s) => s.set);
  const solo = session.kind === 'practice' || session.kind === 'tutorial' || session.kind === 'challenge';
  const title = solo ? t(session.kind === 'practice' ? `drill.${session.drill ?? 'break'}.title` : session.kind === 'tutorial' ? 'menu.tutorial' : 'menu.daily') : t(`rules.preset.${session.rules.preset}`);
  return (
    <header className="game-top">
      <Button variant="ghost" icon={<IconPause />} label={t('pause.title')} onClick={onPause} id="btn-pause" />
      <div className="match-info">
        <strong>{title}</strong>
        {!solo && (
          <small>
            {target > 0 ? t('game.boardTo', { n: fmtNumber(board), target: fmtNumber(target) }) : variant === 'freestyle' ? t('game.freestyle') : t('game.singleBoard')}
            {target > 0 && ` · ${fmtNumber(scores[0])}–${fmtNumber(scores[1])}`}
          </small>
        )}
      </div>
      <div className="row tight">
        {network && network !== 'ok' && (
          <span className={`net-pill ${network}`} role="status">
            <IconWifiOff size={16} /> {t(`net.${network}`)}
          </span>
        )}
        {!solo && variant === 'standard' && (
          <span className={`queen-pill q-${queen}`} title={t(`queen.${queen}`, { team: queenTeam + 1 })}>
            <CoinDot kind="queen" size={16} />
            <span className="queen-text">{t(`queen.${queen}`, { team: queenTeam + 1 })}</span>
          </span>
        )}
        <Button variant="ghost" icon={muted ? <IconMute /> : <IconSound />} label={t('settings.mute')} onClick={() => setS({ muted: !muted })} />
      </div>
    </header>
  );
}

function PlayerColumn({ which }: { which: 'us' | 'them' }) {
  const session = useApp((s) => s.session)!;
  const players = useHud((s) => s.players);
  const turn = useHud((s) => s.turn);
  const solo = session.kind === 'practice' || session.kind === 'tutorial' || session.kind === 'challenge';
  if (solo) return <div className={`players players-${which}`} />;
  const myTeam = session.kind === 'local' ? 0 : teamOf(session.mySeat);
  const list = players.map((p, seat) => ({ p, seat })).filter(({ p }) => (which === 'us' ? p.team === myTeam : p.team !== myTeam));
  return (
    <div className={`players players-${which}`}>
      {list.map(({ p, seat }) => (
        <PlayerCard key={seat} p={p} seat={seat} active={turn === seat} />
      ))}
    </div>
  );
}

function PlayerCard({ p, seat, active }: { p: HudPlayer; seat: number; active: boolean }) {
  const { t } = useTranslation();
  const thinking = useHud((s) => s.thinking && s.turn === seat);
  const clockMs = useHud((s) => (s.turn === seat ? s.clockMs : null));
  const clockTotal = useHud((s) => s.clockTotal);
  const variant = useHud((s) => s.variant);
  const frac = clockMs !== null && clockTotal > 0 ? clockMs / clockTotal : null;
  const low = frac !== null && frac < 0.25;
  return (
    <div className={`pcard${active ? ' active' : ''}${!p.connected ? ' offline' : ''}`} aria-current={active ? 'true' : undefined}>
      <div className={`pcard-avatar${low ? ' low' : ''}`} style={{ '--clock': frac === null ? 1 : frac } as CSSProperties}>
        <Avatar id={p.avatar} size={44} />
      </div>
      <div className="pcard-body">
        <div className="pcard-name">
          <strong>{p.name}</strong>
          {p.controller === 'ai' && <span className="badge">{t('game.ai')}</span>}
          {!p.connected && <span className="badge bad">{t('game.offline')}</span>}
        </div>
        <div className="pcard-meta">
          {variant === 'standard' && p.color ? (
            <span className="coins" aria-label={t('game.coinsLeft', { n: p.remaining })}>
              <CoinDot kind={p.color} /> <b>{fmtNumber(p.remaining)}</b> <small>{t('game.left')}</small>
            </span>
          ) : (
            <span className="coins">
              <b>{fmtNumber(p.pocketed)}</b> <small>{t('game.points')}</small>
            </span>
          )}
          {thinking && (
            <span className="thinking" role="status">
              {t('game.thinking')}
              <i />
              <i />
              <i />
            </span>
          )}
          {active && !thinking && clockMs !== null && <span className={`clock${low ? ' low' : ''}`}>{Math.ceil(clockMs / 1000)}s</span>}
        </div>
      </div>
    </div>
  );
}

function Notes() {
  const { t } = useTranslation();
  const notes = useHud((s) => s.notes);
  return (
    <div className="notes" role="status" aria-live="polite">
      {notes.map((n) => (
        <div key={n.id} className={`note note-${n.tone}`}>
          {t(n.key, n.params)}
        </div>
      ))}
    </div>
  );
}

function Banner() {
  const { t } = useTranslation();
  const banner = useHud((s) => s.banner);
  const [shown, setShown] = useState<typeof banner>(null);
  useEffect(() => {
    if (!banner) return;
    setShown(banner);
    const id = setTimeout(() => setShown(null), banner.key === 'hud.boardWon' ? 2400 : 1250);
    return () => clearTimeout(id);
  }, [banner]);
  if (!shown) return null;
  return (
    <div className="banner" key={shown.id} aria-live="polite">
      <span>{t(shown.key, shown.params)}</span>
    </div>
  );
}

function Reactions() {
  const reactions = useHud((s) => s.reactions);
  const players = useHud((s) => s.players);
  return (
    <div className="reactions" aria-hidden>
      {reactions.map((r) => (
        <span key={r.id} className={`reaction side-${players[r.seat]?.side ?? 0}`}>
          {r.emoji}
        </span>
      ))}
    </div>
  );
}

function WaitingOverlay() {
  const { t } = useTranslation();
  const phase = useHud((s) => s.phase);
  if (phase !== 'waiting') return null;
  return <div className="note note-info waiting">{t('net.waitingServer')}</div>;
}

function Controls({ ctrl, onEmoji, emojiOpen, closeEmoji }: { ctrl: React.MutableRefObject<GameController | null>; onEmoji: () => void; emojiOpen: boolean; closeEmoji: () => void }) {
  const { t } = useTranslation();
  const session = useApp((s) => s.session)!;
  const canShoot = useHud((s) => s.canShoot);
  const power = useHud((s) => s.power);
  const tPos = useHud((s) => s.t);
  const valid = useHud((s) => s.validPlacement);
  const replayable = useHud((s) => s.replayable);
  const phase = useHud((s) => s.phase);
  const coachBusy = useHud((s) => s.coachBusy);
  const controls = useSettings((s) => s.controls);
  const mySeat = useHud((s) => s.mySeat);
  const [drill, setDrill] = useState(session.drill ?? 'break');
  const kind = session.kind;
  return (
    <div className="controls">
      <div className="control-row">
        <label className="ctl-slider" htmlFor="ctl-place">
          <span>
            <IconStriker size={16} /> {t('game.position')}
          </span>
          <input
            id="ctl-place"
            type="range"
            min={-1}
            max={1}
            step={0.005}
            value={tPos}
            disabled={!canShoot}
            aria-invalid={!valid}
            className={valid ? '' : 'invalid'}
            onChange={(e) => ctrl.current?.setPlacement(Number(e.target.value))}
          />
        </label>
        <label className="ctl-slider" htmlFor="ctl-power">
          <span>
            {t('game.power')} <output htmlFor="ctl-power" className="power-readout">{Math.round(power * 100)}%</output>
          </span>
          <input id="ctl-power" type="range" min={0} max={1} step={0.01} value={power} disabled={!canShoot} style={{ ['--fill' as string]: `${power * 100}%` }} onChange={(e) => ctrl.current?.setPower(Number(e.target.value))} />
        </label>
        <Button size="lg" onClick={() => ctrl.current?.shoot()} disabled={!canShoot || !valid} id="btn-shoot">
          {t('game.strike')}
        </Button>
      </div>
      <div className="control-row secondary">
        <span className="hint ctl-hint">{canShoot ? t(controls === 'slingshot' ? 'game.hintSling' : 'game.hintPoint') : phase === 'moving' ? '' : t('game.hintWait')}</span>
        <div className="row tight">
          {kind === 'practice' && (
            <>
              <select className="input select" value={drill} aria-label={t('practice.drill')} onChange={(e) => (setDrill(e.target.value), ctrl.current?.resetPractice(e.target.value))}>
                {DRILLS.map((d) => (
                  <option key={d} value={d}>
                    {t(`drill.${d}.title`)}
                  </option>
                ))}
              </select>
              <Button variant="secondary" size="sm" icon={<IconBulb size={18} />} disabled={!canShoot || coachBusy} onClick={() => void ctrl.current?.suggest()}>
                {coachBusy ? t('practice.thinking') : t('practice.coach')}
              </Button>
              <Button variant="ghost" size="sm" icon={<IconRefresh size={18} />} onClick={() => ctrl.current?.resetPractice()}>
                {t('practice.reset')}
              </Button>
            </>
          )}
          {replayable && kind !== 'tutorial' && (
            <Button variant="ghost" size="sm" icon={<IconReplay size={18} />} disabled={phase !== 'aim'} onClick={() => ctrl.current?.replay()}>
              {t('game.replay')}
            </Button>
          )}
          {(kind === 'ai' || kind === 'online' || kind === 'local') && (
            <div className="emoji-wrap">
              <Button variant="ghost" size="sm" icon={<IconSmile size={18} />} label={t('game.react')} onClick={onEmoji} />
              {emojiOpen && (
                <div className="emoji-pop" role="menu">
                  {EMOJIS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        ctrl.current?.react(kind === 'local' ? useHud.getState().turn : mySeat, e);
                        closeEmoji();
                      }}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TutorialCard({ ctrl }: { ctrl: React.MutableRefObject<GameController | null> }) {
  const { t } = useTranslation();
  const step = useHud((s) => s.tutorialStep);
  const id = TUTORIAL_STEPS[Math.min(step, TUTORIAL_STEPS.length - 1)];
  return (
    <div className="tutorial-card rise" key={step} role="dialog" aria-live="polite" aria-label={t('menu.tutorial')}>
      <div className="tut-step">{t('tutorial.step', { n: step + 1, total: TUTORIAL_STEPS.length })}</div>
      <strong>{t(`tutorial.${id}.title`)}</strong>
      <p>{t(`tutorial.${id}.body`)}</p>
      <div className="row tight end">
        {step < 4 && (
          <Button variant="ghost" size="sm" onClick={() => ctrl.current?.setTutorialStep(step + 1)}>
            {t('common.skip')}
          </Button>
        )}
        {step === 4 && (
          <Button size="sm" onClick={() => ctrl.current?.setTutorialStep(5)}>
            {t('tutorial.finish')}
          </Button>
        )}
      </div>
    </div>
  );
}

function ChallengeCard({ ctrl }: { ctrl: React.MutableRefObject<GameController | null> }) {
  const { t } = useTranslation();
  const ch = useHud((s) => s.challenge);
  const go = useApp((s) => s.go);
  const profile = useProfile();
  const recorded = useRef(false);
  const c = ch ?? { shots: 0, limit: 7, left: 5, done: false, failed: false };
  useEffect(() => {
    if (c.done && !recorded.current) {
      recorded.current = true;
      const key = todayKey();
      const best = profile.daily[key];
      const ach = profile.achievements.includes('daily') ? profile.achievements : [...profile.achievements, 'daily'];
      profile.update({ daily: { ...profile.daily, [key]: best === undefined ? c.shots : Math.min(best, c.shots) }, achievements: ach, xp: profile.xp + 80 });
    }
    if (!c.done && !c.failed) recorded.current = false;
  }, [c.done, c.failed, c.shots, profile]);
  return (
    <>
      <div className="challenge-pill" role="status">
        <CoinDot kind="white" /> {t('challenge.left', { n: c.left })} · {t('challenge.shots', { n: c.shots, limit: c.limit })}
      </div>
      {(c.done || c.failed) && (
        <div className="board-overlay">
          <div className="overlay-card rise">
            <h2>{c.done ? t('challenge.doneTitle') : t('challenge.failTitle')}</h2>
            <p>{c.done ? t('challenge.doneBody', { n: c.shots }) : t('challenge.failBody')}</p>
            <div className="row">
              <Button variant="secondary" onClick={() => go('menu', { replace: true })}>
                {t('common.menu')}
              </Button>
              <Button onClick={() => ctrl.current?.restartChallenge()}>{t('challenge.retry')}</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function QuickSettings() {
  const { t } = useTranslation();
  const s = useSettings();
  return (
    <div className="quick-settings">
      <Toggle id="qs-sound" checked={!s.muted} label={t('settings.sound')} onChange={(v) => s.set({ muted: !v })} />
      <Toggle
        id="qs-music"
        checked={s.musicOn}
        label={t('settings.music')}
        onChange={(v) => {
          s.set({ musicOn: v });
          audio.setMusic(v);
        }}
      />
      <div className="field">
        <div className="field-label">{t('settings.guide')}</div>
        <Segmented
          id="qs-guide"
          label={t('settings.guide')}
          value={s.guide}
          onChange={(v) => s.set({ guide: v })}
          options={[
            { value: 'full', label: t('settings.guideFull') },
            { value: 'short', label: t('settings.guideShort') },
            { value: 'off', label: t('settings.guideOff') },
          ]}
        />
      </div>
    </div>
  );
}

function RulesSummary() {
  const { t } = useTranslation();
  const session = useApp((s) => s.session)!;
  const r = session.rules;
  return (
    <details className="rules-summary">
      <summary>{t('pause.rules')}</summary>
      <ul>
        {(r.variant === 'freestyle' ? ['free1', 'free2', 'free3'] : ['std1', 'std2', 'std3', 'std4', 'std5']).map((k) => (
          <li key={k}>{t(`rulesText.${k}`)}</li>
        ))}
        {r.variant === 'standard' && r.queenNeedsOwnCoin && <li>{t('rulesText.queenOwn')}</li>}
        {r.variant === 'standard' && !r.strikerPenalty && <li>{t('rulesText.noPenalty')}</li>}
      </ul>
    </details>
  );
}
