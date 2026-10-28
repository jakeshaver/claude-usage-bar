// World tilesets: each area is a stack of parallax layers (far / main / fg).
// Each layer is painted in 448x256 segments (8 rows of 32px tiles) by a seeded
// painter, then cached per time-of-day. Backgrounds are authored in dark,
// low-noise, mostly neutral mid-tones with a guaranteed value gap from the
// darkest cat colours (indigo / dark brown bodies with ink outlines), so cats,
// turds and hairballs pop (Galaga readability).
import { Rng } from '../core/rng';
import { col } from '../core/palette';
import type { Tod } from '../core/types';
import { Painter, spans, bayer, ramp, TOD_RAMP, DUSK_SUN, type Ramp } from './paint';
import type { Background } from './bg';

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
  /** screen-fixed backdrop under every layer (painted once per time of day, already in final colours) */
  backdrop?: (p: Painter, tod: Tod) => void;
  /** per-frame blits drawn between the main and fg layers, from canvases cached with bg.painted() */
  fx?: (ctx: CanvasRenderingContext2D, scroll: number, t: number, seed: number, tod: Tod, bg: Background) => void;
  /** the layer fx is drawn above (default main) */
  fxAfter?: 'far' | 'main';
  /** low-sun rim light on object faces at dawn / dusk (outdoor default true) */
  rim?: boolean;
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
/**
 * Overhead utility wires (fg, rare): two 2px cables with a symmetric catenary
 * sag drawn as even stair-step runs (no jaggy 1px diagonals), plus a pigeon or two.
 */
function wires(p: Painter, y: number, rng: Rng) {
  const sag = rng.int(8, 16);
  const at = cable(p, 0, SW, y, sag); cable(p, 0, SW, y + 7, sag);
  for (let i = 0; i < rng.int(0, 2); i++) { const x = rng.int(60, 380), yy = at(x); p.r('0', x - 2, yy - 4, 5, 4); p.r('q', x - 1, yy - 4, 3, 3); p.r('0', x + 2, yy - 5, 2, 2); }
}
/** a 2px cable from x0 to x1 with a symmetric parabolic sag, drawn as even horizontal runs; returns y(x) */
function cable(p: Painter, x0: number, x1: number, y: number, sag: number, k = '0', hi = 'q') {
  const c = (x0 + x1) / 2, hw = (x1 - x0) / 2;
  const at = (x: number) => y + Math.round(sag * (1 - ((x + 0.5 - c) / hw) ** 2));
  let rx = x0, ry = at(x0);
  for (let x = x0 + 1; x <= x1; x++) { const yy = x < x1 ? at(x) : -9999; if (yy !== ry) { p.r(k, rx, ry, x - rx, 2); p.r(hi, rx, ry, x - rx, 1); rx = x; ry = yy; } }
  return at;
}

