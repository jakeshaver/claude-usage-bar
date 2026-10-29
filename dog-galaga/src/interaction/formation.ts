// Formation layouts, Galaga style: flat rows on one lattice, up to 10 cats wide and 3-4 rows deep, with a different
// silhouette per sector (tapered bee/butterfly/boss block, chevron, split wings, barrel, plain convoy, arrow).
// Every home cell sits on a lattice of COL_SP x ROW_SP (>= one cat sprite in both directions), so no two homes overlap.
import type { EnemyDef, WaveDef } from '../core/types';

export const COL_SP = 32;     // cats are 28px wide opaque: 4px of air between neighbours
export const ROW_SP = 31;     // cats are 28px tall opaque
export const MAX_SPAN = 4.5;  // |u| <= 4.5 column units: 9 * 32 + 28 = 316px, the arcade's 10-wide convoy

// Every shape is a stack of FLAT rows with an even cat count, centred on the same half-step lattice, so every
// column lines up through the whole block (a crisp Galaga grid, never a checkerboard or a staircase).
export type Shape = 'galaga' | 'chevron' | 'wings' | 'barrel' | 'block' | 'arrow';

/** One home cell: u = column offset from the centre (in COL_SP units, half steps allowed), row index, dy extra px. */
export interface Cell { u: number; row: number; dy: number }

const line = (n: number) => Array.from({ length: n }, (_, i) => i - (n - 1) / 2);
const WING = [-4.5, -3.5, -2.5, -1.5, 1.5, 2.5, 3.5, 4.5];

/** Row widths of a shape with R rows (3 or 4): the formation never grows deeper than 4 rows (stays near the top). */
const WIDTHS: Record<Exclude<Shape, 'wings'>, [number[], number[]]> = {
  galaga: [[4, 8, 10], [4, 8, 10, 10]],    // 4 bosses on top, then butterflies, then bees: the arcade's tapered block
  chevron: [[6, 8, 10], [4, 6, 8, 10]],    // a wedge with its point at the top centre
  barrel: [[6, 10, 6], [6, 8, 10, 8]],     // a rounded block
  block: [[8, 8, 8], [8, 8, 8, 8]],        // a plain convoy
  arrow: [[2, 6, 10], [2, 6, 8, 10]],      // a sharp wedge widening downward
};

/** Rows of a shape for a formation of R rows (3..4). */
export function shapeRows(shape: Shape, R: number): { us: number[]; dy?: (u: number) => number }[] {
  const r4 = R >= 4;
  if (shape === 'wings') // two wing blocks with an open lane down the middle and the leaders riding over the gap
    return Array.from({ length: r4 ? 4 : 3 }, (_, i) => ({ us: i === 0 ? line(4) : WING }));
  return WIDTHS[shape][r4 ? 1 : 0].map(n => ({ us: line(n) }));
}
const capacity = (shape: Shape, R: number) => shapeRows(shape, R).reduce((a, r) => a + r.us.length, 0);

/** Per sector: the shapes its waves cycle through (index = area order). */
const SECTOR_SHAPES: Shape[][] = [
  ['galaga', 'arrow'],              // backyard
  ['chevron', 'galaga'],            // street
  ['wings', 'galaga', 'barrel'],    // park
  ['barrel', 'chevron'],            // alley
  ['block', 'wings'],               // rooftops
  ['arrow', 'barrel', 'galaga'],    // cafe
  ['chevron', 'block'],             // docks
  ['wings', 'galaga', 'arrow'],     // factory
  ['barrel', 'block'],              // sky
  ['galaga', 'chevron', 'wings'],   // moon
  ['block', 'arrow'],               // nebula
  ['wings', 'barrel', 'chevron'],   // station
  ['galaga', 'block', 'chevron'],   // mothership
];
export function shapeFor(areaIdx: number, waveIdx: number): Shape {
  const list = SECTOR_SHAPES[Math.max(0, areaIdx) % SECTOR_SHAPES.length];
  return list[waveIdx % list.length];
}

export interface Home { def: EnemyDef; u: number; row: number; dy: number }

/**
 * Lay out a wave: content gives breeds per row (top first); the shape gives the cells. Capturers lead (top rows),
 * then the content's rows in order. Within a row cats fill centre-out or edge-in (alternating per wave), always
 * in mirrored pairs, so every row stays symmetric. Cats beyond the shape's capacity are left out (keeps it airy).
 */
export function layout(w: WaveDef, shape: Shape, waveIdx: number, enemy: (id: string) => EnemyDef, cap = 99): Home[] {
  const groups = [...w.cats].sort((a, b) => a.row - b.row);
    const lead: EnemyDef[] = [], rest: EnemyDef[] = [];
  for (const g of groups) {
    const def = enemy(g.breed); const n = (g.cols ?? Array.from({ length: w.formation.cols }, (_, k) => k)).length;
    for (let k = 0; k < n; k++) (def.behavior === 'capturer' ? lead : rest).push(def);
  }
  // the convoy grows over the journey (cap: ~20 cats in the backyard up to 32 at the mothership), always an even count
  const queue = [...lead.slice(0, 4), ...rest].slice(0, Math.max(2, cap - (cap % 2)));
  // as shallow as the wave allows: 3 rows when they hold all but a few, else 4 (the bottom row stays above y ~160)
  const R = capacity(shape, 3) + 4 >= queue.length ? 3 : 4;
  const rows = shapeRows(shape, R); const out: Home[] = [];
  const edgeIn = waveIdx % 2 === 1;
  rows.forEach((row, ri) => {
    const order = [...row.us].sort((a, b) => edgeIn ? Math.abs(b) - Math.abs(a) || a - b : Math.abs(a) - Math.abs(b) || a - b);
    const take = Math.min(order.length, queue.length);
    // keep pairs: an odd leftover would leave a lopsided row, so it waits for the next row
    const n = take === order.length ? take : take - (take % 2);
    for (let i = 0; i < n; i++) { const u = order[i]; out.push({ def: queue.shift()!, u, row: ri, dy: row.dy?.(u) ?? 0 }); }
  });
  return out;
}
