// Large HUD numerals drawn natively at 1x: 7x11 cells with 2px strokes and chamfered corners, so the
// stroke weight and pixel grid match the 1x text, icons and logo next to them (no 2x-scaled mixels).
// Rows are packed as 7-bit masks (MSB = leftmost pixel).
const R = (rows: string) => rows.split(' ').map(r => parseInt(r.replace(/\./g, '0').replace(/#/g, '1'), 2));
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
  ' ': R('....... ....... ....... ....... ....... ....... ....... ....... ....... ....... .......'),
};
export const NUM_H = 11;
const ADV = 9; // 7px glyph + 2px gap
export const numWidth = (s: string) => s.length * ADV - 2;

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
/** Draw large numerals (digits, '/', 'X', '%'). Shadow is a 1px offset copy (down-right). */
export function num(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, face: string, opts: { hi?: string; shadow?: string; align?: 'left' | 'right' | 'center' } = {}) {
  const w = numWidth(s);
  let px = Math.round(opts.align === 'right' ? x - w : opts.align === 'center' ? x - w / 2 : x); const py = Math.round(y);
  const draw = (sheet: HTMLCanvasElement, ox: number, oy: number) => {
    let cx = px + ox;
    for (const ch of s.toUpperCase()) { const i = ORDER.indexOf(ch); if (i >= 0) ctx.drawImage(sheet, i * 7, 0, 7, NUM_H, cx, py + oy, 7, NUM_H); cx += ADV; }
  };
  if (opts.shadow) draw(strip(opts.shadow, opts.shadow), 1, 1);
  draw(strip(face, opts.hi ?? face), 0, 0);
  return w;
}
