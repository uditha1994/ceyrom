/**
 * Procedural textures: the board (wood grain, ICF markings, lotus centre, liyawela frame
 * engraving, brass inlays), coins, striker skins and shadows. Generated once per size and
 * cached as canvases, so drawing a frame is just a handful of drawImage calls.
 */
import { BOARD, COIN_R, POCKETS, STRIKER_R } from '../core/constants';
import { makeRng } from '../core/rng';
import { BoardTheme } from './themes';

type Ctx = CanvasRenderingContext2D;

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const rgba = (hex: string, a: number) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};

/** Long-grain wood: colour bands, wavy grain lines, pores. Grain runs along +y. */
function paintGrain(ctx: Ctx, w: number, h: number, colors: [string, string, string], seed: number, scale: number): void {
  const rng = makeRng(seed);
  const [base, dark, light] = colors;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  // broad bands
  for (let i = 0; i < 26; i++) {
    const x = rng() * w;
    const bw = (20 + rng() * 140) * scale;
    const g = ctx.createLinearGradient(x - bw / 2, 0, x + bw / 2, 0);
    const col = rng() < 0.55 ? dark : light;
    const a = 0.03 + rng() * 0.08;
    g.addColorStop(0, rgba(col, 0));
    g.addColorStop(0.5, rgba(col, a));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - bw / 2, 0, bw, h);
  }
  // grain lines
  const lines = Math.floor((w / scale) * 0.9);
  ctx.lineCap = 'round';
  for (let i = 0; i < lines; i++) {
    const x0 = rng() * w;
    const amp = (1 + rng() * 6) * scale;
    const f = (0.002 + rng() * 0.01) / scale;
    const ph = rng() * 6.28;
    const amp2 = (0.3 + rng() * 1.5) * scale;
    const f2 = (0.02 + rng() * 0.03) / scale;
    ctx.beginPath();
    for (let y = -10; y <= h + 10; y += 5 * scale) {
      const x = x0 + Math.sin(y * f + ph) * amp + Math.sin(y * f2 + ph * 2) * amp2;
      if (y < 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    const isDark = rng() < 0.7;
    ctx.strokeStyle = rgba(isDark ? dark : light, isDark ? 0.05 + rng() * 0.16 : 0.05 + rng() * 0.1);
    ctx.lineWidth = (0.25 + rng() * 1.1) * scale;
    ctx.stroke();
  }
  // a few cathedral figures (grain loops)
  for (let i = 0; i < 5; i++) {
    const cx = rng() * w;
    const cy = rng() * h;
    for (let k = 0; k < 7; k++) {
      ctx.beginPath();
      const rx = (8 + k * 7) * scale;
      const ry = (60 + k * 30) * scale;
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(dark, 0.035);
      ctx.lineWidth = 0.8 * scale;
      ctx.stroke();
    }
  }
  // pores
  const pores = Math.floor((w * h) / (scale * scale * 120));
  for (let i = 0; i < pores; i++) {
    ctx.fillStyle = rgba(dark, 0.08 + rng() * 0.12);
    const px = rng() * w;
    const py = rng() * h;
    ctx.fillRect(px, py, (0.4 + rng()) * scale * 0.6, (1 + rng() * 3) * scale * 0.6);
  }
}

/** Running "liyawela" vine: a wave with curling tendrils and leaves. Drawn along +x. */
function liyawela(ctx: Ctx, len: number, amp: number, period: number, color: string, lw: number): void {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath();
  for (let x = 0; x <= len; x += 2) {
    const y = Math.sin((x / period) * Math.PI * 2) * amp;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  for (let x = period / 4; x < len; x += period / 2) {
    const up = Math.round((x - period / 4) / (period / 2)) % 2 === 0;
    const y = up ? amp : -amp;
    const dir = up ? -1 : 1;
    // tendril spiral
    ctx.beginPath();
    for (let k = 0; k <= 26; k++) {
      const t = k / 26;
      const ang = t * Math.PI * 1.6;
      const r = amp * 0.9 * (1 - t * 0.75);
      const px = x + period * 0.08 + Math.cos(ang) * r * 0.9;
      const py = y + dir * (r - Math.sin(ang + Math.PI / 2) * r) * 0.55;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    // leaf
    ctx.save();
    ctx.translate(x - period * 0.1, y * 0.6);
    ctx.rotate(dir * -0.7);
    ctx.beginPath();
    ctx.ellipse(0, 0, amp * 0.55, amp * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** Eight-petal lotus (pala peththa) inside the centre ring. */
function lotus(ctx: Ctx, r: number, ink: string, accent: string): void {
  ctx.save();
  for (let layer = 0; layer < 2; layer++) {
    const petals = 8;
    const rr = layer === 0 ? r : r * 0.62;
    const off = layer === 0 ? 0 : Math.PI / petals;
    for (let i = 0; i < petals; i++) {
      const a = off + (i / petals) * Math.PI * 2;
      ctx.save();
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(0, -BOARD.centreR * 1.15);
      ctx.bezierCurveTo(rr * 0.32, -rr * 0.45, rr * 0.22, -rr * 0.86, 0, -rr);
      ctx.bezierCurveTo(-rr * 0.22, -rr * 0.86, -rr * 0.32, -rr * 0.45, 0, -BOARD.centreR * 1.15);
      ctx.fillStyle = layer === 0 ? rgba(accent, 0.1) : rgba(accent, 0.16);
      ctx.fill();
      ctx.strokeStyle = rgba(ink, 0.55);
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.restore();
    }
  }
  // dots between outer petals
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(Math.sin(a) * r * 0.86, -Math.cos(a) * r * 0.86, 1.6, 0, Math.PI * 2);
    ctx.fillStyle = rgba(accent, 0.8);
    ctx.fill();
  }
  ctx.restore();
}

function markings(ctx: Ctx, theme: BoardTheme): void {
  const ink = theme.ink;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.1;
  const L = BOARD.baseHalf;
  const B = BOARD.baseline;
  const w = BOARD.baseStrip;
  for (let side = 0; side < 4; side++) {
    ctx.save();
    ctx.rotate((side * Math.PI) / 2);
    // baselines
    ctx.beginPath();
    ctx.moveTo(-L, B - w);
    ctx.lineTo(L, B - w);
    ctx.moveTo(-L, B + w);
    ctx.lineTo(L, B + w);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(-L, B - w + 2.4);
    ctx.lineTo(L, B - w + 2.4);
    ctx.stroke();
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(sx * L, B, w, 0, Math.PI * 2);
      ctx.lineWidth = 1.1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx * L, B, w - 3.2, 0, Math.PI * 2);
      ctx.fillStyle = theme.accent;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(sx * L, B, 3, 0, Math.PI * 2);
      ctx.fillStyle = rgba('#000000', 0.18);
      ctx.fill();
    }
    ctx.restore();
  }
  // diagonal arrows toward pockets
  for (const P of POCKETS) {
    const ux = P.x / Math.abs(P.x);
    const uy = P.y / Math.abs(P.y);
    const d = Math.SQRT1_2;
    const start = 72; // from corner of surface
    const end = 330;
    const cx = ux * BOARD.half;
    const cy = uy * BOARD.half;
    const ax = cx - ux * start * d;
    const ay = cy - uy * start * d;
    const bx = cx - ux * end * d;
    const by = cy - uy * end * d;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.lineWidth = 1.1;
    ctx.stroke();
    // arrowhead toward pocket
    const hx = ux * d;
    const hy = uy * d;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax - hx * 11 + -hy * 5.5, ay - hy * 11 + hx * 5.5);
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax - hx * 11 - -hy * 5.5, ay - hy * 11 - hx * 5.5);
    ctx.stroke();
    // inner arc
    ctx.beginPath();
    const ang = Math.atan2(-uy, -ux);
    ctx.arc(bx - ux * 22 * d, by - uy * 22 * d, 22, ang - Math.PI * 0.62 + Math.PI, ang + Math.PI * 0.62 + Math.PI);
    ctx.stroke();
  }
  // centre
  ctx.beginPath();
  ctx.arc(0, 0, BOARD.outerR, 0, Math.PI * 2);
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, BOARD.outerR - 3.5, 0, Math.PI * 2);
  ctx.lineWidth = 0.5;
  ctx.stroke();
  lotus(ctx, BOARD.outerR - 7, ink, theme.accent);
  ctx.beginPath();
  ctx.arc(0, 0, BOARD.centreR, 0, Math.PI * 2);
  ctx.fillStyle = theme.accent;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = ink;
  ctx.stroke();
}

