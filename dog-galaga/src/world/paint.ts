// Pixel-exact, palette-exact painting helpers for world backgrounds.
// Everything here draws with integer fillRects in fixed-palette colors only:
// no arcs, no strokes, no alpha blending. Lighting (shadows, time of day, lamp
// pools) is done by remapping palette indices in an index buffer, painted once per segment.
import { PALETTE, KEY } from '../core/palette';
import type { Tod } from '../core/types';

export const RGB: [number, number, number][] = PALETTE.map(h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);

/**
 * A palette ramp: pixel index i maps to a[i], or to b[i] where the 4x4 Bayer
 * threshold at (x,y) is below lv[i] (ordered-dither mix of two palette
 * entries). That gives in-between tones (e.g. a night green darker than the
 * darkest green in the palette) while every pixel stays a palette colour.
 */
export interface Ramp { a: Uint8Array; b: Uint8Array; lv: Uint8Array; id: boolean }
/** Build a ramp from "from:to" pairs; "from:toX/N" mixes in X at level N/16. Missing keys map to themselves. */
export function ramp(map: string, base?: Ramp): Ramp {
  const a = new Uint8Array(32), b = new Uint8Array(32), lv = new Uint8Array(32);
  for (let i = 0; i < 32; i++) { a[i] = base ? base.a[i] : i; b[i] = base ? base.b[i] : i; lv[i] = base ? base.lv[i] : 0; }
  for (const pair of map.trim().split(/\s+/).filter(Boolean)) {
    const [f, t] = pair.split(':'); const i = KEY.indexOf(f);
    const [cols, n] = t.split('/');
    a[i] = KEY.indexOf(cols[0]); b[i] = KEY.indexOf(cols[1] ?? cols[0]); lv[i] = cols.length > 1 ? +(n ?? 8) : 0;
  }
  let id = true; for (let i = 0; i < 32; i++) if (a[i] !== i || lv[i]) id = false;
  return { a, b, lv, id };
}
/** One step darker, same hue family (used for cast shadows at day/night). */
export const SHADE = ramp('1:0 2:1 3:2 4:3 5:4 6:5 7:8 8:9 9:a a:b b:v c:d d:e e:v f:g g:h h:a i:j j:k k:1 l:m m:n n:2 o:p p:q q:v r:h s:l t:u u:2 v:1');
/** Cast shadows per time of day: cool lavender-blue at dawn, plum at dusk, deep navy at night. Never dithered. */
export const SHADE_TOD: Record<Tod, Ramp> = {
  day: SHADE,
  night: ramp('2:1 q:1 3:2 k:1 n:1 p:2 4:3 u:2 o:q 9:b a:v 8:p', SHADE),
  dawn: ramp('k:2 j:k q:2 p:3 o:4 7:5 8:4 9:3 a:2 b:1 h:a v:1 i:m 3:2', SHADE),
  dusk: ramp('k:vk/8 j:k q:v p:q o:p 8:a 9:b a:v b:v h:b g:h 4:u 3:2 2:v n:v m:n 1:0', SHADE),
};
// ---------------------------------------------------------------- lighting
// Time of day is LIGHT, not a recolour: every palette entry is multiplied by a
// coloured light (and lifted by a coloured ambient) in linear RGB, and the result is
// matched back to the palette by perceptual distance (OKLab, hue weighted). So each
// material keeps its hue family (grass stays green-to-olive, regolith stays grey,
// brick stays brick) and only value and temperature move. A material whose lit
// colour falls between two palette entries gets a 50/50 or 25/75 ordered dither of
// two entries that are close in value (never a speckle of far-apart colours).
const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const LIN: [number, number, number][] = RGB.map(([r, g, b]) => [lin(r), lin(g), lin(b)]);
function oklab([r, g, b]: [number, number, number]): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
const LAB = LIN.map(oklab);
/** hue-weighted perceptual distance: a hue or chroma error costs more than a value error */
function dE(a: [number, number, number], b: [number, number, number]) { const dl = a[0] - b[0], da = (a[1] - b[1]) * 2.6, db = (a[2] - b[2]) * 2.6; return Math.sqrt(dl * dl + da * da + db * db); }
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** every single palette entry and every allowed two-entry dither blend, with its OKLab colour and its dither cost (built once) */
let MIX: [number, number, number, [number, number, number], number][] | null = null;
function mixes() {
  if (MIX) return MIX;
  MIX = [];
  for (let p = 0; p < 32; p++) for (let q = p; q < 32; q++) {
    const pq = p === q ? 0 : dist(LAB[p], LAB[q]);
    if (pq > 0.22) continue; // only blend neighbours in value / hue
    for (const f of p === q ? [0] : [0.25, 0.5, 0.75]) {
      const m: [number, number, number] = [0, 1, 2].map(k => LIN[p][k] * (1 - f) + LIN[q][k] * f) as [number, number, number];
      MIX.push([p, q, f, oklab(m), f ? 0.03 + pq * 0.45 * (f === 0.5 ? 1 : 1.25) : 0]);
    }
  }
  return MIX;
}
/** a light: multiply (linear RGB), then add ambient; `hi` adds a tint to bright colours only (sky glow on pale tones) */
export interface Light { mul: [number, number, number]; add?: [number, number, number]; hi?: [number, number, number]; sat?: number }
/** Pixel keys a light leaves alone (emissives, sky windows...) */
export function lightRamp(L: Light, keep = '', override = ''): Ramp {
  const a = new Uint8Array(32), b = new Uint8Array(32), lv = new Uint8Array(32);
  const add = L.add ?? [0, 0, 0], hi = L.hi ?? [0, 0, 0], sat = L.sat ?? 1;
  for (let i = 0; i < 32; i++) {
    a[i] = b[i] = i; lv[i] = 0;
    if (keep.includes(KEY[i])) continue;
    const c = LIN[i]; const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const t = [0, 1, 2].map(k => { const v = y + (c[k] - y) * sat; return Math.max(0, v * L.mul[k] + add[k] + hi[k] * y * y); }) as [number, number, number];
    const T = oklab(t);
    let best = 1e9;
    for (const [p, q, f, lab, cost] of mixes()) { const e = dE(lab, T) + cost; if (e < best) { best = e; a[i] = p; b[i] = q; lv[i] = Math.round(f * 16); } }
  }
  const r: Ramp = { a, b, lv, id: false };
  return override ? ramp(override, r) : r;
}
/** outdoor light per time of day (day is identity: backgrounds are authored in muted day colours, the brightest key) */
export const LIGHT: Record<Exclude<Tod, 'day'>, Light> = {
  // first light: pale, low contrast, cool lavender ambient with a peach-pink glow on pale tones
  dawn: { mul: [0.74, 0.72, 0.86], add: [0.03, 0.022, 0.045], hi: [0.16, 0.04, 0.05], sat: 0.85 },
  // sunset: one step darker, amber light, plum ambient in the shadows
  dusk: { mul: [0.78, 0.46, 0.32], add: [0.012, 0.002, 0.016], sat: 1.05 },
  // moonlight: navy, about 40% lower value
  night: { mul: [0.17, 0.22, 0.4], add: [0.003, 0.004, 0.012], sat: 0.8 },
};
const ID = ramp('');
/**
 * Outdoor ramps. The overrides pin the big ground materials so each time of day reads at a glance
 * while keeping the material: dewy grey-green lawn at dawn, olive lawn at dusk, blue-green lawn at night.
 */
