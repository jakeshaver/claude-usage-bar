// Pixel-exact drawing helpers private to the player module: every shape is integer fillRects in palette colours.
import { col, PALETTE, KEY } from '../core/palette';
import { spriteRows } from '../art/sprite';

type Ctx = CanvasRenderingContext2D;

/** Sparse ink oval drop shadow: 50% checker in the core, 25% at the rim, no translucency. */
export function shadowOval(ctx: Ctx, cx: number, cy: number, w: number, h = 4) {
  const x0 = Math.round(cx), y0 = Math.round(cy); const rx = Math.max(2, w / 2), ry = Math.max(1, h / 2);
  ctx.fillStyle = col('0');
  for (let dy = -Math.floor(ry); dy <= Math.floor(ry); dy++) {
    const rw = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / ((ry + 0.5) * (ry + 0.5)))));
    for (let dx = -rw; dx <= rw; dx++) {
      const X = x0 + dx, Y = y0 + dy, rim = Math.abs(dx) > rw - 2;
      if (((X + Y) & 1) !== 0) continue;
      if (rim && (X & 2)) continue;          // thinner at the ends: reads soft without alpha
      ctx.fillRect(X, Y, 1, 1);
    }
  }
}

/** Invulnerability ghost: the full ink outline stays, the interior fill is a fixed-parity 50% checker
 *  (anchored to the sprite, so it never crawls as she moves). */
const ghostCache = new Map<string, HTMLCanvasElement>();
export function ghostSprite(ctx: Ctx, name: string, frame: number, cx: number, cy: number) {
  const key = name + '|' + frame;
  let c = ghostCache.get(key);
  if (!c) {
    const rows = spriteRows(name, frame); if (!rows) return;
    const h = rows.length, w = Math.max(...rows.map(r => r.length));
    c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d')!;
    rows.forEach((r, y) => [...r].forEach((ch, i) => {
      if (ch === '.' || ch === ' ') return;
      if (ch !== '0' && ((i + y) & 1)) return;
      const pi = KEY.indexOf(ch); if (pi < 0) return;
      x.fillStyle = PALETTE[pi]; x.fillRect(i, y, 1, 1);
    }));
    ghostCache.set(key, c);
  }
  ctx.drawImage(c, Math.round(cx - c.width / 2), Math.round(cy - c.height / 2));
}

/** Jet flame below a nozzle: white core, yellow body, orange then burnt tip; tapers to a point.
 *  x = left edge, y = first row, w = nozzle width, len = rows. */
export function flame(ctx: Ctx, x: number, y: number, w: number, len: number) {
  x = Math.round(x); y = Math.round(y); len = Math.max(2, Math.round(len));
  for (let j = 0; j < len; j++) {
    const k = j / len;
    const inset = j === len - 1 ? Math.max(0, Math.floor((w - 1) / 2)) : k < 0.6 || w <= 2 ? 0 : 1;
    const ww = Math.max(1, w - inset * 2);
    ctx.fillStyle = col(k < 0.5 ? 'f' : k < 0.8 ? 'g' : 'h'); ctx.fillRect(x + inset, y + j, ww, 1);
    if (k < 0.35 && w > 2) { ctx.fillStyle = col('6'); ctx.fillRect(x + 1, y + j, w - 2, 1); }
    else if (k < 0.2) { ctx.fillStyle = col('6'); ctx.fillRect(x + (w >> 1), y + j, 1, 1); }
  }
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

/** Pixel "Z" glyph of size n (3..6) with a 1px ink outline so it reads on any background. */
export function zGlyph(ctx: Ctx, x: number, y: number, n: number, key: string) {
  x = Math.round(x); y = Math.round(y);
  const cells: [number, number][] = [];
  for (let i = 0; i < n; i++) { cells.push([i, 0]); cells.push([i, n - 1]); }
  for (let i = 1; i < n - 1; i++) cells.push([n - 1 - i, i]);
  ctx.fillStyle = col('0');
  for (const [a, b] of cells) ctx.fillRect(x + a - 1, y + b - 1, 3, 3);
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

/** 1px dot / 4-point star used by the jet trail. */
export function dot(ctx: Ctx, x: number, y: number, key: string, star = false) {
  x = Math.round(x); y = Math.round(y); ctx.fillStyle = col(key);
  if (star) { ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3); } else ctx.fillRect(x, y, 1, 1);
}
