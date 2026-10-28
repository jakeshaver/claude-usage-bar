import { text } from '../art/font';
// Futuristic UI kit: neon frames, corner brackets, bars.
export const C = { bg: '#0b0a14', panel: '#141226', panel2: '#1d1b33', line: '#4ef2e6', line2: '#26a6c9', hot: '#e8578f', pink: '#ff9ec8', gold: '#ffd166', text: '#ffffff', dim: '#7b84c9', violet: '#c9a2ff' };
export function frame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, accent = C.line, fill = C.panel) {
  ctx.fillStyle = fill; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = accent; ctx.globalAlpha = 0.35; ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1); ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h); ctx.globalAlpha = 1;
  // corner brackets
  ctx.fillStyle = accent;
  for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w - 1, y, -1, 1], [x, y + h - 1, 1, -1], [x + w - 1, y + h - 1, -1, -1]] as const) {
    ctx.fillRect(sx > 0 ? cx : cx - 5, cy, 6, 1); ctx.fillRect(cx, sy > 0 ? cy : cy - 5, 1, 6);
  }
}
export function label(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, color = C.dim) { text(ctx, s, x, y, color); }
export function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, p: number, color = C.hot, back = '#2a2438') {
  ctx.fillStyle = back; ctx.fillRect(x, y, w, h); ctx.fillStyle = color; ctx.fillRect(x, y, Math.round(w * Math.max(0, Math.min(1, p))), h);
  ctx.fillStyle = '#ffffff33'; ctx.fillRect(x, y, Math.round(w * Math.max(0, Math.min(1, p))), 1);
}
export function scanlines(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = 'rgba(0,0,0,0.12)'; for (let yy = y; yy < y + h; yy += 2) ctx.fillRect(x, yy, w, 1);
}
export function menu(ctx: CanvasRenderingContext2D, items: string[], sel: number, cx: number, y: number, t: number, gap = 16) {
  items.forEach((it, i) => {
    const on = i === sel;
    if (on) { const w = it.length * 6 + 24; ctx.fillStyle = '#e8578f33'; ctx.fillRect(Math.round(cx - w / 2), y + i * gap - 4, w, 15); ctx.fillStyle = C.hot; ctx.fillRect(Math.round(cx - w / 2), y + i * gap - 4, 2, 15); }
    text(ctx, (on ? ((t >> 4) % 2 ? '> ' : ' >') + ' ' : '') + it, cx, y + i * gap, on ? C.gold : C.text, { align: 'center', shadow: C.bg });
  });
}
