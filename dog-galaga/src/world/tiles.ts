// World tilesets: each area is a stack of parallax layers (far / main / fg).
// Each layer is painted in 448x256 segments (8 rows of 32px tiles) by a seeded
// painter, then cached per time-of-day. Backgrounds are authored in dark,
// low-noise, mostly neutral mid-tones with a guaranteed value gap from the
// darkest cat colours (indigo / dark brown bodies with ink outlines), so cats,
// turds and hairballs pop (Galaga readability).
import { Rng } from '../core/rng';
import type { Tod } from '../core/types';
import { Painter, spans, bayer, ramp, type Ramp } from './paint';

export const SEG = 256;
export const SW = 448;
const T = 32;

export interface Seg { s: number; r: Rng; seed: number; wy(y: number): number }
export interface LayerDef { speed: number; opaque?: boolean; paint(p: Painter, z: Seg): void }
export type Px = (k: string, x: number, y: number, w?: number, h?: number) => void;
export interface Tileset {
  id: string;
  /** default scroll px/tick of the main layer */
  speed: number;
  /** space tilesets use the gentle sunlit / eclipse ramps */
  space?: boolean;
  /** interiors: the lights are on, so dusk/night only warm the room */
  indoor?: boolean;
  /** colour under everything (for transparent main layers) */
  base: string;
  /** per-tileset time-of-day ramps (override the outdoor / indoor / space default) */
  ramps?: Partial<Record<Tod, Ramp>>;
  far?: LayerDef; main: LayerDef; fg?: LayerDef;
  /** cheap per-frame details drawn over the layers (palette pixels only); scroll = main-layer px */
  anim?: (px: Px, scroll: number, t: number, seed: number, tod: Tod) => void;
}

// ---------------------------------------------------------------- helpers
/** world-space repeating features: every `period` world px (main layer), calls fn with the local y in this segment */
function every(z: Seg, period: number, offset: number, fn: (y: number, k: number) => void) {
  const lo = z.s * SEG, hi = (z.s + 1) * SEG;
  for (let k = Math.floor((lo - offset - 64) / period); k * period + offset <= hi + 64; k++) { const wy = k * period + offset; fn(hi - wy, k); }
}
/** the same feature in screen space for anims: screen y of world wy */
function everyScreen(scroll: number, period: number, offset: number, fn: (sy: number, k: number) => void) {
  const H = 360;
  for (let k = Math.floor((scroll - offset - 64) / period); k * period + offset <= scroll + H + 64; k++) { const wy = k * period + offset; fn(H - wy + scroll, k); }
}
/** tree canopy seen from above: outlined leafy clumps, lit top-left, shaded bottom-right */
function canopy(p: Painter, cx: number, cy: number, r: number, rng: Rng, keys = ['1', 'k', 'j']) {
  const [shade, body, hi] = keys;
  const seed = rng.int(0, 1e6);
  const clumps: [number, number, number][] = [[cx, cy, r * 0.62]];
  const cr = new Rng(seed);
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2 + cr.range(0, 0.5); const d = r * cr.range(0.45, 0.62); clumps.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.92, r * cr.range(0.3, 0.42)]); }
  for (const [x, y, rr] of clumps) p.disc('0', x, y, rr + 1);
  for (const [x, y, rr] of clumps) p.disc(body, x, y, rr);
  for (const [x, y, rr] of clumps) p.disc(shade, x + rr * 0.35, y + rr * 0.4, rr * 0.6);
  for (const [x, y, rr] of clumps) p.disc(body, x - rr * 0.1, y - rr * 0.1, rr * 0.55);
  for (const [x, y, rr] of clumps) { p.ell(hi, x - rr * 0.35, y - rr * 0.4, rr * 0.32, rr * 0.22); p.r(shade, x + rr * 0.2, y + rr * 0.1, 1, 1); }
}
/** a single overhanging branch (fg): a crooked limb with leaf clumps, drawn dark so it reads as close to camera */
function branch(p: Painter, fromLeft: boolean, y: number, len: number, rng: Rng) {
  const x0 = fromLeft ? -4 : SW + 4, dir = fromLeft ? 1 : -1;
  let x = x0, yy = y; const pts: [number, number][] = [];
  for (let i = 0; i < len; i += 6) { const nx = x + dir * 6, ny = yy + rng.int(-2, 2); p.line('0', x, yy, nx, ny); p.line('0', x, yy + 1, nx, ny + 1); x = nx; yy = ny; pts.push([x, yy]); }
  for (let i = 2; i < pts.length; i += 2) { const [bx, by0] = pts[i]; const by = by0 + rng.int(-6, 6); const rr = rng.int(7, 11); p.disc('0', bx, by, rr + 1); p.disc('1', bx, by, rr); p.disc('k', bx - 2, by - 2, rr - 3); p.r('j', bx - 4, by - 4, 2, 1); }
}
/** dense procedural fill: f(x,y) in 0..1 picks a palette band, with ordered dither between bands */
function field(p: Painter, keys: string[], f: (x: number, y: number) => number, skipBelow = -1, ditherW = 1) {
  const n = keys.length - 1;
  const row = new Float32Array(SW >> 1);
  p.pixels(set => {
    for (let y = 0; y < SEG; y++) for (let x = 0; x < SW; x++) {
      if (x === 0 && (y & 1) === 0) for (let i = 0; i < row.length; i++) row[i] = f(i * 2 + 1, y + 1); // smooth fields: sample per 2x2 cell
      const v = row[x >> 1]; if (v < skipBelow) continue;
      const lv = Math.max(0, Math.min(0.999, v)) * n; const band = Math.floor(lv);
      // ditherW < 1 narrows the dithered transition so bands read as clean shapes, not halftone
      const fr = Math.max(0, Math.min(1, ((lv - band) - (1 - ditherW)) / ditherW));
      set(fr * 16 > bayer(x, y) && band < n ? keys[band + 1] : keys[band], x, y);
    }
  });
}
function tuft(p: Painter, k: string, x: number, y: number) { p.r(k, x, y, 1, 2); p.r(k, x + 2, y - 1, 1, 3); p.r(k, x + 4, y, 1, 2); }
function grass(p: Painter, x: number, y: number, w: number, h: number, rng: Rng, base = 'k', hi = 'j', density = 1) {
  p.r(base, x, y, w, h);
  const n = Math.floor((w * h) / 520 * density);
  for (let i = 0; i < n; i++) tuft(p, rng.chance(0.75) ? hi : '1', x + rng.int(1, w - 6), y + rng.int(2, h - 2));
}
function lamp(p: Painter, x: number, y: number, r = 40) {
  p.shRect(x - 1, y - 1, 3, 3, 14);
  p.obj(() => { p.disc('0', x + 0.5, y + 0.5, 3); p.disc('p', x + 0.5, y + 0.5, 2); p.glow('q', 'f', x, y, 1, 1); p.glow('o', '7', x - 1, y - 1, 1, 1); });
  p.pool(x, y + 2, r);
}
function crate(p: Painter, x: number, y: number, w = 20, h = 20, k = 'a') {
  p.shRect(x, y, w, h, 8);
  p.obj(() => { p.r('b', x, y, w, h); p.r(k, x + 1, y + 1, w - 2, h - 2); p.r('b', x + 1, y + (h >> 1), w - 2, 1); p.frame('b', x + 2, y + 2, w - 4, h - 4); p.r('9', x + 1, y + 1, w - 2, 1); });
}
function car(p: Painter, x: number, y: number, body: string, down: boolean) {
  const w = 22, h = 42;
  p.shRect(x, y + 2, w, h - 4, 7);
  p.obj(() => {
    p.r('0', x - 1, y + 7, 2, 7); p.r('0', x + w - 1, y + 7, 2, 7); p.r('0', x - 1, y + h - 14, 2, 7); p.r('0', x + w - 1, y + h - 14, 2, 7);
    p.r('0', x + 1, y, w - 2, h); p.r('0', x, y + 1, w, h - 2);
    p.r(body, x + 1, y + 1, w - 2, h - 2);
    const front = down ? y + h - 15 : y + 7, back = down ? y + 7 : y + h - 13;
    p.r('1', x + 3, front, w - 6, 8); p.r('2', x + 4, front + (down ? 6 : 1), w - 8, 1);
    p.r('1', x + 3, back, w - 6, 6);
    p.r(body, x + 3, Math.min(front, back) + 8, w - 6, Math.abs(front - back) - 8);
    p.r('o', x + 2, y + 2, 1, h - 4);
    const hy = down ? y + h - 2 : y + 1, ty = down ? y + 1 : y + h - 2;
    p.glow('7', 'f', x + 2, hy, 4, 1); p.glow('7', 'f', x + w - 6, hy, 4, 1);
    p.glow('e', 'r', x + 2, ty, 4, 1); p.glow('e', 'r', x + w - 6, ty, 4, 1);
  });
}
function bench(p: Painter, x: number, y: number, vertical: boolean) {
  const w = vertical ? 12 : 36, h = vertical ? 36 : 12;
  p.shRect(x, y, w, h, 5);
  p.obj(() => {
    p.r('0', x, y, w, h);
    if (vertical) for (let i = 0; i < 3; i++) p.r(i ? 'a' : '9', x + 1 + i * 4, y + 1, 3, h - 2);
    else for (let i = 0; i < 3; i++) p.r(i ? 'a' : '9', x + 1, y + 1 + i * 4, w - 2, 3);
    p.r('q', vertical ? x : x + 3, vertical ? y + 3 : y, vertical ? w : 2, vertical ? 2 : h); p.r('q', vertical ? x : x + w - 5, vertical ? y + h - 5 : y, vertical ? w : 2, vertical ? 2 : h);
  });
}
function bin(p: Painter, x: number, y: number, k = 'q') {
  p.shEll(x, y, 6, 6, 8);
  p.obj(() => { p.disc('0', x, y, 7); p.disc(k, x, y, 6); p.disc('0', x, y, 4); p.disc('1', x + 0.5, y + 0.5, 3); p.r('p', x - 4, y - 4, 2, 1); });
}
/** brownstone / tenement roof block: tar with parapet bevel and grid seams */
function roof(p: Painter, x: number, y: number, w: number, h: number, height: number, tar = 'q', rim = 'p') {
  p.shRect(x, y, w, h, height);
  p.obj(() => {
    p.r('0', x, y, w, h);
    p.r(rim, x + 1, y + 1, w - 2, h - 2);
    p.r('o', x + 1, y + 1, w - 2, 1); p.r('o', x + 1, y + 1, 1, h - 2);
    p.r(tar, x + 4, y + 4, w - 8, h - 8);
    p.r('v', x + 4, y + 4, w - 8, 1); p.r('v', x + 4, y + 4, 1, h - 8);
    for (let gx = x + 4 + T; gx < x + w - 4; gx += T) p.r('v', gx, y + 5, 1, h - 9);
    for (let gy = y + 4 + T; gy < y + h - 4; gy += T) p.r('v', x + 5, gy, w - 9, 1);
  });
}
function vent(p: Painter, x: number, y: number) {
  p.shEll(x, y, 4, 4, 6);
  p.obj(() => { p.disc('0', x, y, 5); p.disc('p', x, y, 4); p.r('q', x - 3, y, 6, 1); p.r('q', x - 3, y - 2, 6, 1); p.r('q', x - 3, y + 2, 6, 1); });
}
function acUnit(p: Painter, x: number, y: number) {
  p.shRect(x, y, 22, 16, 8);
  p.obj(() => { p.r('0', x, y, 22, 16); p.r('p', x + 1, y + 1, 20, 14); p.r('o', x + 1, y + 1, 20, 1); p.disc('q', x + 8, y + 8, 5); p.disc('0', x + 8, y + 8, 2); for (let i = 0; i < 4; i++) p.r('q', x + 15, y + 3 + i * 3, 5, 1); });
}
function skylight(p: Painter, x: number, y: number, w: number, h: number, chance = 0.8, roll = 0) {
  p.shRect(x, y, w, h, 3);
  p.obj(() => { p.r('0', x, y, w, h); p.r('p', x + 1, y + 1, w - 2, h - 2); p.glow('2', 'g', x + 2, y + 2, w - 4, h - 4, chance, roll); p.glow('3', 'f', x + 3, y + 3, 3, 2, chance, roll); });
  p.obj(() => { p.lateBars.push([x + (w >> 1), y + 1, 1, h - 2], [x + 1, y + (h >> 1), w - 2, 1]); });
}
/** party bulbs on a sagging wire; lit whenever it is dusk or darker */
function stringLights(p: Painter, x0: number, y0: number, x1: number, y1: number, rng: Rng, sag = 4) {
  p.obj(() => {
    const n = Math.max(2, Math.floor(Math.hypot(x1 - x0, y1 - y0) / 7));
    let px = x0, py = y0;
    for (let i = 1; i <= n; i++) {
      const t = i / n; const x = Math.round(x0 + (x1 - x0) * t), y = Math.round(y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * sag);
      p.line('0', px, py, x, y); px = x; py = y;
      if (i < n) p.glow('q', rng.pick(['f', 'c', 'l', 'g', 'f']), x, y + 1, 1, 2, 1.5, 0);
    }
  });
}
/** pointed hull boat seen from above (optionally under way, with a V wake) */
function boat(p: Painter, x: number, y: number, w: number, len: number, hull: string, rng: Rng, bowUp = true, wake = false) {
  const shape = (k: string, inset: number) => {
    for (let j = inset; j < len - inset; j++) {
      const t = bowUp ? j / len : 1 - j / len; const taper = t < 0.32 ? Math.sqrt(t / 0.32) : 1; const hw = Math.max(1, Math.round((w / 2 - inset) * taper - (t > 0.95 ? 1 : 0)));
      p.r(k, x + Math.round(w / 2) - hw, y + j, hw * 2, 1);
    }
  };
  p.shRect(x + 3, y + 6, w - 6, len - 12, 6);
  if (wake) {
    const sx = x + Math.round(w / 2), sy = bowUp ? y + len : y, d0 = bowUp ? 1 : -1;
    for (let i = 0; i < 6; i++) { const d = 6 + i * 9, sp = 3 + i * 5; const yy = sy + d * d0; p.r('5', sx - sp - 4, yy, 4, 1); p.r('5', sx + sp, yy, 4, 1); p.r('4', sx - sp - 7, yy + d0, 3, 1); p.r('4', sx + sp + 4, yy + d0, 3, 1); }
    p.r('s', sx - 3, sy + d0, 6, 1); p.r('5', sx - 2, sy + d0 * 3, 4, 2); p.r('4', sx - 1, sy + d0 * 7, 2, 3);
  }
  p.obj(() => {
    shape('0', 0); shape(hull, 1); shape('a', 3);
    for (let j = 6; j < len - 4; j += 4) p.r('b', x + 4, y + j, w - 8, 1);
    const cab = bowUp ? y + Math.round(len * 0.45) : y + Math.round(len * 0.25);
    p.r('0', x + 5, cab, w - 10, Math.round(len * 0.28)); p.r('p', x + 6, cab + 1, w - 12, Math.round(len * 0.28) - 2); p.r('o', x + 6, cab + 1, w - 12, 1);
    p.glow('2', 'f', x + 7, cab + 3, 2, 2, 0.8, rng.next()); p.glow('2', 'f', x + w - 9, cab + 3, 2, 2, 0.8, rng.next());
    p.r('o', x + Math.round(w / 2), bowUp ? y + 2 : y + len - 3, 1, 1);
  });
}
/** overhead utility wires (fg): two sagging cables with a few pigeons */
function wires(p: Painter, y: number, rng: Rng) {
  const sag = rng.int(6, 14), dy = rng.int(-10, 10);
  for (const off of [0, 5]) { let px = -2, py = y + off; for (let x = 8; x <= SW + 8; x += 8) { const t = x / SW; const ny = Math.round(y + off + dy * t + Math.sin(t * Math.PI) * sag); p.line('0', px, py, x, ny); px = x; py = ny; } }
  for (let i = 0; i < rng.int(0, 3); i++) { const x = rng.int(60, 380); const t = x / SW; const yy = Math.round(y + dy * t + Math.sin(t * Math.PI) * sag); p.r('0', x - 2, yy - 4, 5, 4); p.r('q', x - 1, yy - 4, 3, 3); p.r('0', x + 2, yy - 5, 2, 2); }
}

