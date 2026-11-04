/**
 * Ceyrom physics: a small, deterministic rigid-disc simulator written for carrom.
 *
 *  - Fixed timestep (PHYS.dt) independent of frame rate; renderers interpolate.
 *  - Adaptive sub-stepping caps per-substep travel to PHYS.maxTravel mm, which acts as
 *    continuous collision detection (no tunnelling through coins, walls, or pockets).
 *  - Impulse-based contact resolution with restitution, Coulomb tangential friction and spin.
 *  - Only + - * / and Math.sqrt are used in the step, all IEEE-754 exact, so the same input
 *    produces bit-identical results in every browser and on the Node server.
 */
import { BOARD, COIN_MASS, COIN_R, PHYS, POCKETS, STRIKER_MASS, STRIKER_R } from './constants';

export type Kind = 'white' | 'black' | 'queen' | 'striker';

export interface Body {
  id: number;
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Visual rotation (radians) and angular velocity (rad/s). */
  a: number;
  w: number;
  r: number;
  m: number;
  invM: number;
  active: boolean;
}

export type PhysEvent =
  | { type: 'hit'; a: number; b: number; x: number; y: number; impulse: number; striker: boolean; step: number }
  | { type: 'wall'; a: number; x: number; y: number; impulse: number; step: number }
  | { type: 'pocket'; a: number; kind: Kind; pocket: number; x: number; y: number; step: number };

export interface PocketRecord {
  id: number;
  kind: Kind;
  pocket: number;
  step: number;
}

export function makeBody(id: number, kind: Kind, x: number, y: number, a = 0): Body {
  const striker = kind === 'striker';
  const m = striker ? STRIKER_MASS : COIN_MASS;
  return { id, kind, x, y, vx: 0, vy: 0, a, w: 0, r: striker ? STRIKER_R : COIN_R, m, invM: 1 / m, active: true };
}

export class World {
  bodies: Body[];
  steps = 0;
  /** Events since the last drain (for sound/particles). */
  events: PhysEvent[] = [];
  /** Every pocketing in this world, in order. */
  pocketLog: PocketRecord[] = [];
  /** Striker contact count with coins (for statistics). */
  strikerHits = 0;
  recordEvents: boolean;

  constructor(bodies: Body[], recordEvents = true) {
    this.bodies = bodies;
    this.recordEvents = recordEvents;
  }

  get time(): number {
    return this.steps * PHYS.dt;
  }

  drainEvents(): PhysEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  isResting(): boolean {
    for (const b of this.bodies) if (b.active && (b.vx !== 0 || b.vy !== 0)) return false;
    return true;
  }

  /** Advance one fixed step. */
  step(): void {
    const dt = PHYS.dt;
    const bodies = this.bodies;
    let maxV2 = 0;
    for (const b of bodies) {
      if (!b.active) continue;
      const v2 = b.vx * b.vx + b.vy * b.vy;
      if (v2 > maxV2) maxV2 = v2;
    }
    const maxV = Math.sqrt(maxV2);
    const n = Math.max(1, Math.ceil((maxV * dt) / PHYS.maxTravel));
    const h = dt / n;
    for (let k = 0; k < n; k++) this.substep(h);
    // stop slow bodies at the end of the full step
    for (const b of bodies) {
      if (!b.active) continue;
      const v2 = b.vx * b.vx + b.vy * b.vy;
      if (v2 < PHYS.stopSpeed * PHYS.stopSpeed) {
        b.vx = 0;
        b.vy = 0;
      }
      if (b.vx === 0 && b.vy === 0 && b.w !== 0 && (b.w < 0.4 && b.w > -0.4)) b.w = 0;
    }
    this.steps++;
  }