/** Full board texture at `S` pixels per millimetre. */
export function boardTexture(theme: BoardTheme, S: number): HTMLCanvasElement {
  const H = BOARD.half;
  const F = BOARD.frame;
  const total = (H + F) * 2;
  const px = total * S;
  const c = makeCanvas(px, px);
  const ctx = c.getContext('2d')!;

  // frame: two grain directions, clipped to mitred trapezoids
  const gV = makeCanvas(F * S + 4, total * S);
  paintGrain(gV.getContext('2d')!, gV.width, gV.height, theme.frame, 11, S);
  const gH = makeCanvas(F * S + 4, total * S);
  paintGrain(gH.getContext('2d')!, gH.width, gH.height, theme.frame, 23, S);

  ctx.save();
  ctx.translate(px / 2, px / 2);
  ctx.scale(S, S);
  for (let side = 0; side < 4; side++) {
    ctx.save();
    ctx.rotate((side * Math.PI) / 2);
    ctx.beginPath();
    ctx.moveTo(-H - F, H + F);
    ctx.lineTo(H + F, H + F);
    ctx.lineTo(H, H);
    ctx.lineTo(-H, H);
    ctx.closePath();
    ctx.save();
    ctx.clip();
    // rotate the grain canvas so the grain runs along the frame piece
    ctx.translate(-H - F, H + F);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(side % 2 ? gV : gH, 0, 0, gV.width, gV.height, 0, 0, F + 1, total);
    ctx.restore();
    // mitre line
    ctx.beginPath();
    ctx.moveTo(H + F, H + F);
    ctx.lineTo(H, H);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
    // engraving + bevels
    ctx.save();
    ctx.translate(-H + 70, H + F * 0.5);
    liyawela(ctx, 2 * H - 140, F * 0.16, 64, theme.engrave, 0.9);
    ctx.restore();
    const bevel = ctx.createLinearGradient(0, H, 0, H + F);
    bevel.addColorStop(0, 'rgba(0,0,0,0.42)');
    bevel.addColorStop(0.12, 'rgba(0,0,0,0.05)');
    bevel.addColorStop(0.2, 'rgba(255,240,215,0.07)');
    bevel.addColorStop(0.85, 'rgba(0,0,0,0)');
    bevel.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.beginPath();
    ctx.moveTo(-H - F, H + F);
    ctx.lineTo(H + F, H + F);
    ctx.lineTo(H, H);
    ctx.lineTo(-H, H);
    ctx.closePath();
    ctx.fillStyle = bevel;
    ctx.fill();
    ctx.restore();
  }
  // brass corner plates
  for (let side = 0; side < 4; side++) {
    ctx.save();
    ctx.rotate((side * Math.PI) / 2);
    ctx.translate(H + F, H + F);
    const k = F * 0.82;
    ctx.beginPath();
    ctx.moveTo(-4, -4);
    ctx.lineTo(-k, -4);
    ctx.quadraticCurveTo(-k * 0.55, -k * 0.2, -k * 0.38, -k * 0.38);
    ctx.quadraticCurveTo(-k * 0.2, -k * 0.55, -4, -k);
    ctx.closePath();
    const g = ctx.createLinearGradient(-k, -k, 0, 0);
    g.addColorStop(0, theme.inlay);
    g.addColorStop(0.5, '#E9D3A6');
    g.addColorStop(1, '#8D7347');
    ctx.fillStyle = g;
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(48,37,30,0.6)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
    for (const [rx, ry] of [
      [-k * 0.7, -10],
      [-10, -k * 0.7],
      [-k * 0.3, -k * 0.3],
    ]) {
      ctx.beginPath();
      ctx.arc(rx, ry, 1.6, 0, Math.PI * 2);
      ctx.fillStyle = '#5C4A30';
      ctx.fill();
    }
    ctx.restore();
  }

  // surface
  const sCan = makeCanvas(2 * H * S, 2 * H * S);
  paintGrain(sCan.getContext('2d')!, sCan.width, sCan.height, theme.surface, 37, S);
  ctx.drawImage(sCan, -H, -H, 2 * H, 2 * H);
  markings(ctx, theme);

  // light: warm key from the top-left, gentle falloff
  const light = ctx.createRadialGradient(-H * 0.45, -H * 0.55, H * 0.1, 0, 0, H * 1.5);
  light.addColorStop(0, 'rgba(255,244,220,0.16)');
  light.addColorStop(0.55, 'rgba(255,244,220,0)');
  light.addColorStop(1, 'rgba(30,18,10,0.2)');
  ctx.fillStyle = light;
  ctx.fillRect(-H, -H, 2 * H, 2 * H);
  // cushion shadow along the inner edge
  for (let side = 0; side < 4; side++) {
    ctx.save();
    ctx.rotate((side * Math.PI) / 2);
    const g = ctx.createLinearGradient(0, -H, 0, -H + 14);
    g.addColorStop(0, 'rgba(20,10,5,0.4)');
    g.addColorStop(1, 'rgba(20,10,5,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-H, -H, 2 * H, 14);
    ctx.restore();
  }
  // pockets
  for (const P of POCKETS) {
    const g = ctx.createRadialGradient(P.x - 3, P.y - 3, 1, P.x, P.y, BOARD.pocketR);
    g.addColorStop(0, '#050302');
    g.addColorStop(0.75, '#140c08');
    g.addColorStop(1, '#2a1b13');
    ctx.beginPath();
    ctx.arc(P.x, P.y, BOARD.pocketR, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(P.x, P.y, BOARD.pocketR + 1.2, Math.PI * 0.15, Math.PI * 0.85);
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(255,240,210,0.18)';
    ctx.stroke();
  }
  ctx.restore();
  return c;
}

export type SpriteKind = 'white' | 'black' | 'queen' | 'striker';

/** Body sprite (rotates with the coin). Size: (2r + 4mm) * S square. */
export function bodySprite(kind: SpriteKind, S: number, skin = 'ivory'): HTMLCanvasElement {
  const r = kind === 'striker' ? STRIKER_R : COIN_R;
  const size = (2 * r + 4) * S;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d')!;
  ctx.translate(size / 2, size / 2);
  ctx.scale(S, S);
  const rng = makeRng(kind.length * 97 + skin.length);

  let base: string, edge: string, groove: string, hi: string;
  if (kind === 'white') [base, edge, groove, hi] = ['#EEDFC2', '#C9B48E', 'rgba(110,80,50,0.35)', 'rgba(255,255,255,0.5)'];
  else if (kind === 'black') [base, edge, groove, hi] = ['#2E241E', '#17110D', 'rgba(0,0,0,0.55)', 'rgba(255,230,200,0.14)'];
  else if (kind === 'queen') [base, edge, groove, hi] = ['#A33326', '#6B1D15', 'rgba(60,10,5,0.45)', 'rgba(255,210,180,0.3)'];
  else if (skin === 'brass') [base, edge, groove, hi] = ['#CDAE74', '#8C7040', 'rgba(70,50,20,0.4)', 'rgba(255,245,215,0.5)'];
  else if (skin === 'lacquer') [base, edge, groove, hi] = ['#8E2F25', '#5A1912', 'rgba(40,5,0,0.4)', 'rgba(255,215,170,0.35)'];
  else if (skin === 'moonstone') [base, edge, groove, hi] = ['#D9D3C4', '#9F988A', 'rgba(70,65,55,0.4)', 'rgba(255,255,255,0.5)'];
  else [base, edge, groove, hi] = ['#F3E8D2', '#CDBB98', 'rgba(120,95,60,0.3)', 'rgba(255,255,255,0.55)'];

  const g = ctx.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.1, 0, 0, r);
  g.addColorStop(0, base);
  g.addColorStop(0.82, base);
  g.addColorStop(1, edge);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();

  // turned grooves
  const rings = kind === 'striker' ? [0.3, 0.55, 0.78, 0.92] : [0.38, 0.66, 0.88];
  for (const k of rings) {
    ctx.beginPath();
    ctx.arc(0, 0, r * k, 0, Math.PI * 2);
    ctx.strokeStyle = groove;
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r * k + 0.6, Math.PI * 1.05, Math.PI * 1.75);
    ctx.strokeStyle = hi;
    ctx.lineWidth = 0.4;
    ctx.stroke();
  }
  // faint grain across the face so rotation reads
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.97, 0, Math.PI * 2);
  ctx.clip();
  for (let i = 0; i < 9; i++) {
    const x = -r + rng() * 2 * r;
    ctx.beginPath();
    ctx.moveTo(x, -r);
    ctx.bezierCurveTo(x + 2, -r / 3, x - 2, r / 3, x + 1, r);
    ctx.strokeStyle = kind === 'black' ? 'rgba(255,230,200,0.05)' : 'rgba(80,50,20,0.07)';
    ctx.lineWidth = 0.5 + rng();
    ctx.stroke();
  }
  ctx.restore();

  if (kind === 'queen') {
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = '#D9B978';
    ctx.lineWidth = 1.1;
    ctx.stroke();
    // small 5-petal mark
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * r * 0.22, Math.sin(a) * r * 0.22, r * 0.13, r * 0.07, a, 0, Math.PI * 2);
      ctx.fillStyle = '#D9B978';
      ctx.fill();
    }
  }
  if (kind === 'striker') {
    const mark = skin === 'brass' ? '#5C4426' : skin === 'lacquer' ? '#E2C48B' : skin === 'moonstone' ? '#6E6758' : '#9B7A4D';
    if (skin === 'moonstone') {
      // concentric bands like a sandakada pahana
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 0.66, Math.sin(a) * r * 0.66, 1.1, 0, Math.PI * 2);
        ctx.fillStyle = mark;
        ctx.fill();
      }
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.save();
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.08);
      ctx.quadraticCurveTo(r * 0.12, -r * 0.2, 0, -r * 0.42);
      ctx.quadraticCurveTo(-r * 0.12, -r * 0.2, 0, -r * 0.08);
      ctx.fillStyle = mark;
      ctx.globalAlpha = 0.75;
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    // orientation notch
    ctx.beginPath();
    ctx.arc(0, -r * 0.86, 1.2, 0, Math.PI * 2);
    ctx.fillStyle = mark;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, r - 0.3, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 0.6;
  ctx.stroke();
  return c;
}

/** Fixed highlight that stays put while coins spin. */
export function highlightSprite(r: number, S: number): HTMLCanvasElement {
  const size = (2 * r + 4) * S;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d')!;
  ctx.translate(size / 2, size / 2);
  ctx.scale(S, S);
  const g = ctx.createRadialGradient(-r * 0.4, -r * 0.45, 0, -r * 0.2, -r * 0.25, r * 1.05);
  g.addColorStop(0, 'rgba(255,250,235,0.42)');
  g.addColorStop(0.35, 'rgba(255,250,235,0.08)');
  g.addColorStop(1, 'rgba(255,250,235,0)');
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  return c;
}

export function shadowSprite(r: number, S: number): HTMLCanvasElement {
  const size = (2 * r + 12) * S;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d')!;
  ctx.translate(size / 2, size / 2);
  ctx.scale(S, S);
  const g = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r + 5);
  g.addColorStop(0, 'rgba(25,14,8,0.42)');
  g.addColorStop(0.75, 'rgba(25,14,8,0.18)');
  g.addColorStop(1, 'rgba(25,14,8,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-r - 6, -r - 6, 2 * r + 12, 2 * r + 12);
  return c;
}
