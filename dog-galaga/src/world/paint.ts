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
// Time of day is a PALETTE REMAP: each time of day is a palette index -> palette index table applied once,
// when a segment is cached. Every pixel maps to exactly one palette entry (no global dither, so the band
// behind the formation stays calm and flat); each material keeps its hue family and only value and
// temperature move. Dither is only used for small local light falloff (lamp pool rings, beam edges).
//   day   brightest, most neutral (identity: backgrounds are authored in day colours)
//   dawn  a little lower, cool slate neutrals, whites go pale lavender, creams and yellows go peach-pink
//   dusk  lower and warm: creams to tan, woods one step deeper, greys into plum, greens flatten
//   night dark navy: only emissives (windows, lamps) and lamp pools stay bright
/** a full remap from "from:to" pairs (missing keys map to themselves) */
const remap = (map: string, base?: Ramp) => ramp(map, base);
const ID = ramp('');
/** outdoor time-of-day remaps */
export const TOD_RAMP: Record<Tod, Ramp> = {
  day: ID,
  dawn: remap('6:5 7:8 f:c g:c h:a i:j j:m l:m o:4 p:3 q:2 r:d s:5'),
  dusk: remap('1:0 2:v 3:2 4:3 5:4 6:8 7:8 8:9 9:a a:b b:v c:d d:e e:v f:g g:h h:a i:9 j:h l:m m:n n:2 o:p p:q q:v r:h s:o t:u u:2'),
  night: remap('1:0 2:1 3:2 4:3 5:3 6:4 7:3 8:2 9:v a:v b:1 c:u d:e e:v f:9 g:a h:b i:k j:k k:1 l:m m:n n:1 o:3 p:2 q:1 r:e s:4 t:u u:2 v:1'),
};
/** Low sun on the sunward faces: warm amber at dusk (west faces), peach-pink at dawn (top / east edges). */
export const RIM_RAMP: Partial<Record<Tod, Ramp>> = {
  dusk: ramp('q:h p:g o:f v:a 1:b 2:e 3:d 4:c 5:7 a:g b:h 9:g 8:f 7:f k:a j:9 i:f n:e m:d 6:7 u:d t:c e:d'),
  dawn: ramp('q:p p:8 o:c v:q 1:v 2:3 3:4 4:c 5:c a:9 b:a 9:8 8:c 7:c k:j j:8 n:m m:4 h:g e:d u:t'),
};
/** Inside a lamp pool at night: the lit pixels are simply BRIGHTER (day colours, whites warmed to cream), not tinted. */
export const LAMP_RAMP = remap('6:7 s:7 5:7 q:p v:q 1:2');
/** Falloff ring of a lamp pool: halfway between lamplight and moonlight, same hue families. */
export const LAMP_EDGE = remap('6:5 7:8 8:9 9:a a:b b:v c:d d:e e:v f:g g:h h:a i:j j:k l:m m:n n:2 o:p p:q q:q v:v r:e s:5 t:u u:2 1:1 2:2');
/** Interiors: the lights are on, so the room dims and warms instead of going black (pendant pools stay at day colours). */
export const INDOOR_RAMP: Record<Tod, Ramp> = {
  day: ID,
  // early: the room is a touch dimmer and cool; the peach comes from the low sunbeams through the windows
  dawn: remap('6:7 7:8 8:9 9:a a:b o:4 p:3 q:2 5:4 s:5 f:c g:c'),
  // golden hour: woods one step deeper and warm, greys into plum; amber beams and the first pools read on top
  dusk: remap('6:8 7:8 8:9 9:a a:b b:v o:p p:q q:v 5:4 4:3 3:2 2:v 1:0 s:o f:g g:h c:d d:e'),
  // closing time: dim plum-navy room, only the pendant pools stay warm
  night: remap('6:4 7:3 8:a 9:b a:v b:1 o:3 p:2 q:1 5:3 4:2 3:2 2:1 1:0 v:1 s:4 f:9 g:a h:b c:u d:e e:v k:1 j:k i:k n:2 m:n'),
};
/** Falloff ring of an indoor pendant pool (between the lit room and the dim one). */
export const INDOOR_EDGE: Partial<Record<Tod, Ramp>> = {
  dusk: remap('6:7 7:8 8:9 9:a a:a b:b o:p p:q q:v'),
  night: remap('6:7 7:8 8:9 9:a a:b b:v o:p p:q q:v 5:4 4:3 3:2 2:v'),
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
  finish(todRamp: Ramp, pools: boolean, poolRamp: Ramp = LAMP_RAMP, rimRamp: Ramp | null = null, edgeRamp: Ramp = LAMP_EDGE) {
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
      // a lamp pool centred on its source: solid lit core, then an ordered falloff in rings
      // (core/edge 50% -> solid edge -> edge/dark 50% -> 25%), so it reads as light, not a stain
      mask = mask ?? new Uint8Array(w * h);
      for (const p of this.pools) {
        let R = Math.max(6, Math.round(p.r * this.poolScale));
        // a pool whose source lives in this segment only must not be cut by the segment edge: it shrinks to fit instead
        if (!p.spill) R = Math.min(R, Math.floor(Math.min(p.y, h - 1 - p.y) * 1.15));
        if (R < 5) continue;
        for (let y = Math.max(0, p.y - R); y < Math.min(h, p.y + R + 1); y++) for (let x = Math.max(0, p.x - R); x < Math.min(w, p.x + R + 1); x++) {
          if (p.clip && (x < p.clip[0] || y < p.clip[1] || x >= p.clip[0] + p.clip[2] || y >= p.clip[1] + p.clip[3])) continue;
          const d = Math.hypot(x + 0.5 - (p.x + 0.5), (y + 0.5 - (p.y + 0.5)) * 1.15) / R; if (d > 1) continue;
          const o = y * w + x; const b = bayer(x, y);
          const v = d <= 0.42 ? 1 : d <= 0.56 ? (b < 8 ? 1 : 4) : d <= 0.72 ? 4 : d <= 0.86 ? (b < 8 ? 4 : 0) : (b < 4 ? 4 : 0);
          if (v === 1 || (v === 4 && mask[o] !== 1)) mask[o] = v;
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
      const ramps: (Ramp | null)[] = [todRamp, poolRamp, this.sunRamp, rimRamp, edgeRamp];
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
