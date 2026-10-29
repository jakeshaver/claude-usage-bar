// The save module's one visual identity: a 16x16 pixel floppy with a paw-print label.
// It is the autosave indicator (blinks for about a second after each write) and the master sprite other
// modules should reuse for anything "save" (pause SAVE & QUIT glyph, recovery medallion badge):
//   import { drawFloppy, FLOPPY_W, FLOPPY_H } from '../save/indicator';
// Palette-exact fillRect runs only (no strokes, no alpha, no anti-aliasing).
import { col } from '../core/palette';

/**
 * 16x16 on the half grid. Rows 1-5: metal shutter with its slot; rows 7-13: a 7-row cream label with a paw
 * print (a centre toe bean, two outer beans tilted outward, a 6x3 pad with clipped corners). The top-right
 * corner is a clean 2px diagonal notch.
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
  '047P777PP777P730',
  '047PP77PP77PP730',
  '0477P777777P7730',
  '047777PPPP777730',
  '04777PPPPPP77730',
  '047777PPPP777730',
  '0477777777777730',
  '0433333333333330',
  '0000000000000000',
];
/** "memory only" recolour: the same disk in cold greys, the paw faded into the label */
const MEMORY_RECOLOR: Record<string, string> = { '3': 'q', '4': 'p', o: 'p', q: 'q', p: 'q', '7': '4', P: '3' };
/** a tiny RAM chip clipped onto the memory-only disk: green board, ink die, gold legs */
const CHIP = [
  '00000000',
  '0jjjjjj0',
  '0j0000j0',
  '0jjjjjj0',
  '00000000',
  '.f.f.f..',
];
/** 7x7 one-colour reduction of the master (menu glyph size): shutter, notch, label with paw dots */
export const FLOPPY7 = ['######.', '#.##.##', '#######', '#.....#', '#.#.#.#', '#..#..#', '#######'];
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
  /** "memory only" state: cold grey disk with a RAM chip clipped on (storage blocked or full) */
  memory?: boolean;
  /** 1px ink backing plate around the silhouette, so the icon never melts into busy floors or grid lines */
  plate?: boolean;
}

function rowOf(r: number, chewed: boolean): string {
  const row = FLOPPY[r];
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
  const rows = FLOPPY.map((_, r) => rowOf(r, !!o.chewed));
  if (o.plate) {
    // the silhouette grown by 1px in ink: every opaque pixel paints a plus-shaped stamp
    const ink = col('0'); ctx.fillStyle = ink;
    rows.forEach((row, r) => { for (let c = 0; c < row.length; c++) if (row[c] !== '.') { ctx.fillRect(x + c - 1, y + r, 3, 1); ctx.fillRect(x + c, y + r - 1, 1, 3); } });
  }
  const paw = o.paw ?? 'd';
  if (o.mono) { blit(ctx, rows, x, y, () => o.mono!); return; }
  if (o.memory) {
    blit(ctx, rows, x, y, ch => col(MEMORY_RECOLOR[ch] ?? ch));
    blit(ctx, CHIP, x + 9, y + 10, ch => col(ch));
    return;
  }
  blit(ctx, rows, x, y, ch => col(ch === 'P' ? paw : ch));
}

/**
 * `left` counts down from IND_FRAMES. Pops up 2px in the first frames, holds solid, then blinks out.
 * Saved for real: the paw flips hot pink / deep magenta so the blink reads even where the corner is busy.
 * Memory only (storage blocked or full): the grey disk with its RAM chip, no colour flip, so "saved" and
 * "kept for this session" never look alike.
 */
export function drawIndicator(ctx: CanvasRenderingContext2D, x: number, y: number, left: number, memory = false) {
  if (left <= 0) return;
  const phase = IND_FRAMES - left;
  const visible = phase < 26 || ((phase - 26) >> 3) % 2 === 0;
  if (!visible) return;
  const lift = phase < 4 ? 2 - (phase >> 1) : 0;
  drawFloppy(ctx, x, y + lift, memory ? { memory: true, plate: true } : { paw: (phase >> 3) % 2 ? 'e' : 'd', plate: true });
}