export const TOD_RAMP: Record<Tod, Ramp> = {
  day: ID,
  dawn: lightRamp(LIGHT.dawn, '', 'k:k4/6 j:j5/4 0:v 1:v q:q3/4 o:oc/4 v:v 7:c'),
  dusk: lightRamp(LIGHT.dusk, '', 'k:kb/4 j:h i:g'),
  night: lightRamp(LIGHT.night, '', 'k:2k/8 j:k i:k'),
};
/** Low sun on the sunward faces: warm amber at dusk (west faces), peach-pink at dawn (top / east edges). */
export const RIM_RAMP: Partial<Record<Tod, Ramp>> = {
  dusk: ramp('q:h p:g o:f v:a 1:b 2:e 3:d 4:c 5:7 a:g b:h 9:g 8:f 7:f k:a j:9 i:f n:e m:d 6:7 u:d t:c e:d'),
  dawn: ramp('q:p p:8 o:c v:q 1:v 2:3 3:4 4:c 5:c a:9 b:a 9:8 8:c 7:c k:j j:8 n:m m:4 h:g e:d u:t'),
};
/** Inside a lamp pool at night: warm sodium light (applied to day colours), so lit grass stays green but goes golden. */
export const LAMP_RAMP = lightRamp({ mul: [1.0, 0.72, 0.34], add: [0.01, 0.006, 0] }, '', '0:0 1:b v:b 2:a 3:9 q:a p:9 o:8 n:a k:ka/4 j:j9/4 m:9 b:a a:9 9:8');
/** Outer falloff ring of a lamp pool: halfway between sodium light and moonlight. */
export const LAMP_EDGE = lightRamp({ mul: [0.5, 0.42, 0.38], add: [0.005, 0.004, 0.008] }, '', '0:0 1:v v:b 2:b 3:b q:b p:a o:9 n:b k:k2/4 j:k m:n');
/** Interiors: the lights are on after dark, so the room dims and warms instead of going black (pendant pools stay at day colours). */
export const INDOOR_LIGHT: Record<Exclude<Tod, 'day'>, Light> = {
  // early sun through the windows: pale, soft and peach (lifted shadows, warm highlights)
  dawn: { mul: [0.9, 0.8, 0.72], add: [0.05, 0.03, 0.026], hi: [0.12, 0.04, 0.0], sat: 0.8 },
  // golden hour: amber room, plum shadows
  dusk: { mul: [0.82, 0.55, 0.36], add: [0.01, 0.002, 0.012] },
  // closing time: the room drops to a dim plum-navy and only the pendant pools stay warm
  night: { mul: [0.24, 0.22, 0.34], add: [0.004, 0.003, 0.01], sat: 0.8 },
};
export const INDOOR_RAMP: Record<Tod, Ramp> = {
  day: ID,
  // pale honey floor, lifted shadows
  dawn: lightRamp(INDOOR_LIGHT.dawn, '', 'b:a v:b a:9 9:8 0:v 1:v 2:3 3:4 q:p n:3'),
  // the floor sinks into warm shade so the low amber beams and the first lamp pools read
  dusk: lightRamp(INDOOR_LIGHT.dusk, '', 'b:bv/4 v:v'),
  night: lightRamp(INDOOR_LIGHT.night),
};
/** Sunbeams through windows (interiors by day/dawn): warm lift. */
export const SUN_RAMP = ramp('0:1 1:v v:b b:a a:a 9:9 8:8 q:p p:p 2:3 3:3 e:e u:u n:n k:k');
/** Low dusk sun through the windows: deep amber / rust beams. */
export const DUSK_SUN = ramp('0:1 1:b v:b b:a a:h 9:9 q:b p:a 2:e 3:u n:2 k:k');
/** Space: day = sunlit hull, night = eclipse (highlights drop, running lights on). */
export const SPACE_RAMP: Record<Tod, Ramp> = {
  // sunlit: the void lifts to a deep indigo haze and hull plates catch white light
  day: ramp('0:1 1:2 v:2 2:3'),
  // a sunrise over the planet's rim: plum void, pink and violet highlights
  dawn: ramp('0:v 1:v 2:u o:8 5:c 4:t 6:7'),
  // sunset glare: warm brown-magenta void, amber highlights
  dusk: ramp('0:v 1:v v:b 2:b 3:e u:e o:g 5:c 4:t 6:f'),
  night: ramp('o:p 5:4 6:5 4:3 3:2 8:9 7:8'),
};

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const bayer = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];

