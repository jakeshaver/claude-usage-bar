// The save module's one visual identity: a 16x16 pixel floppy with a paw-print label.
// It is the autosave indicator (blinks for about a second after each write) and the master sprite other
// modules should reuse for anything "save" (pause SAVE & QUIT glyph, recovery medallion badge):
//   import { drawFloppy, FLOPPY_W, FLOPPY_H } from '../save/indicator';
// Palette-exact fillRect runs only (no strokes, no alpha, no anti-aliasing).
import { col } from '../core/palette';

/**
 * 16x16 on the half grid. Rows 1-5: metal shutter with its slot; rows 7-13: a 7-row cream label with a paw
 * print: a teardrop pad (2-4-6-4, point up) with three 2x2 toe beans wrapped round its top (one above, one
 * beside each shoulder, like the HUD's hud_paw), every part at least 1px apart. Toes hugging the pad is what
 * makes it read as a paw and never as two eyes and a mouth. The top-right corner is a clean 2px diagonal notch.
 * Keys: 0 ink outline, 4 lavender highlight, 3 periwinkle body, o/q/p shutter, 7 cream label, P paw ink.
 */
export const FLOPPY = [
  '00000000000000..',
  '0433oooooqqo330.',
  '0433oooooqqo3330',
  '0433oooooqqo3330',
  '0433oooooqqo3330',
  '0433pppppppp3330',
  '0433333333333330',
  '0477777PP7777730',
  '0477777PP7777730',
  '047PP777777PP730',
  '047PP77PP77PP730',
  '047777PPPP777730',
  '04777PPPPPP77730',
  '047777PPPP777730',
  '0433333333333330',
  '0000000000000000',
];
/**
 * "memory only" (storage blocked or full): not a faded disk but a different glyph. The outline turns into an
 * amber dashed line (gold/ink every other pixel, like a dotted "not on disk" border) and the paw label holds
 * a little RAM chip: ink die, gold legs, a lime status dot.
 */
const RAM_LABEL = [
  '0477777777777730',
  '0477g7g77g7g7730',
  '0477000000007730',
  '04770i0000007730',
  '0477000000007730',
  '0477g7g77g7g7730',
  '0477777777777730',
];
/** 7x7 one-colour reduction of the master (menu glyph size): shutter, notch, label with paw dots */
export const FLOPPY7 = ['######.', '#.##.##', '#######', '#.....#', '#.#.#.#', '#..#..#', '#######'];
export const FLOPPY_W = 16, FLOPPY_H = 16;
/**
 * chewed variant: per row, the first column bitten away. A bite out of the top-right corner, 2-3px past the
 * corner notch, with a ragged (tooth-marked) edge; the new edge gets an ink outline so it reads anywhere.
 */
const BITE = [10, 12, 11, 13, 14];
export const IND_W = FLOPPY_W, IND_H = FLOPPY_H;
/** total frames the indicator stays up */
export const IND_FRAMES = 66;

export interface FloppyOpts {
  /** palette key for the paw print (default hot pink 'd') */
  paw?: string;
  /** bite out of the corner: the recovery screen's "a cat chewed your save" */
  chewed?: boolean;
  /** flat silhouette in one CSS color (drop shadows, disabled icons) */
  mono?: string;
  /** "memory only" state: amber dashed outline and a RAM chip on the label (storage blocked or full) */
  memory?: boolean;
  /** 1px backing plate around the silhouette, so the icon never melts into busy floors or grid lines */
  plate?: boolean;
  /** plate colour (default ink); a lighter plate shows the outline (and a bite) on an ink background */
  plateColor?: string;
}

function rowOf(r: number, chewed: boolean, memory = false): string {
  let row = FLOPPY[r];
  if (memory && r >= 7 && r <= 13) row = RAM_LABEL[r - 7];
  if (memory) {
    // dashed amber outline: every other outline pixel turns gold ('f'), the rest stays ink
    const edge = (c: number) => r === 0 || r === 15 || c === 0 || c === 15 || row[c + 1] === '.';
    row = [...row].map((ch, c) => (ch === '0' && edge(c) && (r + c) % 2 === 0 ? 'f' : ch)).join('');
  }
  if (!chewed || r >= BITE.length) return row;
  const cut = BITE[r];
  return row.slice(0, cut - 1) + (row[cut - 1] === '.' ? '.' : '0') + '.'.repeat(16 - cut);
}

/** Draw palette rows (run-length fillRects). `key` maps a sprite char to a CSS color (null = skip). */
function blit(ctx: CanvasRenderingContext2D, rows: readonly string[], x: number, y: number, key: (ch: string) => string | null) {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]; let c = 0;
    while (c < row.length) {
      const ch = row[c]; let e = c + 1;
      while (e < row.length && row[e] === ch) e++;
      const fill = ch === '.' ? null : key(ch);
      if (fill) { ctx.fillStyle = fill; ctx.fillRect(x + c, y + r, e - c, 1); }
      c = e;
    }
  }
}

/** Draw the master floppy with its top-left at (x, y), in screen pixels. */
export function drawFloppy(ctx: CanvasRenderingContext2D, x: number, y: number, o: FloppyOpts = {}) {
  x = Math.round(x); y = Math.round(y);
  const rows = FLOPPY.map((_, r) => rowOf(r, !!o.chewed, !!o.memory && !o.mono));
  if (o.plate) {
    // the silhouette grown by 1px in ink: every opaque pixel paints a plus-shaped stamp
    ctx.fillStyle = o.plateColor ?? col('0');
    rows.forEach((row, r) => { for (let c = 0; c < row.length; c++) if (row[c] !== '.') { ctx.fillRect(x + c - 1, y + r, 3, 1); ctx.fillRect(x + c, y + r - 1, 1, 3); } });
  }
  const paw = o.paw ?? 'd';
  if (o.mono) { blit(ctx, rows, x, y, () => o.mono!); return; }
  blit(ctx, rows, x, y, ch => col(ch === 'P' ? paw : ch));
}

/**
 * `left` counts down from IND_FRAMES. Pops up 2px in the first frames, holds solid, then blinks out.
 * Saved for real: the paw flips hot pink / deep magenta so the blink reads even where the corner is busy.
 * Memory only (storage blocked or full): the dashed-amber disk with a RAM chip label, no colour flip, so
 * "saved" and "kept for this session" never look alike.
 */
export function indicatorVisible(left: number): boolean {
  if (left <= 0) return false;
  const phase = IND_FRAMES - left;
  return phase < 26 || ((phase - 26) >> 3) % 2 === 0;
}
export function drawIndicator(ctx: CanvasRenderingContext2D, x: number, y: number, left: number, memory = false) {
  if (!indicatorVisible(left)) return;
  const phase = IND_FRAMES - left;
  const lift = phase < 4 ? 2 - (phase >> 1) : 0;
  drawFloppy(ctx, x, y + lift, memory ? { memory: true, plate: true } : { paw: (phase >> 3) % 2 ? 'e' : 'd', plate: true });
}
