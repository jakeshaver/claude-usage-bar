// The save module's one visual identity: a 16x16 pixel floppy with a paw-print label.
// It is the autosave indicator (blinks for about a second after each write) and the master sprite other
// modules should reuse for anything "save" (pause SAVE & QUIT glyph, recovery medallion badge):
//   import { drawFloppy, FLOPPY_W, FLOPPY_H } from '../save/indicator';
// Palette-exact fillRect runs only (no strokes, no alpha, no anti-aliasing).
import { col } from '../core/palette';

/**
 * 16x16 on the half grid. Rows 1-4: metal shutter with its slot; rows 6-14: cream label with a paw print
 * (three 2x2 toe beans in an arc, 1px of cream, then a 4-wide pad with its top corners clipped).
 * Keys: 0 ink outline, 4 lavender highlight, 3 periwinkle body, o/q/p shutter, 7 cream label, P paw ink.
 */
export const FLOPPY = [
  '00000000000000..',
  '0433oooooqqo330.',
  '0433oooooqqo3330',
  '0433oooooqqo3330',
  '0433pppppppp3330',
  '0433333333333330',
  '0477777777777730',
  '0477777PP7777730',
  '0477PP7PP7PP7730',
  '0477PP7777PP7730',
  '0477777777777730',
  '0477777PP7777730',
  '047777PPPP777730',
  '047777PPPP777730',
  '0477777777777730',
  '0000000000000000',
];
export const FLOPPY_W = 16, FLOPPY_H = 16;
/** chewed variant: per row, the first column bitten away (a jagged bite out of the top-right corner) */
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
}

function rowOf(r: number, chewed: boolean): string {
  const row = FLOPPY[r];
  if (!chewed || r >= BITE.length) return row;
  const cut = BITE[r];
  return row.slice(0, cut - 1) + (row[cut - 1] === '.' ? '.' : '0') + '.'.repeat(16 - cut);
}

/** Draw the master floppy with its top-left at (x, y), in screen pixels. */
export function drawFloppy(ctx: CanvasRenderingContext2D, x: number, y: number, o: FloppyOpts = {}) {
  x = Math.round(x); y = Math.round(y);
  const paw = o.paw ?? 'd';
  for (let r = 0; r < FLOPPY_H; r++) {
    const row = rowOf(r, !!o.chewed);
    let c = 0;
    while (c < row.length) {
      const ch = row[c]; let e = c + 1;
      while (e < row.length && row[e] === ch) e++;
      if (ch !== '.') { ctx.fillStyle = o.mono ?? col(ch === 'P' ? paw : ch); ctx.fillRect(x + c, y + r, e - c, 1); }
      c = e;
    }
  }
}

/**
 * `left` counts down from IND_FRAMES. Pops up 2px in the first frames, holds solid, then blinks out.
 * The paw flips hot pink / deep magenta so the blink reads even where the corner is busy.
 */
export function drawIndicator(ctx: CanvasRenderingContext2D, x: number, y: number, left: number) {
  if (left <= 0) return;
  const phase = IND_FRAMES - left;
  const visible = phase < 26 || ((phase - 26) >> 3) % 2 === 0;
  if (!visible) return;
  const lift = phase < 4 ? 2 - (phase >> 1) : 0;
  drawFloppy(ctx, x, y + lift, { paw: (phase >> 3) % 2 ? 'e' : 'd' });
}
