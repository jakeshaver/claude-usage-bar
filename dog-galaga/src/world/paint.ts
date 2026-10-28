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
/** Cast shadows per time of day: long cool blue at dawn, long plum/violet at dusk (the only place dusk keeps purple). */
export const SHADE_TOD: Record<Tod, Ramp> = {
  day: SHADE,
  night: SHADE,
  dawn: ramp('k:n j:k q:2 p:3 o:4 7:5 8:4 9:3 a:2 b:1 h:a v:1 i:m', SHADE),
  dusk: ramp('k:v j:k q:v p:u2/8 o:u 8:e 9:e a:v b:v h:e g:h 4:u 3:2 2:v n:v m:u 1:0', SHADE),
};
/**
 * Time-of-day palette ramps: lighting is told apart by colour temperature, not just darkness.
 * Day is identity (backgrounds are authored in muted day colours).
 */
export const TOD_RAMP: Record<Tod, Ramp> = {
  day: ramp(''),
  // cool, pale pink-peach lift: darks lift toward periwinkle, highlights catch peach and pink
  dawn: ramp('1:21/8 v:2v/8 2:23/6 q:2q/8 p:3p/10 o:oc/6 3:34/6 4:54/8 5:c5/8 6:7 7:c7/8 8:8c/6 9:89/6 a:a9/6 b:ba/6 k:kn/5 j:jm/5 i:jm/4 n:n3/4 m:m4/6 l:s e:ed/6 h:hg/6 g:gc/6 f:7f/8'),
  // sunset: mids and highs go amber / rust / rose, purple stays only in the darkest tones
  dusk: ramp('1:v 2:v 3:eu/8 4:ct/8 5:c 6:7 7:f8/8 8:g8/8 9:h9/6 a:ah/6 b:b f:gf/8 i:9f/8 j:ja/6 k:kb/4 l:t m:eu/8 n:ve/4 o:9 p:ae/4 q:b s:c t:ct/8 u:eu/8'),
  // moonlit: blue and ~2 steps darker, greens stay blue-green (dithered toward deep night)
  night: ramp('1:1 2:1 3:2 4:3 5:4 6:5 7:5 8:p 9:a a:b b:v c:t d:e e:v f:8 g:h h:a i:j j:k k:k1/8 l:m m:n n:2 o:p p:q q:v r:e s:4 t:u u:2 v:1'),
};
/** Low sun on the sunward faces: warm amber at dusk (west faces), pale pink-gold at dawn (east faces). */
export const RIM_RAMP: Partial<Record<Tod, Ramp>> = {
  dusk: ramp('q:h p:g o:f v:a 1:b 2:e 3:d 4:c 5:7 a:g b:h 9:g 8:f 7:f k:a j:9 i:f n:e m:d 6:7 u:d t:c e:d'),
  dawn: ramp('q:3 p:4 o:c v:2 1:v 2:3 3:4 4:5 a:9 b:a 9:8 8:7 k:j j:i n:m m:4 h:g'),
};
/** Inside a lamp pool at night: neutral-cool lift (about day values) so brown turds still read against the floor. */
export const LAMP_RAMP = ramp('0:1 1:2 v:q 2:3 q:p p:o 3:4 n:m b:a a:9 4:5 o:5 e:d u:t');
/** Interiors: lamps are on after dark, so the room only warms up instead of going dark. */
export const INDOOR_RAMP: Record<Tod, Ramp> = {
  day: ramp(''),
  dawn: ramp('0:1 1:v 5:c 6:7 7:c o:8 n:3 m:4 4:t'),
  dusk: ramp('5:c 6:7 7:8 o:8 4:t 3:u s:c p:ae/8 q:va/8 n:e 9:h9/8 a:ab/4'),
  night: ramp('5:4 6:5 7:8 o:p 4:3 3:2 s:4 p:q q:v 2:1 9:a a:b b:v 8:9 n:2 m:n e:v u:2 c:d'),
};
/** Sunbeams through windows (interiors by day/dawn): warm lift. */
export const SUN_RAMP = ramp('0:1 1:v v:b b:a a:9 9:8 8:7 q:p p:o 2:3 3:4 e:d u:t n:m k:j');
/** Low dusk sun through the windows: deep amber / rust beams. */
export const DUSK_SUN = ramp('0:b 1:b v:a b:h a:h 9:g 8:f q:a p:9 o:8 2:e 3:d e:d u:d n:e k:a');
/** Space: day = sunlit hull, night = eclipse (highlights drop, running lights on). */
export const SPACE_RAMP: Record<Tod, Ramp> = {
  day: ramp(''),
  dawn: ramp('o:8 5:c 4:t 6:7'),
  dusk: ramp('o:g 5:c 4:t 6:f 3:u'),
  night: ramp('o:p 5:4 6:5 4:3 3:2 8:9 7:8'),
};

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const bayer = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];

