// Pixel-exact drawing helpers private to the player module: every shape is integer fillRects in palette colours.
import { col } from '../core/palette';
import { drawSprite } from '../art/sprite';
import { pxRing } from '../core/pixel';

type Ctx = CanvasRenderingContext2D;

/** Drop shadow: a solid oval core drawn as one fillRect per row, with a single 1px checker-dithered pixel at the
 *  left and right extremes of the middle rows only (never on the top and bottom rows, so the rim never reads as
 *  a comb). `soft` = night: the whole oval is a 50% checker (faint, small). */
export function shadowOval(ctx: Ctx, cx: number, cy: number, w: number, h = 4, key = 'v', soft = false) {
  const x0 = Math.round(cx), y0 = Math.round(cy); const rx = Math.max(2, w / 2), ry = Math.max(1, h / 2);
  const top = -Math.floor(ry), bot = Math.floor(ry);
  ctx.fillStyle = col(key);
  for (let dy = top; dy <= bot; dy++) {
    const rw = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / ((ry + 0.5) * (ry + 0.5)))));
    const Y = y0 + dy;
    if (soft) { for (let dx = -rw + ((x0 - rw + Y) & 1); dx <= rw; dx += 2) ctx.fillRect(x0 + dx, Y, 1, 1); continue; }
    const edge = dy !== top && dy !== bot;
    ctx.fillRect(x0 - rw + (edge ? 1 : 0), Y, rw * 2 + 1 - (edge ? 2 : 0), 1);
    if (edge) {
      if (((x0 - rw + Y) & 1) === 0) ctx.fillRect(x0 - rw, Y, 1, 1);
      if (((x0 + rw + Y) & 1) === 0) ctx.fillRect(x0 + rw, Y, 1, 1);
    }
  }
}

/** Shadow ink for the ground under Pom: the plum shadow, or pure ink where the ground is already dark
 *  (asphalt, water, the moon at night) and plum would vanish. */
export function shadowInk(area: string, tod: string): string {
  const dark = ['street', 'alley', 'docks', 'factory', 'moon', 'station', 'mothership'].includes(area);
  return dark || tod === 'night' ? '0' : 'v';
}
/** Horizontal shadow offset by time of day: the world's light casts dawn shadows down-left, day a little to
 *  the right, dusk long to the east, night nearly underneath. */
export function shadowDX(tod: string, scale = 1): number {
  return Math.round((tod === 'dawn' ? -6 : tod === 'dusk' ? 9 : tod === 'night' ? 2 : 4) * scale);
}

/** Jet flame below a nozzle: white core, yellow body, orange then burnt tip; tapers to a point.
 *  x = left edge, y = first row, w = nozzle width, len = rows. */
export function flame(ctx: Ctx, x: number, y: number, w: number, len: number, tick = 0) {
  x = Math.round(x); y = Math.round(y); len = Math.max(2, Math.round(len));
  const wide = ((tick >> 1) & 1) === 1;      // the tip flickers between two widths
  for (let j = 0; j < len; j++) {
    const k = j / len;
    const inset = j === len - 1 ? Math.max(0, Math.floor((w - 1) / 2) - (wide ? 1 : 0)) : k < 0.6 || w <= 2 || wide ? 0 : 1;
    const ww = Math.max(1, w - inset * 2);
    ctx.fillStyle = col(k < 0.5 ? 'f' : k < 0.8 ? 'g' : 'h'); ctx.fillRect(x + inset, y + j, ww, 1);
    if (k < 0.35 && w > 2) { ctx.fillStyle = col('6'); ctx.fillRect(x + 1, y + j, w - 2, 1); }
    else if (k < 0.2) { ctx.fillStyle = col('6'); ctx.fillRect(x + (w >> 1), y + j, 1, 1); }
  }
}

/** Continuous exhaust ribbon through screen points (pts[0] = flame tip). Each segment is a Bresenham run, so
 *  lateral motion leaves an unbroken diagonal; w px wide for the first 60%, then 1px, fading
 *  yellow > orange > burnt; the last two points are flickering 1px sparkles instead of a dash. */
