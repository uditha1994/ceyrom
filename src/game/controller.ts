/**
 * GameController: owns one match session. Runs the fixed-timestep loop, routes input,
 * drives AI turns, applies rules, syncs with the server for online play, and publishes
 * a compact HUD snapshot for React. React never touches the simulation directly.
 */
import { BOARD, PHYS, STRIKER_R } from '../core/constants';
import { chooseShot } from '../core/ai';
import { World } from '../core/physics';
import {
  MatchState,
  ShotInput,
  ShotOutcome,
  cloneState,
  colorOf,
  createMatch,
  directionValid,
  nextBoard,
  placementValid,
  remainingFor,
  resolveShot,
  resolveTimeout,
  shotWorld,
  sideOf,
  strikerPos,
  teamOf,
  toBoard,
  toLocal,
  validateShot,
  PRESETS,
} from '../core/rules';
import type { ServerMsg } from '../core/protocol';
import { audio, haptic } from './audio';
import { AimView, RenderBody, Renderer } from './renderer';
import { CHALLENGE_LIMIT, challengeCoins, drillCoins, tutorialCoins } from './drills';
import { net } from '../net/client';
import { HudNote, HudState, SessionConfig, initialHud, prefersReducedMotion, useHud, useSettings } from '../store/stores';

type Phase = HudState['phase'];

export interface ControllerHooks {
  onEnd: (state: MatchState, extra: { forfeit?: boolean; ratings?: Record<string, { before: number; after: number }>; shots: number }) => void;
  onTutorialDone?: () => void;
}

const DT = PHYS.dt;
let noteId = 0;

export class GameController {
  session: SessionConfig;
  state: MatchState;
  renderer: Renderer;
  hooks: ControllerHooks;
  phase: Phase = 'aim';
  paused = false;
  private world: World | null = null;
  private prev = new Map<number, { x: number; y: number; a: number }>();
  private acc = 0;
  private last = 0;
  private raf = 0;
  private aim = { t: 0, dir: { x: 0, y: -1 }, power: 0 };
  private pointer: { mode: 'pull' | 'place' | 'point' | null; id: number; startPx: { x: number; y: number } } = { mode: null, id: -1, startPx: { x: 0, y: 0 } };
  private pulling: { x: number; y: number } | null = null;
  private lastInput: ShotInput | null = null;
  private lastPre: MatchState | null = null;
  private ghost: { x: number; y: number }[] | null = null;
  private ghostRec: { x: number; y: number }[] = [];
  private coach: { t: number; dx: number; dy: number } | null = null;
  private deadline: number | null = null;
  private pausedLeft: number | null = null;
  private soundGate = { coin: 0, wall: 0 };
  private destroyed = false;
  private aiToken = 0;
  private replayWorld: World | null = null;
  private pendingAuth: { state: MatchState; outcome: ShotOutcome } | null = null;
  private seq = 0;
  private remoteAim: { t: number; dx: number; dy: number; power: number } | null = null;
  private previewAt = 0;
  private unsub: (() => void)[] = [];
  private shots = 0;
  private clockTimer = 0;
  private tutorialStep = 0;
  private tutorialMoved = 0;
  private challengeShots = 0;
  private challengeDone = false;
  private hiddenAt = 0;

  constructor(canvas: HTMLCanvasElement, session: SessionConfig, hooks: ControllerHooks, boardLayer: HTMLCanvasElement | null = null) {
    this.session = session;
    this.hooks = hooks;
    this.renderer = new Renderer(canvas, boardLayer);
    this.state = session.initialState ? cloneState(session.initialState) : createMatch(session.rules, session.seats, session.seed);
    if (session.kind === 'practice' || session.kind === 'tutorial' || session.kind === 'challenge') this.setupSolo();
    this.applyLook();
  }

  // ───────────────────────────── lifecycle ─────────────────────────────

  start(): void {
    useHud.setState({ ...initialHud, mySeat: this.session.mySeat });
    this.renderer.startIntro();
    this.renderer.setView(this.viewSide(), true);
    if (this.session.kind === 'online') this.bindNet();
    this.startTurn(true);
    if (this.session.kind === 'online' && this.session.initialTurnMs !== undefined) this.setServerClock(this.session.initialTurnMs);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    this.clockTimer = window.setInterval(() => this.tickClock(), 200);
    const vis = () => this.onVisibility();
    document.addEventListener('visibilitychange', vis);
    this.unsub.push(() => document.removeEventListener('visibilitychange', vis));
    this.unsub.push(useSettings.subscribe(() => this.applyLook()));
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    clearInterval(this.clockTimer);
    this.aiToken++;
    for (const u of this.unsub) u();
  }

  resize(w: number, h: number): void {
    this.renderer.resize(w, h, window.devicePixelRatio || 1);
  }

  private applyLook(): void {
    const s = useSettings.getState();
    this.renderer.setLook(s.board, s.striker, s.quality, prefersReducedMotion());
  }

  private onVisibility(): void {
    if (document.hidden) {
      this.hiddenAt = performance.now();
      audio.suspend(true);
      if (this.session.kind !== 'online' && !this.paused) this.setPaused(true);
    } else {
      audio.suspend(false);
      // a shot that was in flight while hidden: finish instantly instead of fast-forwarding visibly
      if (this.world && performance.now() - this.hiddenAt > 1000) {
        this.world.runToRest();
        this.world.drainEvents();
      }
    }
  }

  // ───────────────────────────── setup helpers ─────────────────────────────

