// The middle of the recovery card (scene 'recovery'), drawn with ui's own kit so it matches pixel for pixel.
// ui owns the screen; until ui reads save.recoveryOptions() itself (docs/core-requests/save.md R3-5), save
// repaints this band on top of ui's card: the cat chewing the master floppy, the slot status line, and the
// primary row labelled from recoveryOptions() (with the "start fresh?" confirm step). The rest of the card
// (title pill, frame, hint row, the dusk set piece) stays ui's.
import { W } from '../core/game';
import { C, rect, disc, ring, scanlines, menu, type Device, type Row } from '../ui/draw';
import { headline } from '../ui/numerals';
import { text, textWidth } from '../art/font';
import { drawSprite } from '../art/sprite';
import { drawFloppy } from './indicator';

export interface RecoveryOpts { primary: string; status: string; doomed: boolean; confirm: string }

/** ui's card geometry (ui/index.ts recovery()): 340x160 at y 70, centred */
export const CARD = { w: 340, h: 160, x: Math.round(W / 2 - 170), y: 70 } as const;

const WORD_COLOR: Record<string, string> = { SAFE: C.lime, NIBBLED: C.gold, CHEWED: C.hot, GONE: C.dim };

/** 'MAIN: CHEWED  BACKUP: SAFE' with each slot's word in its own colour, centred on cx */
function statusLine(ctx: CanvasRenderingContext2D, s: string, cx: number, y: number) {
  let x = Math.round(cx - textWidth(s) / 2);
  for (const part of s.split(/(\s+)/)) {
    if (!part) continue;
    const word = part.replace(/[^A-Z]/g, '');
    text(ctx, part, x, y, part.endsWith(':') ? C.dim : WORD_COLOR[word] ?? C.text);
    x += textWidth(part) + 1;
  }
}

/**
 * The cat chewing the save, in ui's medallion. The chewed master floppy sits under the cat's chin with its
 * bitten corner in the cat's mouth; every 32 frames the cat chomps (1px dip) and a crumb drops off the bite.
 */
export function drawChewMedallion(ctx: CanvasRenderingContext2D, mx: number, my: number, t: number) {
  disc(ctx, mx, my, 22, C.ink); ring(ctx, mx, my, 22, C.mag); ring(ctx, mx, my, 21, C.hot); ring(ctx, mx, my, 25, C.plum, [3, 3], t >> 3);
  for (const [dx, dy] of [[0, -23], [0, 22], [-23, 0], [22, 0]]) rect(ctx, mx + dx, my + dy, 2, 2, C.pink);
  const chomp = (t >> 4) % 2;
  drawSprite(ctx, 'cat_tabby', mx, my - 3 + chomp, { frame: chomp });
  // floppy top-right corner (the bite) at the cat's mouth (sprite row 23 = my + 7)
  drawFloppy(ctx, mx - 13, my + 5, { chewed: true });
  // crumbs: two periwinkle bits tumbling off the bite, restarting with each chomp
  const k = t % 32;
  if (k < 20) { rect(ctx, mx + 4 + (k >> 3), my + 9 + (k >> 1), 1, 1, C.peri); }
  if (k > 6 && k < 26) { const j = k - 6; rect(ctx, mx + 6 + (j >> 2), my + 8 + (j >> 1), 1, 1, C.dim); }
}

/**
 * Repaint the card from just under the title pill to just above the hint row.
 * `sel` and `t` are ui's (selected row, frame counter); `confirm` is save's "start fresh?" step.
 * Returns the two rows' hit rects (touch), like ui's menu().
 */
export function drawRecoveryCard(ctx: CanvasRenderingContext2D, o: RecoveryOpts, sel: number, t: number, confirm: boolean, dev: Device = 'keyboard'): Row[] {
  const { x, y, w } = CARD;
  // clean band: same fill and the same canvas-anchored scanline pattern ui uses, so the seams vanish
  rect(ctx, x + 3, y + 12, w - 6, 126, C.night);
  scanlines(ctx, x + 3, y + 12, w - 6, 126);
  drawChewMedallion(ctx, W / 2, y + 38, t);
  headline(ctx, 'UH OH! A CAT CHEWED YOUR SAVE.', W / 2, y + 66, C.gold, C.cream, C.burnt);
  if (confirm) text(ctx, o.confirm, W / 2, y + 82, C.gold, { align: 'center', shadow: C.ink });
  else text(ctx, 'NOTHING IS BROKEN. PICK AN OPTION:', W / 2, y + 82, C.text, { align: 'center' });
  // every few seconds the status line gives way to the save-code tip (keyboard players can paste one)
  const tip = dev === 'keyboard' && !confirm && (t >> 8) % 2 === 1;
  if (tip) text(ctx, 'HAVE A SAVE CODE? PRESS CTRL+V', W / 2, y + 93, C.violet, { align: 'center' });
  else statusLine(ctx, o.status, W / 2, y + 93);
  const first = confirm ? 'YES, START FRESH' : o.primary;
  return menu(ctx, [first, 'START FRESH'], sel, W / 2, y + 108, t, 17, [confirm ? 'new' : 'retry', 'new'], 200, { center: true });
}
