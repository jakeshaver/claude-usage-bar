// World tilesets: each area is a stack of parallax layers (far / main / fg).
// Each layer is painted in 448x256 segments (8 rows of 32px tiles) by a seeded
// painter, then cached per time-of-day. Backgrounds are authored in dark,
// low-noise, mostly neutral mid-tones with a guaranteed value gap from the
// darkest cat colours (indigo / dark brown bodies with ink outlines), so cats,
// turds and hairballs pop (Galaga readability).
import { Rng, hash } from '../core/rng';
import { col, KEY } from '../core/palette';
import type { Tod } from '../core/types';
import { Painter, spans, bayer, ramp, remap, TOD_RAMP, SHADE, SHADE_TOD, type Ramp } from './paint';
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
  // night: the leaves turn a moonlit blue-green (never the lawn's own dark green, so the canopy keeps its fill)
  // night: a dark green crown (same green as the lawn) held by ink shading and moonlit teal tips, never flat blue
  // (the night lawn ground goes dark (k -> deep night), so the crown is painted in j, which keeps the dark green)
  // (the night lawn keeps its k ground; the crown is a darker mass than the lawn: plum-shadowed leaves with moonlit green tops)
  if (p.tod === 'night') keys = keys[1] === 'k' ? ['0', 'v', 'k'] : keys;
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
/**
 * Grass blades: a carpet of short 2px-wide blades in 'j' (some with an 'i' tip) on the 'k' ground, on a jittered
 * grid (never a 1px checker or 1px stripe). The density and the remap set the hour: day a sunlit carpet with lime
 * tips, dawn a sparser one with peach tips (i -> pink), dusk a dense carpet of brown blades with orange tips (olive-gold
 * at a glance), night all blades melt into one dark teal-green (lamp pools bring them back).
 */
function lawnBlades(p: Painter, x0: number, y0: number, w: number, h: number, base = 'k', calm = false) {
  // (night keeps a carpet too: it melts into the ground, and only shows where a lamp pool lights it)
  // calm: a mown garden lawn (sparser blades, few bright tips, so a dusk lawn stays quiet)
  // night: a dense carpet of deep-night blades (j -> 1) shades the dark teal-green ground, so the lawn reads clearly
  // darker than by day but still green; only a few moonlit teal tips (half the daytime tick density)
  const night = p.tod === 'night';
  const dens = (p.tod === 'day' ? 0.26 : p.tod === 'dawn' ? 0.12 : p.tod === 'dusk' ? 0.17 : 0.12) * (calm ? (night ? 0.85 : 0.6) : 1);
  const tipP = (p.tod === 'dusk' ? 0.32 : p.tod === 'dawn' ? 0.45 : night ? 0.12 : 0.25) * (calm ? 0.25 : 1);
  const kb = KEY.indexOf(base), kj = KEY.indexOf('j'), ki = KEY.indexOf('i'), k9 = KEY.indexOf('9'), k1 = KEY.indexOf('1'), kf = KEY.indexOf('f');
  const B = p.buf, W = p.w, H = p.h;
  const put = (xx: number, yy: number, k: number) => { if (xx < x0 || xx >= x0 + w || xx >= W || yy >= H || yy < 0) return; const o = yy * W + xx; if (B[o] === kb) B[o] = k; };
  for (let y = y0; y < y0 + h - 3; y += 4) for (let x = x0; x < x0 + w - 2; x += 5) {
    const g = (Math.imul((x + 7) * 73856093 ^ (y + 3) * 19349663, 0x27d4eb2d) >>> 0);
    if ((g & 1023) / 1024 > dens * 2.2) continue;
    const bx = x + (g >>> 10) % 3, by = y + 1 + ((g >>> 13) & 1), len = 2 + ((g >>> 15) & 1);
    const body = kj; void k9;
    if (p.tod === 'dusk') {
      // dusk: the low west sun lays each blade's shadow out long and flat to the east (a 2px plum dash) and catches its tip
      const L = 2 + ((g >>> 19) & 3);
      for (const [dy, l] of [[len - 2, L], [len - 1, L + 1]] as [number, number][]) for (let i = 0; i < l; i++) put(bx + 1 + i, by + dy, k1);
      put(bx, by - 1, ((g >>> 22) & 1023) / 1024 < tipP ? kf : kb); put(bx, by, ((g >>> 22) & 1023) / 1024 < tipP * 2 ? kj : kb);
      continue;
    }
    for (let j = 0; j < len; j++) { put(bx, by + j, body); put(bx + 1, by + j, body); }
    // a pointed 1px tip on one side of the blade top (lime by day, peach at dawn, orange at dusk)
    put(bx + ((g >>> 18) & 1), by - 1, ((g >>> 22) & 1023) / 1024 < tipP ? ki : body);
  }
}
function tuft(p: Painter, k: string, x: number, y: number) { p.r(k, x, y, 1, 2); p.r(k, x + 2, y - 1, 1, 3); p.r(k, x + 4, y, 1, 2); }
function grass(p: Painter, x: number, y: number, w: number, h: number, rng: Rng, base = 'k', hi = 'j', density = 1, calm = false) {
  p.r(base, x, y, w, h); lawnBlades(p, x, y, w, h, base, calm);
  const n = Math.floor((w * h) / 520 * density);
  for (let i = 0; i < n; i++) tuft(p, rng.chance(0.75) ? hi : '1', x + rng.int(1, w - 6), y + rng.int(2, h - 2));
}
/** street lamp in 3/4 view: foot at (x, y), a post rising 16px, a lantern head (lit after dusk); the pool is centred on the foot.
 * arm != 0: a gooseneck lamp whose head hangs out `arm` px to the side (over a path), with its pool centred under the head */