  private setupSolo(): void {
    const k = this.session.kind;
    this.state.config = { ...(k === 'tutorial' ? PRESETS.gedara : PRESETS.freestyle), shotClock: 0, targetPoints: 0 };
    if (k === 'practice') this.state.coins = drillCoins(this.session.drill ?? 'break');
    if (k === 'tutorial') this.state.coins = tutorialCoins(0);
    if (k === 'challenge') this.state.coins = challengeCoins();
    this.state.shotNo = k === 'practice' && (this.session.drill ?? 'break') === 'break' ? 0 : 1;
  }

  private viewSide(): number {
    const k = this.session.kind;
    if (k === 'local') return sideOf(this.state, this.state.turn);
    return sideOf(this.state, this.session.mySeat);
  }

  private controllerOf(seat: number) {
    return this.session.players[seat]?.controller ?? 'human';
  }

  private isMyTurn(): boolean {
    return this.controllerOf(this.state.turn) === 'human' && (this.session.kind !== 'online' || this.state.turn === this.session.mySeat);
  }

  private side(): number {
    return sideOf(this.state, this.state.turn);
  }

  private findPlacement(prefer: number): number {
    const side = this.side();
    if (placementValid(this.state, side, prefer)) return prefer;
    for (let i = 1; i <= 100; i++) {
      for (const s of [1, -1]) {
        const t = prefer + s * i * 0.02;
        if (t >= -1 && t <= 1 && placementValid(this.state, side, t)) return t;
      }
    }
    return prefer;
  }

  // ───────────────────────────── turns ─────────────────────────────

  private startTurn(first = false): void {
    if (this.destroyed) return;
    this.world = null;
    this.phase = 'aim';
    this.pendingAuth = null;
    const side = this.side();
    this.aim.t = this.findPlacement(0);
    const fwd = toBoard(side, 0, -1);
    this.aim.dir = { x: fwd.x, y: fwd.y };
    this.aim.power = useSettings.getState().controls === 'point' && this.isMyTurn() ? this.lastPointPower : 0;
    this.coach = null;
    this.remoteAim = null;
    this.snapView();
    this.held.clear();
    if (this.session.kind === 'local') this.renderer.setView(side, first);
    const clock = this.state.config.shotClock;
    if (this.session.kind !== 'online') this.deadline = clock > 0 ? performance.now() + clock * 1000 : null;
    if (!first) audio.play('turn');
    this.pushHud();
    const ctrl = this.controllerOf(this.state.turn);
    if (!first && this.session.kind !== 'practice' && this.session.kind !== 'tutorial' && this.session.kind !== 'challenge') {
      const p = this.session.players[this.state.turn];
      const key = this.session.kind !== 'local' && this.isMyTurn() ? 'hud.yourTurn' : 'hud.turnOf';
      useHud.getState().patch({ banner: { id: ++noteId, key, params: { name: p?.name ?? '' } } });
    }
    if (ctrl === 'ai') void this.runAi();
    if (this.inbox.length) {
      const m = this.inbox.shift()!;
      window.setTimeout(() => this.onServer(m), 0);
    }
  }

  /** Server messages that arrived while a previous shot was still animating. */
  private inbox: ServerMsg[] = [];

  private async runAi(): Promise<void> {
    const token = ++this.aiToken;
    const seat = this.state.turn;
    const diff = this.session.players[seat]?.difficulty ?? this.session.difficulty ?? 'medium';
    useHud.getState().patch({ thinking: true });
    const t0 = performance.now();
    await sleep(350);
    const plan = await chooseShot(this.state, diff, this.state.seed * 31 + this.shots * 977 + seat, () => sleep(0));
    const minThink = { beginner: 700, easy: 800, medium: 950, hard: 1100, expert: 1200 }[diff];
    const wait = minThink - (performance.now() - t0);
    if (wait > 0) await sleep(wait);
    if (token !== this.aiToken || this.destroyed) return;
    while (this.paused) {
      await sleep(100);
      if (token !== this.aiToken || this.destroyed) return;
    }
    useHud.getState().patch({ thinking: false });
    // animate: slide striker, swing aim, draw back power
    const from = { ...this.aim, dir: { ...this.aim.dir } };
    const toLen = Math.sqrt(plan.input.dx ** 2 + plan.input.dy ** 2);
    const to = { x: plan.input.dx / toLen, y: plan.input.dy / toLen };
    const fast = prefersReducedMotion();
    await this.tween(fast ? 1 : 420, (k) => {
      this.aim.t = from.t + (plan.input.t - from.t) * ease(k);
    }, token);
    await this.tween(fast ? 1 : 380, (k) => {
      const e = ease(k);
      const x = from.dir.x + (to.x - from.dir.x) * e;
      const y = from.dir.y + (to.y - from.dir.y) * e;
      const l = Math.sqrt(x * x + y * y) || 1;
      this.aim.dir = { x: x / l, y: y / l };
    }, token);
    await this.tween(fast ? 1 : 330, (k) => {
      this.aim.power = plan.input.power * ease(k);
    }, token);
    if (token !== this.aiToken || this.destroyed) return;
    this.fire(plan.input);
  }

  private tween(ms: number, f: (k: number) => void, token: number): Promise<void> {
    return new Promise((res) => {
      const t0 = performance.now();
      const step = () => {
        if (token !== this.aiToken || this.destroyed) return res();
        const k = Math.min(1, (performance.now() - t0) / ms);
        f(k);
        if (k < 1) requestAnimationFrame(step);
        else res();
      };
      step();
    });
  }

  // ───────────────────────────── shooting ─────────────────────────────

  shoot(): void {
    if (this.phase !== 'aim' || !this.isMyTurn() || this.paused) return;
    if (this.aim.power < 0.02) this.aim.power = 0.55;
    const input: ShotInput = { t: this.aim.t, dx: this.aim.dir.x, dy: this.aim.dir.y, power: this.aim.power };
    if (useSettings.getState().controls === 'point') this.lastPointPower = this.aim.power;
    this.fire(input);
  }

