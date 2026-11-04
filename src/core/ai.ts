/**
 * Ceyrom AI. It plans like a player: picks targets and pockets, lines up ghost-ball aims,
 * then "imagines" the best few shots with the same physics everyone uses. Difficulty
 * changes how many shots it considers, how strategic it is, and how steady its hand is.
 * It never changes the physics and never sees anything a human at the board could not.
 */
import { COIN_R, POCKETS, STRIKER_MASS, COIN_MASS, STRIKER_R, PHYS, speedToPower, BOARD } from './constants';
import {
  MatchState,
  ShotInput,
  ShotOutcome,
  colorOf,
  directionValid,
  placementValid,
  playShot,
  sideOf,
  strikerPos,
  teamOf,
  toLocal,
  toBoard,
} from './rules';
import { gauss, makeRng } from './rng';

export type Difficulty = 'beginner' | 'easy' | 'medium' | 'hard' | 'expert';
export const DIFFICULTIES: Difficulty[] = ['beginner', 'easy', 'medium', 'hard', 'expert'];

interface Profile {
  sims: number;
  angleSigma: number; // radians
  powerSigma: number;
  strategy: number; // 0..3
  wild: number; // chance of an unplanned shot
  banks: boolean;
  robust: number;
}

const DEG = Math.PI / 180;
export const AI_PROFILES: Record<Difficulty, Profile> = {
  beginner: { sims: 5, angleSigma: 3.0 * DEG, powerSigma: 0.12, strategy: 0, wild: 0.15, banks: false, robust: 1 },
  easy: { sims: 8, angleSigma: 1.9 * DEG, powerSigma: 0.08, strategy: 0, wild: 0.1, banks: false, robust: 1 },
  medium: { sims: 16, angleSigma: 0.95 * DEG, powerSigma: 0.05, strategy: 1, wild: 0, banks: false, robust: 1 },
  hard: { sims: 28, angleSigma: 0.5 * DEG, powerSigma: 0.03, strategy: 2, wild: 0, banks: true, robust: 2 },
  expert: { sims: 44, angleSigma: 0.2 * DEG, powerSigma: 0.015, strategy: 3, wild: 0, banks: true, robust: 3 },
};

interface Candidate extends ShotInput {
  h: number;
}

const segDist2 = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const vx = bx - ax;
  const vy = by - ay;
  const l2 = vx * vx + vy * vy || 1;
  let t = ((px - ax) * vx + (py - ay) * vy) / l2;
  t = Math.max(0, Math.min(1, t));
  const dx = ax + vx * t - px;
  const dy = ay + vy * t - py;
  return dx * dx + dy * dy;
};

function pathClear(state: MatchState, ax: number, ay: number, bx: number, by: number, clearance: number, skip: number[]): boolean {
  const c2 = clearance * clearance;
  for (const c of state.coins) {
    if (!c.on || skip.includes(c.id)) continue;
    if (segDist2(c.x, c.y, ax, ay, bx, by) < c2) return false;
  }
  return true;
}

const A_EFF = PHYS.friction + 120;
const TRANSFER = ((1 + PHYS.restitutionStriker) * STRIKER_MASS) / (STRIKER_MASS + COIN_MASS);

export function targetsFor(state: MatchState, team: number, strategy: number) {
  if (state.config.variant === 'freestyle') return state.coins.filter((c) => c.on);
  const own = colorOf(state, team);
  const list = state.coins.filter((c) => c.on && c.kind === own);
  const q = state.coins.find((c) => c.kind === 'queen' && c.on);
  const hasOwn = state.coins.some((c) => !c.on && c.kind === own && c.by === team);
  if (q && (hasOwn || !state.config.queenNeedsOwnCoin) && (strategy >= 1 || list.length <= 3)) list.push(q);
  return list;
}