// ---------------------------------------------------------------- BACKYARD
/** doghouse with a pitched roof (ridge front-to-back), shingles, eave shadow and an arched entrance on the front gable */
function doghouse(p: Painter, x: number, y: number) {
  const w = 32, rh = 26;
  p.shRect(x, y, w, rh + 8, 14);
  p.obj(() => {
    // front gable wall (seen below the eave) with arched door
    p.r('0', x + 1, y + rh - 1, w - 2, 10); p.r('9', x + 2, y + rh, w - 4, 8); p.r('a', x + 2, y + rh + 6, w - 4, 2);
    for (let i = 4; i < w - 4; i += 4) p.r('a', x + i, y + rh, 1, 6);
    p.r('0', x + 11, y + rh + 1, 10, 8); p.r('0', x + 12, y + rh, 8, 1); p.r('1', x + 13, y + rh + 3, 6, 6); // entrance + inside shadow
    // roof: lit left plane, shaded right plane, shingle courses, ridge cap
    p.r('0', x - 1, y - 1, w + 2, rh + 1);
    p.r('a', x, y, w / 2, rh); p.r('b', x + w / 2, y, w / 2, rh);
    for (let j = 3; j < rh; j += 4) { p.r('b', x, y + j, w / 2 - 1, 1); p.r('v', x + w / 2 + 1, y + j, w / 2 - 1, 1); for (let i = (j >> 2) % 2 ? 2 : 6; i < w; i += 8) p.r(i < w / 2 ? 'b' : 'v', x + i, y + j - 3, 1, 3); }
    p.r('9', x, y, w / 2, 1); p.r('9', x, y, 1, rh);
    p.r('8', x + w / 2 - 1, y, 1, rh); p.r('0', x + w / 2, y, 1, rh); // ridge: highlight + crease
    p.r('0', x - 1, y + rh - 1, w + 2, 1);
    p.r('7', x + 14, y + rh, 4, 1); // name plate under the ridge
  });
  // bowl + bone
  p.obj(() => {
    p.disc('0', x + 44, y + 30, 4); p.disc('n', x + 44, y + 30, 3); p.r('a', x + 43, y + 29, 2, 1);
    p.r('8', x + 36, y + 44, 6, 2); p.r('8', x + 35, y + 43, 2, 1); p.r('8', x + 35, y + 46, 2, 1); p.r('8', x + 41, y + 43, 2, 1); p.r('8', x + 41, y + 46, 2, 1);
  });
}
function kiddiePool(p: Painter, cx: number, cy: number, r = 22) {
  p.shEll(cx, cy, r, r * 0.9, 4);
  p.obj(() => {
    p.ell('0', cx, cy, r + 1, r * 0.9 + 1); p.ell('e', cx, cy, r, r * 0.9); p.ell('d', cx - 1, cy - 1, r - 2, r * 0.9 - 2); p.ell('e', cx, cy, r - 3, r * 0.9 - 3);
    p.ell('n', cx, cy, r - 5, r * 0.9 - 5); p.ell('2', cx + 2, cy + 2, r - 8, r * 0.9 - 9); p.ell('n', cx, cy, r - 10, r * 0.9 - 11);
    p.r('m', cx - 8, cy - 6, 4, 1); p.r('m', cx + 3, cy + 4, 3, 1);
    p.r('0', cx + 4, cy - 5, 5, 4); p.r('f', cx + 4, cy - 5, 4, 3); p.r('g', cx + 8, cy - 4, 1, 1); // duck
  });
}
/** patio pavers: two close values only (flat, quiet) */
function patio(p: Painter, x: number, y: number, w: number, h: number) {
  p.r('v', x, y, w, h);
  for (let j = 0; j < h; j += 16) for (let i = (j / 16) % 2 ? -8 : 0; i < w; i += 16) { const xx = Math.max(x, x + i + 1), ww = Math.min(x + w, x + i + 15) - xx; if (ww > 0) p.r('q', xx, y + j + 1, ww, Math.min(15, h - j - 1)); }
}
function grill(p: Painter, x: number, y: number) {
  p.shEll(x, y, 7, 7, 12);
  p.obj(() => { p.disc('0', x, y, 8); p.disc('q', x, y, 7); p.disc('1', x - 1, y - 1, 5); for (let i = -3; i <= 3; i += 2) p.r('p', x - 4, y + i - 1, 7, 1); p.r('0', x - 1, y - 9, 2, 2); p.glow('q', 'g', x - 2, y, 1, 1, 0.4, 0); });
}
function umbrellaTable(p: Painter, cx: number, cy: number) {
  p.shEll(cx, cy, 16, 16, 18);
  p.obj(() => {
    for (const [dx, dy] of [[-18, 0], [18, 0], [0, 20], [0, -20]]) { p.r('0', cx + dx - 4, cy + dy - 4, 8, 8); p.r('p', cx + dx - 3, cy + dy - 3, 6, 6); }
    p.disc('0', cx, cy, 16); p.disc('a', cx, cy, 15);
    for (let a = 0; a < 8; a += 2) for (let rr = 2; rr < 15; rr++) { const t1 = (a / 8) * Math.PI * 2, t2 = ((a + 1) / 8) * Math.PI * 2; for (let tt = t1; tt < t2; tt += 0.08) p.r('8', cx + Math.cos(tt) * rr, cy + Math.sin(tt) * rr); }
    p.disc('0', cx, cy, 2); p.r('7', cx - 1, cy - 1, 1, 1);
  });
}
/** raised veggie / berry bed: wood frame, soil rows, dark berries */
function garden(p: Painter, x: number, y: number, w: number, h: number, rng: Rng) {
  p.shRect(x, y, w, h, 4);
  p.obj(() => {
    p.r('0', x - 1, y - 1, w + 2, h + 2); p.r('a', x, y, w, h); p.r('9', x, y, w, 1); p.r('9', x, y, 1, h); p.r('b', x + 2, y + 2, w - 4, h - 4);
    for (let j = 5; j < h - 3; j += 8) { p.r('v', x + 3, y + j + 3, w - 6, 1); for (let i = 5; i < w - 5; i += 7) { p.disc('k', x + i + 1, y + j + 1, 3); p.r('j', x + i, y + j, 1, 1); if (rng.chance(0.3)) p.r('e', x + i + 2, y + j + 2, 1, 1); } }
  });
}
function clothesline(p: Painter, x0: number, x1: number, y: number, rng: Rng) {
  p.obj(() => {
    p.r('0', x0 - 1, y - 1, 3, 3); p.r('0', x1 - 1, y - 1, 3, 3); p.r('q', x0, y, x1 - x0, 1);
    for (let x = x0 + 8; x < x1 - 14; x += rng.int(14, 22)) { const k = rng.pick(['n', 'e', '8', 'u', 'p']); const ww = rng.int(8, 12), hh = rng.int(8, 14); p.r('0', x, y + 1, ww, hh); p.r(k, x + 1, y + 1, ww - 2, hh - 1); p.r('o', x + 1, y + 1, ww - 2, 1); }
  });
}
function fenceV(p: Painter, x: number, y0: number, y1: number) {
  p.shRect(x, y0, 4, y1 - y0, 10);
  p.obj(() => { p.r('b', x, y0, 4, y1 - y0); p.r('9', x, y0, 1, y1 - y0); p.r('a', x + 1, y0, 2, y1 - y0); for (let y = y0; y < y1; y += 32) { p.r('0', x - 1, y + 14, 6, 5); p.r('9', x, y + 15, 4, 3); } });
}
function fenceH(p: Painter, x0: number, x1: number, y: number) {
  p.shRect(x0, y, x1 - x0, 4, 10);
  p.obj(() => { p.r('b', x0, y, x1 - x0, 4); p.r('9', x0, y, x1 - x0, 1); p.r('a', x0, y + 1, x1 - x0, 2); for (let x = x0 + 6; x < x1; x += 32) { p.r('0', x, y - 1, 5, 6); p.r('9', x + 1, y, 3, 4); } });
}
/** soil border along a fence with low shrubs and a few muted flowers */
function border(p: Painter, x: number, y: number, w: number, h: number, rng: Rng) {
  p.r('b', x, y, w, h);
  for (let i = 0; i < (w * h) / 70; i++) { const cx = x + rng.int(2, w - 2), cy = y + rng.int(2, h - 2); p.disc('1', cx + 1, cy + 1, 3); p.disc('k', cx, cy, 3); p.r('j', cx - 1, cy - 2, 2, 1); }
  for (let i = 0; i < (w * h) / 160; i++) p.r(rng.pick(['c', 't', '7']), x + rng.int(2, w - 3), y + rng.int(2, h - 3), 1, 1);
}
/**
 * Brooklyn brownstone rears (3/4 view from above): tar roof with parapet and
 * chimney, then a strip of muted brick facade with tall windows, an AC unit in
 * every window and a black fire escape with a zig-zag stair.
 */