  private fire(input: ShotInput): void {
    const err = validateShot(this.state, input);
    if (err) {
      this.note(err === 'placement' ? 'hud.badPlacement' : 'hud.badDirection', 'bad');
      audio.play('foul', 0.4);
      if (this.controllerOf(this.state.turn) === 'ai') {
        // the AI should never get here; fall back to a safe straight shot
        const side = this.side();
        const fwd = toBoard(side, 0, -1);
        this.fire({ t: this.findPlacement(0), dx: fwd.x, dy: fwd.y, power: 0.5 });
      }
      return;
    }
    if (this.session.kind === 'online' && this.isMyTurn()) {
      this.seq++;
      net.send({ type: 'shoot', input, seq: this.seq });
    }
    this.beginShot(input);
  }

  private beginShot(input: ShotInput): void {
    this.held.clear();
    this.lastInput = { ...input };
    this.lastPre = cloneState(this.state);
    this.world = shotWorld(this.state, input, true);
    this.prev.clear();
    for (const b of this.world.bodies) this.prev.set(b.id, { x: b.x, y: b.y, a: b.a });
    this.acc = 0;
    this.phase = 'moving';
    this.ghostRec = [];
    this.coach = null;
    this.pulling = null;
    this.shots++;
    audio.play('shoot', input.power);
    haptic(12, useSettings.getState().vibration);
    this.pushHud();
  }

  private stepWorld(w: World, dt: number, recordGhost: boolean): void {
    this.acc += dt;
    let n = 0;
    while (this.acc >= DT && n < 40) {
      for (const b of w.bodies) {
        const p = this.prev.get(b.id);
        if (p) (p.x = b.x), (p.y = b.y), (p.a = b.a);
        else this.prev.set(b.id, { x: b.x, y: b.y, a: b.a });
      }
      w.step();
      if (recordGhost && w.steps % 6 === 0 && w.bodies[0].active) this.ghostRec.push({ x: w.bodies[0].x, y: w.bodies[0].y });
      this.acc -= DT;
      n++;
      if (w.isResting()) break;
    }
    if (n >= 40) this.acc = 0;
    this.handleEvents(w);
  }

  private handleEvents(w: World): void {
    const vib = useSettings.getState().vibration;
    const now = performance.now();
    for (const e of w.drainEvents()) {
      if (e.type === 'hit') {
        const k = Math.sqrt(e.impulse / (e.striker ? 26000 : 14000));
        if (now - this.soundGate.coin > 14) {
          audio.play(e.striker ? 'striker' : 'coin', k);
          this.soundGate.coin = now;
        }
        this.renderer.onHit(e.x, e.y, Math.min(1, k));
      } else if (e.type === 'wall') {
        if (now - this.soundGate.wall > 20) {
          audio.play('wall', Math.sqrt(e.impulse / 30000));
          this.soundGate.wall = now;
        }
      } else if (e.type === 'pocket') {
        this.renderer.onPocket(e.kind, e.x, e.y, e.pocket);
        audio.play(e.kind === 'queen' ? 'queen' : 'pocket');
        if (e.kind === 'striker') audio.play('foul');
        haptic(e.kind === 'striker' ? [30, 40, 30] : 22, vib);
      }
    }
  }

  private finishShot(): void {
    const w = this.world!;
    if (this.session.kind === 'online') {
      if (!this.pendingAuth) {
        this.phase = 'waiting';
        this.pushHud();
        return;
      }
      const auth = this.pendingAuth;
      this.state = auth.state;
      this.world = null;
      this.afterOutcome(auth.outcome);
      return;
    }
    const solo = this.session.kind === 'practice' || this.session.kind === 'tutorial' || this.session.kind === 'challenge';
    const out = resolveShot(this.state, this.lastInput, w);
    this.world = null;
    if (solo) {
      this.ghost = this.ghostRec.length > 1 ? this.ghostRec : null;
      this.state.turn = 0;
      if (this.state.phase !== 'aiming') this.state.phase = 'aiming';
      this.state.queen.state = this.state.queen.state === 'pending' ? 'pending' : this.state.queen.state;
    }
    this.afterOutcome(out);
  }