export function generateCandidates(state: MatchState, prof: Profile): Candidate[] {
  const seat = state.turn;
  const side = sideOf(state, seat);
  const team = teamOf(seat);
  const out: Candidate[] = [];
  const targets = targetsFor(state, team, prof.strategy);
  const ts: number[] = [];
  for (let i = 0; i <= 24; i++) ts.push(-1 + i / 12);
  for (const c of targets) {
    for (let p = 0; p < 4; p++) {
      const P = POCKETS[p];
      const tx = P.x - c.x;
      const ty = P.y - c.y;
      const dist = Math.sqrt(tx * tx + ty * ty);
      const ux = tx / dist;
      const uy = ty / dist;
      if (!pathClear(state, c.x, c.y, P.x, P.y, COIN_R * 2 - 1, [c.id])) continue;
      const gx = c.x - ux * (COIN_R + STRIKER_R);
      const gy = c.y - uy * (COIN_R + STRIKER_R);
      // aim targets: direct ghost, plus mirrored ghosts for rebound shots
      const aims: { x: number; y: number; bank: boolean }[] = [{ x: gx, y: gy, bank: false }];
      if (prof.banks) {
        const w = BOARD.half - STRIKER_R;
        aims.push({ x: -2 * w - gx, y: gy, bank: true }, { x: 2 * w - gx, y: gy, bank: true }, { x: gx, y: -2 * w - gy, bank: true }, { x: gx, y: 2 * w - gy, bank: true });
      }
      // direct-line placement: where the ghost→striker line meets the baseline
      const local = toLocal(side, gx, gy);
      const localU = toLocal(side, ux, uy);
      const extra: number[] = [];
      if (localU.y < -0.05) {
        const k = (BOARD.baseline - local.y) / -localU.y;
        const bx = local.x - localU.x * k;
        extra.push(bx / BOARD.baseHalf);
      }
      for (const aim of aims) {
        for (const t of aim.bank ? ts.filter((_, i) => i % 3 === 0) : [...ts, ...extra]) {
          if (t < -1 || t > 1) continue;
          if (!placementValid(state, side, t)) continue;
          const S = strikerPos(side, t);
          const dx = aim.x - S.x;
          const dy = aim.y - S.y;
          if (!directionValid(side, dx, dy)) continue;
          const dl = Math.sqrt(dx * dx + dy * dy);
          let travel = dl;
          let cut: number;
          if (aim.bank) {
            // rebound: the simulation judges it; use a neutral cut estimate for power
            cut = 0.6;
            travel = dl * 1.05;
          } else {
            cut = (dx * ux + dy * uy) / dl;
            if (cut < 0.3) continue;
            if (!pathClear(state, S.x, S.y, gx, gy, STRIKER_R + COIN_R - 0.5, [c.id])) continue;
          }
          const vc = Math.sqrt(2 * A_EFF * dist) + 230;
          const vi = vc / (Math.max(cut, 0.3) * TRANSFER);
          const v0 = Math.sqrt(vi * vi + 2 * A_EFF * travel) * (aim.bank ? 1.25 : 1.04);
          const power = Math.max(0.06, Math.min(1, speedToPower(v0)));
          travel += dist;
          const h = (cut * cut) / (1 + travel / 650) * (aim.bank ? 0.35 : 1) * (c.kind === 'queen' ? 1.15 : 1);
          out.push({ t, dx, dy, power, h });
        }
      }
    }
  }
  out.sort((a, b) => b.h - a.h);
  // keep diversity: drop near-duplicates
  const kept: Candidate[] = [];
  for (const c of out) {
    if (kept.some((k) => Math.abs(k.t - c.t) < 0.03 && Math.abs(Math.atan2(k.dy, k.dx) - Math.atan2(c.dy, c.dx)) < 0.01)) continue;
    kept.push(c);
    if (kept.length > 80) break;
  }
  return kept;
}

/** Shots used when nothing is pottable (and for the break). */
function fallbackCandidates(state: MatchState, rng: () => number, n: number): Candidate[] {
  const side = sideOf(state, state.turn);
  const out: Candidate[] = [];
  const onBoard = state.coins.filter((c) => c.on);
  for (let i = 0; i < n * 6 && out.length < n; i++) {
    const t = rng() * 2 - 1;
    if (!placementValid(state, side, t)) continue;
    const S = strikerPos(side, t);
    const target = onBoard[Math.floor(rng() * onBoard.length)] ?? { x: 0, y: 0 };
    const dx = target.x - S.x + (rng() - 0.5) * 30;
    const dy = target.y - S.y + (rng() - 0.5) * 30;
    if (!directionValid(side, dx, dy)) continue;
    out.push({ t, dx, dy, power: 0.35 + rng() * 0.5, h: 0 });
  }
  return out;
}

function breakCandidates(state: MatchState, rng: () => number): Candidate[] {
  const side = sideOf(state, state.turn);
  const out: Candidate[] = [];
  for (let i = 0; i < 6; i++) {
    const t = (rng() - 0.5) * 0.6;
    if (!placementValid(state, side, t)) continue;
    const S = strikerPos(side, t);
    const off = toBoard(side, (rng() - 0.5) * 16, 0);
    out.push({ t, dx: off.x - S.x, dy: off.y - S.y, power: 0.82 + rng() * 0.18, h: 1 });
  }
  return out;
}