export function ribbon(ctx: Ctx, pts: [number, number][], w: number, tick: number) {
  const n = pts.length; if (n < 2) return;
  for (let i = 1; i < n; i++) {
    const k = i / n;
    if (i >= n - 2 && n > 3) {
      if (((tick + i) & 1) === 0) { ctx.fillStyle = col(i === n - 1 ? 'h' : 'g'); ctx.fillRect(Math.round(pts[i][0]), Math.round(pts[i][1]), 1, 1); }
      continue;
    }
    ctx.fillStyle = col(k < 0.3 ? 'f' : k < 0.55 ? 'g' : 'h');
    const ww = k < 0.6 ? w : 1;
    let x0 = Math.round(pts[i - 1][0]), y0 = Math.round(pts[i - 1][1]);
    const x1 = Math.round(pts[i][0]), y1 = Math.round(pts[i][1]);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let s = 0; s < 64; s++) {
      ctx.fillRect(x0 - (ww >> 1), y0, ww, 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
}

/** The captain's scarf tail along a polyline (pts[0] = the knot): a 2px red ribbon with a 1px ink edge, lit on
 *  the left, darker on the right, ending in a notched two-point tip. Points are walked 1px at a time so a bent
 *  or diagonal tail stays unbroken. */
export function scarfTail(ctx: Ctx, pts: [number, number][]) {
  const cells: [number, number][] = [];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay))));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const X = Math.round(ax + (bx - ax) * k / n), Y = Math.round(ay + (by - ay) * k / n);
      const l = cells[cells.length - 1]; if (!l || l[0] !== X || l[1] !== Y) cells.push([X, Y]);
    }
  }
  const m = cells.length; if (!m) return;
  ctx.fillStyle = col('0');
  for (let i = 0; i < m; i++) { const [X, Y] = cells[i]; if (i < m - 2) ctx.fillRect(X - 1, Y - 1, 4, 4); else ctx.fillRect(X - 1, Y - 1, 3, 3); }
  for (let i = 0; i < m; i++) {
    const [X, Y] = cells[i];
    if (i >= m - 2) { ctx.fillStyle = col(i === m - 1 ? 'e' : 'r'); ctx.fillRect(X, Y, 1, 1); continue; }
    ctx.fillStyle = col('r'); ctx.fillRect(X, Y, 2, 2);
    ctx.fillStyle = col(i < 3 ? 'c' : 'r'); ctx.fillRect(X, Y, 1, 1);
    ctx.fillStyle = col('e'); ctx.fillRect(X + 1, Y + 1, 1, 1);
  }
}

/** Shield bubble from core/pixel.ts pxRing: a 2px rim (dark teal outside, ice inside), a dithered inner rim on
 *  the lower half, and 3 bright highlight pixels orbiting slowly. */
export function shieldRing(ctx: Ctx, cx: number, cy: number, r: number, t: number) {
  pxRing(ctx, cx, cy, r + 1, 'n');
  pxRing(ctx, cx, cy, r, 'm');
  pxRing(ctx, cx, cy, r - 1, 's', 6, t / 40);
  pxRing(ctx, cx, cy, r - 2, 'l', 10, -t / 30);
  for (let i = 0; i < 3; i++) {
    const a = t / 28 + i * 2.09;
    ctx.fillStyle = col(i ? 's' : '6');
    ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 1, 1);
  }
  // fixed upper-left glint
  ctx.fillStyle = col('6');
  const g = Math.round(r * 0.6);
  ctx.fillRect(Math.round(cx) - g - 1, Math.round(cy) - g, 2, 1); ctx.fillRect(Math.round(cx) - g, Math.round(cy) - g - 1, 1, 1);
}

