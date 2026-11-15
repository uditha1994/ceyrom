/**
 * Canvas renderer. Draws interpolated physics state with cached textures,
 * plus aim guide, power ring, trails, powder particles and pocket animations.
 * It reads state; it never changes the simulation.
 */
import { BOARD, COIN_R, POCKETS, STRIKER_R } from '../core/constants';
import { Kind } from '../core/physics';
import { strikerPos } from '../core/rules';
import { boardTheme } from './themes';
import { boardTexture, bodySprite, highlightSprite, shadowSprite } from './textures';

export interface RenderBody {
  id: number;
  kind: Kind;
  x: number;
  y: number;
  a: number;
  active: boolean;
  speed: number;
}

export interface AimView {
  side: number;
  t: number;
  valid: boolean;
  dir: { x: number; y: number } | null;
  power: number;
  guide: 'full' | 'short' | 'off';
  /** Show striker placement handle (active human) */
  interactive: boolean;
  pulling: { x: number; y: number } | null;
  coach: { t: number; dx: number; dy: number } | null;
  ghost: { x: number; y: number }[] | null;
  /** true when the shot is in flight (hide aim UI) */
  moving: boolean;
  /** Pulling, but back inside the cancel zone: release does nothing. */
  cancel?: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
}

interface PocketAnim {
  kind: Kind;
  x: number;
  y: number;
  px: number;
  py: number;
  t: number;
  a: number;
}

export interface Obstacle {
  id: number;
  x: number;
  y: number;
  r: number;
}