export function evaluate(before: MatchState, after: MatchState, out: ShotOutcome, strategy: number): number {
  const team = out.team;
  let s = 0;
  if (out.foul) s -= 160;
  s += out.scored * 100;
  if (out.notes.includes('queen.covered')) s += strategy >= 1 ? 190 : 110;
  if (out.notes.includes('queen.pocketed')) s += strategy >= 2 ? 70 : 35;
  if (out.notes.includes('queen.returned')) s -= 40;
  if (before.config.variant === 'standard') {
    const opp = 1 - team;
    const oppDown = out.pocketed.filter((p) => p.kind === colorOf(before, opp)).length;
    s -= oppDown * 75;
  }
  if (out.continued) s += 30;
  if (out.boardOver) s += after.results[after.results.length - 1]?.winner === team ? 1500 : -1500;
  if (strategy >= 2 && !out.boardOver) {
    const own = before.config.variant === 'freestyle' ? null : colorOf(before, team);
    for (const c of after.coins) {
      if (!c.on) continue;
      let near = 1e9;
      for (const P of POCKETS) near = Math.min(near, (c.x - P.x) ** 2 + (c.y - P.y) ** 2);
      if (near > 110 * 110) continue;
      const mine = own === null || c.kind === own;
      if (out.continued) s += mine ? 10 : 0;
      else s += mine ? 4 : -14; // the opponent shoots next
    }
  }
  return s;
}

export interface AiPlan {
  input: ShotInput;
  intended: ShotInput;
  score: number;
  considered: number;
}

/**
 * Choose a shot. `pause` lets a browser yield to the render loop between simulations.
 */
export async function chooseShot(
  state: MatchState,
  difficulty: Difficulty,
  seed: number,
  pause: () => Promise<void> = async () => {},
): Promise<AiPlan> {
  const prof = AI_PROFILES[difficulty];
  const rng = makeRng(seed);
  const side = sideOf(state, state.turn);
  let cands: Candidate[];
  if (state.shotNo === 0) cands = breakCandidates(state, rng);
  else {
    cands = generateCandidates(state, prof);
    if (prof.strategy <= 0 && cands.length > 3) {
      // weaker players fixate on the first idea that comes to mind
      cands = cands.slice(0, Math.max(3, Math.floor(cands.length * 0.4)));
      for (let i = cands.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [cands[i], cands[j]] = [cands[j], cands[i]];
      }
    }
    cands = cands.slice(0, prof.sims);
    if (cands.length < prof.sims / 2 || prof.strategy >= 2) cands.push(...fallbackCandidates(state, rng, Math.ceil(prof.sims / 3)));
  }
  if (cands.length === 0) cands = fallbackCandidates(state, rng, 6);
  if (cands.length === 0) {
    // every placement blocked except maybe the extremes — search exhaustively
    for (let i = 0; i <= 200; i++) {
      const t = -1 + i / 100;
      if (placementValid(state, side, t)) {
        const fwd = toBoard(side, 0, -1);
        cands.push({ t, dx: fwd.x, dy: fwd.y, power: 0.5, h: 0 });
        break;
      }
    }
  }
  if (cands.length === 0) cands.push({ t: 0, dx: toBoard(side, 0, -1).x, dy: toBoard(side, 0, -1).y, power: 0.5, h: 0 });

  let best = cands[0];
  let bestScore = -Infinity;
  const scored: { c: Candidate; s: number }[] = [];
  let considered = 0;
  for (const c of cands) {
    const r = playShot(state, c);
    const s = evaluate(state, r.state, r.outcome, prof.strategy);
    scored.push({ c, s });
    considered++;
    if (considered % 4 === 0) await pause();
  }
  // robustness: re-test the top few with a shaky hand and average
  scored.sort((a, b) => b.s - a.s);
  if (prof.robust > 1) {
    for (const item of scored.slice(0, 4)) {
      let total = item.s;
      for (let k = 1; k < prof.robust; k++) {
        const v = perturb(item.c, side, prof.angleSigma, prof.powerSigma, rng);
        const r = playShot(state, v);
        total += evaluate(state, r.state, r.outcome, prof.strategy);
        considered++;
      }
      item.s = total / prof.robust;
      await pause();
    }
    scored.sort((a, b) => b.s - a.s);
  }
  best = scored[0].c;
  bestScore = scored[0].s;
  if (prof.wild > 0 && rng() < prof.wild && scored.length > 1) best = scored[Math.floor(rng() * Math.ceil(scored.length / 2))].c;

  const intended: ShotInput = { t: best.t, dx: best.dx, dy: best.dy, power: best.power };
  const input = perturb(intended, side, prof.angleSigma, prof.powerSigma, rng);
  return { input, intended, score: bestScore, considered };
}

function perturb(c: ShotInput, side: number, aSig: number, pSig: number, rng: () => number): ShotInput {
  const ang = gauss(rng) * aSig;
  const cs = Math.cos(ang);
  const sn = Math.sin(ang);
  let dx = c.dx * cs - c.dy * sn;
  let dy = c.dx * sn + c.dy * cs;
  if (!directionValid(side, dx, dy)) {
    dx = c.dx;
    dy = c.dy;
  }
  const power = Math.max(0.03, Math.min(1, c.power * (1 + gauss(rng) * pSig)));
  return { t: c.t, dx, dy, power };
}