/** palette key char code -> palette index */
const KI = new Uint8Array(128); for (let i = 0; i < 32; i++) KI[KEY.charCodeAt(i)] = i;
const ci = (k: string) => KI[k.charCodeAt(0)];
const CLEAR = 255;

export interface Pool { x: number; y: number; r: number }

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
    const [ax, ay] = t === 'dawn' ? [-1.25, 0.3] : t === 'dusk' ? [1.25, 0.3] : t === 'night' ? [0.25, 0.3] : [0.45, 0.55];
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
    else if (this.tod === 'dawn') this.rims.push(x + w - 3, y, 2);
  }
  /** rectangular object footprint of given height casts a swept shadow (and catches a rim of low sun) */
  shRect(x: number, y: number, w: number, h: number, height: number) {
    const [dx, dy] = this.cast(height); const n = Math.max(Math.abs(dx), Math.abs(dy), 1);
    for (let i = 0; i <= n; i++) this.sm(x + Math.round(dx * i / n), y + Math.round(dy * i / n), w, h);
    if (height >= 5) for (let j = 1; j < h - 1; j++) this.rimRow(x, y + j, w);
  }
  shEll(cx: number, cy: number, rx: number, ry: number, height: number) {
    const [dx, dy] = this.cast(height); const n = Math.max(Math.abs(dx), Math.abs(dy), 1);
    for (let i = 0; i <= n; i += Math.max(1, (n / 6) | 0)) spans(cx + Math.round(dx * i / n), cy + Math.round(dy * i / n), rx, ry, (x, y, w) => this.sm(x, y, w, 1));
    spans(cx + dx, cy + dy, rx, ry, (x, y, w) => this.sm(x, y, w, 1));
    if (height >= 5) spans(cx, cy, rx, ry, (x, y, w) => this.rimRow(x, y, w));
  }
  /** draw this after the ground shadows are applied */
  obj(fn: () => void) { this.objs.push(fn); }
  /** a sunbeam: parallelogram lit with SUN_RAMP (only shown when the caller decides it is daytime) */
  beam(x: number, y: number, w: number, h: number, skew: number) { this.beams.push({ x, y, w, h, skew }); }
  /** a light source: lamp pool at night */
  pool(x: number, y: number, r: number) { this.pools.push({ x, y, r }); }
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
    // light mask: 1 lamp pool, 2 sunbeam, 3 rim
    let mask: Uint8Array | null = null;
    if (rimRamp && this.rims.length) {
      mask = new Uint8Array(w * h); const R = this.rims;
      for (let k = 0; k < R.length; k += 3) { const x = R[k], y = R[k + 1]; if (y < 0 || y >= h) continue; for (let i = Math.max(0, x); i < Math.min(w, x + R[k + 2]); i++) mask[y * w + i] = 3; }
    }
    if (pools && this.pools.length) {
      mask = mask ?? new Uint8Array(w * h);
      for (const p of this.pools) {
        const rin = p.r * 0.62;
        for (let y = Math.max(0, p.y - p.r); y < Math.min(h, p.y + p.r + 1); y++) for (let x = Math.max(0, p.x - p.r); x < Math.min(w, p.x + p.r + 1); x++) {
          const d = Math.hypot((x - p.x), (y - p.y) * 1.15); if (d > p.r) continue;
          if (d <= rin || bayer(x, y) < ((p.r - d) / (p.r - rin)) * 16) mask[y * w + x] = 1;
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
      const ramps: (Ramp | null)[] = [todRamp, poolRamp, this.sunRamp, rimRamp];
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
