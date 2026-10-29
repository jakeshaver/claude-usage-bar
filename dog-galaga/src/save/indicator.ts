// Autosave indicator: a 14x14 pixel floppy with a paw-print label, blinking in the bottom-right corner
// for about a second after each write. Palette-exact fillRect runs only (no strokes, no alpha).
import { col } from '../core/palette';

const FLOPPY = [
  '000000000000..',
  '04ooooqqoo440.',
  '043oooqqoo3330',
  '043oooqqoo3330',
  '0433oooooo3330',
  '04333333333330',
  '04377777777330',
  '04377P77P77330',
  '0437P7777P7330',
  '04377PPPP77330',
  '04377PPPP77330',
  '04377777777330',
  '02222222222220',
  '00000000000000',
];
export const IND_W = 14, IND_H = 14;
/** total frames the indicator stays up */
export const IND_FRAMES = 66;

function drawFloppy(ctx: CanvasRenderingContext2D, x: number, y: number, paw: string) {
  for (let r = 0; r < FLOPPY.length; r++) {
    const row = FLOPPY[r]; let c = 0;
    while (c < row.length) {
      const ch = row[c]; let e = c + 1; while (e < row.length && row[e] === ch) e++;
      if (ch !== '.') { ctx.fillStyle = col(ch === 'P' ? paw : ch); ctx.fillRect(x + c, y + r, e - c, 1); }
      c = e;
    }
  }
}

/**
 * `left` counts down from IND_FRAMES. Pops up 2px in the first frames, holds solid, then blinks out.
 * The paw flips pink/hot pink so the blink reads even where the corner is busy.
 */
export function drawIndicator(ctx: CanvasRenderingContext2D, x: number, y: number, left: number) {
  if (left <= 0) return;
  const phase = IND_FRAMES - left;
  const visible = phase < 26 || ((phase - 26) >> 3) % 2 === 0;
  if (!visible) return;
  const lift = phase < 4 ? 2 - (phase >> 1) : 0;
  drawFloppy(ctx, Math.round(x), Math.round(y) + lift, (phase >> 3) % 2 ? 'c' : 'd');
}
