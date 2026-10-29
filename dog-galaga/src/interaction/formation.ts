// Formation layouts, Galaga style: flat rows on ONE fixed lattice, at most 8 cats wide and 3-5 rows deep, with a
// different silhouette per sector (tapered bee/butterfly/boss block, chevron, split wings, barrel, convoy, arrow).
// Every home cell sits on a lattice of COL_SP x ROW_SP (>= one cat sprite in both directions), so no two homes
// overlap, and every column is a half step off the centre line, so all rows line up column for column.
import type { EnemyDef, WaveDef } from '../core/types';

export const COL_SP = 32;     // cats are 28px wide opaque: 4px of air between neighbours
export const ROW_SP = 31;     // cats are 28px tall opaque
export const MAX_SPAN = 3.5;  // |u| <= 3.5 column units: 7 * 32 + 28 = 252px, well inside the 384px playfield view
export const MAX_ROWS = 5;
const LATE = 8;             // this few left: the survivors regroup into one tight block

// Every shape is a stack of FLAT rows with an even cat count, centred on the same half-step lattice, so every
// column lines up through the whole block (a crisp Galaga grid, never a checkerboard or a staircase).
export type Shape = 'galaga' | 'chevron' | 'wings' | 'barrel' | 'block' | 'arrow';

/** One home cell: u = column offset from the centre (in COL_SP units, half steps), row index, dy extra px. */
export interface Cell { u: number; row: number; dy: number }

/** n cells of one flat row, centred: always on the half-step lattice (an odd n leans half a column to one side). */
export function line(n: number, lean = 1): number[] {
  if (n <= 0) return [];
  const m = n % 2 ? n + 1 : n;
  const us = Array.from({ length: m }, (_, i) => i - (m - 1) / 2);
  if (n % 2) lean > 0 ? us.shift() : us.pop();   // drop one end cell: stays on the lattice
  return us;
}
const WING = [-3.5, -2.5, -1.5, 1.5, 2.5, 3.5];

/** Row widths of a shape with 3, 4 or 5 rows (index R - 3). */
const WIDTHS: Record<Exclude<Shape, 'wings'>, number[][]> = {
  galaga: [[4, 6, 8], [4, 6, 8, 8], [4, 6, 8, 8, 8]],    // 4 bosses on top, butterflies, then bees: the tapered block
  chevron: [[4, 6, 8], [2, 4, 6, 8], [2, 4, 6, 8, 8]],   // a wedge with its point at the top centre
  barrel: [[6, 8, 6], [6, 8, 8, 6], [6, 8, 8, 8, 6]],    // a rounded block
  block: [[8, 8, 8], [8, 8, 8, 8], [8, 8, 8, 8, 8]],     // a plain convoy
  arrow: [[2, 6, 8], [2, 6, 8, 8], [2, 6, 8, 8, 8]],     // a sharp wedge widening downward
};

/** Rows of a shape for a formation of R rows (3..5). */
export function shapeRows(shape: Shape, R: number): { us: number[]; dy?: (u: number) => number }[] {
  const r = Math.max(3, Math.min(MAX_ROWS, R));
  if (shape === 'wings') // two wing blocks with an open lane down the middle and the leaders riding over the gap
    return Array.from({ length: r }, (_, i) => ({ us: i === 0 ? line(4) : WING }));
  return WIDTHS[shape][r - 3].map(n => ({ us: line(n) }));
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
  ['galaga', 'block', 'barrel'],    // mothership
];
export function shapeFor(areaIdx: number, waveIdx: number): Shape {
  const list = SECTOR_SHAPES[Math.max(0, areaIdx) % SECTOR_SHAPES.length];
  return list[waveIdx % list.length];
}

export interface Home { def: EnemyDef; u: number; row: number; dy: number }

/**
 * Lay out a wave: content gives breeds per row (top first); the shape gives the cells. Capturers lead (top rows),
 * then the content's rows in order. A full row hands its cells out centre-out or edge-in (alternating per wave, so
 * the breeds sit differently); a partial row packs side by side in the middle. Cats beyond capacity are left out.
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
  // as shallow as the wave allows: the fewest rows that hold all but a couple of cats (the grid stays near the top)
  let R = 3; while (R < MAX_ROWS && capacity(shape, R) < queue.length) R++;
  const rows = shapeRows(shape, R); const out: Home[] = [];
  const edgeIn = waveIdx % 2 === 1;
  rows.forEach((row, ri) => {
    const order = [...row.us].sort((a, b) => edgeIn ? Math.abs(b) - Math.abs(a) || a - b : Math.abs(a) - Math.abs(b) || a - b);
    const take = Math.min(order.length, queue.length);
    if (take === order.length) { for (const u of order) out.push({ def: queue.shift()!, u, row: ri, dy: row.dy?.(u) ?? 0 }); return; }
    // a partial row (the end of the queue) packs side by side in the middle, never loose pairs out at the edges
    for (const u of line(take)) out.push({ def: queue.shift()!, u, row: ri, dy: row.dy?.(u) ?? 0 });
  });
  return out;
}

/**
 * Close ranks: given the surviving members (stable row id `rid`, original column `u0`), return compact homes on the
 * same lattice: empty rows are dropped (rows below move up), and a row that has lost a cat packs side by side and
 * re-centres, keeping each cat's left-to-right order (an odd row leans half a column toward where its cats were).
 * An untouched row keeps its cells (the sector's silhouette, e.g. the wings' open lane). Rows never swap cats.
 * While the convoy is still streaming in (`settled` false) rows keep their places, and a row with a cat still flying
 * to its cell keeps its cells (that cat is aiming for one).
 */
