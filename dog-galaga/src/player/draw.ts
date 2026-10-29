// Pixel-exact drawing helpers private to the player module: every shape is integer fillRects in palette colours.
import { col, PALETTE, KEY } from '../core/palette';
import { spriteRows } from '../art/sprite';

type Ctx = CanvasRenderingContext2D;

/** Ink-checkerboard oval drop shadow (same language as the cats' shadows: 50% dither, no translucency). */
export function shadowOval(ctx: Ctx, cx: number, cy: number, w: number, h = 4) {
  const x0 = Math.round(cx), y0 = Math.round(cy); const rx = Math.max(2, w / 2), ry = Math.max(1, h / 2);
  ctx.fillStyle = col('0');
  for (let dy = -Math.floor(ry); dy <= Math.floor(ry); dy++) {
    const rw = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / ((ry + 0.5) * (ry + 0.5)))));
    for (let dx = -rw; dx <= rw; dx++) if (((x0 + dx + y0 + dy) & 1) === 0) ctx.fillRect(x0 + dx, y0 + dy, 1, 1);
  }
}

/** A sprite rasterised with only every other pixel (checkerboard): a pixel-clean 50% "ghost" for invulnerability blinks. */
const ghostCache = new Map<string, HTMLCanvasElement>();
export function ghostSprite(ctx: Ctx, name: string, frame: number, cx: number, cy: number, parity: number) {
  const key = name + '|' + frame + '|' + (parity & 1);
  let c = ghostCache.get(key);
  if (!c) {
    const rows = spriteRows(name, frame); if (!rows) return;
    const h = rows.length, w = Math.max(...rows.map(r => r.length));
    c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d')!;
    rows.forEach((r, y) => [...r].forEach((ch, i) => {
      if (ch === '.' || ch === ' ' || ((i + y + parity) & 1)) return;
      const pi = KEY.indexOf(ch); if (pi < 0) return;
      x.fillStyle = PALETTE[pi]; x.fillRect(i, y, 1, 1);
    }));
    ghostCache.set(key, c);
  }
  ctx.drawImage(c, Math.round(cx - c.width / 2), Math.round(cy - c.height / 2));
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
