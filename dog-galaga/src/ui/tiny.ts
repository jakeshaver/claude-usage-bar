// Narrow 5px-tall pixel font: the HUD's second text tier, for long names in fixed slots (never truncated, never a marquee).
// A true small-caps cut of the main 5x7 face: square-shouldered capitals, 3px wide by default, with the letters
// that turn into lowercase look-alikes at 3px (M, W, N, O, Q, D, G) drawn wider so they keep their capital shapes.
// Each glyph is [width, ...5 rows of bits] (MSB = left column); advance = width + 1 (2px for a space).
const G: Record<string, number[]> = {
  A: [3, 2, 5, 7, 5, 5], B: [3, 6, 5, 6, 5, 6], C: [3, 7, 4, 4, 4, 7], D: [4, 14, 9, 9, 9, 14], E: [3, 7, 4, 6, 4, 7],
  F: [3, 7, 4, 6, 4, 4], G: [4, 7, 8, 11, 9, 7], H: [3, 5, 5, 7, 5, 5], I: [3, 7, 2, 2, 2, 7], J: [3, 1, 1, 1, 5, 2],
  K: [3, 5, 5, 6, 5, 5], L: [3, 4, 4, 4, 4, 7], M: [5, 17, 27, 21, 17, 17], N: [4, 9, 13, 11, 9, 9], O: [4, 6, 9, 9, 9, 6],
  P: [3, 6, 5, 6, 4, 4], Q: [4, 6, 9, 9, 10, 5], R: [3, 6, 5, 6, 5, 5], S: [3, 7, 4, 7, 1, 7], T: [3, 7, 2, 2, 2, 2],
  U: [3, 5, 5, 5, 5, 7], V: [3, 5, 5, 5, 5, 2], W: [5, 17, 17, 21, 27, 17], X: [3, 5, 5, 2, 5, 5], Y: [3, 5, 5, 2, 2, 2],
  Z: [3, 7, 1, 2, 4, 7],
  '0': [3, 7, 5, 5, 5, 7], '1': [3, 2, 6, 2, 2, 7], '2': [3, 6, 1, 2, 4, 7], '3': [3, 6, 1, 2, 1, 6], '4': [3, 5, 5, 7, 1, 1],
  '5': [3, 7, 4, 6, 1, 6], '6': [3, 3, 4, 7, 5, 7], '7': [3, 7, 1, 2, 2, 2], '8': [3, 7, 5, 7, 5, 7], '9': [3, 7, 5, 7, 1, 6],
  ' ': [1, 0, 0, 0, 0, 0], '.': [1, 0, 0, 0, 0, 1], ',': [2, 0, 0, 0, 1, 2], "'": [1, 1, 1, 0, 0, 0], '!': [1, 1, 1, 1, 0, 1],
  '?': [3, 6, 1, 2, 0, 2], '-': [3, 0, 0, 7, 0, 0], ':': [1, 0, 1, 0, 1, 0], '/': [3, 1, 1, 2, 4, 4], '&': [3, 2, 5, 2, 5, 3],
  '(': [2, 1, 2, 2, 2, 1], ')': [2, 2, 1, 1, 1, 2], '+': [3, 0, 2, 7, 2, 0],
};
export const TINY_H = 5;
const glyph = (ch: string) => G[ch] ?? G['?'];
/** Advance: glyph width + 1px gap (a space is 2px, so word gaps stay readable without eating the slot). */
const adv = (ch: string) => glyph(ch)[0] + 1;
export const tinyWidth = (s: string) => Math.max(0, [...s.toUpperCase()].reduce((a, ch) => a + adv(ch), 0) - 1);
/** Draw narrow text (uppercased). align like font.text; optional 1px drop shadow. */
export function tiny(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, opts: { align?: 'left' | 'center' | 'right'; shadow?: string } = {}) {
  s = s.toUpperCase(); const w = tinyWidth(s);
  let px = Math.round(opts.align === 'center' ? x - w / 2 : opts.align === 'right' ? x - w : x); const py = Math.round(y);
  if (opts.shadow) tiny(ctx, s, px + 1, py + 1, opts.shadow);
  ctx.fillStyle = color;
  for (const ch of s) {
    const g = glyph(ch); const gw = g[0];
    for (let r = 0; r < 5; r++) for (let b = 0; b < gw; b++) if (g[r + 1] & (1 << (gw - 1 - b))) ctx.fillRect(px + b, py + r, 1, 1);
    px += gw + 1;
  }
}
/** Greedy word wrap by pixel width with any measure (a line only overflows `w` when a single word does). */
export function wrapPx(s: string, w: number, measure: (s: string) => number): string[] {
  const out: string[] = []; let line = '';
  for (const word of s.split(/\s+/).filter(Boolean)) {
    const n = line ? line + ' ' + word : word;
    if (line && measure(n) > w) { out.push(line); line = word; } else line = n;
  }
  if (line) out.push(line); return out;
}
/** Split at the word boundary that gives the most even two lines, each at most `w` px wide (or null if none fits). */
export function balancePx(s: string, w: number, measure: (s: string) => number): string[] | null {
  if (measure(s) <= w) return [s];
  const ws = s.split(' '); let best: string[] | null = null, bestW = 1e9;
  for (let i = 1; i < ws.length; i++) {
    const a = ws.slice(0, i).join(' '), b = ws.slice(i).join(' '); const m = Math.max(measure(a), measure(b));
    if (m <= w && m < bestW) { best = [a, b]; bestW = m; }
  }
  return best;
}