/** Toot puff at the shot spawn point: frame 0 a tight 3px tan puff, frame 1 a 5px broken brown ring. */
export function tootPuff(ctx: Ctx, x: number, y: number, f: number) {
  x = Math.round(x); y = Math.round(y);
  if (f === 0) {
    ctx.fillStyle = col('0'); ctx.fillRect(x - 2, y - 1, 5, 3); ctx.fillRect(x - 1, y - 2, 3, 5);
    ctx.fillStyle = col('9'); ctx.fillRect(x - 1, y - 1, 3, 3);
    ctx.fillStyle = col('8'); ctx.fillRect(x - 1, y - 1, 2, 1); ctx.fillRect(x - 1, y, 1, 1);
  } else {
    const pts: [number, number, string][] = [[-2, -2, '9'], [0, -3, '8'], [2, -2, '9'], [3, 0, 'a'], [2, 2, 'a'], [0, 3, '9'], [-2, 2, 'a'], [-3, 0, '9']];
    for (const [dx, dy, k] of pts) { ctx.fillStyle = col(k); ctx.fillRect(x + dx, y + dy, 1, 1); }
  }
}

/** Small pixel "Z" (3..6px), soft lavender with a 1px 4-neighbour ink outline: light enough to sit above the sprite. */
export function zGlyph(ctx: Ctx, x: number, y: number, n: number, key: string) {
  x = Math.round(x); y = Math.round(y); n = Math.max(3, Math.min(6, Math.round(n)));
  const cells: [number, number][] = [];
  for (let i = 0; i < n; i++) { cells.push([i, 0]); cells.push([i, n - 1]); }
  for (let i = 1; i < n - 1; i++) cells.push([n - 1 - i, i]);
  ctx.fillStyle = col('0');
  for (const [a, b] of cells) { ctx.fillRect(x + a - 1, y + b, 3, 1); ctx.fillRect(x + a, y + b - 1, 1, 3); }
  ctx.fillStyle = col(key);
  for (const [a, b] of cells) ctx.fillRect(x + a, y + b, 1, 1);
}

/** Tiny hitbox marker: a 2x2 bright core inside a rounded ink frame. */
export function hitDot(ctx: Ctx, x: number, y: number, key: string) {
  x = Math.round(x); y = Math.round(y);
  ctx.fillStyle = col('0');
  ctx.fillRect(x - 1, y - 2, 2, 1); ctx.fillRect(x - 1, y + 1, 2, 1); ctx.fillRect(x - 2, y - 1, 1, 2); ctx.fillRect(x + 1, y - 1, 1, 2);
  ctx.fillStyle = col(key); ctx.fillRect(x - 1, y - 1, 2, 2);
}

/** 1px dot / 4-point star used by the boost sparkles. */
export function dot(ctx: Ctx, x: number, y: number, key: string, star = false) {
  x = Math.round(x); y = Math.round(y); ctx.fillStyle = col(key);
  if (star) { ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3); } else ctx.fillRect(x, y, 1, 1);
}

/** The curled-up nap: whole-body breathing squash (3 frames on a slow sine), landing flop, rising Zzz. */
export function drawNapPose(ctx: Ctx, px: number, y0: number, k: number, ground: boolean, tod = 'day', ink = '0') {
  const s = Math.sin(k / 24);
  const breathe = s > 0.45 ? 2 : s > -0.45 ? 1 : 0;
  const squash = k < 6 ? 1 : 0;       // tiny flop on landing
  if (ground) shadowOval(ctx, px + shadowDX(tod, 0.6), y0 + 12, 30, 4, ink, tod === 'night');
  drawSprite(ctx, 'pom_nap', px, y0 + squash, { frame: breathe });
  // three small Zs rise from her snoot, staggered and swaying: they pop in at 3px and grow to 6px as they climb
  // (at most 30px above her head, so they stay inside a gallery cell)
  for (let i = 0; i < 3; i++) {
    const z = k - i * 24; if (z < 0) continue;
    const zt = z % 72, p = zt / 72;
    const n = zt < 3 ? 3 : 4 + Math.floor(p * 2.99);
    const zx = px + 4 + Math.round(Math.sin(p * 6.28 + i) * 2) + Math.round(p * 8);
    const zy = y0 - 6 - Math.round(p * 24) - n;
    if (p < 0.88) zGlyph(ctx, zx, zy, n, p < 0.6 ? '5' : '4');
  }
}
