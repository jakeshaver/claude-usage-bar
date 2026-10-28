// Pixel-exact, palette-exact painting helpers for world backgrounds.
// Everything here draws with integer fillRects in fixed-palette colors only:
// no arcs, no strokes, no alpha blending. Lighting (shadows, time of day, lamp
// pools) is done by remapping palette indices per pixel on cached canvases.
import { PALETTE, KEY } from '../core/palette';
import type { Tod } from '../core/types';

export const RGB: [number, number, number][] = PALETTE.map(h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
const LUT = new Map<number, number>(RGB.map(([r, g, b], i) => [(r << 16) | (g << 8) | b, i]));

/** Build a 32-entry index ramp from a "from:to" map (keys missing map to themselves). */
function ramp(map: string): Uint8Array {
  const out = new Uint8Array(32); for (let i = 0; i < 32; i++) out[i] = i;
  for (const pair of map.trim().split(/\s+/).filter(Boolean)) { const [a, b] = pair.split(':'); out[KEY.indexOf(a)] = KEY.indexOf(b); }
  return out;
}
/** One step darker, same hue family (used for cast shadows). */
export const SHADE = ramp('1:0 2:1 3:2 4:3 5:4 6:5 7:8 8:9 9:a a:b b:v c:d d:e e:v f:g g:h h:a i:j j:k k:1 l:m m:n n:2 o:p p:q q:v r:h s:l t:u u:2 v:1');
/** Time-of-day palette ramps. Day is identity (backgrounds are authored muted). */
export const TOD_RAMP: Record<Tod, Uint8Array> = {
  day: ramp(''),
  // cool, pale morning: grays go blue, whites go cream, haze lifts the shadows
  dawn: ramp('5:c 6:7 7:8 o:5 p:3 q:2 v:1 f:7 i:j s:5 a:9 b:a'),
  // warm sunset: highlights orange/pink, mids magenta, darks plum
  dusk: ramp('2:v 3:u 4:t 5:c 6:c 7:8 8:9 9:h a:b b:v c:d d:e e:v f:g g:h h:e i:j j:k l:t m:u n:2 o:8 p:a q:v r:h s:c t:d u:e v:1'),
  // moonlit: ~2 steps darker and blue
  night: ramp('1:0 2:1 3:2 4:3 5:3 6:4 7:4 8:3 9:q a:v b:1 c:u d:e e:v f:a g:a h:b i:j j:k k:2 l:m m:n n:2 o:3 p:q q:2 r:e s:4 t:u u:2 v:1'),
};
/** Inside a lamp pool at night the scene is lit warm (sodium light): near-day values, shifted to amber. */
export const LAMP_RAMP = ramp('6:7 5:7 s:7 o:8 4:t 3:u p:9 q:a v:b 1:b 2:v n:m 0:v');
/** Interiors: lamps are on after dark, so the room only warms up instead of going dark. */
export const INDOOR_RAMP: Record<Tod, Uint8Array> = { day: ramp(''), dawn: ramp('5:c 6:7 o:5 p:3'), dusk: ramp('5:c 6:7 7:8 o:8 4:t 3:u s:c p:a'), night: ramp('5:c 6:7 7:8 o:8 4:t 3:u s:c p:a q:v 2:v') };
/** Space areas: time of day only nudges the palette. */
export const SPACE_RAMP: Record<Tod, Uint8Array> = { day: ramp(''), dawn: ramp('o:5'), dusk: ramp('o:8 5:t'), night: ramp('') };

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
  /** a light source: lamp pool at night */
  pool(x: number, y: number, r: number) { this.pools.push({ x, y, r }); }
  /** emissive rect: shows `day` normally, `lit` (unaffected by darkness) when the light is on */
  glow(day: string, lit: string, x: number, y: number, w: number, h: number, chance = 1, roll = 0) {
    const t = this.tod; const p = t === 'night' ? chance : t === 'dusk' ? chance * 0.7 : t === 'dawn' ? chance * 0.3 : 0;
    this.r(day, x, y, w, h);
    this.glows.push({ day, lit, x, y, w, h, on: roll < p });
  }
  /** Run the passes: shade shadows -> objects -> time-of-day remap (with lamp pools) -> emissives. */
  finish(todRamp: Uint8Array, pools: boolean, poolRamp: Uint8Array = LAMP_RAMP) {
    const { w, h } = this;
    if (this.shadow.some(v => v)) remap(this.ctx, w, h, i => (this.shadow[i] ? SHADE : null));
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
    const m = mask;
    if (!isIdentity(todRamp) || m) remap(this.ctx, w, h, i => (m && m[i] ? poolRamp : todRamp));
    for (const g of this.glows) if (g.on) this.r(g.lit, g.x, g.y, g.w, g.h);
    for (const [x, y, w, h] of this.lateBars) this.r('0', x, y, w, h);
  }
}

function isIdentity(r: Uint8Array) { for (let i = 0; i < 32; i++) if (r[i] !== i) return false; return true; }

/** Per-pixel palette remap over the canvas. pick(i) returns the ramp for pixel i (or null to keep). */
function remap(ctx: CanvasRenderingContext2D, w: number, h: number, pick: (i: number) => Uint8Array | null) {
  const img = ctx.getImageData(0, 0, w, h); const d = img.data;
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    if (d[p + 3] === 0) continue;
    const rm = pick(i); if (!rm) continue;
    const idx = LUT.get((d[p] << 16) | (d[p + 1] << 8) | d[p + 2]); if (idx === undefined) continue;
    const c = RGB[rm[idx]]; d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2];
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
