// World tilesets: each area is a stack of parallax layers (far / main / fg).
// Each layer is painted in 448x256 segments (8 rows of 32px tiles) by a seeded
// painter, then cached per time-of-day. Backgrounds are authored in dark,
// low-noise, mostly neutral mid-tones with a guaranteed value gap from the
// darkest cat colours (indigo / dark brown bodies with ink outlines), so cats,
// turds and hairballs pop (Galaga readability).
import { Rng } from '../core/rng';
import { col, KEY } from '../core/palette';
import type { Tod } from '../core/types';
import { Painter, spans, bayer, ramp, TOD_RAMP, type Ramp } from './paint';
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
function lamp(p: Painter, x: number, y: number, r = 40, clip?: [number, number, number, number], spill = false) {
  p.shRect(x - 1, y - 1, 3, 3, 14);
  p.obj(() => { p.disc('0', x + 0.5, y + 0.5, 3); p.disc('p', x + 0.5, y + 0.5, 2); p.glow('q', 'f', x, y, 1, 1); p.glow('o', '7', x - 1, y - 1, 1, 1); });
  p.pool(x, y + 2, r, clip, spill);
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
    // gunwale rim: a lit 1px edge down the hull's west side, so the silhouette holds against dark water at night
    for (let j = 2; j < len - 2; j++) { const t = bowUp ? j / len : 1 - j / len; const taper = t < 0.32 ? Math.sqrt(t / 0.32) : 1; const hw = Math.max(1, Math.round((w / 2 - 1) * taper)); p.r('o', x + Math.round(w / 2) - hw, y + j, 1, 1); }
    // riding lanterns at bow and stern (lit after dusk) with a dark mount
    const by = bowUp ? y + 6 : y + len - 8, sy2 = bowUp ? y + len - 5 : y + 3, mx = x + Math.round(w / 2) - 1;
    p.r('0', mx - 1, by - 1, 4, 4); p.glow('q', 'f', mx, by, 2, 2, 1, 0); p.r('0', mx - 1, sy2 - 1, 4, 3); p.glow('q', '7', mx, sy2, 2, 1, 1, 0);
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
    // roof: lit left plane, shaded right plane, shingle courses, ridge cap (muted brick so it never competes with the cats)
    p.r('0', x - 2, y - 1, w + 4, rh + 1);
    p.r('a', x - 1, y, w / 2 + 1, rh); p.r('b', x + w / 2, y, w / 2 + 1, rh);
    for (let j = 3; j < rh; j += 4) { p.r('b', x - 1, y + j, w / 2, 1); p.r('v', x + w / 2 + 1, y + j, w / 2, 1); for (let i = (j >> 2) % 2 ? 2 : 6; i < w; i += 8) p.r(i < w / 2 ? 'b' : 'v', x + i, y + j - 3, 1, 3); }
    p.r('9', x - 1, y, w / 2, 1);
    p.r('9', x + w / 2 - 1, y, 1, rh); p.r('0', x + w / 2, y, 1, rh); // ridge: highlight + crease
    p.r('0', x - 2, y + rh - 1, w + 4, 1);
    // name plate over the door: cream board with three dark letter blocks
    p.r('0', x + 11, y + rh - 3, 14, 5); p.r('7', x + 12, y + rh - 2, 12, 3);
    p.r('b', x + 13, y + rh - 1, 2, 1); p.r('b', x + 17, y + rh - 1, 2, 1); p.r('b', x + 21, y + rh - 1, 2, 1);
    // little lantern by the door: warm after dusk
    p.r('0', x + 3, y + rh + 1, 6, 6); p.glow('b', 'f', x + 4, y + rh + 2, 4, 4, 1, 0.5);
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
/**
 * Wooden plank fence running up the screen, seen from above: a 6px strip of
 * board tops (each board 4px long, lit on the left, dark gaps between), posts
 * every 32px with caps, and the odd missing board a small dog could squeeze through.
 */
function fenceV(p: Painter, x: number, y0: number, y1: number, rng?: Rng) {
  const gaps: number[] = []; if (rng) for (let y = y0 + 40; y < y1 - 30; y += rng.int(70, 120)) gaps.push(y);
  const runs: [number, number][] = []; let a = y0; for (const g of gaps) { runs.push([a, g]); a = g + 8; } runs.push([a, y1]);
  for (const [a0, a1] of runs) p.shRect(x, a0, 6, a1 - a0, 12);
  p.obj(() => {
    for (const [a0, a1] of runs) {
      p.r('0', x - 1, a0, 8, a1 - a0);
      for (let y = a0; y < a1; y += 5) { const h = Math.min(4, a1 - y); p.r('a', x, y, 6, h); p.r('9', x, y, 2, h); p.r('b', x + 5, y, 1, h); }
    }
    for (let y = y0 + 14; y < y1; y += 32) { p.r('0', x - 2, y, 10, 6); p.r('b', x - 1, y + 1, 8, 4); p.r('a', x - 1, y + 1, 8, 1); }
    for (const g of gaps) { p.r('b', x, g + 2, 6, 1); p.r('v', x + 1, g + 5, 4, 1); }
  });
}
/** Plank fence running across the screen, seen in 3/4: a face of vertical boards with dark gaps under a top rail. */
function fenceH(p: Painter, x0: number, x1: number, y: number) {
  p.shRect(x0, y, x1 - x0, 10, 12);
  p.obj(() => {
    p.r('0', x0, y - 1, x1 - x0, 12);
    for (let x = x0; x < x1; x += 5) { p.r('a', x, y + 2, 4, 8); p.r('9', x, y + 2, 1, 8); p.r('b', x, y + 8, 4, 2); }
    p.r('b', x0, y, x1 - x0, 2); p.r('9', x0, y, x1 - x0, 1);
    for (let x = x0 + 6; x < x1; x += 32) { p.r('0', x - 1, y - 2, 6, 13); p.r('a', x, y - 1, 4, 11); p.r('9', x, y - 1, 1, 11); }
  });
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
  // (the opening segment keeps the spawn column low and flat: Pom's doghouse sits in the left lot there, the middle lot is open lawn)
  const hero = z.s === 0 ? 'yard' : ['dog', 'pool', 'patio', 'clothes', 'dog', 'garden'][z.s % 6];
  const side = ['clothes', 'yard', 'garden', 'patio', 'yard', 'clothes'];
  for (let i = side.length - 1; i > 0; i--) { const j = r.int(0, i); [side[i], side[j]] = [side[j], side[i]]; }
  if (z.s === 0) side[0] = 'dog';
  lots.forEach(([x0, x1], li) => {
    const kind = li === 1 ? hero : side[li];
    const cx = (x0 + x1) >> 1, y0 = top + 14, y1 = SEG - 8;
    border(p, li === 2 ? x1 - 12 : li === 1 ? x0 + 4 : x0, top + 2, 10, SEG - top - 2, r);
    if (kind !== 'patio' && kind !== 'pool') { let y = y0 + r.int(4, 16); const sx0 = cx + r.int(-30, 30); while (y < y1 - 8) { const sx = sx0 + Math.round(Math.sin((z.wy(y) + li * 50) / r.int(30, 60)) * 18) + r.int(-5, 5); const rx = r.int(4, 7), ry = r.int(3, 4); if (!r.chance(0.15)) { p.ell('0', sx, y + 3, rx + 1, ry + 1); p.ell('q', sx, y + 3, rx, ry); p.r('p', sx - rx + 2, y + 3 - ry + 1, rx, 1); } y += r.int(16, 28); } }
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
  if (top) { // the brownstone's back stoop: iron-railed steps down into the middle yard
    const sx = 206, sy = top - 18; p.shRect(sx, sy, 26, 24, 10);
    p.obj(() => { p.r('0', sx - 1, sy - 1, 28, 26); for (let i = 0; i < 6; i++) { p.r(i % 2 ? '9' : '8', sx, sy + i * 4, 26, 3); p.r('a', sx, sy + i * 4 + 3, 26, 1); } p.r('0', sx - 1, sy - 2, 2, 27); p.r('0', sx + 25, sy - 2, 2, 27); p.r('q', sx - 1, sy - 2, 1, 27); p.r('q', sx + 25, sy - 2, 1, 27); });
  }
} };
/** fast foreground: overhanging trees, the odd branch and utility wires */
/**
 * Overhanging trees close to the camera. They stay at the very edges of the world (a canopy reaches at most ~36px in,
 * a branch ~60px), so they frame the playfield and never sit under Pom's flight lane as a dark blot.
 */
const yardFg = (keys = ['1', 'k', 'j'], density = 0.6, wireChance = 0.1): LayerDef => ({ speed: 1.4, paint(p, z) {
  const r = z.r;
  if (r.chance(density)) { const rr = r.int(28, 38), reach = Math.ceil(rr * 1.05), off = r.int(0, 20); canopy(p, r.chance(0.5) ? 36 - reach - off : SW - 36 + reach + off, r.int(50, 200), rr, r, keys); }
  if (r.chance(density * 0.35)) branch(p, r.chance(0.5), r.int(30, 220), r.int(36, 60), r);
  if (r.chance(wireChance)) wires(p, r.int(30, 220), r);
} });

// ---------------------------------------------------------------- STREET
const street: LayerDef = { speed: 1, opaque: true, paint(p, z) {
  const r = z.r; const cross = z.s % 4 === 3; const cy0 = 150, cy1 = 230;
  p.r('v', 0, 0, SW, SEG);
  // tar patches: a slightly darker slab with a 1px lighter sealed seam, so they read as repairs, not missing tiles
  for (let i = 0; i < 3; i++) { const x = r.int(130, 290), y = r.int(0, SEG - 30), w = r.int(14, 30), h = r.int(8, 20); p.r('q', x - 1, y - 1, w + 2, h + 2); p.r('1', x, y, w, h); p.r('v', x + 2, y + 2, w - 4, 1); }
  // tar-sealed cracks
  for (let i = 0; i < 3; i++) { let cx = r.int(140, 300), cy = r.int(0, SEG - 20); for (let k = 0; k < 5; k++) { const nx = cx + r.int(-4, 4), ny = cy + r.int(3, 6); p.line('1', cx, cy, nx, ny); cx = nx; cy = ny; } }
  // lane arrows (faded paint)
  if (r.chance(0.5)) { const ax = r.chance(0.5) ? 172 : 262, ay = r.int(20, 200), down = ax > 224; for (let j = 0; j < 14; j++) p.r('p', ax + 2, ay + j, 2, 1); for (let j = 0; j < 5; j++) p.r('p', ax + 3 - j, down ? ay + 14 + j - 4 : ay + j, 1 + j * 2 - 0, 1); }
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
        // brownstone roof detail: party-wall parapet, a pair of brick chimneys at the back, a roof hatch
        const back = side ? bx + 46 : bx + 6; const chy = y + 6;
        p.shRect(back, chy, 12, 8, 14);
        p.obj(() => { p.r('0', bx, y, 64, 2); p.r('p', bx + 1, y, 62, 1);
          p.r('0', back, chy, 12, 8); p.r('a', back + 1, chy + 1, 10, 6); p.r('9', back + 1, chy + 1, 10, 1); p.r('b', back + 1, chy + 4, 10, 1); p.r('0', back + 2, chy + 2, 3, 2); p.r('0', back + 7, chy + 2, 3, 2); });
        if (hh >= 56) { const hx = side ? bx + 12 : bx + 40, hy = y + hh - 18; p.shRect(hx, hy, 10, 10, 6); p.obj(() => { p.r('0', hx, hy, 10, 10); p.r('p', hx + 1, hy + 1, 8, 8); p.r('o', hx + 1, hy + 1, 8, 1); p.r('q', hx + 2, hy + 4, 6, 1); }); }
        const stx = side ? 384 - 14 : 64;
        if (hh >= 40) { p.shRect(stx, y + 22, 14, 18, 4); p.obj(() => { p.r('0', stx, y + 22, 14, 18); for (let i = 0; i < 5; i++) p.r(i % 2 ? 'a' : '9', side ? stx + 3 + i * 2 : stx + 1 + (4 - i) * 2, y + 23, 2, 16); p.r('0', stx, y + 22, 14, 1); }); }
      }
      for (let y = a + 20; y < b - 20; y += 64) { const tx = side ? sx + 34 : sx + 10; p.r('0', tx - 1, y - 1, 14, 14); p.r('b', tx, y, 12, 12); p.r('a', tx + 3, y + 3, 6, 6);
        // a street tree over every other pit, in the main layer (always under the actors), canopy kept over the sidewalk
        if ((Math.round((y - a - 20) / 64) + side + z.s) % 2 === 0) { const cx = tx + 6, cy = y + 6, rr = r.int(14, 17); p.shEll(cx, cy, rr * 0.8, rr * 0.7, 18); const seed = r.int(0, 1e6); p.obj(() => canopy(p, cx, cy, rr, new Rng(seed))); } }
      if (b - a > 100) lamp(p, side ? sx + 6 : sx + 48, a + 54, 44);
      if (r.chance(0.5) && b - a > 120) { const hx = side ? sx + 8 : sx + 44, hy = a + r.int(90, b - a - 10); p.shEll(hx, hy, 3, 3, 6); p.obj(() => { p.disc('0', hx, hy, 4); p.disc('h', hx, hy, 3); p.r('8', hx - 1, hy - 2, 1, 1); }); }
      if (r.chance(0.4) && b - a > 120) { const mx = side ? sx + 12 : sx + 36, my = a + r.int(110, b - a - 20); p.shRect(mx, my, 10, 12, 10); p.obj(() => { p.r('0', mx, my, 10, 12); p.r('n', mx + 1, my + 1, 8, 10); p.r('m', mx + 1, my + 1, 8, 2); }); }
    }
  }
  for (const [a, b] of segs) for (const lane of [124, 302]) for (let y = a + 6; y + 46 < b; y += 52) if (r.chance(0.55)) car(p, lane, y + r.int(0, 4), r.pick(['n', 'b', '3', 'a', 'p', 'q', '2']), lane > 200);
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
/** weave poles: 12 upright poles on a low base rail, alternating white / muted orange, each with its own cast shadow */
function weavePoles(p: Painter, x: number, y: number) {
  const n = 12, gap = 9;
  p.shRect(x - 1, y, 6, n * gap + 2, 2);
  p.obj(() => { p.r('0', x - 1, y, 6, n * gap + 2); p.r('p', x, y + 1, 4, n * gap); p.r('o', x, y + 1, 1, n * gap); });
  for (let i = 0; i < n; i++) { const yy = y + 2 + i * gap; p.shRect(x, yy, 4, 4, 16); p.obj(() => { p.r('0', x - 1, yy - 1, 6, 6); p.r(i % 2 ? 'h' : '7', x, yy, 4, 4); p.r(i % 2 ? 'a' : 'o', x + 2, yy + 2, 2, 2); p.r(i % 2 ? 'g' : '6', x, yy, 1, 1); }); }
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
/** lawn: flat dark green with scattered tufts (no mowing stripes: the band behind the formation stays calm) */
function lawn(p: Painter, z: Seg) {
  p.r('k', 0, 0, SW, SEG);
  // mown stripes: every other 40px band (world-spaced) carries a sparse regular grid of lighter blade tips
  for (let i = 0; i < 40; i++) tuft(p, z.r.chance(0.6) ? 'j' : '1', z.r.int(4, SW - 8), z.r.int(2, SEG - 2));
}
const DARK_CANOPY = ['0', '1', 'k'];
/** a shade tree inside the park: canopy over a long cast shadow (so low sun reads on the lawn) */
function parkTree(p: Painter, cx: number, cy: number, rr: number, r: Rng) {
  p.shEll(cx, cy, rr * 0.8, rr * 0.7, 26);
  const seed = r.int(0, 1e6); p.obj(() => canopy(p, cx, cy, rr, new Rng(seed)));
}
/** gingham picnic blanket with a wicker basket, a sandwich and a forgotten squeaky bone */
function picnic(p: Painter, x: number, y: number) {
  const w = 34, h = 26;
  p.obj(() => {
    p.r('0', x - 1, y - 1, w + 2, h + 2);
    for (let j = 0; j < h; j += 4) for (let i = 0; i < w; i += 4) p.r(((i + j) >> 2) & 1 ? '7' : (j >> 2) & 1 ? 'e' : 'r', x + i, y + j, Math.min(4, w - i), Math.min(4, h - j));
    p.r('0', x + 4, y + 4, 13, 10); p.r('a', x + 5, y + 5, 11, 8); p.r('9', x + 5, y + 5, 11, 1); for (let i = x + 6; i < x + 15; i += 2) p.r('b', i, y + 7, 1, 5); p.r('0', x + 7, y + 3, 7, 1);
    p.r('0', x + 21, y + 14, 8, 7); p.r('8', x + 22, y + 15, 6, 5); p.r('j', x + 22, y + 17, 6, 1);
    p.r('7', x + 22, y + 6, 6, 2); p.r('7', x + 21, y + 5, 2, 1); p.r('7', x + 21, y + 8, 2, 1); p.r('7', x + 27, y + 5, 2, 1); p.r('7', x + 27, y + 8, 2, 1);
  });
}
/** dog-bag station by the path: a post with a green dispenser and a little bin */
function bagStation(p: Painter, x: number, y: number) {
  p.shRect(x, y, 4, 4, 18);
  p.obj(() => { p.r('0', x - 1, y - 1, 6, 6); p.r('p', x, y, 4, 4); p.r('0', x - 3, y + 6, 10, 8); p.r('k', x - 2, y + 7, 8, 6); p.r('j', x - 2, y + 7, 8, 1); p.r('7', x, y + 10, 4, 2); bin(p, x + 14, y + 8, 'k'); });
}
/** a few low lawn details: daisy clusters, clover, a dropped tennis ball or frisbee (tiny, so the lawn stays calm) */
function lawnBits(p: Painter, x0: number, x1: number, r: Rng) {
  for (let i = 0; i < 3; i++) { const cx = r.int(x0, x1), cy = r.int(8, SEG - 8); for (let k = 0; k < 5; k++) { const x = cx + r.int(-7, 7), y = cy + r.int(-4, 4); p.r('7', x, y, 1, 1); p.r('7', x - 1, y + 1, 3, 0 + 1); p.r('f', x, y + 1, 1, 1); } }
  for (let i = 0; i < 2; i++) { const cx = r.int(x0, x1), cy = r.int(8, SEG - 8); for (let k = 0; k < 4; k++) p.r('j', cx + r.int(-6, 6), cy + r.int(-3, 3), 2, 2); }
  if (r.chance(0.5)) { const x = r.int(x0, x1), y = r.int(10, SEG - 10); p.shEll(x, y, 2, 2, 3); p.obj(() => { p.disc('0', x, y, 3); p.disc('i', x, y, 2); p.r('7', x - 1, y - 1, 1, 1); }); }
  else { const x = r.int(x0, x1), y = r.int(10, SEG - 10); p.shEll(x, y, 5, 4, 3); p.obj(() => { p.ell('0', x, y, 6, 5); p.ell('d', x, y, 5, 4); p.ring('e', x, y, 3, 2, 1); p.r('c', x - 3, y - 3, 2, 1); }); }
}
/** fallen leaves under a tree: a scatter of 2px warm leaves, thinning out with distance */
function leafLitter(p: Painter, cx: number, cy: number, rr: number, r: Rng) {
  for (let i = 0; i < 22; i++) { const a = r.range(0, 6.28), d = rr * Math.sqrt(r.next()); const x = Math.round(cx + Math.cos(a) * d + 8), y = Math.round(cy + Math.sin(a) * d * 0.8 + 6); p.r(r.pick(['h', 'a', 'g', '9']), x, y, 2, 1); if (r.chance(0.4)) p.r('b', x, y + 1, 1, 1); }
}
/** a patch where a dog has been digging: churned soil, a dirt spray and a half-buried bone */
function digPatch(p: Painter, x: number, y: number, r: Rng) {
  p.ell('b', x, y, 8, 5); p.ell('a', x - 1, y - 1, 6, 3); p.ell('1', x + 1, y + 1, 3, 2);
  for (let i = 0; i < 7; i++) p.r(r.pick(['a', 'b']), x + r.int(-14, 14), y + r.int(-8, 8), 1, 1);
  p.r('0', x + 3, y - 3, 8, 3); p.r('7', x + 4, y - 2, 6, 1); p.r('7', x + 9, y - 3, 2, 1); p.r('7', x + 9, y - 1, 2, 1);
}
/** a red fire hydrant by the path (a dog park essential), with its little shadow */
function hydrant(p: Painter, x: number, y: number) {
  p.shEll(x, y, 4, 4, 10);
  p.obj(() => { p.disc('0', x, y, 5); p.disc('r', x, y, 4); p.disc('h', x + 1, y + 1, 2); p.r('c', x - 2, y - 3, 2, 1); p.r('0', x - 7, y - 1, 3, 3); p.r('o', x - 7, y, 2, 1); p.r('0', x + 5, y - 1, 3, 3); p.r('o', x + 6, y, 2, 1); p.disc('0', x, y, 1.5); p.r('o', x, y, 1, 1); });
}
/** clipped box hedge with a poodle topiary on top (the park keeper is a fan) */
function topiary(p: Painter, x: number, y: number) {
  p.shRect(x, y, 30, 12, 10);
  p.obj(() => {
    p.r('0', x - 1, y - 1, 32, 14); p.r('k', x, y, 30, 12); p.r('j', x, y, 30, 2); p.r('1', x, y + 10, 30, 2);
    for (let i = 3; i < 30; i += 6) p.r('j', x + i, y + 4, 2, 1);
    // poodle: pom-pom head, ears, body puff and tail puff, clipped round
    const dx = x + 15, dy = y + 4;
    for (const [ox, oy, rr] of [[-8, 0, 4], [0, 1, 5], [8, -1, 3], [-11, -3, 2], [10, -5, 2]] as [number, number, number][]) { p.disc('0', dx + ox, dy + oy, rr + 1); }
    for (const [ox, oy, rr] of [[-8, 0, 4], [0, 1, 5], [8, -1, 3], [-11, -3, 2], [10, -5, 2]] as [number, number, number][]) { p.disc('k', dx + ox, dy + oy, rr); p.r('j', dx + ox - 1, dy + oy - rr + 1, 2, 1); }
  });
}
/** small specific park life: digging patches, a hydrant by the path, a topiary, a forgotten leash */
function parkLife(p: Painter, z: Seg, px: (y: number) => number, r: Rng, kL: number, kR: number) {
  every(z, 288, 150, y => { if (y > 10 && y < SEG - 10) hydrant(p, px(y) - 24, y); });
  { const left = r.chance(0.5), kind = left ? kL : kR; if (z.s % 3 === 1 && kind !== 4 && kind !== 7 && kind !== 3) topiary(p, left ? 34 : 384, r.int(30, 200)); }
  if (r.chance(0.5)) { const x = r.int(170, 270), y = r.int(30, SEG - 30); p.obj(() => { for (let i = 0; i < 18; i++) p.r('d', x + i, y + Math.round(Math.sin(i / 3) * 2), 1, 1); p.r('0', x + 17, y - 2, 4, 4); p.r('o', x + 18, y - 1, 2, 2); }); } // a dropped leash
}
/** a round flower bed: dark soil inside a clipped box-hedge ring, rows of blooms with leaves */
function flowerBed(p: Painter, cx: number, cy: number, rx: number, ry: number, r: Rng) {
  p.shEll(cx, cy, rx, ry, 4);
  p.obj(() => {
    p.ell('0', cx, cy, rx + 1, ry + 1); p.ell('k', cx, cy, rx, ry); p.ell('j', cx - 1, cy - 1, rx - 1, ry - 1); p.ell('k', cx, cy, rx - 2, ry - 2);
    p.ell('b', cx, cy, rx - 4, ry - 4); p.ell('a', cx - 1, cy - 1, rx - 6, ry - 6); p.ell('b', cx, cy, rx - 7, ry - 7);
    const keys = [r.pick(['d', 'c', 't']), r.pick(['f', '7', 'g'])];
    for (let j = -ry + 6; j <= ry - 6; j += 4) { const hw = Math.floor((rx - 6) * Math.sqrt(1 - (j / (ry - 3)) ** 2)); for (let i = -hw + 2; i <= hw - 2; i += 4) { const k = keys[((i + j) >> 2) & 1]; p.r('k', cx + i, cy + j + 1, 2, 1); p.r(k, cx + i, cy + j, 2, 1); p.r(k === 'd' ? 'c' : k === 'f' ? '7' : k, cx + i, cy + j, 1, 1); } }
  });
}
/** the dog fountain: a round stone basin with a stone poodle in the middle spouting water from its mouth */
function dogFountain(p: Painter, cx: number, cy: number) {
  p.shEll(cx, cy, 24, 18, 8);
  p.obj(() => {
    p.ell('0', cx, cy, 25, 19); p.ell('p', cx, cy, 24, 18); p.ell('o', cx - 1, cy - 1, 22, 16); p.ell('p', cx, cy, 21, 15);
    p.ell('0', cx, cy, 19, 13); p.ell('n', cx, cy, 18, 12); p.ell('2', cx + 3, cy + 3, 14, 8); p.ell('n', cx - 1, cy - 1, 12, 7);
    p.ring('m', cx, cy, 10, 7, 1); p.r('s', cx - 12, cy - 6, 3, 1); p.r('m', cx + 8, cy + 6, 4, 1);
    // plinth + stone poodle seen from above: body puff, pom-pom head, ears, tail pom
    p.disc('0', cx, cy, 6); p.disc('q', cx, cy, 5); p.disc('p', cx - 1, cy - 1, 4);
    for (const [ox, oy, rr] of [[0, 1, 3.5], [0, -5, 3], [-3, -6, 1.5], [3, -6, 1.5], [0, 5, 1.5]] as [number, number, number][]) p.disc('0', cx + ox, cy + oy, rr + 1);
    for (const [ox, oy, rr] of [[0, 1, 3.5], [0, -5, 3], [-3, -6, 1.5], [3, -6, 1.5], [0, 5, 1.5]] as [number, number, number][]) { p.disc('o', cx + ox, cy + oy, rr); p.r('7', cx + ox - 1, cy + oy - 1, 1, 1); }
    p.r('s', cx, cy - 10, 1, 2); p.r('m', cx - 1, cy - 12, 3, 1); p.r('s', cx, cy - 13, 1, 1); // the spout arcing out into the basin
  });
}
/** a stone dog water bowl on a little paved square (a tiny landmark on the open lawn) */
function hydrantBowl(p: Painter, cx: number, cy: number) {
  p.shEll(cx, cy, 6, 5, 4);
  p.obj(() => { p.r('0', cx - 9, cy - 8, 18, 16); p.r('p', cx - 8, cy - 7, 16, 14); p.r('o', cx - 8, cy - 7, 16, 1); p.r('q', cx, cy - 7, 1, 14); p.r('q', cx - 8, cy, 16, 1);
    p.ell('0', cx, cy, 6, 5); p.ell('o', cx, cy, 5, 4); p.ell('n', cx, cy, 3.5, 2.5); p.r('m', cx - 2, cy - 1, 2, 1); p.r('s', cx + 1, cy, 1, 1); });
}
/** a muted picnic blanket (plaid in two calm tones) with a water bowl and a chew toy, for the open lawn */
function lawnBlanket(p: Painter, x: number, y: number, r: Rng) {
  const w = 30, h = 22; const [a, b] = r.pick([['n', '2'], ['e', 'v'], ['a', 'b']]);
  p.obj(() => {
    p.r('0', x - 1, y - 1, w + 2, h + 2); p.r(a, x, y, w, h);
    for (let i = 3; i < w; i += 7) p.r(b, x + i, y, 2, h); for (let j = 3; j < h; j += 7) p.r(b, x, y + j, w, 2);
    p.r('7', x, y, w, 1); p.disc('0', x + 22, y + 15, 3.5); p.disc('p', x + 22, y + 15, 2.5); p.disc('n', x + 22, y + 15, 1.5);
    p.r('0', x + 5, y + 12, 9, 4); p.r('7', x + 6, y + 13, 7, 2); p.r('7', x + 5, y + 12, 2, 1); p.r('7', x + 12, y + 12, 2, 1); p.r('7', x + 5, y + 15, 2, 1); p.r('7', x + 12, y + 15, 2, 1);
  });
}
/** a low agility ramp (dog walk plank) lying across the lawn */
function dogWalk(p: Painter, x: number, y: number) {
  const w = 12, h = 70;
  p.shRect(x, y, w, h, 10);
  p.obj(() => { p.r('0', x - 1, y - 1, w + 2, h + 2); p.r('n', x, y, w, h); p.r('h', x, y, w, 14); p.r('h', x, y + h - 14, w, 14); for (let j = 4; j < h; j += 5) p.r(j < 14 || j > h - 14 ? 'a' : '2', x + 1, y + j, w - 2, 1); p.r('m', x, y + 14, w, 1); p.r('m', x, y + h - 15, w, 1); for (const ly of [y + 20, y + h - 22]) { p.r('0', x - 3, ly, 3, 3); p.r('0', x + w, ly, 3, 3); } });
}
/** park bench facing the path + a bin, for the edge strips */
function parkEdge(p: Painter, kind: number, x0: number, right: boolean, r: Rng) {
  // x0 = inner edge of the strip; props stay in x0-100 .. x0 (left) or x0 .. x0+100 (right)
  const X = (dx: number, w = 0) => right ? x0 + dx : x0 - dx - w;
  switch (kind) {
    case 0: aFrame(p, X(24, 34), 70); break;
    case 1: weavePoles(p, X(30, 4), 40); weavePoles(p, X(56, 4), 120); break;
    case 2: tireJump(p, X(14, 48), 60); tireJump(p, X(20, 48), 170); break;
    case 3: tunnel(p, X(48), 30, 170); break;
    case 4: pen(p, X(6, 92), 30, 92, 170, r); break;
    case 5: fountain(p, X(40), 70); bench(p, X(16, 36), 130, false); bench(p, X(16, 36), 190, false); bin(p, X(70), 160); break;
    case 7: pond(p, X(56), 128, r); bench(p, X(30, 36), 196, false); break;
    case 8: picnic(p, X(36, 34), 40); parkTree(p, X(64), 176, 28, r); bagStation(p, X(14, 4), 222); break;
    default: canopy(p, X(48), r.int(60, 190), r.int(26, 34), r, DARK_CANOPY); bench(p, X(8, 12), 40, true);
  }
}
const park: LayerDef = { speed: 1, opaque: true, paint(p, z) {
  const r = z.r; p.poolScale = 0.8;
  lawn(p, z);
  // gravel path: runs along one edge strip, crossing the lawn once in a while (keeps the centre open)
  const px = (y: number) => 224 + Math.round(Math.sin(z.wy(y) / 230) * 56 + Math.sin(z.wy(y) / 71) * 6);
  for (let y = 0; y < SEG; y++) { const x = px(y); p.r('1', x - 13, y, 27, 1); p.r('q', x - 11, y, 23, 1); if ((y + z.s) % 6 === 0) p.r('p', x - 8 + ((y * 7) % 16), y, 1, 1); }
  for (let i = 0; i < 6; i++) { const y = 20 + i * 36, x = px(y) + (i % 2 ? 4 : -6); p.r('v', x, y, 3, 3); p.r('v', x - 2, y - 3, 1, 1); p.r('v', x + 1, y - 4, 1, 1); p.r('v', x + 4, y - 3, 1, 1); }
  // perimeter fence of the park
  for (const fx of [26, 420]) { p.shRect(fx, 0, 3, SEG, 8); p.obj(() => { p.r('0', fx, 0, 3, SEG); p.r('p', fx + 1, 0, 1, SEG); for (let y = 0; y < SEG; y += 32) { p.r('0', fx - 1, y, 5, 5); p.r('o', fx, y + 1, 3, 3); } }); }
  // dark-canopy trees outside the fence
  for (const tx of [4, 444]) canopy(p, tx, r.int(40, 210), r.int(24, 32), r, DARK_CANOPY);
  // agility kit and park furniture on the edge strips only; the path side gets furniture, the other side agility gear
  const kL = (z.s + (z.seed % 9)) % 9, kR = (z.s * 3 + 2 + (z.seed % 5)) % 9;
  lawnBits(p, 40, 150, r); lawnBits(p, 300, 410, r);
  for (let i = 0; i < 2; i++) digPatch(p, i ? r.int(316, 404) : r.int(44, 132), r.int(24, SEG - 24), r); // under the kit, so props cover it
  parkEdge(p, kL, 140, false, r); parkEdge(p, kR === kL ? (kR + 4) % 9 : kR, 308, true, r);
  // shade trees just inside the fence, at the far ends of the edge strips (never on a side holding the picnic or the pen)
  { const left = r.chance(0.5), kind = left ? kL : kR, top = r.chance(0.5);
    if (r.chance(0.7) && kind !== 8 && kind !== 4) { const tx = left ? r.int(44, 60) : r.int(388, 404), ty = top ? r.int(14, 40) : r.int(200, 236); parkTree(p, tx, ty, r.int(18, 24), r); leafLitter(p, tx, ty, 34, r); } }
  parkLife(p, z, px, r, kL, kR === kL ? (kR + 4) % 9 : kR);
  // fill the free stretch of each edge strip: a flower bed, a blanket or a dog-walk plank where the kit leaves room
  const kR2 = kR === kL ? (kR + 4) % 9 : kR;
  for (const [kind, right] of [[kL, false], [kR2, true]] as [number, boolean][]) {
    const fx = right ? r.int(332, 380) : r.int(64, 110);
    if (kind === 0 || kind === 2) flowerBed(p, fx, 226, 24, 14, r);
    else if (kind === 1) lawnBlanket(p, fx - 16, 196, r);
    else if (kind === 7) flowerBed(p, fx, 40, 22, 13, r);
    else if (kind === 5) dogWalk(p, right ? 394 : 42, 150);
  }
  // the open lawn on the far side of the path gets one quiet feature per segment (the dog fountain, a bed or a blanket)
  // two features per segment (one in each half), cycling so the dog fountain and the flower beds come round often
  for (let h = 0; h < 2; h++) {
    const y = h ? r.int(150, 214) : r.int(36, 100), side = px(y) < 224 ? 1 : -1, x = Math.max(156, Math.min(292, px(y) + side * r.int(58, 74)));
    const k = (z.s * 2 + h + (z.seed % 4)) % 4;
    if (k === 0) dogFountain(p, x, y);
    else if (k === 1) { flowerBed(p, x - 14, y - 4, 18, 11, r); flowerBed(p, x + 22, y + 10, 14, 9, r); }
    else if (k === 2) { lawnBlanket(p, x - 15, y - 11, r); flowerBed(p, x + 34 * side, y + 14, 12, 8, r); }
    else { flowerBed(p, x, y, 22, 13, r); hydrantBowl(p, x + 30 * side, y - 8); }
  }
  // flower bed tucked against the fence
  if (r.chance(0.6)) { const fx = r.chance(0.5) ? 50 : 398, fy = r.int(30, 220); p.ell('0', fx, fy, 12, 8); p.ell('b', fx, fy, 11, 7); for (let k2 = 0; k2 < 10; k2++) { const a = r.range(0, 6.28), d = r.range(0, 1); p.r(r.pick(['d', '7', 't']), fx + Math.cos(a) * d * 8, fy + Math.sin(a) * d * 4, 1, 1); } }
  // lamps along the path (world-spaced), a bench, and paw prints in the gravel
  every(z, 192, 40, y => { if (y > -40 && y < SEG + 40) lamp(p, px(y) + 18, y, 30, undefined, true); });
  bench(p, px(60) + 18, 40, true);
  for (let y = 6, i = 0; y < SEG; y += 11, i++) if ((z.s + (y >> 6)) % 3 === 0) { const x = px(y) + (i % 2 ? 3 : -4); p.r('1', x, y + 1, 3, 2); p.r('1', x - 1, y - 1, 1, 1); p.r('1', x + 1, y - 2, 1, 1); p.r('1', x + 3, y - 1, 1, 1); }
} };
// ---------------------------------------------------------------- ALLEY
function dumpster(p: Painter, x: number, y: number) {
  p.shRect(x, y, 44, 26, 16);
  p.obj(() => { p.r('0', x - 1, y - 1, 46, 28); p.r('k', x, y, 44, 26); p.r('1', x, y + 12, 44, 2); p.r('j', x, y, 44, 1); p.r('j', x, y + 14, 44, 1); p.r('1', x + 21, y, 2, 26); p.r('q', x + 2, y + 2, 4, 2); p.r('q', x + 38, y + 2, 4, 2); });
}
/** black bin bags piled against a wall: grey plastic with a lit knot, never the dark navy of the cats */
function bags(p: Painter, x: number, y: number, rng: Rng) {
  for (let i = 0; i < 4; i++) { const bx = x + rng.int(0, 10), by = y + i * 8 + rng.int(0, 3), rr = rng.int(5, 6); p.shEll(bx, by, rr, rr, 4); p.obj(() => { p.disc('0', bx, by, rr + 1); p.disc('q', bx, by, rr); p.disc('p', bx - 2, by - 2, 2); p.r('o', bx - 3, by - 3, 1, 1); p.r('0', bx - 1, by - rr, 3, 2); p.r('p', bx, by - rr - 1, 1, 1); }); }
}
/** puddle: a filled pixel oval that mirrors the sky by day and the bodega neon after dark (hard bands, no strokes) */
function puddle(p: Painter, x: number, y: number, rng: Rng) {
  const rx = rng.int(12, 18), ry = rng.int(5, 7);
  p.ell('1', x, y, rx + 1, ry + 1); p.ell('n', x, y, rx, ry); p.ell('2', x + 2, y + 1, rx - 4, ry - 2);
  const k = rng.pick(['d', 'l']); const k2 = k === 'd' ? 'e' : 'm';
  spans(x - 2, y, rx * 0.6, ry * 0.6, (sx, sy, w) => { if (((sy - y) & 1) === 0) p.glow('2', sy < y ? k : k2, sx, sy, w, 1, 1, 0.5); });
  p.r('3', x - rx + 4, y - ry + 2, 4, 1);
}
/** sealed crack in the asphalt: tar line (one step darker than the floor, not ink), branching once */
function cracked(p: Painter, x: number, y: number, rng: Rng) {
  let cx = x, cy = y;
  for (let i = 0; i < 6; i++) { const nx = cx + rng.int(4, 9), ny = cy + rng.int(-4, 4); p.line('1', cx, cy, nx, ny); if (i === 2) p.line('1', nx, ny, nx + rng.int(-3, 3), ny + rng.int(4, 8)); cx = nx; cy = ny; }
}
/**
 * Fire escape bolted to a building face (3/4 view from above): two grated landings with
 * a railing and posts, joined by a diagonal stair whose treads and stringers show.
 * wallX is the wall line; the escape hangs over the building edge, not the alley floor.
 */
function fireEscape(p: Painter, wallX: number, y: number, left: boolean) {
  const w = 22; const x = left ? wallX - w : wallX; const h = 64;
  p.shRect(x, y, w, h, 20);
  p.obj(() => {
    const landing = (ly: number, lh: number) => {
      p.r('0', x, ly, w, lh); p.r('q', x + 1, ly + 1, w - 2, lh - 2);
      for (let j = ly + 2; j < ly + lh - 1; j += 2) p.r('1', x + 1, j, w - 2, 1);
      const rx = left ? x : x + w - 2; // outer railing on the side away from the wall
      p.r('0', rx, ly - 1, 2, lh + 1); p.r('o', rx, ly - 1, 1, lh);
      p.r('0', x, ly - 1, w, 2); p.r('o', x, ly - 1, w, 1); p.r('0', x, ly + lh - 2, w, 2); p.r('p', x, ly + lh - 2, w, 1);
      for (let j = ly + 3; j < ly + lh - 2; j += 5) p.r('o', rx, j, 2, 1);
    };
    landing(y, 16); landing(y + h - 16, 16);
    for (let j = 0; j < h - 32; j++) { // stair: stringers on a diagonal with treads between them
      const sx = left ? x + 2 + Math.round(j * 0.3) : x + w - 12 - Math.round(j * 0.3); const sy = y + 16 + j;
      p.r('0', sx - 1, sy, 12, 1); p.r(j % 3 === 0 ? 'o' : '1', sx, sy, 10, 1); p.r('p', sx, sy, 1, 1); p.r('p', sx + 9, sy, 1, 1);
    }
  });
}
/** chalk hopscotch on the concrete (light grey chalk, 1px lines), with a little chalk cat face at the top */
function hopscotch(p: Painter, x: number, y: number) {
  const box = (bx: number, by: number) => p.frame('o', bx, by, 12, 12);
  let yy = y;
  for (let i = 0; i < 6; i++) { if (i === 2 || i === 4) { box(x - 6, yy); box(x + 6, yy); } else box(x, yy); yy += 11; }
  p.r('o', x + 5, y + 3, 2, 5); // a chalk "1"
  const cx = x + 6, cy = y - 10; p.frame('c', cx - 5, cy - 3, 11, 8); p.r('c', cx - 5, cy - 5, 2, 2); p.r('c', cx + 4, cy - 5, 2, 2); p.r('c', cx - 2, cy, 1, 1); p.r('c', cx + 2, cy, 1, 1);
}
/** dark oil stain: a soft-edged blot one step darker than the concrete */
function oilStain(p: Painter, x: number, y: number, rng: Rng) {
  const rx = rng.int(6, 11), ry = rng.int(3, 5);
  p.ell('v', x, y, rx, ry); p.ell('v', x + rx * 0.6, y + 2, rx * 0.5, ry * 0.6); p.ell('1', x - 1, y, rx * 0.45, ry * 0.45); p.r('2', x - 2, y - 1, 2, 1);
}
/** a loose newspaper page: pale sheet with column lines, slightly askew */
function newspaper(p: Painter, x: number, y: number, rng: Rng) {
  const w = rng.int(9, 12), h = rng.int(7, 9);
  p.obj(() => { p.r('p', x, y + 1, w, h); p.r('o', x + 1, y, w, h); for (let j = y + 2; j < y + h - 1; j += 2) { p.r('p', x + 2, j, (w >> 1) - 2, 1); p.r('p', x + (w >> 1) + 1, j, (w >> 1) - 2, 1); } p.r('q', x + 2, y + 1, w - 3, 1); });
}
/** Big Sal's dinner spot: a dented food bowl and a picked-clean fish skeleton */
function catBowl(p: Painter, x: number, y: number) {
  p.shEll(x, y, 4, 3, 3);
  p.obj(() => {
    p.ell('0', x, y, 5, 4); p.ell('r', x, y, 4, 3); p.ell('e', x, y + 1, 2.5, 1.5); p.r('9', x - 1, y, 2, 1); p.r('c', x - 3, y - 2, 2, 1);
    const fx = x + 8, fy = y + 2; p.r('o', fx, fy, 9, 1); for (let i = 1; i < 7; i += 2) { p.r('o', fx + i, fy - 2, 1, 2); p.r('o', fx + i, fy + 1, 1, 2); } p.r('o', fx + 9, fy - 1, 2, 3); p.r('0', fx + 10, fy, 1, 1); p.r('o', fx - 2, fy - 1, 1, 1); p.r('o', fx - 2, fy + 1, 1, 1);
  });
}
/** a delivery scooter parked against the wall (top view): handlebars, seat, top box */
function scooter(p: Painter, x: number, y: number, k: string) {
  p.shRect(x, y, 10, 30, 8);
  p.obj(() => {
    p.r('0', x + 3, y - 2, 4, 3); p.r('0', x + 3, y + 30, 4, 3);
    p.r('0', x, y, 10, 30); p.r(k, x + 1, y + 1, 8, 28); p.r('0', x - 3, y + 4, 16, 2); p.r('p', x - 2, y + 4, 14, 1);
    p.r('1', x + 2, y + 9, 6, 9); p.r('q', x + 2, y + 9, 6, 1);
    p.r('0', x - 1, y + 19, 12, 11); p.r('7', x, y + 20, 10, 9); p.r('o', x, y + 27, 10, 2); p.r('d', x + 3, y + 22, 4, 4);
    p.glow('7', 'f', x + 4, y + 1, 2, 1, 1, 0);
  });
}
/** drainpipe running down a wall edge, with brackets */
function drainpipe(p: Painter, x: number, y0: number, y1: number) {
  p.obj(() => { p.r('0', x - 1, y0, 5, y1 - y0); p.r('p', x, y0, 3, y1 - y0); p.r('o', x, y0, 1, y1 - y0); for (let y = y0 + 10; y < y1; y += 40) { p.r('0', x - 2, y, 7, 3); p.r('q', x - 1, y + 1, 5, 1); } });
}
const alley: LayerDef = { speed: 1, opaque: true, paint(p, z) {
  const r = z.r;
  p.r('q', 96, 0, 256, SEG);
  // concrete slab seams (very quiet) + sealed cracks
  every(z, 48, 0, y => { if (y >= 0 && y < SEG) p.r('1', 100, y, 248, 1); });
  for (let i = 0; i < 3; i++) cracked(p, r.int(130, 280), r.int(4, SEG - 20), r);
  // centre drain gutter + grates
  p.r('1', 222, 0, 3, SEG); for (let y = 0; y < SEG; y += 64) { p.r('0', 216, y + 20, 16, 12); for (let i = 0; i < 4; i++) p.r('q', 218 + i * 4, y + 21, 2, 10); }
  puddle(p, r.int(150, 200), r.int(30, 110), r);
  puddle(p, r.int(250, 300), r.int(140, 220), r);
  if (z.s % 2 === 1) puddle(p, r.int(140, 300), r.int(200, 236), r);
  // manhole (world-spaced, steam rises from it in the anim)
  every(z, 280, 60, y => { if (y < -10 || y > SEG + 10) return; p.disc('0', 262, y, 8); p.disc('p', 262, y, 7); p.ring('1', 262, y, 5, 5, 1); for (let i = -3; i <= 3; i += 2) p.r('1', 258, y + i, 9, 1); });
  // gutters along both walls: a darker kerb strip with a lit lip
  p.r('v', 96, 0, 7, SEG); p.r('p', 103, 0, 1, SEG); p.r('v', 345, 0, 7, SEG); p.r('p', 344, 0, 1, SEG);
  for (let i = 0; i < 3; i++) oilStain(p, r.chance(0.5) ? r.int(132, 176) : r.int(272, 316), r.int(8, SEG - 8), r);
  if (z.s % 3 === 1) hopscotch(p, r.chance(0.5) ? 148 : 284, r.int(30, 140));
  for (let i = 0; i < r.int(1, 3); i++) newspaper(p, r.chance(0.5) ? r.int(108, 150) : r.int(290, 330), r.int(6, SEG - 14), r);
  for (const side of [0, 1]) {
    const bx = side ? 352 : 0;
    let y = -(z.s * 37 % 64);
    while (y < SEG) {
      const hh = r.int(80, 140); roof(p, bx, y, 96, hh, 40, r.pick(['q', 'v']), r.pick(['p', 'b', 'a']));
      // roof clutter so the tenement tops never read as flat slabs: an AC unit, a lit skylight, a vent stack, a hatch
      const ay = y + r.int(12, 22); acUnit(p, bx + (side ? r.int(44, 60) : r.int(14, 30)), ay);
      if (hh >= 90) skylight(p, bx + (side ? 16 : 56), y + hh - 36, 22, 16, 0.7, r.next());
      vent(p, bx + (side ? 20 : 76), ay + 8);
      if (hh >= 110) { const hx = bx + (side ? 62 : 14), hy = y + hh - 30; p.shRect(hx, hy, 14, 14, 6); p.obj(() => { p.r('0', hx, hy, 14, 14); p.r('a', hx + 1, hy + 1, 12, 12); p.r('9', hx + 1, hy + 1, 12, 1); p.r('b', hx + 3, hy + 6, 8, 1); }); }
      y += hh;
    }
    for (let fy = 10 + r.int(0, 30); fy < SEG - 64; fy += r.int(100, 130)) fireEscape(p, side ? 352 : 96, fy, !side);
    drainpipe(p, side ? 352 : 92, 0, SEG);
  }
  if (z.s % 3 === 0) catBowl(p, r.chance(0.5) ? 130 : 312, r.int(20, 230));
  if (z.s % 4 === 3) scooter(p, 334, r.int(20, 200), r.pick(['r', 'm', 'g']));
  // street furniture hugs the walls: dumpster with bags and boxes beside it; the centre lanes stay clear
  const used: [boolean, number, number][] = []; // [left, y0, y1] of wall furniture, so later props find a free stretch
  for (let i = 0, y = 8 + r.int(0, 20); y < SEG - 40; i++) {
    const left = (i + z.s) % 2 === 0; const k = r.int(0, 3); used.push([left, y - 6, y + (k <= 1 ? 80 : k === 2 ? 60 : 50)]);
    if (k <= 1) { dumpster(p, left ? 98 : 306, y); bags(p, left ? 104 : 334, y + 34, r); y += 80; }
    else if (k === 2) { crate(p, left ? 98 : 330, y, 20, 20); crate(p, left ? 100 : 326, y + 22, 18, 18, '9'); y += 60; }
    else { const x = left ? 98 : 332; p.shRect(x, y, 18, 14, 6); p.obj(() => { p.r('0', x, y, 18, 14); p.r('n', x + 1, y + 1, 16, 12); for (let i2 = 3; i2 < 16; i2 += 4) p.r('2', x + i2, y + 2, 2, 10); }); y += 50; }
  }
  // bodega: striped awning over the left wall edge + a neon CAT FOOD sign + door light
  if (z.s % 2 === 0) {
    const ay = r.int(60, 160);
    p.shRect(80, ay, 26, 54, 12);
    p.obj(() => { p.r('0', 80, ay, 26, 54); for (let j = 0; j < 54; j += 6) p.r(j % 12 ? '7' : 'k', 80, ay + j + 1, 25, 5); p.r('j', 80, ay + 1, 2, 52); p.r('1', 105, ay, 1, 54); });
    p.obj(() => { p.r('0', 56, ay + 6, 22, 42); p.r('1', 57, ay + 7, 20, 40); });
    p.obj(() => { const nx = 62, ny = ay + 10; for (const [dx, dy, w, h] of [[0, 0, 10, 1], [0, 0, 1, 34], [9, 0, 1, 34], [0, 33, 10, 1], [3, 6, 4, 4], [3, 16, 4, 1], [3, 22, 4, 6]]) p.glow('e', dx < 1 || dx > 8 || dy === 0 || dy === 33 ? 'd' : 'l', nx + dx, ny + dy, w, h); });
    // a gooseneck sign lamp on the awning edge: the pool is centred under it and stays on the alley floor
    alleyLamp(p, 110, ay + 27, true); p.pool(116, ay + 27, 34, [104, 0, 240, SEG]);
  } else {
    // a laundromat on the right wall: a teal-and-cream awning, a lit window and a neon washing-machine sign
    const ay = r.int(60, 160);
    p.shRect(342, ay, 26, 54, 12);
    p.obj(() => { p.r('0', 342, ay, 26, 54); for (let j = 0; j < 54; j += 6) p.r(j % 12 ? '7' : 'm', 343, ay + j + 1, 25, 5); p.r('n', 366, ay + 1, 2, 52); p.r('1', 342, ay, 1, 54); });
    p.obj(() => { p.r('0', 370, ay + 6, 22, 42); p.r('1', 371, ay + 7, 20, 40); });
    p.obj(() => { const nx = 376, ny = ay + 14; for (const [dx, dy, w, h] of [[0, 0, 10, 1], [0, 0, 1, 12], [9, 0, 1, 12], [0, 11, 10, 1], [3, 4, 4, 4]]) p.glow('n', dx === 3 ? 'c' : 'l', nx + dx, ny + dy, w, h); });
    alleyLamp(p, 338, ay + 27, false); p.pool(332, ay + 27, 34, [104, 0, 240, SEG]);
  }
  // a back door with a caged wall lamp (the light pool has a source), a step and a doormat
  const free = (left: boolean, y: number, h: number) => !used.some(([l, a, b]) => l === left && y + h > a && y < b);
  for (let t = 0; t < 12; t++) { const left = r.chance(0.5), wx = left ? 104 : 344, wy = r.int(36, 214); if (!free(left, wy - 14, 30)) continue; backDoor(p, wx, wy, left); p.pool(wx + (left ? 6 : -6), wy + 4, 30); used.push([left, wy - 14, wy + 16]); break; }
  // the cats' crates: a stack of milk crates with a folded blanket on top (Big Sal's crew sleeps here), on a free wall stretch
  for (let t = 0; t < 12; t++) { const left = r.chance(0.5), cy = r.int(10, 210); if (!free(left, cy - 6, 34)) continue; const cx = left ? 106 : 316; used.push([left, cy - 6, cy + 28]);
    p.shRect(cx, cy, 26, 24, 10);
    p.obj(() => { for (const [dx, dy, k] of [[0, 0, 'r'], [13, 0, 'n'], [6, 12, 'k']] as [number, number, string][]) { const x = cx + dx, y = cy + dy; p.r('0', x, y, 13, 12); p.r(k, x + 1, y + 1, 11, 10); p.r('0', x + 3, y + 3, 7, 6); for (let i = x + 4; i < x + 10; i += 2) p.r(k, i, y + 4, 1, 4); } p.r('0', cx + 2, cy - 2, 12, 5); p.r('e', cx + 3, cy - 1, 10, 3); p.r('d', cx + 3, cy - 1, 10, 1); });
    break; }
  // kerb weeds and the odd dandelion, in the gutter strips
  for (let i = 0; i < 10; i++) { const left = r.chance(0.5), x = left ? r.int(97, 101) : r.int(346, 350), y = r.int(4, SEG - 4); p.r('k', x, y, 1, 2); p.r('k', x + 1, y - 1, 1, 3); if (r.chance(0.25)) p.r('f', x + 1, y - 2, 1, 1); }
  for (let t = 0; t < 12 && z.s % 3 === 2; t++) { const left = r.chance(0.5), y = r.int(20, 210); if (!free(left, y - 4, 26)) continue; boxBed(p, left ? 112 : 318, y); used.push([left, y - 4, y + 22]); break; }
  for (let t = 0; t < 12 && z.s % 4 === 1; t++) { const left = r.chance(0.5), y = r.int(10, 200); if (!free(left, y - 4, 38)) continue; bicycle(p, left ? 108 : 334, y); used.push([left, y - 4, y + 34]); break; }
  // chalk doodles on the concrete: a sun, a fish, a heart (pale, 1px, low contrast)
  if (r.chance(0.6)) chalkDoodle(p, r.int(150, 300), r.int(20, SEG - 30), r.int(0, 2));
} };
/** a gooseneck lamp bracket reaching out from a wall/awning edge: arm, a dark shade and a warm bulb (lit after dusk) */
function alleyLamp(p: Painter, x: number, y: number, fromLeft: boolean) {
  p.obj(() => {
    const ax = fromLeft ? x - 6 : x + 2; p.r('0', ax, y - 1, 5, 2); p.r('p', ax, y - 1, 5, 1);
    p.r('0', x - 3, y - 3, 7, 7); p.r('q', x - 2, y - 2, 5, 5); p.r('p', x - 2, y - 2, 5, 1);
    p.glow('p', 'f', x - 1, y - 1, 3, 3); p.glow('o', '7', x, y, 1, 1);
  });
}
/** back door in the wall: steel door edge, concrete step, doormat, caged lamp (lit after dusk) and a pot of herbs */
function backDoor(p: Painter, x: number, y: number, left: boolean) {
  const sx = left ? x : x - 14;
  p.shRect(sx, y - 10, 14, 22, 4);
  p.obj(() => {
    p.r('0', sx, y - 10, 14, 22); p.r('p', sx + 1, y - 9, 12, 20); p.r('o', sx + 1, y - 9, 12, 1); // step
    p.r('0', sx + 2, y - 6, 10, 14); p.r('a', sx + 3, y - 5, 8, 12); for (let j = y - 4; j < y + 6; j += 2) p.r('b', sx + 3, j, 8, 1); // mat
    p.r('7', sx + 5, y - 2, 4, 1); p.r('7', sx + 5, y + 1, 4, 1);
    const lx = left ? x - 4 : x + 1; p.r('0', lx, y - 2, 4, 6); p.glow('q', 'f', lx + 1, y - 1, 2, 4, 1, 0); p.r('0', lx, y + 1, 4, 1);
    const hx = left ? sx + 18 : sx - 6; p.disc('0', hx, y + 10, 4); p.disc('h', hx, y + 10, 3); p.disc('k', hx, y + 9, 2); p.r('j', hx - 1, y + 8, 1, 1); p.r('j', hx + 1, y + 9, 1, 1);
  });
}
/** a cardboard box turned into a stray's bed: flaps open, a folded blanket and a little sign */
function boxBed(p: Painter, x: number, y: number) {
  p.shRect(x, y, 22, 18, 8);
  p.obj(() => {
    p.r('0', x - 1, y - 1, 24, 20); p.r('9', x, y, 22, 18); p.r('a', x + 2, y + 2, 18, 14);
    p.r('0', x - 5, y + 1, 5, 14); p.r('8', x - 4, y + 2, 4, 12); p.r('0', x + 22, y + 1, 5, 14); p.r('8', x + 22, y + 2, 4, 12); // open flaps
    p.r('e', x + 3, y + 5, 16, 9); p.r('d', x + 3, y + 5, 16, 2); for (let i = x + 5; i < x + 19; i += 4) p.r('c', i, y + 9, 2, 1);
    p.r('7', x + 6, y + 14, 10, 3); p.r('a', x + 8, y + 15, 6, 1);
  });
}
/** a bicycle chained against the wall: two wheels, frame, a basket on the front */
function bicycle(p: Painter, x: number, y: number) {
  p.shRect(x, y, 8, 30, 6);
  p.obj(() => {
    for (const wy of [y + 4, y + 26]) { p.r('0', x + 2, wy - 4, 4, 9); p.r('q', x + 3, wy - 3, 2, 7); }
    p.r('0', x + 3, y + 7, 2, 17); p.r('m', x + 3, y + 8, 1, 15); p.r('0', x - 2, y + 7, 12, 2); p.r('p', x - 1, y + 7, 10, 1);
    p.r('0', x + 1, y + 16, 6, 4); p.r('1', x + 2, y + 17, 4, 2); // saddle
    p.r('0', x - 1, y - 2, 10, 6); p.r('9', x, y - 1, 8, 4); p.r('a', x + 1, y, 6, 1); p.r('c', x + 2, y + 1, 2, 1); p.r('f', x + 5, y + 1, 2, 1); // basket with flowers
  });
}
/** pale chalk doodles (1px lines) */
function chalkDoodle(p: Painter, x: number, y: number, kind: number) {
  if (kind === 0) { p.ring('o', x, y, 5, 5, 1); for (let i = 0; i < 8; i++) { const a = i * 0.785; p.r('o', x + Math.round(Math.cos(a) * 8), y + Math.round(Math.sin(a) * 8), 1, 1); } }
  else if (kind === 1) { p.ring('c', x, y, 7, 4, 1); p.r('c', x + 7, y - 3, 1, 7); p.r('c', x + 8, y - 4, 1, 2); p.r('c', x + 8, y + 3, 1, 2); p.r('c', x - 4, y - 1, 1, 1); }
  else { for (const [dx, dy, w] of [[-4, -2, 3], [1, -2, 3], [-5, -1, 10], [-4, 0, 8], [-3, 1, 6], [-2, 2, 4], [-1, 3, 2]]) { p.r('c', x + dx, y + dy, 1, 1); p.r('c', x + dx + w - 1, y + dy, 1, 1); } }
}
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
    p.r('v', bx + 6, by + 6, 44, 52); p.r('q', bx + 8, by + 8, 40, 48); p.r('p', bx + 8, by + 8, 40, 1); p.r('v', bx + 8 + r.int(8, 30), by + 8, 1, 48);
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
  p.pool(cx, cy, 44); // the pendant hangs over the table centre, so its pool is centred on the table
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
  const [lit, body, dark] = rim === 'n' ? ['3', 'n', '2'] : ['9', 'a', 'b'];
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
    p.r('0', cx - 19, cy - 19, 38, 38); p.r('2', cx - 18, cy - 18, 36, 36); p.r('3', cx - 18, cy - 18, 36, 1);
    p.disc('0', cx + 8, cy + 8, 8); p.disc('9', cx + 8, cy + 8, 7); p.ring('a', cx + 8, cy + 8, 5, 5, 1); p.ring('a', cx + 8, cy + 8, 3, 3, 1);
    p.disc('0', cx - 6, cy - 6, 12); p.disc('2', cx - 6, cy - 6, 11); p.disc('3', cx - 7, cy - 7, 9); p.disc('0', cx - 6, cy - 6, 3);
    p.r('c', cx - 10, cy + 6, 2, 8); p.disc('t', cx - 9, cy + 15, 2);
  });
}
/** emissive rect that keeps its colour at every time of day (sky seen through glass, a neon tube): drawn after the remap */
function emit(p: Painter, k: string, x: number, y: number, w: number, h: number) { p.r(k, x, y, w, h); p.glows.push({ lit: KEY.indexOf(k), x, y, w, h, on: true }); }
/** what the cafe windows show: the sky outside at this time of day [pane, reflection, accent] */
const CAFE_SKY: Record<Tod, [string, string, string]> = { day: ['s', '6', '5'], dawn: ['c', '7', 't'], dusk: ['g', 'f', 'h'], night: ['1', '2', 'f'] };
/** light pooling through the cafe windows per time of day (applied to the day colours of the floor) */
const CAFE_SUN: Partial<Record<Tod, Ramp>> = {
  // first sun: pale peach light across the honey planks
  dawn: ramp('b:a a:9 9:8 8:c 7:c v:b 1:v 2:3 3:4 q:p p:o o:c k:j e:d'),
  dusk: ramp('0:1 1:b v:b b:a a:h 9:g q:a p:9 o:8 2:3 3:4 n:3 k:j e:d'),
};
/** soft wool toys on the floor: a yarn ball with a trailing thread, or a grey toy mouse with a pink tail */
function floorToy(p: Painter, x: number, y: number, rng: Rng) {
  p.obj(() => {
    if (rng.chance(0.5)) { const [dk, sh, hi] = rng.pick(DYES); let tx = x + 3, ty = y + 2; for (let i = 0; i < 6; i++) { const nx = tx + rng.int(2, 4), ny = ty + rng.int(-2, 2); p.line(dk, tx, ty, nx, ny); tx = nx; ty = ny; } yarnBall(p, x, y, dk, sh, hi); }
    else { p.r('0', x - 4, y - 2, 9, 5); p.r('p', x - 3, y - 1, 7, 3); p.r('o', x - 3, y - 1, 5, 1); p.r('c', x - 3, y - 3, 2, 1); p.r('0', x + 3, y - 1, 1, 1); p.r('c', x - 6, y, 2, 1); p.r('c', x - 8, y + 1, 2, 1); p.r('c', x - 9, y + 2, 1, 1); }
  });
}
/** chalkboard A-frame by the counter: today's specials in chalk (cream lines, a pink fish doodle) */
function chalkboard(p: Painter, x: number, y: number) {
  p.shRect(x, y, 18, 24, 10);
  p.obj(() => {
    p.r('0', x, y, 18, 24); p.r('a', x + 1, y + 1, 16, 22); p.r('9', x + 1, y + 1, 16, 1); p.r('1', x + 3, y + 3, 12, 18);
    p.r('7', x + 5, y + 5, 8, 1); p.r('o', x + 5, y + 8, 6, 1); p.r('o', x + 5, y + 11, 7, 1); p.r('o', x + 5, y + 14, 5, 1);
    p.r('c', x + 8, y + 17, 4, 2); p.r('c', x + 12, y + 16, 1, 1); p.r('c', x + 12, y + 19, 1, 1);
  });
}
/** a round braided rug: concentric rings in two calm tones and a fringe of tassels, so the floor under the tables reads as a cosy nook */
function rug(p: Painter, cx: number, cy: number, rx: number, ry: number, keys = ['2', '3', 'v']) {
  const [body, ring, edge] = keys;
  p.ell('0', cx, cy, rx + 1, ry + 1); p.ell(edge, cx, cy, rx, ry); p.ell(body, cx, cy, rx - 3, ry - 3);
  for (let k = 8; k < Math.min(rx, ry) - 4; k += 9) p.ring(ring, cx, cy, rx - 3 - k, ry - 3 - Math.round(k * ry / rx), 1);
  for (let a = 0; a < 6.28; a += 0.21) { const x = Math.round(cx + Math.cos(a) * (rx + 2)), y = Math.round(cy + Math.sin(a) * (ry + 2)); p.r('7', x, y, 1, 1); }
}
/** the cats' play corner: a soft mat with a woven border, a quiet diamond weave and stitched paw prints */
function playMat(p: Painter, x: number, y: number, w: number, h: number) {
  p.r('0', x, y, w, h); p.r('2', x + 1, y + 1, w - 2, h - 2); p.frame('3', x + 3, y + 3, w - 6, h - 6); p.frame('v', x + 5, y + 5, w - 10, h - 10);
  for (let j = y + 8; j < y + h - 8; j++) for (let i = x + 8; i < x + w - 8; i++) { const u = (i - x) % 24, v = (j - y) % 24; if (Math.abs(u - 12) + Math.abs(v - 12) === 11) p.r('v', i, j, 1, 1); }
  for (let j = y + 20; j < y + h - 12; j += 48) for (let i = x + 20; i < x + w - 12; i += 48) { p.r('3', i, j + 2, 4, 3); p.r('3', i - 1, j, 1, 1); p.r('3', i + 1, j - 1, 1, 1); p.r('3', i + 3, j - 1, 1, 1); p.r('3', i + 5, j, 1, 1); }
  for (let i = x + 2; i < x + w - 2; i += 6) { p.r('7', i, y - 1, 2, 1); p.r('7', i, y + h, 2, 1); } // tassels
}
/** a plump floor cushion with a button and a seam */
function cushion(p: Painter, cx: number, cy: number, k: string) {
  const sh = k === 'u' ? '2' : 'a', hi = k === 'u' ? 't' : 'g';
  p.shEll(cx, cy, 9, 8, 4);
  p.obj(() => { p.ell('0', cx, cy, 10, 9); p.ell(sh, cx, cy, 9, 8); p.ell(k, cx - 1, cy - 1, 8, 7); p.ell(hi, cx - 3, cy - 3, 3, 2); p.r(sh, cx - 7, cy, 14, 1); p.disc('0', cx, cy, 1.5); });
}
const cafe: LayerDef = { speed: 1, opaque: true, paint(p, z) {
  const r = z.r; const tod = p.tod; const WX = SW - 54; // window wall (inside the camera's pan range)
  p.poolScale = 0.8; // pendant pools reach past the table tops onto the planks
  // floor: warm walnut planks (staggered butt joints, sparse grain), one step lighter than the counter shadow
  p.r('b', 0, 0, SW, SEG);
  for (let x = 70; x < SW; x += 14) { p.r('v', x, 0, 1, SEG); const off = ((x * 37) % 96); for (let y = -off; y < SEG; y += 96) { p.r('v', x, y, 14, 1); p.r('a', x + 1, y + 1, 13, 1); } }
  for (let i = 0; i < 70; i++) { const x = 72 + r.int(0, 25) * 14 + r.int(3, 10), y = r.int(0, SEG - 8); p.r(r.chance(0.7) ? 'a' : 'v', x, y, 1, r.int(3, 9)); }
  // counter on the left
  p.shRect(0, 0, 70, SEG, 18);
  p.obj(() => {
    p.r('0', 0, 0, 70, SEG); p.r('a', 0, 0, 68, SEG); p.r('9', 64, 0, 4, SEG); p.r('b', 0, 0, 4, SEG);
    for (let y = 0; y < SEG; y += 32) p.r('b', 4, y, 60, 1);
  });
  const ey = r.int(10, 130);
  p.obj(() => { p.r('0', 10, ey, 40, 32); p.r('p', 11, ey + 1, 38, 30); p.r('o', 11, ey + 1, 38, 2); p.r('q', 14, ey + 8, 32, 14); p.r('0', 18, ey + 22, 6, 6); p.r('0', 34, ey + 22, 6, 6); cup(p, 21, ey + 36); cup(p, 37, ey + 36, true); });
  p.glow('q', 'r', 44, ey + 4, 2, 2); p.glow('q', 'i', 40, ey + 4, 2, 2);
  p.obj(() => { const cy = (ey + 120) % 220 + 10; p.r('0', 8, cy, 52, 26); p.r('2', 9, cy + 1, 50, 24); p.r('n', 9, cy + 1, 50, 2); for (let i = 0; i < 6; i++) { p.disc('0', 16 + i * 7, cy + 14, 3); p.disc(i % 2 ? '8' : 'c', 16 + i * 7, cy + 14, 2); } });
  // tip jar + a sleepy counter cat-shaped cookie jar
  p.obj(() => { const jy = (ey + 70) % 230 + 8; p.disc('0', 20, jy, 5); p.disc('5', 20, jy, 4); p.disc('f', 20, jy + 1, 2); p.r('6', 18, jy - 2, 1, 1); p.disc('0', 44, jy + 2, 7); p.disc('7', 44, jy + 2, 6); p.r('0', 39, jy - 5, 3, 3); p.r('0', 47, jy - 5, 3, 3); p.r('7', 40, jy - 4, 1, 2); p.r('7', 48, jy - 4, 1, 2); p.r('0', 41, jy + 1, 2, 1); p.r('0', 46, jy + 1, 2, 1); p.r('c', 43, jy + 3, 2, 1); });
  for (let y = 24; y < SEG; y += 52) { const sy = y; p.shEll(84, sy, 6, 6, 10); p.obj(() => { p.disc('0', 84, sy, 7); p.disc('a', 84, sy, 6); p.disc('9', 83, sy - 1, 4); p.disc('a', 84, sy, 2); }); }
  if (z.s % 2 === 1) chalkboard(p, 96, r.int(40, 190));
  else { // burlap coffee sacks by the counter, with a few spilled beans
    const sy = r.int(30, 180); p.shRect(74, sy, 22, 34, 8);
    p.obj(() => { for (const [dx, dy] of [[0, 0], [2, 17]]) { const x = 74 + dx, y = sy + dy; p.r('0', x, y, 20, 16); p.r('9', x + 1, y + 1, 18, 14); p.r('8', x + 1, y + 1, 18, 2); p.r('a', x + 1, y + 13, 18, 2); p.r('b', x + 6, y + 5, 8, 1); p.r('b', x + 6, y + 8, 8, 1); p.r('h', x + 8, y + 6, 4, 2); } });
    for (let i = 0; i < 6; i++) { const bx = 100 + r.int(0, 14), by = sy + 30 + r.int(0, 10); p.r('0', bx, by, 2, 2); p.r('b', bx, by, 1, 1); }
  }
  // windows on the right wall show the sky outside (emissive, so LOCAL TIME reads at a glance); a cushioned perch under each
  const [pane, refl, acc] = CAFE_SKY[tod];
  p.obj(() => { p.r('0', WX, 0, SW - WX, SEG); p.r('a', WX + 2, 0, SW - WX - 2, SEG); p.r('9', WX + 2, 0, 1, SEG); p.r('b', WX + 30, 0, 1, SEG); });
  for (let y = 8; y < SEG; y += 64) {
    const wy = y;
    p.obj(() => { p.r('0', WX + 4, wy, 22, 48); });
    p.obj(() => {
      emit(p, pane, WX + 6, wy + 2, 18, 44);
      emit(p, refl, WX + 8, wy + 4, 1, 10); emit(p, refl, WX + 10, wy + 4, 1, 5);
      if (tod === 'night') for (let i = 0; i < 3; i++) emit(p, acc, WX + 7 + ((wy * 7 + i * 5) % 16), wy + 6 + ((wy * 3 + i * 13) % 34), 1, 1);
      else emit(p, acc, WX + 12, wy + 30, 8, 2);
      p.lateBars.push([WX + 15, wy + 2, 1, 44], [WX + 6, wy + 23, 18, 1]);
      // perch: a little shelf with a cushion
      p.r('0', WX - 14, wy + 14, 12, 22); p.r('a', WX - 13, wy + 15, 10, 20); p.r('e', WX - 12, wy + 17, 8, 16); p.r('d', WX - 12, wy + 17, 8, 2);
    });
  }
  // light through the windows: two panes per window (split by the transom) thrown across the planks; long and low at dawn / dusk
  if (tod !== 'night') {
    if (CAFE_SUN[tod]) p.sunRamp = CAFE_SUN[tod]!;
    const len = tod === 'day' ? 70 : 150, skew = tod === 'day' ? 0.35 : tod === 'dawn' ? 0.9 : -0.9;
    for (let y = 8; y < SEG; y += 64) { p.beam(WX - 14 - len, y + 2, len, 20, skew); p.beam(WX - 14 - len, y + 24, len, 20, skew); }
  }
  for (let y = 40; y < SEG; y += 128) { const px = WX - 26, py = y; p.shEll(px, py, 9, 9, 12); p.obj(() => { p.disc('0', px, py, 10); p.disc('a', px, py, 9); p.disc('b', px + 1, py + 1, 7); for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.28; p.ell('0', px + Math.cos(a) * 7, py + Math.sin(a) * 7, 5, 3); p.ell('k', px + Math.cos(a) * 7, py + Math.sin(a) * 7, 4, 2); } p.disc('j', px - 1, py - 1, 2); }); }
  const k = (z.s + r.int(0, 2)) % 3;
  if (k === 0) { rug(p, 230, 128, 92, 62); cafeTable(p, 190, 110, r); cafeTable(p, 272, 150, r); catBed(p, 250, 80, 'e'); catBed(p, 150, 200); }
  else if (k === 1) { rug(p, 214, 196, 60, 34, ['v', 'e', '1']); for (const [tx, ty] of [[140, 50], [250, 60], [340, 150], [160, 160]]) cafeTable(p, tx + r.int(-8, 8), ty + r.int(-8, 8), r); catBed(p, 270, 210); }
  else { playMat(p, 120, 40, 200, 180); catTree(p, 180, 100); catBed(p, 270, 90, 'e'); catBed(p, 250, 180); cushion(p, 150, 190, 'u'); cushion(p, 290, 140, 'h'); p.pool(270, 90, 40); p.pool(250, 180, 40); }
  for (let i = 0; i < 2; i++) floorToy(p, r.int(110, 360), r.int(10, SEG - 10), r);
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
    for (let i = 0; i < 4; i++) { const a = (i / 4) * 6.28 + 0.4; for (let t = 4; t < 20; t++) { const bx = x + Math.cos(a) * t, by = y + Math.sin(a) * t; p.disc('0', bx, by, 2.5); } for (let t = 4; t < 20; t++) { const bx = x + Math.cos(a) * t, by = y + Math.sin(a) * t; p.disc('b', bx, by, 1.5); } }
    p.disc('0', x, y, 5); p.disc('q', x, y, 4); p.disc('p', x - 1, y - 1, 2);
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
  const r = z.r;
  // deeper shapes under the surface: swaying kelp beds and the odd school of small fish (one tone darker, calm)
  for (let i = 0; i < 2; i++) { const kx = r.chance(0.5) ? r.int(110, 170) : r.int(300, 400), ky = r.int(10, SEG - 60); for (let k = 0; k < 5; k++) { const sx = kx + k * 6 + r.int(-2, 2), len = r.int(24, 50); for (let j = 0; j < len; j++) p.r('1', sx + Math.round(Math.sin((j + k * 7) / 6) * 2), ky + j, 2, 1); } }
  if (r.chance(0.6)) { const fx = r.int(140, 380), fy = r.int(20, SEG - 30); for (let k = 0; k < 6; k++) { const x = fx + (k % 3) * 9 + (k > 2 ? 4 : 0), y = fy + (k > 2 ? 7 : 0) + (k % 2) * 3; p.r('1', x, y, 4, 2); p.r('1', x + 4, y - 1, 1, 1); p.r('1', x + 4, y + 2, 1, 1); } }
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
  lamp(p, bw + len - 18, fy + 14, 26); // a small pool that stays on the planks
  boat(p, bw + r.int(16, 60), fy + 46, 30, r.int(84, 110), r.pick(['p', 'a', 'q', 'n', 'b']), r, r.chance(0.5));
  if (r.chance(0.8)) boat(p, bw + r.int(150, 200), fy + 70, 26, r.int(60, 80), r.pick(['p', 'a', 'o']), r, true, true); // under way, with wake
  else if (r.chance(0.8)) boat(p, bw + r.int(120, 180), fy + 42, 34, r.int(90, 130), r.pick(['p', 'a', 'o']), r, false);
  if (fy > 54 && len < 250) boat(p, bw + len + 12, 4, 22, 46, r.pick(['a', 'q', 'n']), r, true);
  const stallY = z.s % 2 === 1 ? r.int(30, 170) : -999;
  if (stallY > 0) fishStall(p, 8, stallY, r);
  for (let y = 20; y < SEG - 30; y += r.int(50, 80)) { if (y > stallY - 44 && y < stallY + 48) continue; const k = r.int(0, 2); if (k === 0) { fishCrate(p, 14, y, r); fishCrate(p, 16, y + 18, r); } else if (k === 1) { p.shEll(40, y + 10, 14, 10, 4); p.obj(() => { p.ell('0', 40, y + 10, 15, 11); p.ell('k', 40, y + 10, 14, 10); p.checker('1', 28, y + 2, 26, 18); }); } else { crate(p, 20, y, 24, 24); } }
  for (let i = 0; i < 2; i++) buoy(p, r.int(bw + 40, SW - 50), r.int(fy + 50, SEG - 8));
  // tyre fenders hung along the finger pier
  p.obj(() => { for (let x = bw + 24; x < bw + len - 8; x += 40) for (const yy of [fy - 3, fy + 31]) { p.r('0', x - 3, yy, 7, 5); p.r('q', x - 2, yy + 1, 5, 3); p.r('0', x - 1, yy + 2, 3, 1); } });
  // a pair of ducks paddling
  if (r.chance(0.5)) { const dx = r.int(340, 372), dy = r.int(fy + 50, SEG - 16); p.obj(() => { for (const [ox, oy] of [[0, 0], [12, 6]]) { const x = dx + ox, y = dy + oy; p.r('5', x - 4, y + 4, 10, 1); p.r('0', x - 1, y - 1, 8, 5); p.r('7', x, y, 6, 3); p.r('o', x + 1, y + 2, 4, 1); p.r('0', x + 5, y - 2, 3, 3); p.r('k', x + 5, y - 1, 2, 1); p.r('g', x + 8, y - 1, 1, 1); } }); }
  // boardwalk life: a fishing bucket with a rod propped on the rail, a coil of rope, a bench
  const by = r.int(10, 200);
  p.obj(() => { p.disc('0', 80, by, 6); p.disc('n', 80, by, 5); p.disc('2', 80, by, 3); p.r('o', 79, by - 1, 3, 1); p.line('b', 84, by - 2, bw + 18, by - 20); p.line('o', bw + 18, by - 20, bw + 22, by - 8); p.r('r', bw + 21, by - 8, 2, 2); });
  if (Math.abs((by + 90) % 230 + 12 - stallY - 20) > 50) p.obj(() => { const cx = 30, cy = (by + 90) % 230 + 12; p.ring('0', cx, cy, 8, 7, 1); p.ring('9', cx, cy, 7, 6, 2); p.ring('a', cx, cy, 4, 3, 1); p.r('9', cx + 6, cy + 4, 8, 2); });
  if (z.s % 2 === 0) bench(p, 60, (by + 160) % 220 + 10, true);
  // the stone seawall along the right edge with mooring cleats and a stack of crates
  const sx = SW - 44; p.shRect(sx, 0, 4, SEG, 10);
  p.obj(() => { p.r('0', sx, 0, 44, SEG); for (let y = 0; y < SEG; y += 12) for (let x = sx + 1 + ((y / 12) % 2) * 8; x < SW; x += 16) { p.r('q', x, y + 1, 15, 11); p.r('p', x, y + 1, 15, 1); } p.r('p', sx + 1, 0, 2, SEG); p.r('o', sx + 1, 0, 1, SEG); });
  every(z, 96, 30, y => { if (y > -6 && y < SEG + 6) { bollard(p, sx + 8, y); piling(p, sx - 4, y + 20); } });
  crate(p, sx + 14, r.int(20, 120), 22, 22, 'a'); crate(p, sx + 16, r.int(150, 220), 20, 20, '9');
  const ly = r.int(40, 200); lamp(p, 76, ly, 40, [0, 0, bw, SEG]); // boardwalk lamp post (its pool fits on the planks)
  // harbour life on the open water (kept to the right half and low, the formation lane stays calm)
  if (z.s % 3 === 2) rowboat(p, r.int(344, 362), r.int(fy + 60, fy + 110));
  else if (r.chance(0.6)) otter(p, r.int(350, 372), r.int(fy + 60, fy + 130));
  // a short side pier off the seawall, low in the segment (the open water band under the formation stays calm)
  if (z.s % 2 === 0) sidePier(p, r.int(328, 346), Math.min(fy + 156, SEG - 34), r);
  for (let i = 0; i < 2; i++) if (r.chance(0.6)) lobsterFloat(p, r.int(bw + 60, SW - 90), r.int(fy + 50, SEG - 10), r);
} };
/** fish market stall on the boardwalk: a striped awning shading a counter of fish on crushed ice and a price slate */
function fishStall(p: Painter, x: number, y: number, rng: Rng) {
  const w = 46;
  p.shRect(x, y, w, 40, 12);
  p.obj(() => {
    p.r('0', x - 1, y + 13, w + 2, 28); p.r('a', x, y + 14, w, 26); p.r('9', x, y + 14, w, 1); p.r('b', x, y + 38, w, 2);
    p.r('5', x + 2, y + 17, w - 4, 18); p.r('s', x + 2, y + 17, w - 4, 1);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { const fx = x + 4 + i * 10, fy = y + 20 + j * 7, left = (i + j) % 2 === 0; p.r('0', fx, fy, 8, 3); p.r(rng.chance(0.3) ? 'h' : 'o', fx + 1, fy, 6, 2); p.r('p', fx + 1, fy + 2, 6, 1); p.r('0', left ? fx + 7 : fx, fy, 1, 1); }
    p.r('0', x + w - 12, y + 30, 10, 7); p.r('1', x + w - 11, y + 31, 8, 5); p.r('7', x + w - 10, y + 32, 3, 1); p.r('f', x + w - 6, y + 34, 2, 1);
    // awning: scalloped teal and cream stripes, thrown slightly over the counter
    p.r('0', x - 2, y - 1, w + 4, 16);
    for (let i = 0; i < w + 2; i += 6) p.r((i / 6) % 2 ? '7' : 'm', x - 1 + i, y, Math.min(6, w + 2 - i), 14);
    p.r('n', x - 1, y + 12, w + 2, 2); for (let i = 0; i < w + 2; i += 6) p.r('0', x - 1 + i + 2, y + 14, 2, 1);
  });
}
/** a short pier off the seawall with a moored dinghy and a gull standing on a piling */
function sidePier(p: Painter, x0: number, y: number, rng: Rng) {
  const len = 404 - x0;
  p.shRect(x0, y, len, 22, 6);
  p.obj(() => { p.r('0', x0 - 1, y - 1, len + 1, 24); for (let x = x0; x < 404; x += 8) { p.r('p', x, y, 7, 22); p.r('q', x + 7, y, 1, 22); p.r('o', x + 3, y + ((x * 5) % 16) + 2, 1, 2); } });
  for (let x = x0 + 6; x < 404; x += 32) { piling(p, x, y - 2); piling(p, x, y + 24); }
  crate(p, x0 + 10, y + 3, 16, 16, '9');
  const gx = x0 + 6, gy = y - 4; p.obj(() => { p.r('0', gx - 3, gy - 2, 7, 4); p.r('7', gx - 2, gy - 1, 5, 2); p.r('p', gx - 2, gy, 2, 1); p.r('0', gx + 3, gy - 1, 2, 2); p.r('g', gx + 5, gy - 1, 1, 1); });
  const dx = x0 + rng.int(10, Math.max(12, len - 34)); rowboat(p, dx, y + 28);
}
/** a sea otter floating on its back, paws on its tummy holding a clam, with a ring of ripples */
function otter(p: Painter, x: number, y: number) {
  p.ring('5', x, y, 14, 7, 1); p.ring('4', x, y, 18, 9, 1);
  p.obj(() => {
    p.ell('0', x, y, 11, 5); p.ell('a', x, y, 10, 4); p.ell('9', x - 1, y - 1, 7, 2); // body
    p.disc('0', x - 11, y, 4); p.disc('8', x - 11, y, 3); p.r('0', x - 12, y - 1, 1, 1); p.r('0', x - 12, y + 1, 1, 1); p.r('b', x - 14, y, 1, 1); // pale face
    p.r('0', x - 3, y - 2, 5, 3); p.r('o', x - 2, y - 1, 3, 1); // clam
    p.r('b', x + 9, y - 3, 3, 2); p.r('b', x + 9, y + 2, 3, 2); p.r('b', x + 11, y, 4, 1); // feet + tail
  });
}
/** a pair of lobster-pot floats joined by a dotted rope */
function lobsterFloat(p: Painter, x: number, y: number, r: Rng) {
  const k = r.pick(['r', 'f', '7']); const x2 = x + r.int(12, 22), y2 = y + r.int(-6, 6);
  for (let t = 0.15; t < 0.9; t += 0.12) p.r('9', Math.round(x + (x2 - x) * t), Math.round(y + (y2 - y) * t + 1), 1, 1);
  for (const [fx, fy] of [[x, y], [x2, y2]]) { p.r('5', fx - 3, fy + 3, 7, 1); p.disc('0', fx, fy, 3); p.disc(k, fx, fy, 2); p.r('6', fx - 1, fy - 1, 1, 1); }
}
/** a little moored rowboat with its oars shipped */
function rowboat(p: Painter, x: number, y: number) {
  p.shRect(x + 2, y + 4, 12, 26, 4);
  p.r('5', x - 2, y + 34, 20, 1); p.r('4', x + 1, y + 36, 14, 1);
  p.obj(() => {
    p.ell('0', x + 8, y + 17, 9, 18); p.ell('h', x + 8, y + 17, 8, 17); p.ell('a', x + 8, y + 18, 6, 14); p.ell('9', x + 8, y + 18, 5, 13);
    p.r('b', x + 3, y + 12, 10, 2); p.r('b', x + 3, y + 22, 10, 2);
    p.r('0', x - 4, y + 15, 24, 2); p.r('8', x - 3, y + 15, 22, 1); p.r('8', x - 6, y + 14, 3, 4); p.r('8', x + 19, y + 14, 3, 4);
  });
}
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
  for (const [x, dir] of [[94, 1]] as [number, number][]) {
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
/** muted hazard stripes (diagonal), for machine guards and floor zones */
function hazard(p: Painter, x: number, y: number, w: number, h: number) {
  p.r('0', x - 1, y - 1, w + 2, h + 2);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) p.r(((i + j) >> 2) & 1 ? 'h' : '1', x + i, y + j, 1, 1);
}
/** raised catwalk running up the right side: grated deck, handrails with posts, a ladder down now and then */
function catwalk(p: Painter, x: number, w: number, z: Seg) {
  p.shRect(x, 0, w, SEG, 18);
  p.obj(() => {
    p.r('0', x - 1, 0, w + 2, SEG); p.r('q', x, 0, w, SEG);
    for (let y = 0; y < SEG; y += 3) p.r('1', x + 1, y, w - 2, 1);
    for (const rx of [x, x + w - 2]) { p.r('0', rx, 0, 2, SEG); p.r('o', rx, 0, 1, SEG); }
    every(z, 24, 0, y => { if (y > -2 && y < SEG) { p.r('0', x - 1, y, 4, 3); p.r('0', x + w - 3, y, 4, 3); p.r('p', x, y, 2, 2); p.r('p', x + w - 2, y, 2, 2); } });
  });
}
/** steam vent grate in the floor (the burst itself is a foreground flyer) */
function steamVent(p: Painter, x: number, y: number) {
  p.r('0', x, y, 18, 12); p.r('1', x + 1, y + 1, 16, 10); for (let i = x + 2; i < x + 17; i += 3) p.r('q', i, y + 2, 1, 8); p.r('p', x + 1, y + 1, 16, 1);
}
/** loose pile of yarn balls spilled on the floor */
function yarnPile(p: Painter, x: number, y: number, n: number, rng: Rng) {
  p.shEll(x + 10, y + 6, 16, 10, 6);
  p.obj(() => { for (let i = 0; i < n; i++) { const [dk, sh, hi] = rng.pick(DYES); yarnBall(p, x + rng.int(0, 22), y + rng.int(-4, 12), dk, sh, hi); } });
}
const factory: LayerDef = { speed: 1, paint(p, z) {
  const r = z.r;
  // steel floor plates with open grate panels (machinery shows through)
  const grates = new Set<number>(); for (let i = 0; i < 3; i++) grates.add(r.int(0, 5) * 100 + r.int(0, 13));
  for (let y = 0; y < SEG; y += 32) for (let x = 0; x < SW; x += 32) {
    if (grates.has((y / 32 | 0) % 6 * 100 + x / 32) && x > 140 && x < 300) { p.r('0', x, y, 32, 32); for (let i = 2; i < 32; i += 4) p.r('q', x + i, y + 1, 1, 30); p.r('p', x + 1, y, 30, 1); continue; }
    p.r('q', x, y, 32, 32); p.r('v', x, y, 32, 1); p.r('v', x, y, 1, 32); p.r('p', x + 3, y + 3, 1, 1); p.r('p', x + 28, y + 3, 1, 1); p.r('p', x + 3, y + 28, 1, 1); p.r('p', x + 28, y + 28, 1, 1);
  }
  // left: the yarn conveyor along a wall of pipes; right: a raised catwalk over the bins (asymmetric)
  conveyor(p, 94);
  p.shRect(6, 0, 20, SEG, 10); p.obj(() => { p.r('0', 6, 0, 20, SEG); p.r('p', 7, 0, 18, SEG); p.r('o', 9, 0, 2, SEG); p.r('q', 20, 0, 4, SEG); for (let y = 16; y < SEG; y += 64) { p.r('0', 4, y, 24, 8); p.r('q', 5, y + 1, 22, 6); p.r('p', 5, y + 1, 22, 1); } });
  p.obj(() => { p.r('0', 40, 0, 8, SEG); p.r('a', 41, 0, 6, SEG); p.r('9', 41, 0, 1, SEG); for (let y = 30; y < SEG; y += 90) { p.r('0', 38, y, 12, 6); p.r('q', 39, y + 1, 10, 4); } });
  catwalk(p, 372, 30, z);
  // under/next to the catwalk: bins of finished skeins, crates
  for (let y = r.int(10, 40); y < SEG - 30; y += r.int(70, 100)) { if (r.chance(0.5)) { crate(p, 334, y, 30, 30, 'b'); p.obj(() => { for (let i = 0; i < 4; i++) { const [dk, sh, hi] = r.pick(DYES); yarnBall(p, 342 + (i % 2) * 14, y + 8 + (i >> 1) * 14, dk, sh, hi); } }); } else yarnPile(p, 330, y + 8, 5, r); }
  // centre-ish machinery, offset per segment so nothing lines up in a column
  const k = (z.s + r.int(0, 2)) % 4; const cx = r.int(170, 280);
  if (k === 0) { vat(p, cx, r.int(60, 110), 'n', 'm'); hazard(p, cx - 40, 190, 80, 8); }
  else if (k === 1) spinner(p, r.int(150, 220), r.int(30, 140), r);
  else if (k === 2) { vat(p, cx, r.int(90, 160), 'h', 'g'); steamVent(p, cx + 40, 30); }
  else { p.shRect(cx - 55, 150, 110, 40, 10); p.obj(() => { p.r('0', cx - 55, 150, 110, 40); p.r('a', cx - 54, 151, 108, 38); p.r('9', cx - 54, 151, 108, 1); for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { const [dk, sh, hi] = r.pick(DYES); yarnBall(p, cx - 39 + i * 26, 161 + j * 18, dk, sh, hi); } }); hazard(p, cx - 55, 196, 110, 6); }
  if (r.chance(0.6)) steamVent(p, r.int(150, 300), r.int(10, 240));
  if (r.chance(0.5)) yarnPile(p, r.int(150, 290), r.int(20, 230), 3, r);
  p.pool(r.int(160, 300), r.int(40, 220), 44);
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
 * Stratosphere backdrop (screen-fixed): banded altitude light, darkest at the top
 * behind the formation, warmest low on the horizon. Bands are [colour, until-y]. Every
 * seam sits below the formation's lane (y > 180) and is a 48-row ordered-dither gradient
 * (one Bayer level per 3 rows), so there is no hard edge and no scanline stripe.
 * Day is one calm blue with thin haze streaks.
 */
const SKY_BANDS: Record<Tod, [string, number][]> = {
  day: [['n', 360]],
  dawn: [['2', 214], ['3', 290], ['4', 336], ['c', 360]],
  dusk: [['v', 212], ['2', 258], ['e', 316], ['b', 360]],
  night: [['0', 214], ['1', 296], ['v', 360]],
};
const SEAM_H = 48;
function skyBackdrop(p: Painter, tod: Tod) {
  const bands = SKY_BANDS[tod]; const H = p.h;
  let y0 = 0;
  for (const [k, y1] of bands) { p.r(k, 0, y0, SW, y1 - y0); y0 = y1; }
  bands.forEach(([k, y1], i) => {
    const next = bands[i + 1]; if (!next) return;
    // each row of the seam: this colour, with the next one ordered-dithered in at a rising level
    for (let j = 0; j < SEAM_H; j++) { const yy = y1 - SEAM_H / 2 + j; p.r(k, 0, yy, SW, 1); p.dith(next[0], 0, yy, SW, 1, Math.round(((j + 0.5) / SEAM_H) * 16)); }
  });
  const r = new Rng(77);
  // day: long thin haze streaks low down; night: a sprinkle of stars up high
  if (tod === 'day') for (let i = 0; i < 9; i++) { const y = r.int(150, H - 10), x = r.int(-40, SW - 40), w = r.int(40, 120); p.r('3', x, y, w, 1); p.r('3', x + 10, y + 1, w - 24, 1); }
  if (tod === 'night') {
    for (let i = 0; i < 70; i++) p.r(r.pick(['2', '3', '2', '4']), r.int(0, SW - 1), r.int(0, H * 0.7), 1, 1);
    // a low bank of moonlit cloud along the horizon: the last band sits behind it, so no hard seam reads
    for (let x = -30; x < SW + 30; x += r.int(44, 70)) cloudBank(p, x, H - r.int(4, 14), r.int(20, 30), r, ['1', '1', 'v', '2']);
  }
  if (tod === 'dusk') { const sx = 300, sy = H - 26; p.disc('h', sx, sy, 13); p.ell('a', sx + 2, sy + 4, 10, 6); p.r('9', sx - 6, sy - 11, 8, 1); p.r('v', sx - 20, sy - 2, 40, 2); p.r('v', sx - 14, sy + 5, 30, 1); }
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
  // by night a flat one-tone mass would match a horizon band and cut a hard edge through its dither: give it a moonlit body and top
  const keys = p.tod === 'night' ? ['1', 'v', '2', '3'] : [c[0], c[0], c[1], c[1]];
  for (let i = 0; i < 3; i++) cloudBank(p, r.int(-40, SW + 40), r.int(20, SEG - 20), r.int(22, 34), r, keys);
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
/** a litter clump: a small lumpy pellet cluster, lit top-left (2-4px pellets, no speckle) */
function clump(p: Painter, x: number, y: number, r: number, rng: Rng) {
  const n = Math.max(3, Math.round(r * 1.2));
  const pts: [number, number, number][] = [];
  for (let i = 0; i < n; i++) pts.push([x + rng.int(-r, r), y + rng.int(-r, r) * 0.7, rng.int(1, 2)]);
  for (const [px, py, s] of pts) p.r('q', px - 1, py, s + 3, s + 2);
  for (const [px, py, s] of pts) { p.r('9', px, py, s + 1, s + 1); p.r('8', px, py, s, 1); }
}
/** crater: hard light rim on the upper edge, dark inner lip below it, a flat calm floor */
function crater(p: Painter, cx: number, cy: number, rr: number, rng: Rng, litter: boolean) {
  const ry = Math.round(rr * 0.75);
  p.ell('o', cx, cy - 1, rr + 1, ry + 1);   // outer lit rim (shows on top)
  p.ell('q', cx, cy + 1, rr + 1, ry);       // rim shade (bottom)
  p.ell('v', cx, cy, rr, ry);               // dark inner lip
  p.ell('q', cx, cy + Math.max(1, Math.round(ry * 0.25)), rr - 1, ry - Math.max(1, Math.round(ry * 0.25))); // floor in shadow
  p.ell('p', cx + 1, cy + Math.max(2, Math.round(ry * 0.4)), rr * 0.7, ry * 0.5); // sunlit floor
  if (litter) { const n = Math.max(1, Math.round(rr / 10)); for (let i = 0; i < n; i++) clump(p, cx + rng.int(-rr / 2, rr / 3), cy + rng.int(0, ry / 3), rng.int(3, 4), rng); }
}
/** scoop marks: a fan of parallel curved grooves raked through the litter (each groove: dark line + lit lip) */
function scoopMarks(p: Painter, x: number, y: number, w: number, rng: Rng) {
  const tines = rng.int(4, 5); const len = rng.int(26, 40); const bend = rng.range(-0.4, 0.4);
  for (let t = 0; t < tines; t++) for (let j = 0; j < len; j++) {
    const xx = Math.round(x + t * (w / tines) + j * 0.6 + Math.sin(j / len * Math.PI) * bend * 20), yy = y + j;
    p.r('q', xx, yy, 2, 1); p.r('o', xx + 2, yy, 1, 1);
  }
  // the scooped spoil heap at the end of the stroke
  const hx = x + Math.round(w / 2 + len * 0.6), hy = y + len + 4; p.ell('q', hx, hy + 1, w * 0.6, 4); p.ell('o', hx, hy - 1, w * 0.55, 3); p.ell('p', hx, hy, w * 0.5, 3);
}
/** litter-moon regolith: dusty grey with darker mare patches, small wind-ripple dunes (lit crest over a shadow line) and sparse granules, all hard-edged */
function regolith(p: Painter, z: Seg) {
  p.r('p', 0, 0, SW, SEG);
  const r = z.r;
  // one small mare patch toward a side (a lumpy union of ellipses, kept inside the segment so no seam cuts it)
  { const cx = r.chance(0.5) ? r.int(70, 130) : r.int(320, 370), cy = r.int(40, SEG - 40);
    for (let k = 0; k < 4; k++) { const x = cx + r.int(-18, 18), y = cy + r.int(-8, 8); p.ell('q', x, y, r.int(10, 16), r.int(6, 9)); }
    for (let k = 0; k < 3; k++) p.r('p', cx + r.int(-16, 16), cy + r.int(-8, 8), r.int(2, 4), 1); }
  // a few low, broad mounds of the darker tone (small and rounded, never long slabs)
  for (let i = 0; i < 3; i++) { const x = r.int(40, SW - 40), y = r.int(20, SEG - 20), rx = r.int(14, 24), ry = r.int(5, 8); p.ell('q', x + 2, y + 2, rx, ry); p.ell('p', x, y, rx - 2, ry - 2); p.r('o', x - rx + 6, y - ry + 2, rx, 1); }
  // ripple fields: short curved crest lines in packs of 2-3
  for (let i = 0; i < 5; i++) {
    const x0 = r.int(50, SW - 90), y0 = r.int(4, SEG - 20), n = r.int(2, 3), len0 = r.int(20, 36);
    for (let k = 0; k < n; k++) { const len = len0 - k * r.int(4, 9), xs = x0 + k * r.int(2, 6); for (let j = 0; j < len; j++) { const x = xs + j, y = y0 + k * 6 + Math.round(Math.sin(j / len * Math.PI) * -3); p.r('q', x, y + 1, 1, 1); if (j > 1 && j < len - 2) p.r('o', x, y, 1, 1); } }
  }
  for (let i = 0; i < 18; i++) { const x = r.int(4, SW - 6), y = r.int(2, SEG - 4); const s = r.int(1, 3); p.r('q', x, y + 1, s + 1, s); p.r('o', x, y, s, Math.max(1, s - 1)); } // sparse granules
}
/** a moon boulder: lumpy rock lit top-left, with a cast shadow */
function boulder(p: Painter, x: number, y: number, rr: number) {
  p.shEll(x, y, rr, rr * 0.8, Math.round(rr * 2));
  p.obj(() => { p.ell('0', x, y, rr + 1, rr * 0.8 + 1); p.ell('q', x, y, rr, rr * 0.8); p.ell('p', x - 1, y - 1, rr - 1, rr * 0.8 - 1); p.ell('o', x - rr * 0.35, y - rr * 0.35, rr * 0.4, rr * 0.3); p.r('q', x + 1, y + 1, 2, 1); });
}
/** the dog-bowl crater: a perfectly round steel-rimmed bowl pressed into the litter, a few kibble left inside */
function bowlCrater(p: Painter, cx: number, cy: number, rr: number, rng: Rng) {
  p.shEll(cx, cy, rr + 2, (rr + 2) * 0.75, 6);
  p.obj(() => {
    const ry = rr * 0.75;
    p.ell('0', cx, cy, rr + 3, ry + 3); p.ell('o', cx, cy, rr + 2, ry + 2); p.ell('7', cx - 1, cy - 1, rr + 1, ry + 1); p.ell('p', cx, cy, rr, ry);
    p.ell('q', cx + 1, cy + 1, rr - 2, ry - 2); p.ell('v', cx + 2, cy + 2, rr - 5, ry - 5);
    p.r('6', cx - rr + 2, cy - Math.round(ry * 0.5), 3, 1);
    for (let i = 0; i < 7; i++) { const a = rng.range(0, 6.28), d = rng.range(0, rr - 6); const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.7; p.r('0', x, y, 3, 2); p.r('a', x, y, 2, 1); }
    // embossed paw on the rim
    const px = cx + Math.round(rr * 0.55), py = cy + Math.round(ry) + 1; p.r('8', px - 1, py, 3, 1); p.r('8', px - 2, py - 1, 1, 1); p.r('8', px + 2, py - 1, 1, 1);
  });
}
/** small crater with bright ejecta rays (a fresh one: the rays are thin 1px dashes) */
function rayCrater(p: Painter, cx: number, cy: number, rr: number, rng: Rng) {
  for (let i = 0; i < 9; i++) { const a = rng.range(0, 6.28), l0 = rr + 3, l1 = rr + rng.int(8, 18); for (let t = l0; t < l1; t += 2) p.r('o', cx + Math.cos(a) * t, cy + Math.sin(a) * t * 0.8, 1, 1); }
  crater(p, cx, cy, rr, rng, false);
}
/** a trail of paw prints pressed into the litter (four toe beans + a pad, in shadow) */
function pawTrail(p: Painter, x: number, y0: number, y1: number, drift: number) {
  for (let y = y0, i = 0; y < y1; y += 13, i++) {
    const x1 = Math.round(x + (y - y0) * drift) + (i % 2 ? 6 : -6);
    p.r('q', x1 - 1, y + 2, 4, 3); p.r('q', x1 - 2, y, 1, 1); p.r('q', x1, y - 1, 1, 1); p.r('q', x1 + 2, y - 1, 1, 1); p.r('q', x1 + 3, y, 1, 1); p.r('o', x1 - 1, y + 5, 4, 1);
  }
}
/** a half-buried toy: a jingle ball or a mouse tail poking out of the litter */
function buriedToy(p: Painter, x: number, y: number, kind: number) {
  p.shEll(x, y, 4, 3, 4);
  p.obj(() => {
    if (kind === 0) { p.ell('q', x, y + 2, 6, 2); p.disc('0', x, y, 4); p.disc('d', x, y, 3); p.r('c', x - 2, y - 2, 2, 1); p.r('e', x - 3, y, 6, 1); p.r('0', x, y + 1, 1, 1); }
    else { p.ell('q', x, y + 1, 6, 2); p.ell('0', x, y, 5, 3); p.ell('o', x, y - 1, 4, 2); p.r('c', x + 3, y - 3, 2, 1); p.r('0', x + 4, y - 1, 1, 1); p.r('c', x - 5, y, 1, 1); p.r('c', x - 7, y + 1, 2, 1); p.r('c', x - 9, y, 2, 1); }
  });
}
/** the Robo-Scoop rover: a round litter-robot with treads, a sensor dome and a little scoop arm (lights on after dark) */
function rover(p: Painter, x: number, y: number) {
  p.shEll(x, y, 12, 10, 8);
  for (let j = 14; j < 70; j += 6) { p.r('q', x - 13, y + j, 5, 2); p.r('q', x + 9, y + j, 5, 2); } // tread marks behind it
  p.obj(() => {
    p.r('0', x - 14, y - 9, 6, 20); p.r('0', x + 8, y - 9, 6, 20); for (let j = -8; j < 10; j += 3) { p.r('q', x - 13, y + j, 4, 2); p.r('q', x + 9, y + j, 4, 2); }
    p.disc('0', x, y, 11); p.disc('7', x, y, 10); p.disc('o', x + 1, y + 1, 8); p.disc('7', x - 1, y - 1, 6); p.disc('0', x, y, 4); p.disc('m', x, y, 3); p.r('s', x - 1, y - 2, 1, 1);
    p.r('0', x - 4, y - 14, 9, 5); p.r('p', x - 3, y - 13, 7, 3); for (let i = -2; i < 4; i += 2) p.r('q', x + i, y - 13, 1, 3);
    p.glow('q', 'l', x - 7, y - 6, 2, 2, 1.4, 0); p.glow('q', 'r', x + 6, y - 6, 2, 2, 1.4, 0);
  });
}
/** x of the left crater ridge's inner foot at row y (world-spaced so it runs on across segments) */
const ridgeX = (z: Seg, y: number) => { const w = z.wy(y); return 34 + Math.round(Math.sin(w / 83) * 6 + Math.sin(w / 29) * 2); };
/** x where the moon's surface ends on the right (the limb), row y */
const limbX = (z: Seg, y: number) => { const w = z.wy(y); return 410 + Math.round(Math.sin(w / 97) * 5 + Math.sin(w / 23) * 2); };
/**
 * Left edge: the rim of the Great Litter-Box Crater. Seen from above: the outer slope in the
 * sun, a bright crest, the steep inner slope in shadow, boulders and litter clumps on top.
 */
function craterRidge(p: Painter, z: Seg) {
  p.shRect(0, 0, 30, SEG, 10);
  p.obj(() => {
    for (let y = 0; y < SEG; y++) { const x = ridgeX(z, y); p.r('o', 0, y, x - 14, 1); p.r('o', x - 16, y, 4, 1); p.r('7', x - 15, y, 1, 1); p.r('q', x - 12, y, 9, 1); p.r('v', x - 3, y, 3, 1); }
    // terraces on the outer slope: short lit / shaded ledges
    every(z, 40, 7, y => { if (y < -4 || y > SEG + 4) return; const x = ridgeX(z, y) - 22; p.r('p', x - 10, y, 12, 1); p.r('q', x - 10, y + 1, 10, 1); });
    // landslide scars on the inner slope
    every(z, 70, 30, y => { if (y < -12 || y > SEG + 12) return; const x = ridgeX(z, y); for (let j = 0; j < 8; j++) p.r('p', x - 10 + (j >> 1), y + j, 2, 1); });
  });
  every(z, 110, 50, (y, k) => { if (y < 8 || y > SEG - 8) return; const x = ridgeX(z, y); boulder(p, x - 18, y, 3 + (k % 3)); clump(p, x + 6, y + 14, 3, new Rng(k * 7 + 1)); });
}
/**
 * Right edge: the litter moon is tiny, so its limb is in view. The surface ends in a jagged
 * horizon, then black space, a few stars, and now and then the Earth rising (Maya is down there).
 */
function moonLimb(p: Painter, z: Seg) {
  const r = z.r;
  p.obj(() => {
    for (let y = 0; y < SEG; y++) { const x = limbX(z, y); p.r('0', x, y, SW - x, 1); p.r('o', x - 1, y, 1, 1); p.r('q', x - 4, y, 3, 1); }
    // horizon peaks: low bumps on the limb, lit on their sunward side
    every(z, 36, 11, y => { if (y < -6 || y > SEG + 6) return; const x = limbX(z, y); for (let j = -5; j <= 5; j++) { const h = 4 - Math.abs(j) * 0.7; if (h > 0) { p.r('q', x, y + j, Math.ceil(h), 1); p.r('o', x + Math.ceil(h), y + j, 1, 1); } } });
    for (let i = 0; i < 16; i++) { const y = r.int(0, SEG - 1), x = r.int(limbX(z, y) + 4, SW - 1); p.r(r.pick(['4', '5', '5', '6']), x, y, 1, 1); }
    // dusk: the low sun grazes the limb, an amber rim with a magenta afterglow fading into space (emissive, final colours)
    if (p.tod === 'dusk') for (let y = 0; y < SEG; y++) { const x = limbX(z, y); emit(p, 'g', x - 1, y, 1, 1); emit(p, 'h', x, y, 2, 1); emit(p, 'e', x + 2, y, 3, 1); emit(p, (x + y) & 1 ? 'e' : 'v', x + 5, y, 2, 1); emit(p, (x + y) % 4 === 0 ? 'e' : 'v', x + 7, y, 3, 1); }
    // the Earth, rising beyond the limb (clipped by the horizon row by row); at dusk it is up more often (earthrise)
    every(z, p.tod === 'dusk' ? 450 : 900, 300, y => {
      if (y < -40 || y > SEG + 40) return;
      const ex = 438, R = 24;
      const disc = (k: string, cx: number, cy: number, rr: number, ry = rr) => spans(cx, cy, rr, ry, (sx, sy, w) => { const x0 = Math.max(sx, limbX(z, sy) + 1); if (sx + w > x0) p.r(k, x0, sy, sx + w - x0, 1); });
      disc('0', ex, y, R + 1); disc('n', ex, y, R); disc('m', ex - 4, y - 4, R - 7);
      disc('j', ex - 9, y - 6, 7, 5); disc('k', ex - 7, y - 4, 4, 3); disc('j', ex + 4, y + 8, 6, 4); disc('8', ex - 2, y + 9, 3, 2);
      disc('6', ex - 12, y + 4, 5, 1); disc('6', ex + 2, y - 12, 7, 1); disc('5', ex - 4, y + 15, 6, 1);
      disc('2', ex + 14, y + 6, 9, 11); // night side
    });
  });
}
/** Pom's lunar lander: gold-foil descent stage, four splayed legs on round pads, a grey ascent cabin with a lit porthole and a ladder */
function lander(p: Painter, x: number, y: number) {
  p.shRect(x - 13, y - 13, 26, 26, 22);
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) p.shEll(x + dx * 21, y + dy * 21, 4, 3, 2);
  p.obj(() => {
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      for (let t = 10; t < 21; t++) { p.r('0', x + dx * t - 1, y + dy * t - 1, 3, 3); }
      for (let t = 10; t < 21; t++) p.r('o', x + dx * t, y + dy * t, 1, 1);
      p.disc('0', x + dx * 21, y + dy * 21, 4); p.disc('p', x + dx * 21, y + dy * 21, 3); p.r('o', x + dx * 21 - 2, y + dy * 21 - 2, 2, 1);
    }
    p.r('0', x - 14, y - 14, 28, 28); p.r('g', x - 13, y - 13, 26, 26); p.r('f', x - 13, y - 13, 26, 2); p.r('f', x - 13, y - 13, 2, 26); p.r('h', x - 13, y + 11, 26, 2); p.r('h', x + 11, y - 13, 2, 26);
    for (let i = -9; i < 11; i += 5) { p.r('h', x + i, y - 11, 1, 22); }
    p.disc('0', x, y - 1, 10); p.disc('p', x, y - 1, 9); p.disc('o', x - 2, y - 3, 6); p.disc('p', x + 1, y, 4);
    p.disc('0', x - 2, y - 3, 3); p.glow('m', 'f', x - 3, y - 4, 2, 2, 1.4, 0);
    p.r('0', x - 1, y + 13, 3, 8); for (let j = y + 14; j < y + 21; j += 2) p.r('o', x - 1, j, 3, 1); // ladder down to the surface
    // a POM-1 decal: a cream bone on the foil
    p.r('7', x + 4, y + 6, 6, 2); p.r('7', x + 3, y + 5, 2, 1); p.r('7', x + 3, y + 8, 2, 1); p.r('7', x + 9, y + 5, 2, 1); p.r('7', x + 9, y + 8, 2, 1);
  });
}
/** Pom's flag: a cream pennant with a brown paw print, on a thin pole, with a little shadow */
function pomFlag(p: Painter, fx: number, fy: number) {
  p.shRect(fx, fy, 2, 2, 24);
  p.obj(() => { p.r('0', fx - 1, fy - 1, 3, 3); p.r('o', fx, fy, 1, 1); p.r('0', fx + 1, fy - 1, 16, 11); p.r('7', fx + 2, fy, 14, 9); p.r('8', fx + 2, fy + 7, 14, 2); p.r('a', fx + 7, fy + 3, 5, 4); p.r('a', fx + 6, fy + 1, 1, 1); p.r('a', fx + 8, fy, 1, 1); p.r('a', fx + 10, fy, 1, 1); p.r('a', fx + 12, fy + 1, 1, 1); });
}
const moon: LayerDef = { speed: 1, opaque: true, paint(p, z) {
  const r = z.r;
  regolith(p, z);
  for (let i = 0; i < 3; i++) crater(p, r.int(60, SW - 60), r.int(10, SEG - 10), r.int(4, 8), r, false);
  if (r.chance(0.7)) rayCrater(p, r.chance(0.5) ? r.int(70, 120) : r.int(320, 370), r.int(30, SEG - 30), r.int(5, 8), r);
  const kind = z.s % 4; // 0 litter crater, 1 lander, 2 rover, 3 flag + boulders
  crater(p, r.int(150, SW - 150), r.int(30, SEG - 30), r.int(12, 18), r, true);
  if (kind === 0) crater(p, r.chance(0.5) ? r.int(84, 120) : r.int(320, 356), r.int(50, SEG - 50), r.int(26, 32), r, true);
  if (z.s % 2 === 0) scoopMarks(p, r.int(90, 300), r.int(10, 120), r.int(26, 40), r);
  for (let i = 0; i < 3; i++) clump(p, r.int(60, SW - 60), r.int(10, SEG - 10), r.int(3, 5), r);
  // a paw-print trail wandering up the tray (Pom was here first)
  pawTrail(p, r.int(250, 330), 0, SEG, r.range(-0.15, 0.15));
  if (r.chance(0.6)) buriedToy(p, r.int(70, 380), r.int(20, SEG - 20), r.int(0, 1));
  const left = r.chance(0.5); const ex = left ? r.int(72, 96) : r.int(350, 374), ey = r.int(60, 190);
  if (kind === 1) { lander(p, ex, ey); pomFlag(p, ex + (left ? 30 : -46), ey + 30); }
  else if (kind === 2) rover(p, ex, r.int(30, 170));
  else if (kind === 3) { pomFlag(p, ex, ey); boulder(p, ex + 24, ey + 20, 5); boulder(p, ex - 14, ey + 36, 3); }
  for (let i = 0; i < 2; i++) boulder(p, r.chance(0.5) ? r.int(50, 100) : r.int(340, 395), r.int(12, SEG - 12), r.int(2, 4));
  // a scatter of rocks across the field (they cast the long low-sun shadows at dawn and dusk)
  for (let i = 0; i < 5; i++) { const bx = r.int(60, 390), by = r.int(10, SEG - 10); boulder(p, bx, by, r.int(3, 6)); if (r.chance(0.6)) boulder(p, bx + r.int(6, 12), by + r.int(-6, 6), 2); }
  if (kind === 0 || kind === 2) bowlCrater(p, left ? r.int(300, 360) : r.int(90, 150), r.int(40, SEG - 40), r.int(16, 20), r);
  // a second, fainter boot-and-paw trail from the lander out across the field
  if (kind === 1 || kind === 3) pawTrail(p, left ? r.int(110, 150) : r.int(300, 340), r.int(0, 60), SEG, left ? 0.2 : -0.2);
  // edges: the Great Litter-Box Crater's rim on the left, the moon's limb (space, and the Earth now and then) on the right
  craterRidge(p, z); moonLimb(p, z);
} };
/** fg: the shadow of an orbiting probe sweeping over the regolith + a few dust motes */
const moonFg: LayerDef = { speed: 1.6, paint(p, z) {
  const r = z.r;
  if (r.chance(0.25)) { const x = r.int(60, 380), y = r.int(40, 200); p.r('q', x - 10, y - 2, 20, 5); p.r('q', x - 2, y - 10, 5, 20); p.r('q', x - 18, y, 8, 1); p.r('q', x + 10, y, 8, 1); }
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
  for (let j = -4; j <= 4; j++) { const hw = Math.round(Math.sqrt(1 - (j / 5) ** 2) * 8 * (1 - Math.abs(j) / 14)); p.glow('2', j < -1 ? 't' : 'u', cx - hw, cy + j, hw * 2 + 1, 1, 1.5, 0); }
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
  // outer hull: lower sponson decks fill the strips beyond the main hull (a step darker so the main deck reads on top),
  // with rib seams, docking-clamp blocks and dim running lights; a thin gap of space shows between the decks
  for (const [x0, x1] of [[0, L - 4], [R + 4, SW]] as [number, number][]) {
    const w = x1 - x0, outer = x0 === 0;
    p.r('0', x0, 0, w, SEG);
    for (let y = 0; y < SEG; y += 24) {
      p.r('1', x0 + (outer ? 6 : 0), y + 1, w - 6, 23); p.r('v', x0 + (outer ? 6 : 0), y + 1, w - 6, 1);
      p.r('0', x0 + (outer ? 6 : 0), y + 23, w - 6, 1);
      const v = (Math.floor(z.wy(y) / 24) + (outer ? 0 : 2)) % 4;
      if (v === 0) { const bx = outer ? x0 + 16 : x0 + w - 36; p.r('0', bx, y + 5, 20, 14); p.r('v', bx + 1, y + 6, 18, 12); p.r('2', bx + 1, y + 6, 18, 1); p.r('0', bx + 4, y + 10, 12, 4); }
      else if (v === 2) for (let i = 0; i < 3; i++) p.r('0', x0 + (outer ? 12 : 6) + i * 14, y + 10, 8, 2);
    }
    // an armoured rail along the outer rim of the sponson
    const rx = outer ? x0 + 2 : x1 - 6; p.r('v', rx, 0, 4, SEG); p.r('2', outer ? rx : rx + 3, 0, 1, SEG);
    every(z, 48, outer ? 10 : 34, y => { if (y > 2 && y < SEG - 2) p.glow('1', outer ? 'u' : 't', outer ? x0 + 3 : x1 - 5, y, 2, 2, 1, 0.3); });
  }
  // ear-shaped fins along both hull edges (pointing forward, like a cat's ears)
  for (const [x0, dir] of [[L, -1], [R, 1]] as [number, number][]) every(z, 128, 40, y => {
    for (let j = 0; j < 56; j++) { const out = Math.round(Math.min(j, 56 - j * 0.6) * 0.75); if (out <= 0) continue; const xa = dir > 0 ? x0 : x0 - out; p.r('0', xa - 1, y - 56 + j, out + 2, 1); p.r('v', xa, y - 56 + j, out, 1); const inner = Math.round(out * 0.45); if (j > 10 && inner > 1) p.r('2', dir > 0 ? x0 + 3 : x0 - 3 - inner, y - 56 + j, inner, 1); }
  });
  p.r('u', L, 0, 1, SEG); p.r('u', R - 1, 0, 1, SEG);
  p.r('0', 326, 0, 12, SEG); p.r('q', 327, 0, 10, SEG); p.r('p', 327, 0, 1, SEG); p.r('v', 335, 0, 2, SEG); for (let y = 6; y < SEG; y += 52) { p.r('0', 324, y, 16, 8); p.r('1', 325, y + 1, 14, 6); p.glow('1', 'd', 330, y + 3, 4, 2, 1, 0.5); }
  yarnCable(p, 118, z);
  // hull plating seams, vent grilles and glowing conduit panels, scattered asymmetrically
  for (let i = 0; i < 4; i++) {
    const kx = r.int(0, 3), x = [140, 200, 268, 300][kx] + r.int(-8, 8), y = r.int(4, SEG - 40);
    const kind = r.int(0, 2);
    if (kind === 0) { p.r('0', x, y, 28, 16); p.r('1', x + 1, y + 1, 26, 14); for (let j = y + 3; j < y + 14; j += 3) p.r('0', x + 3, j, 22, 1); p.r('2', x + 1, y + 1, 26, 1); }
    else if (kind === 1) { p.r('0', x, y, 10, 36); p.r('1', x + 1, y + 1, 8, 34); p.glow('2', 'u', x + 3, y + 3, 4, 30, 1.5, 0); p.lateBars.push([x + 3, y + 12, 4, 1], [x + 3, y + 23, 4, 1]); }
    else { p.r('2', x, y, 40, 1); p.r('1', x, y + 1, 40, 1); for (let k = 0; k < 4; k++) p.r('2', x + 4 + k * 10, y + 4, 2, 2); }
  }
  // a long seam break so the plates do not read as a perfect grid
  { const sy = r.int(20, SEG - 20); p.r('0', 72, sy, SW - 144, 2); p.r('2', 72, sy + 2, SW - 144, 1); }
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
  every(z, 160, 20, y => { if (y > 8 && y < SEG - 8) catEye(p, 96, y); });
  every(z, 224, 130, y => { if (y > 8 && y < SEG - 8) catEye(p, 352, y); });
} };

// ---------------------------------------------------------------- fast foreground flyers
/**
 * Rare, short-lived foreground silhouettes drawn every frame (fast parallax: they
 * cross the playfield in a second or two, then nothing for several seconds).
 * Dark and sparse; drawn with the background, so they never cover cats.
 */
type FlyKind = 'birds' | 'leaves' | 'steam' | 'wisps' | 'debris';
const flyers = (kind: FlyKind, period = 520) => (px: Px, _scroll: number, t: number, seed: number, tod: Tod) => {
  const ev = Math.floor(t / period), lt = t - ev * period; const r = new Rng(seed * 31 + ev * 977 + 7);
  const dur = kind === 'steam' ? 150 : kind === 'wisps' ? 110 : 100;
  if (ev === 0 || lt >= dur) return;
  const f = lt / dur;
  const dark = tod === 'night' ? '0' : '1';
  if (kind === 'birds') { // a small flock crossing diagonally, wings flapping
    const fromLeft = r.chance(0.5); const y0 = r.int(40, 300), dy = r.int(-90, 90);
    const n = r.int(3, 5);
    for (let i = 0; i < n; i++) {
      const lag = i * 0.05, ff = f - lag; if (ff < 0) continue;
      const x = Math.round(fromLeft ? -20 + ff * 500 : 470 - ff * 500) + (i % 2) * 8, y = Math.round(y0 + dy * ff + i * 7 - (i % 2) * 12);
      const up = ((t >> 3) + i) & 1;
      px(dark, x - 1, y, 3, 2); // body
      if (up) { px(dark, x - 5, y - 2, 4, 1); px(dark, x + 2, y - 2, 4, 1); px(dark, x - 3, y - 1, 2, 1); px(dark, x + 2, y - 1, 2, 1); }
      else { px(dark, x - 5, y + 1, 4, 1); px(dark, x + 2, y + 1, 4, 1); }
    }
  } else if (kind === 'leaves') { // a gust of a few leaves tumbling across
    const n = r.int(4, 7); const ks = tod === 'night' ? ['0', '1'] : ['1', 'b', 'k'];
    for (let i = 0; i < n; i++) {
      const sx = r.int(-40, 100), sy = r.int(20, 300), sp = r.range(380, 520);
      const x = Math.round(sx + f * sp), y = Math.round(sy + f * r.int(40, 120) + Math.sin(f * 12 + i) * 6);
      const k = ks[i % ks.length]; const ph = ((t >> 2) + i) & 3;
      if (ph === 0) px(k, x, y, 3, 2); else if (ph === 1) px(k, x, y, 2, 3); else if (ph === 2) { px(k, x, y, 3, 1); px(k, x + 1, y + 1, 2, 1); } else px(k, x, y, 1, 3);
    }
  } else if (kind === 'steam') { // a vent burst drifting up and sideways, solid dark puffs (no halftone)
    const x0 = r.int(100, 330), y0 = r.int(120, 340); const ks = tod === 'night' ? ['1', 'v'] : ['q', 'v'];
    for (let i = 0; i < 5; i++) {
      const ff = f - i * 0.08; if (ff < 0 || ff > 0.85) continue;
      const rr = Math.round(3 + ff * 9); const x = Math.round(x0 + ff * 40 + Math.sin(ff * 6 + i) * 5), y = Math.round(y0 - ff * 90 - i * 4);
      for (let j = -rr; j <= rr; j++) { const hw = Math.round(Math.sqrt(rr * rr - j * j)); px(ks[ff > 0.5 ? 1 : 0], x - hw, y + j, hw * 2, 1); }
    }
  } else if (kind === 'wisps') { // a fast cloud wisp streaking past one edge
    const left = r.chance(0.5); const x0 = left ? r.int(30, 90) : r.int(330, 400); const y = Math.round(-80 + f * 560);
    const ks = tod === 'night' ? ['1', '2'] : tod === 'dusk' ? ['v', 'e'] : ['3', '4'];
    for (let i = 0; i < 4; i++) { const w = 26 - i * 5, x = x0 + i * 3 - (i & 1) * 6, yy = y + i * 9; px(ks[0], x, yy, w, 3); px(ks[1], x + 2, yy, w - 6, 1); }
  } else { // debris: a couple of tumbling rocks / hull scraps
    for (let i = 0; i < r.int(2, 4); i++) {
      const sx = r.int(70, 370), dx = r.int(-60, 60); const x = Math.round(sx + dx * f), y = Math.round(-20 + f * r.int(400, 520) - i * 30);
      const ph = ((t >> 3) + i) & 1; px('0', x - 1, y - 1, 6, 5); px(ph ? 'q' : 'v', x, y, 4, 3); px('p', x + (ph ? 0 : 2), y, 2, 1);
    }
  }
};
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

/** rooftops: at dawn the roof decks go rose-plum (never the periwinkle of night); at dusk the tar takes the warm taupe */
const ROOF_RAMPS: Partial<Record<Tod, Ramp>> = { dawn: ramp('q:v p:q o:p', TOD_RAMP.dawn) };
/** docks: dawn water takes the sunrise (deep blue with a rose cast, pink crests); the dusk harbour mirrors the
 * sunset (plum-magenta water, amber crests); by night the water is dark blue and the planks stay a moonlit step above it */
const DOCK_RAMPS: Partial<Record<Tod, Ramp>> = {
  dawn: ramp('n:3n/8 2:e m:c s:c 5:c', TOD_RAMP.dawn),
  dusk: ramp('n:nv/8 2:h m:g s:f 5:d 4:e', TOD_RAMP.dusk),
  night: ramp('n:2 2:1 m:n p:qp/8 o:p', TOD_RAMP.night),
};
/** alley: a pale concrete day; a cool lavender-grey dawn (peach on the top edges); a warm taupe dusk (amber rims, plum
 * shadows); a slate night under the lamps */
const ALLEY_RAMPS: Partial<Record<Tod, Ramp>> = {
  day: ramp('q:p p:o v:q'),
  dawn: ramp('p:4p/8 q:3q/8 v:q 1:v o:8 7:c 5:c', TOD_RAMP.dawn),
  dusk: ramp('p:pa/8 q:qb/8 v:vb/8 1:v', TOD_RAMP.dusk),
};
/** park: by night the path stays a step above the dark lawn */
const PARK_RAMPS: Partial<Record<Tod, Ramp>> = { night: ramp('q:3q/8 p:3', TOD_RAMP.night) };
/** the litter moon: each hour its own dust colour (grey day, cool indigo dawn, warm umber dusk, navy night) */
const MOON_RAMPS: Partial<Record<Tod, Ramp>> = {
  // harsh sunlight: the litter sits a step below mid-grey so grey cats keep their contrast
  day: ramp('p:q o:p q:v v:1 8:9 7:8'),
  // sunrise over the tray: cool indigo-grey dust, pink-lit crests and clumps
  dawn: ramp('p:2 o:3 q:v v:1 1:1 8:c 7:c 9:a 6:7 5:c'),
  // low amber sun: warm umber dust, orange crests, long plum shadows cast east and an earthrise glow on the limb
  dusk: ramp('p:b o:h q:v v:1 1:0 8:g 9:h 7:g 6:f 5:t 4:u 3:2 2:v'),
  // earthshine: navy dust with periwinkle crests, lights on
  night: ramp('o:2 p:2v/8 q:1 v:0 9:a 8:9 7:8 6:5 5:4 4:3 3:2 2:1'),
};
/** street: a sunlit day (pale sidewalks and roofs a step up from the asphalt) */
const STREET_RAMPS: Partial<Record<Tod, Ramp>> = { day: ramp('q:p p:o') };
export const TILESETS: Record<string, Tileset> = {
  backyard: { id: 'backyard', speed: 0.4, base: 'k', main: backyard, fg: yardFg(['1', 'k', 'j'], 0.6, 0), anim: both(flyers('birds', 460), flyers('leaves', 610)) },
  street: { id: 'street', speed: 0.6, base: 'v', ramps: STREET_RAMPS, main: street, fg: yardFg(['1', 'k', 'j'], 0.7, 0), anim: both(steamAnim(188, 300, 120), flyers('birds', 540)) },
  park: { id: 'park', speed: 0.45, base: 'k', ramps: PARK_RAMPS, main: park, fg: yardFg(['1', 'k', 'j'], 0.5, 0), anim: both(flyers('leaves', 430), flyers('birds', 700)) },
  alley: { id: 'alley', speed: 0.5, base: 'v', ramps: ALLEY_RAMPS, main: alley, fg: laundryFg, anim: both(steamAnim(262, 280, 60), flyers('steam', 380)) },
  rooftops: { id: 'rooftops', speed: 0.55, base: '1', ramps: ROOF_RAMPS, far: cityBelow, main: rooftops, fg: pigeonsFg, anim: flyers('birds', 420) },
  cafe: { id: 'cafe', speed: 0.4, base: 'b', indoor: true, main: cafe, fg: pendantsFg },
  docks: { id: 'docks', speed: 0.5, base: 'n', ramps: DOCK_RAMPS, far: water, main: docks, fg: gullsFg, anim: flyers('birds', 500),
    fxAfter: 'far', fx: (ctx, scroll, t, _s, tod) => {
      // sparse 2-3px wave glints drifting at their own parallax speed (slower than the planks, faster than the swell lattice)
      const [k0, k1] = tod === 'night' ? ['3', '4'] : tod === 'dusk' ? ['g', 'f'] : tod === 'dawn' ? ['4', 'c'] : ['m', '4'];
      for (let i = 0; i < 26; i++) {
        const ph = (t / 90 + i * 0.37) % 1; if (ph > 0.7) continue;
        const x = 110 + ((i * 97 + Math.floor(t / 6) * (i % 3 === 0 ? 1 : 0)) % 334), y = Math.floor((i * 53 + scroll * 0.82) % 380) - 10;
        const len = ph < 0.2 || ph > 0.5 ? 2 : 3; ctx.fillStyle = col(ph < 0.35 ? k1 : k0); ctx.fillRect(x, y, len, 1);
        if (len === 3) ctx.fillRect(x + 1, y - 1, 1, 1);
      }
    } },
  factory: { id: 'factory', speed: 0.6, base: '1', far: factoryFar, main: factory, fg: girdersFg, fx: factoryFx, rim: false, anim: flyers('steam', 300) },
  sky: { id: 'sky', speed: 0.8, base: 'n', backdrop: skyBackdrop, rim: false, far: skyFar, main: skyMain, fg: wispsFg, ramps: SKY_RAMPS, anim: both(flyers('wisps', 200), flyers('birds', 650)) },
  nebula: { id: 'nebula', speed: 0.7, space: true, base: '0', far: starFar('0', 80), main: nebulaMain, fg: streaksFg, anim: both(twinkle(['4', 't', 'l']), flyers('debris', 480)) },
  moon: { id: 'moon', speed: 0.35, space: true, base: 'p', ramps: MOON_RAMPS, main: moon, fg: moonFg, anim: flyers('debris', 560) },
  station: { id: 'station', speed: 0.5, space: true, base: '0', far: starFar('0', 90), main: station, anim: both(twinkle(['4', 'l']), earLights, flyers('debris', 600)) },
  mothership: { id: 'mothership', speed: 0.7, space: true, base: '0', far: motherFar, main: mothership, anim: both(navLights([74, 374], 96, ['r', 'l', 'd']), flyers('debris', 450)) },
};
TILESETS.space = TILESETS.nebula;