function brownstoneBacks(p: Painter, rng: Rng) {
  const rh = 34, fh = 36; // roof band, facade band
  for (let x = 0; x < SW; x += 112) {
    const ww = 112;
    roof(p, x, 0, ww, rh, 4, 'q', 'p');
    const ch = x + rng.int(10, 30);
    p.obj(() => {
      p.r('0', ch, 8, 14, 12); p.r('a', ch + 1, 9, 12, 10); p.r('9', ch + 1, 9, 12, 1); p.r('0', ch + 3, 12, 3, 4); p.r('0', ch + 8, 12, 3, 4);
      const fy = rh;
      p.r('0', x, fy, ww, fh); p.r('a', x + 1, fy, ww - 2, fh - 1);
      for (let j = fy + 4; j < fy + fh - 1; j += 4) { p.r('b', x + 1, j, ww - 2, 1); for (let i = x + ((j >> 2) % 2 ? 3 : 7); i < x + ww - 1; i += 8) p.r('b', i, j - 3, 1, 3); }
      p.r('9', x + 1, fy, ww - 2, 2); p.r('b', x + 1, fy + 2, ww - 2, 1); // cornice
      p.r('b', x, fy, 1, fh); p.r('b', x + ww - 1, fy, 1, fh);
    });
    for (let i = 0; i < 3; i++) {
      const wx = x + 14 + i * 34, wy = rh + 7;
      p.obj(() => { p.r('8', wx - 1, wy - 2, 12, 2); p.r('0', wx, wy, 10, 20); p.r('8', wx - 1, wy + 20, 12, 2); });
      p.glow('1', rng.pick(['f', 'g', 'f', '7']), wx + 1, wy + 1, 8, 9, 0.75, rng.next());
      // lower sash holds a window AC unit
      p.obj(() => { p.r('1', wx + 1, wy + 10, 8, 10); p.r('0', wx, wy + 11, 10, 7); p.r('p', wx + 1, wy + 12, 8, 5); p.r('o', wx + 1, wy + 12, 8, 1); p.r('q', wx + 2, wy + 14, 6, 1); p.r('q', wx + 2, wy + 16, 6, 1); });
    }
    // fire escape: landing across a window + zig-zag stair
    const fx = x + 8 + rng.int(0, 1) * 34;
    p.shRect(fx, rh + fh - 4, 46, 4, 10);
    p.obj(() => {
      const ly = rh + 26;
      p.lateBars.push([fx, ly, 46, 1], [fx, ly + 5, 46, 1], [fx, ly - 9, 1, 9], [fx + 45, ly - 9, 1, 9], [fx, ly - 9, 46, 1]);
      for (let i = 2; i < 46; i += 3) p.lateBars.push([fx + i, ly + 1, 1, 4]);
      for (let s = 0; s < 8; s++) p.lateBars.push([fx + 30 + s * 2, ly - 8 + s, 2, 1]);
    });
  }
}
function birdBath(p: Painter, cx: number, cy: number) {
  p.shEll(cx, cy, 8, 8, 10);
  p.obj(() => { p.disc('0', cx, cy, 9); p.disc('p', cx, cy, 8); p.disc('o', cx - 1, cy - 1, 6); p.disc('n', cx, cy, 5); p.r('m', cx - 2, cy - 2, 2, 1); p.r('0', cx + 2, cy - 1, 3, 2); p.r('9', cx + 2, cy - 1, 2, 1); });
}
const backyard: LayerDef = { speed: 1, opaque: true, paint(p, z) {
  const r = z.r; const top = z.s % 3 === 0 ? 78 : 0;
  grass(p, 0, 0, SW, SEG, r, 'k', 'j', 0.6);
  if (top) brownstoneBacks(p, r);
  const lots = [[0, 144], [148, 300], [304, 448]];
  const kinds = ['dog', 'pool', 'patio', 'garden', 'clothes', 'yard'];
  for (let i = kinds.length - 1; i > 0; i--) { const j = r.int(0, i); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
  lots.forEach(([x0, x1], li) => {
    const kind = kinds[li];
    const cx = (x0 + x1) >> 1, y0 = top + 14, y1 = SEG - 8;
    border(p, li === 2 ? x1 - 12 : li === 1 ? x0 + 4 : x0, top + 2, 10, SEG - top - 2, r);
    if (kind !== 'patio') for (let y = y0 + 8; y < y1 - 8; y += 20) { const sx = cx + Math.round(Math.sin((z.wy(y) + li * 50) / 40) * 14) + ((y / 20) % 2 ? 4 : -4); p.ell('0', sx, y + 3, 6, 4); p.ell('q', sx, y + 3, 5, 3); p.r('p', sx - 3, y + 1, 4, 1); }
    if (kind === 'dog') { doghouse(p, x0 + 22, y0 + 26); p.ell('b', x0 + 96, y0 + 130, 9, 6); p.ell('a', x0 + 95, y0 + 129, 6, 3); p.obj(() => { const tx = x0 + 40, ty = y1 - 40; p.r('0', tx - 1, ty - 1, 16, 4); p.r('8', tx, ty, 14, 2); p.r('h', tx + 3, ty, 2, 2); p.r('h', tx + 9, ty, 2, 2); }); }
    else if (kind === 'pool') { kiddiePool(p, cx + 10, y0 + 60); bin(p, x1 - 24, y1 - 24, 'k'); p.obj(() => { const tx = cx - 40, ty = y0 + 110; p.r('0', tx - 1, ty - 1, 18, 26); for (let j = 0; j < 24; j += 4) p.r(j % 8 ? '7' : 'n', tx, ty + j, 16, 4); }); }
    else if (kind === 'patio') { patio(p, x0 + 14, y0 + 4, x1 - x0 - 28, 96); umbrellaTable(p, cx, y0 + 50); grill(p, x1 - 30, y0 + 20); }
    else if (kind === 'garden') { garden(p, x0 + 18, y0 + 16, x1 - x0 - 36, 36, r); garden(p, x0 + 18, y0 + 66, (x1 - x0) / 2 - 12, 30, r); p.obj(() => { const wx = x1 - 40, wy = y0 + 76; p.r('0', wx, wy, 12, 10); p.r('k', wx + 1, wy + 1, 10, 8); p.r('j', wx + 1, wy + 1, 10, 1); p.r('0', wx + 12, wy + 2, 6, 2); }); }
    else if (kind === 'clothes') { clothesline(p, x0 + 14, x1 - 14, y0 + 40, r); bin(p, x0 + 24, y1 - 30); bin(p, x0 + 40, y1 - 30, 'n'); p.obj(() => { const bx = x1 - 44, by = y0 + 84; p.ell('0', bx, by, 11, 8); p.ell('9', bx, by, 10, 7); p.ell('a', bx + 1, by + 1, 7, 4); p.r('7', bx - 4, by - 2, 5, 3); p.r('n', bx + 1, by - 1, 4, 3); }); }
    else { birdBath(p, cx, y0 + 50); for (let i = 0; i < 5; i++) { const fx = r.int(x0 + 18, x1 - 18), fy = r.int(y0 + 80, y1 - 12); p.r(r.pick(['c', '7', 't']), fx, fy, 1, 1); p.r('j', fx - 1, fy + 1, 3, 1); } p.obj(() => { p.disc('0', cx + 30, y0 + 110, 5); p.disc('h', cx + 30, y0 + 110, 4); p.r('8', cx + 28, y0 + 108, 2, 1); }); }
    if (r.chance(0.5)) stringLights(p, x0 + 10, y0 + 2, x1 - 10, y0 + 6, r);
  });
  fenceV(p, 144, top ? top - 8 : 0, SEG); fenceV(p, 300, top ? top - 8 : 0, SEG);
  if (top) fenceH(p, 0, SW, top - 8);
  if (!top) lamp(p, 224, 100, 34);
} };
/** fast foreground: overhanging trees, the odd branch and utility wires */
const yardFg = (keys = ['1', 'k', 'j'], density = 0.6, wireChance = 0.3): LayerDef => ({ speed: 1.4, paint(p, z) {
  const r = z.r;
  if (r.chance(density)) canopy(p, r.chance(0.5) ? r.int(-16, 50) : r.int(398, 464), r.int(50, 200), r.int(30, 44), r, keys);
  if (r.chance(density * 0.35)) branch(p, r.chance(0.5), r.int(30, 220), r.int(70, 130), r);
  if (r.chance(wireChance)) wires(p, r.int(30, 220), r);
  if (p.tod === 'dawn') mist(p, r);
} });
/** low morning mist (dawn only): long flat solid streaks, no halftone */
function mist(p: Painter, r: Rng) {
  for (let i = 0; i < 3; i++) { const x = r.int(-40, SW - 80), y = r.int(10, SEG - 10), w = r.int(90, 180); p.ell('3', x + w / 2, y, w / 2, 4.5); p.ell('4', x + w / 2 - 10, y - 1, w / 3, 2.5); }
}

// ---------------------------------------------------------------- STREET
const street: LayerDef = { speed: 1, opaque: true, paint(p, z) {
  const r = z.r; const cross = z.s % 4 === 3; const cy0 = 150, cy1 = 230;
  p.r('v', 0, 0, SW, SEG);
  for (let i = 0; i < 5; i++) { const x = r.int(130, 300), y = r.int(0, SEG - 30); p.r('1', x, y, r.int(14, 30), r.int(6, 20)); } // patched asphalt
  for (let i = 0; i < 40; i++) p.r('1', r.int(120, 328), r.int(0, SEG - 1), r.int(2, 4), 1);
  const segs: [number, number][] = cross ? [[0, cy0], [cy1, SEG]] : [[0, SEG]];
  for (const [a, b] of segs) for (let y = a; y < b; y += 32) { if (y + 14 < b) { p.r('h', 222, y + 4, 2, 14); p.r('h', 225, y + 4, 2, 14); } }
  for (const side of [0, 1]) {
    const sx = side ? 328 : 64;
    for (const [a, b] of segs) {
      p.r('q', sx, a, 56, b - a);
      for (let y = a; y < b; y += 28) p.r('v', sx, y, 56, 1);
      p.r('v', sx + 28, a, 1, b - a);
      p.r('p', side ? sx : sx + 54, a, 2, b - a);
      p.r('0', side ? sx - 1 : sx + 56, a, 1, b - a);
      const bx = side ? 384 : 0;
      for (let y = a; y < b; y += 64) {
        const hh = Math.min(64, b - y);
        if (hh < 20) continue;
        roof(p, bx, y, 64, hh, 30, 'q', 'b');
        const cornX = side ? bx : bx + 60;
        p.obj(() => { p.r('a', cornX, y + 1, 4, hh - 2); for (let j = y + 3; j < y + hh - 3; j += 5) p.r('b', cornX + (side ? 0 : 2), j, 2, 2); });
        skylight(p, bx + 20, y + 18, 16, 12, 0.85, r.next());
        if (r.chance(0.5)) vent(p, bx + (side ? 50 : 14), y + 46);
        const stx = side ? 384 - 14 : 64;
        if (hh >= 40) { p.shRect(stx, y + 22, 14, 18, 4); p.obj(() => { p.r('0', stx, y + 22, 14, 18); for (let i = 0; i < 5; i++) p.r(i % 2 ? 'a' : '9', side ? stx + 3 + i * 2 : stx + 1 + (4 - i) * 2, y + 23, 2, 16); p.r('0', stx, y + 22, 14, 1); }); }
      }
      for (let y = a + 20; y < b - 20; y += 64) { const tx = side ? sx + 34 : sx + 10; p.r('0', tx - 1, y - 1, 14, 14); p.r('b', tx, y, 12, 12); p.r('a', tx + 3, y + 3, 6, 6); }
      if (b - a > 100) lamp(p, side ? sx + 6 : sx + 48, a + 54, 44);
      if (r.chance(0.5) && b - a > 120) { const hx = side ? sx + 8 : sx + 44, hy = a + r.int(90, b - a - 10); p.shEll(hx, hy, 3, 3, 6); p.obj(() => { p.disc('0', hx, hy, 4); p.disc('h', hx, hy, 3); p.r('8', hx - 1, hy - 2, 1, 1); }); }
      if (r.chance(0.4) && b - a > 120) { const mx = side ? sx + 12 : sx + 36, my = a + r.int(110, b - a - 20); p.shRect(mx, my, 10, 12, 10); p.obj(() => { p.r('0', mx, my, 10, 12); p.r('n', mx + 1, my + 1, 8, 10); p.r('m', mx + 1, my + 1, 8, 2); }); }
    }
  }
  for (const [a, b] of segs) for (const lane of [124, 302]) for (let y = a + 6; y + 46 < b; y += 52) if (r.chance(0.55)) car(p, lane, y + r.int(0, 4), r.pick(['n', 'e', 'u', 'a', 'k', 'q', '2']), lane > 200);
  if (cross) {
    p.r('v', 0, cy0, SW, cy1 - cy0);
    for (let x = 0; x < SW; x += 40) { p.r('h', x + 6, cy0 + 38, 14, 2); p.r('h', x + 6, cy0 + 41, 14, 2); }
    for (let x = 124; x < 324; x += 10) { p.r('p', x, cy0 + 4, 6, 14); p.r('p', x, cy1 - 18, 6, 14); }
    for (let y = cy0 + 24; y < cy1 - 24; y += 10) { p.r('p', 70, y, 14, 6); p.r('p', 364, y, 14, 6); }
    lamp(p, 60, cy0 - 6, 40); lamp(p, 388, cy1 + 6, 40);
  }
  // manholes, spaced in world space so the steam anim lines up with them
  every(z, 300, 120, y => { if (y < -10 || y > SEG + 10 || (cross && y > cy0 - 10 && y < cy1 + 10)) return; p.disc('0', 188, y, 7); p.disc('q', 188, y, 6); p.ring('1', 188, y, 4, 4, 1); p.r('1', 186, y - 1, 5, 1); p.r('1', 186, y + 1, 5, 1); });
} };
/** steam puffs rising from manholes: solid stacked discs, no halftone */
const steamAnim = (mx: number, period: number, offset: number) => (px: Px, scroll: number, t: number, _s: number, tod: Tod) => {
  const [c0, c1, c2] = tod === 'night' ? ['3', '2', '4'] : tod === 'dusk' ? ['4', '3', '5'] : ['5', '4', '6'];
  everyScreen(scroll, period, offset, (sy, k) => {
    if (sy < -40 || sy > 400) return;
    for (let i = 0; i < 3; i++) {
      const ph = ((t + i * 40 + k * 17) % 120) / 120; if (ph > 0.8) continue;
      const rr = Math.round(2 + ph * 6); const yy = Math.round(sy - 4 - ph * 30), xx = Math.round(mx + Math.sin(ph * 5 + k) * 4);
      for (let j = -rr; j <= rr; j++) { const hw = Math.round(Math.sqrt(rr * rr - j * j)); px(ph < 0.45 ? c0 : c1, xx - hw, yy + j, hw * 2, 1); }
      if (ph < 0.45) px(c2, xx - 1, yy - rr + 1, 2, 1);
    }
  });
};

// ---------------------------------------------------------------- PARK
/** agility A-frame from above: two sloped panels meeting at a ridge, contact zones at both ends */
function aFrame(p: Painter, x: number, y: number) {
  const w = 30, h = 76, mid = y + h / 2;
  p.shRect(x, y + 10, w, h - 20, 16);
  p.obj(() => {
    p.r('0', x - 1, y - 1, w + 2, h + 2);
    p.r('p', x, y, w, h / 2); p.r('q', x, mid, w, h / 2);
    for (let j = 5; j < h; j += 5) if (Math.abs(y + j - mid) > 2) p.r(y + j < mid ? 'q' : 'v', x + 1, y + j, w - 2, 1);
    p.r('a', x, y, w, 12); p.r('b', x, y + h - 12, w, 12);
    p.r('9', x, y, w, 1); p.r('b', x, y + 11, w, 1); p.r('v', x, y + h - 12, w, 1);
    p.r('o', x, mid - 2, w, 1); p.r('0', x, mid - 1, w, 2);
    p.r('0', x - 2, y + 6, 2, h - 12); p.r('0', x + w, y + 6, 2, h - 12);
  });
}
function weavePoles(p: Painter, x: number, y: number) {
  p.r('q', x + 1, y, 2, 72);
  for (let i = 0; i < 6; i++) { const yy = y + i * 14, xx = x + (i % 2) * 3; p.shRect(xx, yy, 3, 3, 12); p.obj(() => { p.r('0', xx - 1, yy - 1, 5, 5); p.r(i % 2 ? 'a' : 'o', xx, yy, 3, 3); }); }
}
function tireJump(p: Painter, x: number, y: number) {
  p.shRect(x, y, 44, 6, 18);
  p.obj(() => { p.r('0', x, y, 44, 6); p.r('p', x + 1, y + 1, 42, 4); p.r('0', x + 12, y - 4, 20, 14); p.r('q', x + 13, y - 3, 18, 12); p.r('0', x + 16, y, 12, 6); p.r('a', x + 13, y - 3, 18, 2); });
}
function tunnel(p: Painter, x: number, y: number, len: number) {
  p.shRect(x, y, 22, len, 12);
  p.obj(() => { p.r('0', x - 1, y, 24, len); p.r('n', x, y, 22, len); p.r('m', x + 3, y, 2, len); p.r('2', x + 16, y, 5, len); for (let j = 3; j < len; j += 7) p.r('2', x, y + j, 22, 1); p.r('0', x + 3, y, 16, 3); p.r('0', x + 3, y + len - 3, 16, 3); });
}
function pond(p: Painter, cx: number, cy: number, rng: Rng) {
  p.ell('0', cx, cy, 52, 32); p.ell('b', cx, cy, 51, 31); p.ell('n', cx, cy, 48, 28); p.ell('2', cx + 4, cy + 4, 40, 22); p.ell('n', cx - 2, cy - 2, 36, 18);
  for (let i = 0; i < 5; i++) { const x = cx + rng.int(-36, 36), y = cy + rng.int(-16, 16); p.ell('k', x, y, 5, 4); p.r('n', x, y - 1, 4, 1); p.r('j', x - 3, y - 2, 2, 1); }
  p.r('m', cx - 20, cy - 8, 8, 1); p.r('m', cx + 10, cy + 6, 6, 1);
}
const park: LayerDef = { speed: 1, opaque: true, paint(p, z) {
  const r = z.r;
  grass(p, 0, 0, SW, SEG, r, 'k', 'j', 0.6);
  const px = (y: number) => 224 + Math.round(Math.sin(z.wy(y) / 170) * 96 + Math.sin(z.wy(y) / 61) * 10);
  for (let y = 0; y < SEG; y++) { const x = px(y); p.r('1', x - 17, y, 35, 1); p.r('q', x - 15, y, 31, 1); if ((y + z.s) % 5 === 0) p.r('p', x - 10 + ((y * 7) % 20), y, 1, 1); }
  for (const fx of [6, 438]) { p.r('0', fx, 0, 3, SEG); for (let y = 0; y < SEG; y += 4) p.r('q', fx - 2, y, 7, 1); for (let y = 0; y < SEG; y += 32) { p.r('0', fx - 1, y, 5, 5); p.r('o', fx, y + 1, 3, 3); } }
  const side = px(128) > 224 ? 0 : 1;
  const ex = side ? 260 : 40;
  const k = (z.s * 5 + r.int(0, 3)) % 4;
  if (k === 0) { aFrame(p, ex + 30, 56); weavePoles(p, ex + 110, 50); }
  else if (k === 1) { tunnel(p, ex + 20, 40, 120); tireJump(p, ex + 70, 140); }
  else if (k === 2) pond(p, ex + 80, 130, r);
  else { tireJump(p, ex + 20, 70); weavePoles(p, ex + 100, 110); bin(p, ex + 140, 40); }
  for (let i = 0; i < 2; i++) { const fx = side ? r.int(40, 150) : r.int(290, 400), fy = r.int(30, 220); if (Math.abs(px(fy) - fx) < 50) continue; p.ell('0', fx, fy, 15, 9); p.ell('b', fx, fy, 14, 8); for (let k2 = 0; k2 < 14; k2++) { const a = r.range(0, 6.28), d = r.range(0, 1); p.r(r.pick(['c', '7', 't', 'e']), fx + Math.cos(a) * d * 11, fy + Math.sin(a) * d * 5, 1, 1); p.r('j', fx + Math.cos(a) * d * 11 + 1, fy + Math.sin(a) * d * 5 + 1, 1, 1); } }
  if (r.chance(0.5)) { const bx = side ? r.int(40, 120) : r.int(300, 380), by = r.int(40, 200); if (Math.abs(px(by) - bx) > 60) { p.r('0', bx - 1, by - 1, 34, 26); for (let j = 0; j < 24; j += 6) for (let i2 = 0; i2 < 32; i2 += 6) p.r(((i2 + j) / 6) % 2 ? 'a' : '8', bx + i2, by + j, Math.min(6, 32 - i2), Math.min(6, 24 - j)); p.r('0', bx + 10, by + 8, 10, 8); p.r('a', bx + 11, by + 9, 8, 6); p.r('9', bx + 11, by + 9, 8, 1); } }
  for (const y of [40, 170]) { const x = px(y); bench(p, x + (y > 100 ? 22 : -34), y, true); }
  const ly = r.int(80, 140); lamp(p, px(ly) + 24, ly, 44);
  for (let i = 0; i < 6; i++) { const y = 20 + i * 36, x = px(y) + (i % 2 ? 6 : -8); p.r('v', x, y, 3, 3); p.r('v', x - 2, y - 3, 1, 1); p.r('v', x + 1, y - 4, 1, 1); p.r('v', x + 4, y - 3, 1, 1); }
} };

// ---------------------------------------------------------------- ALLEY
function dumpster(p: Painter, x: number, y: number) {
  p.shRect(x, y, 44, 26, 16);
  p.obj(() => { p.r('0', x - 1, y - 1, 46, 28); p.r('k', x, y, 44, 26); p.r('1', x, y + 12, 44, 2); p.r('j', x, y, 44, 1); p.r('j', x, y + 14, 44, 1); p.r('1', x + 21, y, 2, 26); p.r('q', x + 2, y + 2, 4, 2); p.r('q', x + 38, y + 2, 4, 2); });
}
function bags(p: Painter, x: number, y: number, rng: Rng) {
  for (let i = 0; i < 4; i++) { const bx = x + rng.int(0, 22), by = y + rng.int(0, 14), rr = rng.int(5, 7); p.shEll(bx, by, rr, rr, 4); p.obj(() => { p.disc('0', bx, by, rr + 1); p.disc('1', bx, by, rr); p.disc('q', bx - 2, by - 2, 2); p.r('p', bx - 3, by - 3, 1, 1); p.r('0', bx - 1, by - rr, 3, 2); }); }
}
/** puddle that mirrors the neon after dark (pink/cyan streaks), sky-blue glints by day */
function puddle(p: Painter, x: number, y: number, rng: Rng) {
  p.ell('1', x, y, 18, 7); p.ell('n', x + 1, y, 16, 5); p.ell('2', x + 4, y + 1, 10, 3);
  const k = rng.pick(['d', 'l', 'f']);
  p.glow('n', k, x - 8, y - 2, 6, 1, 1, 0); p.glow('n', k, x + 2, y + 1, 9, 1, 1, 0); p.glow('2', 'e', x - 2, y + 3, 5, 1, 1, 0);
}
/** cracked asphalt patch: darker irregular slab with ink crack lines (low contrast) */
function cracked(p: Painter, x: number, y: number, rng: Rng) {
  const w = rng.int(30, 60), h = rng.int(18, 34);
  for (let j = 0; j < h; j++) { const inset = Math.round(Math.abs(Math.sin(j * 0.7 + x)) * 4); p.r('1', x + inset, y + j, w - inset * 2 + rng.int(-1, 1), 1); }
  let cx = x + 4, cy = y + rng.int(4, h - 4);
  for (let i = 0; i < 6; i++) { const nx = cx + rng.int(5, 10), ny = Math.max(y + 2, Math.min(y + h - 2, cy + rng.int(-4, 4))); p.line('0', cx, cy, nx, ny); if (rng.chance(0.4)) p.line('0', nx, ny, nx + rng.int(-3, 3), ny + rng.int(3, 6)); cx = nx; cy = ny; }
}
function fireEscape(p: Painter, x: number, y: number, left: boolean) {
  const w = 22, h = 48;
  p.shRect(x, y, w, h, 18);
  p.obj(() => {
    p.r('0', x, y, w, h);
    for (let j = 2; j < h - 1; j += 3) p.r('q', x + 1, y + j, w - 2, 1);
    p.r('p', left ? x + w - 2 : x, y, 2, h); p.r('p', x, y, w, 1); p.r('p', x, y + h - 1, w, 1);
    for (let j = 6; j < h - 6; j += 4) p.r('o', left ? x + 4 : x + w - 8, y + j, 4, 1);
  });
}
const alley: LayerDef = { speed: 1, opaque: true, paint(p, z) {
  const r = z.r;
  p.r('v', 96, 0, 256, SEG);
  for (let i = 0; i < 3; i++) cracked(p, r.int(110, 290), r.int(0, SEG - 40), r);
  for (let i = 0; i < 30; i++) { const x = r.int(100, 340), y = r.int(0, SEG - 4); p.r('1', x, y, r.int(2, 4), 1); }
  // centre drain gutter + grates
  p.r('1', 222, 0, 3, SEG); for (let y = 0; y < SEG; y += 64) { p.r('0', 216, y + 20, 16, 12); for (let i = 0; i < 4; i++) p.r('q', 218 + i * 4, y + 21, 2, 10); }
  puddle(p, r.int(140, 200), r.int(30, 220), r);
  puddle(p, r.int(250, 310), r.int(30, 220), r);
  // manhole (world-spaced, steam rises from it in the anim)
  every(z, 280, 60, y => { if (y < -10 || y > SEG + 10) return; p.disc('0', 262, y, 8); p.disc('q', 262, y, 7); p.ring('1', 262, y, 5, 5, 1); for (let i = -3; i <= 3; i += 2) p.r('1', 258, y + i, 9, 1); });
  for (const side of [0, 1]) {
    const bx = side ? 352 : 0;
    let y = -(z.s * 37 % 64);
    while (y < SEG) { const hh = r.int(80, 140); roof(p, bx, y, 96, hh, 40, r.pick(['q', 'v']), r.pick(['p', 'b', 'a'])); acUnit(p, bx + r.int(20, 50), y + r.int(20, Math.max(24, hh - 40))); y += hh; }
    for (let fy = 20; fy < SEG - 50; fy += r.int(90, 120)) fireEscape(p, side ? 330 : 96, fy, !side);
  }
  const items = r.int(4, 5);
  for (let i = 0; i < items; i++) {
    const left = i % 2 === (z.s & 1); const y = 10 + i * 48 + r.int(0, 16);
    const x = left ? 122 : 286;
    const k = r.int(0, 4);
    if (k === 4) { p.obj(() => { p.disc('0', x + 6, y + 6, 5); p.disc('p', x + 6, y + 6, 4); p.disc('a', x + 6, y + 6, 2); p.disc('0', x + 18, y + 8, 5); p.disc('n', x + 18, y + 8, 4); p.disc('o', x + 18, y + 8, 2); p.r('9', x + 2, y + 18, 22, 14); p.r('a', x + 2, y + 25, 22, 1); p.r('b', x + 12, y + 18, 1, 14); }); }
    else if (k === 0) dumpster(p, left ? x : x - 6, y);
    else if (k === 1) bags(p, x, y, r);
    else if (k === 2) { crate(p, x, y, 20, 20); crate(p, x + 6, y + 22, 18, 18, '9'); }
    else { p.shRect(x, y, 18, 14, 6); p.obj(() => { p.r('0', x, y, 18, 14); p.r('n', x + 1, y + 1, 16, 12); for (let i2 = 3; i2 < 16; i2 += 4) p.r('2', x + i2, y + 2, 2, 10); }); }
  }
  // bodega: awning + neon sign + door light
  if (z.s % 2 === 0) {
    const ay = r.int(60, 160);
    p.shRect(96, ay, 26, 54, 12);
    p.obj(() => { p.r('0', 96, ay, 26, 54); for (let j = 0; j < 54; j += 6) p.r(j % 12 ? '7' : 'k', 96, ay + j + 1, 25, 5); p.r('j', 96, ay + 1, 2, 52); });
    p.obj(() => { p.r('0', 74, ay + 6, 20, 42); p.r('1', 75, ay + 7, 18, 40); });
    p.obj(() => { const nx = 79, ny = ay + 10; for (const [dx, dy, w, h] of [[0, 0, 10, 1], [0, 0, 1, 34], [9, 0, 1, 34], [0, 33, 10, 1], [3, 6, 4, 4], [3, 16, 4, 1], [3, 22, 4, 6]]) p.glow('e', dx < 1 || dx > 8 || dy === 0 || dy === 33 ? 'd' : 'l', nx + dx, ny + dy, w, h); });
    p.pool(134, ay + 27, 40);
  }
  p.pool(r.chance(0.5) ? 112 : 336, r.int(30, 220), 32);
} };
const laundryFg: LayerDef = { speed: 1.45, paint(p, z) {
  const r = z.r;
  if (r.chance(0.55)) {
    const y = r.int(20, 220), y2 = y + r.int(-10, 10);
    p.line('0', 80, y, 368, y2);
    for (let x = 100; x < 350; x += r.int(16, 30)) { const yy = Math.round(y + ((y2 - y) * (x - 80)) / 288); const k = r.pick(['n', 'e', '9', 'u', 'p', 'a', 'k']); const ww = r.int(8, 14), hh = r.int(10, 18); p.r('0', x, yy + 1, ww, hh); p.r(k, x + 1, yy + 1, ww - 2, hh - 1); p.r('0', x + 1, yy + 2, ww - 2, 1); }
  } else if (r.chance(0.5)) wires(p, r.int(30, 220), r);
} };

// ---------------------------------------------------------------- ROOFTOPS
const cityBelow: LayerDef = { speed: 0.45, opaque: true, paint(p, z) {
  const r = z.r;
  p.r('1', 0, 0, SW, SEG);
  for (let by = 0; by < SEG; by += 64) for (let bx = -8 + (z.s % 2) * 20; bx < SW; bx += 56) {
    p.r('v', bx + 6, by + 6, 44, 52); p.r('2', bx + 8, by + 8, 40, 48); p.r('3', bx + 8, by + 8, 40, 1); p.r('v', bx + 8 + r.int(8, 30), by + 8, 1, 48);
    for (let i = 0; i < 5; i++) p.glow('1', r.pick(['f', 'g', '7']), bx + r.int(10, 44), by + r.int(10, 52), 1, 1, 0.6, r.next());
    if (r.chance(0.3)) p.r('k', bx + 12, by + 12, 16, 12);
  }
  for (let x = 2 + (z.s % 2) * 20; x < SW; x += 56) for (let y = 0; y < SEG; y += 12) { if (r.chance(0.1)) { p.glow('q', 'f', x - 1, y, 1, 1); p.glow('q', 'f', x + 1, y, 1, 1); } if (r.chance(0.08)) { p.glow('q', 'r', x + 2, y, 1, 1); } }
  for (let y = 0; y < SEG; y += 64) for (let x = 0; x < SW; x += 9) if (r.chance(0.12)) p.glow('q', 'g', x, y + 2, 1, 1, 0.8, r.next());
} };
/** occupancy grid (8px cells) for packing roof furniture without overlaps */
class Packer {
  cells = new Set<number>();
  constructor(public x: number, public y: number, public w: number, public h: number, public r: Rng) {}
  place(w: number, h: number, tries = 14): [number, number] | null {
    for (let t = 0; t < tries; t++) {
      const x = this.x + this.r.int(0, Math.max(0, Math.floor((this.w - w) / 8))) * 8, y = this.y + this.r.int(0, Math.max(0, Math.floor((this.h - h) / 8))) * 8;
      if (x + w > this.x + this.w || y + h > this.y + this.h) continue;
      let ok = true; const ks: number[] = [];
      for (let j = y - 4; j < y + h + 4 && ok; j += 8) for (let i = x - 4; i < x + w + 4; i += 8) { const k = (j >> 3) * 1000 + (i >> 3); if (this.cells.has(k)) { ok = false; break; } ks.push(k); }
      if (!ok) continue; ks.forEach(k => this.cells.add(k)); return [x, y];
    }
    return null;
  }
}
function solar(p: Painter, sx: number, sy: number, sw: number) {
  p.shRect(sx, sy, sw, 20, 4);
  p.obj(() => { p.r('0', sx, sy, sw, 20); p.r('2', sx + 1, sy + 1, sw - 2, 18); for (let k = sx + 1; k < sx + sw; k += 12) p.r('1', k, sy + 1, 1, 18); p.r('1', sx + 1, sy + 10, sw - 2, 1); p.r('3', sx + 1, sy + 1, sw - 2, 1); });
}
function bulkhead(p: Painter, x: number, y: number) {
  p.shRect(x, y, 26, 28, 24);
  p.obj(() => { p.r('0', x, y, 26, 28); p.r('p', x + 1, y + 1, 24, 26); p.r('o', x + 1, y + 1, 24, 1); p.r('q', x + 3, y + 4, 20, 20); p.r('v', x + 3, y + 14, 20, 1); });
  p.glow('q', 'f', x + 9, y + 28, 8, 2); p.pool(x + 13, y + 36, 24);
}
/** Rooftop garden: plank deck, raised beds of greens, a bistro set and string lights on corner posts (lit after dark) */
function roofGarden(p: Painter, x: number, y: number, w: number, h: number, rng: Rng) {
  p.r('0', x, y, w, h); p.r('b', x + 1, y + 1, w - 2, h - 2);
  for (let j = y + 4; j < y + h - 1; j += 4) p.r('v', x + 1, j, w - 2, 1);
  for (let j = y + 1; j < y + h - 1; j += 4) for (let i = x + 1 + ((j - y) % 8 ? 13 : 33); i < x + w - 1; i += 40) p.r('v', i, j, 1, 3);
  const bed = (bx: number, by: number, bw: number, bh: number) => {
    p.shRect(bx, by, bw, bh, 6);
    p.obj(() => {
      p.r('0', bx, by, bw, bh); p.r('a', bx + 1, by + 1, bw - 2, bh - 2); p.r('9', bx + 1, by + 1, bw - 2, 1); p.r('9', bx + 1, by + 1, 1, bh - 2);
      p.r('1', bx + 3, by + 3, bw - 6, bh - 6);
      for (let j = by + 6; j < by + bh - 4; j += 6) for (let i = bx + 6; i < bx + bw - 4; i += 6) { p.disc('k', i, j, 3); p.r('j', i - 1, j - 2, 2, 1); if (rng.chance(0.15)) p.r(rng.pick(['c', 'f', '7']), i + 1, j, 1, 1); }
    });
  };
  bed(x + 4, y + 4, w - 8, 16);
  bed(x + 4, y + 22, 16, h - 26);
  if (w > 80) bed(x + w - 20, y + 22, 16, h - 26);
  const tx = x + (w >> 1) + 2, ty = y + 22 + ((h - 26) >> 1);
  p.shEll(tx, ty, 6, 6, 8);
  p.obj(() => { p.disc('0', tx, ty, 7); p.disc('p', tx, ty, 6); p.disc('o', tx - 1, ty - 1, 4); for (const [dx, dy] of [[-12, 0], [12, 0]]) { p.r('0', tx + dx - 4, ty + dy - 4, 8, 8); p.r('n', tx + dx - 3, ty + dy - 3, 6, 6); p.r('m', tx + dx - 3, ty + dy - 3, 6, 1); } });
  const posts: [number, number][] = [[x + 2, y + 2], [x + w - 4, y + 2], [x + 2, y + h - 4], [x + w - 4, y + h - 4]];
  p.obj(() => { for (const [px, py] of posts) { p.r('0', px - 1, py - 1, 4, 4); p.r('p', px, py, 2, 2); } });
  stringLights(p, posts[0][0] + 1, posts[0][1] + 1, posts[3][0] + 1, posts[3][1] + 1, rng, 6);
  stringLights(p, posts[1][0] + 1, posts[1][1] + 1, posts[2][0] + 1, posts[2][1] + 1, rng, 6);
  p.pool(tx, ty, 30);
}
function dish(p: Painter, x: number, y: number) {
  p.shEll(x, y, 6, 6, 10);
  p.obj(() => { p.disc('0', x, y, 7); p.disc('o', x, y, 6); p.disc('p', x + 1, y + 1, 4); p.line('q', x, y, x + 4, y - 4); p.r('h', x + 4, y - 4, 1, 1); });
}
function coop(p: Painter, x: number, y: number) {
  p.shRect(x, y, 30, 22, 12);
  p.obj(() => { p.r('0', x, y, 30, 22); p.r('a', x + 1, y + 1, 28, 20); p.r('9', x + 1, y + 1, 28, 1); for (let i = x + 4; i < x + 28; i += 4) p.r('b', i, y + 4, 1, 15); p.r('b', x + 3, y + 11, 24, 1); });
}
/**
 * NYC wooden water tower (3/4 view from above): conical shingled cap with a
 * centre finial, a band of vertical staves with two iron hoops, and four stilt
 * legs with X-bracing that throw a long shadow across the roof.
 * Footprint: (cx-r-2 .. cx+r+2) x (top .. top + towerH(r)).
 */
const towerH = (r: number) => Math.round(r * 0.62) * 2 + r + 11;
function waterTower(p: Painter, cx: number, top: number, r: number) {
  const ry = Math.round(r * 0.62), cy = top + ry, th = r, lh = 10;
  const legTop = cy + th, feet = legTop + lh;
  const legs = [cx - r + 2, cx - Math.round(r / 3) - 1, cx + Math.round(r / 3), cx + r - 3];
  p.shEll(cx, feet - 3, r, ry * 0.7, 30);
  for (const lx of legs) p.shRect(lx, feet - 1, 2, 2, 30);
  p.obj(() => {
    // legs + bracing + feet
    for (const lx of legs) { p.r('0', lx, legTop - 2, 2, lh + 2); p.r('p', lx, legTop - 2, 1, lh + 1); p.r('0', lx - 1, feet - 1, 4, 2); }
    p.line('0', legs[0], legTop + 1, legs[3], feet - 3); p.line('0', legs[3], legTop + 1, legs[0], feet - 3);
    // tank: staves with cylinder shading, rounded bottom, iron hoops
    const bot = Math.round(ry * 0.55);
    spans(cx, cy + th, r + 1, bot + 1, (sx, sy, w) => p.r('0', sx, sy, w, 1));
    p.r('0', cx - r - 1, cy, 2 * r + 2, th);
    for (let x = -r; x < r; x++) {
      const t = (x + 0.5) / r; let k = t < -0.45 ? '9' : t < 0.35 ? 'a' : 'b';
      if ((x + r) % 3 === 2) k = k === '9' ? 'a' : k === 'a' ? 'b' : 'v';
      const ext = Math.round(Math.sqrt(Math.max(0, 1 - t * t)) * bot);
      p.r(k, cx + x, cy, 1, th + ext - 1);
    }
    for (const hy of [cy + Math.round(th * 0.4), cy + th - 2]) { p.r('0', cx - r, hy, 2 * r, 1); p.r('p', cx - r + 1, hy, Math.round(r * 0.5), 1); }
    // conical cap: lit from the upper left, concentric shingle courses + radial seams
    const rx = r + 2, apY = cy - Math.round(ry * 0.35);
    spans(cx, cy, rx + 1, ry + 1, (sx, sy, w) => p.r('0', sx, sy, w, 1));
    spans(cx, cy, rx, ry, (sx, sy, w) => {
      for (let x = sx; x < sx + w; x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (sy + 0.5 - apY) / (ry + (cy - apY));
        const d = Math.sqrt(dx * dx + dy * dy); const lit = dx * 0.85 + dy * 0.5;
        let k = lit < -0.3 ? '9' : lit < 0.3 ? 'a' : 'b';
        const ring = (d * 4.2) % 1 < 0.2, seam = d > 0.25 && Math.abs(Math.sin(Math.atan2(dy, dx) * 4)) < 0.12;
        if (ring || seam) k = k === '9' ? 'a' : k === 'a' ? 'b' : 'v';
        p.r(k, x, sy, 1, 1);
      }
    });
    p.disc('0', cx, apY, 2); p.r('o', cx - 1, apY - 1, 1, 1); p.r('0', cx, apY - 3, 1, 2);
    p.glow('0', 'r', cx, apY - 4, 1, 1, 0.9, 0);
  });
}
const rooftops: LayerDef = { speed: 1, paint(p, z) {
  const r = z.r; const gap = 40; const bh = SEG - gap;
  let x = -r.int(0, 24);
  while (x < SW) {
    const w = r.int(3, 5) * 32; const split = r.chance(0.7);
    const rows: [number, number][] = split ? (() => { const m = r.int(2, 4) * 32 + 8; return [[r.int(0, 1) * 8, m - 4], [m + 4, bh - m - 4 - r.int(0, 1) * 8]]; })() : [[r.int(0, 2) * 8, bh - r.int(0, 2) * 8]];
    for (const [y, h0] of rows) {
      const h = Math.max(48, h0);
      const height = r.int(14, 40); const rim = r.pick(['p', 'b', 'a', 'p', 'q']);
      roof(p, x, y, w - 4, h, height, r.pick(['q', 'q', 'v']), rim);
      const pk = new Packer(x + 8, y + 8, w - 20, h - 16, r);
      const want = ['tower', 'ac', 'vent', 'sky', 'ac', 'dish', 'tower', 'chimney', 'tower', 'sky'];
      if (r.chance(0.55) && w >= 96 && h >= 64) { const gw = Math.min(w - 28, 112), gh = Math.min(h - 24, 72); const at = pk.place(gw, gh); if (at) roofGarden(p, at[0], at[1], gw, gh, r); }
      if (r.chance(0.25) && w >= 128) { const at = pk.place(96, 20); if (at) solar(p, at[0], at[1], 96); }
      if (r.chance(0.4)) { const at = pk.place(26, 28); if (at) bulkhead(p, at[0], at[1]); }
      const nItems = Math.round((w * h) / 3000) + r.int(1, 2);
      for (let i = 0; i < nItems; i++) {
        const f = r.pick(want);
        if (f === 'tower') { const rr = r.int(11, 14); const at = pk.place(rr * 2 + 6, towerH(rr) + 4); if (at) waterTower(p, at[0] + rr + 3, at[1], rr); }
        else if (f === 'ac') { const at = pk.place(22, 16); if (at) acUnit(p, at[0], at[1]); }
        else if (f === 'vent') { const at = pk.place(10, 10); if (at) vent(p, at[0] + 5, at[1] + 5); }
        else if (f === 'sky') { const at = pk.place(24, 16); if (at) skylight(p, at[0], at[1], 24, 16, 0.85, r.next()); }
        else if (f === 'dish') { const at = pk.place(14, 14); if (at) dish(p, at[0] + 7, at[1] + 7); }
        else if (f === 'chimney') { const at = pk.place(16, 12); if (at) { const [cx, cy] = at; p.shRect(cx, cy, 16, 12, 16); p.obj(() => { p.r('0', cx, cy, 16, 12); p.r('a', cx + 1, cy + 1, 14, 10); p.r('b', cx + 1, cy + 6, 14, 1); p.r('0', cx + 3, cy + 3, 4, 4); p.r('0', cx + 9, cy + 3, 4, 4); }); } }
      }
      if (r.chance(0.2)) { const at = pk.place(30, 22); if (at) coop(p, at[0], at[1]); }
    }
    x += w + r.pick([0, 0, 8, 16]);
  }
} };
const pigeonsFg: LayerDef = { speed: 1.6, paint(p, z) {
  const r = z.r;
  if (r.chance(0.45)) { const cx = r.int(60, 380), cy = r.int(40, 200); for (let i = 0; i < r.int(3, 5); i++) { const x = cx + r.int(-30, 30), y = cy + r.int(-20, 20); p.r('0', x - 4, y, 9, 2); p.r('q', x - 3, y, 7, 1); p.r('0', x, y - 1, 2, 4); p.r('p', x, y - 2, 1, 1); } }
  if (r.chance(0.3)) wires(p, r.int(30, 220), r);
} };

// ---------------------------------------------------------------- CAFE
function cafeTable(p: Painter, cx: number, cy: number, rng: Rng) {
  for (const [dx, dy] of [[-17, 0], [17, 0], [0, -17], [0, 17]]) { if (rng.chance(0.25)) continue; const x = cx + dx, y = cy + dy; p.shRect(x - 5, y - 5, 10, 10, 6); p.obj(() => { p.r('0', x - 5, y - 5, 10, 10); p.r('q', x - 4, y - 4, 8, 8); p.r('p', x - 4, y - 4, 8, 2); }); }
  p.shEll(cx, cy, 12, 12, 14);
  p.obj(() => {
    p.disc('0', cx, cy, 13); p.disc('p', cx, cy, 12); p.disc('o', cx - 1, cy - 1, 10); p.disc('p', cx + 1, cy + 1, 8);
    const ux = cx + rng.int(-5, 3), uy = cy + rng.int(-5, 3); p.disc('0', ux, uy, 3); p.disc('7', ux, uy, 2); p.r('a', ux, uy, 1, 1);
    if (rng.chance(0.6)) { p.disc('0', cx - 4, cy + 4, 3); p.disc('8', cx - 4, cy + 4, 2); }
  });
}
/** round cat bed: thick bolster rim (lit top-left), sunken fleece cushion with a paw print, a fish toy beside it */
function catBed(p: Painter, cx: number, cy: number, rim = 'n') {
  const [lit, body, dark] = rim === 'n' ? ['m', 'n', '2'] : ['d', 'e', 'v'];
  p.shEll(cx, cy, 14, 11, 5);
  p.obj(() => {
    p.ell('0', cx, cy, 15, 12); p.ell(dark, cx, cy, 14, 11); p.ell(body, cx - 1, cy - 1, 13, 10); p.ell(lit, cx - 3, cy - 3, 8, 5); p.ell(body, cx - 1, cy - 1, 10, 7);
    p.ell('0', cx, cy, 9, 6); p.ell('q', cx, cy, 8, 5); p.ell('p', cx - 1, cy - 1, 6, 3);
    p.r('q', cx - 1, cy, 3, 2); for (const [dx, dy] of [[-3, -2], [-1, -3], [2, -3], [4, -2]]) p.r('q', cx + dx, cy + dy, 1, 1);
    const fx = cx + 14, fy = cy + 9; p.r('0', fx - 1, fy - 1, 9, 4); p.r('h', fx, fy, 6, 2); p.r('h', fx + 6, fy - 1, 1, 1); p.r('h', fx + 6, fy + 2, 1, 1); p.r('0', fx + 1, fy, 1, 1);
  });
}
function catTree(p: Painter, cx: number, cy: number) {
  p.shRect(cx - 18, cy - 18, 36, 36, 26);
  p.obj(() => {
    p.r('0', cx - 19, cy - 19, 38, 38); p.r('u', cx - 18, cy - 18, 36, 36); p.r('t', cx - 18, cy - 18, 36, 1);
    p.disc('0', cx + 8, cy + 8, 8); p.disc('9', cx + 8, cy + 8, 7); p.ring('a', cx + 8, cy + 8, 5, 5, 1); p.ring('a', cx + 8, cy + 8, 3, 3, 1);
    p.disc('0', cx - 6, cy - 6, 12); p.disc('e', cx - 6, cy - 6, 11); p.disc('u', cx - 7, cy - 7, 9); p.disc('0', cx - 6, cy - 6, 3);
    p.r('c', cx - 10, cy + 6, 2, 8); p.disc('t', cx - 9, cy + 15, 2);
  });
}
const cafe: LayerDef = { speed: 1, opaque: true, paint(p, z) {
  const r = z.r;
  // floor: dark walnut planks, one quiet seam tone
  p.r('b', 0, 0, SW, SEG);
  for (let x = 70; x < SW; x += 14) { p.r('v', x, 0, 1, SEG); const off = ((x * 37) % 96); for (let y = -off; y < SEG; y += 96) p.r('v', x, y, 14, 1); }
  for (let i = 0; i < 40; i++) { const x = 72 + r.int(0, 25) * 14 + r.int(3, 9), y = r.int(0, SEG - 8); p.r('a', x, y, 1, r.int(3, 6)); }
  // counter on the left
  p.shRect(0, 0, 70, SEG, 18);
  p.obj(() => {
    p.r('0', 0, 0, 70, SEG); p.r('a', 0, 0, 68, SEG); p.r('9', 64, 0, 4, SEG); p.r('b', 0, 0, 4, SEG);
    for (let y = 0; y < SEG; y += 32) p.r('b', 4, y, 60, 1);
  });
  const ey = r.int(10, 130);
  p.obj(() => { p.r('0', 10, ey, 40, 32); p.r('p', 11, ey + 1, 38, 30); p.r('o', 11, ey + 1, 38, 2); p.r('q', 14, ey + 8, 32, 14); p.r('0', 18, ey + 22, 6, 6); p.r('0', 34, ey + 22, 6, 6); });
  p.glow('q', 'r', 44, ey + 4, 2, 2); p.glow('q', 'i', 40, ey + 4, 2, 2);
  p.obj(() => { const cy = (ey + 120) % 220 + 10; p.r('0', 8, cy, 52, 26); p.r('2', 9, cy + 1, 50, 24); p.r('n', 9, cy + 1, 50, 2); for (let i = 0; i < 6; i++) { p.disc('0', 16 + i * 7, cy + 14, 3); p.disc(i % 2 ? '8' : 'c', 16 + i * 7, cy + 14, 2); } });
  for (let y = 24; y < SEG; y += 52) { const sy = y; p.shEll(84, sy, 6, 6, 10); p.obj(() => { p.disc('0', 84, sy, 7); p.disc('a', 84, sy, 6); p.disc('9', 83, sy - 1, 4); p.disc('a', 84, sy, 2); }); }
  // windows on the right wall; low sun throws long beams across the floor at dawn / day
  p.obj(() => { p.r('0', SW - 30, 0, 30, SEG); p.r('a', SW - 28, 0, 28, SEG); for (let y = 8; y < SEG; y += 64) { p.r('0', SW - 26, y, 22, 48); p.glow('2', 'g', SW - 24, y + 2, 18, 44, 1); p.r('1', SW - 15, y + 2, 1, 44); } });
  if (p.tod === 'dawn' || p.tod === 'day') for (let y = 8; y < SEG; y += 64) { const len = p.tod === 'dawn' ? 210 : 110; p.beam(SW - 30 - len, y + 18, len, 30, p.tod === 'dawn' ? 0.9 : 0.4); }
  for (let y = 40; y < SEG; y += 128) { const px = SW - 46, py = y; p.shEll(px, py, 9, 9, 12); p.obj(() => { p.disc('0', px, py, 10); p.disc('a', px, py, 9); p.disc('b', px + 1, py + 1, 7); for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.28; p.ell('0', px + Math.cos(a) * 7, py + Math.sin(a) * 7, 5, 3); p.ell('k', px + Math.cos(a) * 7, py + Math.sin(a) * 7, 4, 2); } p.disc('j', px - 1, py - 1, 2); }); }
  const k = (z.s + r.int(0, 2)) % 3;
  if (k === 0) { p.ell('0', 230, 128, 92, 62); p.ell('v', 230, 128, 90, 60); p.ring('e', 230, 128, 84, 54, 1); p.ring('e', 230, 128, 78, 48, 1); cafeTable(p, 190, 110, r); cafeTable(p, 272, 150, r); catBed(p, 250, 80, 'e'); catBed(p, 150, 200); }
  else if (k === 1) { for (const [tx, ty] of [[140, 50], [250, 60], [340, 150], [160, 160]]) cafeTable(p, tx + r.int(-8, 8), ty + r.int(-8, 8), r); catBed(p, 270, 210); p.pool(250, 60, 40); p.pool(160, 160, 40); }
  else { p.r('0', 120, 40, 200, 180); p.r('v', 121, 41, 198, 178); p.frame('e', 124, 44, 192, 172); catTree(p, 180, 100); catBed(p, 270, 90, 'e'); catBed(p, 250, 180); }
  p.pool(200, r.int(60, 200), 38);
} };
/** close-to-camera pendant lamps and a ceiling fan sweeping past (fg) */
const pendantsFg: LayerDef = { speed: 1.35, paint(p, z) {
  const r = z.r;
  for (let i = 0; i < 2; i++) if (r.chance(0.6)) {
    const x = r.int(110, 380), y = r.int(30, 220);
    p.line('0', x, y - 40, x, y - 10);
    p.disc('0', x, y, 11); p.disc('q', x, y, 10); p.disc('p', x - 2, y - 2, 6); p.disc('q', x, y, 5); p.disc('0', x, y, 3);
    p.glow('1', 'f', x - 1, y - 1, 3, 3, 1, 0); p.glow('0', '7', x, y, 1, 1, 1, 0);
  }
  if (r.chance(0.45)) {
    const x = r.int(150, 320), y = r.int(60, 200);
    for (let i = 0; i < 4; i++) { const a = (i / 4) * 6.28 + 0.4; const ex = x + Math.cos(a) * 34, ey = y + Math.sin(a) * 34; for (let t = 6; t < 34; t++) { const bx = x + Math.cos(a) * t, by = y + Math.sin(a) * t; p.disc('0', bx, by, 4); } for (let t = 6; t < 34; t++) { const bx = x + Math.cos(a) * t, by = y + Math.sin(a) * t; p.disc('b', bx, by, 3); } p.r('a', ex - 1, ey - 1, 2, 2); }
    p.disc('0', x, y, 7); p.disc('q', x, y, 6); p.disc('p', x - 1, y - 1, 3);
  }
} };

