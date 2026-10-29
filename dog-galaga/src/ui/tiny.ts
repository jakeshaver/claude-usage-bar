// Narrow 3x5 pixel font: the HUD's second text tier, for long names in fixed slots (never truncated, never a marquee).
// Each glyph is 5 rows of 3 bits (MSB = left column); advance 4px (2px for a space). Uppercase, digits and the punctuation names use.
const G: Record<string, number[]> = {
  A: [2, 5, 7, 5, 5], B: [6, 5, 6, 5, 6], C: [3, 4, 4, 4, 3], D: [6, 5, 5, 5, 6], E: [7, 4, 6, 4, 7], F: [7, 4, 6, 4, 4],
  G: [3, 4, 5, 5, 3], H: [5, 5, 7, 5, 5], I: [7, 2, 2, 2, 7], J: [1, 1, 1, 5, 2], K: [5, 5, 6, 5, 5], L: [4, 4, 4, 4, 7],
  M: [5, 7, 7, 5, 5], N: [6, 5, 5, 5, 5], O: [2, 5, 5, 5, 2], P: [6, 5, 6, 4, 4], Q: [2, 5, 5, 6, 3], R: [6, 5, 6, 5, 5],
  S: [3, 4, 2, 1, 6], T: [7, 2, 2, 2, 2], U: [5, 5, 5, 5, 7], V: [5, 5, 5, 5, 2], W: [5, 5, 7, 7, 5], X: [5, 5, 2, 5, 5],
  Y: [5, 5, 2, 2, 2], Z: [7, 1, 2, 4, 7],
  '0': [7, 5, 5, 5, 7], '1': [2, 6, 2, 2, 7], '2': [6, 1, 2, 4, 7], '3': [6, 1, 2, 1, 6], '4': [5, 5, 7, 1, 1],
  '5': [7, 4, 6, 1, 6], '6': [3, 4, 7, 5, 7], '7': [7, 1, 2, 2, 2], '8': [7, 5, 7, 5, 7], '9': [7, 5, 7, 1, 6],
  ' ': [0, 0, 0, 0, 0], '.': [0, 0, 0, 0, 2], ',': [0, 0, 0, 2, 4], "'": [2, 2, 0, 0, 0], '!': [2, 2, 2, 0, 2],
  '?': [6, 1, 2, 0, 2], '-': [0, 0, 7, 0, 0], ':': [0, 2, 0, 2, 0], '/': [1, 1, 2, 4, 4], '&': [2, 5, 2, 5, 3],
  '(': [1, 2, 2, 2, 1], ')': [4, 2, 2, 2, 4], '+': [0, 2, 7, 2, 0],
};
export const TINY_H = 5;
/** Advance: 4px per glyph, 2px per space (word gaps stay readable at 3x5 without eating the slot). */
const adv = (ch: string) => ch === ' ' ? 2 : 4;
export const tinyWidth = (s: string) => Math.max(0, [...s].reduce((a, ch) => a + adv(ch), 0) - 1);
/** Draw narrow text (uppercased). align like font.text; optional 1px drop shadow. */
export function tiny(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, opts: { align?: 'left' | 'center' | 'right'; shadow?: string } = {}) {
  s = s.toUpperCase(); const w = tinyWidth(s);
  let px = Math.round(opts.align === 'center' ? x - w / 2 : opts.align === 'right' ? x - w : x); const py = Math.round(y);
  if (opts.shadow) tiny(ctx, s, px + 1, py + 1, opts.shadow);
  ctx.fillStyle = color;
  for (const ch of s) {
    const g = G[ch] ?? G['?'];
    for (let r = 0; r < 5; r++) for (let b = 0; b < 3; b++) if (g[r] & (4 >> b)) ctx.fillRect(px + b, py + r, 1, 1);
    px += adv(ch);
  }
}