  private afterOutcome(out: ShotOutcome): void {
    for (const id of out.returned) this.renderer.onReturn(id);
    const name = this.session.players[out.seat]?.name ?? '';
    const tone = (n: string): HudNote['tone'] => (n.startsWith('foul') ? 'bad' : n.startsWith('queen.covered') ? 'queen' : n.startsWith('queen') ? 'queen' : n === 'turn.continue' ? 'good' : 'info');
    for (const n of out.notes) {
      if (n === 'board.over' || n === 'match.over') continue;
      if (n === 'turn.continue' && (this.session.kind === 'practice' || this.session.kind === 'challenge')) continue;
      this.note(`note.${n}`, tone(n), { name });
    }
    if (out.notes.includes('queen.covered')) {
      audio.play('cover');
      this.renderer.celebrate();
    }
    if (out.foul) haptic([40, 60, 40], useSettings.getState().vibration);
    if (out.scored >= 3) this.note('note.hatTrick', 'good', { name, n: out.scored });

    const k = this.session.kind;
    if (k === 'tutorial') return this.tutorialAfterShot(out);
    if (k === 'challenge') return this.challengeAfterShot(out);
    if (k === 'practice') {
      if (this.state.coins.every((c) => !c.on)) {
        this.note('note.cleared', 'good');
        window.setTimeout(() => this.resetPractice(), 1200);
      }
      this.startTurn();
      return;
    }
    if (out.matchOver) {
      this.phase = 'over';
      this.pushHud();
      const winTeam = this.state.winner;
      const mine = teamOf(this.session.mySeat);
      const human = k === 'local' || winTeam === mine;
      audio.play(human && winTeam >= 0 ? 'win' : 'lose');
      if (human) this.renderer.celebrate();
      window.setTimeout(() => this.hooks.onEnd(this.state, { shots: this.shots }), 1800);
      return;
    }
    if (out.boardOver) {
      this.phase = 'transition';
      const r = this.state.results[this.state.results.length - 1];
      const winner = r.winner;
      useHud.getState().patch({ banner: { id: ++noteId, key: 'hud.boardWon', params: { team: winner + 1, points: r.points, board: r.board } } });
      this.pushHud();
      if (k !== 'online') {
        window.setTimeout(() => {
          if (this.destroyed) return;
          nextBoard(this.state);
          this.renderer.clearFx();
          this.renderer.startIntro();
          this.startTurn();
        }, 2600);
      }
      return;
    }
    this.phase = 'transition';
    this.pushHud();
    window.setTimeout(() => {
      if (this.destroyed || this.phase !== 'transition') return;
      if (this.session.kind === 'online') {
        this.phase = 'aim';
        this.startTurnOnline();
      } else this.startTurn();
    }, out.continued ? 380 : 650);
  }

  // ───────────────────────────── solo modes ─────────────────────────────

  resetPractice(drill?: string): void {
    if (this.session.kind !== 'practice') return;
    if (drill) this.session = { ...this.session, drill };
    this.aiToken++;
    this.world = null;
    this.state.coins = drillCoins(this.session.drill ?? 'break');
    this.state.queen = { state: 'board', team: -1 };
    this.state.shotNo = (this.session.drill ?? 'break') === 'break' ? 0 : 1;
    this.state.boardPoints = [0, 0];
    this.ghost = null;
    this.renderer.clearFx();
    this.renderer.startIntro();
    this.startTurn(true);
  }

  async suggest(): Promise<void> {
    if (this.phase !== 'aim' || useHud.getState().coachBusy) return;
    useHud.getState().patch({ coachBusy: true });
    const plan = await chooseShot(this.state, 'expert', Date.now() & 0xffff, () => sleep(0));
    useHud.getState().patch({ coachBusy: false });
    if (this.phase !== 'aim') return;
    this.coach = { t: plan.intended.t, dx: plan.intended.dx, dy: plan.intended.dy };
    this.note('note.coach', 'info');
  }

  /** Apply the coach suggestion (practice) */
  useSuggestion(): void {
    if (!this.coach) return;
    this.aim.t = this.coach.t;
    const l = Math.sqrt(this.coach.dx ** 2 + this.coach.dy ** 2);
    this.aim.dir = { x: this.coach.dx / l, y: this.coach.dy / l };
    this.pushHud();
  }

  private tutorialAfterShot(out: ShotOutcome): void {
    const step = this.tutorialStep;
    let advance = false;
    if (step === 1) advance = true;
    if (step === 2) advance = out.pocketed.some((p) => p.kind === 'white');
    if (step === 3) advance = out.notes.includes('queen.covered');
    if (advance) this.setTutorialStep(step + 1);
    else {
      if (step === 2 && this.state.coins.every((c) => !c.on || c.kind !== 'white')) this.state.coins = tutorialCoins(2);
      if (step === 3 && !this.state.coins.some((c) => c.on && c.kind === 'white') && this.state.queen.state !== 'covered') {
        this.state.coins = tutorialCoins(3);
        this.state.queen = { state: 'board', team: -1 };
      }
      this.startTurn();
    }
  }

  setTutorialStep(step: number): void {
    this.tutorialStep = step;
    this.tutorialMoved = 0;
    if (step >= 5) {
      this.hooks.onTutorialDone?.();
      return;
    }
    this.state.coins = tutorialCoins(step);
    this.state.queen = { state: 'board', team: -1 };
    this.state.dues = [0, 0];
    this.renderer.clearFx();
    if (step >= 2) this.renderer.startIntro();
    useHud.getState().patch({ tutorialStep: step });
    this.startTurn(true);
  }

  private challengeAfterShot(out: ShotOutcome): void {
    this.challengeShots++;
    void out;
    const left = this.state.coins.filter((c) => c.on && c.kind === 'white').length;
    const done = left === 0;
    const failed = !done && this.challengeShots >= CHALLENGE_LIMIT;
    useHud.getState().patch({ challenge: { shots: this.challengeShots, limit: CHALLENGE_LIMIT, left, done, failed } });
    if (done || failed) {
      this.challengeDone = true;
      this.phase = 'over';
      audio.play(done ? 'win' : 'lose');
      if (done) this.renderer.celebrate();
      this.pushHud();
      return;
    }
    this.startTurn();
  }

  restartChallenge(): void {
    this.challengeShots = 0;
    this.challengeDone = false;
    this.state.coins = challengeCoins();
    this.state.queen = { state: 'board', team: -1 };
    this.renderer.clearFx();
    this.renderer.startIntro();
    useHud.getState().patch({ challenge: { shots: 0, limit: CHALLENGE_LIMIT, left: 5, done: false, failed: false } });
    this.startTurn(true);
  }

  get challengeFinished(): boolean {
    return this.challengeDone;
  }

  // ───────────────────────────── replay ─────────────────────────────