// ---------------------------------------------------------------- DOCKS
function fishCrate(p: Painter, x: number, y: number, rng: Rng) {
  p.shRect(x, y, 22, 16, 7);
  p.obj(() => {
    p.r('0', x, y, 22, 16); p.r('a', x + 1, y + 1, 20, 14); p.r('s', x + 3, y + 3, 16, 10); p.r('5', x + 3, y + 3, 16, 1);
    for (let i = 0; i < 3; i++) { const fy = y + 4 + i * 3; const fx = x + 4 + rng.int(0, 4); p.r('p', fx, fy, 10, 2); p.r('o', fx, fy, 10, 1); p.r('0', fx + 1, fy, 1, 1); p.r('p', fx + 10, fy - 1, 2, 1); p.r('p', fx + 10, fy + 2, 2, 1); }
    p.r('b', x + 1, y + 1, 20, 1);
  });
}
function bollard(p: Painter, x: number, y: number) { p.shEll(x, y, 3, 3, 6); p.obj(() => { p.disc('0', x, y, 4); p.disc('q', x, y, 3); p.r('p', x - 1, y - 2, 2, 1); }); }
/** piling standing in the water: wet dark top, foam line on the downstream side */
function piling(p: Painter, x: number, y: number) {
  p.r('5', x - 4, y + 3, 9, 1); p.r('4', x - 6, y + 5, 3, 1); p.r('4', x + 4, y + 5, 3, 1); p.r('s', x - 2, y + 4, 5, 1);
  p.disc('0', x, y, 4); p.disc('b', x, y, 3); p.r('a', x - 1, y - 2, 2, 1);
}
/** buoy: muted orange with a white band so it never reads as an enemy bullet */
function buoy(p: Painter, x: number, y: number) {
  p.ell('5', x, y + 4, 7, 2); p.ell('n', x, y + 4, 5, 1);
  p.disc('0', x, y, 5); p.disc('h', x, y, 4); p.r('7', x - 4, y - 1, 8, 2); p.r('g', x - 2, y - 3, 2, 1);
}
/** slow water far below the piers: two-tone ripple lattice + sparse glints (parallax: moves slower than the planks) */
const water: LayerDef = { speed: 0.72, opaque: true, paint(p, z) {
  p.r('n', 0, 0, SW, SEG);
  for (let y = 0; y < SEG; y += 6) {
    const w = z.wy(y); const off = Math.round(Math.sin(w / 37) * 10 + Math.sin(w / 13) * 3);
    for (let x = ((y / 6) % 2) * 14 + off - 28; x < SW; x += 28) { const len = 7 + Math.round(Math.abs(Math.sin((x + w) / 19)) * 6); p.r('2', x, y, len, 1); p.r('2', x + 2, y + 1, len - 4, 1); }
  }
  for (let i = 0; i < 26; i++) { const x = z.r.int(0, SW - 6), y = z.r.int(0, SEG - 2); p.r('m', x, y, z.r.int(2, 5), 1); }
} };
const docks: LayerDef = { speed: 1, paint(p, z) {
  const r = z.r;
  // boardwalk on the left: planks with 1px gaps showing the water below
  const bw = 104;
  p.shRect(bw, 0, 2, SEG, 6);
  p.r('0', bw, 0, 1, SEG);
  for (let y = 0; y < SEG; y += 8) { p.r('p', 0, y, bw, 7); for (let x = ((y / 8) % 2) * 26; x < bw; x += 52) p.r('q', x, y, 1, 7); p.r('o', 2 + (y * 13) % 90, y + 2, 2, 1); p.r('q', 0, y + 6, bw, 1); }
  for (let y = 12; y < SEG; y += 48) bollard(p, bw - 6, y);
  every(z, 48, 0, y => { if (y > -6 && y < SEG + 6) piling(p, bw + 3, y); });
  // finger pier + boats
  const fy = r.int(40, 70); const len = r.int(200, 290);
  p.shRect(bw, fy, len, 32, 6);
  p.obj(() => { p.r('0', bw, fy - 1, len + 1, 34); for (let x = bw; x < bw + len; x += 8) { p.r('p', x, fy, 7, 32); p.r('q', x + 7, fy, 1, 32); p.r('o', x + 2, fy + ((x * 7) % 26) + 2, 1, 2); } });
  for (let x = bw + 8; x < bw + len; x += 40) { piling(p, x, fy - 2); piling(p, x, fy + 34); }
  fishCrate(p, bw + r.int(30, 60), fy + 8, r); fishCrate(p, bw + r.int(100, 140), fy + 8, r);
  if (r.chance(0.6)) { const cx = bw + r.int(160, len - 30); p.obj(() => { p.ring('0', cx, fy + 16, 9, 9, 1); p.ring('9', cx, fy + 16, 8, 8, 2); p.ring('a', cx, fy + 16, 5, 5, 1); p.ring('9', cx, fy + 16, 3, 3, 1); }); }
  lamp(p, bw + len - 10, fy + 16, 46);
  boat(p, bw + r.int(16, 60), fy + 46, 30, r.int(84, 110), r.pick(['p', 'a', 'k', 'n', 'e']), r, r.chance(0.5));
  if (r.chance(0.6)) boat(p, bw + r.int(150, 200), fy + 70, 26, r.int(60, 80), r.pick(['p', 'h', 'o']), r, true, true); // under way, with wake
  else if (r.chance(0.8)) boat(p, bw + r.int(120, 180), fy + 42, 34, r.int(90, 130), r.pick(['p', 'a', 'o']), r, false);
  if (fy > 54 && len < 270) boat(p, bw + len + 12, 4, 22, 46, r.pick(['a', 'k', 'n']), r, true);
  for (let y = 20; y < SEG - 30; y += r.int(50, 80)) { const k = r.int(0, 2); if (k === 0) { fishCrate(p, 14, y, r); fishCrate(p, 16, y + 18, r); } else if (k === 1) { p.shEll(40, y + 10, 14, 10, 4); p.obj(() => { p.ell('0', 40, y + 10, 15, 11); p.ell('k', 40, y + 10, 14, 10); p.checker('1', 28, y + 2, 26, 18); }); } else { crate(p, 20, y, 24, 24); } }
  for (let i = 0; i < 2; i++) buoy(p, r.int(bw + 40, SW - 14), r.int(fy + 50, SEG - 8));
  p.pool(50, r.int(40, 200), 40);
} };
/** gulls overhead: the bird plus its soft shadow far below on the water */
const gullsFg: LayerDef = { speed: 1.7, paint(p, z) {
  const r = z.r;
  for (let i = 0; i < 2; i++) if (r.chance(0.55)) {
    const x = r.int(40, 400), y = r.int(20, 220);
    p.checker('0', x + 14, y + 22, 11, 2); p.checker('0', x + 18, y + 20, 3, 6);
    p.r('0', x - 5, y, 11, 2); p.r('o', x - 4, y, 4, 1); p.r('o', x + 1, y, 4, 1); p.r('0', x - 1, y - 2, 3, 5); p.r('7', x, y - 1, 1, 2); p.r('g', x, y - 3, 1, 1);
  }
} };