/** palette key char code -> palette index */
const KI = new Uint8Array(128); for (let i = 0; i < 32; i++) KI[KEY.charCodeAt(i)] = i;
const ci = (k: string) => KI[k.charCodeAt(0)];
const CLEAR = 255;

/** spill: the light source is world-spaced (painted in both neighbouring segments), so the pool may cross the segment edge */
export interface Pool { x: number; y: number; r: number; clip?: [number, number, number, number]; spill?: boolean }

/**
 * Painter over one segment. Everything is drawn into a palette-index buffer
 * (255 = transparent), so primitives, shadows and lighting remaps are plain
 * typed-array writes; the buffer is converted to pixels once, in finish().
 */
export class Painter {
  buf: Uint8Array;
  shadow: Uint8Array;
  pools: Pool[] = [];
  /** skewed sunbeam parallelograms (interiors at dawn/day) */
  beams: { x: number; y: number; w: number; h: number; skew: number }[] = [];
  /** low-sun rim light rows [x, y, w] (west faces at dusk, east faces at dawn) */
  rims: number[] = [];
  glows: { lit: number; x: number; y: number; w: number; h: number; on: boolean }[] = [];
  objs: (() => void)[] = [];
  /** dark frame bars drawn over emissives (window mullions) */
  lateBars: [number, number, number, number][] = [];
  /** rim lights on (outdoor tilesets only) */
  rimLight = true;
  /** ramp used inside sunbeams */
  sunRamp: Ramp = SUN_RAMP;
  /** lamp pools are scaled by this (busy tilesets keep them small) */
  poolScale = 0.55;
  constructor(public canvas: HTMLCanvasElement, public w: number, public h: number, public tod: Tod) {
    this.buf = new Uint8Array(w * h).fill(CLEAR);
    this.shadow = new Uint8Array(w * h);
  }
  private fill(i: number, x: number, y: number, w: number, h: number) {
    let x0 = x | 0, y0 = y | 0; let x1 = x0 + (w | 0), y1 = y0 + (h | 0);
    if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 > this.w) x1 = this.w; if (y1 > this.h) y1 = this.h;
    if (x1 <= x0) return;
    for (let j = y0; j < y1; j++) this.buf.fill(i, j * this.w + x0, j * this.w + x1);
  }
  /** filled rect in palette key k */
  r(k: string, x: number, y: number, w = 1, h = 1) { if (w <= 0 || h <= 0) return; this.fill(ci(k), x, y, w, h); }
  /** palette index at (x,y), 255 if clear */
  at(x: number, y: number) { x |= 0; y |= 0; return x < 0 || y < 0 || x >= this.w || y >= this.h ? CLEAR : this.buf[y * this.w + x]; }
  /** 1px rectangular outline */
  frame(k: string, x: number, y: number, w: number, h: number) { this.r(k, x, y, w, 1); this.r(k, x, y + h - 1, w, 1); this.r(k, x, y, 1, h); this.r(k, x + w - 1, y, 1, h); }
  /** pixel-exact filled ellipse centred on (cx,cy) (half-pixel centres allowed via .5) */
  ell(k: string, cx: number, cy: number, rx: number, ry: number) {
    const i = ci(k); spans(cx, cy, rx, ry, (x, y, w) => this.fill(i, x, y, w, 1));
  }
  disc(k: string, cx: number, cy: number, r: number) { this.ell(k, cx, cy, r, r); }
  /** ellipse ring of thickness t */
  ring(k: string, cx: number, cy: number, rx: number, ry: number, t = 1) {
    const inner = new Map<number, [number, number]>();
    spans(cx, cy, rx - t, ry - t, (x, y, w) => inner.set(y, [x, x + w]));
    spans(cx, cy, rx, ry, (x, y, w) => { const i = inner.get(y); if (!i) this.r(k, x, y, w, 1); else { this.r(k, x, y, i[0] - x, 1); this.r(k, i[1], y, x + w - i[1], 1); } });
  }
  /** Bresenham line */
  line(k: string, x0: number, y0: number, x1: number, y1: number) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0; const c = ci(k);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy;
    for (;;) { this.fill(c, x0, y0, 1, 1); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
  }
  /** ordered-dither fill: level 0..16 of key k over the rect */
  dith(k: string, x: number, y: number, w: number, h: number, level: number) {
    const c = ci(k);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (bayer(x + i, y + j) < level) this.fill(c, x + i, y + j, 1, 1);
  }
  /** checkerboard dither (cheap 50%) */
  checker(k: string, x: number, y: number, w: number, h: number, phase = 0) {
    const c = ci(k);
    for (let j = 0; j < h; j++) for (let i = (j + phase + x + y) & 1; i < w; i += 2) this.fill(c, x + i, y + j, 1, 1);
  }
  /** direct pixel writes (for dense procedural fills); keys index the palette */
  pixels(fn: (set: (k: string, x: number, y: number) => void) => void) {
    const b = this.buf, w = this.w, h = this.h;
    fn((k, x, y) => { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= w || y >= h) return; b[y * w + x] = KI[k.charCodeAt(0)]; });
  }

  // ---- lighting model ----
  /** Shadow offset per unit of object height for the current time of day (long and low at dawn / dusk). */
  cast(height: number): [number, number] {
    const t = this.tod;
    const [ax, ay] = t === 'dawn' ? [-1.1, 1.0] : t === 'dusk' ? [1.7, 0.45] : t === 'night' ? [0.2, 0.25] : [0.45, 0.55];
    return [Math.round(ax * height), Math.round(ay * height)];
  }
  private sm(x: number, y: number, w: number, h: number) {
    const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0), x1 = Math.min(this.w, (x + w) | 0), y1 = Math.min(this.h, (y + h) | 0);
    for (let j = y0; j < y1; j++) this.shadow.fill(1, j * this.w + x0, j * this.w + Math.max(x0, x1));
  }
  /** rows of the low-sun rim: 2px on the sunward edge of a footprint row */
  private rimRow(x: number, y: number, w: number) {
    if (!this.rimLight || w < 4) return;
    if (this.tod === 'dusk') this.rims.push(x + 1, y, 2);
    else if (this.tod === 'dawn') this.rims.push(x + w - 2, y, 1);
  }
  /** dawn: the low north-east sun catches the top (and right) edge of an object */
  private rimTop(x: number, y: number, w: number) {
    if (!this.rimLight || this.tod !== 'dawn' || w < 4) return;
    this.rims.push(x + 1, y, w - 2, x + 2, y + 1, w - 3);
  }
  /** rectangular object footprint of given height casts a swept shadow (and catches a rim of low sun) */
  shRect(x: number, y: number, w: number, h: number, height: number) {
    const [dx, dy] = this.cast(height); const n = Math.max(Math.abs(dx), Math.abs(dy), 1);
    for (let i = 0; i <= n; i++) this.sm(x + Math.round(dx * i / n), y + Math.round(dy * i / n), w, h);
    if (height >= 5) { for (let j = 1; j < h - 1; j++) this.rimRow(x, y + j, w); this.rimTop(x, y, w); }
  }
  shEll(cx: number, cy: number, rx: number, ry: number, height: number) {
    const [dx, dy] = this.cast(height); const n = Math.max(Math.abs(dx), Math.abs(dy), 1);
    for (let i = 0; i <= n; i += Math.max(1, (n / 6) | 0)) spans(cx + Math.round(dx * i / n), cy + Math.round(dy * i / n), rx, ry, (x, y, w) => this.sm(x, y, w, 1));
    spans(cx + dx, cy + dy, rx, ry, (x, y, w) => this.sm(x, y, w, 1));
    if (height >= 5) { let n2 = 0; spans(cx, cy, rx, ry, (x, y, w) => { this.rimRow(x, y, w); if (n2++ < 2) this.rimTop(x, y, w); }); }
  }
  /** draw this after the ground shadows are applied */
  obj(fn: () => void) { this.objs.push(fn); }
  /** a sunbeam: parallelogram lit with SUN_RAMP (only shown when the caller decides it is daytime) */
  beam(x: number, y: number, w: number, h: number, skew: number) { this.beams.push({ x, y, w, h, skew }); }
  /** a light source: lamp pool at night */
  pool(x: number, y: number, r: number, clip?: [number, number, number, number], spill = false) { this.pools.push({ x, y, r, clip, spill }); }
  /** emissive rect: shows `day` normally, `lit` (unaffected by darkness) when the light is on */
  glow(day: string, lit: string, x: number, y: number, w: number, h: number, chance = 1, roll = 0) {
    const t = this.tod; const p = t === 'night' ? chance : t === 'dusk' ? chance * 0.7 : t === 'dawn' ? chance * 0.3 : 0;
    this.r(day, x, y, w, h);
    this.glows.push({ lit: ci(lit), x, y, w, h, on: roll < p });
  }
  /** Run the passes: shade shadows -> objects -> time-of-day remap (with lamp pools, sunbeams, rim light) -> emissives -> pixels. */
  finish(todRamp: Ramp, pools: boolean, poolRamp: Ramp = LAMP_RAMP, rimRamp: Ramp | null = null) {
    const { w, h, buf } = this;
    const sh = SHADE_TOD[this.tod];
    for (let i = 0; i < w * h; i++) if (this.shadow[i]) {
      const v = buf[i];
      if (v === CLEAR) { if (((i % w) + ((i / w) | 0)) & 1) buf[i] = 1; continue; }
      buf[i] = sh.lv[v] > BAYER[(((i / w) | 0) & 3) * 4 + ((i % w) & 3)] ? sh.b[v] : sh.a[v];
    }
    for (const f of this.objs) f();
    // light mask: 1 lamp pool, 2 sunbeam, 3 rim, 4 lamp falloff
    let mask: Uint8Array | null = null;
    if (rimRamp && this.rims.length) {
      mask = new Uint8Array(w * h); const R = this.rims;
      for (let k = 0; k < R.length; k += 3) { const x = R[k], y = R[k + 1]; if (y < 0 || y >= h) continue; for (let i = Math.max(0, x); i < Math.min(w, x + R[k + 2]); i++) mask[y * w + i] = 3; }
    }
    if (pools && this.pools.length) {
      // small hard-edged lamp cones: a solid warm core, then a 2-step ordered-dither falloff
      mask = mask ?? new Uint8Array(w * h);
      for (const p of this.pools) {
        let R = Math.max(6, Math.round(p.r * this.poolScale));
        // a pool whose source lives in this segment only must not be cut by the segment edge: it shrinks to fit instead
        if (!p.spill) R = Math.min(R, Math.floor(Math.min(p.y, h - 1 - p.y) * 1.2));
        if (R < 5) continue;
        const rin = R * 0.62, rmid = R * 0.82;
        for (let y = Math.max(0, p.y - R); y < Math.min(h, p.y + R + 1); y++) for (let x = Math.max(0, p.x - R); x < Math.min(w, p.x + R + 1); x++) {
          if (p.clip && (x < p.clip[0] || y < p.clip[1] || x >= p.clip[0] + p.clip[2] || y >= p.clip[1] + p.clip[3])) continue;
          const d = Math.hypot((x - p.x), (y - p.y) * 1.2); if (d > R) continue;
          const o = y * w + x; const b = bayer(x, y);
          if (d <= rin) mask[o] = 1;
          else if (d <= rmid) mask[o] = b < 10 ? 1 : 4;
          else if (b < 8 && mask[o] !== 1) mask[o] = 4;
        }
      }
    }
    if (this.beams.length) {
      mask = mask ?? new Uint8Array(w * h);
      for (const b of this.beams) for (let y = Math.max(0, b.y); y < Math.min(h, b.y + b.h); y++) {
        const x0 = b.x + Math.round((y - b.y) * b.skew);
        for (let x = Math.max(0, x0); x < Math.min(w, x0 + b.w); x++) { const e = Math.min(x - x0, x0 + b.w - 1 - x, y - b.y, b.y + b.h - 1 - y); if (e >= 3 || bayer(x, y) < (e + 1) * 4) { const o = y * w + x; if (mask[o] !== 1) mask[o] = 2; } }
      }
    }
    if (!todRamp.id || mask) {
      const ramps: (Ramp | null)[] = [todRamp, poolRamp, this.sunRamp, rimRamp, poolRamp === LAMP_RAMP ? LAMP_EDGE : todRamp];
      for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
        const v = buf[i]; if (v === CLEAR) continue;
        const rm = ramps[mask ? mask[i] : 0] ?? todRamp; if (rm.id) continue;
        buf[i] = rm.lv[v] > BAYER[(y & 3) * 4 + (x & 3)] ? rm.b[v] : rm.a[v];
      }
    }
    for (const g of this.glows) if (g.on) this.fill(g.lit, g.x, g.y, g.w, g.h);
    for (const [x, y, ww, hh] of this.lateBars) this.r('0', x, y, ww, hh);
    this.flush();
  }
  /** write the index buffer to the canvas */
  flush() {
    const ctx = this.canvas.getContext('2d')!;
    const img = ctx.createImageData(this.w, this.h); const d = new Uint32Array(img.data.buffer); const b = this.buf;
    for (let i = 0; i < b.length; i++) { const v = b[i]; if (v !== CLEAR) d[i] = ABGR[v]; }
    ctx.putImageData(img, 0, 0);
  }
}
/** palette as little-endian RGBA words */
const ABGR = new Uint32Array(RGB.map(([r, g, b]) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0));

/** Row spans of a pixel ellipse. */
export function spans(cx: number, cy: number, rx: number, ry: number, fn: (x: number, y: number, w: number) => void) {
  if (rx < 0.5 || ry < 0.5) { fn(Math.round(cx), Math.round(cy), 1); return; }
  const y0 = Math.ceil(cy - ry - 0.5), y1 = Math.floor(cy + ry - 0.5);
  for (let y = y0; y <= y1; y++) {
    const dy = (y + 0.5 - cy) / ry; const t = 1 - dy * dy; if (t < 0) continue;
    const hw = rx * Math.sqrt(t); const xa = Math.round(cx - hw), xb = Math.round(cx + hw);
    if (xb > xa) fn(xa, y, xb - xa);
  }
}