  replay(): void {
    if (this.phase !== 'aim' || !this.lastPre || !this.lastInput || this.session.kind === 'online') return;
    this.aiToken++;
    useHud.getState().patch({ thinking: false });
    const pre = cloneState(this.lastPre);
    this.replayWorld = shotWorld(pre, this.lastInput, true);
    this.prev.clear();
    for (const b of this.replayWorld.bodies) this.prev.set(b.id, { x: b.x, y: b.y, a: b.a });
    this.acc = 0;
    this.phase = 'replay';
    this.pushHud();
  }

  // ───────────────────────────── pause / clock ─────────────────────────────

  setPaused(p: boolean): void {
    if (p === this.paused) return;
    this.paused = p;
    if (this.session.kind === 'online') return;
    if (p && this.deadline) this.pausedLeft = this.deadline - performance.now();
    if (!p && this.pausedLeft !== null) {
      this.deadline = performance.now() + this.pausedLeft;
      this.pausedLeft = null;
    }
  }

  private tickClock(): void {
    if (this.destroyed) return;
    const total = this.state.config.shotClock * 1000;
    if (this.deadline === null || this.phase !== 'aim') {
      if (useHud.getState().clockMs !== null) useHud.getState().patch({ clockMs: null });
      return;
    }
    const left = this.paused && this.pausedLeft !== null ? this.pausedLeft : this.deadline - performance.now();
    useHud.getState().patch({ clockMs: Math.max(0, Math.min(left, total)), clockTotal: total });
    if (left <= 0 && this.session.kind !== 'online' && !this.paused) {
      this.aiToken++;
      useHud.getState().patch({ thinking: false });
      const out = resolveTimeout(this.state);
      this.deadline = null;
      audio.play('foul', 0.5);
      this.afterOutcome(out);
    }
  }

  // ───────────────────────────── online ─────────────────────────────

  private bindNet(): void {
    this.unsub.push(
      net.on((m: ServerMsg) => this.onServer(m)),
      net.onStatus((s) => useHud.getState().patch({ network: s === 'open' ? 'ok' : s === 'failed' ? 'offline' : 'reconnecting' })),
    );
    useHud.getState().patch({ network: net.status === 'open' ? 'ok' : 'reconnecting' });
  }

  private setServerClock(ms: number | null): void {
    this.deadline = ms === null ? null : performance.now() + ms;
  }

  private startTurnOnline(): void {
    this.startTurn();
  }

  private onServer(m: ServerMsg): void {
    if (this.destroyed) return;
    switch (m.type) {
      case 'state':
      case 'start': {
        // full resync (reconnect, next board)
        const st = m.state;
        this.world = null;
        this.inbox = [];
        this.state = st;
        this.setServerClock(m.turnMs);
        this.renderer.clearFx();
        if (m.type === 'start') this.renderer.startIntro();
        this.startTurn(true);
        this.setServerClock(m.turnMs);
        break;
      }
      case 'shot': {
        const auth = { state: m.state, outcome: m.outcome };
        if (this.phase === 'moving' && m.seat === this.session.mySeat && !this.pendingAuth) {
          // our predicted shot — the server result replaces local resolution at rest
          this.pendingAuth = auth;
        } else if (this.phase === 'waiting' && !this.pendingAuth) {
          this.pendingAuth = auth;
          this.finishShot();
        } else if (this.phase === 'moving' || this.phase === 'transition' || this.phase === 'waiting') {
          this.inbox.push(m);
          return;
        } else {
          // someone else's shot: replay it locally from the agreed state, then reconcile
          this.aiToken++;
          this.beginShot(m.input);
          this.pendingAuth = auth;
        }
        this.setServerClock(m.turnMs);
        break;
      }
      case 'timeout': {
        if (this.phase === 'moving' || this.phase === 'transition' || this.phase === 'waiting') {
          this.inbox.push(m);
          return;
        }
        this.state = m.state;
        this.setServerClock(m.turnMs);
        this.afterOutcome(m.outcome);
        break;
      }
      case 'preview':
        if (m.seat !== this.session.mySeat && this.phase === 'aim') this.remoteAim = { t: m.t, dx: m.dx, dy: m.dy, power: m.power };
        break;
      case 'emoji':
        this.react(m.seat, m.emoji, false);
        break;
      case 'presence': {
        const p = this.session.players[m.seat];
        if (p) {
          this.connected[m.seat] = m.connected;
          this.note(m.connected ? 'note.reconnected' : 'note.disconnected', m.connected ? 'good' : 'bad', { name: p.name });
          this.pushHud();
        }
        break;
      }
      case 'over':
        this.phase = 'over';
        this.state = m.state;
        this.pushHud();
        audio.play(m.winner === teamOf(this.session.mySeat) ? 'win' : 'lose');
        if (m.winner === teamOf(this.session.mySeat)) this.renderer.celebrate();
        window.setTimeout(() => this.hooks.onEnd(this.state, { forfeit: m.forfeit, ratings: m.ratings, shots: this.shots }), 1600);
        break;
      case 'error':
        if (m.code === 'not_your_turn' || m.code === 'invalid_shot') {
          this.note('hud.rejected', 'bad');
        }
        break;
    }
  }

  private connected: Record<number, boolean> = {};

  private sendPreview(): void {
    if (this.session.kind !== 'online' || !this.isMyTurn()) return;
    const now = performance.now();
    const gap = useSettings.getState().lowData ? 400 : 110;
    if (now - this.previewAt < gap) return;
    this.previewAt = now;
    net.send({ type: 'preview', t: this.aim.t, dx: this.aim.dir.x, dy: this.aim.dir.y, power: this.aim.power });
  }