// ---------------------------------------------------------------- FACTORY
const DYES: [string, string][] = [['e', 'v'], ['n', '2'], ['a', 'b']];
function yarnBall(p: Painter, x: number, y: number, k: string, sh: string) {
  p.disc('0', x, y, 6); p.disc(k, x, y, 5); p.disc(sh, x + 1, y + 1, 3); p.disc(k, x, y, 2);
  p.line(sh, x - 4, y + 1, x + 1, y - 4); p.line(sh, x - 2, y + 4, x + 4, y - 2); p.r('p', x - 2, y - 3, 1, 1);
}
/** conveyor run with rollers at both ends and short hazard stripes on the floor at the ends only */
function conveyor(p: Painter, x: number, y0: number, y1: number, rng: Rng) {
  p.shRect(x - 2, y0, 36, y1 - y0, 6);
  p.obj(() => {
    p.r('0', x - 2, y0, 36, y1 - y0); p.r('p', x - 1, y0, 2, y1 - y0); p.r('p', x + 31, y0, 2, y1 - y0); p.r('v', x + 1, y0, 30, y1 - y0);
    for (let y = y0 + 2; y < y1 - 2; y += 6) p.r('1', x + 1, y, 30, 2);
    for (const ey of [y0, y1 - 6]) { p.r('0', x - 2, ey, 36, 6); p.r('q', x - 1, ey + 1, 34, 4); p.r('p', x - 1, ey + 1, 34, 1); }
    for (const ey of [y0 - 8, y1 + 2]) for (let i = 0; i < 4; i++) { p.r(i % 2 ? '0' : 'h', x + 2 + i * 7, ey, 7, 6); }
    for (let y = y0 + 14; y < y1 - 12; y += rng.int(26, 40)) { const [k, sh] = rng.pick(DYES); yarnBall(p, x + 16, y, k, sh); }
  });
}
/** dye vat / turntable: steel rim, dark muted liquid, one stirring arm */
function vat(p: Painter, cx: number, cy: number, k: string, hi: string) {
  p.shEll(cx, cy, 26, 26, 20);
  p.obj(() => { p.disc('0', cx, cy, 28); p.disc('q', cx, cy, 27); p.ring('p', cx - 1, cy - 1, 26, 26, 1); p.disc('0', cx, cy, 23); p.disc(k, cx, cy, 22); p.ring(hi, cx, cy, 15, 15, 1); p.ring(hi, cx + 3, cy + 2, 7, 7, 1); p.r('0', cx - 1, cy - 22, 3, 44); p.r('p', cx - 1, cy - 22, 1, 44); });
}
function spinner(p: Painter, x: number, y: number, rng: Rng) {
  const w = 96, h = 56;
  p.shRect(x, y, w, h, 22);
  p.obj(() => {
    p.r('0', x, y, w, h); p.r('q', x + 1, y + 1, w - 2, h - 2); p.r('p', x + 1, y + 1, w - 2, 2); p.r('p', x + 1, y + 1, 2, h - 2);
    for (let j = 0; j < 2; j++) for (let i = 0; i < 6; i++) { const cx = x + 10 + i * 15, cy = y + 16 + j * 24; const [k, sh] = rng.pick(DYES); p.disc('0', cx, cy, 6); p.disc(k, cx, cy, 5); p.ring(sh, cx, cy, 3, 3, 1); p.disc('0', cx, cy, 1); }
  });
  p.glow('1', 'i', x + w - 8, y + 4, 3, 2); p.glow('1', 'r', x + w - 14, y + 4, 3, 2, 0.6, rng.next());
}
/** machinery seen through the floor grates (slow parallax) */
const factoryFar: LayerDef = { speed: 0.6, opaque: true, paint(p, z) {
  const r = z.r;
  p.r('1', 0, 0, SW, SEG);
  for (let x = 20; x < SW; x += 64) p.r('v', x, 0, 6, SEG);
  for (let i = 0; i < 7; i++) {
    const cx = r.int(10, SW - 10), cy = r.int(10, SEG - 10), rr = r.int(10, 22);
    for (let t = 0; t < 12; t++) { const a = (t / 12) * 6.28; p.disc('v', cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 3); }
    p.disc('v', cx, cy, rr); p.disc('1', cx, cy, rr - 5); p.disc('v', cx, cy, 4); p.r('q', cx - rr * 0.6, cy - rr * 0.6, 2, 1);
  }
  for (let i = 0; i < 5; i++) p.glow('1', 'g', r.int(0, SW), r.int(0, SEG), 1, 1, 0.9, r.next());
} };
const factory: LayerDef = { speed: 1, paint(p, z) {
  const r = z.r;
  // steel floor plates with open grate panels (machinery shows through)
  const grates = new Set<number>(); for (let i = 0; i < 3; i++) grates.add(r.int(0, 5) * 100 + r.int(0, 13));
  for (let y = 0; y < SEG; y += 32) for (let x = 0; x < SW; x += 32) {
    if (grates.has((y / 32 | 0) % 6 * 100 + x / 32) && x > 120 && x < 300) { p.r('0', x, y, 32, 32); for (let i = 2; i < 32; i += 4) p.r('q', x + i, y + 1, 1, 30); p.r('p', x + 1, y, 30, 1); continue; }
    p.r('q', x, y, 32, 32); p.r('v', x, y, 32, 1); p.r('v', x, y, 1, 32); p.r('p', x + 3, y + 3, 1, 1); p.r('p', x + 28, y + 3, 1, 1); p.r('p', x + 3, y + 28, 1, 1); p.r('p', x + 28, y + 28, 1, 1);
  }
  const y0 = r.int(8, 40), y1 = SEG - r.int(8, 40);
  conveyor(p, 94, y0, y1, r); conveyor(p, 322, SEG - y1, SEG - y0, r);
  for (const px0 of [6, 420]) { p.shRect(px0, 0, 20, SEG, 10); p.obj(() => { p.r('0', px0, 0, 20, SEG); p.r('p', px0 + 1, 0, 18, SEG); p.r('o', px0 + 3, 0, 2, SEG); p.r('q', px0 + 14, 0, 4, SEG); for (let y = 16; y < SEG; y += 64) { p.r('0', px0 - 2, y, 24, 8); p.r('q', px0 - 1, y + 1, 22, 6); p.r('p', px0 - 1, y + 1, 22, 1); } }); }
  const k = (z.s + r.int(0, 2)) % 3;
  if (k === 0) { vat(p, 224, 80, '2', '3'); vat(p, 224, 190, 'v', 'e'); }
  else if (k === 1) { spinner(p, 176, 40, r); spinner(p, 176, 150, r); }
  else { vat(p, 224, 100, 'n', '2'); p.shRect(170, 170, 110, 40, 10); p.obj(() => { p.r('0', 170, 170, 110, 40); p.r('a', 171, 171, 108, 38); p.r('9', 171, 171, 108, 1); for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { const [dk, sh] = r.pick(DYES); yarnBall(p, 186 + i * 26, 181 + j * 18, dk, sh); } }); }
  for (const sx of [44, 370]) { const sy = r.int(30, 200); crate(p, sx, sy, 30, 30, 'b'); p.obj(() => { for (let i = 0; i < 4; i++) { const [dk, sh] = r.pick(DYES); yarnBall(p, sx + 8 + (i % 2) * 14, sy + 8 + (i >> 1) * 14, dk, sh); } }); }
  p.pool(224, r.int(40, 220), 50);
} };
const girdersFg: LayerDef = { speed: 1.4, paint(p, z) {
  const r = z.r;
  if (r.chance(0.6)) {
    const y = r.int(20, 220);
    p.r('0', 0, y - 1, SW, 14); p.r('v', 0, y, SW, 12); p.r('q', 0, y, SW, 2); p.r('1', 0, y + 10, SW, 2);
    for (let x = 4; x < SW; x += 16) { p.r('q', x, y + 5, 2, 2); }
    for (let x = 16; x < SW; x += 48) p.line('1', x, y + 2, x + 24, y + 9);
    const lx = r.int(120, 330); p.r('0', lx - 6, y + 12, 12, 8); p.r('q', lx - 5, y + 12, 10, 6); p.glow('1', 'f', lx - 3, y + 17, 6, 2);
  }
} };

