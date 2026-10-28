// Pixel-exact, palette-exact painting helpers for world backgrounds.
// Everything here draws with integer fillRects in fixed-palette colors only:
// no arcs, no strokes, no alpha blending. Lighting (shadows, time of day, lamp
// pools) is done by remapping palette indices per pixel on cached canvases.
import { PALETTE, KEY } from '../core/palette';
import type { Tod } from '../core/types';

export const RGB: [number, number, number][] = PALETTE.map(h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
const LUT = new Map<number, number>(RGB.map(([r, g, b], i) => [(r << 16) | (g << 8) | b, i]));

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
/** Cast shadows per time of day: cool blue at dawn, long magenta at dusk. */
export const SHADE_TOD: Record<Tod, Ramp> = {
  day: SHADE,
  night: SHADE,
  dawn: ramp('k:n j:k q:2 p:3 o:4 7:5 8:4 9:3 a:2 b:1 h:a', SHADE),
  dusk: ramp('k:v j:k q:v p:e o:e 8:e 9:e a:e b:v h:e g:h 4:u 3:u 2:v n:v m:u', SHADE),
};
/** Time-of-day palette ramps. Day is identity (backgrounds are authored muted). */
export const TOD_RAMP: Record<Tod, Ramp> = {
  day: ramp(''),
  // cool lifted haze in the darks, warm pink/gold key on every highlight
  dawn: ramp('0:1 1:v 4:t 5:c 6:7 7:c 8:c i:f j:i l:s m:4 n:3 o:8 s:c t:c u:t'),
  // sunset: faces stay bright and turn orange, mids go warm, darks go plum
  dusk: ramp('0:0 1:1 2:v 3:u 4:t 5:c 6:7 7:8 c:c f:g i:f l:c m:t n:2 o:g s:c u:e j:9'),
  // moonlit: ~2 steps darker and blue, greens stay blue-green (dithered toward deep night)
  night: ramp('1:1 2:1 3:2 4:3 5:4 6:5 7:5 8:p 9:a a:b b:v c:t d:e e:v f:8 g:h h:a i:j j:k k:k1/8 l:m m:n n:2 o:p p:q q:v r:e s:4 t:u u:2 v:1'),
};
/** Inside a lamp pool at night: neutral-cool lift (about day values) so brown turds still read against the floor. */
export const LAMP_RAMP = ramp('0:1 1:2 v:q 2:3 q:p p:o 3:4 n:m b:a a:9 4:5 o:5 e:d u:t');
/** Interiors: lamps are on after dark, so the room only warms up instead of going dark. */
export const INDOOR_RAMP: Record<Tod, Ramp> = {
  day: ramp(''),
  dawn: ramp('0:1 1:v 5:c 6:7 7:c o:8 n:3 m:4 4:t'),
  dusk: ramp('5:c 6:7 7:8 o:8 4:t 3:u s:c p:a n:e'),
  night: ramp('5:4 6:5 7:8 o:p 4:3 3:2 s:4 p:q q:v 2:1 9:a a:b b:v 8:9 n:2 m:n e:v u:2 c:d'),
};
/** Sunbeams through windows (interiors by day/dawn): warm lift. */
export const SUN_RAMP = ramp('0:1 1:v v:b b:a a:9 9:8 8:7 q:p p:o 2:3 3:4 e:d u:t n:m k:j');
/** Space: day = sunlit hull, night = eclipse (highlights drop, running lights on). */
export const SPACE_RAMP: Record<Tod, Ramp> = {
  day: ramp(''),
  dawn: ramp('o:8 5:c 4:t 6:7'),
  dusk: ramp('o:g 5:c 4:t 6:f 3:u'),
  night: ramp('o:p 5:4 6:5 4:3 3:2 8:9 7:8'),
};

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const bayer = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];

const HEX = PALETTE;
const ci = (k: string) => KEY.indexOf(k);

export interface Pool { x: number; y: number; r: number }

/** Painter over one canvas, with integer primitives and a deferred shadow/light model. */
export class Painter {
  ctx: CanvasRenderingContext2D;
  shadow: Uint8Array;
  pools: Pool[] = [];
  /** skewed sunbeam parallelograms (interiors at dawn/day) */
  beams: { x: number; y: number; w: number; h: number; skew: number }[] = [];
  glows: { day: string; lit: string; x: number; y: number; w: number; h: number; on: boolean }[] = [];
  objs: (() => void)[] = [];
  /** dark frame bars drawn over emissives (window mullions) */
  lateBars: [number, number, number, number][] = [];
  constructor(public canvas: HTMLCanvasElement, public w: number, public h: number, public tod: Tod) {
    this.ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    this.ctx.imageSmoothingEnabled = false;
    this.shadow = new Uint8Array(w * h);
  }
  /** filled rect in palette key k */
  r(k: string, x: number, y: number, w = 1, h = 1) { if (w <= 0 || h <= 0) return; this.ctx.fillStyle = HEX[ci(k)]; this.ctx.fillRect(x | 0, y | 0, w | 0, h | 0); }
  /** 1px rectangular outline */
  frame(k: string, x: number, y: number, w: number, h: number) { this.r(k, x, y, w, 1); this.r(k, x, y + h - 1, w, 1); this.r(k, x, y, 1, h); this.r(k, x + w - 1, y, 1, h); }
  /** pixel-exact filled ellipse centred on (cx,cy) (half-pixel centres allowed via .5) */
  ell(k: string, cx: number, cy: number, rx: number, ry: number) {
    spans(cx, cy, rx, ry, (x, y, w) => this.r(k, x, y, w, 1));
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
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy;
    for (;;) { this.r(k, x0, y0); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
  }
  /** ordered-dither fill: level 0..16 of key k over the rect */
  dith(k: string, x: number, y: number, w: number, h: number, level: number) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (bayer(x + i, y + j) < level) this.r(k, x + i, y + j);
  }
  /** checkerboard dither (cheap 50%) */
  checker(k: string, x: number, y: number, w: number, h: number, phase = 0) {
    for (let j = 0; j < h; j++) for (let i = (j + phase + x + y) & 1; i < w; i += 2) this.r(k, x + i, y + j);
  }