export function closeRanks(members: { rid: number; u0: number; u: number; row?: number; busy?: boolean }[], orig: Map<number, number>, settled = true): { row: number; u: number; twoStep?: boolean }[] {
  const rids = [...new Set(members.map(m => m.rid))].sort((a, b) => a - b);
  const out = members.map(m => ({ row: m.rid, u: m.u }));
  if (settled && members.length <= LATE && rids.length > 1) {
    const late = lateBlock(members);
    if (late) return late;
  }
  rids.forEach((r, rank) => {
    const idx = members.map((m, i) => (m.rid === r ? i : -1)).filter(i => i >= 0).sort((a, b) => members[a].u - members[b].u || a - b);
    const row = settled ? rank : r;
    if (!settled && idx.some(i => members[i].busy)) { idx.forEach(i => { out[i] = { row, u: members[i].u }; }); return; }
    if (idx.length >= (orig.get(r) ?? 0)) { idx.forEach(i => { out[i] = { row, u: members[i].u0 }; }); return; }
    const mean = idx.reduce((s, i) => s + members[i].u, 0) / idx.length;
    const us = line(idx.length, mean >= 0 ? 1 : -1);
    idx.forEach((i, k) => { out[i] = { row, u: us[k] }; });
  });
  return out;
}

/**
 * The last few regroup into one tight block (one row of up to 4 cats, or two rows), never a lone column. The move is
 * planned so no two cats ever slide through each other: first every cat slides sideways within its own row (each
 * row's cats keep their order and land in distinct columns), then straight up or down its new column (each column's
 * cats keep their top-to-bottom order). Returns null when the survivors cannot regroup that way (they keep rows).
 */
function lateBlock(members: { u: number; row?: number; rid: number }[]): { row: number; u: number; twoStep: boolean }[] | null {
  const n = members.length, w = n <= 4 ? n : Math.ceil(n / 2);
  const top = line(w, 1), bottom = line(n - w, 1);
  const cols = top.map(u => ({ u, cap: 1 + (bottom.includes(u) ? 1 : 0) }));
  const rowOf = (i: number) => members[i].row ?? members[i].rid;
  const rows = [...new Set(members.map((_, i) => rowOf(i)))].sort((a, b) => a - b)
    .map(r => members.map((_, i) => i).filter(i => rowOf(i) === r).sort((a, b) => members[a].u - members[b].u || a - b));
  if (rows.some(r => r.length > w)) return null;
  const used = cols.map(() => 0), pickCol = new Array<number>(n).fill(-1);
  let best = Infinity, bestPick: number[] | null = null;
  // choose, row by row, an order-preserving set of distinct columns for that row's cats (least sideways travel)
  const dfs = (ri: number, acc: number) => {
    if (acc >= best) return;
    if (ri === rows.length) { best = acc; bestPick = [...pickCol]; return; }
    const r = rows[ri];
    const rec = (k: number, from: number, a: number) => {
      if (k === r.length) { dfs(ri + 1, a); return; }
      for (let c = from; c <= cols.length - (r.length - k); c++) {
        if (used[c] >= cols[c].cap) continue;
        used[c]++; pickCol[r[k]] = c;
        rec(k + 1, c + 1, a + Math.abs(members[r[k]].u - cols[c].u));
        used[c]--; pickCol[r[k]] = -1;
      }
    };
    rec(0, 0, acc);
  };
  dfs(0, 0);
  const pick: number[] | null = bestPick;
  if (!pick) return null;
  const out = members.map(m => ({ row: m.row ?? m.rid, u: m.u, twoStep: true }));
  cols.forEach((c, ci) => {
    // a column's cats keep their top-to-bottom order: the upper one takes the top row
    const idx = members.map((_, i) => i).filter(i => pick[i] === ci).sort((a, b) => rowOf(a) - rowOf(b));
    idx.forEach((i, k) => { out[i] = { row: k, u: c.u, twoStep: true }; });
  });
  return out;
}