// ---------------------------------------------------------------- SKY
/** cumulus seen from above: lumpy lobes; keys = [hard shadow, underside, body, sunlit top] */
function cloudBank(p: Painter, cx: number, cy: number, r: number, rng: Rng, keys = ['3', '4', '5', '7']) {
  const lobes: [number, number, number][] = [];
  const n = rng.int(6, 9);
  for (let i = 0; i < n; i++) { const t = (i / (n - 1)) * 2 - 1; lobes.push([cx + t * r * 1.1 + rng.int(-4, 4), cy - (1 - t * t) * r * 0.35 + rng.int(-4, 4), Math.max(5, Math.round(r * (0.75 - Math.abs(t) * 0.35) * rng.range(0.85, 1.1)))]); }
  for (let i = 0; i < n; i += 2) lobes.push([cx + rng.int(-r, r) * 0.6, cy - rng.int(0, r) * 0.5, Math.round(r * rng.range(0.3, 0.45))]);
  const base = cy + r * 0.35;
  const lobe = (k: string, dx: number, dy: number, shrink: number, clip = true) => { for (const [x, y, rr] of lobes) spans(x + dx, y + dy, rr - shrink, rr - shrink, (sx, sy, w) => { if (!clip || sy < base + dy) p.r(k, sx, sy, w, 1); }); };
  lobe(keys[0], 4, 7, 0);          // one hard shadow tone
  lobe(keys[1], 1, 2, 0);          // lavender-gray underside
  lobe(keys[2], -1, -1, 2, false); // body
  lobe(keys[3], -3, -4, 6, false); // sunlit tops
  lobe(keys[2], -1, -1, 9, false); // body shows through so lobes read separately
}
const skyFar: LayerDef = { speed: 0.35, opaque: true, paint(p, z) {
  const r = z.r;
  p.r('n', 0, 0, SW, SEG);
  for (let i = 0; i < 7; i++) cloudBank(p, r.int(-20, SW + 20), r.int(10, SEG - 10), r.int(8, 15), r, ['n', '3', '3', '4']);
} };
const skyMain: LayerDef = { speed: 1, paint(p, z) {
  const r = z.r;
  const n = r.int(1, 2);
  for (let i = 0; i < n; i++) cloudBank(p, r.chance(0.5) ? r.int(-10, 100) : r.int(340, 460), r.int(50, 200), r.int(30, 42), r);
  if (r.chance(0.25)) cloudBank(p, r.int(150, 300), r.int(40, 210), r.int(14, 20), r);
} };
/** long soft wisps (solid tapered streaks, no halftone) */
const wispsFg: LayerDef = { speed: 1.8, paint(p, z) {
  const r = z.r;
  for (let i = 0; i < 2; i++) if (r.chance(0.5)) { const x = r.int(-20, SW - 60), y = r.int(0, SEG), w = r.int(50, 110); p.ell('4', x + w / 2, y, w / 2, 2); p.ell('5', x + w / 2 - 6, y - 1, w / 3, 1); }
} };
const SKY_RAMPS: Partial<Record<Tod, Ramp>> = {
  dawn: ramp('n:3 3:2 4:t 5:c 7:7 6:7 m:4'),
  dusk: ramp('n:2 3:v 4:u 5:t 7:c 6:c m:e'),
  night: ramp('n:1 3:v 4:2 5:3 7:4 6:4 m:2'),
};