// ---------------------------------------------------------------- BACKYARD
/** red doghouse with a pitched roof (ridge front-to-back), shingles, eave shadow, arched entrance and a POM name plate */
function doghouse(p: Painter, x: number, y: number) {
  const w = 36, rh = 28;
  p.shRect(x, y, w, rh + 10, 16);
  p.obj(() => {
    // front gable wall (seen below the eave) with arched door
    p.r('0', x + 1, y + rh - 1, w - 2, 12); p.r('8', x + 2, y + rh, w - 4, 10); p.r('9', x + 2, y + rh + 8, w - 4, 2);
    for (let i = 4; i < w - 4; i += 4) p.r('9', x + i, y + rh, 1, 8);
    p.r('0', x + 12, y + rh + 2, 12, 9); p.r('0', x + 13, y + rh + 1, 10, 1); p.r('1', x + 14, y + rh + 4, 8, 7); // entrance + inside shadow
    // roof: lit left plane, shaded right plane, shingle courses, ridge cap
    p.r('0', x - 2, y - 1, w + 4, rh + 1);
    p.r('r', x - 1, y, w / 2 + 1, rh); p.r('e', x + w / 2, y, w / 2 + 1, rh);
    for (let j = 3; j < rh; j += 4) { p.r('e', x - 1, y + j, w / 2, 1); p.r('v', x + w / 2 + 1, y + j, w / 2, 1); for (let i = (j >> 2) % 2 ? 2 : 6; i < w; i += 8) p.r(i < w / 2 ? 'e' : 'v', x + i, y + j - 3, 1, 3); }
    p.r('c', x - 1, y, w / 2, 1);
    p.r('c', x + w / 2 - 1, y, 1, rh); p.r('0', x + w / 2, y, 1, rh); // ridge: highlight + crease
    p.r('0', x - 2, y + rh - 1, w + 4, 1);
    // name plate over the door: cream board with three dark letter blocks
    p.r('0', x + 11, y + rh - 3, 14, 5); p.r('7', x + 12, y + rh - 2, 12, 3);
    p.r('b', x + 13, y + rh - 1, 2, 1); p.r('b', x + 17, y + rh - 1, 2, 1); p.r('b', x + 21, y + rh - 1, 2, 1);
  });
  // bowl + bone
  p.obj(() => {
    p.disc('0', x + 50, y + 34, 5); p.disc('n', x + 50, y + 34, 4); p.disc('a', x + 50, y + 34, 2);
    p.r('0', x + 40, y + 49, 10, 4); p.r('7', x + 41, y + 50, 8, 2); p.r('7', x + 40, y + 49, 2, 1); p.r('7', x + 40, y + 52, 2, 1); p.r('7', x + 48, y + 49, 2, 1); p.r('7', x + 48, y + 52, 2, 1);
  });
}
/** blue kiddie pool: fat inflatable ring, water with concentric ripples and a rubber duck */
function kiddiePool(p: Painter, cx: number, cy: number, r = 28) {
  const ry = Math.round(r * 0.85);
  p.shEll(cx, cy, r, ry, 5);
  p.obj(() => {
    p.ell('0', cx, cy, r + 1, ry + 1); p.ell('n', cx, cy, r, ry); p.ell('m', cx - 1, cy - 1, r - 2, ry - 2); p.ell('n', cx, cy, r - 3, ry - 3);
    p.ell('0', cx, cy, r - 5, ry - 5); p.ell('m', cx, cy, r - 6, ry - 6); p.ell('n', cx + 1, cy + 1, r - 8, ry - 8);
    p.ring('m', cx + 3, cy + 2, 13, 10, 1); p.ring('m', cx + 3, cy + 2, 7, 5, 1);
    p.r('s', cx - r + 9, cy - 5, 5, 1); p.r('s', cx - 4, cy - ry + 8, 4, 1);
    p.r('0', cx + 1, cy - 1, 7, 6); p.r('f', cx + 2, cy, 5, 4); p.r('f', cx + 5, cy - 1, 3, 2); p.r('g', cx + 8, cy, 1, 1); p.r('0', cx + 6, cy - 1, 1, 1); // duck
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
/** wooden fence with the odd missing board (gaps a small dog could squeeze through) */
function fenceV(p: Painter, x: number, y0: number, y1: number, rng?: Rng) {
  const gaps: number[] = []; if (rng) for (let y = y0 + 40; y < y1 - 30; y += rng.int(70, 120)) gaps.push(y);
  const runs: [number, number][] = []; let a = y0; for (const g of gaps) { runs.push([a, g]); a = g + 10; } runs.push([a, y1]);
  for (const [a0, a1] of runs) p.shRect(x, a0, 4, a1 - a0, 10);
  p.obj(() => { for (const [a0, a1] of runs) { p.r('b', x, a0, 4, a1 - a0); p.r('9', x, a0, 1, a1 - a0); p.r('a', x + 1, a0, 2, a1 - a0); } for (let y = y0; y < y1; y += 32) { p.r('0', x - 1, y + 14, 6, 5); p.r('9', x, y + 15, 4, 3); } for (const g of gaps) { p.r('b', x + 1, g + 3, 3, 1); p.r('b', x + 1, g + 7, 2, 1); } });
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
      p.r('0', x, fy, ww, fh); p.r('b', x + 1, fy, ww - 2, fh - 1);
      for (let j = fy + 4; j < fy + fh - 1; j += 4) { p.r('v', x + 1, j, ww - 2, 1); for (let i = x + ((j >> 2) % 2 ? 3 : 7); i < x + ww - 1; i += 8) p.r('v', i, j - 3, 1, 3); }
      p.r('a', x + 1, fy, ww - 2, 2); p.r('v', x + 1, fy + 2, ww - 2, 1); // cornice
      p.r('b', x, fy, 1, fh); p.r('b', x + ww - 1, fy, 1, fh);
    });
    for (let i = 0; i < 3; i++) {
      const wx = x + 14 + i * 34, wy = rh + 7;
      p.obj(() => { p.r('9', wx - 1, wy - 2, 12, 2); p.r('0', wx, wy, 10, 20); p.r('9', wx - 1, wy + 20, 12, 2); });
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
  const r = z.r; const top = z.s % 5 === 2 ? 78 : 0;
  grass(p, 0, 0, SW, SEG, r, 'k', 'j', 0.5);
  if (top) brownstoneBacks(p, r);
  const lots = [[0, 144], [148, 300], [304, 448]];
  // the middle lot (centre of the playfield) always holds this segment's hero object
  const hero = ['dog', 'pool', 'patio', 'dog', 'pool', 'garden'][z.s % 6];
  const side = ['clothes', 'yard', 'garden', 'patio', 'yard', 'clothes'];
  for (let i = side.length - 1; i > 0; i--) { const j = r.int(0, i); [side[i], side[j]] = [side[j], side[i]]; }
  lots.forEach(([x0, x1], li) => {
    const kind = li === 1 ? hero : side[li];
    const cx = (x0 + x1) >> 1, y0 = top + 14, y1 = SEG - 8;
    border(p, li === 2 ? x1 - 12 : li === 1 ? x0 + 4 : x0, top + 2, 10, SEG - top - 2, r);
    if (kind !== 'patio' && kind !== 'pool') for (let y = y0 + 8; y < y1 - 8; y += 20) { const sx = cx + Math.round(Math.sin((z.wy(y) + li * 50) / 40) * 14) + ((y / 20) % 2 ? 4 : -4); p.ell('0', sx, y + 3, 6, 4); p.ell('q', sx, y + 3, 5, 3); p.r('p', sx - 3, y + 1, 4, 1); }
    if (kind === 'dog') { const dy = top ? y0 + 30 : y0 + 60; doghouse(p, cx - 26, dy); p.obj(() => { const tx = cx - 30, ty = dy + 70; p.r('0', tx - 1, ty - 1, 16, 4); p.r('8', tx, ty, 14, 2); p.r('h', tx + 3, ty, 2, 2); p.r('h', tx + 9, ty, 2, 2); }); }
    else if (kind === 'pool') { kiddiePool(p, cx, top ? y0 + 70 : y0 + 90); p.obj(() => { const tx = cx + 34, ty = y1 - 50; p.r('0', tx - 1, ty - 1, 18, 26); for (let j = 0; j < 24; j += 4) p.r(j % 8 ? '7' : 'n', tx, ty + j, 16, 4); }); }
    else if (kind === 'patio') { patio(p, x0 + 14, y0 + 4, x1 - x0 - 28, 96); umbrellaTable(p, cx, y0 + 50); grill(p, x1 - 30, y0 + 20); }
    else if (kind === 'garden') { garden(p, x0 + 18, y0 + 16, x1 - x0 - 36, 36, r); garden(p, x0 + 18, y0 + 66, (x1 - x0) / 2 - 12, 30, r); p.obj(() => { const wx = x1 - 40, wy = y0 + 76; p.r('0', wx, wy, 12, 10); p.r('k', wx + 1, wy + 1, 10, 8); p.r('j', wx + 1, wy + 1, 10, 1); p.r('0', wx + 12, wy + 2, 6, 2); }); }
    else if (kind === 'clothes') { clothesline(p, x0 + 14, x1 - 14, y0 + 40, r); bin(p, x0 + 24, y1 - 30); bin(p, x0 + 40, y1 - 30, 'n'); }
    else { birdBath(p, cx, y0 + 50); for (let i = 0; i < 5; i++) { const fx = r.int(x0 + 18, x1 - 18), fy = r.int(y0 + 80, y1 - 12); p.r(r.pick(['c', '7', 't']), fx, fy, 1, 1); p.r('j', fx - 1, fy + 1, 3, 1); } p.obj(() => { p.disc('0', cx + 30, y0 + 110, 5); p.disc('h', cx + 30, y0 + 110, 4); p.r('8', cx + 28, y0 + 108, 2, 1); }); }
    if (li !== 1 && r.chance(0.35)) stringLights(p, x0 + 10, y0 + 2, x1 - 10, y0 + 6, r);
  });
  fenceV(p, 144, top ? top - 8 : 0, SEG, r); fenceV(p, 300, top ? top - 8 : 0, SEG, r);
  if (top) fenceH(p, 0, SW, top - 8);
  if (!top) lamp(p, 224, 30, 30);
} };
/** fast foreground: overhanging trees, the odd branch and utility wires */
const yardFg = (keys = ['1', 'k', 'j'], density = 0.6, wireChance = 0.1): LayerDef => ({ speed: 1.4, paint(p, z) {
  const r = z.r;
  if (r.chance(density)) canopy(p, r.chance(0.5) ? r.int(-16, 50) : r.int(398, 464), r.int(50, 200), r.int(30, 44), r, keys);
  if (r.chance(density * 0.35)) branch(p, r.chance(0.5), r.int(30, 220), r.int(70, 130), r);
  if (r.chance(wireChance)) wires(p, r.int(30, 220), r);
} });

// ---------------------------------------------------------------- STREET
/** night on asphalt: lifted one step to a cool grey-violet so navy / tuxedo cats keep a dark rim against it */
const NIGHT_PAVED = ramp('v:q 1:v q:2q/8 p:3q/8 o:3', TOD_RAMP.night);
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
/** agility A-frame from above: two sloped panels meeting at a ridge, contact zones at both ends, splayed legs */
function aFrame(p: Painter, x: number, y: number) {
  const w = 34, h = 92, mid = y + h / 2;
  p.shRect(x, y + 8, w, h - 16, 18);
  p.obj(() => {
    for (const [lx, ly] of [[x - 4, y + 14], [x + w + 1, y + 14], [x - 4, y + h - 18], [x + w + 1, y + h - 18]]) { p.r('0', lx, ly, 3, 5); p.r('p', lx + 1, ly + 1, 1, 3); }
    p.r('0', x - 1, y - 1, w + 2, h + 2);
    p.r('n', x, y, w, h / 2); p.r('2', x, mid, w, h / 2);
    for (let j = 6; j < h; j += 6) if (Math.abs(y + j - mid) > 3) p.r(y + j < mid ? '2' : '1', x + 1, y + j, w - 2, 1);
    p.r('h', x, y, w, 16); p.r('a', x, y + h - 16, w, 16);
    for (let j = 4; j < 16; j += 4) { p.r('a', x + 1, y + j, w - 2, 1); p.r('b', x + 1, y + h - 16 + j, w - 2, 1); }
    p.r('g', x, y, w, 1); p.r('m', x, y + 16, w, 1);
    p.r('o', x, mid - 2, w, 1); p.r('0', x, mid - 1, w, 2);
  });
}
/** weave poles: 10 striped poles on a base rail */
function weavePoles(p: Painter, x: number, y: number) {
  p.shRect(x, y, 4, 100, 3);
  p.obj(() => { p.r('0', x, y, 4, 100); p.r('p', x + 1, y, 2, 100); });
  for (let i = 0; i < 10; i++) { const yy = y + 2 + i * 10, xx = x + 0; p.shRect(xx, yy, 4, 4, 14); p.obj(() => { p.r('0', xx - 1, yy - 1, 6, 6); p.r(i % 2 ? 'h' : '7', xx, yy, 4, 4); p.r(i % 2 ? 'a' : 'o', xx + 2, yy + 2, 2, 2); }); }
}
function tireJump(p: Painter, x: number, y: number) {
  p.shRect(x, y, 48, 6, 20);
  p.obj(() => { p.r('0', x, y, 48, 6); p.r('p', x + 1, y + 1, 46, 4); p.r('o', x + 1, y + 1, 46, 1); p.r('0', x + 13, y - 6, 22, 18); p.r('q', x + 14, y - 5, 20, 16); p.r('1', x + 18, y - 1, 12, 8); p.r('p', x + 14, y - 5, 20, 2); for (let i = x + 15; i < x + 34; i += 4) p.r('0', i, y - 5, 1, 2); });
}
/** curved fabric agility tunnel: ribbed tube along a gentle S, dark openings at both ends */
function tunnel(p: Painter, x: number, y: number, len: number) {
  const pts: [number, number][] = [];
  for (let i = 0; i <= len; i += 2) pts.push([x + Math.round(Math.sin(i / len * Math.PI * 1.4) * 22), y + i]);
  for (const [px, py] of pts) p.shRect(px - 10, py, 21, 2, 10);
  p.obj(() => {
    for (const [px, py] of pts) p.r('0', px - 11, py, 23, 2);
    pts.forEach(([px, py], i) => { if (i === 0 || i === pts.length - 1) return; p.r('e', px - 10, py, 21, 2); p.r('d', px - 7, py, 4, 2); p.r('v', px + 5, py, 5, 2); if (i % 4 === 0) p.r('v', px - 10, py, 21, 1); });
    for (const [px, py] of [pts[1], pts[pts.length - 2]]) { p.r('0', px - 9, py - 1, 19, 4); p.r('1', px - 7, py, 15, 2); }
  });
}
/** pond with reeds, lily pads and a pair of ducks */
function pond(p: Painter, cx: number, cy: number, rng: Rng) {
  p.ell('0', cx, cy, 54, 34); p.ell('b', cx, cy, 53, 33); p.ell('9', cx - 2, cy - 2, 50, 30); p.ell('n', cx, cy, 48, 28); p.ell('2', cx + 4, cy + 4, 40, 22); p.ell('n', cx - 2, cy - 2, 36, 18);
  for (let i = 0; i < 5; i++) { const x = cx + rng.int(-36, 36), y = cy + rng.int(-16, 16); p.ell('k', x, y, 5, 4); p.r('n', x, y - 1, 4, 1); p.r('j', x - 3, y - 2, 2, 1); }
  for (let i = 0; i < 14; i++) { const a = rng.range(2.4, 4.0), rx = cx + Math.cos(a) * 50, ry = cy + Math.sin(a) * 30; p.r('0', rx, ry - 4, 1, 6); p.r('k', rx + 1, ry - 5, 1, 6); p.r('a', rx + 1, ry - 6, 1, 2); }
  p.r('m', cx - 20, cy - 8, 8, 1); p.r('m', cx + 10, cy + 6, 6, 1);
  for (const [dx, dy] of [[14, -6], [24, 2]]) { const x = cx + dx, y = cy + dy; p.r('4', x - 4, y + 4, 10, 1); p.r('0', x - 1, y - 1, 8, 5); p.r('7', x, y, 6, 3); p.r('o', x + 1, y + 2, 4, 1); p.r('0', x + 5, y - 2, 3, 3); p.r('k', x + 5, y - 1, 2, 1); p.r('g', x + 8, y - 1, 1, 1); }
}
/** drinking fountain for dogs and people: round stone basin, water, low bowl tier */
function fountain(p: Painter, cx: number, cy: number) {
  p.shEll(cx, cy, 12, 10, 10);
  p.obj(() => { p.ell('0', cx, cy, 13, 11); p.ell('p', cx, cy, 12, 10); p.ell('o', cx - 1, cy - 1, 10, 8); p.ell('0', cx, cy, 8, 6); p.ell('n', cx, cy, 7, 5); p.r('m', cx - 4, cy - 2, 3, 1); p.disc('0', cx, cy, 2); p.r('s', cx, cy - 1, 1, 1);
    p.ell('0', cx + 15, cy + 9, 6, 4); p.ell('p', cx + 15, cy + 9, 5, 3); p.ell('n', cx + 15, cy + 9, 3, 2); p.r('m', cx + 13, cy + 8, 2, 1); });
}
/** fenced small-dog pen: chain-link ring with a double gate, worn dirt patch, bench and a ball */
function pen(p: Painter, x: number, y: number, w: number, h: number, rng: Rng) {
  p.ell('b', x + w / 2, y + h / 2 + 6, w * 0.22, h * 0.18); p.dith('k', x + w * 0.2, y + h * 0.25, w * 0.6, h * 0.55, 5);
  const gate = x + (w >> 1) - 8;
  const edge = (x0: number, y0: number, ww: number, hh: number) => { p.shRect(x0, y0, ww, hh, 8); p.obj(() => { p.r('0', x0, y0, ww, hh); if (ww > hh) p.checker('p', x0, y0, ww, 1); else p.checker('p', x0, y0, 1, hh); }); };
  edge(x, y, w, 2); edge(x, y, 2, h); edge(x + w - 2, y, 2, h); edge(x, y + h - 2, gate - x, 2); edge(gate + 16, y + h - 2, x + w - gate - 16, 2);
  p.obj(() => { for (let i = x; i <= x + w - 3; i += 24) for (const yy of [y - 1, y + h - 3]) { if (yy > y && i > gate - 3 && i < gate + 16) continue; p.r('0', i, yy, 4, 4); p.r('o', i + 1, yy + 1, 2, 2); } for (let j = y; j < y + h; j += 24) for (const xx of [x - 1, x + w - 3]) { p.r('0', xx, j, 4, 4); p.r('o', xx + 1, j + 1, 2, 2); }
    p.r('0', gate - 1, y + h + 1, 8, 2); p.r('0', gate + 9, y + h + 4, 8, 2); });
  bench(p, x + 8, y + 10, true);
  fountain(p, x + w - 26, y + 20);
  p.obj(() => { const bx = x + 30 + rng.int(0, 20), by = y + h - 24; p.disc('0', bx, by, 4); p.disc('i', bx, by, 3); p.r('7', bx - 1, by - 2, 1, 2); });
}
/** mown lawn: 32px stripes in world space, two quiet textures of one desaturated green */
function lawn(p: Painter, z: Seg) {
  p.r('k', 0, 0, SW, SEG);
  for (let y = 0; y < SEG; y++) { const band = Math.floor(z.wy(y) / 40) & 1; p.dith('q', 0, y, SW, 1, band ? 2 : 0); }
  for (let i = 0; i < 70; i++) tuft(p, z.r.chance(0.7) ? 'j' : '1', z.r.int(4, SW - 8), z.r.int(2, SEG - 2));
}
const park: LayerDef = { speed: 1, opaque: true, paint(p, z) {
  const r = z.r;
  lawn(p, z);
  const px = (y: number) => 224 + Math.round(Math.sin(z.wy(y) / 170) * 70 + Math.sin(z.wy(y) / 61) * 8);
  for (let y = 0; y < SEG; y++) { const x = px(y); p.r('1', x - 14, y, 29, 1); p.r('q', x - 12, y, 25, 1); if ((y + z.s) % 5 === 0) p.r('p', x - 8 + ((y * 7) % 16), y, 1, 1); }
  // perimeter fence of the dog run
  for (const fx of [26, 420]) { p.shRect(fx, 0, 3, SEG, 8); p.obj(() => { p.r('0', fx, 0, 3, SEG); p.checker('p', fx + 1, 0, 1, SEG); for (let y = 0; y < SEG; y += 32) { p.r('0', fx - 1, y, 5, 5); p.r('o', fx, y + 1, 3, 3); } }); }
  // edge trees outside the fence
  for (const tx of [4, 444]) if (r.chance(0.7)) canopy(p, tx, r.int(40, 210), r.int(22, 30), r, ['1', 'k', 'j']);
  // hero prop on the open side of the path
  const side = px(128) > 224 ? 0 : 1;
  const ex = side ? 268 : 44;
  const k = (z.s + (z.seed % 5)) % 5;
  if (k === 0) { aFrame(p, ex + 24, 60); weavePoles(p, ex + 96, 70); }
  else if (k === 1) { tunnel(p, ex + 50, 36, 150); tireJump(p, ex + 70, 210); }
  else if (k === 2) pond(p, ex + 66, 128, r);
  else if (k === 3) pen(p, ex + 4, 40, 128, 150, r);
  else { fountain(p, ex + 64, 110); bench(p, ex + 30, 150, false); bench(p, ex + 82, 150, false); bin(p, ex + 120, 70); }
  // path furniture: benches facing the path, a lamp, paw prints
  bench(p, px(60) + (side ? -34 : 22), 50, true);
  const ly = r.int(140, 200); lamp(p, px(ly) + (side ? -22 : 22), ly, 34);
  for (let i = 0; i < 6; i++) { const y = 20 + i * 36, x = px(y) + (i % 2 ? 5 : -7); p.r('v', x, y, 3, 3); p.r('v', x - 2, y - 3, 1, 1); p.r('v', x + 1, y - 4, 1, 1); p.r('v', x + 4, y - 3, 1, 1); }
  // flower bed on the path side
  if (r.chance(0.6)) { const fx = side ? r.int(50, 110) : r.int(330, 390), fy = r.int(40, 210); if (Math.abs(px(fy) - fx) > 50) { p.ell('0', fx, fy, 15, 9); p.ell('b', fx, fy, 14, 8); for (let k2 = 0; k2 < 14; k2++) { const a = r.range(0, 6.28), d = r.range(0, 1); p.r(r.pick(['c', '7', 't', 'e']), fx + Math.cos(a) * d * 11, fy + Math.sin(a) * d * 5, 1, 1); p.r('j', fx + Math.cos(a) * d * 11 + 1, fy + Math.sin(a) * d * 5 + 1, 1, 1); } } }
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
  if (r.chance(0.3)) {
    const y = r.int(20, 220);
    const at = cable(p, 80, 368, y, r.int(6, 12));
    for (let x = 100; x < 350; x += r.int(16, 30)) { const yy = at(x + 5); const k = r.pick(['n', 'e', '9', 'u', 'p', 'a', 'k']); const ww = r.int(8, 14), hh = r.int(10, 18); p.r('0', x, yy + 1, ww, hh); p.r(k, x + 1, yy + 1, ww - 2, hh - 1); p.r('0', x + 1, yy + 2, ww - 2, 1); }
  }
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
  p.glow('q', 'f', x + 9, y + 28, 8, 2); p.pool(x + 13, y + 34, 12);
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
  stringLights(p, posts[0][0] + 1, posts[0][1] + 1, posts[1][0] + 1, posts[1][1] + 1, rng, 4);
  stringLights(p, posts[2][0] + 1, posts[2][1] + 1, posts[3][0] + 1, posts[3][1] + 1, rng, 4);
  p.pool(tx, ty, 14);
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
 * NYC water tower (3/4 view from above), in dark slate wood so it never competes
 * with the cats: a witch-hat conical roof with a finial, a stave tank with two
 * iron hoops, and four tall stilt legs with an X-brace over a roof platform.
 * Footprint: (cx-r-3 .. cx+r+3) x (top .. top + towerH(r)).
 */
const towerH = (r: number) => r + 8 + r + 16;
function waterTower(p: Painter, cx: number, top: number, r: number) {
  const coneH = r + 6, tankTop = top + coneH, th = r + 2, legTop = tankTop + th, lh = 14, feet = legTop + lh;
  const legs = [cx - r + 1, cx + r - 3];
  p.shRect(cx - r, feet - 4, 2 * r, 4, 30);
  p.shRect(cx - r, tankTop, 2 * r, th, 34);
  p.obj(() => {
    // platform + legs + X-brace (dark iron)
    p.r('0', cx - r - 3, feet - 2, 2 * r + 6, 4); p.r('q', cx - r - 2, feet - 1, 2 * r + 4, 2);
    for (const lx of legs) { p.r('0', lx - 1, legTop - 1, 4, lh + 1); p.r('p', lx, legTop, 1, lh - 1); }
    for (let i = 0; i < lh - 2; i++) { const t = i / (lh - 3); const xa = Math.round(legs[0] + 2 + t * (legs[1] - legs[0] - 3)); p.r('0', xa, legTop + 1 + i, 2, 1); p.r('0', legs[1] - (xa - legs[0]) + 1, legTop + 1 + i, 2, 1); }
    p.r('0', legs[0], legTop + (lh >> 1), legs[1] - legs[0] + 2, 1);
    // tank: vertical staves with cylinder shading
    p.r('0', cx - r - 1, tankTop - 1, 2 * r + 2, th + 2);
    for (let x = -r; x < r; x++) { const t = (x + 0.5) / r; let k = t < -0.4 ? 'p' : t < 0.4 ? 'q' : 'v'; if ((x + r) % 3 === 2) k = k === 'p' ? 'q' : k === 'q' ? 'v' : '1'; p.r(k, cx + x, tankTop, 1, th); }
    for (const hy of [tankTop + 2, tankTop + th - 3]) { p.r('0', cx - r, hy, 2 * r, 1); }
    // witch-hat cone: a triangle profile with overhanging eave, lit on the left
    p.r('0', cx - r - 3, tankTop - 2, 2 * r + 6, 3);
    for (let j = 0; j < coneH; j++) {
      const hw = Math.round((j / coneH) * (r + 2)) + 1, y = top + j;
      p.r('0', cx - hw - 1, y, 2 * hw + 2, 1);
      p.r('q', cx - hw, y, hw, 1); p.r('v', cx, y, hw, 1);
      if (hw > 3) p.r('p', cx - hw, y, 1, 1);
      if (j % 4 === 3) { p.r('v', cx - hw + 1, y, hw - 1, 1); p.r('1', cx + 1, y, hw - 1, 1); }
    }
    p.r('q', cx - r - 2, tankTop - 1, 2 * r + 4, 1); p.r('p', cx - r - 2, tankTop - 1, r, 1);
    p.r('0', cx, top - 3, 1, 3);
    p.glow('0', 'r', cx, top - 4, 1, 1, 0.9, 0);
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
      const want = ['ac', 'vent', 'sky', 'ac', 'dish', 'chimney', 'sky'];
      if (r.chance(0.3) && (x < 100 || x + w > SW - 100)) { const rr = r.int(8, 10); const at = pk.place(rr * 2 + 8, towerH(rr) + 4); if (at) waterTower(p, at[0] + rr + 4, at[1], rr); }
      if (r.chance(0.55) && w >= 96 && h >= 64) { const gw = Math.min(w - 28, 112), gh = Math.min(h - 24, 72); const at = pk.place(gw, gh); if (at) roofGarden(p, at[0], at[1], gw, gh, r); }
      if (r.chance(0.25) && w >= 128) { const at = pk.place(96, 20); if (at) solar(p, at[0], at[1], 96); }
      if (r.chance(0.4)) { const at = pk.place(26, 28); if (at) bulkhead(p, at[0], at[1]); }
      const nItems = Math.round((w * h) / 3000) + r.int(1, 2);
      for (let i = 0; i < nItems; i++) {
        const f = r.pick(want);
        if (f === 'ac') { const at = pk.place(22, 16); if (at) acUnit(p, at[0], at[1]); }
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
  if (r.chance(0.1)) wires(p, r.int(30, 220), r);
} };

// ---------------------------------------------------------------- CAFE
/** coffee cup on a saucer, seen from above: pale saucer, cream cup rim, dark coffee, a little handle */
function cup(p: Painter, x: number, y: number, handleLeft = false) {
  p.disc('0', x, y, 4.5); p.disc('o', x, y, 4); p.disc('7', x, y, 3); p.disc('b', x, y, 2); p.r('a', x - 1, y - 1, 1, 1);
  const hx = handleLeft ? x - 5 : x + 3; p.r('0', hx, y - 1, 2, 3); p.r('7', handleLeft ? hx + 1 : hx, y, 1, 1);
}
/** pastry plate with a croissant (a crescent of puffy segments) */
function pastry(p: Painter, x: number, y: number) {
  p.disc('0', x, y, 5.5); p.disc('7', x, y, 5); p.disc('o', x + 1, y + 1, 3.5); p.disc('7', x, y, 2.5);
  const segs: [number, number][] = [[-3, 1], [-2, -1], [0, -2], [2, -1], [3, 1]];
  for (const [dx, dy] of segs) p.disc('0', x + dx, y + dy, 1.8);
  for (const [dx, dy] of segs) p.disc('h', x + dx, y + dy, 1.2);
  for (const [dx, dy] of segs.slice(1, 4)) p.r('g', x + dx, y + dy - 1, 1, 1);
}
/** cafe table: four wood chairs, a warm wood (or marble) round top with cups and a pastry plate */
function cafeTable(p: Painter, cx: number, cy: number, rng: Rng) {
  for (const [dx, dy] of [[-19, 0], [19, 0], [0, -19], [0, 19]]) { if (rng.chance(0.25)) continue; const x = cx + dx, y = cy + dy; p.shRect(x - 5, y - 5, 10, 10, 6); p.obj(() => { p.r('0', x - 5, y - 5, 10, 10); p.r('a', x - 4, y - 4, 8, 8); p.r('9', x - 4, y - 4, 8, 1); p.r('b', x - 4, y + 3, 8, 1); if (dx) p.r('b', dx < 0 ? x - 4 : x + 2, y - 4, 2, 8); else p.r('b', x - 4, dy < 0 ? y - 4 : y + 2, 8, 2); }); }
  const marble = rng.chance(0.35);
  p.shEll(cx, cy, 13, 13, 14);
  p.obj(() => {
    const [rim, top, lit, grain] = marble ? ['p', 'o', '7', 'p'] : ['b', 'a', '9', 'b'];
    p.disc('0', cx, cy, 14); p.disc(rim, cx, cy, 13); p.disc(top, cx, cy, 12); p.ell(lit, cx - 4, cy - 5, 6, 3);
    if (marble) { p.line(grain, cx - 8, cy + 2, cx + 2, cy + 7); p.line(grain, cx + 3, cy - 8, cx + 9, cy - 1); }
    else for (let j = -9; j <= 9; j += 4) p.r(grain, cx - Math.round(Math.sqrt(144 - j * j) * 0.8), cy + j, Math.round(Math.sqrt(144 - j * j) * 1.6), 1);
    const n = rng.int(1, 2);
    cup(p, cx - 5, cy - 3, true); if (n > 1) cup(p, cx + 5, cy + 4);
    if (rng.chance(0.6)) pastry(p, n > 1 ? cx + 4 : cx + 3, n > 1 ? cy - 5 : cy + 4);
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
  p.r('v', 0, 0, SW, SEG);
  for (let x = 70; x < SW; x += 14) { p.r('1', x, 0, 1, SEG); const off = ((x * 37) % 96); for (let y = -off; y < SEG; y += 96) p.r('1', x, y, 14, 1); }
  for (let i = 0; i < 60; i++) { const x = 72 + r.int(0, 25) * 14 + r.int(3, 9), y = r.int(0, SEG - 8); p.r('b', x, y, 1, r.int(4, 10)); }
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
  if (p.tod !== 'night') { if (p.tod === 'dusk') p.sunRamp = DUSK_SUN; for (let y = 8; y < SEG; y += 64) { const len = p.tod === 'day' ? 110 : 230; p.beam(SW - 30 - len, y + 18, len, 30, p.tod === 'day' ? 0.4 : p.tod === 'dawn' ? 0.9 : -0.9); } }
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
/** open fish crate on crushed ice: three fat silver fish (head, eye, forked tail) packed head-to-tail */
function fishCrate(p: Painter, x: number, y: number, rng: Rng) {
  p.shRect(x, y, 24, 18, 7);
  p.obj(() => {
    p.r('0', x, y, 24, 18); p.r('a', x + 1, y + 1, 22, 16); p.r('9', x + 1, y + 1, 22, 1); p.r('b', x + 1, y + 16, 22, 1);
    p.r('5', x + 3, y + 3, 18, 12); p.checker('s', x + 3, y + 3, 18, 12);
    for (let i = 0; i < 3; i++) {
      const fy = y + 4 + i * 4, left = (i + rng.int(0, 1)) % 2 === 0; const fx = x + 4;
      p.r('0', fx, fy, 13, 3); p.r('o', fx + 1, fy, 11, 2); p.r('p', fx + 1, fy + 2, 11, 1);
      const tx = left ? fx + 13 : fx - 3; p.r('0', tx, fy - 1, 3, 1); p.r('0', tx, fy + 3, 3, 1); p.r('p', tx + (left ? 0 : 2), fy, 1, 3);
      p.r('0', left ? fx + 2 : fx + 10, fy, 1, 1);
    }
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
  // half-density ripple marks, all one quiet tone; a few glints are animated in the tileset anim instead
  for (let y = 0; y < SEG; y += 12) {
    const w = z.wy(y); const off = Math.round(Math.sin(w / 37) * 10 + Math.sin(w / 13) * 3);
    for (let x = ((y / 12) % 2) * 28 + off - 56; x < SW; x += 56) { const len = 7 + Math.round(Math.abs(Math.sin((x + w) / 19)) * 6); p.r('2', x, y, len, 1); p.r('2', x + 2, y + 1, len - 4, 1); }
  }
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
/** yarn dyes [body, shade, highlight]: saturated accents kept one step darker than the cats */
const DYES: [string, string, string][] = [['e', 'v', 'd'], ['n', '2', 'm'], ['h', 'a', 'g'], ['k', '1', 'j']];
function yarnBall(p: Painter, x: number, y: number, k: string, sh: string, hi = k) {
  p.disc('0', x, y, 6); p.disc(k, x, y, 5); p.disc(sh, x + 1, y + 1, 3); p.disc(k, x, y, 2);
  p.line(sh, x - 4, y + 1, x + 1, y - 4); p.line(sh, x - 2, y + 4, x + 4, y - 2); p.r(hi, x - 3, y - 3, 2, 1); p.r(hi, x - 3, y - 2, 1, 1);
}
/** conveyor frame (the moving belt itself is blitted per frame by factoryFx) */
function conveyor(p: Painter, x: number) {
  p.shRect(x - 3, 0, 38, SEG, 6);
  p.obj(() => {
    p.r('0', x - 3, 0, 38, SEG); p.r('p', x - 2, 0, 3, SEG); p.r('o', x - 2, 0, 1, SEG); p.r('p', x + 31, 0, 3, SEG); p.r('q', x + 33, 0, 1, SEG);
    for (let y = 6; y < SEG; y += 32) { p.r('0', x - 4, y, 40, 4); p.r('q', x - 3, y + 1, 38, 2); p.r('p', x - 3, y + 1, 38, 1); }
  });
}
const BELT_P = 48;
/** one belt strip: slats, chevrons and yarn spools, painted once per time of day and scrolled faster than the floor */
function beltStrip(p: Painter, flip: boolean) {
  p.r('v', 0, 0, 30, p.h);
  for (let y = 0; y < p.h; y += 6) p.r('1', 0, y, 30, 2);
  for (let y = 0; y < p.h; y += 24) for (let i = 0; i < 6; i++) { const yy = flip ? y + 6 - i : y + i; p.r('q', 6 + i, yy, 2, 1); p.r('q', 22 - i, yy, 2, 1); }
  for (let y = 0, k = 0; y < p.h; y += BELT_P, k++) { const [d, sh, hi] = DYES[(k + (flip ? 2 : 0)) % DYES.length]; yarnBall(p, 15, y + 18, d, sh, hi); }
}
const factoryFx = (ctx: CanvasRenderingContext2D, scroll: number, t: number, _seed: number, tod: Tod, bg: Background) => {
  for (const [x, dir] of [[94, 1], [322, -1]] as [number, number][]) {
    const strip = bg.painted('belt' + dir, 30, 360 + BELT_P, tod, p => beltStrip(p, dir < 0));
    const off = Math.floor(scroll + t * 0.5 * dir); const m = ((off % BELT_P) + BELT_P) % BELT_P;
    ctx.drawImage(strip, x + 1, m - BELT_P);
  }
};
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
    for (let j = 0; j < 2; j++) for (let i = 0; i < 6; i++) { const cx = x + 10 + i * 15, cy = y + 16 + j * 24; const [k, sh, hi] = rng.pick(DYES); p.disc('0', cx, cy, 6); p.disc(k, cx, cy, 5); p.ring(sh, cx, cy, 3, 3, 1); p.r(hi, cx - 3, cy - 3, 2, 1); p.disc('0', cx, cy, 1); }
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
  conveyor(p, 94); conveyor(p, 322);
  for (const px0 of [6, 420]) { p.shRect(px0, 0, 20, SEG, 10); p.obj(() => { p.r('0', px0, 0, 20, SEG); p.r('p', px0 + 1, 0, 18, SEG); p.r('o', px0 + 3, 0, 2, SEG); p.r('q', px0 + 14, 0, 4, SEG); for (let y = 16; y < SEG; y += 64) { p.r('0', px0 - 2, y, 24, 8); p.r('q', px0 - 1, y + 1, 22, 6); p.r('p', px0 - 1, y + 1, 22, 1); } }); }
  const k = (z.s + r.int(0, 2)) % 3;
  if (k === 0) { vat(p, 224, 80, 'n', 'm'); vat(p, 224, 190, 'e', 'd'); }
  else if (k === 1) { spinner(p, 176, 40, r); spinner(p, 176, 150, r); }
  else { vat(p, 224, 100, 'h', 'g'); p.shRect(170, 170, 110, 40, 10); p.obj(() => { p.r('0', 170, 170, 110, 40); p.r('a', 171, 171, 108, 38); p.r('9', 171, 171, 108, 1); for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { const [dk, sh, hi] = r.pick(DYES); yarnBall(p, 186 + i * 26, 181 + j * 18, dk, sh, hi); } }); }
  for (const sx of [44, 370]) { const sy = r.int(30, 200); crate(p, sx, sy, 30, 30, 'b'); p.obj(() => { for (let i = 0; i < 4; i++) { const [dk, sh, hi] = r.pick(DYES); yarnBall(p, sx + 8 + (i % 2) * 14, sy + 8 + (i >> 1) * 14, dk, sh, hi); } }); }
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
/**
 * Stratosphere backdrop (screen-fixed): banded altitude light with dithered
 * seams, darkest at the top behind the formation, warmest low on the horizon.
 * Bands are [colour, until-y]; each seam is a 16px ordered-dither blend.
 */
const SKY_BANDS: Record<Tod, [string, number][]> = {
  day: [['n', 180], ['m', 360]],
  dawn: [['2', 130], ['3', 250], ['4', 324], ['c', 360]],
  dusk: [['v', 96], ['2', 150], ['e', 236], ['h', 318], ['g', 360]],
  night: [['0', 120], ['1', 250], ['v', 360]],
};
function skyBackdrop(p: Painter, tod: Tod) {
  const bands = SKY_BANDS[tod]; const H = p.h;
  let y0 = 0;
  for (const [k, y1] of bands) { p.r(k, 0, y0, SW, y1 - y0); y0 = y1; }
  bands.forEach(([k, y1], i) => {
    const next = bands[i + 1]; if (next) for (let j = 0; j < 24; j++) { p.r(k, 0, y1 - 12 + j, SW, 1); p.dith(next[0], 0, y1 - 12 + j, SW, 1, Math.round(((j + 1) / 25) * 16)); }
  });
  // day: pale haze streaks low down; night: a sprinkle of stars up high
  const r = new Rng(77);
  if (tod === 'night') for (let i = 0; i < 70; i++) p.r(r.pick(['2', '3', '2', '4']), r.int(0, SW - 1), r.int(0, H * 0.7), 1, 1);
  if (tod === 'dusk') { const sx = 300, sy = H - 30; for (let j = -22; j <= 22; j++) { const hw = Math.round(Math.sqrt(22 * 22 - j * j)); p.dith('f', sx - hw, sy + j, hw * 2, 1, j > 8 ? 6 : 12); } }
}
/** cumulus palette for the sky tileset per time of day: [hard shadow, underside, body, lit top] (desaturated so cats pop) */
const CLOUD: Record<Tod, string[]> = {
  day: ['3', '4', '5', 'o'],
  dawn: ['2', '3', '4', 'c'],
  dusk: ['v', 'v', '2', 'e'],
  night: ['1', '1', 'v', '2'],
};
/** far: big soft cloud masses drifting slowly at a lower altitude */
const skyFar: LayerDef = { speed: 0.3, paint(p, z) {
  const r = z.r; const c = CLOUD[p.tod];
  for (let i = 0; i < 3; i++) cloudBank(p, r.int(-40, SW + 40), r.int(20, SEG - 20), r.int(22, 34), r, [c[0], c[0], c[1], c[1]]);
} };
/** main: large cumulus banks along the edges, rarely one drifting through the middle */
const skyMain: LayerDef = { speed: 1, paint(p, z) {
  const r = z.r; const c = CLOUD[p.tod];
  const n = r.int(1, 2);
  for (let i = 0; i < n; i++) cloudBank(p, r.chance(0.5) ? r.int(-20, 80) : r.int(360, 470), r.int(40, 210), r.int(32, 46), r, c);
  if (r.chance(0.2)) cloudBank(p, r.int(150, 300), r.int(40, 210), r.int(14, 20), r, c);
} };
/** fast foreground cloudlets at the playfield edges only (never across the formation) */
const wispsFg: LayerDef = { speed: 2, paint(p, z) {
  const r = z.r; const c = CLOUD[p.tod];
  if (r.chance(0.5)) cloudBank(p, r.chance(0.5) ? r.int(-30, 20) : r.int(428, 478), r.int(30, 220), r.int(16, 24), r, c);
} };
const SKY_RAMPS: Partial<Record<Tod, Ramp>> = { dawn: ramp(''), dusk: ramp(''), night: ramp('') };

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
/** a litter clump: lumpy darker blob with a lit top-left and grainy crumbs around it */
function clump(p: Painter, x: number, y: number, r: number, rng: Rng) {
  const lobes: [number, number, number][] = [[x, y, r]];
  for (let i = 0; i < 3; i++) lobes.push([x + rng.int(-r, r) * 0.7, y + rng.int(-r, r) * 0.5, Math.max(2, r * rng.range(0.5, 0.8))]);
  for (const [lx, ly, lr] of lobes) p.disc('0', lx, ly + 1, lr + 1);
  for (const [lx, ly, lr] of lobes) p.disc('o', lx, ly, lr);
  for (const [lx, ly, lr] of lobes) p.disc('p', lx + lr * 0.3, ly + lr * 0.35, lr * 0.55);
  for (const [lx, ly, lr] of lobes) p.r('7', lx - lr * 0.5, ly - lr * 0.5, Math.max(1, lr * 0.6), 1);
  for (let i = 0; i < r * 3; i++) p.r(rng.pick(['o', 'p', '8']), x + rng.int(-r * 2, r * 2), y + rng.int(-r, r * 1.4), 1, 1);
}
/** crater lit from the upper left: bright rim, a shadow crescent inside, flat floor (litter-box craters hold clumps) */
function crater(p: Painter, cx: number, cy: number, rr: number, rng: Rng, litter: boolean) {
  const ry = rr * 0.8;
  p.ell('o', cx - 1, cy - 1, rr + 2, ry + 2);
  p.ell('q', cx + 1, cy + 1, rr + 1, ry + 1);
  p.ell('v', cx, cy, rr, ry);
  p.ell('q', cx + Math.max(1, rr * 0.12), cy + Math.max(1, rr * 0.12), rr - Math.max(1, rr * 0.1), ry - Math.max(1, rr * 0.1));
  p.ell('p', cx - rr * 0.35, cy - ry * 0.45, rr * 0.25, ry * 0.12);
  if (litter) { const n = Math.max(1, Math.round(rr / 9)); for (let i = 0; i < n; i++) clump(p, cx + rng.int(-rr / 2, rr / 3), cy + rng.int(-ry / 3, ry / 3), rng.int(4, 6), rng); }
}
/** a giant pink litter scoop, half-buried in a crater: slotted shovel head + handle sticking out */
function scoop(p: Painter, cx: number, cy: number) {
  crater(p, cx, cy, 30, new Rng(cx * 7 + cy), false);
  p.shRect(cx - 4, cy - 50, 9, 40, 10);
  p.obj(() => {
    // buried head: only the back half shows above the litter, slots and rim
    p.r('0', cx - 15, cy - 9, 30, 15); p.r('e', cx - 14, cy - 8, 28, 13); p.r('d', cx - 14, cy - 8, 28, 2);
    for (let i = cx - 11; i < cx + 11; i += 5) p.r('v', i, cy - 5, 2, 9);
    p.r('p', cx - 15, cy + 5, 30, 2); p.checker('o', cx - 15, cy + 5, 30, 2); // litter spilling over the buried edge
    // handle
    p.r('0', cx - 4, cy - 52, 9, 44); p.r('e', cx - 3, cy - 51, 7, 42); p.r('d', cx - 3, cy - 51, 2, 42); p.r('v', cx + 3, cy - 51, 1, 42);
    p.r('0', cx - 1, cy - 47, 3, 6);
  });
}
/** sandy litter-moon regolith: beige-grey with granules, gentle dunes */
function regolith(p: Painter, z: Seg) {
  field(p, ['q', 'q', 'p'], (x, y) => { const w = z.wy(y); return 0.4 + 0.22 * Math.sin(x / 53 + Math.sin(w / 71) * 2.5) + 0.12 * Math.sin(w / 37 - x / 89); }, -1, 0.35);
  const r = z.r;
  // sandy grain: an ordered sprinkle of warm beige in the light sand, brown in the dark sand (regular = texture, not noise)
  p.pixels(set => { for (let y = 0; y < SEG; y++) for (let x = 0; x < SW; x++) { const v = p.buf[y * SW + x], b = bayer(x + (y >> 2) * 3, y); if (v === 25 && b < 4) set('9', x, y); else if (v === 26 && b < 3) set('a', x, y); } });
  for (let i = 0; i < 60; i++) { const x = r.int(0, SW - 3), y = r.int(0, SEG - 2); p.r('o', x, y, 2, 1); p.r('q', x, y + 1, 2, 1); }
}
const moon: LayerDef = { speed: 1, opaque: true, paint(p, z) {
  const r = z.r;
  regolith(p, z);
  for (let i = 0; i < 4; i++) crater(p, r.int(10, SW - 10), r.int(10, SEG - 10), r.int(4, 9), r, false);
  for (let i = 0; i < 2; i++) crater(p, r.int(20, SW - 20), r.int(20, SEG - 20), r.int(12, 18), r, true);
  if (z.s % 3 === 0) scoop(p, r.int(100, 340), r.int(70, 190));
  else if (r.chance(0.8)) crater(p, r.int(70, SW - 70), r.int(50, SEG - 50), r.int(26, 38), r, true);
  for (let i = 0; i < 4; i++) clump(p, r.int(20, SW - 20), r.int(10, SEG - 10), r.int(3, 6), r);
  for (let y = 0; y < SEG; y += 18) { const x = 300 + Math.round(Math.sin(z.wy(y) / 90) * 60) + ((y / 18) % 2 ? 6 : -6); p.r('v', x, y, 4, 3); p.r('v', x - 1, y - 3, 1, 1); p.r('v', x + 1, y - 4, 2, 1); p.r('v', x + 4, y - 3, 1, 1); }
  // the giant litter-box wall along both edges: thick plastic rim with a lit top and a shadow on the litter
  for (const [x0, dir] of [[0, 1], [SW - 44, -1]] as [number, number][]) {
    p.shRect(x0, 0, 44, SEG, 16);
    p.obj(() => { p.r('0', x0, 0, 44, SEG); p.r('2', x0 + 1, 0, 42, SEG); p.r('3', dir > 0 ? x0 + 26 : x0 + 12, 0, 6, SEG); p.r('4', dir > 0 ? x0 + 27 : x0 + 13, 0, 2, SEG); p.r('1', dir > 0 ? x0 + 39 : x0 + 1, 0, 4, SEG); p.r('1', dir > 0 ? x0 + 2 : x0 + 38, 0, 4, SEG); for (let y = 10; y < SEG; y += 64) p.r('1', x0 + 2, y, 40, 1); });
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
      p.r(turn ? (t < 0.3 ? 'a' : 'b') : (t < 0.3 ? '9' : t < 0.75 ? 'a' : 'b'), x0 + i, y, 1, 1);
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
/** station habitat pods sit at fixed heights in every segment so the anim can blink their ear-antenna lights */
const POD_Y = 30, POD_H = 168, POD_X = [36, 260], POD_W = 152;
const podEars = (mx: number) => [mx + 34, mx + POD_W - 34];
/** sisal rope band wrapped around a pod: twisted strands, lit left, shaded right */
function sisal(p: Painter, x: number, y: number, w: number, h: number) {
  p.r('0', x, y - 1, w, h + 2);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const t = i / w; const strand = ((i + j * 2) % 5) < 2; p.r(strand ? (t < 0.25 ? 'a' : t < 0.8 ? 'b' : 'v') : (t < 0.25 ? '9' : t < 0.8 ? 'a' : 'b'), x + i, y + j, 1, 1); }
  p.r('b', x, y + h - 1, w, 1);
}
const station: LayerDef = { speed: 1, paint(p, z) {
  const r = z.r;
  p.r('0', 200, 0, 48, SEG); p.r('q', 202, 0, 4, SEG); p.r('q', 242, 0, 4, SEG);
  for (let y = 0; y < SEG; y += 32) { p.line('q', 206, y, 241, y + 31); p.line('q', 241, y, 206, y + 31); p.r('p', 202, y, 44, 2); }
  p.r('p', 203, 0, 1, SEG);
  every(z, 64, 0, y => { if (y > 0 && y < SEG) { p.glow('1', 'r', 203, y, 2, 2, 1, 0); p.glow('1', 'i', 243, y + 32, 2, 2, 1, 0); } });
  for (const side of [0, 1]) {
    const mx = POD_X[side], mw = POD_W, my = POD_Y, mh = POD_H;
    p.shRect(mx, my, mw, mh, 16);
    // cat-ear antennae on the pod's top edge
    p.obj(() => { for (const ex of podEars(mx)) { for (let j = 0; j < 12; j++) { const hw = Math.round(j * 0.55) + 1; p.r('0', ex - hw - 1, my - 12 + j, hw * 2 + 2, 1); p.r('q', ex - hw, my - 12 + j, hw, 1); p.r('v', ex, my - 12 + j, hw, 1); if (j > 4) p.r('e', ex - Math.round(hw * 0.4), my - 12 + j, Math.max(1, Math.round(hw * 0.8)), 1); } p.r('0', ex, my - 18, 1, 6); } });
    p.obj(() => {
      const ch = 10;
      for (let j = 0; j < mh; j++) { const c = Math.max(0, ch - Math.min(j, mh - 1 - j)); p.r('0', mx + c, my + j, mw - 2 * c, 1); if (j > 0 && j < mh - 1) { const c2 = c + 1; p.r('q', mx + c2, my + j, mw - 2 * c2, 1); if (j > 2 && j < mh - 3) { const c3 = c + 3; p.r(j > 4 && j < mh - 5 ? 'v' : 'u', mx + c3, my + j, mw - 2 * c3, 1); if (j > 4 && j < mh - 5) { p.r('2', mx + c3, my + j, 2, 1); p.r('1', mx + mw - c3 - 2, my + j, 2, 1); } } } }
      for (let i = mx + 8 + 36; i < mx + mw - 8; i += 36) { p.r('1', i, my + 30, 1, mh - 60); p.r('2', i + 1, my + 30, 1, mh - 60); }
      for (let j = my + 30 + 34; j < my + mh - 30; j += 34) { p.r('1', mx + 8, j, mw - 16, 1); p.r('2', mx + 8, j + 1, mw - 16, 1); }
      for (let j = my + 40; j < my + mh - 34; j += 34) for (let i = mx + 14; i < mx + mw - 14; i += 36) { p.r('1', i, j, 3, 3); p.r('1', i + 26, j + 20, 3, 3); }
      sisal(p, mx + 6, my + 14, mw - 12, 12); sisal(p, mx + 6, my + mh - 26, mw - 12, 12);
      p.r('0', side ? mx - 12 : mx + mw, my + mh / 2 - 6, 12, 12); p.r('q', side ? mx - 12 : mx + mw, my + mh / 2 - 5, 12, 10);
      for (let i = 0; i < 5; i++) p.glow('2', 'f', mx + 14 + i * 28, my + 3, 6, 2, 1.2, (i * 0.37) % 1);
    });
    scratchPost(p, mx + r.int(36, 56), my + 34, r.int(12, 15));
    p.obj(() => { const bx = mx + mw - 44, by = my + 40; p.r('0', bx, by, 28, 28); p.r('n', bx + 1, by + 1, 26, 26); p.r('m', bx + 1, by + 1, 26, 1); p.r('2', bx + 1, by + 26, 26, 1); p.disc('0', bx + 14, by + 15, 6); p.disc('1', bx + 14, by + 15, 5); p.glow('1', 'l', bx + 13, by + 14, 2, 2, 1.5, 0); });
    const sy = my + mh + 20; if (sy < SEG - 26) { const sx = side ? 300 : 60; p.obj(() => { p.r('0', sx, sy, 100, 24); p.r('2', sx + 1, sy + 1, 98, 22); for (let i = sx + 1; i < sx + 99; i += 10) p.r('1', i, sy + 1, 1, 22); p.r('1', sx + 1, sy + 12, 98, 1); p.r('3', sx + 1, sy + 1, 98, 1); p.r('q', side ? sx - 40 : sx + 100, sy + 10, 40, 4); }); }
  }
} };
/** blinking tips on the pods' cat-ear antennae */
const earLights = (px: Px, scroll: number, t: number) => {
  everyScreen(scroll, SEG, SEG - (POD_Y - 18), (sy, k) => POD_X.forEach((mx, side) => podEars(mx).forEach((ex, i) => {
    const on = ((t >> 4) + k + i + side) % 4 < 2; if (!on) return;
    const c = i ? 'i' : 'r'; px('0', ex - 2, sy - 2, 5, 5); px(c, ex - 1, sy - 1, 3, 3); px('6', ex, sy, 1, 1);
  })));
};

// ---------------------------------------------------------------- MOTHERSHIP
/** far: deep space behind the alien cat mothership: stars, a ringed planet, and the silhouettes of the ship's ear-fins far below */
const motherFar: LayerDef = { speed: 0.25, opaque: true, paint(p, z) {
  const r = z.r;
  p.r('0', 0, 0, SW, SEG); stars(p, r, 70, ['2', '2', '3', 'v']);
  for (let i = 0; i < 5; i++) { const x = r.int(4, SW - 4), y = r.int(4, SEG - 4); p.r('4', x, y, 1, 1); p.r('2', x - 1, y, 1, 1); p.r('2', x + 1, y, 1, 1); p.r('2', x, y - 1, 1, 1); p.r('2', x, y + 1, 1, 1); }
  if (z.s % 4 === 1) { // ringed catnip-green planet, lit from the upper left
    const cx = r.chance(0.5) ? 60 : 388, cy = r.int(60, 190);
    p.ell('v', cx, cy, 52, 9); p.disc('0', cx, cy, 31); p.disc('k', cx, cy, 30); p.disc('j', cx - 6, cy - 6, 22); p.disc('k', cx - 3, cy - 3, 18);
    for (let j = -24; j <= 24; j += 8) p.r('1', cx - Math.round(Math.sqrt(900 - j * j)) + 2, cy + j, Math.round(Math.sqrt(900 - j * j) * 1.8), 1);
    p.ell('2', cx, cy + 2, 46, 6); p.ell('0', cx, cy + 2, 40, 4); p.disc('k', cx, cy, 14); p.disc('j', cx - 4, cy - 2, 6);
    for (let i = -46; i < 46; i++) { const yy = cy + 2 + Math.round(Math.sqrt(Math.max(0, 1 - (i / 46) ** 2)) * 6); if (Math.abs(i) > 30 || yy > cy + 4) p.r('3', cx + i, yy, 1, 1); }
  }
  // distant ear-fins of the fleet (pointed triangles in plum)
  for (let i = 0; i < 2; i++) { const fx = r.int(20, SW - 40), fy = r.int(30, SEG - 10); for (let j = 0; j < 22; j++) { const hw = Math.round(j * 0.45); p.r('v', fx - hw, fy - 22 + j, hw * 2 + 1, 1); if (j > 6) p.r('1', fx - Math.round(hw * 0.3), fy - 22 + j, Math.round(hw * 0.6) + 1, 1); } p.r('v', fx - 16, fy, 33, 4); }
} };
/** paw-print hatch: big pad + four toe beans, rimmed in purple trim */
function pawHatch(p: Painter, cx: number, cy: number) {
  const pad = (x: number, y: number, rx: number, ry: number) => { p.ell('0', x, y, rx + 1, ry + 1); p.ell('u', x, y, rx, ry); p.ell('1', x, y, rx - 1, ry - 1); p.ell('2', x - 1, y - 1, rx - 3, ry - 3); p.ell('1', x, y, rx - 4, ry - 4); };
  pad(cx, cy + 5, 13, 10);
  for (const [dx, dy] of [[-14, -6], [-5, -13], [5, -13], [14, -6]]) pad(cx + dx, cy + dy, 5, 6);
  p.r('3', cx - 5, cy + 1, 3, 1);
}
/** glowing cat-eye porthole: almond eye with a slit pupil, emissive after dusk */
function catEye(p: Painter, cx: number, cy: number) {
  for (let j = -5; j <= 5; j++) { const hw = Math.round(Math.sqrt(1 - (j / 6) ** 2) * 9 * (1 - Math.abs(j) / 14)); p.r('0', cx - hw - 1, cy + j, hw * 2 + 3, 1); }
  for (let j = -4; j <= 4; j++) { const hw = Math.round(Math.sqrt(1 - (j / 5) ** 2) * 8 * (1 - Math.abs(j) / 14)); p.glow('k', 'i', cx - hw, cy + j, hw * 2 + 1, 1, 1.5, 0); }
  p.lateBars.push([cx, cy - 4, 1, 9]); p.lateBars.push([cx - 1, cy - 2, 3, 5]);
}
/** yarn-cable conduit: two twisted strands in clamps */
function yarnCable(p: Painter, x: number, z: Seg) {
  p.r('0', x - 5, 0, 11, SEG);
  for (let y = 0; y < SEG; y++) { const w = z.wy(y); const o = Math.round(Math.sin(w / 5) * 3); p.r('e', x + o - 1, y, 3, 1); p.r('u', x - o - 1, y, 3, 1); if (Math.sin(w / 5) > 0.6) p.r('d', x + o - 1, y, 1, 1); }
  for (let y = 0; y < SEG; y += 40) { p.r('0', x - 7, y, 15, 5); p.r('q', x - 6, y + 1, 13, 3); p.r('p', x - 6, y + 1, 13, 1); }
}
/** deep violet / gunmetal hull plates with alien-cat motifs; the starfield shows past the hull edges and between the ear-fins */
const mothership: LayerDef = { speed: 1, paint(p, z) {
  const r = z.r;
  const L = 72, R = SW - 72;
  p.r('0', L, 0, R - L, SEG);
  for (let y = 0; y < SEG; y += 32) for (let x = L; x < R; x += 76) {
    const w = Math.min(76, R - x);
    p.r('v', x + 1, y + 1, w - 1, 31); p.r('2', x + 1, y + 1, w - 1, 1); p.r('2', x + 1, y + 1, 1, 31); p.r('1', x + 1, y + 31, w - 1, 1); p.r('1', x + w - 1, y + 1, 1, 31);
    const v = (x / 76 + y / 32 + z.s) % 5;
    if (v === 0) for (let i = 0; i < 4; i++) p.r('1', x + 10, y + 7 + i * 5, w - 20, 2);
    else if (v === 2) { for (const [dx, dy] of [[6, 6], [w - 10, 6], [6, 23], [w - 10, 23]]) { p.r('1', x + dx, y + dy, 4, 4); p.r('2', x + dx, y + dy, 2, 1); } }
  }
  // ear-shaped fins along both hull edges (pointing forward, like a cat's ears)
  for (const [x0, dir] of [[L, -1], [R, 1]] as [number, number][]) every(z, 128, 40, y => {
    for (let j = 0; j < 56; j++) { const out = Math.round(Math.min(j, 56 - j * 0.6) * 0.75); if (out <= 0) continue; const xa = dir > 0 ? x0 : x0 - out; p.r('0', xa - 1, y - 56 + j, out + 2, 1); p.r('v', xa, y - 56 + j, out, 1); const inner = Math.round(out * 0.45); if (j > 10 && inner > 1) p.r('e', dir > 0 ? x0 + 3 : x0 - 3 - inner, y - 56 + j, inner, 1); }
  });
  p.r('u', L, 0, 1, SEG); p.r('u', R - 1, 0, 1, SEG);
  yarnCable(p, 118, z); yarnCable(p, 330, z);
  if (z.s % 3 === 0) {
    const cx = 224, cy = 128;
    p.ell('0', cx, cy + 6, 46, 36); p.ell('1', cx, cy + 6, 44, 34);
    for (const sx of [-1, 1]) for (let j = 0; j < 30; j++) { const w = Math.round(j * 0.7); p.r('0', cx + sx * 30 - w - 1, cy - 50 + j, w * 2 + 3, 1); p.r('1', cx + sx * 30 - w, cy - 50 + j, w * 2 + 1, 1); if (j > 8) p.r('e', cx + sx * 30 - Math.round(w * 0.4), cy - 50 + j, Math.round(w * 0.8) + 1, 1); }
    p.ell('u', cx, cy + 6, 38, 28); p.ell('v', cx, cy + 8, 35, 25); p.ell('2', cx - 6, cy, 16, 8); p.ell('v', cx, cy + 10, 30, 20);
    catEye(p, cx - 16, cy + 2); catEye(p, cx + 16, cy + 2);
    p.r('0', cx - 4, cy + 13, 8, 4); p.r('d', cx - 3, cy + 13, 6, 3); for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) p.r('2', sx > 0 ? cx + 12 : cx - 32, cy + 16 + i * 4, 20, 1);
  } else {
    pawHatch(p, r.int(170, 200), 70);
    pawHatch(p, r.int(250, 280), 190);
  }
  // rows of cat-eye portholes beside the conduits
  every(z, 96, 20, y => { if (y > 8 && y < SEG - 8) { catEye(p, 96, y); catEye(p, 352, y); } });
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
  backyard: { id: 'backyard', speed: 0.4, base: 'k', main: backyard, fg: yardFg(['1', 'k', 'j'], 0.6, 0.1) },
  street: { id: 'street', speed: 0.6, base: 'v', main: street, fg: yardFg(['1', 'k', 'j'], 0.7, 0.12), ramps: { night: NIGHT_PAVED }, anim: steamAnim(188, 300, 120) },
  park: { id: 'park', speed: 0.45, base: 'k', main: park, fg: yardFg(['1', 'k', 'j'], 0.5, 0) },
  alley: { id: 'alley', speed: 0.5, base: 'v', ramps: { night: NIGHT_PAVED }, main: alley, fg: laundryFg, anim: steamAnim(262, 280, 60) },
  rooftops: { id: 'rooftops', speed: 0.55, base: '1', far: cityBelow, main: rooftops, fg: pigeonsFg },
  cafe: { id: 'cafe', speed: 0.4, base: 'v', indoor: true, main: cafe, fg: pendantsFg },
  docks: { id: 'docks', speed: 0.5, base: 'n', ramps: { dusk: ramp('n:v 2:e m:e', TOD_RAMP.dusk) }, far: water, main: docks, fg: gullsFg,
    fxAfter: 'far', fx: (ctx, scroll, t, _s, tod) => {
      // slow swells: a few ripple marks drift sideways and breathe on the water, under the piers and boats
      const [k0, k1] = tod === 'night' ? ['2', '3'] : tod === 'dusk' ? ['e', 'u'] : ['m', '4'];
      for (let i = 0; i < 9; i++) {
        const ph = (t / 110 + i * 0.37) % 1; const x = 112 + ((i * 97) % 320) + Math.round(Math.sin(t / 70 + i) * 6), y = Math.floor((i * 71 + scroll * 0.72) % 380) - 10;
        const len = Math.round(2 + Math.sin(ph * Math.PI) * 7); ctx.fillStyle = col(ph < 0.5 ? k0 : k1); ctx.fillRect(x - (len >> 1), y, len, 1);
      }
    } },
  factory: { id: 'factory', speed: 0.6, base: '1', far: factoryFar, main: factory, fg: girdersFg, fx: factoryFx, rim: false,
    ramps: { night: ramp('q:q2/6 p:q o:p 1:1 v:1 7:8 6:5 5:4 4:3 3:2 9:a 8:9') } },
  sky: { id: 'sky', speed: 0.8, base: 'n', backdrop: skyBackdrop, rim: false, far: skyFar, main: skyMain, fg: wispsFg, ramps: SKY_RAMPS },
  nebula: { id: 'nebula', speed: 0.7, space: true, base: '0', far: starFar('0', 80), main: nebulaMain, fg: streaksFg, anim: twinkle(['4', 't', 'l']) },
  moon: { id: 'moon', speed: 0.35, space: true, base: 'q', ramps: { dusk: ramp('o:8 5:c 4:t 6:7 9:h 7:8'), night: ramp('o:p 5:4 6:5 4:3 3:2 8:9 7:8 9:a') }, main: moon, fg: moonFg },
  station: { id: 'station', speed: 0.5, space: true, base: '0', far: starFar('0', 90), main: station, anim: both(twinkle(['4', 'l']), earLights) },
  mothership: { id: 'mothership', speed: 0.7, space: true, base: '0', far: motherFar, main: mothership, anim: navLights([74, 374], 96, ['r', 'l', 'd']) },
};
TILESETS.space = TILESETS.nebula;
