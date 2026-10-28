import { PALETTE, KEY } from '../core/palette';
// Sprite format: rows of palette keys ('.' transparent). If mirror=true, rows hold the LEFT half
// and are mirrored to make a symmetric sprite of width 2*rowLength.
export interface SpriteDef { rows: string[]; mirror?: boolean; frames?: string[][] }

const cache = new Map<string, HTMLCanvasElement>();
export const SHEETS: Record<string, SpriteDef> = {};
export function defineSprites(defs: Record<string, SpriteDef>) { Object.assign(SHEETS, defs); }

function expand(rows: string[], mirror?: boolean): string[] {
  return mirror ? rows.map(r => r + [...r].reverse().join('')) : rows;
}
export function spriteRows(name: string, frame = 0): string[] | null {
  const d = SHEETS[name]; if (!d) return null;
  const rows = frame > 0 && d.frames?.[frame - 1] ? d.frames[frame - 1] : d.rows;
  return expand(rows, d.mirror);
}
export function frameCount(name: string): number { return 1 + (SHEETS[name]?.frames?.length ?? 0); }

/** Rasterize once to an offscreen canvas. flash=true renders a white silhouette (hit flash). */
export function spriteCanvas(name: string, frame = 0, flash = false, recolor?: Record<string, string>): HTMLCanvasElement | null {
  const key = `${name}|${frame}|${flash ? 1 : 0}|${recolor ? JSON.stringify(recolor) : ''}`;
  const hit = cache.get(key); if (hit) return hit;
  const rows = spriteRows(name, frame); if (!rows) return null;
  const h = rows.length, w = Math.max(...rows.map(r => r.length));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d')!;
  rows.forEach((r, y) => [...r].forEach((ch, i) => {
    if (ch === '.' || ch === ' ') return;
    const k = recolor?.[ch] ?? ch; const pi = KEY.indexOf(k); if (pi < 0) return;
    x.fillStyle = flash ? '#ffffff' : PALETTE[pi]; x.fillRect(i, y, 1, 1);
  }));
  cache.set(key, c); return c;
}

/** Draw centered at (cx, cy), snapped to integer pixels. Missing sprites draw a visible magenta X. */
export function drawSprite(ctx: CanvasRenderingContext2D, name: string, cx: number, cy: number, opts: { frame?: number; flash?: boolean; flipX?: boolean; flipY?: boolean; alpha?: number; recolor?: Record<string, string> } = {}) {
  const c = spriteCanvas(name, opts.frame ?? 0, opts.flash, opts.recolor);
  if (!c) { ctx.strokeStyle = '#ff00ff'; ctx.strokeRect(Math.round(cx) - 8, Math.round(cy) - 8, 16, 16); return; }
  const x = Math.round(cx - c.width / 2), y = Math.round(cy - c.height / 2);
  if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
  if (opts.flipX || opts.flipY) {
    ctx.save(); ctx.translate(x + (opts.flipX ? c.width : 0), y + (opts.flipY ? c.height : 0));
    ctx.scale(opts.flipX ? -1 : 1, opts.flipY ? -1 : 1); ctx.drawImage(c, 0, 0); ctx.restore();
  } else ctx.drawImage(c, x, y);
  if (opts.alpha !== undefined) ctx.globalAlpha = 1;
}
