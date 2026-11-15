/**
 * A self-playing table for the main menu: two AI players play a real match with the
 * same physics and rules as the game, drawn by the same renderer. No input, no sound.
 */
import { PHYS } from '../core/constants';
import { chooseShot } from '../core/ai';
import { World } from '../core/physics';
import { MatchState, PRESETS, ShotInput, colorOf, createMatch, onBoardCount, resolveShot, shotWorld, sideOf, strikerPos, toBoard } from '../core/rules';
import { AimView, RenderBody, Renderer } from './renderer';

export interface DemoStatus {
  turn: number;
  /** Coins still on the board for seat 0 and seat 1. */
  left: [number, number];
  colors: ['white' | 'black', 'white' | 'black'];
}

const DT = PHYS.dt;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const ease = (k: number) => 1 - Math.pow(1 - k, 3);

export class DemoTable {
  private renderer: Renderer;
  private state: MatchState;
  private world: World | null = null;
  private prev = new Map<number, { x: number; y: number; a: number }>();
  private acc = 0;
  private last = 0;
  private raf = 0;
  private alive = true;
  private aim = { t: 0, dx: 0, dy: -1, power: 0 };
  private showAim = false;
  private input: ShotInput | null = null;
  private shots = 0;

  constructor(
    canvas: HTMLCanvasElement,
    board: HTMLCanvasElement,
    look: { theme: string; striker: string; reducedMotion: boolean },
    private onStatus: (s: DemoStatus) => void,
    private animate: boolean,
  ) {
    this.renderer = new Renderer(canvas, board);
    this.renderer.setLook(look.theme, look.striker, 'high', look.reducedMotion);
    this.state = createMatch(PRESETS.gedara, 2, (Math.random() * 1e9) | 0);
  }

  start(): void {
    this.renderer.startIntro();
    this.report();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    if (this.animate) void this.loop();
  }

  destroy(): void {
    this.alive = false;
    cancelAnimationFrame(this.raf);
  }

  resize(size: number): void {
    this.renderer.resize(size, size, Math.min(window.devicePixelRatio || 1, 2));
  }

  setLook(theme: string, striker: string, reducedMotion: boolean): void {
    this.renderer.setLook(theme, striker, 'high', reducedMotion);
  }

  private report(): void {
    const s = this.state;
    this.onStatus({
      turn: s.turn,
      left: [onBoardCount(s, colorOf(s, 0)), onBoardCount(s, colorOf(s, 1))],
      colors: [colorOf(s, 0), colorOf(s, 1)],
    });
  }

  private async tween(ms: number, f: (k: number) => void): Promise<void> {
    const t0 = performance.now();
    while (this.alive) {
      const k = Math.min(1, (performance.now() - t0) / ms);
      f(ease(k));
      if (k >= 1) return;
      await new Promise((r) => requestAnimationFrame(r));
    }
  }

  private async loop(): Promise<void> {
    await sleep(900);
    while (this.alive) {
      while (this.alive && document.hidden) await sleep(500); // don't burn battery in a background tab
      const s = this.state;
      const side = sideOf(s, s.turn);
      const fwd = toBoard(side, 0, -1);
      this.aim = { t: 0, dx: fwd.x, dy: fwd.y, power: 0 };
      this.showAim = true;
      // a relaxed home game: one strong player, one average
      const plan = await chooseShot(s, s.turn === 0 ? 'hard' : 'medium', s.seed + this.shots * 131, () => sleep(0));
      await sleep(500);
      if (!this.alive) return;
      const len = Math.sqrt(plan.input.dx ** 2 + plan.input.dy ** 2) || 1;
      const from = { ...this.aim };
      await this.tween(520, (k) => {
        this.aim.t = from.t + (plan.input.t - from.t) * k;
        const x = from.dx + (plan.input.dx / len - from.dx) * k;
        const y = from.dy + (plan.input.dy / len - from.dy) * k;
        const l = Math.sqrt(x * x + y * y) || 1;
        this.aim.dx = x / l;
        this.aim.dy = y / l;
      });
      await this.tween(380, (k) => (this.aim.power = plan.input.power * k));
      if (!this.alive) return;
      this.input = plan.input;
      this.world = shotWorld(s, plan.input, true);
      this.prev.clear();
      this.acc = 0;
      this.shots++;
      while (this.alive && this.world) await sleep(60);
      await sleep(450);
      if (this.state.phase !== 'aiming') {
        // board finished: admire it, then rack up again
        await sleep(2200);
        this.state = createMatch(PRESETS.gedara, 2, (Math.random() * 1e9) | 0);
        this.renderer.clearFx();
        this.renderer.startIntro();
        this.report();
        await sleep(900);
      }
    }
  }

  private frame = (now: number): void => {
    if (!this.alive) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const w = this.world;
    if (w) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= DT && n < 40) {
        for (const b of w.bodies) {
          const p = this.prev.get(b.id);
          if (p) (p.x = b.x), (p.y = b.y), (p.a = b.a);
          else this.prev.set(b.id, { x: b.x, y: b.y, a: b.a });
        }
        w.step();
        this.acc -= DT;
        n++;
        if (w.isResting()) break;
      }
      if (n >= 40) this.acc = 0;
      for (const e of w.drainEvents()) if (e.type === 'pocket') this.renderer.onPocket(e.kind, e.x, e.y, e.pocket);
      if (w.isResting()) {
        const out = resolveShot(this.state, this.input, w);
        for (const id of out.returned) this.renderer.onReturn(id);
        this.world = null;
        this.showAim = false;
        this.report();
      }
    }
    this.renderer.render(this.bodies(), this.aimView(), dt);
  };

  private bodies(): RenderBody[] {
    const w = this.world;
    if (w) {
      const a = Math.min(1, this.acc / DT);
      return w.bodies.map((b) => {
        const p = this.prev.get(b.id);
        return {
          id: b.id,
          kind: b.kind,
          x: p ? p.x + (b.x - p.x) * a : b.x,
          y: p ? p.y + (b.y - p.y) * a : b.y,
          a: p ? p.a + (b.a - p.a) * a : b.a,
          active: b.active,
          speed: Math.sqrt(b.vx * b.vx + b.vy * b.vy),
        };
      });
    }
    const out: RenderBody[] = [];
    if (this.showAim) {
      const sp = strikerPos(sideOf(this.state, this.state.turn), this.aim.t);
      out.push({ id: 0, kind: 'striker', x: sp.x, y: sp.y, a: 0, active: true, speed: 0 });
    }
    for (const c of this.state.coins) if (c.on) out.push({ id: c.id, kind: c.kind, x: c.x, y: c.y, a: c.a, active: true, speed: 0 });
    return out;
  }

  private aimView(): AimView | null {
    if (!this.showAim) return null;
    return {
      side: sideOf(this.state, this.state.turn),
      t: this.aim.t,
      valid: true,
      dir: this.aim.power > 0 ? { x: this.aim.dx, y: this.aim.dy } : null,
      power: this.aim.power,
      guide: 'short',
      interactive: false,
      pulling: null,
      coach: null,
      ghost: null,
      moving: this.world !== null,
    };
  }
}