  react(seat: number, emoji: string, send = true): void {
    const id = ++noteId;
    const list = [...useHud.getState().reactions.slice(-5), { id, seat, emoji }];
    useHud.getState().patch({ reactions: list });
    window.setTimeout(() => useHud.getState().patch({ reactions: useHud.getState().reactions.filter((r) => r.id !== id) }), 2600);
    if (send && this.session.kind === 'online') net.send({ type: 'emoji', emoji });
  }

  // ───────────────────────────── HUD ─────────────────────────────

  private note(key: string, tone: HudNote['tone'], params?: Record<string, string | number>): void {
    const id = ++noteId;
    const notes = [...useHud.getState().notes.slice(-2), { id, key, params, tone }];
    useHud.getState().patch({ notes });
    window.setTimeout(() => useHud.getState().patch({ notes: useHud.getState().notes.filter((n) => n.id !== id) }), 2600);
  }

  /** Mark the HUD stale; it is written at most once per animation frame. */
  private pushHud(): void {
    this.hudDirty = true;
  }

  private flushHud(): void {
    this.hudDirty = false;
    const s = this.state;
    const players = this.session.players.map((p, seat) => {
      const team = teamOf(seat);
      const color = s.config.variant === 'freestyle' ? null : colorOf(s, team);
      return {
        name: p.name,
        avatar: p.avatar,
        team,
        color,
        remaining: remainingFor(s, team),
        pocketed: s.config.variant === 'freestyle' ? s.boardPoints[team] : 9 - remainingFor(s, team),
        controller: p.controller,
        connected: this.connected[seat] ?? true,
        side: sideOf(s, seat),
      };
    });
    useHud.getState().patch({
      players,
      turn: s.turn,
      mySeat: this.session.mySeat,
      scores: [...s.scores] as [number, number],
      boardPoints: [...s.boardPoints] as [number, number],
      board: s.board,
      target: s.config.targetPoints,
      variant: s.config.variant,
      queen: s.queen.state,
      queenTeam: s.queen.team,
      power: this.aim.power,
      t: this.aim.t,
      validPlacement: placementValid(s, this.side(), this.aim.t),
      canShoot: this.phase === 'aim' && this.isMyTurn(),
      phase: this.phase,
      replayable: !!this.lastPre && this.session.kind !== 'online',
      shotsThisBoard: s.shotNo,
    });
  }

  // ───────────────────────────── input ─────────────────────────────

  private hudDirty = true;
  /** What the player sees. It eases toward the real aim so every input glides instead of jumping. */
  private view = { t: 0, dx: 0, dy: -1, power: 0 };
  private held = new Set<string>();
  private heldFor = 0;
  private fine = false;
  /** Offset between the finger and the striker centre along the baseline (t units). */
  private grabDx = 0;
  private powerTick = 0;
  private lastPointPower = 0.5;

  private snapView(): void {
    this.view = { t: this.aim.t, dx: this.aim.dir.x, dy: this.aim.dir.y, power: this.aim.power };
  }

  /** Nearest legal spot to `target`: the striker slides around coins instead of sitting on them. */
  private resolvePlacement(target: number): number {
    const side = this.side();
    const t = Math.max(-1, Math.min(1, target));
    if (placementValid(this.state, side, t)) return t;
    const first = this.aim.t <= t ? -1 : 1; // prefer the side the striker is coming from
    for (let i = 1; i <= 250; i++) {
      for (const dir of [first, -first]) {
        const c = t + dir * i * 0.004;
        if (c >= -1 && c <= 1 && placementValid(this.state, side, c)) return c;
      }
    }
    return t;
  }

  setPlacement(t: number): void {
    if (this.phase !== 'aim' || !this.isMyTurn()) return;
    const c = this.resolvePlacement(t);
    const moved = Math.abs(c - this.aim.t);
    if (moved < 1e-6) return;
    if (moved > 0.004) audio.play('place');
    this.tutorialMoved += moved;
    this.aim.t = c;
    if (this.tutorialStep === 0 && this.session.kind === 'tutorial' && this.tutorialMoved > 0.35) this.setTutorialStep(1);
    this.sendPreview();
    this.pushHud();
  }

  setPower(p: number): void {
    if (this.phase !== 'aim' || !this.isMyTurn()) return;
    this.aim.power = Math.max(0, Math.min(1, p));
    this.powerFeedback();
    this.sendPreview();
    this.pushHud();
  }

  /** A soft tick and a tiny buzz each time power crosses a 10% step. */
  private powerFeedback(): void {
    const tick = Math.floor(this.aim.power * 10 + 1e-6);
    if (tick === this.powerTick) return;
    this.powerTick = tick;
    if (this.aim.power > 0) {
      audio.play('tick', this.aim.power);
      haptic(tick >= 10 ? 12 : 4, useSettings.getState().vibration);
    }
  }

  rotateAim(rad: number): void {
    if (this.phase !== 'aim' || !this.isMyTurn()) return;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const d = { x: this.aim.dir.x * c - this.aim.dir.y * s, y: this.aim.dir.x * s + this.aim.dir.y * c };
    if (directionValid(this.side(), d.x, d.y)) this.aim.dir = d;
    this.sendPreview();
  }

