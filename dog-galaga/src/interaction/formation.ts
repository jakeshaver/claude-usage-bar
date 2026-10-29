// Formation layouts, Galaga style: a clean lattice with gaps, about 2/3 of the playfield wide, with a different
// silhouette per sector (tapered bee/butterfly/boss block, chevron, split wings, diamond, staggered checker, arrow).
// Every home cell sits on a lattice of COL_SP x ROW_SP (>= one cat sprite in both directions), so no two homes overlap.
import type { EnemyDef, WaveDef } from '../core/types';

export const COL_SP = 32;     // cats are 28px wide opaque: 4px of air between neighbours
export const ROW_SP = 31;     // cats are 28px tall opaque
export const MAX_SPAN = 3.5;  // |u| <= 3.5 column units: 7 * 32 + 28 = 252px, ~65% of the 384px view

export type Shape = 'galaga' | 'chevron' | 'wings' | 'diamond' | 'stagger' | 'arrow';

/** One home cell: u = column offset from the centre (in COL_SP units, half steps allowed), row index, dy extra px. */
export interface Cell { u: number; row: number; dy: number }

const line = (n: number) => Array.from({ length: n }, (_, i) => i - (n - 1) / 2);

/** Rows of a shape for a formation of R rows (3..5). */
export function shapeRows(shape: Shape, R: number): { us: number[]; dy?: (u: number) => number }[] {
  const pick = <T>(a: T[]) => a[Math.max(0, Math.min(a.length - 1, R - 3))];
  switch (shape) {
    case 'galaga': // 4 bosses on top, then butterflies, then bees: the arcade's tapered block
      return pick([[4, 6, 8], [4, 6, 8, 8], [4, 6, 8, 8, 8]]).map(n => ({ us: line(n) }));
    case 'chevron': // a wedge with its point at the top centre (rows stay flat: a crisp Galaga grid, never a staircase)
      return pick([[4, 6, 8], [2, 4, 6, 8], [2, 4, 6, 8, 8]]).map(n => ({ us: line(n) }));
    case 'wings': { // two wing blocks with an open lane down the middle and the leaders riding the gap
      const wing = [-3.5, -2.5, -1.5, 1.5, 2.5, 3.5];
      const rows: { us: number[]; dy?: (u: number) => number }[] = [{ us: [-0.5, 0.5] }];
      for (let r = 1; r < R; r++) rows.push({ us: r === 1 ? [-2.5, -1.5, 1.5, 2.5] : wing });
      return rows;
    }
    case 'diamond':
      return pick([[4, 6, 4], [2, 4, 6, 4], [2, 4, 6, 8, 4]]).map(n => ({ us: line(n) }));
    case 'stagger': // a checkerboard lattice: neighbours in the next row sit in the gaps
      return Array.from({ length: R }, (_, r) => ({ us: line(r % 2 ? 7 : 6) }));
    case 'arrow': // a wedge widening downward with notched corners
      return pick([[2, 6, 8], [2, 4, 6, 8], [2, 4, 6, 8, 6]]).map(n => ({ us: line(n) }));
  }
}

/** Per sector: the shapes its waves cycle through (index = area order). */
const SECTOR_SHAPES: Shape[][] = [
  ['galaga', 'arrow'],              // backyard
  ['chevron', 'galaga'],            // street
  ['wings', 'galaga', 'diamond'],   // park
  ['diamond', 'chevron'],           // alley
  ['stagger', 'wings'],             // rooftops
  ['arrow', 'diamond', 'galaga'],   // cafe
  ['chevron', 'stagger'],           // docks
  ['wings', 'galaga', 'arrow'],     // factory
  ['diamond', 'stagger'],           // sky
  ['galaga', 'chevron', 'wings'],   // moon
  ['stagger', 'arrow'],             // nebula
  ['wings', 'diamond', 'chevron'],  // station
  ['galaga', 'stagger', 'chevron'], // mothership
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
export function layout(w: WaveDef, shape: Shape, waveIdx: number, enemy: (id: string) => EnemyDef): Home[] {
  const groups = [...w.cats].sort((a, b) => a.row - b.row);
  const R = Math.max(3, Math.min(5, Math.max(...groups.map(c => c.row + 1))));
  const lead: EnemyDef[] = [], rest: EnemyDef[] = [];
  for (const g of groups) {
    const def = enemy(g.breed); const n = (g.cols ?? Array.from({ length: w.formation.cols }, (_, k) => k)).length;
    for (let k = 0; k < n; k++) (def.behavior === 'capturer' ? lead : rest).push(def);
  }
  const queue = [...lead.slice(0, 4), ...rest];
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
