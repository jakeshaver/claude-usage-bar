// Pixel-exact drawing helpers: every shape is built from integer fillRect calls in palette colors,
// so nothing anti-aliases (no ctx.arc / strokes in the final look).
import { col } from '../core/palette';

type Ctx = CanvasRenderingContext2D;

/** Midpoint-circle offsets for radius r, cached. Each entry is [dx, dy] of one outline pixel. */
const ringCache = new Map<number, [number, number][]>();
function ringPts(r: number): [number, number][] {
  let pts = ringCache.get(r); if (pts) return pts;
  const set = new Set<string>(); pts = [];
  let x = r, y = 0, err = 1 - r;
  const add = (a: number, b: number) => { const k = a + ',' + b; if (!set.has(k)) { set.add(k); pts!.push([a, b]); } };
  while (x >= y) {
    for (const [a, b] of [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]]) add(a, b);
    y++;
    if (err < 0) err += 2 * y + 1; else { x--; err += 2 * (y - x) + 1; }
  }
  ringCache.set(r, pts); return pts;
}

/** 1px pixel ring. `dash` > 0 skips pixels in a rotating pattern (sparkly, reads as a halo). */
export function pxRing(ctx: Ctx, cx: number, cy: number, r: number, key: string, dash = 0, phase = 0) {
  const x0 = Math.round(cx), y0 = Math.round(cy); r = Math.max(1, Math.round(r));
  ctx.fillStyle = col(key);
  const pts = ringPts(r);
  for (let i = 0; i < pts.length; i++) {
    const [dx, dy] = pts[i];
    if (dash > 0) { const a = Math.atan2(dy, dx) + phase; if (Math.floor(((a / (Math.PI * 2)) + 2) * dash * 2) % 2) continue; }
    ctx.fillRect(x0 + dx, y0 + dy, 1, 1);
  }
}

/** Filled pixel disc, row by row. */
export function pxDisc(ctx: Ctx, cx: number, cy: number, r: number, key: string) {
  const x0 = Math.round(cx), y0 = Math.round(cy); r = Math.max(0, Math.round(r));
  ctx.fillStyle = col(key);
  for (let dy = -r; dy <= r; dy++) { const w = Math.floor(Math.sqrt(r * r - dy * dy + r * 0.8)); ctx.fillRect(x0 - w, y0 + dy, w * 2 + 1, 1); }
}

/** Checkerboard-dithered disc: a soft glow made of hard pixels. */
export function pxDither(ctx: Ctx, cx: number, cy: number, r: number, key: string, parity = 0) {
  const x0 = Math.round(cx), y0 = Math.round(cy); r = Math.round(r);
  ctx.fillStyle = col(key);
  for (let dy = -r; dy <= r; dy++) {
    const w = Math.floor(Math.sqrt(r * r - dy * dy));
    for (let dx = -w; dx <= w; dx++) if (((dx + dy + parity) & 1) === 0) ctx.fillRect(x0 + dx, y0 + dy, 1, 1);
  }
}

/** Flat oval drop shadow (rows of rects), drawn translucent in palette ink. */
export function pxShadow(ctx: Ctx, cx: number, cy: number, w: number, alpha = 0.3) {
  const x0 = Math.round(cx), y0 = Math.round(cy); const hw = Math.max(2, Math.round(w / 2));
  ctx.globalAlpha = alpha; ctx.fillStyle = col('0');
  ctx.fillRect(x0 - hw + 2, y0 - 1, hw * 2 - 4, 1);
  ctx.fillRect(x0 - hw, y0, hw * 2, 2);
  ctx.fillRect(x0 - hw + 2, y0 + 2, hw * 2 - 4, 1);
  ctx.globalAlpha = 1;
}

/** Dashed pixel line (Bresenham), used for attack telegraphs. on/off in pixels; offset animates the dashes. */
export function pxDash(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, key: string, on = 3, off = 3, offset = 0, thick = 1) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, i = 0; ctx.fillStyle = col(key);
  for (let n = 0; n < 2000; n++) {
    if ((((i + offset) % (on + off)) + (on + off)) % (on + off) < on) ctx.fillRect(x0 - (thick >> 1), y0 - (thick >> 1), thick, thick);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } i++;
  }
}

/** Little 4-point sparkle (plus shape), size 1 or 2. */
export function pxSpark(ctx: Ctx, cx: number, cy: number, key: string, size = 1) {
  const x = Math.round(cx), y = Math.round(cy); ctx.fillStyle = col(key);
  ctx.fillRect(x - size, y, size * 2 + 1, 1); ctx.fillRect(x, y - size, 1, size * 2 + 1);
}