  pointerDown(px: number, py: number, id: number): boolean {
    if (this.phase !== 'aim' || !this.isMyTurn() || this.paused) return false;
    audio.unlock();
    const p = this.renderer.toBoard(px, py);
    const side = this.side();
    const sp = strikerPos(side, this.aim.t);
    const d = Math.sqrt((p.x - sp.x) ** 2 + (p.y - sp.y) ** 2);
    const local = toLocal(side, p.x, p.y);
    const minGrab = Math.max(STRIKER_R * 1.7, 26 / this.renderer.S);
    this.pointer = { mode: null, id, startPx: { x: px, y: py } };
    this.powerTick = Math.floor(this.aim.power * 10);
    if (d < minGrab) {
      // pressing the striker: pull back to shoot, or slide sideways to place it
      this.pointer.mode = 'pull';
      this.grabDx = local.x / BOARD.baseHalf - this.aim.t;
    } else if (Math.abs(local.y - BOARD.baseline) < Math.max(40, 30 / this.renderer.S) && Math.abs(local.x) < BOARD.baseHalf + 40) {
      this.pointer.mode = 'place';
      this.grabDx = 0;
      this.setPlacement(local.x / BOARD.baseHalf);
    } else {
      this.pointer.mode = 'point';
      this.pointAt(p.x, p.y);
    }
    return true;
  }

  private pointAt(x: number, y: number): void {
    const sp = strikerPos(this.side(), this.aim.t);
    const dx = x - sp.x;
    const dy = y - sp.y;
    const l = Math.sqrt(dx * dx + dy * dy);
    if (l < 1) return;
    if (directionValid(this.side(), dx, dy)) this.aim.dir = { x: dx / l, y: dy / l };
    if (this.aim.power === 0 && useSettings.getState().controls === 'point') this.aim.power = this.lastPointPower;
    this.sendPreview();
    this.pushHud();
  }

  /** Pixels of pull before power starts; releasing inside it cancels. */
  private static DEADZONE = 14;

  private pullReach(): number {
    return Math.max(110, Math.min(280, Math.min(this.renderer.w, this.renderer.h) * 0.34));
  }

  pointerMove(px: number, py: number, id: number): void {
    if (this.pointer.id !== id || !this.pointer.mode || this.phase !== 'aim') return;
    const p = this.renderer.toBoard(px, py);
    const side = this.side();
    if (this.pointer.mode === 'place') {
      const local = toLocal(side, p.x, p.y);
      this.setPlacement(local.x / BOARD.baseHalf - this.grabDx);
      return;
    }
    if (this.pointer.mode === 'point') {
      this.pointAt(p.x, p.y);
      return;
    }
    const sp = strikerPos(side, this.aim.t);
    const rel = toLocal(side, p.x - sp.x, p.y - sp.y);
    const pxDist = Math.hypot(px - this.pointer.startPx.x, py - this.pointer.startPx.y);
    // decide once what this drag is: a sideways slide places the striker, anything else pulls
    if (!this.pulling) {
      if (pxDist < 8) return;
      if (Math.abs(rel.x) > 1.4 * Math.abs(rel.y)) {
        this.pointer.mode = 'place';
        this.setPlacement(toLocal(side, p.x, p.y).x / BOARD.baseHalf - this.grabDx);
        return;
      }
    }
    const dx = sp.x - p.x;
    const dy = sp.y - p.y;
    const l = Math.sqrt(dx * dx + dy * dy);
    const dPx = l * this.renderer.S;
    this.aim.power = Math.max(0, Math.min(1, (dPx - GameController.DEADZONE) / this.pullReach()));
    // close to the striker a few pixels swing the angle a lot, so steady it there
    if (l > 1 && directionValid(side, dx, dy)) {
      const w = Math.max(0.2, Math.min(1, (dPx - GameController.DEADZONE) / 70));
      const nx = this.aim.dir.x + (dx / l - this.aim.dir.x) * w;
      const ny = this.aim.dir.y + (dy / l - this.aim.dir.y) * w;
      const nl = Math.sqrt(nx * nx + ny * ny) || 1;
      if (directionValid(side, nx, ny)) this.aim.dir = { x: nx / nl, y: ny / nl };
    }
    this.pulling = p;
    this.powerFeedback();
    this.sendPreview();
    this.pushHud();
  }

  pointerUp(id: number): void {
    if (this.pointer.id !== id) return;
    const mode = this.pointer.mode;
    this.pointer = { mode: null, id: -1, startPx: { x: 0, y: 0 } };
    if (mode === 'pull') {
      this.pulling = null;
      if (this.aim.power > 0.02) this.shoot();
      else {
        this.aim.power = 0;
        this.pushHud();
      }
    }
  }