const FULL = BOARD.half + BOARD.frame;

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  w = 0;
  h = 0;
  dpr = 1;
  S = 1; // css px per mm
  cx = 0;
  cy = 0;
  angle = 0;
  targetAngle = 0;
  themeId = 'jak';
  skin = 'ivory';
  quality: 'high' | 'low' = 'high';
  reducedMotion = false;
  private boardTex: HTMLCanvasElement | null = null;
  /** Static board layer: drawn once per size/theme, rotated and faded by CSS (GPU compositing). */
  private bg: HTMLCanvasElement | null;
  private bgDirty = true;
  private bgStyle = '';
  private sprites = new Map<string, HTMLCanvasElement>();
  private particles: Particle[] = [];
  private pockets: PocketAnim[] = [];
  private returns = new Map<number, number>();
  private trails = new Map<number, { x: number; y: number }[]>();
  private intro = 0;
  private flash: { pocket: number; t: number; gold: boolean }[] = [];
  private time = 0;

  constructor(canvas: HTMLCanvasElement, bg: HTMLCanvasElement | null = null) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true })!;
    this.bg = bg;
  }

  setLook(themeId: string, skin: string, quality: 'high' | 'low', reducedMotion: boolean): void {
    const changed = themeId !== this.themeId || skin !== this.skin || quality !== this.quality;
    this.themeId = themeId;
    this.skin = skin;
    this.quality = quality;
    this.reducedMotion = reducedMotion;
    if (changed) this.invalidate();
  }

  invalidate(): void {
    this.boardTex = null;
    this.sprites.clear();
    this.bgDirty = true;
  }

  resize(w: number, h: number, dpr: number): void {
    const d = this.quality === 'low' ? 1 : Math.min(dpr, 2);
    if (w === this.w && h === this.h && d === this.dpr) return;
    this.w = w;
    this.h = h;
    this.dpr = d;
    this.canvas.width = Math.round(w * d);
    this.canvas.height = Math.round(h * d);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    if (this.bg) {
      this.bg.width = Math.round(w * d);
      this.bg.height = Math.round(h * d);
      this.bg.style.width = `${w}px`;
      this.bg.style.height = `${h}px`;
    }
    this.S = Math.min(w, h) / (2 * FULL);
    this.cx = w / 2;
    this.cy = h / 2;
    this.invalidate();
  }

  setView(side: number, instant = false): void {
    const target = (side * Math.PI) / 2;
    // shortest rotation
    let delta = target - (this.targetAngle % (Math.PI * 2));
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.targetAngle += delta;
    if (instant || this.reducedMotion) this.angle = this.targetAngle;
  }

  startIntro(): void {
    this.intro = this.reducedMotion ? 1 : 0;
  }

  toScreen(x: number, y: number): { x: number; y: number } {
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    return { x: this.cx + this.S * (x * c - y * s), y: this.cy + this.S * (x * s + y * c) };
  }

  toBoard(px: number, py: number): { x: number; y: number } {
    const x = (px - this.cx) / this.S;
    const y = (py - this.cy) / this.S;
    const c = Math.cos(-this.angle);
    const s = Math.sin(-this.angle);
    return { x: x * c - y * s, y: x * s + y * c };
  }

  private sprite(key: string, make: () => HTMLCanvasElement): HTMLCanvasElement {
    let s = this.sprites.get(key);
    if (!s) {
      s = make();
      this.sprites.set(key, s);
    }
    return s;
  }

  private texScale(): number {
    return Math.min(this.S * this.dpr, 2.6);
  }

  onPocket(kind: Kind, x: number, y: number, pocket: number): void {
    const P = POCKETS[pocket];
    this.pockets.push({ kind, x, y, px: P.x, py: P.y, t: 0, a: 0 });
    this.flash.push({ pocket, t: 0, gold: kind === 'queen' });
    if (this.quality === 'high') this.burst(P.x, P.y, kind === 'queen' ? 22 : 10, kind === 'queen' ? '#D9B978' : '#E8D9BC', 140);
  }

  onReturn(id: number): void {
    this.returns.set(id, 0);
  }

  /** intensity 0..1 — a puff of carrom powder on hard contacts */
  onHit(x: number, y: number, intensity: number): void {
    if (this.quality !== 'high' || this.reducedMotion) return;
    const n = Math.min(7, Math.floor(intensity * 8));
    if (n > 0) this.burst(x, y, n, '#F4ECDC', 50 + intensity * 150);
  }

  celebrate(): void {
    if (this.quality !== 'high') return;
    for (const P of POCKETS) this.burst(P.x * 0.6, P.y * 0.6, 18, '#C6A878', 260);
    this.burst(0, 0, 30, '#E8D9BC', 320);
  }

  private burst(bx: number, by: number, n: number, color: string, speed: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({ x: bx, y: by, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.35 + Math.random() * 0.5, size: 0.6 + Math.random() * 1.6, color });
    }
  }

  clearFx(): void {
    this.particles = [];
    this.pockets = [];
    this.trails.clear();
    this.returns.clear();
  }

  render(bodies: RenderBody[], aim: AimView | null, dt: number): void {
    this.time += dt;
    const ctx = this.ctx;
    const S = this.S;
    // view rotation easing
    const diff = this.targetAngle - this.angle;
    if (Math.abs(diff) > 0.0005) this.angle += diff * Math.min(1, dt * 5.5);
    else this.angle = this.targetAngle;
    if (this.intro < 1) this.intro = Math.min(1, this.intro + dt / 0.65);
    const ease = 1 - Math.pow(1 - this.intro, 3);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.boardTex) this.boardTex = boardTexture(boardTheme(this.themeId), this.texScale());
    const zoom = 0.94 + 0.06 * ease;

    // board: a separate, static layer when available (no per-frame blit of the big texture)
    if (this.bg) {
      if (this.bgDirty) this.drawBg();
      const style = `rotate(${this.angle.toFixed(4)}rad) scale(${zoom.toFixed(4)})|${ease.toFixed(3)}`;
      if (style !== this.bgStyle) {
        this.bgStyle = style;
        const [tf, op] = style.split('|');
        this.bg.style.transform = tf;
        this.bg.style.opacity = op;
      }
    }
    ctx.save();
    ctx.globalAlpha = ease;
    ctx.translate(this.cx, this.cy);
    ctx.scale(zoom, zoom);
    ctx.rotate(this.angle);
    if (!this.bg) ctx.drawImage(this.boardTex, -FULL * S, -FULL * S, 2 * FULL * S, 2 * FULL * S);

    // pocket flashes
    for (const f of this.flash) {
      f.t += dt;
      const P = POCKETS[f.pocket];
      const k = f.t / 0.6;
      if (k >= 1) continue;
      ctx.beginPath();
      ctx.arc(P.x * S, P.y * S, (BOARD.pocketR + 4 + k * 16) * S, 0, Math.PI * 2);
      ctx.strokeStyle = f.gold ? `rgba(217,185,120,${0.8 * (1 - k)})` : `rgba(232,217,188,${0.45 * (1 - k)})`;
      ctx.lineWidth = 2.2 * S * (1 - k) + 0.5;
      ctx.stroke();
    }
    this.flash = this.flash.filter((f) => f.t < 0.6);

    // ghost trajectory of the previous shot
    if (aim?.ghost && aim.ghost.length > 1 && !aim.moving) {
      ctx.beginPath();
      aim.ghost.forEach((p, i) => (i ? ctx.lineTo(p.x * S, p.y * S) : ctx.moveTo(p.x * S, p.y * S)));
      ctx.strokeStyle = 'rgba(48,37,30,0.28)';
      ctx.setLineDash([2 * S, 4 * S]);
      ctx.lineWidth = 1.4 * S;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // coach suggestion
    if (aim?.coach && !aim.moving) {
      const sp = strikerPos(aim.side, aim.coach.t);
      const len = Math.sqrt(aim.coach.dx ** 2 + aim.coach.dy ** 2) || 1;
      ctx.beginPath();
      ctx.arc(sp.x * S, sp.y * S, STRIKER_R * S, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(102,112,90,0.9)';
      ctx.setLineDash([3 * S, 3 * S]);
      ctx.lineWidth = 1.6 * S;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sp.x * S, sp.y * S);
      ctx.lineTo((sp.x + (aim.coach.dx / len) * 260) * S, (sp.y + (aim.coach.dy / len) * 260) * S);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // aim guide (under the coins)
    const striker = bodies.find((b) => b.kind === 'striker' && b.active);
    if (aim && !aim.moving && striker && aim.dir) this.drawGuide(ctx, striker, aim, bodies);
    ctx.restore();

    // trails, shadows and bodies in screen space (light stays top-left whatever the rotation)
    const ts = this.texScale();
    const shadowOff = { x: 2.2 * S, y: 3.2 * S };
    if (this.quality === 'high' && !this.reducedMotion) this.drawTrails(ctx, bodies);
    for (let pass = 0; pass < 2; pass++) {
      bodies.forEach((b, i) => {
        if (!b.active) return;
        const r = b.kind === 'striker' ? STRIKER_R : COIN_R;
        const p = this.toScreen(b.x, b.y);
        const dropIn = this.intro < 1 ? Math.min(1, Math.max(0, (this.intro - (i % 19) * 0.025) / 0.4)) : 1;
        let scale = zoom * (1 + (1 - dropIn) * 0.35);
        let alpha = ease * dropIn;
        const ret = this.returns.get(b.id);
        if (ret !== undefined) {
          const k = Math.min(1, ret / 0.45);
          scale *= 0.4 + 0.6 * (1 - Math.pow(1 - k, 3)) + Math.sin(k * Math.PI) * 0.08;
          alpha *= k;
        }
        const px = this.cx + (p.x - this.cx) * zoom;
        const py = this.cy + (p.y - this.cy) * zoom;
        if (pass === 0) {
          const sh = this.sprite(`sh${r}`, () => shadowSprite(r, ts));
          const sz = (2 * r + 12) * S * scale;
          ctx.globalAlpha = alpha * 0.9;
          ctx.drawImage(sh, px - sz / 2 + shadowOff.x, py - sz / 2 + shadowOff.y, sz, sz);
        } else {
          const key = b.kind === 'striker' ? `b-striker-${this.skin}` : `b-${b.kind}`;
          const spr = this.sprite(key, () => bodySprite(b.kind, ts, this.skin));
          const sz = (2 * r + 4) * S * scale;
          ctx.globalAlpha = alpha;
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(b.a + this.angle);
          ctx.drawImage(spr, -sz / 2, -sz / 2, sz, sz);
          ctx.restore();
          const hl = this.sprite(`hl${r}`, () => highlightSprite(r, ts));
          ctx.drawImage(hl, px - sz / 2, py - sz / 2, sz, sz);
        }
      });
    }
    ctx.globalAlpha = 1;
    for (const [id, t] of this.returns) {
      const nt = t + dt;
      if (nt > 0.45) this.returns.delete(id);
      else this.returns.set(id, nt);
    }

    // pocketing animations
    for (const pa of this.pockets) {
      pa.t += dt;
      const k = Math.min(1, pa.t / 0.32);
      const x = pa.x + (pa.px - pa.x) * k;
      const y = pa.y + (pa.py - pa.y) * k;
      const p = this.toScreen(x, y);
      const r = pa.kind === 'striker' ? STRIKER_R : COIN_R;
      const key = pa.kind === 'striker' ? `b-striker-${this.skin}` : `b-${pa.kind}`;
      const spr = this.sprite(key, () => bodySprite(pa.kind, ts, this.skin));
      const sz = (2 * r + 4) * S * (1 - 0.45 * k);
      ctx.globalAlpha = 1 - k;
      ctx.drawImage(spr, p.x - sz / 2, p.y - sz / 2, sz, sz);
      ctx.fillStyle = `rgba(5,3,2,${0.7 * k})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, (sz / 2) * 0.92, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    this.pockets = this.pockets.filter((p) => p.t < 0.32);

    // striker UI (placement ring, power ring)
    if (aim && striker && !aim.moving) this.drawStrikerUi(ctx, striker, aim);

    // particles
    if (this.particles.length) {
      for (const p of this.particles) {
        p.life += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 1 - dt * 3;
        p.vy *= 1 - dt * 3;
        const k = p.life / p.max;
        const s = this.toScreen(p.x, p.y);
        ctx.globalAlpha = Math.max(0, 0.7 * (1 - k));
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, p.size * S * 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      this.particles = this.particles.filter((p) => p.life < p.max);
    }
  }

  private drawTrails(ctx: CanvasRenderingContext2D, bodies: RenderBody[]): void {
    for (const b of bodies) {
      let tr = this.trails.get(b.id);
      if (!b.active || b.speed < 500) {
        if (tr && tr.length) tr.shift();
        if (tr && tr.length === 0) this.trails.delete(b.id);
      } else {
        if (!tr) this.trails.set(b.id, (tr = []));
        tr.push({ x: b.x, y: b.y });
        if (tr.length > 9) tr.shift();
      }
      if (!tr || tr.length < 2) continue;
      const r = b.kind === 'striker' ? STRIKER_R : COIN_R;
      for (let i = 1; i < tr.length; i++) {
        const a = this.toScreen(tr[i - 1].x, tr[i - 1].y);
        const c = this.toScreen(tr[i].x, tr[i].y);
        const k = i / tr.length;
        ctx.strokeStyle = b.kind === 'black' ? `rgba(48,37,30,${0.16 * k})` : b.kind === 'queen' ? `rgba(163,51,38,${0.2 * k})` : `rgba(245,236,220,${0.22 * k})`;
        ctx.lineWidth = r * 1.5 * this.S * k;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(c.x, c.y);
        ctx.stroke();
      }
    }
  }

  /** Ray-cast guide: first contact, ghost striker, and the struck coin's path. Board space, already rotated. */
  private drawGuide(ctx: CanvasRenderingContext2D, striker: RenderBody, aim: AimView, bodies: RenderBody[]): void {
    const S = this.S;
    const d = aim.dir!;
    const len = Math.sqrt(d.x * d.x + d.y * d.y) || 1;
    let dx = d.x / len;
    let dy = d.y / len;
    let x = striker.x;
    let y = striker.y;
    const points: { x: number; y: number }[] = [{ x, y }];
    let hitCoin: RenderBody | null = null;
    let contact: { x: number; y: number } | null = null;
    const bounces = aim.guide === 'full' ? 2 : 0;
    for (let seg = 0; seg <= bounces; seg++) {
      let best = Infinity;
      let bestCoin: RenderBody | null = null;
      for (const b of bodies) {
        if (!b.active || b.kind === 'striker') continue;
        const R = STRIKER_R + COIN_R;
        const ox = b.x - x;
        const oy = b.y - y;
        const proj = ox * dx + oy * dy;
        if (proj <= 0) continue;
        const perp2 = ox * ox + oy * oy - proj * proj;
        if (perp2 > R * R) continue;
        const tHit = proj - Math.sqrt(R * R - perp2);
        if (tHit < best && tHit > 0.01) {
          best = tHit;
          bestCoin = b;
        }
      }
      const lim = BOARD.half - STRIKER_R;
      const tx = dx > 0 ? (lim - x) / dx : dx < 0 ? (-lim - x) / dx : Infinity;
      const ty = dy > 0 ? (lim - y) / dy : dy < 0 ? (-lim - y) / dy : Infinity;
      const tw = Math.min(tx, ty);
      if (bestCoin && best < tw) {
        x += dx * best;
        y += dy * best;
        points.push({ x, y });
        hitCoin = bestCoin;
        contact = { x, y };
        break;
      }
      x += dx * tw;
      y += dy * tw;
      points.push({ x, y });
      if (tx < ty) dx = -dx;
      else dy = -dy;
    }
    // cap the full guide's length so a straight rebound doesn't run back over the striker
    if (aim.guide === 'full') {
      let left = 560;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        const seg = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
        if (seg > left && !(hitCoin && i === points.length - 1)) {
          const f = left / seg;
          points[i] = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
          points.length = i + 1;
          hitCoin = null;
          contact = null;
          break;
        }
        left -= seg;
      }
    }
    // shorten for 'short' guides
    if (aim.guide !== 'full') {
      const a = points[0];
      const b = points[1];
      const f = aim.guide === 'short' ? 0.45 : 0.18;
      points.length = 2;
      points[1] = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      if (aim.guide === 'short' || aim.guide === 'off') {
        hitCoin = aim.guide === 'short' ? hitCoin : null;
      }
    }
    ctx.lineCap = 'round';
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(p.x * S, p.y * S) : ctx.moveTo(p.x * S, p.y * S)));
    ctx.strokeStyle = aim.valid ? 'rgba(48,37,30,0.75)' : 'rgba(142,47,37,0.75)';
    ctx.lineWidth = 1.5 * S;
    ctx.setLineDash([5 * S, 4 * S]);
    ctx.lineDashOffset = -this.time * 30 * S;
    ctx.stroke();
    ctx.setLineDash([]);
    if (aim.guide === 'full' && contact && hitCoin) {
      ctx.beginPath();
      ctx.arc(contact.x * S, contact.y * S, STRIKER_R * S, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(48,37,30,0.45)';
      ctx.lineWidth = 1 * S;
      ctx.stroke();
      const nx = hitCoin.x - contact.x;
      const ny = hitCoin.y - contact.y;
      const nl = Math.sqrt(nx * nx + ny * ny) || 1;
      const L = 60 + aim.power * 200;
      ctx.beginPath();
      ctx.moveTo(hitCoin.x * S, hitCoin.y * S);
      ctx.lineTo((hitCoin.x + (nx / nl) * L) * S, (hitCoin.y + (ny / nl) * L) * S);
      ctx.strokeStyle = 'rgba(111,69,53,0.85)';
      ctx.lineWidth = 2 * S;
      ctx.stroke();
      // highlight a pocket if the coin line runs into it
      for (const P of POCKETS) {
        const ox = P.x - hitCoin.x;
        const oy = P.y - hitCoin.y;
        const proj = (ox * nx + oy * ny) / nl;
        if (proj <= 0) continue;
        const perp = Math.abs((ox * ny - oy * nx) / nl);
        if (perp < BOARD.pocketR * 0.7) {
          ctx.beginPath();
          ctx.arc(P.x * S, P.y * S, (BOARD.pocketR + 3) * S, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(102,112,90,0.95)';
          ctx.lineWidth = 2.2 * S;
          ctx.stroke();
        }
      }
    } else if (aim.guide === 'short' && hitCoin && contact && points[1]) {
      // just ring the coin it will meet
      ctx.beginPath();
      ctx.arc(hitCoin.x * S, hitCoin.y * S, (COIN_R + 2.5) * S, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(48,37,30,0.4)';
      ctx.lineWidth = 1 * S;
      ctx.stroke();
    }
  }

  private drawBg(): void {
    const bg = this.bg!;
    const ctx = bg.getContext('2d')!;
    const S = this.S;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.drawImage(this.boardTex!, this.cx - FULL * S, this.cy - FULL * S, 2 * FULL * S, 2 * FULL * S);
    this.bgDirty = false;
  }

  private drawStrikerUi(ctx: CanvasRenderingContext2D, striker: RenderBody, aim: AimView): void {
    const S = this.S;
    const p = this.toScreen(striker.x, striker.y);
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 4);
    if (aim.interactive) {
      // placement handle hint: arrows along the baseline
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.beginPath();
      ctx.arc(0, 0, (STRIKER_R + 3.5 + pulse * 1.5) * S, 0, Math.PI * 2);
      ctx.strokeStyle = aim.valid ? `rgba(198,168,120,${0.55 + pulse * 0.35})` : 'rgba(170,52,40,0.95)';
      ctx.lineWidth = 2 * S;
      ctx.stroke();
      ctx.restore();
    } else if (!aim.valid) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, (STRIKER_R + 3.5) * S, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(170,52,40,0.9)';
      ctx.lineWidth = 2 * S;
      ctx.stroke();
    }
    const R = (STRIKER_R + 9) * S;
    const start = -Math.PI / 2;
    if (aim.cancel) {
      // inside the cancel zone: grey ring, release does nothing
      ctx.beginPath();
      ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(232,217,188,0.35)';
      ctx.setLineDash([3 * S, 3 * S]);
      ctx.lineWidth = 2.4 * S;
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (aim.power > 0.001 && aim.dir) {
      const pw = Math.min(1, aim.power);
      // track
      ctx.beginPath();
      ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(30,22,17,0.45)';
      ctx.lineWidth = 5 * S;
      ctx.stroke();
      // fill: olive → brass → lacquer red as power rises
      const hue = pw < 0.45 ? '#7E8A69' : pw < 0.8 ? '#C6A878' : '#B23A2C';
      ctx.beginPath();
      ctx.arc(p.x, p.y, R, start, start + pw * Math.PI * 2);
      ctx.strokeStyle = hue;
      ctx.lineWidth = 5 * S;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.lineCap = 'butt';
      // quarter ticks so 25/50/75% are easy to hit
      for (let k = 1; k < 4; k++) {
        const a = start + (k / 4) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(a) * (R - 3.6 * S), p.y + Math.sin(a) * (R - 3.6 * S));
        ctx.lineTo(p.x + Math.cos(a) * (R + 3.6 * S), p.y + Math.sin(a) * (R + 3.6 * S));
        ctx.strokeStyle = 'rgba(30,22,17,0.6)';
        ctx.lineWidth = 1.2 * S;
        ctx.stroke();
      }
      if (pw >= 0.995) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, R + (4 + 2 * Math.sin(this.time * 10)) * S, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(178,58,44,0.5)';
        ctx.lineWidth = 1.5 * S;
        ctx.stroke();
      }
      // percentage label beside the striker (not behind it, where a thumb pulling back would cover it)
      if (aim.interactive) {
        const d = aim.dir;
        const len = Math.sqrt(d.x * d.x + d.y * d.y) || 1;
        let ox = -d.y / len;
        let oy = d.x / len;
        // keep the label on the side facing the middle of the board
        if (ox * -striker.x + oy * -striker.y < 0) {
          ox = -ox;
          oy = -oy;
        }
        const q = this.toScreen(striker.x + ox * (STRIKER_R + 30), striker.y + oy * (STRIKER_R + 30));
        const label = `${Math.round(pw * 100)}%`;
        const fs = Math.max(11, 13 * S);
        ctx.font = `700 ${fs}px Yaldevi, Catamaran, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const tw = ctx.measureText(label).width + fs * 0.9;
        ctx.fillStyle = 'rgba(36,27,22,0.85)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(q.x - tw / 2, q.y - fs * 0.8, tw, fs * 1.6, fs * 0.8);
        else ctx.rect(q.x - tw / 2, q.y - fs * 0.8, tw, fs * 1.6);
        ctx.fill();
        ctx.fillStyle = '#F1E6CF';
        ctx.fillText(label, q.x, q.y + 0.5);
      }
    }
    if (aim.pulling) {
      const q = this.toScreen(aim.pulling.x, aim.pulling.y);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.strokeStyle = 'rgba(232,217,188,0.55)';
      ctx.lineWidth = 1.5 * S;
      ctx.setLineDash([2 * S, 3 * S]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(q.x, q.y, 6 * S, 0, Math.PI * 2);
      ctx.fillStyle = aim.cancel ? 'rgba(232,217,188,0.2)' : 'rgba(232,217,188,0.35)';
      ctx.fill();
    }
  }
}
