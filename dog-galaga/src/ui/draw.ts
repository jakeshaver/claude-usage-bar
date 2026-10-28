import { text, textWidth } from '../art/font';
import { PALETTE } from '../core/palette';
// Futuristic UI kit. Everything here is pixel exact: integer fillRects only, no arcs, no strokes,
// no alpha blending for shapes (dimming uses palette dithers). Colors come from the fixed palette.
const P = PALETTE;
export const C = {
  bg: P[0], panel: P[1], panel2: P[2], line: P[21], line2: P[22], hot: P[13], pink: P[12], gold: P[15], text: P[6],
  dim: P[4], violet: P[29], ink: P[0], night: P[1], indigo: P[2], peri: P[3], pale: P[5], plum: P[31], deep: P[23],
  mag: P[14], orange: P[16], burnt: P[17], purple: P[30], lime: P[18], red: P[27], ice: P[28], cream: P[7],
};
/** Dark partner of each accent, used for frame outlines and drop shadows. */
const DARK: Record<string, string> = {
  [C.line]: C.deep, [C.line2]: C.deep, [C.hot]: C.mag, [C.pink]: C.mag, [C.gold]: C.burnt, [C.violet]: C.purple,
  [C.dim]: C.peri, [C.lime]: P[20], [C.orange]: C.burnt, [C.red]: C.mag, [C.text]: C.peri,
};
export const darkOf = (c: string) => DARK[c] ?? C.indigo;
const LIGHT: Record<string, string> = { [C.hot]: C.pink, [C.line]: C.ice, [C.line2]: C.line, [C.gold]: C.cream, [C.violet]: C.pale, [C.lime]: C.cream, [C.pink]: C.text };
export const lighter = (c: string) => LIGHT[c] ?? C.text;

export function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
const onDash = (i: number, dash: [number, number] | undefined, phase: number) => {
  if (!dash) return true; const n = dash[0] + dash[1]; return (((i + phase) % n) + n) % n < dash[0];
};
/** Bresenham line. dash = [on, off] pixel run lengths; phase shifts the pattern (marching dashes). */
export function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, c: string, dash?: [number, number], phase = 0) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy; ctx.fillStyle = c;
  for (let i = 0; i < 4000; i++) {
    if (onDash(i, dash, phase)) ctx.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
/** Filled pixel disc. */
export function disc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, c: string) {
  ctx.fillStyle = c; cx = Math.round(cx); cy = Math.round(cy);
  for (let dy = -r; dy <= r; dy++) { const dx = Math.floor(Math.sqrt(r * r - dy * dy) + 0.35); ctx.fillRect(cx - dx, cy + dy, dx * 2 + 1, 1); }
}
const ringCache = new Map<number, [number, number][]>();
/** Ring points in angular order (midpoint circle). */
function ringPts(r: number): [number, number][] {
  let out = ringCache.get(r); if (out) return out;
  const oct: [number, number][] = []; let x = r, y = 0, err = 1 - r;
  while (x >= y) { oct.push([x, y]); y++; if (err < 0) err += 2 * y + 1; else { x--; err += 2 * (y - x) + 1; } }
  out = []; const n = oct.length;
  for (let o = 0; o < 8; o++) for (let k = 0; k < n; k++) {
    const [a, b] = oct[o % 2 ? n - 1 - k : k];
    const m: [number, number][] = [[a, b], [b, a], [-b, a], [-a, b], [-a, -b], [-b, -a], [b, -a], [a, -b]];
    out.push(m[o]);
  }
  ringCache.set(r, out); return out;
}
/** 1px pixel circle. dash/phase give a rotating dashed ring. */
export function ring(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, c: string, dash?: [number, number], phase = 0) {
  ctx.fillStyle = c; cx = Math.round(cx); cy = Math.round(cy);
  ringPts(r).forEach(([a, b], i) => { if (onDash(i, dash, phase)) ctx.fillRect(cx + a, cy + b, 1, 1); });
}
const patCache = new Map<string, CanvasPattern | null>();
type Pat = 'check' | 'sparse' | 'scan';
/** Dither fill: 'check' = 50% checkerboard, 'sparse' = 25%, 'scan' = broken scanline every 3rd row. */
export function dither(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string, kind: Pat | boolean = 'check') {
  const k: Pat = kind === true ? 'sparse' : kind === false ? 'check' : kind;
  const key = c + k; let p = patCache.get(key);
  if (p === undefined) {
    const cv = document.createElement('canvas'); cv.width = 4; cv.height = k === 'scan' ? 3 : 4; const x2 = cv.getContext('2d')!; x2.fillStyle = c;
    for (let yy = 0; yy < cv.height; yy++) for (let xx = 0; xx < 4; xx++) {
      const on = k === 'check' ? (xx + yy) % 2 === 0 : k === 'sparse' ? (xx % 2 === 0 && yy % 2 === 0) : yy === 0 && xx % 2 === 0;
      if (on) x2.fillRect(xx, yy, 1, 1);
    }
    p = ctx.createPattern(cv, 'repeat'); patCache.set(key, p);
  }
  if (!p) return;
  ctx.fillStyle = p; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}
