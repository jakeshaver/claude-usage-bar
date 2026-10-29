import { PALETTE } from '../core/palette';
// Large HUD numerals + header face, drawn natively at 1x: 7x11 cells with 2px strokes and chamfered
// corners, so the stroke weight and pixel grid match the 1x text, icons and logo next to them (no
// 2x-scaled mixels). Digits are monospaced (scores never jitter); letters and punctuation are
// proportional. The same face draws every display header (SECTOR MAP, PAUSED, endings, recovery):
// together with the bevel logo it is one of only two display faces in the game.
// Rows are packed as 7-bit masks (MSB = leftmost pixel).
const R = (rows: string) => rows.split(' ').map(r => parseInt(r.padEnd(7, '.').replace(/\./g, '0').replace(/#/g, '1'), 2));
const G: Record<string, number[]> = {
  '0': R('.#####. ####### ##...## ##...## ##...## ##...## ##...## ##...## ##...## ####### .#####.'),
  '1': R('..###.. .####.. ...##.. ...##.. ...##.. ...##.. ...##.. ...##.. ...##.. .###### .######'),
  '2': R('.#####. ####### ##...## .....## ....### ..####. .###... ###.... ##..... ####### #######'),
  '3': R('######. ####### .....## .....## ..####. ..####. .....## .....## .....## ####### ######.'),
  '4': R('##...## ##...## ##...## ##...## ##...## ####### ####### .....## .....## .....## .....##'),
  '5': R('####### ####### ##..... ##..... ######. ####### .....## .....## ##...## ####### .#####.'),
  '6': R('.#####. ####### ##..... ##..... ######. ####### ##...## ##...## ##...## ####### .#####.'),
  '7': R('####### ####### .....## ....### ...###. ..###.. ..##... ..##... ..##... ..##... ..##...'),
  '8': R('.#####. ####### ##...## ##...## .#####. ####### ##...## ##...## ##...## ####### .#####.'),
  '9': R('.#####. ####### ##...## ##...## ##...## ####### .###### .....## .....## ####### .#####.'),
  '/': R('.....## .....## ....##. ....##. ...##.. ...##.. ..##... ..##... .##.... .##.... ##.....'),
  'X': R('##...## ##...## .##.##. .##.##. ..###.. ..###.. ..###.. .##.##. .##.##. ##...## ##...##'),
  '%': R('##...## ##..### ...###. ..###.. .###... ###.... ##..... ....... ....... ....... .......'),
  ' ': R('. . . . . . . . . . .'),
  'A': R('.#####. ####### ##...## ##...## ##...## ####### ####### ##...## ##...## ##...## ##...##'),
  'B': R('######. ####### ##...## ##...## ######. ######. ##...## ##...## ##...## ####### ######.'),
  'C': R('.#####. ####### ##...## ##..... ##..... ##..... ##..... ##..... ##...## ####### .#####.'),
  'D': R('#####.. ######. ##..### ##...## ##...## ##...## ##...## ##...## ##..### ######. #####..'),
  'E': R('####### ####### ##..... ##..... #####.. #####.. ##..... ##..... ##..... ####### #######'),
  'F': R('####### ####### ##..... ##..... #####.. #####.. ##..... ##..... ##..... ##..... ##.....'),
  'G': R('.#####. ####### ##...## ##..... ##..... ##.#### ##.#### ##...## ##...## ####### .#####.'),
  'H': R('##...## ##...## ##...## ##...## ####### ####### ##...## ##...## ##...## ##...## ##...##'),
  'I': R('###### ###### ..##.. ..##.. ..##.. ..##.. ..##.. ..##.. ..##.. ###### ######'),
  'J': R('....### ....### .....## .....## .....## .....## .....## ##...## ##...## ####### .#####.'),
  'K': R('##...## ##..### ##.###. #####.. ####... ####... #####.. ##.###. ##..### ##...## ##...##'),
  'L': R('##..... ##..... ##..... ##..... ##..... ##..... ##..... ##..... ##..... ####### #######'),
  'M': R('##...## ###.### ####### ##.#.## ##.#.## ##...## ##...## ##...## ##...## ##...## ##...##'),
  'N': R('##...## ###..## ####.## ####.## ##.#### ##.#### ##..### ##..### ##...## ##...## ##...##'),
  'O': R('.#####. ####### ##...## ##...## ##...## ##...## ##...## ##...## ##...## ####### .#####.'),
  'P': R('######. ####### ##...## ##...## ##...## ####### ######. ##..... ##..... ##..... ##.....'),
  'Q': R('.#####. ####### ##...## ##...## ##...## ##...## ##.#.## ##.#### ##..### ####### .######'),
  'R': R('######. ####### ##...## ##...## ##...## ####### ######. ##.###. ##..### ##...## ##...##'),
  'S': R('.#####. ####### ##...## ##..... ######. .###### .....## .....## ##...## ####### .#####.'),
  'T': R('###### ###### ..##.. ..##.. ..##.. ..##.. ..##.. ..##.. ..##.. ..##.. ..##..'),
  'U': R('##...## ##...## ##...## ##...## ##...## ##...## ##...## ##...## ##...## ####### .#####.'),
  'V': R('##...## ##...## ##...## ##...## ##...## ##...## .##.##. .##.##. ..###.. ..###.. ...#...'),
  'W': R('##...## ##...## ##...## ##...## ##...## ##.#.## ##.#.## ####### ####### .##.##. .#...#.'),
  'Y': R('##...## ##...## ##...## .##.##. .#####. ..###.. ..###.. ..###.. ..###.. ..###.. ..###..'),
  'Z': R('####### ####### .....## ....### ...###. ..###.. .###... ###.... ##..... ####### #######'),
  '!': R('## ## ## ## ## ## ## . . ## ##'),
  '.': R('. . . . . . . . . ## ##'),
  ',': R('. . . . . . . . . ## .#'),
  "'": R('## ## .# . . . . . . . .'),
  ':': R('. . ## ## . . . ## ## . .'),
  '-': R('. . . . . ##### ##### . . . .'),
  '?': R('.#####. ####### ##...## .....## ....### ..####. ..##... ..##... ....... ..##... ..##...'),
};
/** Glyph widths: digits, '/', 'X', '%' are 7 (monospaced); narrow glyphs are trimmed. */
const WID: Record<string, number> = { ' ': 4, 'I': 6, 'T': 6, '!': 2, '.': 2, ',': 2, "'": 2, ':': 2, '-': 5 };
const wOf = (ch: string) => WID[ch] ?? 7;
export const NUM_H = 11;
const GAP = 2;
export const numWidth = (s: string) => [...s.toUpperCase()].reduce((a, ch) => a + wOf(ch) + GAP, 0) - GAP;

const cache = new Map<string, HTMLCanvasElement>();
const ORDER = Object.keys(G);
/** One strip per (face, highlight) color pair: top two rows use the highlight, the rest the face. */
function strip(face: string, hi: string) {
  const key = face + hi; let c = cache.get(key); if (c) return c;
  c = document.createElement('canvas'); c.width = ORDER.length * 7; c.height = NUM_H;
  const x = c.getContext('2d')!;
  ORDER.forEach((k, i) => G[k].forEach((m, y) => {
    x.fillStyle = y < 2 ? hi : face;
    for (let b = 0; b < 7; b++) if (m & (64 >> b)) x.fillRect(i * 7 + b, y, 1, 1);
  }));
  cache.set(key, c); return c;
}
export interface NumOpts { hi?: string; shadow?: string; outline?: string; align?: 'left' | 'right' | 'center' }
/**
 * Draw the big face (digits, letters, '/', 'X', '%', punctuation). shadow = 1px down-right copy.
 * outline = 1px ring all around (header style: outline, then shadow 1px below the outline, then face).
 */
export function num(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, face: string, opts: NumOpts = {}) {
  s = s.toUpperCase(); const w = numWidth(s);
  const px = Math.round(opts.align === 'right' ? x - w : opts.align === 'center' ? x - w / 2 : x); const py = Math.round(y);
  const draw = (sheet: HTMLCanvasElement, ox: number, oy: number) => {
    let cx = px + ox;
    for (const ch of s) { const i = ORDER.indexOf(ch); const cw = wOf(ch); if (i >= 0) ctx.drawImage(sheet, i * 7, 0, cw, NUM_H, cx, py + oy, cw, NUM_H); cx += cw + GAP; }
  };
  if (opts.outline) {
    const o = strip(opts.outline, opts.outline);
    if (opts.shadow) { const sh = strip(opts.shadow, opts.shadow); for (const [dx, dy] of [[-1, 2], [0, 2], [1, 2], [2, 2], [2, 1], [2, 0]]) draw(sh, dx, dy); }
    for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) draw(o, dx, dy);
  } else if (opts.shadow) draw(strip(opts.shadow, opts.shadow), 1, 1);
  draw(strip(face, opts.hi ?? face), 0, 0);
  return w;
}
/** Display header in the big face: ink outline, dark drop shadow, two-tone face. Centered on cx. */
export function headline(ctx: CanvasRenderingContext2D, s: string, cx: number, y: number, face: string, hi: string, shadow: string) {
  return num(ctx, s, cx, y, face, { hi, shadow, outline: PALETTE[0], align: 'center' });
}