  private substep(h: number): void {
    const bodies = this.bodies;
    const len = bodies.length;
    // integrate + friction
    for (let i = 0; i < len; i++) {
      const b = bodies[i];
      if (!b.active) continue;
      if (b.vx !== 0 || b.vy !== 0) {
        b.x += b.vx * h;
        b.y += b.vy * h;
        const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
        let ns = speed - PHYS.friction * h - PHYS.drag * speed * h;
        if (ns < 0) ns = 0;
        const f = ns / speed;
        b.vx *= f;
        b.vy *= f;
      }
      if (b.w !== 0) {
        b.a += b.w * h;
        b.w *= 1 - PHYS.spinDecay * h;
      }
    }
    // contacts (two passes help stacked clusters settle without overlap)
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < len; i++) {
        const bi = bodies[i];
        if (!bi.active) continue;
        for (let j = i + 1; j < len; j++) {
          const bj = bodies[j];
          if (!bj.active) continue;
          this.collide(bi, bj, pass === 0);
        }
      }
      for (let i = 0; i < len; i++) if (bodies[i].active) this.walls(bodies[i], pass === 0);
    }
    // pockets
    const pr2 = BOARD.pocketR * BOARD.pocketR;
    for (let i = 0; i < len; i++) {
      const b = bodies[i];
      if (!b.active) continue;
      for (let p = 0; p < 4; p++) {
        const dx = b.x - POCKETS[p].x;
        const dy = b.y - POCKETS[p].y;
        if (dx * dx + dy * dy < pr2) {
          b.active = false;
          this.pocketLog.push({ id: b.id, kind: b.kind, pocket: p, step: this.steps });
          if (this.recordEvents)
            this.events.push({ type: 'pocket', a: b.id, kind: b.kind, pocket: p, x: b.x, y: b.y, step: this.steps });
          b.vx = 0;
          b.vy = 0;
          break;
        }
      }
    }
  }

  private collide(bi: Body, bj: Body, emit: boolean): void {
    let dx = bj.x - bi.x;
    let dy = bj.y - bi.y;
    const rr = bi.r + bj.r;
    let d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr) return;
    if (d2 === 0) {
      // exact overlap — separate along +x deterministically
      dx = 1e-6;
      dy = 0;
      d2 = dx * dx;
    }
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const ny = dy / d;
    const total = bi.invM + bj.invM;
    // positional correction (no overlaps survive a substep)
    const pen = rr - d;
    const corr = pen / total;
    bi.x -= nx * corr * bi.invM;
    bi.y -= ny * corr * bi.invM;
    bj.x += nx * corr * bj.invM;
    bj.y += ny * corr * bj.invM;
    // velocity impulse
    const rvx = bj.vx - bi.vx;
    const rvy = bj.vy - bi.vy;
    const vn = rvx * nx + rvy * ny;
    if (vn >= 0) return;
    const striker = bi.kind === 'striker' || bj.kind === 'striker';
    const e = striker ? PHYS.restitutionStriker : PHYS.restitutionCoin;
    const jn = (-(1 + e) * vn) / total;
    bi.vx -= jn * bi.invM * nx;
    bi.vy -= jn * bi.invM * ny;
    bj.vx += jn * bj.invM * nx;
    bj.vy += jn * bj.invM * ny;
    // tangential friction & spin (discs: I = m r² / 2)
    const tx = -ny;
    const ty = nx;
    const vt = (bj.vx - bi.vx) * tx + (bj.vy - bi.vy) * ty - bj.w * bj.r - bi.w * bi.r;
    let jt = -vt / (3 * total);
    const lim = PHYS.contactFriction * jn;
    if (jt > lim) jt = lim;
    else if (jt < -lim) jt = -lim;
    bi.vx -= jt * bi.invM * tx;
    bi.vy -= jt * bi.invM * ty;
    bj.vx += jt * bj.invM * tx;
    bj.vy += jt * bj.invM * ty;
    bi.w += (-2 * jt * bi.invM) / bi.r;
    bj.w += (-2 * jt * bj.invM) / bj.r;
    // wake resting bodies: nothing extra needed, velocities carry it
    if (striker) this.strikerHits++;
    if (emit && this.recordEvents && jn > 0.5)
      this.events.push({
        type: 'hit',
        a: bi.id,
        b: bj.id,
        x: bi.x + nx * bi.r,
        y: bi.y + ny * bi.r,
        impulse: jn,
        striker,
        step: this.steps,
      });
  }

  private walls(b: Body, emit: boolean): void {
    const lim = BOARD.half - b.r;
    if (b.x < -lim) this.wall(b, 1, 0, -lim - b.x, emit);
    else if (b.x > lim) this.wall(b, -1, 0, b.x - lim, emit);
    if (b.y < -lim) this.wall(b, 0, 1, -lim - b.y, emit);
    else if (b.y > lim) this.wall(b, 0, -1, b.y - lim, emit);
  }

  /** Wall with inward normal (nx, ny), penetration depth pen > 0. */
  private wall(b: Body, nx: number, ny: number, pen: number, emit: boolean): void {
    b.x += nx * pen;
    b.y += ny * pen;
    const vn = b.vx * nx + b.vy * ny;
    if (vn >= 0) return;
    const jn = (-(1 + PHYS.restitutionWall) * vn) / b.invM;
    b.vx += jn * b.invM * nx;
    b.vy += jn * b.invM * ny;
    const tx = -ny;
    const ty = nx;
    const vt = b.vx * tx + b.vy * ty - b.w * b.r;
    let jt = -vt / (3 * b.invM);
    const l = PHYS.wallFriction * jn;
    if (jt > l) jt = l;
    else if (jt < -l) jt = -l;
    b.vx += jt * b.invM * tx;
    b.vy += jt * b.invM * ty;
    b.w += (-2 * jt * b.invM) / b.r;
    if (emit && this.recordEvents && jn > 0.5)
      this.events.push({ type: 'wall', a: b.id, x: b.x - nx * b.r, y: b.y - ny * b.r, impulse: jn, step: this.steps });
  }

  /** Run until every body rests (or the time cap). Returns steps taken. */
  runToRest(maxSteps = Math.ceil(PHYS.maxShotTime / PHYS.dt)): number {
    let s = 0;
    while (!this.isResting() && s < maxSteps) {
      this.step();
      s++;
    }
    if (s >= maxSteps) for (const b of this.bodies) (b.vx = 0), (b.vy = 0), (b.w = 0);
    return s;
  }
}

/** Kinetic energy (for tests / debugging). */
export function kineticEnergy(bodies: Body[]): number {
  let e = 0;
  for (const b of bodies) if (b.active) e += 0.5 * b.m * (b.vx * b.vx + b.vy * b.vy) + 0.25 * b.m * b.r * b.r * b.w * b.w;
  return e;
}