function inset(i: number, h: number, cut: number) { return Math.max(0, cut - i, cut - (h - 1 - i)); }
/** Chamfered (cut-corner) fill. */
export function chamferFill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string, cut = 4) {
  x = Math.round(x); y = Math.round(y); ctx.fillStyle = c;
  for (let i = 0; i < h; i++) { const k = inset(i, h, cut); ctx.fillRect(x + k, y + i, w - 2 * k, 1); }
}
/** Chamfered 1px outline. */
export function chamferLine(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string, cut = 4) {
  x = Math.round(x); y = Math.round(y); ctx.fillStyle = c;
  ctx.fillRect(x + cut, y, w - 2 * cut, 1); ctx.fillRect(x + cut, y + h - 1, w - 2 * cut, 1);
  for (let i = 1; i < h - 1; i++) { const k = inset(i, h, cut); ctx.fillRect(x + k, y + i, 1, 1); ctx.fillRect(x + w - 1 - k, y + i, 1, 1); }
}
/**
 * Neon panel: chamfered fill, dark outline, bright accent on the cut corners, inner top highlight.
 * Signature kept from v1 (journal uses it). Alpha suffixes on fill are ignored (palette-exact).
 */
export function frame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, accent = C.line, fill = C.panel, cut = 5) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  cut = Math.max(1, Math.min(cut, Math.floor(Math.min(w, h) / 3)));
  const f = fill.length > 7 ? fill.slice(0, 7) : fill;
  chamferFill(ctx, x, y, w, h, f, cut);
  chamferLine(ctx, x, y, w, h, darkOf(accent), cut);
  if (w > 2 * cut + 4) rect(ctx, x + cut + 1, y + 1, w - 2 * cut - 2, 1, C.indigo);
  ctx.fillStyle = accent;
  const run = Math.max(2, Math.min(10, Math.floor(w / 4), Math.floor(h / 4)));
  for (let i = 0; i <= cut; i++) {
    ctx.fillRect(x + cut - i, y + i, 1, 1); ctx.fillRect(x + w - 1 - cut + i, y + i, 1, 1);
    ctx.fillRect(x + cut - i, y + h - 1 - i, 1, 1); ctx.fillRect(x + w - 1 - cut + i, y + h - 1 - i, 1, 1);
  }
  ctx.fillRect(x + cut, y, run, 1); ctx.fillRect(x + w - cut - run, y, run, 1);
  ctx.fillRect(x + cut, y + h - 1, run, 1); ctx.fillRect(x + w - cut - run, y + h - 1, run, 1);
  ctx.fillRect(x, y + cut, 1, run); ctx.fillRect(x + w - 1, y + cut, 1, run);
  ctx.fillRect(x, y + h - cut - run, 1, run); ctx.fillRect(x + w - 1, y + h - cut - run, 1, run);
}
export function label(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, color = C.dim) { text(ctx, s, x, y, color); }
/** Section header: status LED, label, and a rule to the right edge with an end tick. */
export function header(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, w: number, accent = C.line, t = 0, live = false) {
  const lit = !live || ((t >> 4) % 3 !== 0);
  rect(ctx, x, y + 2, 3, 3, lit ? accent : darkOf(accent));
  text(ctx, s, x + 6, y, C.dim);
  const lx = x + 6 + textWidth(s) + 4;
  if (lx < x + w - 4) { rect(ctx, lx, y + 3, x + w - lx - 3, 1, C.indigo); rect(ctx, x + w - 2, y + 1, 2, 5, darkOf(accent)); }
}
export function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, p: number, color = C.hot, back = C.plum) {
  const f = Math.round(w * Math.max(0, Math.min(1, p)));
  rect(ctx, x, y, w, h, back); rect(ctx, x, y, f, h, color);
  if (h > 2 && f > 0) rect(ctx, x, y, f, 1, lighter(color));
}
/** Segmented bar: n cells of width cw with 1px gaps. */
export function segBar(ctx: CanvasRenderingContext2D, x: number, y: number, n: number, cw: number, h: number, p: number, color = C.line, back = C.plum) {
  const on = Math.round(n * Math.max(0, Math.min(1, p)));
  for (let i = 0; i < n; i++) {
    rect(ctx, x + i * (cw + 1), y, cw, h, i < on ? color : back);
    if (i < on && h > 2) rect(ctx, x + i * (cw + 1), y, cw, 1, lighter(color));
  }
}
/** Subtle broken scanlines (palette-exact dither, no alpha). */
export function scanlines(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) { dither(ctx, x, y, w, h, C.ink, 'scan'); }
/** Pixel triangle arrow. (x, y) is the tip for l/r and u/d. */
export function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, dir: 'l' | 'r' | 'u' | 'd', s: number, c: string) {
  ctx.fillStyle = c; x = Math.round(x); y = Math.round(y);
  for (let i = 0; i < s; i++) {
    const len = i * 2 + 1;
    if (dir === 'r') ctx.fillRect(x - i, y - i, 1, len);
    if (dir === 'l') ctx.fillRect(x + i, y - i, 1, len);
    if (dir === 'd') ctx.fillRect(x - i, y - i, len, 1);
    if (dir === 'u') ctx.fillRect(x - i, y + i, len, 1);
  }
}
/** Keycap / button glyph: chamfered box with label. Returns its width. */
export function keycap(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, color = C.line, align: 'left' | 'center' | 'right' = 'left') {
  const w = textWidth(s) + 7; let bx = Math.round(x);
  if (align === 'center') bx = Math.round(x - w / 2); else if (align === 'right') bx = Math.round(x - w);
  chamferFill(ctx, bx, y - 2, w, 11, C.night, 2); chamferLine(ctx, bx, y - 2, w, 11, darkOf(color), 2);
  rect(ctx, bx + 2, y + 8, w - 4, 1, darkOf(color));
  text(ctx, s, bx + 4, y, color);
  return w;
}
export function hintWidth(pairs: [string, string][], gap = 12) {
  return pairs.reduce((a, [k, c]) => a + textWidth(k) + 11 + textWidth(c), 0) + (pairs.length - 1) * gap;
}
/** Row of [keycap, caption] pairs, centered on cx. */
export function hintRow(ctx: CanvasRenderingContext2D, pairs: [string, string][], cx: number, y: number, color = C.line, gap = 12) {
  let x = Math.round(cx - hintWidth(pairs, gap) / 2);
  for (const [k, c] of pairs) { const kw = keycap(ctx, k, x, y, color); text(ctx, c, x + kw + 4, y, C.dim); x += kw + 4 + textWidth(c) + gap; }
}
// 7x7 pixel icons
const ICONS: Record<string, string[]> = {
  heart: ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...', '.......'],
  star: ['...#...', '...#...', '#######', '.#####.', '..###..', '.##.##.', '.#...#.'],
  paw: ['.#.#.#.', '.#.#.#.', '.......', '..###..', '.#####.', '.#####.', '..#.#..'],
  clock: ['.#####.', '#..#..#', '#..#..#', '#..##.#', '#.....#', '#.....#', '.#####.'],
  flag: ['#####..', '######.', '######.', '#####..', '#......', '#......', '#......'],
  wave: ['#..#...', '.#..#..', '..#..#.', '.#..#..', '#..#...', '.......', '.......'],
  cat: ['#.....#', '##...##', '#######', '#.#.#.#', '#######', '.#####.', '..#.#..'],
  photo: ['#######', '#.....#', '#.#...#', '#...#.#', '#..####', '#######', '.......'],
  sun: ['#..#..#', '.#####.', '.#####.', '#######', '.#####.', '.#####.', '#..#..#'],
  moon: ['..###..', '.##....', '##.....', '##.....', '##.....', '.##....', '..###..'],
  gear: ['.#.#.#.', '#######', '.##.##.', '###.###', '.##.##.', '#######', '.#.#.#.'],
  book: ['.##.##.', '#..#..#', '#..#..#', '#..#..#', '#..#..#', '.##.##.', '...#...'],
  play: ['.#.....', '.##....', '.###...', '.####..', '.###...', '.##....', '.#.....'],
  disk: ['######.', '#.##.##', '#.##..#', '#.....#', '#.###.#', '#.###.#', '#######'],
  bolt: ['...##..', '..##...', '.####..', '..##...', '.##....', '.#.....', '.......'],
  gift: ['.#.#...', '#######', '#..#..#', '#######', '#..#..#', '#..#..#', '#######'],
  retry: ['..####.', '.#....#', '#......', '#....#.', '#...###', '.#.....', '..###..'],
  new: ['...#...', '.#.#.#.', '..###..', '###.###', '..###..', '.#.#.#.', '...#...'],
  note: ['..####.', '..#..#.', '..#..#.', '..#..#.', '###.###', '###.###', '.......'],
  speaker: ['...#...', '..##.#.', '###.#.#', '###.#.#', '###.#.#', '..##.#.', '...#...'],
  shake: ['#.###.#', '.#...#.', '#.###.#', '.#...#.', '#.###.#', '.......', '.......'],
  hand: ['..#....', '..#.#..', '..#####', '#.#####', '#######', '.#####.', '..###..'],
  back: ['...#...', '..##...', '.######', '#######', '.######', '..##...', '...#...'],
  pup: ['#.....#', '##...##', '.#####.', '.#.#.#.', '.#####.', '..#.#..', '.......'],
};
export function icon(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, color: string, shadow?: string) {
  const g = ICONS[name]; if (!g) return;
  x = Math.round(x); y = Math.round(y);
  const put = (ox: number, oy: number) => g.forEach((r, yy) => { for (let xx = 0; xx < 7; xx++) if (r[xx] === '#') ctx.fillRect(x + xx + ox, y + yy + oy, 1, 1); });
  if (shadow) { ctx.fillStyle = shadow; put(1, 1); }
  ctx.fillStyle = color; put(0, 0);
}
/** Vertical menu. Selected row: chamfered plum bar, hot caps, animated pixel arrows. */
export function menu(ctx: CanvasRenderingContext2D, items: string[], sel: number, cx: number, y: number, t: number, gap = 16, icons?: string[], width?: number) {
  const maxW = Math.max(...items.map(s => textWidth(s))) + (icons ? 12 : 0);
  const w = width ?? maxW + 40;
  const tx = Math.round(cx - maxW / 2) + (icons ? 12 : 0);
  items.forEach((it, i) => {
    const on = i === sel; const yy = y + i * gap;
    if (on) {
      const bx = Math.round(cx - w / 2);
      chamferFill(ctx, bx, yy - 3, w, 13, C.plum, 3); chamferLine(ctx, bx, yy - 3, w, 13, C.mag, 3);
      rect(ctx, bx + 1, yy, 1, 7, C.hot); rect(ctx, bx + w - 2, yy, 1, 7, C.hot);
      const o = (t >> 3) % 2;
      if (!icons) { arrow(ctx, bx + 8 + o, yy + 3, 'r', 4, C.gold); arrow(ctx, bx + w - 9 - o, yy + 3, 'l', 4, C.gold); }
    }
    if (icons?.[i]) icon(ctx, icons[i], tx - 12 - (on && (t >> 3) % 2 ? 1 : 0), yy, on ? C.gold : C.peri, on ? C.mag : undefined);
    text(ctx, it, tx, yy, on ? C.gold : C.text, { shadow: on ? C.mag : C.ink });
  });
}
export type Device = 'keyboard' | 'gamepad' | 'touch';
/** Device-aware button names for hints. */
export function keys(dev: Device) {
  if (dev === 'gamepad') return { ok: 'A', back: 'B', pause: 'START', move: 'D-PAD', fire: 'A' };
  if (dev === 'touch') return { ok: 'TOOT', back: 'II', pause: 'II', move: 'PAD', fire: 'TOOT' };
  return { ok: 'SPACE', back: 'ESC', pause: 'ESC', move: 'ARROWS', fire: 'SPACE' };
}