function lamp(p: Painter, x: number, y: number, r = 40, clip?: [number, number, number, number], spill = false, arm = 0) {
  p.shRect(x - 1, y - 1, 3, 3, 16);
  const hx = x + arm;
  p.obj(() => {
    p.r('0', x - 2, y - 1, 5, 3); p.r('q', x - 1, y, 3, 1);
    p.r('0', x - 1, y - 17, 3, 17); p.r('p', x, y - 16, 1, 16);
    if (arm) { const a0 = Math.min(x, hx), a1 = Math.max(x, hx); p.r('0', a0, y - 19, a1 - a0 + 1, 3); p.r('p', a0 + 1, y - 18, a1 - a0 - 1, 1); }
    p.r('0', hx - 3, y - 23, 7, 7); p.r('q', hx - 2, y - 22, 5, 5); p.r('0', hx - 2, y - 24, 5, 1);
    p.glow('p', 'f', hx - 1, y - 21, 3, 3, 1, 0); p.glow('o', '7', hx, y - 20, 1, 1, 1, 0);
  });
  p.pool(hx, y + 1, r, clip, spill);
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
/** a flat roof: parapet rim, then a deck of one of several surfaces (kind: 0 membrane squares, 1 long membrane runs,
 * 2 terracotta pavers, 3 a sedum green roof, 4 a cool white coating with drain sumps) */
function roof(p: Painter, x: number, y: number, w: number, h: number, height: number, tar = 'q', rim = 'p', kind = 0) {
  const d = p.deferShadows; p.deferShadows = false; p.shRect(x, y, w, h, height); p.deferShadows = d;
  p.obj(() => {
    p.r('0', x, y, w, h);
    p.r(rim, x + 1, y + 1, w - 2, h - 2);
    p.r('o', x + 1, y + 1, w - 2, 1); p.r('o', x + 1, y + 1, 1, h - 2);
    const ix = x + 4, iy = y + 4, iw = w - 8, ih = h - 8;
    if (kind === 2) { // terracotta pavers: 16px tiles with mortar joints, a few lighter tiles
      p.r('h', ix, iy, iw, ih);
      for (let gy = iy, n = 0; gy < iy + ih; gy += 16, n++) for (let gx = ix + (n & 1) * 8 - 8; gx < ix + iw; gx += 16) { const tx = Math.max(ix, gx), tw = Math.min(gx + 16, ix + iw) - tx; if (tw <= 1) continue; if (((gx * 7 + gy * 3) >> 4) % 5 === 0) p.r('g', tx + 1, gy + 1, tw - 2, Math.min(14, iy + ih - gy - 2)); p.r('a', tx, gy, tw, 1); p.r('a', tx, gy, 1, Math.min(16, iy + ih - gy)); }
    } else if (kind === 3) { // sedum: a green carpet of clumps in planted squares, a gravel walkway round the edge
      p.r('q', ix, iy, iw, ih); p.r('k', ix + 4, iy + 4, iw - 8, ih - 8);
      for (let gy = iy + 7; gy < iy + ih - 6; gy += 7) for (let gx = ix + 7 + ((gy * 5) % 11); gx < ix + iw - 6; gx += 13) { p.r('j', gx, gy, 3, 2); p.r(((gx + gy) % 7) ? 'i' : 'c', gx + 1, gy - 1, 1, 1); }
    } else if (kind === 4) { // reflective white coating, a pale grid of seams and two drain sumps
      p.r('q', ix, iy, iw, ih); p.r('v', ix, iy, iw, 1); p.r('v', ix, iy, 1, ih);
      for (let gx = ix + 24; gx < ix + iw - 4; gx += 24) { p.r('o', gx, iy + 1, 1, ih - 2); p.r('v', gx + 1, iy + 1, 1, ih - 2); }
      for (const [dx, dy] of [[iw >> 2, ih >> 1], [(iw * 3) >> 2, ih >> 1]]) { p.disc('p', ix + dx, iy + dy, 3); p.disc('q', ix + dx, iy + dy, 2); }
    } else if (kind === 1) { // long membrane runs with lapped seams across the deck
      p.r(tar, ix, iy, iw, ih); p.r('v', ix, iy, iw, 1); p.r('v', ix, iy, 1, ih);
      for (let gy = iy + 12; gy < iy + ih - 4; gy += 12) { p.r('v', ix + 1, gy, iw - 2, 1); p.r(tar === 'q' ? 'p' : tar, ix + 1, gy + 1, iw - 2, 1); }
    } else {
      p.r(tar, ix, iy, iw, ih);
      p.r('v', ix, iy, iw, 1); p.r('v', ix, iy, 1, ih);
      for (let gx = ix + T; gx < x + w - 4; gx += T) p.r('v', gx, y + 5, 1, h - 9);
      for (let gy = iy + T; gy < y + h - 4; gy += T) p.r('v', x + 5, gy, w - 9, 1);
    }
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
  p.obj(() => { p.r('0', x, y, w, h); p.r('p', x + 1, y + 1, w - 2, h - 2); p.glow('n', 'g', x + 2, y + 2, w - 4, h - 4, chance, roll); p.glow('m', 'f', x + 3, y + 3, 3, 2, chance, roll); });
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
function doghouse(p: Painter, x: number, y: number, bowl = true) {
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
  if (bowl) p.obj(() => {
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
/** a blue-painted tool shed (3/4 view): plank roof with a ridge, a front wall with a door and a little window */
function shed(p: Painter, x: number, y: number) {
  const w = 40, rh = 26;
  p.shRect(x, y, w, rh + 12, 20);
  p.obj(() => {
    p.r('0', x, y + rh - 1, w, 14); p.r('n', x + 1, y + rh, w - 2, 12); for (let i = x + 4; i < x + w - 2; i += 5) p.r('2', i, y + rh, 1, 12);
    p.r('0', x + 6, y + rh + 2, 10, 11); p.r('b', x + 7, y + rh + 3, 8, 10); p.r('f', x + 13, y + rh + 8, 1, 1); // door
    p.r('0', x + 24, y + rh + 3, 10, 6); p.glow('2', 'f', x + 25, y + rh + 4, 8, 4, 0.8, 0.3); p.lateBars.push([x + 29, y + rh + 4, 1, 4]);
    p.r('0', x - 2, y - 1, w + 4, rh + 1); p.r('p', x - 1, y, w / 2 + 1, rh); p.r('q', x + w / 2, y, w / 2 + 1, rh);
    for (let j = 4; j < rh; j += 5) { p.r('q', x - 1, y + j, w / 2, 1); p.r('v', x + w / 2 + 1, y + j, w / 2, 1); }
    p.r('o', x + w / 2 - 1, y, 1, rh); p.r('0', x + w / 2, y, 1, rh); p.r('0', x - 2, y + rh - 1, w + 4, 1);
  });
}
/** a sandbox: a wooden frame of sand with a red bucket, a spade and a half-built castle */
function sandbox(p: Painter, x: number, y: number) {
  const w = 40, h = 32;
  p.shRect(x, y, w, h, 3);
  p.obj(() => {
    p.r('0', x - 1, y - 1, w + 2, h + 2); p.r('a', x, y, w, h); p.r('9', x, y, w, 1); p.r('9', x, y, 1, h); p.r('8', x + 3, y + 3, w - 6, h - 6); p.r('9', x + 3, y + h - 5, w - 6, 2);
    p.r('9', x + 22, y + 9, 10, 8); p.r('8', x + 22, y + 9, 10, 2); p.r('9', x + 24, y + 6, 2, 3); p.r('9', x + 29, y + 6, 2, 3); // castle
    p.disc('0', x + 11, y + 20, 4); p.disc('r', x + 11, y + 20, 3); p.r('c', x + 9, y + 18, 2, 1); // bucket
    p.r('0', x + 6, y + 8, 2, 8); p.r('m', x + 5, y + 6, 4, 3);
  });
}
/** lawn chairs and a cooler (for the patio) */
function chairsCooler(p: Painter, x: number, y: number) {
  p.shRect(x + 20, y, 16, 12, 6);
  p.obj(() => { p.r('0', x + 20, y, 16, 12); p.r('m', x + 21, y + 1, 14, 10); p.r('6', x + 21, y + 1, 14, 3); p.r('0', x + 25, y + 2, 6, 1); });
  for (const [cx, cy, k] of [[x, y + 2, 'g'], [x + 2, y + 22, 'm']] as [number, number, string][]) {
    p.shRect(cx, cy, 14, 14, 6);
    p.obj(() => { p.r('0', cx, cy, 14, 14); for (let j = 0; j < 12; j += 3) p.r(j % 6 ? k : '7', cx + 1, cy + 1 + j, 12, 3); p.r('0', cx, cy + 6, 14, 1); p.r('0', cx - 1, cy + 3, 1, 9); p.r('0', cx + 14, cy + 3, 1, 9); });
  }
}
/** a kettle BBQ (3/4 view): red enamel kettle on legs and a wheel, its lid hooked open on the side, a grate of
 * sausages and a patty over the coals (glowing after dusk), and a side shelf with a plate and tongs */
function bbq(p: Painter, x: number, y: number) {
  const cx = x + 14, cy = y + 12;
  p.shEll(cx, cy + 4, 10, 8, 14);
  p.obj(() => {
    p.r('0', cx - 9, cy + 6, 2, 10); p.r('0', cx + 8, cy + 6, 2, 10); p.r('0', cx - 1, cy + 8, 2, 10);
    p.r('p', cx - 9, cy + 7, 1, 8); p.r('p', cx - 1, cy + 9, 1, 8);
    p.disc('0', cx - 9, cy + 16, 2); p.r('q', cx - 10, cy + 15, 1, 1);
    p.ell('0', cx, cy + 2, 11, 9); p.ell('e', cx, cy + 2, 10, 8); p.ell('r', cx - 1, cy + 1, 8, 6); p.r('c', cx - 7, cy + 1, 2, 2);
    p.ell('0', cx, cy - 1, 10, 6); p.ell('q', cx, cy - 1, 9, 5); p.ell('1', cx, cy - 1, 8, 4);
    for (let i = -6; i <= 6; i += 3) p.r('p', cx + i, cy - 4, 1, 7);
    p.r('0', cx - 6, cy - 3, 5, 2); p.r('h', cx - 5, cy - 3, 4, 1); p.r('g', cx - 5, cy - 3, 1, 1);
    p.r('0', cx - 6, cy, 5, 2); p.r('h', cx - 5, cy, 4, 1);
    p.disc('0', cx + 4, cy - 1, 3); p.disc('b', cx + 4, cy - 1, 2); p.r('a', cx + 3, cy - 2, 1, 1);
    p.ell('0', cx + 15, cy - 1, 4, 8); p.ell('e', cx + 15, cy - 1, 3, 7); p.r('r', cx + 13, cy - 6, 1, 8); p.r('0', cx + 18, cy - 2, 2, 3);
    p.r('0', x - 10, cy - 4, 10, 12); p.r('a', x - 9, cy - 3, 8, 10); p.r('9', x - 9, cy - 3, 8, 1);
    p.disc('0', x - 5, cy + 1, 3); p.disc('7', x - 5, cy + 1, 2); p.r('h', x - 6, cy + 1, 2, 1);
    p.r('o', x - 8, cy + 6, 6, 1); p.r('p', x - 8, cy + 5, 1, 1);
  });
  for (const [dx, dy] of [[-4, 2], [1, 2], [1, -3], [-1, -1]]) p.glow('1', dx < 0 ? 'g' : 'h', cx + dx, cy + dy, 1, 1, 1.4, 0);
}
// ---------------------------------------------------------------- BACKYARD
// One brownstone backyard every five segments (1280 world px), laid out as a real garden instead of a scatter: from the
// back stoop under the brownstone, a flagstone path winds down past the patio (BBQ, umbrella table, chairs) and the
// raised beds, swings by the clothesline and the bird bath, and ends at Pom's doghouse doormat, with a spur of slabs
// to the kiddie pool. From the doghouse a looser trail of stepping stones runs on to the tool shed at the bottom of the
// yard. Fences stand only at the yard's edges. Features are placed in yard space (u: 690 = the stoop, falling to -512
// at the next brownstone's roof), so a feature that crosses a segment edge is drawn identically in both segments.
const YARD_P = 1280;
const YARD_PATH: [number, number][] = [[676, 219], [624, 219], [540, 174], [440, 190], [340, 250], [236, 252], [150, 198], [104, 158], [80, 112], [74, 98]];
const YARD_SPUR: [number, number][] = [[150, 198], [128, 236], [112, 270]];
const YARD_TRAIL: [number, number][] = [[64, 112], [-40, 150], [-170, 232], [-300, 214], [-400, 150], [-436, 98], [-446, 70]];
function curveX(pts: [number, number][], u: number) {
  for (let i = 0; i < pts.length - 1; i++) { const [u0, x0] = pts[i], [u1, x1] = pts[i + 1]; if (u <= u0 && u >= u1) { const t = (u0 - u) / (u0 - u1); return x0 + (x1 - x0) * (1 - Math.cos(t * Math.PI)) / 2; } }
  return pts[pts.length - 1][1];
}
/** stones along a curve, spaced by arc length: [x, u, w, h, kind] */
function stonesAlong(pts: [number, number][], gap: number, big: boolean) {
  const out: [number, number, number, number, number][] = [];
  let lx = -999, lu = 1e9, n = 0;
  for (let u = pts[0][0]; u >= pts[pts.length - 1][0]; u -= 0.5) {
    const x = curveX(pts, u); if (Math.hypot(x - lx, u - lu) < gap) continue;
    const h = Math.imul(n++ * 7919 + (big ? 1 : 2), 0x27d4eb2d) >>> 0;
    const w = big ? 12 + (h % 3) : 8 + (h % 3), hh = big ? 9 + ((h >>> 3) & 1) : 6 + ((h >>> 3) & 1);
    out.push([Math.round(x), Math.round(u), w, hh, 0]); lx = x; lu = u;
  }
  return out;
}
const YARD_STONES = [...stonesAlong(YARD_PATH, 12, true), ...stonesAlong(YARD_SPUR, 12, true), ...stonesAlong(YARD_TRAIL, 12, true)];
/** one flagstone (ground level): a rounded slab, lit top-left, a darker lower lip */
function flagstone(p: Painter, x: number, y: number, w: number, h: number) {
  p.r('q', x + 1, y + 1, w - 1, h); p.r('q', x, y + 2, w + 1, h - 2);
  p.r('p', x + 1, y, w - 2, h - 1); p.r('p', x, y + 1, w, h - 3);
  p.r('o', x + 1, y, w - 2, 1); p.r('o', x, y + 1, 1, h - 4);
}
/** yard features: [u (top), x (left), height, draw(p, x, y, rng)] */
type YardFeature = [number, number, number, (p: Painter, x: number, y: number, r: Rng) => void];
const YARD_FEATURES: YardFeature[] = [
  // the patio by the stoop: pavers, an umbrella table, the BBQ and a pair of lawn chairs with a cooler
  [668, 238, 78, (p, x, y) => { patio(p, x, y, 90, 74); umbrellaTable(p, x + 34, y + 30); bbq(p, x + 64, y + 40); }],
  [664, 340, 40, (p, x, y) => chairsCooler(p, x, y)],
  // raised beds along the back wall, left of the path
  [664, 64, 64, (p, x, y, r) => { garden(p, x, y, 60, 26, r); garden(p, x + 8, y + 34, 52, 24, r); }],
  // the clothesline on the left with a laundry basket under it
  [520, 40, 70, (p, x, y, r) => { clothesline(p, x + 4, x + 116, y + 6, r); p.shRect(x + 14, y + 40, 18, 12, 4); p.obj(() => { p.r('0', x + 14, y + 40, 18, 12); p.r('9', x + 15, y + 41, 16, 10); for (let i = x + 16; i < x + 31; i += 3) p.r('a', i, y + 43, 1, 7); p.r('7', x + 17, y + 41, 6, 3); p.r('n', x + 23, y + 41, 6, 2); }); }],
  // a bird bath ringed by flowers, right of the path
  [508, 300, 50, (p, x, y, r) => { flowerBed(p, x + 26, y + 30, 24, 14, r); birdBath(p, x + 26, y + 12); }],
  // a shade tree in the right corner, over the fence
  [470, 360, 60, (p, x, y, r) => { p.shEll(x + 40, y + 28, 17, 13, 12); const sd = r.int(0, 1e6); p.obj(() => canopy(p, x + 40, y + 26, 28, new Rng(sd))); leafLitter(p, x + 30, y + 20, 30, r); }],
  // the sandbox on the left (the middle stays open for the formation)
  [340, 50, 34, (p, x, y) => sandbox(p, x, y)],
  // a bed of tomatoes and beans on the right
  [300, 340, 30, (p, x, y, r) => garden(p, x, y, 56, 26, r)],
  // a flower border on the left
  [214, 70, 30, (p, x, y, r) => { flowerBed(p, x + 20, y + 14, 22, 12, r); }],
  // Pom's doghouse at the end of the path, with a doormat, a water bowl and a bone on the lawn
  [128, 72, 56, (p, x, y) => { doghouse(p, x, y, false); p.obj(() => { p.r('0', x + 7, y + 39, 22, 5); p.r('e', x + 8, y + 40, 20, 3); p.r('d', x + 8, y + 40, 20, 1);
    p.disc('0', x - 12, y + 40, 5); p.disc('n', x - 12, y + 40, 4); p.disc('m', x - 13, y + 39, 2);
    p.r('0', x - 16, y + 50, 10, 4); p.r('7', x - 15, y + 51, 8, 2); p.r('7', x - 16, y + 50, 2, 1); p.r('7', x - 16, y + 53, 2, 1); p.r('7', x - 8, y + 50, 2, 1); p.r('7', x - 8, y + 53, 2, 1); }); }],
  // the kiddie pool, with a towel and a beach ball beside it
  [124, 276, 60, (p, x, y) => { kiddiePool(p, x + 26, y + 28, 24); p.obj(() => { p.r('0', x + 54, y + 34, 18, 14); for (let j = 0; j < 12; j += 4) p.r(j % 8 ? '7' : 'n', x + 55, y + 35 + j, 16, 4);
    p.disc('0', x + 60, y + 6, 5); p.disc('7', x + 60, y + 6, 4); p.r('r', x + 56, y + 4, 8, 2); p.r('m', x + 58, y + 8, 4, 1); }); }],
  // a second clothesline strung across the right of the lawn, a peg bag on the post
  [262, 290, 40, (p, x, y, r) => { clothesline(p, x, x + 104, y + 6, r); p.obj(() => { p.r('0', x + 100, y + 8, 7, 8); p.r('d', x + 101, y + 9, 5, 6); p.r('c', x + 101, y + 9, 5, 1); }); }],
  // the garden hose coiled by a tap on the left, a watering can beside it
  [196, 66, 24, (p, x, y) => { p.shEll(x + 8, y + 8, 7, 6, 3); p.obj(() => { p.ring('0', x + 8, y + 8, 8, 7, 1); p.ring('j', x + 8, y + 8, 7, 6, 2); p.ring('k', x + 8, y + 8, 4, 3, 1); p.r('j', x + 15, y + 10, 10, 1); p.r('0', x + 25, y + 8, 4, 4); p.r('o', x + 26, y + 9, 2, 2);
    p.r('0', x + 2, y + 18, 12, 9); p.r('m', x + 3, y + 19, 10, 7); p.r('s', x + 3, y + 19, 10, 1); p.r('0', x + 13, y + 20, 5, 2); p.r('n', x + 14, y + 20, 3, 1); }); }],
  // lawn chairs round a little side table, right of centre
  [160, 236, 30, (p, x, y) => chairsCooler(p, x, y)],
  // veggie rows on the right below the doghouse
  [-40, 320, 70, (p, x, y, r) => { garden(p, x, y, 70, 28, r); garden(p, x, y + 38, 70, 28, r); }],
  // a second shade tree over the left fence, its leaves drifting onto the lawn
  [-200, 10, 60, (p, x, y, r) => { p.shEll(x + 30, y + 28, 17, 13, 12); const sd = r.int(0, 1e6); p.obj(() => canopy(p, x + 30, y + 26, 30, new Rng(sd))); leafLitter(p, x + 40, y + 24, 30, r); }],
  // a compost corner on the right: two bins and a wheelbarrow of clippings
  [-290, 330, 40, (p, x, y) => { bin(p, x + 8, y + 8, 'k'); bin(p, x + 24, y + 10, 'p');
    p.shRect(x + 36, y + 2, 24, 14, 6); p.obj(() => { p.r('0', x + 36, y + 2, 22, 14); p.r('h', x + 37, y + 3, 20, 12); p.r('k', x + 39, y + 4, 16, 6); p.r('j', x + 40, y + 4, 6, 2); p.r('0', x + 58, y + 7, 6, 2); p.disc('0', x + 34, y + 9, 3); p.disc('q', x + 34, y + 9, 2); }); }],
  // the tool shed at the end of the stepping-stone trail
  [-392, 46, 40, (p, x, y) => shed(p, x, y)],
];
/** golden hour on a lawn: inside a low-sun band the blades catch the light (their plum shade turns to a warm gold-brown
 *  glint, tips yellow), wood, stone and brick a warm step lighter; everything else keeps the dusk remap */
const LAWN_SUN = remap('1:a f:f i:f q:q p:p o:9 9:8 a:9 b:a 8:7 7:7 h:g g:f', TOD_RAMP.dusk);
/** the soft rim of a lawn sun band: the blade shade warms to dark brown */
const LAWN_SOFT = remap('1:b q:q a:9 b:a', TOD_RAMP.dusk);
/** dusk on a lawn: long bands of low sun reach across the grass from the west, through gaps in the trees and fences
 *  (props' shadows cut them), so the hour reads as warm light and long shade, not just a darker green */
function lawnSunBands(p: Painter, z: Seg) {
  if (p.tod !== 'dusk') return;
  p.sunRamp = LAWN_SUN; p.sunSoft = LAWN_SOFT; p.beamShade = true;
  every(z, 230, 60, y => { if (y < -140 || y > SEG + 30) return; const h = 26 + (Math.abs(Math.round(z.wy(y))) % 3) * 6;
    p.shaft(0, y - 5, SW, h + 10, 0.27, true); p.shaft(0, y, SW, h, 0.27); });
}
const backyard: LayerDef = { speed: 1, opaque: true, paint(p, z) {
  const r = z.r; const top = z.s % 5 === 2 ? 78 : 0;
  grass(p, 0, 0, SW, SEG, r, 'k', 'j', 0.35, true);
  if (top) brownstoneBacks(p, r);
  const lo = z.s * SEG, hi = lo + SEG;
  // freshly mown: every other 32px band (world-spaced) of the lawn is a shade lighter, blades laid toward the camera
  { const KK = KEY.indexOf('k'), KJ = KEY.indexOf('j'), B = p.buf;
    for (let y = 0; y < SEG; y++) { const wy = hi - y; if (((wy >> 5) & 1) === 0) continue;
      for (let x = 48; x < 398; x += 3) { const g = Math.imul((x + 11) * 73856093 ^ wy * 19349663, 0x27d4eb2d) >>> 0; if ((g & 15) > 1) continue;
        const xx = x + ((g >>> 4) % 3), o = y * SW + xx; if (y + 1 < SEG && B[o] === KK && B[o + 1] === KK && B[o + SW] === KK && B[o + SW + 1] === KK) { B[o] = KJ; B[o + 1] = KJ; B[o + SW] = KJ; B[o + SW + 1] = KJ; } } } }
  // all the yards that overlap this segment (each yard spans world rows 1280k-512 .. 1280k+690)
  for (let k = Math.floor((lo - 700) / YARD_P); k <= Math.floor((hi + 600) / YARD_P); k++) {
    const yOf = (u: number) => hi - (YARD_P * k + u);
    // the flagstones sit in a bed of fine gravel, so the path reads as one continuous walk, not a scatter
    for (let y = 0; y < SEG; y++) { const u = hi - y - YARD_P * k;
      for (const [pts, w] of [[YARD_PATH, 18], [YARD_SPUR, 14], [YARD_TRAIL, 14]] as [[number, number][], number][]) {
        if (u > pts[0][0] + 4 || u < pts[pts.length - 1][0] - 4 || (top && y < top + 4)) continue;
        const x = Math.round(curveX(pts, Math.min(pts[0][0], Math.max(pts[pts.length - 1][0], u))));
        p.r('b', x - (w >> 1) - 1, y, w + 2, 1); p.r('a', x - (w >> 1), y, w, 1);
        const g = Math.imul((y + hi) * 2654435761 ^ x, 0x27d4eb2d) >>> 0; p.r(g & 1 ? '9' : 'b', x - (w >> 1) + 1 + (g >>> 3) % (w - 2), y, 1, 1);
      }
    }
    for (const [x, u, w, h, kind] of YARD_STONES) { const y = yOf(u); if (y < -14 || y > SEG + 14 || (top && y < top + 4)) continue;
      if (kind) { flagstone(p, x - 7, y - 4, 7, h); flagstone(p, x + 1, y - 3, 6, h - 1); } else flagstone(p, x - (w >> 1), y - (h >> 1), w, h); }
    YARD_FEATURES.forEach(([u, x, h, draw], i) => { const y = yOf(u); if (y + h + 40 < 0 || y - 40 > SEG) return; draw(p, x, y, new Rng(hash(z.seed, k, i))); });
  }
  // fences and shrub borders only at the yard's edges
  // (inside the playfield edges, so the yard always reads as a fenced garden)
  for (const [fx, bx] of [[34, 41], [406, 398]]) { border(p, bx, top + 2, 8, SEG - top - 2, r); fenceV(p, fx, top ? top - 8 : 0, SEG, r); }
  if (top) {
    stringLights(p, 236, top + 6, 330, top + 8, r);
    // the brownstone's back stoop: iron-railed steps down into the yard, a porch light by the door
    const sx = 206, sy = top - 18; p.shRect(sx, sy, 26, 24, 10);
    p.obj(() => { p.r('0', sx - 1, sy - 1, 28, 26); for (let i = 0; i < 6; i++) { p.r(i % 2 ? '9' : '8', sx, sy + i * 4, 26, 3); p.r('a', sx, sy + i * 4 + 3, 26, 1); } p.r('0', sx - 1, sy - 2, 2, 27); p.r('0', sx + 25, sy - 2, 2, 27); p.r('q', sx - 1, sy - 2, 1, 27); p.r('q', sx + 25, sy - 2, 1, 27);
      p.r('0', sx + 29, sy - 12, 5, 6); });
    p.glow('q', 'f', sx + 30, sy - 11, 3, 4, 1.5, 0);
    p.pool(sx + 13, top + 14, 46);
  }  lawnSunBands(p, z);
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
  // night: small, soft sodium pools on the sidewalks (they must not pull focus from the cats on the road)
  p.poolScale = 0.5;
  p.r('v', 0, 0, SW, SEG);
  // tar patches: a slab in the road colour edged by a dark sealed seam with a lit lip, so they read as repairs, not holes
  for (let i = 0; i < 3; i++) { const x = r.int(130, 290), y = r.int(0, SEG - 30), w = r.int(14, 30), h = r.int(8, 20); p.r('1', x - 1, y - 1, w + 2, h + 2); p.r('v', x, y, w, h); p.r('q', x + 1, y + 1, w - 2, 1); }
  // tar-sealed cracks
  for (let i = 0; i < 3; i++) { let cx = r.int(140, 300), cy = r.int(0, SEG - 20); for (let k = 0; k < 5; k++) { const nx = cx + r.int(-4, 4), ny = cy + r.int(3, 6); p.line('1', cx, cy, nx, ny); cx = nx; cy = ny; } }
  // lane arrows (faded paint)
  if (r.chance(0.5)) { const ax = r.chance(0.5) ? 172 : 262, ay = r.int(20, 200), down = ax > 224; for (let j = 0; j < 14; j++) p.r('p', ax + 2, ay + j, 2, 1); for (let j = 0; j < 5; j++) p.r('p', ax + 3 - j, down ? ay + 14 + j - 4 : ay + j, 1 + j * 2 - 0, 1); }
  for (let i = 0; i < 40; i++) p.r('1', r.int(120, 328), r.int(0, SEG - 1), r.int(2, 4), 1);
  const segs: [number, number][] = cross ? [[0, cy0], [cy1, SEG]] : [[0, SEG]];
  for (const [a, b] of segs) for (let y = a; y < b; y += 32) { if (y + 14 < b) { p.r('h', 222, y + 4, 2, 14); p.r('h', 225, y + 4, 2, 14); }
    // reflective road studs ("cat's eyes") between the dashes: grey dots by day, small amber glints after dark
    if (y + 26 < b) { p.r('1', 222, y + 24, 5, 3); p.glow('p', 'f', 223, y + 25, 1, 1, 1, 0); p.glow('p', 'f', 225, y + 25, 1, 1, 1, 0); }
    // white studs along the parking-lane edges, every other dash
    if (((y >> 5) & 1) === 0) for (const ex of [150, 296]) if (y + 12 < b) p.glow('q', 'o', ex, y + 10, 1, 1, 1, 0); }
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
      if (b - a > 100) lamp(p, side ? sx + 6 : sx + 48, a + 54, 60);
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
  // night: the moon floats on the water (a pale disc broken by ripples), so the pond never reads as a black hole
  if (p.tod === 'night') { const mx = cx - 18, my = cy + 2; p.ell('s', mx, my, 6, 4); p.ell('6', mx - 1, my - 1, 4, 2); p.r('2', mx - 6, my + 1, 12, 1);
    for (const [ox, oy, w] of [[-12, 7, 7], [6, 6, 5], [-4, 10, 9], [10, -4, 4]]) p.r('m', mx + ox, my + oy, w, 1); }
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
  p.r('k', 0, 0, SW, SEG); lawnBlades(p, 0, 0, SW, SEG);
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
  // night lamps: a low, warm pool that never pulls focus from the cats beside it: one step lower than the street lamps,
  // and the lawn under it only lifts back to its own dark greens (no bright green halo ring)
  const r = z.r; p.poolScale = 0.8;
  lawn(p, z);
  // gravel path: runs along one edge strip, crossing the lawn once in a while (keeps the centre open)
  const px = (y: number) => 224 + Math.round(Math.sin(z.wy(y) / 230) * 56 + Math.sin(z.wy(y) / 71) * 6);
  for (let y = 0; y < SEG; y++) { const x = px(y); p.r('1', x - 13, y, 27, 1); p.r('q', x - 12, y, 25, 1); p.r('p', x - 10, y, 21, 1); if ((y + z.s) % 5 === 0) p.r('o', x - 8 + ((y * 7) % 16), y, 2, 1); if ((y + z.s) % 7 === 3) p.r('q', x - 7 + ((y * 11) % 14), y, 2, 1); }
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
  every(z, 192, 40, y => { if (y > -40 && y < SEG + 40) lamp(p, px(y) + 18, y, 40, undefined, true, -14); }); // gooseneck: the pool falls on the gravel
  bench(p, px(60) + 18, 40, true);
  for (let y = 6, i = 0; y < SEG; y += 11, i++) if ((z.s + (y >> 6)) % 3 === 0) { const x = px(y) + (i % 2 ? 3 : -4); p.r('1', x, y + 1, 3, 2); p.r('1', x - 1, y - 1, 1, 1); p.r('1', x + 1, y - 2, 1, 1); p.r('1', x + 3, y - 1, 1, 1); }
  lawnSunBands(p, z);
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
  // damp asphalt round the water (a darker wet halo), then the water mirroring the sky
  p.ell('v', x + 1, y + 1, rx + 5, ry + 3);
  p.ell('1', x, y, rx + 1, ry + 1); p.ell('n', x, y, rx, ry); p.ell('2', x + 2, y + 1, rx - 4, ry - 2);
  const k = rng.pick(['d', 'l', 'f']); const k2 = k === 'd' ? 'e' : k === 'l' ? 'm' : 'g';
  // reflections: 2px vertical streaks, a sign's light stretched down the wet surface (neon after dark, pale sky by day),
  // broken into dashes by the ripples
  // (after dark) the sign's glow lies on the water as a soft blot of stacked shimmer dashes, longest in the middle
  for (let j = -ry + 2, n = 0; j <= ry - 2; j += 2, n++) {
    const half = Math.floor((rx - 4) * Math.sqrt(Math.max(0, 1 - (j / ry) ** 2)) * 0.6), len = Math.max(2, half);
    const ox = ((n * 5 + rx) % 3) - 1;
    p.glow('2', Math.abs(j) < 2 ? k : k2, x - (len >> 1) + ox, y + j, len, 1, 1, 0.8);
  }
  p.r('s', x - rx + 4, y - ry + 2, 4, 1); p.r('m', x - rx + 8, y - ry + 2, 3, 1);
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
/** a cheap stable per-pixel hash (0..1023) for hand-placed grain: never an ordered pattern */
const grain = (x: number, y: number) => (Math.imul(x * 73856093 ^ y * 19349663, 0x27d4eb2d) >>> 22) & 1023;
/**
 * Alley floor: old wet asphalt over granite setts: puddles mirroring the sky (and the neon after dark), 2px tar snakes sealing the cracks, a square repair slab with
 * saw-cut edges, setts showing along both walls, worn dashed edge lines and iron drain grates set in concrete collars
 * down the crown. No per-pixel speckle: every mark is a readable shape.
 */
function alleyFloor(p: Painter, z: Seg) {
  const r = z.r; const seed = z.seed | 0;
  p.r('q', 96, 0, 256, SEG);
  // aggregate: a sparse scatter of 2px stones a step lighter (shapes, not speckle)
  for (let i = 0; i < 26; i++) { const x = r.int(136, 308), y = r.int(0, SEG - 2); p.r('p', x, y, 2, 1); p.r('v', x, y + 1, 2, 1); }
  // steel road plates bolted over the utility trenches: a raised rim lit top-left, rivets round the edge, a diamond tread
  for (let i = 0; i < 2; i++) if (r.chance(0.6)) { const w = r.int(26, 40), h = r.int(18, 28), x = r.int(140, 300 - w), y = r.int(4, SEG - h - 4);
    p.r('1', x - 1, y - 1, w + 2, h + 2); p.r('p', x, y, w, h); p.r('o', x, y, w, 1); p.r('o', x, y, 1, h); p.r('q', x + 1, y + h - 1, w - 1, 1); p.r('q', x + w - 1, y + 1, 1, h - 1);
    for (let j = y + 3, n = 0; j < y + h - 3; j += 3, n++) for (let k = x + 3 + (n & 1) * 3; k < x + w - 4; k += 6) p.r(n & 1 ? 'o' : 'q', k, j, 2, 1);
    for (const [rx, ry] of [[x + 1, y + 1], [x + w - 3, y + 1], [x + 1, y + h - 3], [x + w - 3, y + h - 3], [x + (w >> 1), y + 1], [x + (w >> 1), y + h - 3]]) { p.r('7', rx, ry, 1, 1); p.r('1', rx + 1, ry + 1, 1, 1); } }
  // tar snakes: crack sealant poured in meandering 2px lines across the old asphalt (one step darker than the lane, glossy dots)
  for (let i = 0; i < 4; i++) { let x = r.int(140, 300), y = r.int(0, SEG); const horiz = r.chance(0.5);
    for (let n = 0; n < 9; n++) { const nx = horiz ? x + r.int(4, 9) : x + r.int(-3, 3), ny = horiz ? y + r.int(-3, 3) : y + r.int(5, 10);
      if (nx < 136 || nx > 310) break; p.line('1', x, y, nx, ny); p.line('1', x + (horiz ? 0 : 1), y + (horiz ? 1 : 0), nx + (horiz ? 0 : 1), ny + (horiz ? 1 : 0));
      if (n % 3 === 1) { p.r('1', nx - 1, ny - 1, 3, 3); p.r('p', nx - 1, ny - 1, 1, 1); } x = nx; y = ny; } }
  // fine aggregate: a sparse scatter of 1px pale stones and dark pits (shapes stay readable, never a halftone)
  for (let i = 0; i < 70; i++) { const x = r.int(110, 338), y = r.int(0, SEG - 1); p.r(i & 1 ? 'p' : 'v', x, y, 1, 1); }
  // granite setts along both walls: 6x4 stones in staggered rows, lit top-left, mortar between
  for (const [x0, x1] of [[104, 130], [318, 344]]) {
    p.r('v', x0, 0, x1 - x0, SEG);
    for (let y = -6; y < SEG + 6; y++) {
      const wy = z.wy(y); if (((wy % 5) + 5) % 5 !== 0) continue; // a row starts every 5 world px
      const row = Math.floor(wy / 5), sy = y - 3; // stone occupies rows sy..sy+3
      for (let x = x0 - ((row & 1) ? 3 : 0); x < x1; x += 7) {
        const sx = Math.max(x0, x), sw = Math.min(x + 6, x1) - sx; if (sw <= 1) continue;
        const dark = grain(x, row) < 260;
        p.r(dark ? 'q' : 'p', sx, sy, sw, 4); p.r('q', sx, sy + 3, sw, 1); p.r(dark ? 'p' : 'o', sx, sy, 1, 1);
      }
    }
  }
  // worn yellow edge lines along the setts: dashed, with gaps scuffed out (world-spaced dashes)
  for (const lx of [134, 312]) for (let y = -12; y < SEG; y++) { const wy = z.wy(y); if (((wy % 14) + 14) % 14 < 8 && grain(lx, wy) > 140) p.r('f', lx, y, 2, 1); }
  // a hatched no-parking box at a wall every few segments (faded paint, chipped)
  if (z.s % 3 === 2) { const bx = r.chance(0.5) ? 138 : 266, by = r.int(20, SEG - 60), bw = 44, bh = 34;
    p.frame('f', bx, by, bw, bh);
    for (let d = 6; d < bw + bh; d += 7) for (let k = 0; k < bh; k++) { const x = bx + d - k; if (x > bx && x < bx + bw - 1 && k > 0 && k < bh - 1 && grain(x, by + k) > 180) p.r('f', x, by + k, 1, 1); }
    for (let i = 0; i < 18; i++) p.r('q', bx + r.int(0, bw - 1), by + r.int(0, bh - 1), r.int(1, 3), 1); }
  // utility covers: a square water-valve box and a small round gas cap
  for (let i = 0; i < 2; i++) { const ux = r.int(140, 300), uy = r.int(10, SEG - 20);
    if (i === 0) { p.r('1', ux - 1, uy - 1, 12, 12); p.r('p', ux, uy, 10, 10); p.r('q', ux + 1, uy + 1, 8, 8); for (let j = 2; j < 9; j += 3) p.r('p', ux + 2, uy + j, 6, 2); p.r('o', ux, uy, 10, 1); }
    else { p.disc('1', ux, uy, 4); p.disc('p', ux, uy, 3); p.r('q', ux - 1, uy, 3, 2); p.r('o', ux - 2, uy - 2, 1, 1); } }
  // drain grates down the crown: an iron grate in a concrete collar, with a dark wet stain where the water runs in
  every(z, 96, 20, y => { if (y < -20 || y > SEG + 6) return;
    p.ell('v', 224, y + 7, 16, 9);
    p.r('1', 213, y - 2, 22, 18); p.r('p', 214, y - 1, 20, 16); p.r('o', 214, y - 1, 20, 1); p.r('o', 214, y - 1, 1, 16);
    p.r('0', 217, y + 2, 14, 10); for (let i = 0; i < 3; i++) p.r('q', 219 + i * 4, y + 3, 2, 8); p.r('p', 217, y + 2, 14, 1); });
}
const alley: LayerDef = { speed: 1, opaque: true, paint(p, z) {
  const r = z.r; p.beamShade = true; p.poolScale = 0.6; p.poolLift = [1, 1, 2, 2];
  // dawn: the east tenements' shadow on the setts is a soft slate step, never violet slivers
  if (p.tod === 'dawn') p.shade = ALLEY_DAWN_SHADE;
  alleyFloor(p, z);
  // at dawn and dusk the back doors on the shaded side stand open: warm light spills out of each lit doorway across
  // the floor as a cone that fades in three steps (bright by the door, softer, a faint dithered tail) and ends softly
  const doors: [number, number][] = [];
  p.beamShade = false;
  // at dusk the low west sun comes in through the gaps between the tenements on the left: each gap is a short passage
  // with the sunset at its far end, and a warm shaft of light slants from its mouth across the floor (a lighter, warmer
  // version of whatever it lands on), cutting through the long shadow the buildings throw
  const gaps: [number, number][] = [];
  const SHAFT_T = 0.24;
  if (p.tod === 'dawn' || p.tod === 'dusk') {
    p.sunRamp = ALLEY_SUN[p.tod]!; p.sunSoft = ALLEY_SOFT[p.tod]!; p.sunTail = ALLEY_TAIL[p.tod]!; if (p.tod === 'dawn') p.spillRim = ALLEY_PEACH;
    if (p.tod === 'dawn') every(z, 150, 30, y => { const h = 12 + (Math.abs(Math.round(z.wy(y))) % 3) * 2;
      p.spill(343, y - h, h, 44 + (Math.abs(Math.round(z.wy(y))) % 4) * 6, 0.24, -1);
      doors.push([y - h, h]); });
    else every(z, 190, 40, y => { const gh = 14 + (Math.abs(Math.round(z.wy(y))) % 3) * 2, gy = y - gh;
      gaps.push([gy, gh]);
      p.shaft(96, gy - 3, 256, gh + 6, SHAFT_T, true); p.shaft(96, gy, 256, gh, SHAFT_T); });
  }
  puddle(p, r.int(150, 200), r.int(30, 110), r);
  puddle(p, r.int(250, 300), r.int(140, 220), r);
  puddle(p, r.int(140, 180), r.int(150, 200), r);
  if (z.s % 2 === 1) puddle(p, r.int(140, 300), r.int(200, 236), r);
  else puddle(p, r.int(240, 300), r.int(10, 60), r);
  // manhole (world-spaced, steam rises from it in the anim)
  every(z, 280, 60, y => { if (y < -10 || y > SEG + 10) return; p.disc('0', 262, y, 8); p.disc('p', 262, y, 7); p.ring('1', 262, y, 5, 5, 1); for (let i = -3; i <= 3; i += 2) p.r('1', 258, y + i, 9, 1); });
  // gutters along both walls: a darker kerb strip with a lit lip
  p.r('v', 96, 0, 7, SEG); p.r('p', 103, 0, 1, SEG); p.r('v', 345, 0, 7, SEG); p.r('p', 344, 0, 1, SEG);
  for (let i = 0; i < 5; i++) oilStain(p, r.chance(0.5) ? r.int(132, 190) : r.int(240, 316), r.int(8, SEG - 8), r);
  if (z.s % 3 === 1) hopscotch(p, r.chance(0.5) ? 148 : 284, r.int(30, 140));
  for (let i = 0; i < r.int(1, 3); i++) newspaper(p, r.chance(0.5) ? r.int(108, 150) : r.int(290, 330), r.int(6, SEG - 14), r);
  for (const side of [0, 1]) {
    const bx = side ? 352 : 0;
    let y = -(z.s * 37 % 64);
    while (y < SEG) {
      const hh = r.int(80, 140), ht = 28 + (hh * 7) % 19;
      // dusk: the west-side blocks throw their shadow onto the floor; a shorter cast with chimney stacks along the
      // parapet keeps its edge broken and organic instead of one long stepped slab
      const hs = side === 0 && p.tod === 'dusk' ? Math.round(ht * 0.55) : side === 1 && p.tod === 'dawn' ? Math.round(ht * 0.3) : ht;
      roof(p, bx, y, 96, hh, hs, r.pick(['q', 'v']), r.pick(['p', 'b', 'a']));
      for (let c = 0; c < 2; c++) { const cy = y + 14 + (grain(bx + c, y) % Math.max(1, hh - 34)), cx = side ? bx + 4 : bx + 84, ch = 8 + (grain(c, y) & 7);
        p.shRect(cx, cy, 7, 9, hs + ch);
        p.obj(() => { p.r('0', cx, cy, 7, 9); p.r('a', cx + 1, cy + 1, 5, 7); p.r('9', cx + 1, cy + 1, 5, 1); p.r('b', cx + 1, cy + 4, 5, 1); p.r('0', cx + 2, cy + 2, 3, 2); }); } // tenements of uneven height: a stepped shadow edge
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
  if (gaps.length) {
    // no building shadow inside a shaft (the sun comes through the gap); props placed later still cast into it
    const S = p.shadow, W = p.w;
    for (const [gy, gh] of gaps) for (let x = 0; x < 352; x++) { const y0 = x < 96 ? gy : gy + Math.round((x - 96) * SHAFT_T) - 2;
      for (let y = Math.max(0, y0); y < Math.min(SEG, y0 + gh + 4); y++) S[y * W + x] = 0; }
    p.beamShade = true;
    // the passages: a gap in the roofline, the cross street's asphalt in the sun, the sunset glowing at the far end
    for (const [gy, gh] of gaps) p.obj(() => {
      // a narrow gap between two tenements seen from above: a dark slot (the passage floor deep in shade, brick courses
      // on the walls either side), split by a bright sliver where the low sun skims the passage floor and lights the
      // far wall's edge; the shaft on the alley floor starts at its mouth
      p.r('0', 0, gy - 2, 97, 2); p.r('0', 0, gy + gh, 97, 1); p.r('v', 0, gy + gh + 1, 97, 2);
      p.r('1', 0, gy, 97, gh); p.r('v', 0, gy, 97, 2); p.r('v', 0, gy + gh - 2, 97, 2);
      for (let x = 3; x < 97; x += 9) { p.r('0', x, gy, 1, 2); p.r('0', x + 4, gy + gh - 2, 1, 2); }
      const sy = gy + (gh >> 1) - 1;
      // the sliver: thin at the far end, widening toward the mouth (amber, a yellow core, one hot cream pixel run)
      for (let x = 0; x < 97; x++) { const t = x / 96, th = t < 0.35 ? 1 : t < 0.75 ? 2 : 3;
        emit(p, 'h', x, sy - (th >> 1), 1, th); if (th >= 2) emit(p, 'g', x, sy, 1, th - 1); if (th === 3 && (x & 7) < 6) emit(p, 'f', x, sy, 1, 1); }
      // the far wall's lit edge where the passage ends at the cross street
      emit(p, 'h', 0, gy + 1, 2, gh - 2); emit(p, 'g', 0, gy + 2, 1, gh - 4);
    });
  }
  // the open doorways the light spills from: a steel frame in the wall, the door leaf swung back, a lit interior
  for (const [gy, gh] of doors) { const dawn = p.tod === 'dawn', wx = dawn ? 352 : 96, dir = dawn ? 1 : -1;
    const x0 = dawn ? wx : wx - 9;
    p.obj(() => {
      p.r('0', x0 - 1, gy - 2, 11, gh + 4); emit(p, dawn ? 'c' : 'g', x0, gy, 9, gh); emit(p, dawn ? '7' : 'f', dawn ? x0 : x0 + 4, gy + 1, 5, gh - 2); emit(p, '7', dawn ? x0 : x0 + 7, gy + 2, 2, gh - 4);
      p.r('0', x0 + (dawn ? 3 : 2), gy + 3, 3, 6); emit(p, dawn ? 'd' : 'h', x0 + (dawn ? 4 : 3), gy + 4, 1, 4); // a hat stand / coat in the hall
      // the door leaf swung open against the wall, and a concrete step in front of the threshold
      const lx = dawn ? wx - 1 : wx; p.r('0', lx, gy - 6, 1, 6); p.r('p', lx - dir * 0, gy - 6, 1, 5);
      const sx = dawn ? wx - 8 : wx; p.r('0', sx, gy - 1, 8, gh + 2); p.r('o', sx + (dawn ? 1 : 0), gy, 7, gh); p.r('7', sx + (dawn ? 1 : 0), gy, 7, 1);
      // a lintel lamp over the door
      const bx = dawn ? wx + 2 : wx - 7; p.r('0', bx, gy - 5, 5, 3); emit(p, '7', bx + 1, gy - 4, 3, 1);
      void dir; });
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
    alleyLamp(p, 110, ay + 27, true); p.pool(124, ay + 32, 44);
  } else {
    // a laundromat on the right wall: a teal-and-cream awning, a lit window and a neon washing-machine sign
    const ay = r.int(60, 160);
    p.shRect(342, ay, 26, 54, 12);
    p.obj(() => { p.r('0', 342, ay, 26, 54); for (let j = 0; j < 54; j += 6) p.r(j % 12 ? '7' : 'm', 343, ay + j + 1, 25, 5); p.r('n', 366, ay + 1, 2, 52); p.r('1', 342, ay, 1, 54); });
    p.obj(() => { p.r('0', 370, ay + 6, 22, 42); p.r('1', 371, ay + 7, 20, 40); });
    p.obj(() => { const nx = 376, ny = ay + 14; for (const [dx, dy, w, h] of [[0, 0, 10, 1], [0, 0, 1, 12], [9, 0, 1, 12], [0, 11, 10, 1], [3, 4, 4, 4]]) p.glow('n', dx === 3 ? 'c' : 'l', nx + dx, ny + dy, w, h); });
    alleyLamp(p, 338, ay + 27, false); p.pool(324, ay + 32, 44);
  }
  // a second gooseneck lamp on the opposite wall, so the night alley is strung with a few warm pools, not one
  { const left = z.s % 2 === 1, ly = r.int(30, 220); if (!used.some(([l, a, b]) => l === left && ly + 10 > a && ly - 10 < b)) { alleyLamp(p, left ? 110 : 338, ly, left); p.pool(left ? 124 : 324, ly + 5, 42); used.push([left, ly - 10, ly + 10]); } }
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
    // a small wall lamp: a 4x5 iron cowl round a 2x3 warm lamp head (the pool and the warm lift on the setts come from it)
    const ax = fromLeft ? x - 6 : x + 2; p.r('0', ax, y - 1, 5, 2); p.r('p', ax, y - 1, 5, 1);
    p.r('0', x - 1, y - 3, 4, 5); p.r('p', x - 1, y - 3, 4, 1);
    p.glow('q', 'f', x, y - 2, 2, 3); p.glow('q', '7', x, y - 2, 1, 1); p.glow('0', 'h', x - 1, y + 2, 4, 1);
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
    const lx = left ? x - 4 : x + 1; p.r('0', lx, y - 2, 4, 5); p.glow('q', 'f', lx + 1, y - 1, 2, 3, 1, 0); p.r('p', lx, y - 3, 4, 1);
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
    p.r('v', bx + 6, by + 6, 44, 52); p.r('2', bx + 8, by + 8, 40, 48); p.r('3', bx + 8, by + 8, 40, 1); p.r('3', bx + 8, by + 8, 1, 48); p.r('v', bx + 8 + r.int(8, 30), by + 8, 1, 48);
    for (let i = 0; i < 5; i++) p.glow('1', r.pick(['f', 'g', '7']), bx + r.int(10, 44), by + r.int(10, 52), 1, 1, 0.6, r.next());
    if (r.chance(0.3)) { const tx = bx + 12, ty = by + 12; for (const [dx, dy] of [[3, 3], [10, 2], [6, 8], [13, 9]]) { p.disc('0', tx + dx, ty + dy, 3); p.disc('k', tx + dx, ty + dy, 2); p.r('j', tx + dx - 1, ty + dy - 1, 1, 1); } } // a pocket park: a few street trees
  }
  for (let x = 2 + (z.s % 2) * 20; x < SW; x += 56) for (let y = 0; y < SEG; y += 12) { if (r.chance(0.1)) { p.glow('q', 'f', x - 1, y, 1, 1); p.glow('q', 'f', x + 1, y, 1, 1); } if (r.chance(0.08)) { p.glow('q', 'r', x + 2, y, 1, 1); } }
  for (let y = 0; y < SEG; y += 64) for (let x = 0; x < SW; x += 9) if (r.chance(0.12)) p.glow('q', 'g', x, y + 2, 1, 1, 0.8, r.next());
  // tiny cars down in the streets (a windscreen catching the sky as a 1px blue glint) and the odd puddle glint
  for (let x = 2 + (z.s % 2) * 20 - 56; x < SW; x += 56) for (let y = 2; y < SEG - 8; y += r.int(14, 30)) {
    if (r.chance(0.45)) { const cx = x + r.int(-2, 2), down = r.chance(0.5); p.r('0', cx - 1, y, 4, 7); p.r(r.pick(['r', 'f', '7', 'n', 'a', 'o']), cx - 1, y + 1, 4, 5); p.r('m', cx, down ? y + 4 : y + 2, 2, 1); }
    else if (r.chance(0.3)) p.r('m', x + r.int(-3, 3), y, r.int(1, 2), 1);
  }
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
  p.obj(() => { p.r('0', sx, sy, sw, 20); p.r('n', sx + 1, sy + 1, sw - 2, 18); for (let k = sx + 1; k < sx + sw; k += 12) p.r('1', k, sy + 1, 1, 18); p.r('1', sx + 1, sy + 10, sw - 2, 1); p.r('m', sx + 1, sy + 1, sw - 2, 1); for (let k = sx + 3; k < sx + sw - 4; k += 12) p.r('m', k, sy + 3, 2, 1); });
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
  // a patch of real lawn between the beds (green at every hour, a dark teal-green at night)
  { const lx = x + 22, ly = y + 22, lw = w - (w > 80 ? 44 : 26), lh = h - 26; if (lw > 12 && lh > 10) p.obj(() => { p.r('0', lx, ly, lw, lh); grass(p, lx + 1, ly + 1, lw - 2, lh - 2, rng, 'k', 'j', 0, true); }); }
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
    for (let x = -r; x < r; x++) { const t = (x + 0.5) / r; let k = t < -0.4 ? 'a' : t < 0.4 ? 'b' : 'v'; if ((x + r) % 3 === 2) k = k === 'a' ? 'b' : k === 'b' ? 'v' : '1'; p.r(k, cx + x, tankTop, 1, th); }
    for (const hy of [tankTop + 2, tankTop + th - 3]) { p.r('0', cx - r, hy, 2 * r, 1); }
    // witch-hat cone: a triangle profile with overhanging eave, lit on the left
    p.r('0', cx - r - 3, tankTop - 2, 2 * r + 6, 3);
    for (let j = 0; j < coneH; j++) {
      const hw = Math.round((j / coneH) * (r + 2)) + 1, y = top + j;
      p.r('0', cx - hw - 1, y, 2 * hw + 2, 1);
      p.r('q', cx - hw, y, hw, 1); p.r('v', cx, y, hw, 1);
      if (hw > 3) p.r('p', cx - hw, y, 1, 1);
      if (hw > 4 && j % 4 !== 3) { p.r('m', cx - hw + 2, y, 2, 1); if (hw > 6) p.r('n', cx - hw + 4, y, 2, 1); } // the steel cone catches the sky
      if (j % 4 === 3) { p.r('v', cx - hw + 1, y, hw - 1, 1); p.r('1', cx + 1, y, hw - 1, 1); }
    }
    p.r('q', cx - r - 2, tankTop - 1, 2 * r + 4, 1); p.r('p', cx - r - 2, tankTop - 1, r, 1);
    p.r('0', cx, top - 3, 1, 3);
    p.glow('0', 'r', cx, top - 4, 1, 1, 0.9, 0);
  });
}
const rooftops: LayerDef = { speed: 1, paint(p, z) {
  const r = z.r; p.deferShadows = true; p.clearShadow = p.tod === 'day' ? 0 : 1; /* noon: crisp ink shadows down on the street */ const gap = 40; const bh = SEG - gap;
  let x = -r.int(0, 24);
  while (x < SW) {
    const w = r.int(3, 5) * 32; const split = r.chance(0.7);
    const rows: [number, number][] = split ? (() => { const m = r.int(2, 4) * 32 + 8; return [[r.int(0, 1) * 8, m - 4], [m + 4, bh - m - 4 - r.int(0, 1) * 8]]; })() : [[r.int(0, 2) * 8, bh - r.int(0, 2) * 8]];
    for (const [y, h0] of rows) {
      const h = Math.max(48, h0);
      const height = r.int(14, 40); const rim = r.pick(['p', 'b', 'a', 'p', 'q']);
      roof(p, x, y, w - 4, h, height, r.pick(['q', 'q', 'v', 'q', 'a']), rim, r.pick([0, 1, 1, 2, 3, 4, 4, 0, 1, 2]));
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
  // a big soft play rug with a hand-cut, rounded organic outline (never a rectangle with a dotted edge, which would read as a
  // selection box under the rack): a dark rim, an inner border one step lighter and a calm indigo field with a few paw prints
  const cx = x + w / 2, cy = y + h / 2, ax = w / 2, ay = h / 2;
  const edge = (yy: number, inset: number) => {
    const v = (yy + 0.5 - cy) / (ay - inset); if (Math.abs(v) >= 1) return 0;
    const wob = 1 + 0.035 * Math.sin(yy * 0.11 + x) + 0.025 * Math.sin(yy * 0.29 + 1.7);
    return Math.round((ax - inset) * Math.pow(1 - Math.pow(Math.abs(v), 2.6), 1 / 2.6) * wob);
  };
  for (let yy = y; yy < y + h; yy++) {
    const e0 = edge(yy, 0), e1 = edge(yy, 3), e2 = edge(yy, 7);
    if (e0 > 0) p.r('0', Math.round(cx - e0), yy, e0 * 2, 1);
    if (e1 > 0) p.r('3', Math.round(cx - e1), yy, e1 * 2, 1);
    if (e2 > 0) p.r('2', Math.round(cx - e2), yy, e2 * 2, 1);
  }
  for (let j = y + 28; j < y + h - 24; j += 48) for (let i = x + 30; i < x + w - 24; i += 48) { if (edge(j, 14) < Math.abs(i + 2 - cx)) continue; p.r('3', i, j + 2, 4, 3); p.r('3', i - 1, j, 1, 1); p.r('3', i + 1, j - 1, 1, 1); p.r('3', i + 3, j - 1, 1, 1); p.r('3', i + 5, j, 1, 1); }
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
  for (let x = 70; x < SW; x += 14) { p.r('v', x, 0, 1, SEG); p.r('a', x + 1, 0, 1, SEG); /* a worn, lit plank edge beside each seam */ const off = ((x * 37) % 96); for (let y = -off; y < SEG; y += 96) { p.r('v', x, y, 14, 1); p.r('a', x + 1, y + 1, 13, 1); } }
  for (let i = 0; i < 70; i++) { const x = 72 + r.int(0, 25) * 14 + r.int(3, 9), y = r.int(0, SEG - 8); p.r(r.chance(0.7) ? 'a' : 'v', x, y, 2, r.int(3, 9)); }
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
  // half-density ripple marks, all one quiet tone; a few glints are animated in the tileset anim instead
  for (let y = 0; y < SEG; y += 12) {
    const w = z.wy(y); const off = Math.round(Math.sin(w / 37) * 10 + Math.sin(w / 13) * 3);
    for (let x = ((y / 12) % 2) * 28 + off - 56; x < SW; x += 56) { const len = 7 + Math.round(Math.abs(Math.sin((x + w) / 19)) * 6); p.r('2', x, y, len, 1); p.r('2', x + 2, y + 1, len - 4, 1); }
  }
  // dusk: the sea drops a value step under long, soft plum swells (the shade side of each wave, facing away from the low
  // sun): broad lens-shaped bands, 3-6px thick, that cover about a third of the water
  if (p.tod === 'dusk') for (let y = 2; y < SEG; y += 7) {
    const w = z.wy(y);
    for (let x = -60 + Math.round(Math.sin(w / 23) * 20); x < SW; x += 58 + ((w * 7) & 31)) {
      const len = 24 + (Math.abs(Math.round(Math.sin((x + w) / 17) * 16))), th = 3 + ((x + w) & 1);
      for (let j = 0; j < th; j++) { const c = Math.abs(j - (th - 1) / 2) / (th / 2), ins = Math.round(c * c * len * 0.4); p.r('3', x + ins, y + j, len - ins * 2, 1); }
    }
  }
} };
const docks: LayerDef = { speed: 1, paint(p, z) {
  const r = z.r; // soft lamp pools on the planks (never a cream blob)
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
  for (let y = 20; y < SEG - 30; y += r.int(50, 80)) { if (y > stallY - 44 && y < stallY + 48) continue; const k = r.int(0, 2); if (k === 0) { fishCrate(p, 14, y, r); fishCrate(p, 16, y + 18, r); } else if (k === 1) { p.shEll(40, y + 10, 14, 10, 4); p.obj(() => { p.ell('0', 40, y + 10, 15, 11); p.ell('k', 40, y + 10, 14, 10); p.ell('j', 38, y + 8, 8, 4); for (let j = y + 3; j < y + 18; j += 4) for (let i = 30 + ((j >> 2) & 1) * 2; i < 51; i += 5) if (Math.hypot((i - 40) / 13, (j - y - 10) / 9) < 1) p.r('1', i, j, 2, 1); }); } else { crate(p, 20, y, 24, 24); } }
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
    // its shadow far below on the water: a small solid wing-shape in the deep tone (never a black checker)
    p.r('1', x + 14, y + 22, 11, 1); p.r('1', x + 18, y + 21, 3, 3);
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
  p.obj(() => { p.disc('0', cx, cy, 28); p.disc('3', cx, cy, 27); p.ring('p', cx - 1, cy - 1, 26, 26, 1); p.disc('0', cx, cy, 23); p.disc(k, cx, cy, 22); p.ring(hi, cx, cy, 15, 15, 1); p.ring(hi, cx + 3, cy + 2, 7, 7, 1); p.r('0', cx - 1, cy - 22, 3, 44); p.r('p', cx - 1, cy - 22, 1, 44); });
}
function spinner(p: Painter, x: number, y: number, rng: Rng) {
  const w = 96, h = 56;
  p.shRect(x, y, w, h, 22);
  p.obj(() => {
    p.r('0', x, y, w, h); p.r('3', x + 1, y + 1, w - 2, h - 2); p.r('p', x + 1, y + 1, w - 2, 2); p.r('p', x + 1, y + 1, 2, h - 2);
    for (let j = 0; j < 2; j++) for (let i = 0; i < 6; i++) { const cx = x + 10 + i * 15, cy = y + 16 + j * 24; const [k, sh, hi] = rng.pick(DYES); p.disc('0', cx, cy, 6); p.disc(k, cx, cy, 5); p.ring(sh, cx, cy, 3, 3, 1); p.r(hi, cx - 3, cy - 3, 2, 1); p.disc('0', cx, cy, 1); }
  });
  p.glow('1', 'i', x + w - 8, y + 4, 3, 2); p.glow('1', 'r', x + w - 14, y + 4, 3, 2, 0.6, rng.next());
  p.pool(x + w - 10, y + 6, 18);
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
    p.r('0', x - 1, 0, w + 2, SEG); p.r('3', x, 0, w, SEG);
    for (let y = 0; y < SEG; y += 4) p.r('1', x + 1, y, w - 2, 2);
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
/** control console: a slanted desk with a green scope screen and rows of indicator buttons (all lit after dusk) */
function controlConsole(p: Painter, x: number, y: number, rng: Rng) {
  const w = 44, h = 22;
  p.shRect(x, y, w, h, 10);
  p.obj(() => {
    p.r('0', x, y, w, h); p.r('p', x + 1, y + 1, w - 2, h - 2); p.r('o', x + 1, y + 1, w - 2, 1); p.r('q', x + 1, y + h - 4, w - 2, 3);
    p.r('0', x + 3, y + 3, 14, 11);
  });
  p.glow('1', 'k', x + 4, y + 4, 12, 9, 1.2, rng.next());
  p.glow('1', 'l', x + 5, y + 8, 10, 1, 1.2, 0); p.glow('1', 'i', x + 7, y + 6, 2, 1, 1.2, 0); p.glow('1', 'i', x + 11, y + 10, 2, 1, 1.2, 0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { const k = rng.pick(['r', 'i', 'f', 'l', 'g']); p.r('0', x + 20 + i * 6, y + 4 + j * 6, 4, 4); p.glow('q', k, x + 21 + i * 6, y + 5 + j * 6, 2, 2, 1.3, rng.next() * 0.9); }
  p.obj(() => { for (let i = 0; i < 3; i++) { p.r('0', x + 21 + i * 7, y + h - 4, 4, 2); p.r('o', x + 22 + i * 7, y + h - 4, 2, 1); } });
  p.pool(x + w / 2, y + h + 4, 26); // the screens and buttons spill light onto the floor in front of the desk
}
/** yarn spool rack: a steel frame with two rows of yarn cones on pegs (dye colour, a dark core, a lit shoulder) */
function spoolRack(p: Painter, x: number, y: number, n: number, rng: Rng) {
  const w = n * 12 + 4, h = 30;
  p.shRect(x, y, w, h, 14);
  p.obj(() => {
    p.r('0', x, y, w, h); p.r('3', x + 1, y + 1, w - 2, h - 2); p.r('p', x + 1, y + 1, w - 2, 1); p.r('v', x + 1, y + 14, w - 2, 2);
    for (let j = 0; j < 2; j++) for (let i = 0; i < n; i++) { const [k, sh, hi] = rng.pick(DYES); const cx = x + 8 + i * 12, cy = y + 7 + j * 15;
      p.disc('0', cx, cy, 5.5); p.disc(sh, cx, cy, 4.5); p.disc(k, cx - 0.5, cy - 0.5, 3.5); p.r(hi, cx - 3, cy - 3, 2, 1); p.disc('0', cx, cy, 1.5); }
  });
}
/** an enamel lamp shade seen from above with a warm bulb (lit after dusk) */
function lampHead(p: Painter, x: number, y: number) {
  // a grey enamel shade round an amber bulb: reads as a lamp (never a valve or target)
  p.obj(() => { p.disc('0', x, y, 4); p.disc('q', x, y, 3); p.r('p', x - 2, y - 3, 3, 1); p.r('0', x - 2, y - 2, 4, 4); });
  p.glow('q', 'g', x - 1, y - 1, 2, 2, 1, 0); p.glow('p', 'f', x - 1, y - 1, 1, 1, 1, 0);
}
/** a loom seen from above: a steel frame with a warp of dyed threads running between two beams and a shuttle */
function loom(p: Painter, x: number, y: number, n: number) {
  const w = 36, h = 58; const [dk, sh, hi] = DYES[((n % DYES.length) + DYES.length) % DYES.length];
  p.shRect(x, y, w, h, 16);
  p.obj(() => {
    p.r('0', x, y, w, h); p.r('3', x + 1, y + 1, w - 2, h - 2); p.r('p', x + 1, y + 1, w - 2, 1); p.r('p', x + 1, y + 1, 1, h - 2);
    for (const by of [y + 3, y + h - 10]) { p.r('0', x + 2, by, w - 4, 7); p.r('q', x + 3, by + 1, w - 6, 5); p.r('p', x + 3, by + 1, w - 6, 1); p.r(dk, x + 5, by + 2, w - 10, 3); p.r(hi, x + 5, by + 2, w - 10, 1); }
    p.r('0', x + 4, y + 11, w - 8, h - 22); for (let i = x + 5; i < x + w - 5; i += 2) p.r(i % 4 ? dk : sh, i, y + 11, 1, h - 22);
    const sy = y + 24 + (n * 7) % 12; p.r('0', x + 3, sy, w - 6, 4); p.r('a', x + 4, sy + 1, w - 8, 2); p.r('9', x + 4, sy + 1, w - 8, 1);
  });
  p.glow('1', 'i', x + w - 6, y + h - 3, 2, 1, 1.3, 0);
}
/** a flywheel motor: a big spoked wheel beside its motor housing, a drive belt between them */
function flywheel(p: Painter, x: number, y: number, n: number) {
  const cx = x + 14, cy = y + 18;
  p.shEll(cx, cy, 13, 13, 18); p.shRect(x + 6, y + 34, 26, 22, 12);
  p.obj(() => {
    p.r('0', x + 6, y + 34, 26, 22); p.r('3', x + 7, y + 35, 24, 20); p.r('p', x + 7, y + 35, 24, 1); for (let j = y + 39; j < y + 53; j += 3) p.r('v', x + 10, j, 18, 1);
    p.r('0', cx - 2, cy, 5, 36); p.r('q', cx - 1, cy, 3, 35);
    p.disc('0', cx, cy, 15); p.disc('p', cx, cy, 14); p.disc('0', cx, cy, 11); p.disc('1', cx, cy, 10);
    for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + n; p.line('3', cx, cy, cx + Math.cos(a) * 10, cy + Math.sin(a) * 10); }
    p.disc('0', cx, cy, 4); p.disc('p', cx, cy, 3); p.r('o', cx - 1, cy - 1, 1, 1); p.r('o', cx - 9, cy - 10, 4, 1);
  });
  p.glow('1', n % 3 ? 'i' : 'r', x + 26, y + 37, 3, 2, 1.3, 0);
}
/** hanging work lamp seen from above: an enamel shade with a warm bulb; its pool is centred under it */
function workLamp(p: Painter, x: number, y: number, r: number) {
  // a hanging cone shade seen from above: a dark rim, a grey enamel top with one lit lip, and a 3x3 amber bulb glowing
  // in its mouth (the source of the warm pool on the floor)
  p.obj(() => { p.disc('0', x + 0.5, y + 0.5, 5); p.disc('q', x + 0.5, y + 0.5, 4); p.r('p', x - 2, y - 3, 4, 1); p.r('0', x - 2, y - 2, 5, 5); });
  p.glow('q', 'g', x - 1, y - 1, 3, 3, 1, 0); p.glow('p', 'f', x - 1, y - 1, 2, 2, 1, 0); p.glow('p', '7', x - 1, y - 1, 1, 1, 1, 0);
  p.pool(x, y, r);
}
/** the dusk light through the west windows (applied to day indices): exactly one warm value step above the dusk floor
 *  (plum steel -> dark brown, studs grey -> brown, seams ink -> plum), so the shafts brighten what they land on at low
 *  contrast instead of painting it orange */
/** the dawn light through the east windows (applied to day indices): one pale step above the dawn steel, peach on the studs */
const FACTORY_DAWN = remap('q:p v:q p:8 o:7 1:v 3:p a:9 b:a 9:8 2:2 n:n e:e h:h k:k');
const FACTORY_SUN = remap('q:a v:b p:9 o:8 1:v 3:9 a:9 b:a 9:8 2:2 n:n e:e h:h k:k');
const factory: LayerDef = { speed: 1, paint(p, z) {
  const r = z.r;
  // indoors the shadows stay plain steel shade (the sky tint only comes in through the windows)
  if (p.tod === 'dawn') p.shade = SHADE;
  // steel floor plates with open grate panels (machinery shows through)
  const grates = new Set<number>(); for (let i = 0; i < 3; i++) grates.add(r.int(0, 5) * 100 + r.int(0, 13));
  for (let y = 0; y < SEG; y += 32) for (let x = 0; x < SW; x += 32) {
    if (grates.has((y / 32 | 0) % 6 * 100 + x / 32) && x > 140 && x < 300) { p.r('0', x, y, 32, 32); for (let i = 2; i < 32; i += 4) p.r('q', x + i, y + 1, 1, 30); p.r('p', x + 1, y, 30, 1); continue; }
    const pv = grain(x, z.wy(y) >> 5) & 15; // plate variety: plain, tread plate, oil-stained, worn
    p.r(pv === 3 ? 'v' : 'q', x, y, 32, 32); p.r('v', x, y, 32, 1); p.r('v', x, y, 1, 32); p.r('1', x + 1, y + 1, 31, 1); p.r('1', x + 1, y + 1, 1, 31); /* a 2px groove between plates */ p.r('p', x + 3, y + 3, 1, 1); p.r('p', x + 28, y + 3, 1, 1); p.r('p', x + 3, y + 28, 1, 1); p.r('p', x + 28, y + 28, 1, 1);
    if (pv < 3) for (let j = 6; j < 28; j += 4) for (let i = 6 + ((j >> 2) & 1) * 3; i < 26; i += 6) p.r('p', x + i, y + j, 2, 1);
    else if (pv === 4) { p.ell('v', x + 16, y + 18, 9, 5); p.r('1', x + 13, y + 17, 4, 1); }
  }
  // painted walkway edges along the conveyor and the catwalk (2px safety yellow, dashed where forklifts scuffed it)
  for (const lx of [134, 324]) for (let y = 0; y < SEG; y += 12) if (grain(lx, z.wy(y) >> 3) > 120) p.r('f', lx, y, 2, 9);
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
  // a control console and a spool rack where the machinery leaves room; warning lights along the pipe wall
  const free = k === 0 ? [212, 20] : k === 1 ? [196, 206] : k === 2 ? [18, 200] : [40, 104];
  controlConsole(p, r.int(146, 250), free[0], r);
  { const sx = r.int(144, 220), sn = r.int(5, 7); spoolRack(p, sx, free[1], sn, r);
    // a small lamp hung over the rack, so the dyed cones still read after dark
    // (a hanging enamel shade over the rack's front edge: the pool has a visible source)
    lampHead(p, sx + (sn * 12 + 4) / 2, free[1] + 33); if (p.tod === 'night' || p.tod === 'dusk') p.pool(sx + (sn * 12 + 4) / 2, free[1] + 33, 28); }
  // heavy machinery between the pipe wall and the conveyor: looms threading dyed warps, flywheel motors (they keep their
  // steel silhouettes at night, one step above the floor)
  every(z, 170, 70, (y, n) => { if (y < -70 || y > SEG + 10) return; ((n & 1) ? flywheel : loom)(p, 52, y - 60, n); });
  every(z, 64, 24, y => { if (y > 2 && y < SEG - 4) p.obj(() => { p.r('0', 38, y - 1, 12, 5); p.r('q', 39, y, 10, 3); }); p.glow('q', (Math.round(z.wy(y)) >> 6) % 3 ? 'i' : 'r', 42, y, 4, 3, 1.3, 0); });
  // a pipe run crossing the floor (world-spaced): two lagged pipes on stands with flanges and a red valve wheel
  every(z, 224, 120, y => { if (y < -12 || y > SEG + 12) return;
    p.shRect(136, y, 190, 10, 6);
    p.obj(() => { for (const [py, k, hi] of [[y, 'p', 'o'], [y + 6, 'n', 'm']] as [number, string, string][]) { p.r('0', 136, py - 1, 190, 5); p.r(k, 136, py, 190, 3); p.r(hi, 136, py, 190, 1);
        for (let fx = 150; fx < 326; fx += 36) { p.r('0', fx, py - 2, 4, 7); p.r('q', fx + 1, py - 1, 2, 5); } }
      const vx = 232; p.disc('0', vx, y + 4, 6); p.ring('r', vx, y + 4, 5, 5, 2); p.r('r', vx - 4, y + 4, 9, 1); p.r('r', vx, y, 1, 9); p.disc('0', vx, y + 4, 1);
      for (const sx of [160, 300]) { p.r('0', sx - 3, y - 4, 8, 16); p.r('q', sx - 2, y - 3, 6, 14); p.r('p', sx - 2, y - 3, 6, 1); } });
    p.glow('q', 'i', 302, y - 2, 2, 2, 1.3, 0); });
  // a floor motor with a cooling fan and a status lamp, in an empty stretch
  { const mx = r.int(150, 290), my = r.int(10, 230), cl = (a: number, b: number) => Math.abs(a - b);
    if (cl(my, free[0]) > 40 && cl(my, free[1]) > 44) { p.shRect(mx, my, 30, 22, 10);
      p.obj(() => { p.r('0', mx, my, 30, 22); p.r('3', mx + 1, my + 1, 28, 20); p.r('p', mx + 1, my + 1, 28, 1); p.disc('0', mx + 10, my + 11, 7); p.disc('1', mx + 10, my + 11, 6); p.r('p', mx + 5, my + 11, 11, 1); p.r('p', mx + 10, my + 6, 1, 11); p.disc('o', mx + 10, my + 11, 1);
        for (let j = my + 4; j < my + 19; j += 4) p.r('v', mx + 20, j, 7, 2); });
      p.glow('1', 'i', mx + 24, my + 2, 3, 2, 1.3, 0); } }
  if (r.chance(0.5)) steamVent(p, r.int(150, 300), r.int(10, 240));
  if (r.chance(0.4)) yarnPile(p, r.int(150, 290), r.int(20, 230), 3, r);
  // hanging work lamps: at night each throws a warm stepped pool on the steel (the lights are what is lit, never a white blob)
  p.poolScale = 0.9; p.poolWobble = 0.25; workLamp(p, r.int(170, 290), r.int(70, 180), 38);
  if (r.chance(p.tod === 'night' ? 0.9 : 0.6)) workLamp(p, r.chance(0.5) ? 70 : 350, r.int(70, 180), 32);
  // golden hour: the low sun slants in through the high west windows in long amber shafts (props' shadows cut them)
  // golden hour: the low sun comes in through tall west windows in the pipe wall (lit amber panes, a visible source) and
  // lays long, soft shafts across the steel: one warm step lighter than the floor, a clean 2:1 slant, props' shadows cut them
  if (p.tod === 'dusk') { p.sunRamp = FACTORY_SUN; p.sunSoft = FACTORY_RAMPS.dusk!; p.sunTail = FACTORY_RAMPS.dusk!; p.beamShade = true;
    every(z, 180, 50, y => { if (y < -200 || y > SEG + 40) return;
      p.shaft(36, y - 22, 230, 22, 0.5);
      p.obj(() => { p.r('0', 29, y - 26, 10, 30); p.r('a', 30, y - 25, 8, 28); p.r('g', 31, y - 24, 6, 26); p.r('f', 31, y - 24, 2, 26); p.r('7', 31, y - 21, 1, 18); p.r('0', 30, y - 12, 8, 1); });
    }); }
  // first light: the sun rises behind the east wall and pale peach light falls through its windows across the floor,
  // one soft step above the steel, slanting down to the left
  if (p.tod === 'dawn') { p.sunRamp = FACTORY_DAWN; p.sunSoft = FACTORY_RAMPS.dawn!; p.sunTail = FACTORY_RAMPS.dawn!; p.beamShade = true;
    every(z, 200, 120, y => { if (y < -40 || y > SEG + 200) return;
      p.shaft(150, y, 254, 18, -0.5);
      p.obj(() => { p.r('0', 405, y - 132, 9, 26); p.r('p', 406, y - 131, 7, 24); p.r('c', 407, y - 130, 5, 22); p.r('7', 410, y - 130, 2, 22); p.r('0', 406, y - 120, 7, 1); });
    }); }
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
 * seam sits below the formation's lane (y > 180) and is a 48-row gradient of horizontal streaks
 * (runs of the next band growing row by row), so there is no hard edge and no scanline stripe.
 * Day is one calm blue with thin haze streaks.
 */
/** stepped solid sky bands per hour (no dithered seams: each step is one flat palette colour, narrowing toward the glow) */
const SKY_BANDS: Record<Tod, [string, number][]> = {
  day: [['n', 360]],
  // dawn: a value ramp from deep indigo at the top through violet and rose to a peach / gold glow on the horizon
  dawn: [['2', 128], ['3', 190], ['u', 220], ['d', 248], ['c', 282], ['8', 324], ['f', 360]],
  dusk: [['1', 96], ['v', 178], ['2', 236], ['e', 290], ['d', 312], ['h', 328], ['b', 360]],
  night: [['0', 200], ['1', 300], ['v', 360]],
};
/** a long flat cloud streak: a lens-shaped body (pointed ends, never a ruler line), a darker top lip and an underside lit
 * by the sun below the horizon */
function skyStreak(p: Painter, cx: number, cy: number, rx: number, top: string, body: string, lit: string) {
  spans(cx, cy, rx, 3.6, (sx, sy, w) => p.r(sy < cy - 2 ? top : body, sx, sy, w, 1));
  spans(cx + rx * 0.12, cy + 2, rx * 0.72, 2, (sx, sy, w) => { if (sy >= Math.floor(cy + 1)) p.r(lit, sx, sy, w, 1); });
}
function skyBackdrop(p: Painter, tod: Tod) {
  const bands = SKY_BANDS[tod]; const H = p.h;
  let y0 = 0;
  for (const [k, y1] of bands) { p.r(k, 0, y0, SW, y1 - y0); y0 = y1; }
  // band edges are cloud strata, never ruler lines: each seam undulates (slow swells and a finer ripple), and a few
  // flat lens-shaped strata of each colour float across the seam, so the steps read as layered haze
  const r = new Rng(77);
  bands.forEach(([a, y1], i) => { const next = bands[i + 1]; if (!next) return; const b = next[0];
    const ph = i * 1.7;
    for (let x = 0; x < SW; x++) { const e = Math.round(y1 + 5 * Math.sin(x / 41 + ph) + 3 * Math.sin(x / 17 + ph * 2.3) + 2 * Math.sin(x / 7.3 + ph * 0.7));
      if (e < y1) p.r(b, x, e, 1, y1 - e); else if (e > y1) p.r(a, x, y1, 1, e - y1); }
    for (let n = 0; n < 2; n++) { const cx = r.int(0, SW), rx = r.int(30, 70), ry = r.range(3.2, 4.6); spans(cx, y1 - r.int(10, 20), rx, ry, (sx, sy, w) => p.r(b, sx, sy, w, 1)); }
    for (let n = 0; n < 2; n++) { const cx = r.int(0, SW), rx = r.int(26, 56), ry = r.range(3, 4.2); spans(cx, y1 + r.int(9, 18), rx, ry, (sx, sy, w) => p.r(a, sx, sy, w, 1)); }
  });
  // day: long thin haze streaks low down; night: a sprinkle of stars up high
  if (tod === 'day') for (let i = 0; i < 9; i++) { const y = r.int(150, H - 10), x = r.int(-40, SW - 40), w = r.int(40, 120); p.r('3', x, y, w, 1); p.r('3', x + 10, y + 1, w - 24, 1); }
  if (tod === 'night') {
    for (let i = 0; i < 70; i++) p.r(r.pick(['2', '3', '2', '4']), r.int(0, SW - 1), r.int(0, H * 0.7), 1, 1);
    // the moon high on the right: a soft two-step halo, a pale disc lit from the upper left with grey maria
    { const mx = 352, my = 62; p.disc('1', mx, my, 34); p.disc('v', mx, my, 26); p.disc('2', mx, my, 20);
      p.disc('4', mx, my, 14); p.disc('5', mx - 1, my - 1, 12); p.disc('6', mx - 4, my - 4, 5);
      for (const [dx, dy, rr] of [[3, -2, 3], [-3, 4, 2], [5, 5, 2], [-6, -1, 1.5]] as [number, number, number][]) p.disc('4', mx + dx, my + dy, rr); }
    // a far city glow low on the horizon: a warm plum-brown band with a scatter of tiny lit windows under the clouds
    { const gy = H - 34; for (let x = 0; x < SW; x++) { const e = Math.round(gy + 3 * Math.sin(x / 29) + 2 * Math.sin(x / 11)); p.r('e', x, e, 1, H - e); p.r('b', x, e + 10, 1, H - e - 10); }
      for (let i = 0; i < 60; i++) p.r(r.pick(['f', 'g', '7', 'g']), r.int(0, SW - 1), r.int(H - 22, H - 2), 1, 1); }
    // moonlit strata in the mid sky: long flat cloud banks, their tops catching the moon
    for (const [bx, by, br] of [[30, 150, 26], [130, 166, 20], [400, 210, 28], [300, 236, 18]] as [number, number, number][]) cloudBank(p, bx, by, br, r, ['0', '1', 'v', '3']);
    // a low bank of moonlit cloud along the horizon: the last band sits behind it, so no hard seam reads
    for (let x = -30; x < SW + 30; x += r.int(44, 70)) cloudBank(p, x, H - r.int(4, 14), r.int(20, 30), r, ['1', '1', 'v', '2']);
  }
  if (tod === 'dawn') {
    // sunrise: the sun breaking the horizon low on the left, a soft glow stepped round it, crossed by thin haze bars
    const sx = 118, sy = H + 4;
    p.disc('8', sx, sy, 58); p.disc('f', sx, sy, 44); p.disc('7', sx, sy, 30); p.disc('6', sx, sy, 19);
    for (const [hy, hw, k] of [[H - 22, 96, 'g'], [H - 15, 120, 'c'], [H - 34, 70, '8']] as [number, number, string][]) spans(sx + 6, hy + 1, hw / 2, 2.4, (x0, y0, w) => p.r(k, x0, y0, w, 1));
    // long thin cloud streaks lit pink on their undersides by the sun below the horizon (low contrast up high)
    // (each streak a step darker than its band, its underside catching the sun: pink up high, peach / gold low)
    for (let i = 0; i < 7; i++) { const y = i < 3 ? r.int(26, 150) : r.int(170, H - 70), x = r.int(-60, SW - 60), w = r.int(70, 150);
      const body = y > 250 ? 'd' : y > 192 ? '3' : y > 128 ? '2' : '1', lit = y > 250 ? '8' : y > 192 ? 'c' : y > 128 ? 'd' : 'u', top = y > 250 ? 'e' : y > 192 ? '2' : '1';
      skyStreak(p, x + w / 2, y + 2, w / 2, top, body, lit); }
    // banks of cumulus along the horizon with lit tops, the sun glowing through a gap
    for (const [bx, by, br] of [[-10, H - 18, 30], [44, H - 6, 22], [236, H - 14, 30], [320, H - 30, 26], [410, H - 12, 34]] as [number, number, number][]) cloudBank(p, bx, by, br, r, ['e', 'f', 'd', 'c']);
  }
  if (tod === 'dusk') {
    // the first stars in the dark top of the sky
    for (let i = 0; i < 26; i++) p.r(r.pick(['2', '2', 'v', '3']), r.int(0, SW - 1), r.int(0, 120), 1, 1);
    // the sun setting low on the right inside a stepped glow (rose, orange, gold), crossed by thin haze bars
    const sx = 312, sy = H - 14;
    p.disc('d', sx, sy, 62); p.disc('h', sx, sy, 44); p.disc('g', sx, sy, 30); p.disc('f', sx, sy, 20); p.disc('7', sx, sy, 13);
    for (const [hy, hw, k] of [[H - 26, 110, 'h'], [H - 18, 130, 'e'], [H - 40, 84, 'd'], [H - 8, 150, 'b']] as [number, number, string][]) spans(sx - 4, hy + 1, hw / 2, 2.4, (x0, y0, w) => p.r(k, x0, y0, w, 1));
    // long thin cloud streaks at every height, their undersides lit by the sun below them: plum and gold up high,
    // wine and orange lower down (so the upper sky has structure, but stays low in contrast behind the formation)
    for (let i = 0; i < 9; i++) { const y = i < 4 ? r.int(18, 170) : r.int(186, H - 60), x = r.int(-60, SW - 60), w = r.int(70, 160);
      const body = y > 236 ? 'e' : y > 178 ? 'v' : y > 96 ? '2' : 'v', lit = y > 236 ? 'g' : y > 178 ? 'h' : y > 96 ? 'e' : '2', top = y > 236 ? 'd' : y > 178 ? '2' : y > 96 ? 'v' : '1';
      skyStreak(p, x + w / 2, y + 2, w / 2, top, body, lit); }
    // a bank of cumulus along the horizon, silhouetted plum with sun-gold rims on their undersides, the sun between them
    for (const [bx, by, br] of [[-10, H - 12, 32], [70, H - 4, 24], [170, H - 16, 28], [420, H - 10, 30]] as [number, number, number][]) cloudBank(p, bx, by, br, r, ['1', 'g', 'v', 'e']);
  }
}
/** cumulus palette for the sky tileset per time of day: [hard shadow, underside, body, lit top] (desaturated so cats pop) */
const CLOUD: Record<Tod, string[]> = {
  day: ['3', '4', '5', 'o'],
  dawn: ['1', 'c', '2', '3'],
  dusk: ['1', 'h', 'v', 'e'],
  night: ['1', '1', 'v', '2'],
};
/** far: big soft cloud masses drifting slowly at a lower altitude */
const skyFar: LayerDef = { speed: 0.3, paint(p, z) {
  const r = z.r; const c = CLOUD[p.tod];
  // by night a flat one-tone mass would match a horizon band and cut a hard edge through its dither: give it a moonlit body and top
  // dawn: the far banks catch the sunrise on their tops (pink lit edges over a cool body)
  const keys = p.tod === 'night' ? ['1', 'v', '2', '3'] : p.tod === 'dawn' ? ['1', 'd', '2', '3'] : p.tod === 'dusk' ? ['1', 'e', 'v', '2'] : [c[0], c[0], c[1], c[1]];
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
/** smooth 2D value noise in 0..1 (hashed lattice, smoothstep interpolation) */
function vnoise(x: number, y: number, seed: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const h = (a: number, b: number) => ((Math.imul(a * 374761393 + b * 668265263 ^ seed, 0x27d4eb2d) >>> 0) & 0xffff) / 65535;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a0 = h(ix, iy), a1 = h(ix + 1, iy), b0 = h(ix, iy + 1), b1 = h(ix + 1, iy + 1);
  return (a0 + (a1 - a0) * u) + ((b0 + (b1 - b0) * u) - (a0 + (a1 - a0) * u)) * v;
}
function fbm(x: number, y: number, seed: number, oct = 4) {
  let s = 0, a = 1, n = 0;
  for (let o = 0; o < oct; o++) { s += vnoise(x, y, seed + o * 1013) * a; n += a; a *= 0.5; x *= 2.03; y *= 2.03; }
  return s / n;
}
/** a nebula cloud mass: a handful of overlapping soft lobes in one hue family, anchored in world space */
interface NebMass { x: number; wy: number; lobes: [number, number, number][]; fam: number }
/** cloud families by hue, dark and low in saturation: three solid value steps each (body, inner, a small core) under a
 * deep halo: a teal catnip cloud (indigo body, deep-blue inner, teal-blue core), a violet one and a wine-rose one */
const NEB_FAM = [['2', 'n', 'm'], ['v', '2', '3'], ['v', 'e', 'u']].map(f => f.map(k => KEY.indexOf(k)));
const NEB_HALO = KEY.indexOf('1');
const NEB_P = 210; // world px between mass anchors
/** the mass anchored at slot k: alternating sides (the column behind the formation stays dark), now and then a gap */
function nebMass(k: number, seed: number): NebMass | null {
  const r = new Rng(hash(seed, 'neb', k));
  if (r.chance(0.03)) return null;
  const left = (k + (r.chance(0.2) ? 1 : 0)) % 2 === 0;
  // anchored inside the visible playfield edge (world x 32..416), so a mass reads as a big cloud, not a sliver at the frame
  const x = left ? r.int(50, 110) : r.int(SW - 110, SW - 50), wy = k * NEB_P + r.int(-30, 30);
  const big = r.range(1.0, 1.35), lobes: [number, number, number][] = [];
  const n = r.int(6, 9), ang = r.range(-0.5, 0.5) + Math.PI / 2;
  for (let i = 0; i < n; i++) { const t = (i / (n - 1)) * 2 - 1; const along = t * 100 * big, side = r.int(-30, 30);
    lobes.push([Math.cos(ang) * along - Math.sin(ang) * side, Math.sin(ang) * along + Math.cos(ang) * side, Math.round((78 - Math.abs(t) * 28) * big * r.range(0.85, 1.15))]); }
  return { x, wy, lobes, fam: r.int(0, 2) };
}
/**
 * The catnip nebula: a few large, soft cloud masses drifting down the sides of deep space (each one hue family in
 * three close value steps under a deep halo, with grainy organic edges, never contour stripes), the column behind
 * the formation kept dark, over a slower far field of stars where a distant cat-eye galaxy watches (the focal point).
 */
const nebulaMain: LayerDef = { speed: 1, paint(p, z) {
  const r = z.r; const seed = z.seed | 0;
  const B = p.buf;
  const top = z.wy(SEG), bot = z.wy(0); // world y range of this segment (wy grows upward)
  // Gaplus-style space: dark cloud masses in solid value steps with crisp, organic 1px edges. The step field is smooth
  // (big billows and one curl octave, no pixel noise), sampled per pixel, then a 3x3 majority pass removes lone pixels
  // and 1px stair notches, so every rim is a clean curve, never a dither fringe or an upscaled block mask. Each mass
  // catches one lit rim step on its upper-left edges (light from the galaxy's side) for form.
  const T = [0.24, 0.6, 1.3, 2.4]; // halo, body, inner, core
  for (let k = Math.floor((bot - 220) / NEB_P); k <= Math.ceil((top + 220) / NEB_P); k++) {
    const m = nebMass(k, seed); if (!m) continue;
    const ly = (wy: number) => (z.s + 1) * SEG - wy; // local y of a world y
    let x0 = SW, x1 = 0, y0 = SEG, y1 = 0;
    for (const [dx, dy, rr] of m.lobes) { x0 = Math.min(x0, m.x + dx - rr); x1 = Math.max(x1, m.x + dx + rr); y0 = Math.min(y0, ly(m.wy + dy) - rr); y1 = Math.max(y1, ly(m.wy + dy) + rr); }
    const fam = NEB_FAM[m.fam];
    // a 3px apron round the segment so the majority pass and the rim test see across the segment edge
    const bx0 = Math.max(-3, Math.floor(x0)), bx1 = Math.min(SW + 3, Math.ceil(x1)), by0 = Math.max(-3, Math.floor(y0)), by1 = Math.min(SEG + 3, Math.ceil(y1));
    const bw = bx1 - bx0, bh = by1 - by0; if (bw <= 0 || bh <= 0) continue;
    let band = new Int8Array(bw * bh).fill(-1);
    for (let y = by0; y < by1; y++) { const wy = z.wy(y); for (let x = bx0; x < bx1; x++) {
      let d = 0; for (const [dx, dy, rr] of m.lobes) { const ex = (x + 0.5 - m.x - dx) / rr, ey = (wy - 0.5 - m.wy - dy) / rr; const q = 1 - ex * ex - ey * ey; if (q > 0) d += q * q; }
      if (d <= 0.04) continue;
      // big slow billows plus one curl octave: lobed, torn rims and inner swirls (internal form), all smooth at 1px
      d *= 0.5 + 0.75 * fbm(x / 58, wy / 58, seed + m.fam * 7, 3) + 0.3 * (fbm(x / 21, wy / 21, seed ^ 0x2b1, 2) - 0.5);
      // the column behind the rack stays dark: the mass thins toward the middle of the playfield
      const mid = Math.max(0, 1 - Math.abs(x - SW / 2) / 110); d *= 1 - 0.9 * mid * mid;
      if (m.fam === 2) d = Math.min(d, 1.2); // the rose cloud is a plum body with a wine rim (no small bright heart)
      let b = -1; while (b + 1 < T.length && d >= T[b + 1]) b++;
      band[(y - by0) * bw + x - bx0] = b;
    } }
    // two majority passes: a pixel takes the band most of its 8 neighbours share (removes specks and 1px notches)
    for (let pass = 0; pass < 2; pass++) {
      const nb = band.slice(); const cnt = new Int8Array(6);
      for (let y = 1; y < bh - 1; y++) for (let x = 1; x < bw - 1; x++) {
        cnt.fill(0); for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (i || j) cnt[band[(y + j) * bw + x + i] + 1]++;
        let best = band[y * bw + x], bc = 0; for (let c = 0; c < 6; c++) if (cnt[c] > bc) { bc = cnt[c]; best = c - 1; }
        if (bc >= 5) nb[y * bw + x] = best;
      }
      band = nb;
    }
    for (let y = Math.max(0, by0); y < Math.min(SEG, by1); y++) for (let x = Math.max(0, bx0); x < Math.min(SW, bx1); x++) {
      const b = band[(y - by0) * bw + x - bx0]; if (b < 0) continue;
      let v = b === 0 ? NEB_HALO : fam[b - 1];
      // the lit rim: a body / inner pixel whose upper-left and upper neighbours three px away sit in a lower step catches
      // light (top-facing edges only, so a vertical edge never reads as an outline)
      if (b >= 1 && b <= 2) { const ux = x - 3 - bx0, uy = y - 3 - by0; const ub = ux >= 0 && uy >= 0 ? band[uy * bw + ux] : -1, tb = uy >= 0 ? band[uy * bw + x - bx0] : -1; if (ub < b && tb < b) v = fam[b]; }
      const o = y * SW + x; if (B[o] === 255 || v !== NEB_HALO) B[o] = v;
    }
  }
  // a bright star cluster now and then, off the middle column: a tight knot of stars with two glinting giants
  for (let c = 0, nc = r.chance(0.5) ? 2 : 1; c < nc; c++) { const cx = (c + z.s) % 2 ? r.int(40, 130) : r.int(SW - 130, SW - 40), cy = r.int(30, SEG - 30);
    for (let i = 0; i < 30; i++) { const a = r.range(0, 6.283), d = Math.pow(r.next(), 1.6) * 22; p.r(r.pick(['4', '5', '5', 's', '6']), Math.round(cx + Math.cos(a) * d * 1.3), Math.round(cy + Math.sin(a) * d), 1, 1); }
    for (let i = 0; i < 2; i++) { const x = cx + r.int(-10, 10), y = cy + r.int(-7, 7); p.r('6', x, y, 1, 1); for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) p.r('s', x + dx, y + dy, 1, 1); for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) p.r('4', x + dx, y + dy, 1, 1); } }
  // stars over the dark: mostly faint, a few bright ones with a 4-point glint
  stars(p, r, 30, ['2', '3', '3', '4']);
  stars(p, r, 8, ['5', 't', 's']);
  for (let i = 0, n = p.tod === 'night' ? 12 : 8; i < n; i++) { const x = r.int(2, SW - 4), y = r.int(2, SEG - 3), k = r.pick(['4', '5', 't', 'm']); p.r(k, x, y, 2, 1); p.r(k, x, y + 1, 2, 1); p.r('6', x, y, 1, 1); }
  for (let i = 0; i < 3; i++) { const x = r.int(4, SW - 4), y = r.int(4, SEG - 4); p.r('6', x, y, 1, 1); p.r('s', x - 1, y, 1, 1); p.r('s', x + 1, y, 1, 1); p.r('s', x, y - 1, 1, 1); p.r('s', x, y + 1, 1, 1); p.r('4', x - 2, y, 1, 1); p.r('4', x + 2, y, 1, 1); }
  if (r.chance(0.5)) catnipLeaf(p, r.chance(0.5) ? r.int(16, 90) : r.int(SW - 90, SW - 16), r.int(20, SEG - 20), r);
} };
/** a distant cat-eye galaxy: a glowing elliptical iris in soft steps with a slit pupil and a catchlight */
function catEyeGalaxy(p: Painter, cx: number, cy: number, rx: number, ry: number, seed: number) {
  const steps: [number, string][] = [[1.0, '1'], [0.82, '2'], [0.64, 'k'], [0.46, 'j'], [0.3, 'i']];
  const cellN = (x: number, y: number) => ((Math.imul((x >> 1) * 73856093 ^ (y >> 1) * 19349663 ^ seed, 0x27d4eb2d) >>> 24) & 255) / 256;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx * 1.25); x <= Math.ceil(cx + rx * 1.25); x++) {
    const ex = (x + 0.5 - cx) / rx, ey = (y + 0.5 - cy) / ry;
    // two faint spiral arms swept round the iris
    const a = Math.atan2(ey, ex), rr = Math.hypot(ex, ey), arm = 0.12 * Math.cos(2 * a - rr * 5.5);
    const d = rr - arm * Math.min(1, rr * 1.4);
    let k = ''; for (const [t, key] of steps) if (d <= t) k = key; else break;
    // grainy melt at each step edge
    void cellN; // (crisp steps: no grainy melt)
    if (k) p.r(k, x, y, 1, 1);
  }
  // the slit pupil (a tall lens shape) and its catchlight
  for (let y = Math.round(cy - ry * 0.78); y <= Math.round(cy + ry * 0.78); y++) { const t = (y + 0.5 - cy) / (ry * 0.78); const w = Math.max(1, Math.round(rx * 0.16 * (1 - t * t))); p.r('0', Math.round(cx - w), y, w * 2, 1); }
  p.r('5', Math.round(cx - rx * 0.4), Math.round(cy - ry * 0.45), 3, 2); p.r('6', Math.round(cx - rx * 0.4), Math.round(cy - ry * 0.45), 1, 1);
}
/** a ringed planet far off (pixel-exact): banded violet body lit from the upper left, a crisp terminator into shadow,
 * a thin tilted ring that passes behind the planet at the top and in front of it at the bottom */
function ringedPlanet(p: Painter, cx: number, cy: number, r: number) {
  const ringPx = (front: boolean) => {
    for (let a = 0; a < 720; a++) { const t = a / 720 * Math.PI * 2, ex = Math.cos(t) * r * 1.9, ey = Math.sin(t) * r * 0.42;
      const x = Math.round(cx + ex * 0.97 - ey * 0.26), y = Math.round(cy + ey * 0.97 + ex * 0.26);
      if ((Math.sin(t) > 0) !== front) continue;
      p.r(Math.sin(t) > 0 ? '4' : '3', x, y, 1, 1); p.r('2', x, y + 1, 1, 1); }
  };
  ringPx(false);
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    const dd = (x + 0.5) ** 2 + (y + 0.5) ** 2; if (dd > r * r) continue;
    // light from the upper left: a lit cap, the body, and a shadow crescent on the lower right (crisp steps)
    const lx = (x + 0.5 + r * 0.45) ** 2 + (y + 0.5 + r * 0.45) ** 2, sx = (x + 0.5 - r * 0.55) ** 2 + (y + 0.5 - r * 0.55) ** 2;
    const band = Math.floor((y + r + Math.round(x * 0.26)) / Math.max(3, Math.round(r / 3.2))) % 3;
    let k = band === 1 ? 'e' : 'u';
    if (lx < (r * 0.7) ** 2) k = band === 1 ? 'u' : 't';
    if (sx < (r * 0.85) ** 2 && lx > (r * 1.05) ** 2) k = band === 1 ? 'v' : '2';
    if (dd > (r - 1) * (r - 1)) k = sx < (r * 0.9) ** 2 ? '1' : k;
    p.r(k, cx + x, cy + y, 1, 1);
  }
  ringPx(true);
  p.r('c', cx - Math.round(r * 0.5), cy - Math.round(r * 0.55), 2, 1); // a catchlight on the lit cap
}
/** far layer of the nebula: the star field, with the cat-eye galaxy every other far segment, off to one side */
const nebulaFar: LayerDef = { speed: 0.25, opaque: true, paint(p, z) {
  const seed = (z.seed | 0) ^ 0x5f3a;
  p.r('0', 0, 0, SW, SEG);
  // a deep, faint dust wash far behind the clouds: two dark value steps in big soft shapes (2x2 grain where they meet),
  // fading out toward the middle so the column behind the rack stays the darkest
  const grain2 = (x: number, y: number) => ((Math.imul((x >> 1) * 73856093 ^ (y >> 1) * 19349663 ^ seed, 0x27d4eb2d) >>> 24) & 255) / 256;
  p.pixels(set => { for (let y = 0; y < SEG; y++) { const wy = z.wy(y); for (let x = 0; x < SW; x++) {
    const mid = Math.max(0, 1 - Math.abs(x - SW / 2) / 140);
    // sampled per pixel from a smooth 3-octave field: clean curved rims, never a 2x2 block stair
    const v = fbm(x / 110, wy / 110, seed, 3) - 0.2 * mid * mid; void grain2;
    if (v > 0.58) set(v > 0.7 ? 'v' : '1', x, y); } } });
  stars(p, z.r, 80, ['2', '2', '3', 'v']);
  for (let i = 0; i < 6; i++) { const x = z.r.int(4, SW - 4), y = z.r.int(4, SEG - 4); p.r('4', x, y, 1, 1); p.r('2', x - 1, y, 1, 1); p.r('2', x + 1, y, 1, 1); p.r('2', x, y - 1, 1, 1); p.r('2', x, y + 1, 1, 1); }
  // the focal point: a distant cat-eye galaxy watching from one side, every other far segment
  if (((z.s % 2) + 2) % 2 === 0) { const left = ((z.s >> 1) & 1) === 0; catEyeGalaxy(p, left ? 112 : SW - 112, 110, 50, 32, z.seed | 0); }
  // a second landmark between the eyes: a small ringed planet on the other side
  else if (((z.s % 4) + 4) % 4 === 1) ringedPlanet(p, SW - 104, 150, 17);
  else ringedPlanet(p, 100, 120, 11);
} };
/** nebula hours: the clouds keep their own hues; dawn adds a plum veil and pink cores, dusk warms the cores, night dims a step */
const NEBULA_RAMPS: Partial<Record<Tod, Ramp>> = {
  day: remap(''),
  // first light: the dust warms to plum, the rose cores blush pink, the violet cores pale
  dawn: remap('1:v d:c 3:4'),
  // a warm hour: the dust goes plum, violet clouds deepen to wine, teal clouds dim a step, rose cores glow ember orange
  dusk: remap('1:v 3:e n:2 m:n d:h'),
  // night: the clouds dim a step but stay (deep teal, indigo, wine) so the sky is never an empty black
  night: remap('3:2 4:3 5:4 m:n s:m e:v d:e c:d i:j'),
};
const streaksFg: LayerDef = { speed: 1.9, paint(p, z) {
  const r = z.r; for (let i = 0; i < 8; i++) { const x = r.int(0, SW), y = r.int(0, SEG); p.r(r.pick(['2', '3']), x, y, 1, r.int(4, 8)); }
} };

// ---------------------------------------------------------------- MOON
/** a litter clump: a lumpy cluster of 2-4px pellets with a contact shadow, lit top-left (the litter box's signature) */
function clump(p: Painter, x: number, y: number, r: number, rng: Rng) {
  const n = Math.max(3, Math.round(r * 1.4));
  const pts: [number, number, number][] = [];
  for (let i = 0; i < n; i++) pts.push([x + rng.int(-r, r), y + Math.round(rng.int(-r, r) * 0.7), rng.int(1, 2)]);
  for (const [px, py, s] of pts) p.r('v', px, py + 1, s + 3, s + 2);
  for (const [px, py, s] of pts) { p.r('a', px, py, s + 2, s + 1); p.r('9', px, py, s + 1, s); p.r('8', px, py, s, 1); }
}
/** crater: a raised rim (bright sunlit crest on the upper-left, shaded outer slope lower-right), a dark inner wall
 * under the lit lip, a shadowed floor with a sunlit far side; big ones get an ejecta skirt and litter clumps */
function crater(p: Painter, cx: number, cy: number, rr: number, rng: Rng, litter: boolean) {
  const ry = Math.round(rr * 0.75);
  if (rr >= 16) { // bright ejecta rays: long tapering streaks thrown out over the plain (kept inside the segment)
    for (let i = 0; i < 7; i++) { const a = (i / 7) * 6.28 + rng.range(0, 0.6), l1 = rr * rng.range(2.2, 3.6);
      for (let t = rr + 2; t < l1; t++) { const x = cx + Math.cos(a) * t, y = cy + Math.sin(a) * t * 0.75; if (y < 2 || y > SEG - 3) break; const wdt = t < (rr + l1) / 2 ? 2 : 1; p.r('i', x, y, wdt, wdt); } }
  }
  if (rr >= 10) { // ejecta skirt: a ring of scattered pebbles just outside the rim
    for (let i = 0; i < rr; i++) { const a = rng.range(0, 6.28), d = rng.range(rr + 3, rr * 1.45 + 3); const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.75; p.r('q', x, y + 1, 2, 1); p.r('o', x, y, 2, 1); }
  }
  p.ell('q', cx + 1, cy + 2, rr + 2, ry + 2);   // outer slope in shade (lower right)
  p.ell('o', cx, cy, rr + 2, ry + 2);           // rim crest
  p.ell('7', cx - 1, cy - 1, rr + 1, ry + 1);   // sunlit crest highlight (shows on the upper-left)
  p.ell('o', cx, cy, rr + 1, ry + 1);
  p.ell('v', cx, cy, rr, ry);                   // dark inner wall below the lit lip
  p.ell('q', cx, cy + Math.max(1, Math.round(ry * 0.3)), rr - 1, ry - Math.max(1, Math.round(ry * 0.3))); // floor in shadow
  p.ell('p', cx + 1, cy + Math.max(2, Math.round(ry * 0.45)), rr * 0.7, ry * 0.45); // sunlit far floor
  if (litter) { const n = Math.max(1, Math.round(rr / 8)); for (let i = 0; i < n; i++) clump(p, cx + rng.int(-rr / 2, rr / 3), cy + rng.int(0, ry / 3), rng.int(3, 4), rng); }
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
  // large-scale value: dark maria and bright highlands from a world-space field (continuous across segments), their
  // shores melting over a few pixels of 2x2 dither, so the plain is never one flat grey sheet
  { const seed = (z.seed | 0) + 5, B = p.buf, kq = KEY.indexOf('q'), ki = KEY.indexOf('i');
    const GW = (SW >> 2) + 2, GH = (SEG >> 2) + 2, f = new Float32Array(GW * GH);
    for (let j = 0; j < GH; j++) { const wy = z.wy(j * 4); for (let i = 0; i < GW; i++) f[j * GW + i] = fbm(i * 4 / 150, wy / 190, seed, 4); }
    for (let y = 0; y < SEG; y++) for (let x = 0; x < SW; x++) {
      const i = x >> 2, j = y >> 2, u = (x & 3) / 4, w = (y & 3) / 4, o = j * GW + i;
      const a = f[o] + (f[o + 1] - f[o]) * u, b = f[o + GW] + (f[o + GW + 1] - f[o + GW]) * u, v = a + (b - a) * w;
      const th = bayer(x >> 1, y >> 1) / 16;
      if (v < 0.4 - th * 0.035) B[y * SW + x] = kq; else if (v > 0.585 + th * 0.035) B[y * SW + x] = ki;
    } }
  // litter granules of clay: little warm pebble clusters (the box's real colour shows through the dust)
  for (let i = 0; i < 7; i++) { const cx = r.int(50, 330), cy = r.int(6, SEG - 6); for (let k = 0; k < 4; k++) { const x = cx + r.int(-6, 6), y = cy + r.int(-4, 4); p.r('a', x, y + 1, 2, 1); p.r('9', x, y, 2, 1); } }
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
const limbW = (w: number) => 302 + Math.round(Math.sin(w / 97) * 5 + Math.sin(w / 23) * 2);
const limbX = (z: Seg, y: number) => limbW(z.wy(y));
/**
 * Left edge: the rim of the Great Litter-Box Crater. Seen from above: the outer slope in the
 * sun, a bright crest, the steep inner slope in shadow, boulders and litter clumps on top.
 */
function craterRidge(p: Painter, z: Seg) {
  p.shRect(0, 0, 30, SEG, 10);
  p.obj(() => {
    for (let y = 0; y < SEG; y++) { const x = ridgeX(z, y); p.r('i', 0, y, x - 14, 1); p.r('o', x - 16, y, 4, 1); p.r('7', x - 15, y, 1, 1); p.r('q', x - 12, y, 9, 1); p.r('v', x - 3, y, 3, 1); }
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
    for (let y = 0; y < SEG; y++) { const x = limbX(z, y); p.r('0', x, y, SW - x, 1); p.r('i', x - 1, y, 1, 1); p.r('q', x - 4, y, 3, 1); }
    // horizon peaks: low bumps on the limb, lit on their sunward side
    every(z, 36, 11, y => { if (y < -6 || y > SEG + 6) return; const x = limbX(z, y); for (let j = -5; j <= 5; j++) { const h = 4 - Math.abs(j) * 0.7; if (h > 0) { p.r('q', x, y + j, Math.ceil(h), 1); p.r('i', x + Math.ceil(h), y + j, 1, 1); } } });
    // deep space past the limb is never dead black: a faint band of the galaxy slants across it (soft haze of dim
    // star dust, densest along its spine), a far star field in two brightnesses and a few nearer 2px stars
    for (let y = 0; y < SEG; y++) { const wy = z.wy(y), x0 = limbX(z, y) + 3;
      for (let x = x0; x < SW; x++) { const dd = Math.abs(((x - 300) * 0.8 + wy * 0.35) % 360 - 180) / 60; if (dd > 1) continue;
        const g = (Math.imul(x * 73856093 ^ wy * 19349663, 0x27d4eb2d) >>> 0) / 4294967296;
        if (g < (1 - dd) * 0.22) p.r(g < (1 - dd) * 0.05 ? '2' : g < (1 - dd) * 0.12 ? 'v' : '1', x, y, 1, 1); } }
    for (let i = 0; i < 40; i++) { const y = r.int(0, SEG - 1), x = r.int(limbX(z, y) + 4, SW - 1); p.r(r.pick(['2', '3', '3', 'v']), x, y, 1, 1); }
    for (let i = 0; i < 16; i++) { const y = r.int(0, SEG - 1), x = r.int(limbX(z, y) + 4, SW - 1); p.r(r.pick(['4', '5', '5', '6']), x, y, 1, 1); }
    for (let i = 0; i < 3; i++) { const y = r.int(2, SEG - 3), x = r.int(limbX(z, y) + 6, SW - 3), k = r.pick(['5', 't', 's']); p.r(k, x, y, 2, 2); p.r('6', x, y, 1, 1); }
    // dusk: the low sun grazes the limb, an amber rim with a magenta afterglow fading into space (emissive, final colours)
    if (p.tod === 'dusk') for (let y = 0; y < SEG; y++) { const x = limbX(z, y); emit(p, 'h', x - 1, y, 1, 1); emit(p, 'e', x, y, 1, 1); emit(p, 'v', x + 1, y, 3, 1); }
  });
}
/** the Earth (Maya is down there), painted once per hour in its own colours: full by day, a terminator at dawn / dusk,
 * a thin lit crescent with city lights at night */
const EARTH_R = 36;
function paintEarth(p: Painter, tod: Tod) {
  const c = EARTH_R + 2, R = EARTH_R;
  const k = R / 26, E = (key: string, dx: number, dy: number, rx: number, ry: number) => p.ell(key, c + dx * k, c + dy * k, rx * k, ry * k);
  const L = (key: string, dx: number, dy: number, w: number) => p.r(key, Math.round(c + dx * k), Math.round(c + dy * k), Math.round(w * k), 1);
  p.disc('s', c, c, R + 1); p.disc('n', c, c, R); p.disc('m', c - 4 * k, c - 4 * k, R - 7 * k); p.disc('n', c + 2 * k, c + 2 * k, R - 11 * k);
  // continents (lit coasts, darker inland), deserts and ice caps
  E('k', -9, -5, 9, 6); E('j', -10, -6, 8, 5); E('k', -6, -3, 4, 3); E('j', -12, 3, 3, 5); E('8', -8, -8, 3, 2);
  E('k', 7, 9, 8, 6); E('j', 6, 8, 7, 5); E('8', 8, 10, 3, 2); E('j', 11, -8, 5, 3); E('8', 13, -7, 2, 1); E('j', 15, 1, 2, 4);
  E('6', 0, -24, 7, 1.5); E('6', 0, 24, 6, 1.5);
  // cloud streaks
  L('6', -17, 4, 10); L('5', -14, 5, 6); L('6', 1, -14, 11); L('5', 3, -13, 6); L('5', -6, 18, 10); L('6', 7, 1, 7); L('6', -4, -1, 5); L('6', -20, -12, 6); L('5', 10, 15, 8);
  // night side: the terminator moves with the hour (sun from the left by day, low at dawn/dusk, behind at night)
  const term = tod === 'day' ? R + 4 : tod === 'night' ? -R + 9 : tod === 'dawn' ? 6 : 3;
  const B = p.buf, W = p.w;
  for (let y = 0; y < p.h; y++) for (let x = 0; x < W; x++) { const o = y * W + x; if (B[o] === 255) continue; const dx = x - c, dy = y - c; if (dx - dy * 0.25 > term) B[o] = dx - dy * 0.25 > term + 2 ? KEY.indexOf('1') : KEY.indexOf('2'); }
  if (tod === 'night') for (const [x, y] of [[4, -3], [8, 5], [11, -8], [6, 10], [13, 2], [2, 12], [9, -12], [16, -2], [12, 9], [18, 6], [20, -6], [7, 17], [15, 12], [22, 3], [3, -16]]) p.r((x + y) & 1 ? 'f' : 'g', Math.round(c + x * R / 26), Math.round(c + y * R / 26), 1, 1);
}
/** the earthrise: a slow-drifting, always-present landmark in the space beyond the moon's limb (screen-space parallax,
 * clipped row by row by the horizon so it sits behind the limb) */
const moonFx = (ctx: CanvasRenderingContext2D, scroll: number, _t: number, _seed: number, tod: Tod, bg: Background) => {
  const H = 360, D = (EARTH_R + 2) * 2;
  const earth = bg.painted('earth', D, D, tod, p => paintEarth(p, tod), false);
  // the Earth is far away: it hangs at the right of the view whatever the camera pan, in the band of space past the limb
  const camX = 128 - Math.round(ctx.getTransform().e);
  const ex = camX + 384 - (EARTH_R + 6), ey = Math.round(150 + Math.sin(scroll / 2600) * 70);
  for (let j = 0; j < D; j++) {
    const sy = ey - (D >> 1) + j; if (sy < 0 || sy >= H) continue;
    const x0 = Math.max(ex - (D >> 1), limbW(H - sy + scroll) + 6); const sx = x0 - (ex - (D >> 1)); if (sx >= D) continue;
    ctx.drawImage(earth, sx, j, D - sx, 1, x0, sy, D - sx, 1);
  }
};
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
  for (let i = 0; i < 3; i++) crater(p, r.int(60, 286), r.int(10, SEG - 10), r.int(4, 9), r, false);
  if (r.chance(0.6)) crater(p, r.int(80, 270), r.int(20, SEG - 20), r.int(10, 14), r, false);
  if (r.chance(0.7)) rayCrater(p, r.chance(0.5) ? r.int(70, 120) : r.int(250, 280), r.int(30, SEG - 30), r.int(5, 8), r);
  const kind = z.s % 4; // 0 litter crater, 1 lander, 2 rover, 3 flag + boulders
  crater(p, r.int(140, 250), r.int(30, SEG - 30), r.int(16, 24), r, true);
  if (kind === 0) crater(p, r.chance(0.5) ? r.int(84, 120) : r.int(240, 262), r.int(50, SEG - 50), r.int(26, 32), r, true);
  if (z.s % 2 === 0) scoopMarks(p, r.int(90, 260), r.int(10, 120), r.int(26, 40), r);
  for (let i = 0; i < 6; i++) clump(p, r.int(60, 286), r.int(10, SEG - 10), r.int(3, 6), r);
  // a paw-print trail wandering up the tray (Pom was here first)
  pawTrail(p, r.int(230, 280), 0, SEG, r.range(-0.15, 0.15));
  if (r.chance(0.6)) buriedToy(p, r.int(70, 286), r.int(20, SEG - 20), r.int(0, 1));
  const left = r.chance(0.5); const ex = left ? r.int(72, 96) : r.int(244, 258), ey = r.int(60, 190);
  if (kind === 1) { lander(p, ex, ey); pomFlag(p, ex + (left ? 30 : -46), ey + 30); }
  else if (kind === 2) rover(p, ex, r.int(30, 170));
  else if (kind === 3) { pomFlag(p, ex, ey); boulder(p, ex + 24, ey + 20, 5); boulder(p, ex - 14, ey + 36, 3); }
  for (let i = 0; i < 2; i++) boulder(p, r.chance(0.5) ? r.int(50, 100) : r.int(262, 284), r.int(12, SEG - 12), r.int(2, 4));
  // a scatter of rocks across the field (they cast the long low-sun shadows at dawn and dusk)
  for (let i = 0; i < 5; i++) { const bx = r.int(60, 286), by = r.int(10, SEG - 10); boulder(p, bx, by, r.int(3, 6)); if (r.chance(0.6)) boulder(p, bx + r.int(6, 12), by + r.int(-6, 6), 2); }
  if (kind === 0 || kind === 2) bowlCrater(p, left ? r.int(240, 270) : r.int(90, 150), r.int(40, SEG - 40), r.int(16, 20), r);
  // a second, fainter boot-and-paw trail from the lander out across the field
  if (kind === 1 || kind === 3) pawTrail(p, left ? r.int(110, 150) : r.int(240, 275), r.int(0, 60), SEG, left ? 0.2 : -0.2);
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
/** a 3x5 stencil font for deck signage (painted on the hull plates) */
const STENCIL: Record<string, string> = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', G: '011100101101011',
  H: '101101111101101', K: '101101110101101', M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
  R: '110101110101101', S: '011100010001110', T: '111010010010010', W: '101101111111101', Y: '101101010010010', '-': '000000111000000',
  '0': '111101101101111', '1': '010110010010111', '2': '110001010100111', '3': '110001010001110', '4': '101101111001001', '5': '111100110001110',
  '7': '111001010010010', '9': '111101111001110', ' ': '000000000000000',
};
function stencil(p: Painter, str: string, x: number, y: number, k: string, sc = 1) {
  for (const ch of str) { const g = STENCIL[ch] ?? STENCIL[' ']; for (let i = 0; i < 15; i++) if (g[i] === '1') p.r(k, x + (i % 3) * sc, y + Math.floor(i / 3) * sc, sc, sc); x += 4 * sc; }
}
/** more station modules: grooming salon, cargo hold of cat-food cans, control room, nap quarters */
function podModule2(p: Painter, kind: number, x0: number, y0: number, x1: number, y1: number, r: Rng, side: number, n: number) {
  const w = x1 - x0, h = y1 - y0;
  if (kind === 4) { // grooming salon: a tiled floor, a bubble tub, a dryer hood and a rack of brushes
    p.obj(() => {
      p.r('2', x0 + 4, y0 + 4, w - 8, h - 14);
      for (let j = y0 + 4; j < y1 - 10; j += 12) for (let i = x0 + 4; i < x1 - 4; i += 12) { p.r('1', i, j, 12, 1); p.r('1', i, j, 1, 12); if (((i + j) >> 2) & 1) p.r('3', i + 1, j + 1, 11, 1); }
      const tx = x0 + (side ? w - 70 : 12), ty = y0 + 14;
      p.r('0', tx, ty, 58, 36); p.r('o', tx + 1, ty + 1, 56, 34); p.r('5', tx + 1, ty + 1, 56, 1); p.r('0', tx + 4, ty + 4, 50, 28); p.r('m', tx + 5, ty + 5, 48, 26); p.r('s', tx + 5, ty + 5, 48, 2);
      for (let i = 0; i < 9; i++) { const bx = tx + 9 + (i * 13) % 42, by = ty + 9 + (i * 7) % 18, br = 2 + (i % 3); p.disc('6', bx, by, br); p.disc('s', bx + 1, by + 1, br - 1); }
      const dx = x0 + (side ? 24 : w - 40), dy = y0 + 26; p.disc('0', dx, dy, 14); p.disc('p', dx, dy, 13); p.disc('o', dx - 2, dy - 2, 9); p.disc('0', dx, dy, 5); p.disc('q', dx, dy, 4);
      const rx = x0 + 14, ry = y1 - 40; p.r('0', rx, ry, w - 28, 8); p.r('a', rx + 1, ry + 1, w - 30, 6); p.r('9', rx + 1, ry + 1, w - 30, 1);
      for (let i = rx + 6; i < rx + w - 34; i += 10) { p.r('0', i, ry - 6, 6, 6); p.r(r.pick(['d', 'm', 'g', 'u']), i + 1, ry - 5, 4, 4); for (let k = 0; k < 4; k += 2) p.r('7', i + 1 + k, ry - 7, 1, 2); }
      stencil(p, 'GROOM ' + n, x0 + 10, y1 - 9, 'c');
    });
    p.glow('2', 'l', x0 + (side ? 24 : w - 40) - 2 + x0 * 0, y0 + 24, 4, 4, 1.4, 0);
  } else if (kind === 5) { // cargo hold: pallets of cat-food cans strapped down, a forklift parked by them
    p.obj(() => {
      p.r('1', x0 + 4, y0 + 4, w - 8, h - 14); for (let i = x0 + 8; i < x1 - 8; i += 16) p.r('v', i, y0 + 6, 1, h - 20);
      for (let pz = 0; pz < 4; pz++) { const px = x0 + 10 + (pz % 2) * (w / 2 - 6), py = y0 + 10 + (pz >> 1) * 46; if (pz === 3 && side) continue;
        p.r('0', px, py, 50, 38); p.r('b', px + 1, py + 1, 48, 36); for (let j = py + 3; j < py + 36; j += 11) for (let i = px + 3; i < px + 47; i += 11) { p.disc('0', i + 4, j + 4, 5); p.disc(((i + j) >> 3) % 3 ? 'p' : 'o', i + 4, j + 4, 4); p.r(r.pick(['r', 'n', 'g', 'k']), i + 1, j + 3, 7, 2); }
        p.r('f', px, py + 18, 50, 2); p.r('0', px, py + 20, 50, 1); }
      const fx = side ? x0 + 14 : x1 - 46, fy = y1 - 44; p.r('0', fx, fy, 30, 22); p.r('g', fx + 1, fy + 1, 28, 20); p.r('f', fx + 1, fy + 1, 28, 2); p.r('0', fx + 6, fy + 5, 16, 10); p.r('q', fx + 7, fy + 6, 14, 8); p.r('0', fx - 8, fy + 4, 8, 2); p.r('0', fx - 8, fy + 14, 8, 2);
      stencil(p, 'CARGO ' + n, x0 + 10, y1 - 9, 'f');
    });
  } else if (kind === 6) { // control room: a horseshoe of consoles round a captain's cushion, a star chart on the floor
    p.obj(() => {
      p.r('1', x0 + 4, y0 + 4, w - 8, h - 14);
      const cx = (x0 + x1) >> 1, cy = y0 + h / 2 - 4;
      p.ring('2', cx, cy, 34, 28, 1); for (let k = 0; k < 9; k++) { const a = k * 0.7; p.r('3', Math.round(cx + Math.cos(a) * 22), Math.round(cy + Math.sin(a) * 18), 1, 1); }
      p.line('3', cx - 20, cy + 8, cx - 4, cy - 6); p.line('3', cx - 4, cy - 6, cx + 14, cy - 2);
      for (let i = 0; i < 6; i++) { const a = Math.PI * (0.9 + i * 0.24), bx = Math.round(cx + Math.cos(a) * 52) - 9, by = Math.round(cy + Math.sin(a) * 40) - 6;
        p.r('0', bx, by, 18, 13); p.r('q', bx + 1, by + 1, 16, 11); p.r('p', bx + 1, by + 1, 16, 1); p.r('0', bx + 3, by + 3, 12, 6); }
      p.disc('0', cx, cy + 4, 8); p.disc('e', cx, cy + 4, 7); p.disc('d', cx - 1, cy + 3, 4);
      stencil(p, 'COMMS ' + n, x0 + 10, y1 - 9, '4');
    });
    { const cx = (x0 + x1) >> 1, cy = y0 + h / 2 - 4; for (let i = 0; i < 6; i++) { const a = Math.PI * (0.9 + i * 0.24), bx = Math.round(cx + Math.cos(a) * 52) - 9, by = Math.round(cy + Math.sin(a) * 40) - 6; p.glow('1', i & 1 ? 'l' : 'i', bx + 4, by + 4, 10, 4, 1.4, 0); } }
  } else { // nap quarters: a row of round cat beds with blankets, a yarn basket and a night light
    p.obj(() => {
      p.r('v', x0 + 4, y0 + 4, w - 8, h - 14); for (let j = y0 + 8; j < y1 - 12; j += 6) p.r('2', x0 + 6, j, w - 12, 1);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { const bx = x0 + 26 + i * ((w - 52) / 2), by = y0 + 26 + j * 46; if (i === 1 && j === 1) continue;
        p.disc('0', bx, by, 15); p.disc(['e', 'n', 'h'][(i + j + side) % 3], bx, by, 14); p.disc('b', bx, by, 10); p.disc(['c', 'm', '8'][(i + j + side) % 3], bx - 1, by - 1, 8); p.r('7', bx - 4, by - 4, 3, 1); }
      const yx = x0 + w / 2, yy = y0 + 72; p.disc('0', yx, yy, 9); p.disc('a', yx, yy, 8); p.disc('d', yx - 2, yy - 2, 3); p.disc('m', yx + 3, yy + 1, 3); p.disc('f', yx - 1, yy + 3, 2);
      stencil(p, 'NAP ' + n, x0 + 10, y1 - 9, 't');
    });
    p.glow('2', 'f', x0 + w - 16, y0 + 8, 4, 4, 1.4, 0);
  }
}
/** a station pod's interior module: habitat, observation window, catnip garden pod or docking bay (x0..x1, y0..y1 inside the hull) */
function podModule(p: Painter, kind: number, x0: number, y0: number, x1: number, y1: number, r: Rng, side: number, n = 1) {
  const w = x1 - x0, h = y1 - y0, cx = (x0 + x1) >> 1, cy = (y0 + y1) >> 1;
  if (kind >= 4) { podModule2(p, kind, x0, y0, x1, y1, r, side, n); return; }
  if (kind === 1) { // observation window: a big rounded port onto deep space, a planet's limb sliding past
    p.obj(() => {
      const wx = x0 + 10, wy = y0 + 8, ww = w - 20, wh = h - 22;
      for (let j = 0; j < wh; j++) { const c = Math.max(0, 8 - Math.min(j, wh - 1 - j)); const cc = Math.round(c * c / 8); p.r('0', wx + cc, wy + j, ww - cc * 2, 1); if (j > 1 && j < wh - 2) p.r('q', wx + cc + 1, wy + j, ww - cc * 2 - 2, 1); if (j > 3 && j < wh - 4) p.r('0', wx + cc + 3, wy + j, ww - cc * 2 - 6, 1); }
      const px = side ? wx + ww - 18 : wx + 22, py = wy + wh - 10, pr = 34;
      spans(px, py, pr, pr, (sx, sy, sw) => { const l = Math.max(sx, wx + 6), rr = Math.min(sx + sw, wx + ww - 6); if (sy > wy + 4 && sy < wy + wh - 4 && rr > l) { p.r('n', l, sy, rr - l, 1); } });
      spans(px - 4, py + 4, pr - 3, pr - 3, (sx, sy, sw) => { const l = Math.max(sx, wx + 6), rr = Math.min(sx + sw, wx + ww - 6); if (sy > wy + 4 && sy < wy + wh - 4 && rr > l) p.r('2', l, sy, rr - l, 1); });
      for (let i = 0; i < 14; i++) { const sx = wx + 6 + r.int(0, ww - 12), sy = wy + 5 + r.int(0, wh - 10); if (p.at(sx, sy) === KEY.indexOf('0')) p.r(r.pick(['3', '4', '5']), sx, sy, 1, 1); }
      for (let i = 0; i < 3; i++) p.line('3', wx + 12 + i * 5, wy + 6, wx + 4 + i * 5, wy + 14); // glass glint
      p.r('p', wx + 8, wy + 1, ww - 16, 1); stencil(p, 'OBS-' + n, x0 + 10, y1 - 10, '4');
    });
  } else if (kind === 2) { // catnip garden pod: planter troughs of catnip under violet grow lights
    p.obj(() => {
      p.r('b', x0 + 4, y0 + 4, w - 8, h - 14);
      for (let j = y0 + 8; j < y1 - 18; j += 22) {
        p.r('0', x0 + 8, j, w - 16, 16); p.r('a', x0 + 9, j + 1, w - 18, 14); p.r('b', x0 + 10, j + 3, w - 20, 11); p.r('9', x0 + 9, j + 1, w - 18, 1);
        for (let i = x0 + 14; i < x1 - 14; i += 9) { const ly = j + 7 + ((i * 7) % 3); p.r('k', i - 2, ly, 5, 3); p.r('j', i - 1, ly - 2, 3, 3); p.r('i', i, ly - 2, 1, 1); p.r('j', i - 3, ly + 1, 2, 1); p.r('j', i + 2, ly + 1, 2, 1); }
        p.glow('2', 't', x0 + 12, j - 3, w - 24, 1, 1.4, 0);
        // the grow light catches the trough's front lip in one crisp violet line (no soft pool: the style stays crisp)
        p.glow('9', 'u', x0 + 10, j + 1, w - 20, 1, 1.4, 0);
      }
      stencil(p, 'GARDEN', x0 + 10, y1 - 10, 'j');
    });
    void cy;
  } else if (kind === 3) { // docking bay: hazard-striped bay doors, a landing ring and a little cat-food-can shuttle
    p.obj(() => {
      p.r('1', x0 + 4, y0 + 4, w - 8, h - 14);
      // the bay deck: a grid of plate seams, tyre-scuffs from the shuttle and guide lights round the ring
      for (let i = x0 + 22; i < x1 - 6; i += 24) p.r('v', i, y0 + 9, 1, h - 24);
      for (let j = y0 + 22; j < y1 - 18; j += 24) p.r('v', x0 + 5, j, w - 10, 1);
      for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; p.r('2', Math.round(cx + Math.cos(a) * 30), Math.round(cy - 2 + Math.sin(a) * 26), 2, 1); }
      for (let i = x0 + 4; i < x1 - 4; i++) { const st = ((i - x0) >> 2) & 1; p.r(st ? 'f' : '0', i, y0 + 4, 1, 4); p.r(st ? 'f' : '0', i, y1 - 14, 1, 4); }
      for (let j = y0 + 14; j < y1 - 18; j += 8) { p.r('2', x0 + 8, j, 3, 4); p.r('2', x1 - 11, j, 3, 4); }
      p.ring('f', cx, cy - 2, 26, 22, 2); p.ring('2', cx, cy - 2, 20, 16, 1);
      const sx = cx + (side ? -6 : 6), sy = cy - 2; p.disc('0', sx, sy, 13); p.disc('p', sx, sy, 12); p.disc('o', sx - 1, sy - 1, 10); p.ring('q', sx, sy, 8, 8, 1); p.r('r', sx - 7, sy - 2, 14, 4); p.r('6', sx - 5, sy - 1, 4, 1); p.r('0', sx + 8, sy - 1, 6, 2);
      stencil(p, 'DOCK ' + n, x0 + 10, y1 - 9, 'f');
    });
    p.glow('1', 'i', x0 + 6, y0 + 10, 2, 2, 1.4, 0); p.glow('1', 'r', x1 - 8, y0 + 10, 2, 2, 1.4, 0);
  } else { // habitat: plated deck, a scratching post and a porthole locker
    p.obj(() => {
      for (let i = x0 + 36; i < x1; i += 36) { p.r('1', i, y0 + 2, 1, h - 4); p.r('2', i + 1, y0 + 2, 1, h - 4); }
      for (let j = y0 + 36; j < y1; j += 34) { p.r('1', x0 + 2, j, w - 4, 1); p.r('2', x0 + 2, j + 1, w - 4, 1); }
      for (let j = y0 + 12; j < y1 - 6; j += 34) for (let i = x0 + 6; i < x1 - 6; i += 36) { p.r('1', i, j, 3, 3); p.r('1', i + 26, j + 20, 3, 3); }
      // surface detail: every other plate is tread plate (raised 2x1 dimples), bolts at the plate corners
      for (let j = y0 + 2, pj = 0; j < y1 - 4; j += 34, pj++) for (let i = x0 + 2, pi = 0; i < x1 - 4; i += 36, pi++) {
        if ((pi + pj) & 1) for (let yy = j + 5, n = 0; yy < Math.min(j + 31, y1 - 4); yy += 4, n++) for (let xx = i + 5 + (n & 1) * 3; xx < Math.min(i + 32, x1 - 4); xx += 6) { p.r('2', xx, yy, 2, 1); p.r('1', xx, yy + 1, 2, 1); }
        for (const [bx, by] of [[i + 2, j + 2], [i + 31, j + 2], [i + 2, j + 29], [i + 31, j + 29]]) if (bx < x1 - 2 && by < y1 - 2) p.r('3', bx, by, 1, 1);
      }
      // a floor hatch with a hazard-striped collar and a pair of food bowls by the locker
      const hx = x0 + (side ? 12 : w - 52), hy = y1 - 40;
      p.r('0', hx, hy, 34, 22); for (let i = 0; i < 32; i++) { const st = (i >> 2) & 1; p.r(st ? 'f' : '0', hx + 1 + i, hy + 1, 1, 2); p.r(st ? 'f' : '0', hx + 1 + i, hy + 19, 1, 2); }
      p.r('q', hx + 2, hy + 4, 30, 14); p.r('p', hx + 2, hy + 4, 30, 1); p.r('1', hx + 15, hy + 5, 4, 12); p.r('o', hx + 16, hy + 9, 2, 4);
      for (const [bx, k] of [[x1 - 54, 'r'], [x1 - 44, 'm']] as [number, string][]) { p.disc('0', bx, y0 + 50, 4); p.disc(k, bx, y0 + 50, 3); p.disc('9', bx, y0 + 50, 1.5); }
      stencil(p, 'HAB ' + n, x0 + 10, y1 - 9, '3');
    });
    scratchPost(p, x0 + r.int(28, 48), y0 + 6, r.int(12, 15));
    p.obj(() => { const bx = x1 - 36, by = y0 + 12; p.r('0', bx, by, 28, 28); p.r('n', bx + 1, by + 1, 26, 26); p.r('m', bx + 1, by + 1, 26, 1); p.r('2', bx + 1, by + 26, 26, 1); p.disc('0', bx + 14, by + 15, 6); p.disc('1', bx + 14, by + 15, 5); p.glow('1', 'l', bx + 13, by + 14, 2, 2, 1.5, 0); });
  }
}
const station: LayerDef = { speed: 1, paint(p, z) {
  const r = z.r;
  p.r('0', 200, 0, 48, SEG); p.r('q', 202, 0, 4, SEG); p.r('q', 242, 0, 4, SEG);
  for (let y = 0; y < SEG; y += 32) { p.line('q', 206, y, 241, y + 31); p.line('q', 241, y, 206, y + 31); p.r('p', 202, y, 44, 2); }
  p.r('p', 203, 0, 1, SEG);
  every(z, 64, 0, y => { if (y > 0 && y < SEG) { p.glow('1', 'r', 203, y, 2, 2, 1, 0); p.glow('1', 'i', 243, y + 32, 2, 2, 1, 0); } });
  // a deck sign on the spine every few segments
  if (z.s % 3 === 1) p.obj(() => { p.r('0', 207, 96, 34, 14); p.r('2', 208, 97, 32, 12); p.r('3', 208, 97, 32, 1); stencil(p, 'C-' + (((z.s % 9) + 9) % 9 + 1), 213, 100, 'f'); });
  for (const side of [0, 1]) {
    const mx = POD_X[side], mw = POD_W, my = POD_Y, mh = POD_H;
    // module per pod: never the same pair twice in a row, so the deck reads as a station, not a tile
    // eight module types walked in a fixed stride: the two pods of a segment always differ and no pod repeats for 8 segments
    const kind = (((z.s * 3 + side * 4) % 8) + 8) % 8, num = (((z.s * 7 + side * 3) % 9) + 9) % 9 + 1;
    p.shRect(mx, my, mw, mh, 16);
    // cat-ear antennae on the pod's top edge
    p.obj(() => { for (const ex of podEars(mx)) { for (let j = 0; j < 12; j++) { const hw = Math.round(j * 0.55) + 1; p.r('0', ex - hw - 1, my - 12 + j, hw * 2 + 2, 1); p.r('q', ex - hw, my - 12 + j, hw, 1); p.r('v', ex, my - 12 + j, hw, 1); if (j > 4) p.r('e', ex - Math.round(hw * 0.4), my - 12 + j, Math.max(1, Math.round(hw * 0.8)), 1); } p.r('0', ex, my - 18, 1, 6); } });
    p.obj(() => {
      // three shell silhouettes: a chamfered octagon, a rounded capsule, and a notched hull with stepped corners
      const shell = kind % 3;
      const cut = (j: number) => { const d = Math.min(j, mh - 1 - j);
        if (shell === 1) { const R = 22; return d < R ? Math.round(R - Math.sqrt(R * R - (R - d) * (R - d))) : 0; }
        if (shell === 2) return d < 5 ? 12 : d < 12 ? 6 : 0;
        return Math.max(0, 10 - d); };
      for (let j = 0; j < mh; j++) { const c = cut(j); p.r('0', mx + c, my + j, mw - 2 * c, 1); if (j > 0 && j < mh - 1) { const c2 = c + 1; p.r('q', mx + c2, my + j, mw - 2 * c2, 1); if (j > 2 && j < mh - 3) { const c3 = c + 3; p.r(j > 4 && j < mh - 5 ? 'v' : 'u', mx + c3, my + j, mw - 2 * c3, 1); if (j > 4 && j < mh - 5) { p.r('2', mx + c3, my + j, 2, 1); p.r('1', mx + mw - c3 - 2, my + j, 2, 1); } } } }
      if (shell === 0) { sisal(p, mx + 6, my + 14, mw - 12, 12); sisal(p, mx + 6, my + mh - 26, mw - 12, 12); }
      else if (shell === 1) { // the capsule: a band of round portholes top and bottom instead of scratch strips
        for (const wy of [my + 18, my + mh - 22]) { p.r('1', mx + 24, wy - 1, mw - 48, 6); for (let i = mx + 28; i < mx + mw - 30; i += 14) { p.disc('0', i + 2, wy + 2, 3); p.glow('n', 'm', i + 1, wy + 1, 2, 2, 1.2, 0); } } }
      else { sisal(p, mx + 6, my + 14, mw - 12, 12); // the notched hull: a vent grille along the bottom
        p.r('0', mx + 14, my + mh - 24, mw - 28, 9); for (let i = mx + 16; i < mx + mw - 16; i += 4) p.r('q', i, my + mh - 23, 2, 7); }
      // hull detail: rivets along the rim, conduits with clamps and a vent grille down the side margins
      for (let i = mx + 16; i < mx + mw - 16; i += 9) { p.r('p', i, my + 1, 1, 1); p.r('p', i, my + mh - 2, 1, 1); }
      for (let j = my + 30; j < my + mh - 30; j += 12) { p.r('p', mx + 1, j, 1, 1); p.r('p', mx + mw - 2, j, 1, 1); }
      for (const gx of [mx + 4, mx + mw - 7]) { p.r('1', gx, my + 28, 3, mh - 56); p.r('u', gx + 1, my + 28, 1, mh - 56); for (let j = my + 34; j < my + mh - 30; j += 18) { p.r('0', gx - 1, j, 5, 3); p.r('q', gx, j + 1, 3, 1); } }
      p.r('0', side ? mx - 12 : mx + mw, my + mh / 2 - 6, 12, 12); p.r('q', side ? mx - 12 : mx + mw, my + mh / 2 - 5, 12, 10);
      for (let i = 0; i < 5; i++) p.glow('2', kind === 2 ? 'i' : 'f', mx + 14 + i * 28, my + 3, 6, 2, 1.2, (i * 0.37) % 1);
    });
    podModule(p, kind, mx + 8, my + 28, mx + mw - 8, my + mh - 28, r, side, num);
    // between the pods: a solar wing, a radiator fin or a bare truss, varying per segment
    const sy = my + mh + 20, wing = (Math.abs(hash(z.seed, 'wing', z.s, side)) % 3);
    if (sy < SEG - 26) { const sx = side ? 300 : 60; p.obj(() => {
      if (wing === 0) { p.r('0', sx, sy, 100, 24); p.r('2', sx + 1, sy + 1, 98, 22); for (let i = sx + 1; i < sx + 99; i += 10) p.r('1', i, sy + 1, 1, 22); p.r('1', sx + 1, sy + 12, 98, 1); p.r('3', sx + 1, sy + 1, 98, 1); }
      else if (wing === 1) { for (let i = 0; i < 6; i++) { const fx = sx + 6 + i * 16; p.r('0', fx, sy - 2, 10, 28); p.r('p', fx + 1, sy - 1, 8, 26); p.r('o', fx + 1, sy - 1, 1, 26); p.r('q', fx + 7, sy - 1, 2, 26); } p.r('0', sx, sy + 10, 100, 4); p.r('q', sx, sy + 11, 100, 2); }
      else { p.r('0', sx + 10, sy + 6, 80, 12); for (let i = sx + 10; i < sx + 90; i += 10) { p.line('q', i, sy + 7, i + 9, sy + 16); p.line('q', i + 9, sy + 7, i, sy + 16); } p.r('p', sx + 10, sy + 6, 80, 1); p.r('p', sx + 10, sy + 17, 80, 1); }
      p.r('q', side ? sx - 40 : sx + 100, sy + 10, 40, 4); }); }
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
  // the window light carries the hour: pink at dawn, amber at dusk, a dim lavender by day / at night (the hull metal
  // itself never changes hue); never bright violet / purple, so the cats' bullets are the only bright small marks in the hall
  const [hi, lo] = p.tod === 'dusk' ? ['f', 'g'] : p.tod === 'dawn' ? ['c', 'd'] : ['4', '3'];
  for (let j = -4; j <= 4; j++) { const hw = Math.round(Math.sqrt(1 - (j / 5) ** 2) * 8 * (1 - Math.abs(j) / 14)); p.glow('2', j < -1 ? hi : lo, cx - hw, cy + j, hw * 2 + 1, 1, 1.5, 0); }
  p.lateBars.push([cx, cy - 4, 1, 9]); p.lateBars.push([cx - 1, cy - 2, 3, 5]);
}
/** yarn-cable conduit: two twisted strands in clamps */
function yarnCable(p: Painter, x: number, z: Seg) {
  p.r('0', x - 5, 0, 11, SEG);
  for (let y = 0; y < SEG; y++) { const w = z.wy(y); const o = Math.round(Math.sin(w / 5) * 3); p.r('e', x + o - 1, y, 3, 1); p.r('u', x - o - 1, y, 3, 1); if (Math.sin(w / 5) > 0.6) p.r('d', x + o - 1, y, 1, 1); }
  for (let y = 0; y < SEG; y += 40) { p.r('0', x - 7, y, 15, 5); p.r('q', x - 6, y + 1, 13, 3); p.r('p', x - 6, y + 1, 13, 1); }
}
/** a big almond viewport onto space (a cat's eye): a riveted frame, stars and a far planet's limb beyond, a slit mullion */
function catEyeWindow(p: Painter, cx: number, cy: number, rx: number, ry: number, r: Rng) {
  const rows = (k: string, ex: number, ey: number) => { for (let j = -ey; j <= ey; j++) { const t = j / (ey + 0.5), hw = Math.round(ex * (1 - t * t) ** 0.75); if (hw > 0) p.r(k, cx - hw, cy + j, hw * 2 + 1, 1); } };
  p.obj(() => {
    rows('0', rx + 4, ry + 4); rows('q', rx + 3, ry + 3); rows('2', rx + 1, ry + 1); rows('0', rx, ry);
    // beyond the glass: deep space, a scatter of stars and the lit limb of a far planet low in the window
    for (let i = 0; i < 14; i++) { const t = r.range(-0.8, 0.8), x = cx + Math.round(t * rx), y = cy + r.int(-ry + 3, ry - 3); if (Math.abs(y - cy) < ry * (1 - t * t) - 1) p.r(r.pick(['3', '4', '5']), x, y, 1, 1); }
    for (let i = -rx; i <= rx; i++) { const pj = Math.round(ry * 0.45 + (i * i) / (rx * 3.2)); const lim = Math.round(ry * Math.max(0, 1 - (i / rx) ** 2) ** 0.75); if (pj < lim) { p.r('n', cx + i, cy + pj, 1, lim - pj); p.r('m', cx + i, cy + pj, 1, 1); } }
    for (let i = -rx + 4; i < rx - 4; i += 7) { p.r('p', cx + i, cy - ry - 3, 1, 1); p.r('p', cx + i, cy + ry + 3, 1, 1); }
    // the slit pupil: a tall mullion splitting the glass, with a catchlight glint on the frame
    for (let j = -ry; j <= ry; j++) { const w = Math.max(1, Math.round(2.5 * (1 - (j / ry) ** 2))); p.r('0', cx - w, cy + j, w * 2 + 1, 1); }
    p.r('q', cx, cy - ry + 2, 1, ry * 2 - 3); p.r('6', cx - Math.round(rx * 0.55), cy - Math.round(ry * 0.5), 2, 1);
  });
}
/** an open hangar bay sunk into the deck: hazard-striped coaming, slid-back doors, landing lights and a parked cat-ear shuttle */
function hangarBay(p: Painter, x: number, y: number, r: Rng) {
  const w = 84, h = 70;
  p.obj(() => {
    p.r('0', x - 2, y - 2, w + 4, h + 4);
    for (let i = 0; i < w + 4; i += 2) { const k = ((i >> 2) & 1) ? 'f' : '0'; p.r(k, x - 2 + i, y - 2, 2, 2); p.r(k, x - 2 + i, y + h, 2, 2); }
    for (let j = 0; j < h; j += 2) { const k = ((j >> 2) & 1) ? 'f' : '0'; p.r(k, x - 2, y + j, 2, 2); p.r(k, x + w, y + j, 2, 2); }
    p.r('1', x, y, w, h); for (let i = x + 12; i < x + w; i += 12) p.r('v', i, y, 1, h); for (let j = y + 14; j < y + h; j += 14) p.r('v', x, j, w, 1);
    // the bay doors slid back under the deck edge (ribbed slabs at both ends)
    for (const dy of [y, y + h - 8]) { p.r('2', x, dy, w, 8); for (let i = x + 2; i < x + w; i += 6) p.r('1', i, dy + 1, 2, 6); p.r('3', x, dy, w, 1); }
    // a painted landing circle with a cat-head mark
    p.ring('f', x + w / 2, y + h / 2, 22, 16, 1);
    // the parked shuttle: a rounded hull with ear fins, a lit canopy and two engine bells
    const sx = x + w / 2 - 12, sy = y + h / 2 - 14;
    p.ell('0', sx + 12, sy + 15, 13, 14); p.ell('p', sx + 12, sy + 15, 12, 13); p.ell('o', sx + 9, sy + 11, 6, 6);
    for (const ex of [sx + 3, sx + 21]) for (let j = 0; j < 7; j++) { const hw = Math.round(j * 0.5); p.r('0', ex - hw - 1, sy + j - 2, hw * 2 + 3, 1); p.r('q', ex - hw, sy + j - 2, hw * 2 + 1, 1); }
    p.ell('0', sx + 12, sy + 11, 6, 4); p.r('0', sx + 8, sy + 27, 4, 3); p.r('0', sx + 13, sy + 27, 4, 3);
    p.r('q', sx + 9, sy + 27, 2, 2); p.r('q', sx + 14, sy + 27, 2, 2);
    void r;
  });
  p.glow('n', 'l', x + w / 2 - 4, y + h / 2 - 5, 9, 3, 1.5, 0);
  for (let i = 0; i < 5; i++) { p.glow('1', 'g', x + 6 + i * 18, y + 10, 2, 2, 1.5, 0); p.glow('1', 'g', x + 6 + i * 18, y + h - 12, 2, 2, 1.5, 0); }
}
/** the yarn-reactor core: a containment drum with clamped rings round a glowing ball of yarn (it glows at every hour) */
function reactorCore(p: Painter, cx: number, cy: number) {
  p.obj(() => {
    p.disc('0', cx, cy, 34); p.disc('q', cx, cy, 33); p.disc('1', cx, cy, 30); p.ring('2', cx, cy, 30, 30, 1);
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, bx = Math.round(cx + Math.cos(a) * 31), by = Math.round(cy + Math.sin(a) * 31); p.r('0', bx - 3, by - 3, 7, 7); p.r('p', bx - 2, by - 2, 5, 5); p.r('o', bx - 2, by - 2, 5, 1); }
    // the glow steps out from the core through the containment glass: wine, rose, pink, a hot cream heart
    p.disc('e', cx, cy, 24); p.ring('u', cx, cy, 24, 24, 1); p.disc('d', cx, cy, 17); p.disc('c', cx, cy, 11);
    // the yarn ball itself, wound in bands, with a loose strand feeding the conduit
    p.disc('d', cx, cy, 8); for (let j = -6; j <= 6; j += 3) { const hw = Math.round(Math.sqrt(64 - j * j)); p.r('c', cx - hw + 1, cy + j, hw * 2 - 1, 1); }
    p.r('7', cx - 3, cy - 4, 3, 2); p.r('6', cx - 3, cy - 4, 1, 1);
    for (let i = 0; i < 26; i++) p.r(i % 4 ? 'd' : 'c', cx + 8 + i, cy + Math.round(Math.sin(i / 3) * 2), 1, 1);
    // a stencilled hazard ring and the core's cat-ear vents
    for (let k = 0; k < 24; k++) { const a = k * Math.PI / 12; if (k & 1) p.r('f', Math.round(cx + Math.cos(a) * 36), Math.round(cy + Math.sin(a) * 36), 2, 2); }
  });
}
/** the Empress's banner hung from a rail: a long wine pennant with gold trim, her crown and cat sigil, a swallowtail hem */
function empressBanner(p: Painter, x: number, y: number, h: number) {
  const w = 18;
  p.obj(() => {
    p.r('0', x - 4, y - 3, w + 8, 4); p.r('p', x - 4, y - 3, w + 8, 1); p.r('o', x - 5, y - 4, 3, 3); p.r('o', x + w + 2, y - 4, 3, 3);
    for (let j = 0; j < h; j++) { const notch = j > h - 10 ? Math.min(w / 2, j - (h - 10)) : 0;
      const l = x, rr = x + w; if (notch) { p.r('0', l, y + j, w / 2 - notch + 1, 1); p.r('0', l + w / 2 + notch - 1, y + j, w / 2 - notch + 1, 1); p.r('e', l + 1, y + j, Math.max(0, w / 2 - notch - 1), 1); p.r('e', l + w / 2 + notch, y + j, Math.max(0, w / 2 - notch - 1), 1); continue; }
      p.r('0', l, y + j, w, 1); p.r('e', l + 1, y + j, w - 2, 1); p.r('f', l + 2, y + j, 1, 1); p.r('f', rr - 3, y + j, 1, 1); p.r('d', l + 4, y + j, 2, 1); }
    // the crown (three points) and a cat-head sigil below it
    const cx = x + w / 2, cy = y + 22;
    p.r('f', cx - 5, cy + 3, 11, 3); for (const dx of [-5, 0, 5]) p.r('f', cx + dx, cy, 1, 3); p.r('f', cx - 1, cy - 1, 3, 1); p.r('g', cx - 5, cy + 5, 11, 1);
    const hy = cy + 16; p.r('7', cx - 4, hy, 9, 6); p.r('7', cx - 4, hy - 3, 2, 3); p.r('7', cx + 3, hy - 3, 2, 3); p.r('0', cx - 2, hy + 2, 1, 1); p.r('0', cx + 2, hy + 2, 1, 1); p.r('d', cx, hy + 4, 1, 1);
    for (let j = hy + 12; j < y + h - 14; j += 10) { p.r('f', cx - 1, j, 3, 1); p.r('f', cx, j - 1, 1, 3); }
  });
}
/** a huge paw print stencilled on the hull plates in a paler paint (worn at the edges) */
function pawMarking(p: Painter, cx: number, cy: number, sc: number) {
  // solid paint (one flat tone, never a speckle or checker), with a 1px darker seam where the stencil edge meets the plate
  const pad = (x: number, y: number, rx: number, ry: number) => { spans(x, y, rx * sc + 1, ry * sc + 1, (sx, sy, w) => p.r('1', sx, sy, w, 1)); spans(x, y, rx * sc, ry * sc, (sx, sy, w) => p.r('2', sx, sy, w, 1)); };
  pad(cx, cy + 10, 20, 15);
  for (const [dx, dy, rx, ry] of [[-22, -8, 7, 9], [-8, -20, 7, 9], [8, -20, 7, 9], [22, -8, 7, 9]]) pad(cx + dx * sc, cy + dy * sc, rx, ry);
}
/** deep violet / gunmetal hull plates with alien-cat motifs; the starfield shows past the hull edges and between the ear-fins */
const mothership: LayerDef = { speed: 1, paint(p, z) {
  const r = z.r;
  const L = 72, R = SW - 72;
  p.r('0', L, 0, R - L, SEG);
  for (let y = 0; y < SEG; y += 32) for (let x = L; x < R; x += 76) {
    const w = Math.min(76, R - x);
    // two plate values (the main gunmetal and a darker armour plate, 's'), so the deck is never one flat grey
    const wyp = Math.floor(z.wy(y) / 32), hsh = (Math.imul(wyp * 7919 + x * 31, 0x27d4eb2d) >>> 0) % 7;
    const plate = hsh < 2 ? 's' : 'v';
    p.r(plate, x + 1, y + 1, w - 1, 31); p.r('2', x + 1, y + 1, w - 1, 1); p.r('2', x + 1, y + 1, 1, 31); p.r('1', x + 1, y + 31, w - 1, 1); p.r('1', x + w - 1, y + 1, 1, 31);
    const v = ((((x - L) / 76 + wyp) % 5) + 5) % 5;
    if (v === 0) for (let i = 0; i < 4; i++) p.r('1', x + 10, y + 7 + i * 5, w - 20, 2);
    else if (v === 2) { for (const [dx, dy] of [[6, 6], [w - 10, 6], [6, 23], [w - 10, 23]]) { p.r('1', x + dx, y + dy, 4, 4); p.r('2', x + dx, y + dy, 2, 1); } }
    // a raised inset panel (bevelled: lit top-left, shaded bottom-right) on some plates
    else if (v === 3 && w > 30) { p.r('1', x + 8, y + 7, w - 16, 18); p.r(plate === 's' ? 'v' : 's', x + 9, y + 8, w - 18, 16); p.r('2', x + 9, y + 8, w - 18, 1); p.r('2', x + 9, y + 8, 1, 16); }
    // a plate split by a diagonal seam
    else if (v === 4 && w > 30 && hsh > 4) { for (let i = 0; i < 30; i++) p.r('1', x + 8 + Math.round(i * (w - 16) / 30), y + 1 + i, 2, 1); }
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
    every(z, 48, outer ? 10 : 34, y => { if (y > 2 && y < SEG - 2) p.glow('1', outer ? '3' : '4', outer ? x0 + 3 : x1 - 5, y, 2, 2, 1, 0.3); });
  }
  // ear-shaped fins along both hull edges (pointing forward, like a cat's ears)
  for (const [x0, dir] of [[L, -1], [R, 1]] as [number, number][]) every(z, 128, 40, y => {
    for (let j = 0; j < 56; j++) { const out = Math.round(Math.min(j, 56 - j * 0.6) * 0.75); if (out <= 0) continue; const xa = dir > 0 ? x0 : x0 - out; p.r('0', xa - 1, y - 56 + j, out + 2, 1); p.r('v', xa, y - 56 + j, out, 1); const inner = Math.round(out * 0.45); if (j > 10 && inner > 1) p.r(p.tod === 'dusk' || p.tod === 'dawn' ? 'p' : '2', dir > 0 ? x0 + 3 : x0 - 3 - inner, y - 56 + j, inner, 1); }
  });
  p.r('u', L, 0, 1, SEG); p.r('u', R - 1, 0, 1, SEG);
  p.r('0', 326, 0, 12, SEG); p.r('q', 327, 0, 10, SEG); p.r('p', 327, 0, 1, SEG); p.r('v', 335, 0, 2, SEG); for (let y = 6; y < SEG; y += 52) { p.r('0', 324, y, 16, 8); p.r('1', 325, y + 1, 14, 6); p.glow('1', 'd', 330, y + 3, 4, 2, 1, 0.5); }
  // the conduit along the left of the deck changes along the ship: the twisted yarn cable, a bundle of coolant pipes, or
  // a bare deck strip with a cable tray, each run capped by a junction box at the segment seam
  { const run = ((z.s % 5) + 5) % 5;
    if (run < 2) yarnCable(p, 118, z);
    else if (run < 4) { p.r('0', 110, 0, 17, SEG); for (const [px, k, hi] of [[111, 'q', 'p'], [116, 'n', 'm'], [121, 'q', 'p']] as [number, string, string][]) { p.r(k, px, 0, 4, SEG); p.r(hi, px, 0, 1, SEG); }
      for (let y = 20; y < SEG; y += 48) { p.r('0', 108, y, 21, 6); p.r('q', 109, y + 1, 19, 4); p.r('p', 109, y + 1, 19, 1); } }
    else { p.r('0', 113, 0, 11, SEG); p.r('1', 114, 0, 9, SEG); for (let y = 0; y < SEG; y += 6) p.r('v', 115, y, 7, 1); }
    for (const jy of [0, SEG - 7]) { p.r('0', 106, jy, 25, 7); p.r('q', 107, jy + 1, 23, 5); p.r('p', 107, jy + 1, 23, 1); p.r('0', 116, jy + 2, 5, 3); } }
  // hull plating seams, vent grilles and glowing conduit panels, scattered asymmetrically
  for (let i = 0; i < 4; i++) {
    const kx = r.int(0, 3), x = [140, 200, 268, 300][kx] + r.int(-8, 8), y = r.int(4, SEG - 40);
    const kind = r.int(0, 2);
    if (kind === 0) { p.r('0', x, y, 28, 16); p.r('1', x + 1, y + 1, 26, 14); for (let j = y + 3; j < y + 14; j += 3) p.r('0', x + 3, j, 22, 1); p.r('2', x + 1, y + 1, 26, 1); }
    else if (kind === 1) { p.r('0', x, y, 10, 36); p.r('1', x + 1, y + 1, 8, 34); p.glow('2', p.tod === 'dusk' ? 'g' : p.tod === 'dawn' ? 'c' : '3', x + 3, y + 3, 4, 30, 1.5, 0); p.lateBars.push([x + 3, y + 12, 4, 1], [x + 3, y + 23, 4, 1]); }
    else { p.r('2', x, y, 40, 1); p.r('1', x, y + 1, 40, 1); for (let k = 0; k < 4; k++) p.r('2', x + 4 + k * 10, y + 4, 2, 2); }
  }
  // a long seam break so the plates do not read as a perfect grid
  { const sy = r.int(20, SEG - 20); p.r('0', 72, sy, SW - 144, 2); p.r('2', 72, sy + 2, SW - 144, 1); }
  // one landmark per segment, cycling so the hull never repeats within six screens: the Empress's cat-face bulkhead,
  // cat-eye windows onto space, an open hangar bay, the yarn-reactor core, her banners, painted paw-print markings
  const lm = ((z.s % 6) + 6) % 6;
  if (lm === 0) {
    const cx = 224, cy = 128;
    p.ell('0', cx, cy + 6, 46, 36); p.ell('1', cx, cy + 6, 44, 34);
    for (const sx of [-1, 1]) for (let j = 0; j < 30; j++) { const w = Math.round(j * 0.7); p.r('0', cx + sx * 30 - w - 1, cy - 50 + j, w * 2 + 3, 1); p.r('1', cx + sx * 30 - w, cy - 50 + j, w * 2 + 1, 1); if (j > 8) p.r('e', cx + sx * 30 - Math.round(w * 0.4), cy - 50 + j, Math.round(w * 0.8) + 1, 1); }
    p.ell('u', cx, cy + 6, 38, 28); p.ell('v', cx, cy + 8, 35, 25); p.ell('2', cx - 6, cy, 16, 8); p.ell('v', cx, cy + 10, 30, 20);
    catEye(p, cx - 16, cy + 2); catEye(p, cx + 16, cy + 2);
    p.r('0', cx - 4, cy + 13, 8, 4); p.r('d', cx - 3, cy + 13, 6, 3); for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) p.r('2', sx > 0 ? cx + 12 : cx - 32, cy + 16 + i * 4, 20, 1);
  } else if (lm === 1) { catEyeWindow(p, r.int(176, 196), 70, 30, 14, r); catEyeWindow(p, r.int(256, 276), 182, 26, 12, r); }
  else if (lm === 2) hangarBay(p, r.chance(0.5) ? 146 : 222, r.int(40, 120), r);
  else if (lm === 3) reactorCore(p, r.int(196, 252), r.int(84, 170));
  else if (lm === 4) { const by = r.int(10, 60); for (const bx of [158, 280]) empressBanner(p, bx, by, r.int(120, 150)); pawHatch(p, 224, by + 150); }
  else { pawMarking(p, r.int(160, 190), r.int(40, 90), 1); pawMarking(p, r.int(250, 290), r.int(150, 210), 0.8); pawHatch(p, r.int(200, 240), r.int(110, 130)); }
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

/** rooftops: a bright daylight (sunlit membrane decks, silver coatings and cream copings, cedar water towers, skylights
 * and solar panels mirroring a blue sky, the streets far below a hazy blue); dawn a step lower with peach decks, pink sky
 * in the glass and peach lips; dusk lower and warm (tan / light-brown decks, grey silver roofs, orange glass, plum shadows
 * cast long, amber rims); a dark slate night with warm lit windows. Materials keep their hue at every hour. */
const ROOF_RAMPS: Partial<Record<Tod, Ramp>> = {
  // bright noon: silver-coated decks with cream copings, crisp grey shadows, sky-blue glass, a hazy blue street below
  day: remap('q:o v:p p:7 o:7 1:2 2:3 3:4 n:m m:s b:a a:9'),
  // first light: one step under the day, peach decks, pink sky in the glass
  dawn: remap('q:p v:q p:8 o:7 m:c n:m', TOD_RAMP.dawn),
  // sunset: lower decks in warm tan / light brown, silver roofs a grey step down, orange sky in the glass
  dusk: remap('q:p v:q p:9 o:8 m:g n:n', TOD_RAMP.dusk),
  // night: a real night grade (orange decks to dark brown with plum tiles, silver roofs to slate), warm windows carry it
  night: remap('q:v v:1 p:q o:p 1:0 2:1 3:2 n:2 m:n g:b h:v 9:b a:b', TOD_RAMP.night),
};
/** docks: the water stays blue at every hour and only its glints carry the sky. Day: blue water, grey planks. Dawn:
 * pink glints. Dusk: calmer ripples with orange glints and peach highlights. Night: near-black blue water with deep blue
 * ripples, the planks a moonlit step above it */
const DOCK_RAMPS: Partial<Record<Tod, Ramp>> = {
  // first light: grey planks with warm tan nail-head highlights (never lavender), pink glints on the water
  dawn: remap('s:c 5:c o:8', TOD_RAMP.dawn),
  // golden hour: every material a value step under the day in its own hue: grey planks to dark grey with tan highlights,
  // the water a deeper blue under plum swells (painted by the water layer at dusk) with orange glints; amber west rims
  // and long plum shadows (SHADE_TOD) do the rest
  dusk: remap('n:n m:h l:m s:g 5:8 2:v p:q o:9 q:v', TOD_RAMP.dusk),
  night: remap('n:1 2:2 m:n p:q o:p', TOD_RAMP.night),
};
/** alley: grey asphalt and granite setts by day; dawn a grey step lower crossed by peach-pink door light; dusk a darker
 * grey crossed by warm cream-tan door light; a slate-plum night under small warm wall lamps */
const ALLEY_RAMPS: Partial<Record<Tod, Ramp>> = {
  day: remap('q:p p:o v:q'),
  dawn: remap('q:q p:p v:v o:o', TOD_RAMP.dawn),
  dusk: remap('q:q p:q v:v o:p 1:0', TOD_RAMP.dusk),
  night: remap('q:v p:q v:1 o:p 1:0', TOD_RAMP.night),
};
const ALLEY_DAWN_SHADE = remap('q:v p:q o:p 2:1 3:2 v:1', SHADE_TOD.dawn);
/** inside the alley's low-sun shafts (applied to day indices) */
/** the soft halo round each shaft: a step of the same warm light */
const ALLEY_SOFT: Partial<Record<Tod, Ramp>> = {
  // the light always brightens what it lands on: floor -> faint lift -> soft halo -> bright core (greys stay grey, only
  // the brightest tones warm)
  // dawn: a small, low-contrast cone (one step above the floor), pale stones catching peach
  dawn: remap('q:p p:p v:q o:o 1:v a:9 b:a', TOD_RAMP.dawn),
  // the halo: the same value as the floor, only warmer (asphalt -> dark brown, setts -> brown)
  dusk: remap('q:b p:a v:v o:9 1:1 2:v n:n 3:3 a:a b:b 9:9 f:f', TOD_RAMP.dusk),
};
/** dawn door light: a faint peach rim along the long edges of each small cone */
const ALLEY_PEACH = remap('q:9 p:8 v:a o:8 1:b', TOD_RAMP.dawn);
/** the faint outer step of a doorway's light spill: one warm step above the floor */
const ALLEY_TAIL: Partial<Record<Tod, Ramp>> = {
  dawn: remap('q:q p:8 v:v o:8', TOD_RAMP.dawn),
  dusk: remap('q:p p:p v:q o:o 1:v 2:2 n:n 3:3 a:9 b:a 9:9 f:f', TOD_RAMP.dusk),
};
const ALLEY_SUN: Partial<Record<Tod, Ramp>> = {
  dawn: remap('q:p p:o v:q o:8 1:v a:9 b:a 9:8', TOD_RAMP.dawn),
  // one warm step above what it lands on (asphalt -> brown, setts -> light brown, pits -> dark brown): textured, never a flat tan
  dusk: remap('q:a p:9 v:b o:8 1:v 2:v n:m 3:4 a:9 b:a 9:8 7:6 f:7'),
};
/** park: the gravel path stays grey at every hour; by night it stays a step above the dark lawn */
const PARK_RAMPS: Partial<Record<Tod, Ramp>> = {
  night: remap('q:q p:q o:p', TOD_RAMP.night) };
/** the litter moon: each hour its own dust colour (grey day, cool indigo dawn, warm umber dusk, navy night) */
const MOON_RAMPS: Partial<Record<Tod, Ramp>> = {
  // a sunlit grey moon; dawn a touch lower with pink highlights; a dimmer grey dusk with amber highlights (never brown);
  // a slate-navy night. Value falls day > dawn > dusk > night. The dust stays grey.
  // ('i' marks the brighter highland dust: always one step above the base ground)
  day: remap('8:9 7:8 i:o'),
  // dawn: crater crests catch a peach lip with a pink highlight on the sunward side, the dust stays grey
  dawn: remap('i:o 8:9 7:c 6:7 5:c o:8'),
  dusk: remap('p:q o:p q:v v:1 8:g 7:8 6:f 9:h 5:8 i:p'),
  night: remap('i:p o:q p:q q:1 v:0 9:a 8:9 7:8 6:5 5:4 4:3 3:2 2:1'),
};
/** factory: daylight steel a step up; dawn the authored steel; dusk a darker steel crossed by amber window shafts; a dark
 * plum-slate night under warm work-lamp pools. The steel stays grey; value falls day > dawn > dusk > night. */
// ('3' marks machine steel: the same grey as the floor plates by day, one step above the floor at dusk and night so the
// vats, spinners, racks and catwalk keep their silhouettes in the dark)
const FACTORY_RAMPS: Partial<Record<Tod, Ramp>> = {
  day: remap('q:p v:q p:o 3:p'),
  dawn: remap('q:q v:v p:p o:o 3:q', TOD_RAMP.dawn),
  dusk: remap('q:q v:v p:q o:p 1:1 3:p', TOD_RAMP.dusk),
  night: remap('q:v v:1 p:q o:p 1:0 3:q', TOD_RAMP.night),
};
/** mothership deck: gunmetal hull plates with violet trim at every hour. The metal never changes hue: day is sunlit grey,
 * dawn a step lower with only the cat-eye portholes and a few plate lips catching pink, dusk a step lower again with a plum
 * shade in the seams and warm light only from the portholes and conduits, night dark slate under violet running lights. */
const MOTHER_RAMPS: Partial<Record<Tod, Ramp>> = {
  day: remap('v:p 2:o 1:q s:q'),
  dawn: remap('v:p 2:p 1:q 5:c 6:7 s:q'),
  dusk: remap('v:q 2:p 1:v 5:8 6:7 s:v'),
  night: remap('v:1 2:q 1:0 o:p 5:4 6:o 4:3 3:2 s:q'),
};
/** street: a sunlit day (pale sidewalks and roofs a step up from the asphalt) */
const STREET_RAMPS: Partial<Record<Tod, Ramp>> = { day: ramp('q:p p:o'),
  // first light: the road and sidewalks a step under the day (still grey); peach comes from the highlights and rims
  dawn: remap('q:q p:p', TOD_RAMP.dawn),
  // golden hour: the concrete stays grey, a step under the day; the low sun only warms the lit lips (light brown) and
  // the amber west rims, and long plum shadows cross the sidewalks
  dusk: remap('q:q p:p o:9', TOD_RAMP.dusk),
  // night: the sidewalks stay a step above the road (plum slate over deep-night asphalt) and their seams stay darker than
  // the slabs, so a lamp pool lifts both and reads as lit pavement (no bright seam crosshair)
  night: remap('q:v v:1', TOD_RAMP.night) };
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
      const [k0, k1] = tod === 'night' ? ['3', '4'] : tod === 'dusk' ? ['t', '8'] : tod === 'dawn' ? ['c', '7'] : ['m', '4'];
      // dusk: the low sun lays a shimmering path across the water (screen-fixed, like a real reflection): stacked
      // horizontal dashes, widest and brightest at its core, breaking up toward its edges
      if (tod === 'dusk') for (let y = 0; y < 360; y++) {
        // a narrow, quiet path of glitter off to the right of the bullet lane: sparse peach / violet dashes, a few
        // cream ones only near the top (nearest the low sun), thinning out toward the bottom of the screen
        const row = y, hh = (Math.imul(row * 2654435761 ^ ((t >> 3) + row * 7) * 40503, 0x27d4eb2d) >>> 0);
        if (hh % 3 !== 0 || (y > 200 && (hh >>> 5) % 2)) continue;
        const sway = Math.round(Math.sin(row * 0.21 + t / 50) * 2), spread = 7 + Math.round(y / 45);
        const off = (((hh >>> 13) % (spread * 2 + 1)) - spread), x = 352 + sway + off, a = Math.abs(off) / spread;
        const len = 2 + ((hh >>> 20) % 3) + (a < 0.3 ? 1 : 0);
        ctx.fillStyle = col(y < 70 && a < 0.4 ? '7' : a < 0.35 ? 'c' : a < 0.7 ? 't' : 'd'); ctx.fillRect(x - (len >> 1), y, len, 1);
      }
      for (let i = 0; i < 26; i++) {
        const ph = (t / 90 + i * 0.37) % 1; if (ph > 0.7) continue;
        const x = 110 + ((i * 97 + Math.floor(t / 6) * (i % 3 === 0 ? 1 : 0)) % 334), y = Math.floor((i * 53 + scroll * 0.82) % 380) - 10;
        const len = ph < 0.2 || ph > 0.5 ? 2 : 3; ctx.fillStyle = col(ph < 0.35 ? k1 : k0); ctx.fillRect(x, y, len, 1);
        if (len === 3) ctx.fillRect(x + 1, y - 1, 1, 1);
      }
    } },
  factory: { id: 'factory', speed: 0.6, base: '1', ramps: FACTORY_RAMPS, far: factoryFar, main: factory, fg: girdersFg, fx: factoryFx, rim: false, anim: flyers('steam', 300) },
  sky: { id: 'sky', speed: 0.8, base: 'n', backdrop: skyBackdrop, rim: false, far: skyFar, main: skyMain, fg: wispsFg, ramps: SKY_RAMPS, anim: both(flyers('wisps', 200), flyers('birds', 650)) },
  nebula: { id: 'nebula', speed: 0.7, space: true, base: '0', ramps: NEBULA_RAMPS, far: nebulaFar, main: nebulaMain, fg: streaksFg, anim: both(twinkle(['4', 't', 'l']), flyers('debris', 480)) },
  moon: { id: 'moon', speed: 0.35, space: true, base: 'p', ramps: MOON_RAMPS, main: moon, fg: moonFg, fx: moonFx, anim: flyers('debris', 560) },
  station: { id: 'station', speed: 0.5, space: true, base: '0', far: starFar('0', 90), main: station, anim: both(twinkle(['4', 'l']), earLights, flyers('debris', 600)) },
  mothership: { id: 'mothership', speed: 0.7, space: true, base: '0', ramps: MOTHER_RAMPS, far: motherFar, main: mothership, anim: both(navLights([74, 374], 96, ['r', 'l', 'd']), flyers('debris', 450)) },
};
TILESETS.space = TILESETS.nebula;