  private static HOLD_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'A', 'd', 'D', ',', '.']);

  key(e: KeyboardEvent): boolean {
    const k = e.key;
    if (k === 'Escape' || k === 'p' || k === 'P') return false; // handled by UI (pause)
    this.fine = e.shiftKey;
    if (this.phase !== 'aim' || !this.isMyTurn() || this.paused) return false;
    if (GameController.HOLD_KEYS.has(k)) {
      if (!e.repeat && !this.held.has(k)) {
        // a tap nudges by a fixed small step; holding glides (see stepHeld)
        this.held.add(k);
        this.heldFor = 0;
        this.applyKey(k, this.fine ? 0.25 : 1, 0.02);
      }
      return true;
    }
    if ((k === ' ' || k === 'Enter') && !e.repeat) {
      this.shoot();
      return true;
    }
    return false;
  }

  keyUp(e: KeyboardEvent): void {
    this.fine = e.shiftKey;
    this.held.delete(e.key);
    // letters arrive in either case depending on Shift
    this.held.delete(e.key.toLowerCase());
    this.held.delete(e.key.toUpperCase());
  }

  releaseKeys(): void {
    this.held.clear();
  }

  /** Move by `rate` units for `dt` seconds of a given key. */
  private applyKey(k: string, scale: number, dt: number): void {
    const step = scale * dt;
    switch (k) {
      case 'ArrowLeft':
        return this.setPlacement(this.aim.t - 0.32 * step);
      case 'ArrowRight':
        return this.setPlacement(this.aim.t + 0.32 * step);
      case 'a':
      case 'A':
      case ',':
        return this.rotateAim(-0.22 * step);
      case 'd':
      case 'D':
      case '.':
        return this.rotateAim(0.22 * step);
      case 'ArrowUp':
        return this.setPower(this.aim.power + 0.5 * step);
      case 'ArrowDown':
        return this.setPower(this.aim.power - 0.5 * step);
    }
  }

  /** Held keys glide at a speed that ramps up, so short holds stay precise and long holds travel fast. */
  private stepHeld(dt: number): void {
    if (!this.held.size) return;
    if (this.phase !== 'aim' || !this.isMyTurn() || this.paused) {
      this.held.clear();
      return;
    }
    this.heldFor += dt;
    if (this.heldFor < 0.18) return;
    const ramp = Math.min(1, 0.3 + (this.heldFor - 0.18) * 1.4);
    const scale = (this.fine ? 0.22 : 1) * ramp * 2.2;
    for (const k of this.held) this.applyKey(k, scale, dt);
  }

  /** Ease the visible striker, aim and power toward their targets (local input or remote preview). */
  private easeView(dt: number): void {
    const remote = !this.isMyTurn() && this.remoteAim ? this.remoteAim : null;
    const src = remote ?? { t: this.aim.t, dx: this.aim.dir.x, dy: this.aim.dir.y, power: this.aim.power };
    const v = this.view;
    // remote previews arrive ~9 times a second, so blend them more slowly
    const k = 1 - Math.exp(-dt * (remote ? 12 : 32));
    const kp = 1 - Math.exp(-dt * (remote ? 12 : 45));
    v.t += (src.t - v.t) * k;
    if (Math.abs(src.t - v.t) < 1e-4) v.t = src.t;
    const nx = v.dx + (src.dx - v.dx) * k;
    const ny = v.dy + (src.dy - v.dy) * k;
    const nl = Math.sqrt(nx * nx + ny * ny) || 1;
    v.dx = nx / nl;
    v.dy = ny / nl;
    v.power += (src.power - v.power) * kp;
    if (Math.abs(src.power - v.power) < 1e-3) v.power = src.power;
  }

  // ───────────────────────────── frame ─────────────────────────────

  private frame = (now: number): void => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.frame);
    const raw = (now - this.last) / 1000;
    const cap = useSettings.getState().fps === 60 ? 1 / 62 : 0;
    if (cap && raw < cap) return;
    this.last = now;
    const dt = Math.min(0.1, raw);
    if (!this.paused || this.session.kind === 'online') {
      if (this.phase === 'moving' && this.world) {
        this.stepWorld(this.world, dt, true);
        if (this.world.isResting()) this.finishShot();
      } else if (this.phase === 'replay' && this.replayWorld) {
        this.stepWorld(this.replayWorld, dt, false);
        if (this.replayWorld.isResting()) {
          this.replayWorld = null;
          this.phase = 'aim';
          this.renderer.clearFx();
          this.pushHud();
          if (this.controllerOf(this.state.turn) === 'ai') void this.runAi();
        }
      }
    }
    this.stepHeld(dt);
    this.easeView(dt);
    if (this.hudDirty) this.flushHud();
    this.renderer.render(this.renderBodies(), this.aimView(), dt);
  };

  private alpha(): number {
    return Math.min(1, this.acc / DT);
  }

  private renderBodies(): RenderBody[] {
    const w = this.phase === 'replay' ? this.replayWorld : this.world;
    if (w) {
      const a = this.alpha();
      return w.bodies.map((b) => {
        const p = this.prev.get(b.id);
        const x = p ? p.x + (b.x - p.x) * a : b.x;
        const y = p ? p.y + (b.y - p.y) * a : b.y;
        const ang = p ? p.a + (b.a - p.a) * a : b.a;
        return { id: b.id, kind: b.kind, x, y, a: ang, active: b.active, speed: Math.sqrt(b.vx * b.vx + b.vy * b.vy) };
      });
    }
    const sp = strikerPos(this.side(), this.view.t);
    const out: RenderBody[] = [{ id: 0, kind: 'striker', x: sp.x, y: sp.y, a: 0, active: this.phase !== 'over' || this.session.kind === 'challenge', speed: 0 }];
    for (const c of this.state.coins) if (c.on) out.push({ id: c.id, kind: c.kind, x: c.x, y: c.y, a: c.a, active: true, speed: 0 });
    return out;
  }

  private aimView(): AimView | null {
    if (this.phase === 'over' || this.phase === 'transition') return null;
    const moving = this.phase === 'moving' || this.phase === 'replay' || this.phase === 'waiting';
    const mine = this.isMyTurn();
    const s = useSettings.getState();
    const solo = this.session.kind === 'practice' || this.session.kind === 'tutorial';
    const remote = !mine && this.remoteAim;
    const ai = this.controllerOf(this.state.turn) === 'ai';
    const v = this.view;
    const targetT = remote ? this.remoteAim!.t : this.aim.t;
    const dir = remote || mine || ai ? { x: v.dx, y: v.dy } : null;
    return {
      side: this.side(),
      t: v.t,
      valid: placementValid(this.state, this.side(), targetT),
      dir: ai && this.aim.power === 0 ? null : dir,
      power: v.power,
      guide: solo ? 'full' : mine ? s.guide : 'short',
      interactive: mine && !moving,
      pulling: this.pulling,
      cancel: mine && this.pointer.mode === 'pull' && this.pulling !== null && this.aim.power === 0,
      coach: this.coach,
      ghost: this.session.kind === 'practice' ? this.ghost : null,
      moving,
    };
  }
}

const ease = (k: number) => 1 - Math.pow(1 - k, 3);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
