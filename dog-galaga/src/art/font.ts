// Built-in 5x7 bitmap font (no external fonts). Each glyph: 7 rows of 5 bits.
const G: Record<string, number[]> = {
  'A':[14,17,17,31,17,17,17],'B':[30,17,17,30,17,17,30],'C':[14,17,16,16,16,17,14],'D':[30,17,17,17,17,17,30],
  'E':[31,16,16,30,16,16,31],'F':[31,16,16,30,16,16,16],'G':[14,17,16,23,17,17,15],'H':[17,17,17,31,17,17,17],
  'I':[14,4,4,4,4,4,14],'J':[7,2,2,2,2,18,12],'K':[17,18,20,24,20,18,17],'L':[16,16,16,16,16,16,31],
  'M':[17,27,21,21,17,17,17],'N':[17,17,25,21,19,17,17],'O':[14,17,17,17,17,17,14],'P':[30,17,17,30,16,16,16],
  'Q':[14,17,17,17,21,18,13],'R':[30,17,17,30,20,18,17],'S':[15,16,16,14,1,1,30],'T':[31,4,4,4,4,4,4],
  'U':[17,17,17,17,17,17,14],'V':[17,17,17,17,17,10,4],'W':[17,17,17,21,21,21,10],'X':[17,17,10,4,10,17,17],
  'Y':[17,17,10,4,4,4,4],'Z':[31,1,2,4,8,16,31],
  '0':[14,17,19,21,25,17,14],'1':[4,12,4,4,4,4,14],'2':[14,17,1,2,4,8,31],'3':[30,1,1,14,1,1,30],
  '4':[2,6,10,18,31,2,2],'5':[31,16,30,1,1,17,14],'6':[6,8,16,30,17,17,14],'7':[31,1,2,4,8,8,8],
  '8':[14,17,17,14,17,17,14],'9':[14,17,17,15,1,2,12],
  ' ':[0,0,0,0,0,0,0],'.':[0,0,0,0,0,12,12],',':[0,0,0,0,12,4,8],'!':[4,4,4,4,4,0,4],'?':[14,17,1,2,4,0,4],
  ':':[0,12,12,0,12,12,0],'-':[0,0,0,31,0,0,0],'+':[0,4,4,31,4,4,0],'/':[1,1,2,4,8,16,16],"'":[4,4,8,0,0,0,0],
  '"':[10,10,0,0,0,0,0],'(':[2,4,8,8,8,4,2],')':[8,4,2,2,2,4,8],'<':[2,4,8,16,8,4,2],'>':[8,4,2,1,2,4,8],
  '%':[24,25,2,4,8,19,3],'#':[10,31,10,10,10,31,10],'*':[0,21,14,31,14,21,0],'=':[0,0,31,0,31,0,0],
  '_':[0,0,0,0,0,0,31],'&':[12,18,20,8,21,18,13],'x':[0,0,17,10,4,10,17],'@':[14,17,23,21,23,16,14],
  '♥':[0,10,31,31,14,4,0],'>>':[0,0,0,0,0,0,0],'[':[14,8,8,8,8,8,14],']':[14,2,2,2,2,2,14],
};
const cache = new Map<string, HTMLCanvasElement>();
function glyphCanvas(color: string): HTMLCanvasElement {
  let c = cache.get(color);
  if (c) return c;
  const keys = Object.keys(G);
  c = document.createElement('canvas'); c.width = keys.length * 6; c.height = 7;
  const x = c.getContext('2d')!; x.fillStyle = color;
  keys.forEach((k, i) => G[k].forEach((row, y) => { for (let b = 0; b < 5; b++) if (row & (16 >> b)) x.fillRect(i * 6 + b, y, 1, 1); }));
  cache.set(color, c); return c;
}
const INDEX = new Map(Object.keys(G).map((k, i) => [k, i]));
export function textWidth(s: string, scale = 1): number { return [...s].length * 6 * scale - scale; }
/** Draw pixel text. align: 'left'|'center'|'right'. Optional 1px drop shadow color. */
export function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, color = '#ffffff', opts: { align?: 'left' | 'center' | 'right'; scale?: number; shadow?: string } = {}) {
  const scale = opts.scale ?? 1; s = s.toUpperCase();
  let px = Math.round(x); const w = textWidth(s, scale);
  if (opts.align === 'center') px = Math.round(x - w / 2); else if (opts.align === 'right') px = Math.round(x - w);
  if (opts.shadow) text(ctx, s, px + scale, Math.round(y) + scale, opts.shadow, { scale });
  const sheet = glyphCanvas(color);
  let cx = px;
  for (const ch of s) {
    const i = INDEX.get(ch) ?? INDEX.get('?')!;
    ctx.drawImage(sheet, i * 6, 0, 5, 7, cx, Math.round(y), 5 * scale, 7 * scale);
    cx += 6 * scale;
  }
}
/** Word-wrap to a max character width. */
export function wrap(s: string, maxChars: number): string[] {
  const out: string[] = []; let line = '';
  for (const w of s.split(/\s+/)) {
    if ((line + ' ' + w).trim().length > maxChars) { if (line) out.push(line); line = w; } else line = (line + ' ' + w).trim();
  }
  if (line) out.push(line); return out;
}
