// The middle of the recovery card (scene 'recovery'), drawn with ui's own kit so it matches pixel for pixel.
// ui owns the screen; until ui calls drawRecoveryCard itself (docs/core-requests/save.md R3-5), save repaints
// this band on top of ui's card: the cat chewing the master floppy, the slot status line, the options worded
// from recoveryOptions() and the hint row. The title pill, the frame and the dusk set piece stay ui's.
import { W } from '../core/game';
import { C, rect, disc, ring, scanlines, menu, hintRow, keys, type Device, type Row } from '../ui/draw';
import { headline } from '../ui/numerals';
import { text, textWidth } from '../art/font';
import { drawSprite } from '../art/sprite';
import { drawFloppy } from './indicator';

export interface RecoveryOpts { primary: string; status: string; doomed: boolean; rows?: string[] }

/** ui's card geometry (ui/index.ts recovery()): 340x160 at y 70, centred */
export const CARD = { w: 340, h: 160, x: Math.round(W / 2 - 170), y: 70 } as const;

/** slot state colours: green when it can be loaded, amber when it can be patched, red when it is lost */
export const WORD_COLOR: Record<string, string> = { SAFE: C.lime, NIBBLED: C.gold, CHEWED: C.red, GONE: C.red };

/**
 * 'MAIN: CHEWED  BACKUP: SAFE' centred on cx: labels in the body white, each slot's state word in its own
 * colour, everything with the same 1px ink drop shadow the headline uses (readable at 1x on the navy card).
 */
export function statusLine(ctx: CanvasRenderingContext2D, s: string, cx: number, y: number) {
  let x = Math.round(cx - textWidth(s) / 2);
  for (const part of s.split(/(\s+)/)) {
    if (!part) continue;
    if (part.trim()) {
      const word = part.replace(/[^A-Z]/g, '');
      text(ctx, part, x, y, part.endsWith(':') ? C.text : WORD_COLOR[word] ?? C.text, { shadow: C.ink });
    }
    x += textWidth(part) + 1;
  }
}

/**
 * The cat chewing the save, in a medallion. The tabby sits whole in the upper half (tail to chin); its chin
 * rests on the top-left of the chewed master floppy, and the floppy's bitten top-right corner (a ragged
 * 3px bite) is clear of the cat against the ink disc, with crumbs under it. Every 32 frames the cat chomps
 * (1px dip) and a fresh crumb tumbles off the bite. (mx, my) is the medallion's nominal centre (ui's).
 */
export function drawChewMedallion(ctx: CanvasRenderingContext2D, mx: number, my: number, t: number) {
  const cx = mx, cy = my - 2;
  disc(ctx, cx, cy, 24, C.ink); ring(ctx, cx, cy, 24, C.mag); ring(ctx, cx, cy, 23, C.hot); ring(ctx, cx, cy, 26, C.plum, [3, 3], t >> 3);
  for (const [dx, dy] of [[0, -25], [0, 24], [-25, 0], [24, 0]]) rect(ctx, cx + dx, cy + dy, 2, 2, C.pink);
  const chomp = (t >> 4) % 2;
  // floppy first, so the cat's chin overlaps its top-left edge (the "mouth on the disk")
  // a lavender sticker outline traces the disk (and its bite) against the ink disc
  const fx = cx - 8, fy = cy + 5;
  drawFloppy(ctx, fx, fy, { chewed: true, plate: true, plateColor: C.dim });
  // crumbs: two that already fell, and one tumbling off the bite each chomp
  rect(ctx, fx + 18, fy + 4, 1, 1, C.dim); rect(ctx, fx + 18, fy + 9, 2, 1, C.pale); rect(ctx, fx + 19, fy + 13, 1, 1, C.dim);
  const k = t % 32;
  if (k < 24) rect(ctx, fx + 15 + (k >> 3), fy + 1 + (k >> 1), 1, 1, k & 4 ? C.pale : C.dim);
  // the tabby, frame 0 (paws up by its cheeks, never over the bite): sprite rows 0..27 -> cy-22..cy+5, so
  // only the chin's last row rests on the disk's top edge (2 rows on a chomp)
  drawSprite(ctx, 'cat_tabby', cx, cy - 6 + chomp, { frame: 0 });
}

/**
 * Repaint the card from just under the title pill to its bottom edge (status, options, hint row).
 * `sel` and `t` are ui's (selected row, frame counter). Returns the option rows' hit rects (touch), like
 * ui's menu(). With nothing to fetch there is one row, START FRESH, highlighted whatever `sel` is (both of
 * ui's rows start fresh then).
 */
export function drawRecoveryCard(ctx: CanvasRenderingContext2D, o: RecoveryOpts, sel: number, t: number, dev: Device = 'keyboard'): Row[] {
  const { x, y, w, h } = CARD;
  // clean band: same fill and the same canvas-anchored scanline pattern ui uses, so the seams vanish
  rect(ctx, x + 3, y + 12, w - 6, 128, C.night);
  scanlines(ctx, x + 3, y + 12, w - 6, 128);
  rect(ctx, x + 12, y + 140, w - 24, h - 145, C.night);
  scanlines(ctx, x + 12, y + 140, w - 24, h - 145);
  drawChewMedallion(ctx, W / 2, y + 38, t);
  headline(ctx, 'UH OH! A CAT CHEWED YOUR SAVE.', W / 2, y + 66, C.gold, C.cream, C.burnt);
  text(ctx, o.doomed ? 'NOTHING LEFT TO FETCH. NO WORRIES!' : 'NOTHING IS BROKEN. PICK AN OPTION:', W / 2, y + 82, C.text, { align: 'center' });
  statusLine(ctx, o.status, W / 2, y + 94);
  const items = o.rows ?? (o.doomed ? ['START FRESH'] : [o.primary, 'START FRESH']);
  const icons = items.map(s => (s === 'START FRESH' ? 'new' : 'retry'));
  // a lone START FRESH row sits centred in the space the two rows would take
  const rows = menu(ctx, items, items.length === 1 ? 0 : sel, W / 2, y + (items.length === 1 ? 118 : 110), t, 17, icons, 200, { center: true });
  // hint row: the save-code paste shortcut lives here for keyboards; touch gets plain words (no PAD/OK caps)
  const hy = y + h - 14;
  if (dev === 'touch') text(ctx, items.length === 1 ? 'TAP START FRESH' : 'TAP AN OPTION', W / 2, hy + 1, C.dim, { align: 'center' });
  else {
    const k = keys(dev);
    const pairs: [string, string][] = items.length === 1 ? [[k.ok, 'START FRESH']] : [[k.move, 'CHOOSE'], [k.ok, 'CONFIRM']];
    if (dev === 'keyboard') pairs.push(['CTRL+V', items.length === 1 ? 'PASTE SAVE CODE' : 'SAVE CODE']);
    hintRow(ctx, pairs, W / 2, hy, C.hot);
  }
  return rows;
}