// ---------------------------------------------------------------- NEBULA
function stars(p: Painter, rng: Rng, n: number, keys: string[]) { for (let i = 0; i < n; i++) p.r(rng.pick(keys), rng.int(0, SW - 1), rng.int(0, SEG - 1), 1, 1); }
const starFar = (base = '0', n = 70): LayerDef => ({ speed: 0.25, opaque: true, paint(p, z) {
  p.r(base, 0, 0, SW, SEG); stars(p, z.r, n, ['2', '2', '3', 'v']);
  for (let i = 0; i < 6; i++) { const x = z.r.int(4, SW - 4), y = z.r.int(4, SEG - 4); p.r('4', x, y, 1, 1); p.r('2', x - 1, y, 1, 1); p.r('2', x + 1, y, 1, 1); p.r('2', x, y - 1, 1, 1); p.r('2', x, y + 1, 1, 1); }
} });
function catnipLeaf(p: Painter, x: number, y: number, rng: Rng) {
  const a = rng.range(0, 3.14); const len = rng.int(7, 11);
  for (let t = -len; t <= len; t++) { const w = Math.round(Math.sqrt(1 - (t / len) ** 2) * 4); for (let s = -w; s <= w; s++) p.r(Math.abs(s) === w ? '0' : s < 0 ? 'j' : 'k', x + Math.cos(a) * t - Math.sin(a) * s, y + Math.sin(a) * t + Math.cos(a) * s); }
  p.line('i', x - Math.cos(a) * (len - 2), y - Math.sin(a) * (len - 2), x + Math.cos(a) * (len - 2), y + Math.sin(a) * (len - 2));
}
/** catnip gas: domain-warped filaments in 4 value steps; thin parts are clear so the stars show through */
const nebulaMain: LayerDef = { speed: 1, paint(p, z) {
  const r = z.r;
  const ph = r.range(0, 6.28);
  const env: [number, number, number][] = []; for (let i = 0; i < 3; i++) env.push([r.int(0, SW), r.int(-40, SEG + 40), r.int(90, 160)]);
  field(p, ['1', 'v', 'v', '2', '2', 'u'], (x, y) => {
    const w = z.wy(y);
    const wx = x + Math.sin(w / 41 + ph) * 22, ww = w + Math.sin(x / 47) * 18;
    let a = Math.sin(wx / 33 + Math.sin(ww / 57) * 2.2) * 0.45 + Math.sin(ww / 23 + Math.sin(wx / 71 + ph) * 1.8) * 0.3 + Math.sin((wx + ww) / 11 + Math.sin(wx / 19)) * 0.17 + Math.sin((wx - ww) / 7) * 0.08;
    let e = 0; for (const [ex, ey, er] of env) { const dx = (x - ex) / er, dy = (y - ey) / (er * 0.7); e = Math.max(e, 1 - dx * dx - dy * dy); }
    a = a * 0.5 + 0.5; return a * a * Math.max(0, e) * 1.25;
  }, 0.14, 0.45);
  stars(p, r, 16, ['3', '4', 't']);
  if (r.chance(0.7)) catnipLeaf(p, r.int(20, SW - 20), r.int(20, SEG - 20), r);
} };
const streaksFg: LayerDef = { speed: 1.9, paint(p, z) {
  const r = z.r; for (let i = 0; i < 8; i++) { const x = r.int(0, SW), y = r.int(0, SEG); p.r(r.pick(['2', '3']), x, y, 1, r.int(4, 8)); }
} };

// ---------------------------------------------------------------- MOON
/** crater lit from the upper left: bright rim, a thin shadow crescent inside, flat floor (litter-box craters hold clumps) */
function crater(p: Painter, cx: number, cy: number, rr: number, rng: Rng, litter: boolean) {
  const ry = rr * 0.8;
  p.ell('p', cx - 1, cy - 1, rr + 2, ry + 2);
  p.ell('q', cx + 1, cy + 1, rr + 1, ry + 1);
  p.ell('v', cx, cy, rr, ry);
  p.ell('q', cx + Math.max(1, rr * 0.12), cy + Math.max(1, rr * 0.12), rr - Math.max(1, rr * 0.1), ry - Math.max(1, rr * 0.1));
  p.ell('p', cx - rr * 0.35, cy - ry * 0.45, rr * 0.25, ry * 0.12);
  if (litter) {
    for (let i = 0; i < rr * 2.5; i++) { const a = rng.range(0, 6.28), d = rng.range(0, rr - 5); p.r(rng.pick(['p', 'p', 'o']), cx + 2 + Math.cos(a) * d, cy + 2 + Math.sin(a) * d * 0.8, 2, 1); }
    for (let i = 0; i < rr / 6; i++) { const x = cx + rng.int(-rr / 2, rr / 2), y = cy + rng.int(-rr / 3, rr / 3); p.ell('0', x, y, 5, 4); p.ell('o', x, y, 4, 3); p.r('5', x - 2, y - 2, 2, 1); p.r('p', x, y + 1, 3, 1); }
  }
}
const moon: LayerDef = { speed: 1, opaque: true, paint(p, z) {
  const r = z.r;
  field(p, ['q', 'q', 'p'], (x, y) => { const w = z.wy(y); return 0.42 + 0.22 * Math.sin(x / 53 + Math.sin(w / 71) * 2.5) + 0.12 * Math.sin(w / 37 - x / 89); }, -1, 0.35);
  for (let i = 0; i < 60; i++) { const x = r.int(0, SW), y = r.int(0, SEG); p.r('p', x, y, 2, 1); p.r('v', x + 1, y + 1, 2, 1); }
  for (let i = 0; i < 5; i++) crater(p, r.int(10, SW - 10), r.int(10, SEG - 10), r.int(4, 9), r, false);
  for (let i = 0; i < 2; i++) crater(p, r.int(20, SW - 20), r.int(20, SEG - 20), r.int(11, 17), r, r.chance(0.4));
  if (r.chance(0.8)) crater(p, r.int(70, SW - 70), r.int(50, SEG - 50), r.int(24, 38), r, r.chance(0.7));
  for (let y = 0; y < SEG; y += 18) { const x = 300 + Math.round(Math.sin(z.wy(y) / 90) * 60) + ((y / 18) % 2 ? 6 : -6); p.r('v', x, y, 4, 3); p.r('v', x - 1, y - 3, 1, 1); p.r('v', x + 1, y - 4, 2, 1); p.r('v', x + 4, y - 3, 1, 1); }
  if (z.s % 3 === 1) { // giant cardboard scratching box: top face, darker front face, corrugation, drop shadow
    const sx = r.int(60, 280), sy = r.int(40, 150), w = 56, h = 34;
    p.shRect(sx, sy, w, h + 8, 12);
    p.obj(() => {
      p.r('0', sx - 1, sy - 1, w + 2, h + 10);
      p.r('a', sx, sy, w, h); p.r('9', sx, sy, w, 1); p.r('9', sx, sy, 1, h);
      for (let j = 5; j < h - 3; j += 4) p.r('b', sx + 4, sy + j, w - 8, 2);
      p.r('b', sx + 2, sy + 2, w - 4, 1);
      p.r('b', sx, sy + h, w, 8); for (let i = 3; i < w; i += 3) p.r('v', sx + i, sy + h + 1, 1, 6);
      p.r('9', sx + w / 2 - 8, sy + h + 2, 16, 3); p.r('b', sx + w / 2 - 6, sy + h + 3, 12, 1); // label
    });
  }
  if (z.s % 4 === 2) { const fx = r.int(80, 360), fy = r.int(60, 200); p.shRect(fx, fy, 2, 2, 24); p.obj(() => { p.r('0', fx - 1, fy - 1, 3, 3); p.r('o', fx, fy, 1, 1); p.r('0', fx + 1, fy - 1, 16, 11); p.r('7', fx + 2, fy, 14, 9); p.r('c', fx + 6, fy + 2, 6, 5); p.r('6', fx + 7, fy + 3, 4, 3); }); }
} };
/** fg: the shadow of an orbiting probe sweeping over the regolith + a few dust motes */
const moonFg: LayerDef = { speed: 1.6, paint(p, z) {
  const r = z.r;
  if (r.chance(0.3)) { const x = r.int(60, 380), y = r.int(40, 200); p.checker('0', x - 10, y - 2, 20, 5); p.checker('0', x - 2, y - 10, 5, 20); p.checker('0', x - 18, y, 8, 1); p.checker('0', x + 10, y, 8, 1); }
  for (let i = 0; i < 4; i++) { const x = r.int(0, SW - 4), y = r.int(0, SEG - 2); p.r('p', x, y, 3, 1); }
} };