  /** direct pixel writes (for dense procedural fills); keys index the palette */
  pixels(fn: (set: (k: string, x: number, y: number) => void) => void) {
    const img = this.ctx.getImageData(0, 0, this.w, this.h); const d = img.data; const w = this.w, h = this.h;
    fn((k, x, y) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const c = RGB[ci(k)]; const o = (y * w + x) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255; });
    this.ctx.putImageData(img, 0, 0);
  }

  // ---- lighting model ----
  /** Shadow offset per unit of object height for the current time of day. */
  cast(height: number): [number, number] {
    const t = this.tod;
    const [ax, ay] = t === 'dawn' ? [-1.1, 0.35] : t === 'dusk' ? [1.1, 0.35] : t === 'night' ? [0.25, 0.3] : [0.45, 0.55];
    return [Math.round(ax * height), Math.round(ay * height)];
  }
  private sm(x: number, y: number, w: number, h: number) {
    const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0), x1 = Math.min(this.w, (x + w) | 0), y1 = Math.min(this.h, (y + h) | 0);
    for (let j = y0; j < y1; j++) this.shadow.fill(1, j * this.w + x0, j * this.w + Math.max(x0, x1));
  }
  /** rectangular object footprint of given height casts a swept shadow */
  shRect(x: number, y: number, w: number, h: number, height: number) {
    const [dx, dy] = this.cast(height); const n = Math.max(Math.abs(dx), Math.abs(dy), 1);
    for (let i = 0; i <= n; i++) this.sm(x + Math.round(dx * i / n), y + Math.round(dy * i / n), w, h);
  }
  shEll(cx: number, cy: number, rx: number, ry: number, height: number) {
    const [dx, dy] = this.cast(height); const n = Math.max(Math.abs(dx), Math.abs(dy), 1);
    for (let i = 0; i <= n; i += Math.max(1, (n / 6) | 0)) spans(cx + Math.round(dx * i / n), cy + Math.round(dy * i / n), rx, ry, (x, y, w) => this.sm(x, y, w, 1));
    spans(cx + dx, cy + dy, rx, ry, (x, y, w) => this.sm(x, y, w, 1));
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
    this.glows.push({ day, lit, x, y, w, h, on: roll < p });
  }
  /** Run the passes: shade shadows -> objects -> time-of-day remap (with lamp pools) -> emissives. */
  finish(todRamp: Ramp, pools: boolean, poolRamp: Ramp = LAMP_RAMP) {
    const { w, h } = this;
    if (this.shadow.some(v => v)) { const sh = SHADE_TOD[this.tod]; remap(this.ctx, w, h, i => (this.shadow[i] ? sh : null), this.shadow); }
    for (const f of this.objs) f();
    let mask: Uint8Array | null = null;
    if (pools && this.pools.length) {
      mask = new Uint8Array(w * h);
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
        for (let x = Math.max(0, x0); x < Math.min(w, x0 + b.w); x++) { const e = Math.min(x - x0, x0 + b.w - 1 - x, y - b.y, b.y + b.h - 1 - y); if (e >= 3 || bayer(x, y) < (e + 1) * 4) mask[y * w + x] = mask[y * w + x] || 2; }
      }
    }
    const m = mask;
    if (!todRamp.id || m) remap(this.ctx, w, h, i => (m && m[i] ? (m[i] === 2 ? SUN_RAMP : poolRamp) : todRamp));
    for (const g of this.glows) if (g.on) this.r(g.lit, g.x, g.y, g.w, g.h);
    for (const [x, y, w, h] of this.lateBars) this.r('0', x, y, w, h);
  }
}

/**
 * Per-pixel palette remap over the canvas. pick(i) returns the ramp for pixel i (or null to keep).
 * With `shadowOnClear`, shadowed transparent pixels (e.g. over a parallax water layer) become a 50% deep-night dither.
 */
function remap(ctx: CanvasRenderingContext2D, w: number, h: number, pick: (i: number) => Ramp | null, shadowOnClear?: Uint8Array) {
  const img = ctx.getImageData(0, 0, w, h); const d = img.data;
  const sh = RGB[1];
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const x = i % w, y = (i / w) | 0;
    if (d[p + 3] === 0) {
      if (shadowOnClear && shadowOnClear[i] && ((x + y) & 1)) { d[p] = sh[0]; d[p + 1] = sh[1]; d[p + 2] = sh[2]; d[p + 3] = 255; }
      continue;
    }
    const rm = pick(i); if (!rm) continue;
    const idx = LUT.get((d[p] << 16) | (d[p + 1] << 8) | d[p + 2]); if (idx === undefined) continue;
    const c = RGB[rm.lv[idx] > BAYER[(y & 3) * 4 + (x & 3)] ? rm.b[idx] : rm.a[idx]]; d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2];
  }
  ctx.putImageData(img, 0, 0);
}

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