// ---------------------------------------------------------------- STATION
/**
 * Cat scratching post (3/4 view): carpeted base, sisal-wrapped column with
 * diagonal rope turns (lit left, shaded right) and a round carpeted platform cap
 * with a pom-pom toy on a string.
 */
function scratchPost(p: Painter, cx: number, top: number, rr: number) {
  const capRy = Math.round(rr * 0.7), colW = Math.round(rr * 0.9), colH = rr + 14, baseY = top + capRy + colH;
  p.shRect(cx - colW / 2, baseY - 6, colW, 6, 26);
  p.shEll(cx, baseY - 2, rr, capRy, 30);
  p.obj(() => {
    p.r('0', cx - rr - 3, baseY - 4, rr * 2 + 6, 10); p.r('u', cx - rr - 2, baseY - 3, rr * 2 + 4, 8); p.r('t', cx - rr - 2, baseY - 3, rr * 2 + 4, 1); p.r('2', cx - rr - 2, baseY + 3, rr * 2 + 4, 2);
    const x0 = Math.round(cx - colW / 2);
    p.r('0', x0 - 1, top + capRy, colW + 2, colH);
    for (let y = top + capRy; y < baseY; y++) for (let i = 0; i < colW; i++) {
      const t = i / colW; const turn = ((y + i * 0.5) | 0) % 3 === 0;
      p.r(turn ? (t < 0.3 ? 'a' : 'b') : (t < 0.3 ? '8' : t < 0.75 ? '9' : 'a'), x0 + i, y, 1, 1);
    }
    // platform cap: a square carpeted perch with a visible edge band (thickness), so it reads as furniture, not a mushroom
    const cr = Math.round(rr * 0.95), cY = top + 2, ch = capRy * 2;
    p.r('0', cx - cr - 1, cY - 1, cr * 2 + 2, ch + 5); p.r('0', cx - cr, cY - 2, cr * 2, 1);
    p.r('q', cx - cr, cY + ch - 1, cr * 2, 4); p.r('v', cx - cr, cY + ch + 2, cr * 2, 1);
    p.r('p', cx - cr, cY, cr * 2, ch - 1); p.r('o', cx - cr, cY, cr * 2, 1); p.r('o', cx - cr, cY, 1, ch - 1);
    for (let j = cY + 3; j < cY + ch - 2; j += 3) for (let i = cx - cr + 2 + (j % 2) * 2; i < cx + cr - 1; i += 4) p.r('q', i, j, 1, 1);
    const tx = cx + Math.round(rr * 0.95) - 3; p.r('0', tx, top + capRy * 2 + 5, 1, 10); p.disc('0', tx, top + capRy * 2 + 16, 3); p.disc('c', tx, top + capRy * 2 + 16, 2);
  });
}
const station: LayerDef = { speed: 1, paint(p, z) {
  const r = z.r;
  p.r('0', 200, 0, 48, SEG); p.r('q', 202, 0, 4, SEG); p.r('q', 242, 0, 4, SEG);
  for (let y = 0; y < SEG; y += 32) { p.line('q', 206, y, 241, y + 31); p.line('q', 241, y, 206, y + 31); p.r('p', 202, y, 44, 2); }
  p.r('p', 203, 0, 1, SEG);
  every(z, 64, 0, y => { if (y > 0 && y < SEG) { p.glow('1', 'r', 203, y, 2, 2, 1, 0); p.glow('1', 'i', 243, y + 32, 2, 2, 1, 0); } });
  for (const side of [0, 1]) {
    const mx = side ? 260 : 36, mw = 152; const my = r.int(10, 40), mh = r.int(120, 190);
    p.shRect(mx, my, mw, mh, 16);
    p.obj(() => {
      const ch = 10;
      for (let j = 0; j < mh; j++) { const c = Math.max(0, ch - Math.min(j, mh - 1 - j)); p.r('0', mx + c, my + j, mw - 2 * c, 1); if (j > 0 && j < mh - 1) { const c2 = c + 1; p.r('p', mx + c2, my + j, mw - 2 * c2, 1); if (j > 2 && j < mh - 3) { const c3 = c + 3; p.r(j > 4 && j < mh - 5 ? 'q' : 'u', mx + c3, my + j, mw - 2 * c3, 1); if (j > 4 && j < mh - 5) { p.r('u', mx + c3, my + j, 2, 1); p.r('u', mx + mw - c3 - 2, my + j, 2, 1); } } } }
      for (let j = my + 10; j < my + mh - 10; j += 8) for (let i = mx + 10 + (j % 16 ? 4 : 0); i < mx + mw - 10; i += 8) p.r('v', i, j, 1, 1);
      p.r('0', side ? mx - 12 : mx + mw, my + mh / 2 - 6, 12, 12); p.r('q', side ? mx - 12 : mx + mw, my + mh / 2 - 5, 12, 10);
      for (let i = 0; i < 5; i++) p.glow('2', 'f', mx + 14 + i * 28, my + 3, 6, 2, 1.2, (i * 0.37) % 1);
    });
    scratchPost(p, mx + r.int(30, 60), my + r.int(20, Math.max(21, mh - 70)), r.int(13, 17));
    if (mh > 160) scratchPost(p, mx + r.int(96, 120), my + mh - 62, 11);
    p.obj(() => { const bx = mx + mw - 40, by = my + 24; p.r('0', bx, by, 28, 28); p.r('n', bx + 1, by + 1, 26, 26); p.r('m', bx + 1, by + 1, 26, 1); p.r('2', bx + 1, by + 26, 26, 1); p.disc('0', bx + 14, by + 15, 6); p.disc('1', bx + 14, by + 15, 5); });
    const sy = my + mh + 14; if (sy < SEG - 30) { const sx = side ? 300 : 60; p.obj(() => { p.r('0', sx, sy, 100, 24); p.r('2', sx + 1, sy + 1, 98, 22); for (let i = sx + 1; i < sx + 99; i += 10) p.r('1', i, sy + 1, 1, 22); p.r('1', sx + 1, sy + 12, 98, 1); p.r('3', sx + 1, sy + 1, 98, 1); p.r('q', side ? sx - 40 : sx + 100, sy + 10, 40, 4); }); }
  }
} };

// ---------------------------------------------------------------- MOTHERSHIP
/** hull plates in neutral gray (a full ramp step above the indigo/brown cat bodies, so dark cats keep their silhouette) */
const mothership: LayerDef = { speed: 1, paint(p, z) {
  const r = z.r;
  const L = 16, R = SW - 16;
  p.r('0', L, 0, R - L, SEG);
  for (let y = 0; y < SEG; y += 32) for (let x = L; x < R; x += 64) {
    p.r('q', x + 1, y + 1, 63, 31); p.r('p', x + 1, y + 1, 63, 1); p.r('p', x + 1, y + 1, 1, 31); p.r('1', x + 1, y + 31, 63, 1); p.r('1', x + 63, y + 1, 1, 31);
    const v = (x / 64 + y / 32 + z.s) % 4;
    if (v === 0) for (let i = 0; i < 5; i++) p.r('1', x + 10, y + 6 + i * 4, 44, 2);
    else if (v === 2) { p.r('1', x + 6, y + 6, 4, 4); p.r('1', x + 54, y + 6, 4, 4); p.r('1', x + 6, y + 22, 4, 4); p.r('1', x + 54, y + 22, 4, 4); }
  }
  for (const [x0, dir] of [[L, 1], [R, -1]] as [number, number][]) for (let y = 0; y < SEG; y += 64) for (let j = 0; j < 40; j++) { const w = Math.round(14 - Math.abs(j - 20) * 0.7); p.r(j < 20 ? 'p' : 'q', dir > 0 ? x0 - w : x0, y + 12 + j, w, 1); }
  for (const tx of [120, 312]) {
    p.r('0', tx, 0, 16, SEG); p.r('1', tx + 2, 0, 12, SEG);
    for (let y = 0; y < SEG; y += 16) p.glow('e', 'd', tx + 7, y + 4, 2, 6, 1.5, 0);
    p.r('p', tx - 1, 0, 1, SEG); p.r('1', tx + 16, 0, 1, SEG);
  }
  if (z.s % 3 === 0) {
    const cx = 224, cy = 128;
    p.ell('0', cx, cy + 6, 46, 36); p.ell('1', cx, cy + 6, 44, 34);
    for (const sx of [-1, 1]) for (let j = 0; j < 30; j++) { const w = Math.round(j * 0.7); p.r('1', cx + sx * 30 - w, cy - 50 + j, w * 2 + 1, 1); }
    p.ell('u', cx, cy + 6, 38, 28); p.ell('2', cx, cy + 10, 34, 22);
    for (const sx of [-1, 1]) { p.ell('0', cx + sx * 15, cy + 2, 7, 5); p.glow('1', 'l', cx + sx * 15 - 4, cy + 1, 8, 2, 1.5, 0); }
    p.r('e', cx - 3, cy + 12, 6, 3); for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) p.r('3', sx > 0 ? cx + 12 : cx - 32, cy + 14 + i * 4, 20, 1);
  } else {
    for (let i = 0; i < 2; i++) { const cx = r.int(160, 290), cy = 40 + i * 120 + r.int(0, 40); p.shEll(cx, cy, 14, 14, 10); p.obj(() => { p.disc('0', cx, cy, 15); p.disc('p', cx, cy, 14); p.disc('q', cx + 1, cy + 1, 11); p.r('o', cx - 8, cy - 9, 6, 2); p.glow('1', 'l', cx - 2, cy - 2, 4, 4, 1.5, 0); }); }
  }
  for (let y = 8; y < SEG; y += 48) for (const wx of [40, 380]) for (let i = 0; i < 3; i++) p.glow('1', 'l', wx + i * 8, y, 5, 3, 1, r.next());
} };

// ---------------------------------------------------------------- anims
const twinkle = (keys: string[]) => (px: Px, scroll: number, t: number, seed: number) => {
  for (let i = 0; i < 9; i++) {
    const ph = (seed * (i + 3)) % 997; if (((t + ph * 7) % 90) > 14) continue;
    const x = (ph * 13 + i * 51) % SW, y = Math.floor((ph * 31 + scroll * 0.25) % 360);
    const k = keys[i % keys.length]; px(k, x, y); px(k, x - 1, y); px(k, x + 1, y); px(k, x, y - 1); px(k, x, y + 1); px('6', x, y);
  }
};
/** blinking navigation lights: only after dusk, so LOCAL TIME changes the hull */
const navLights = (xs: number[], period: number, keys: string[]) => (px: Px, scroll: number, t: number, _seed: number, tod: Tod) => {
  if (tod === 'day') return;
  const fast = tod === 'night';
  everyScreen(scroll, period, 16, (sy, k) => xs.forEach((x, i) => {
    const on = ((t >> (fast ? 4 : 5)) + k + i) % 3 === 0; if (!on) return;
    const c = keys[(k + i) % keys.length]; px('0', x - 2, sy - 2, 5, 5); px(c, x - 1, sy - 1, 3, 3); px('6', x, sy, 1, 1);
  }));
};
const both = (...fs: ((px: Px, scroll: number, t: number, seed: number, tod: Tod) => void)[]) => (px: Px, scroll: number, t: number, seed: number, tod: Tod) => { for (const f of fs) f(px, scroll, t, seed, tod); };

export const TILESETS: Record<string, Tileset> = {
  backyard: { id: 'backyard', speed: 0.4, base: 'k', main: backyard, fg: yardFg(['1', 'k', 'j'], 0.6, 0.35) },
  street: { id: 'street', speed: 0.6, base: 'v', main: street, fg: yardFg(['1', 'k', 'j'], 0.7, 0.45), anim: steamAnim(188, 300, 120) },
  park: { id: 'park', speed: 0.45, base: 'k', main: park, fg: yardFg(['1', 'k', 'j'], 0.9, 0) },
  alley: { id: 'alley', speed: 0.5, base: 'v', main: alley, fg: laundryFg, anim: steamAnim(262, 280, 60) },
  rooftops: { id: 'rooftops', speed: 0.55, base: '1', far: cityBelow, main: rooftops, fg: pigeonsFg },
  cafe: { id: 'cafe', speed: 0.4, base: 'b', indoor: true, main: cafe, fg: pendantsFg },
  docks: { id: 'docks', speed: 0.5, base: 'n', far: water, main: docks, fg: gullsFg,
    anim: (px, scroll, t) => { for (let i = 0; i < 6; i++) { const x = 120 + ((i * 97) % 320), y = Math.floor((i * 71 + scroll * 0.72) % 360); if (((t >> 3) + i) % 4 === 0) px('s', x, y, 3, 1); } } },
  factory: { id: 'factory', speed: 0.6, base: '1', far: factoryFar, main: factory, fg: girdersFg },
  sky: { id: 'sky', speed: 0.8, base: 'n', far: skyFar, main: skyMain, fg: wispsFg, ramps: SKY_RAMPS },
  nebula: { id: 'nebula', speed: 0.7, space: true, base: '0', far: starFar('0', 80), main: nebulaMain, fg: streaksFg, anim: twinkle(['4', 't', 'l']) },
  moon: { id: 'moon', speed: 0.35, space: true, base: 'q', main: moon, fg: moonFg },
  station: { id: 'station', speed: 0.5, space: true, base: '0', far: starFar('0', 90), main: station, anim: both(twinkle(['4', 'l']), navLights([36, 412], 128, ['r', 'i'])) },
  mothership: { id: 'mothership', speed: 0.7, space: true, base: '0', far: starFar('1', 60), main: mothership, anim: navLights([10, 438, 128, 320], 96, ['r', 'l', 'd']) },
};
TILESETS.space = TILESETS.nebula;
