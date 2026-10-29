// Formation layouts, Galaga style: ONE fixed lattice per wave. Every cat owns one cell for the whole wave (it enters
// into it, dives from it and returns to it); cells never move sideways, so the rack always reads as a grid with holes.
// The lattice is centred on the area's lane (not on the camera) and is never wider than the lane allows:
// cols = how many COL_SP cells (plus the sway) fit between the lane's walls, at most 8.
import type { EnemyDef, WaveDef } from '../core/types';

export const COL_SP = 32;     // cats are 28px wide opaque: 4px of air between neighbours (one integer pitch for every row)
export const ROW_SP = 32;     // cats are 28px tall opaque (+ rim and fluff): 4px of air between rows
export const MAX_COLS = 8;
export const MAX_ROWS = 5;
const CAT_W = 28;

/** Lane walls per area (world x, the playfield is 448 wide): buildings, rails, conduits the rack must stay inside. */
const LANES: Record<string, [number, number]> = {
  alley: [92, 362],       // brick walls both sides
  cafe: [80, 382],        // window wall left, pendant windows right
  docks: [104, 400],      // boardwalk on the left
  factory: [70, 374],     // pipe wall left, catwalk right
  mothership: [128, 320], // yarn cable (x 113-123) and the grey conduit (x 326-338): a still 6-wide rack
};
const DEFAULT_LANE: [number, number] = [64, 384];
export function laneOf(areaId: string): [number, number] { return LANES[areaId] ?? DEFAULT_LANE; }

/** The lattice for an area: centre x, column count, and the sway amplitude that keeps every cell inside the lane. */
export function latticeFor(areaId: string): { cx: number; cols: number; amp: number } {
  const [l, r] = laneOf(areaId); const w = r - l;
  let cols = MAX_COLS;
  while (cols > 4 && (cols - 1) * COL_SP + CAT_W + 4 > w) cols--;
  const amp = Math.max(0, Math.min(6, Math.floor((w - ((cols - 1) * COL_SP + CAT_W)) / 2) - 2));
  return { cx: Math.round((l + r) / 2), cols, amp };
}

export type Shape = 'galaga' | 'chevron' | 'wings' | 'barrel' | 'block' | 'arrow';

/** Column offsets (in COL_SP units from the centre) of the full lattice row of M columns. */
export function columns(M: number): number[] { return Array.from({ length: M }, (_, i) => i - (M - 1) / 2); }

/** n cells of one row, centred on the M-column lattice (if n and M differ in parity the row leans half a cell). */
export function line(n: number, M: number, lean = 1): number[] {
  const all = columns(M); n = Math.max(0, Math.min(M, n));
  let a = Math.floor((M - n) / 2);
  if ((M - n) % 2 && lean > 0) a++;
  return all.slice(a, a + n);
}

/** Row widths of a shape for M columns and R rows. */
function widths(shape: Exclude<Shape, 'wings'>, M: number, R: number): number[] {
  const c = (n: number) => Math.max(2, Math.min(M, n));
  const out: number[] = [];
  for (let i = 0; i < R; i++) {
    switch (shape) {
      case 'galaga': out.push(i === 0 ? c(4) : i === 1 ? c(M - 2) : M); break;          // bosses, butterflies, bees
      case 'chevron': out.push(c(M - 2 * Math.max(0, (R >= 4 ? 3 : 2) - i))); break;     // a wedge, point at the top
      case 'barrel': out.push(i === 0 || i === R - 1 ? c(M - 2) : M); break;
      case 'block': out.push(M); break;
      case 'arrow': out.push(i === 0 ? 2 : i === 1 ? c(M - 2) : M); break;
    }
  }
  return out;
}

/** Rows of a shape for a formation of R rows (3..5) on an M-column lattice. */
export function shapeRows(shape: Shape, R: number, M = MAX_COLS): number[][] {
  const r = Math.max(3, Math.min(MAX_ROWS, R));
  if (shape === 'wings') { // two wing blocks with an open lane down the middle and the leaders riding over the gap
    const all = columns(M); const gap = M % 2 ? 1 : 2; const a = (M - gap) / 2;
    const wing = all.filter((_, i) => i < a || i >= a + gap);
    return Array.from({ length: r }, (_, i) => (i === 0 ? line(M >= 8 ? 4 : 2, M) : wing));
  }
  return widths(shape, M, r).map(n => line(n, M));
}
const capacity = (shape: Shape, R: number, M: number) => shapeRows(shape, R, M).reduce((a, r) => a + r.length, 0);

/** Per sector: the shapes its waves cycle through (index = area order). */
const SECTOR_SHAPES: Shape[][] = [
  ['galaga', 'block', 'barrel'],    // backyard
  ['chevron', 'galaga'],            // street
  ['wings', 'galaga', 'barrel'],    // park
  ['block', 'barrel'],              // alley
  ['block', 'wings'],               // rooftops
  ['arrow', 'barrel', 'galaga'],    // cafe
  ['chevron', 'block'],             // docks
  ['block', 'galaga', 'barrel'],    // factory
  ['barrel', 'block'],              // sky
  ['galaga', 'block', 'barrel'],    // moon
  ['block', 'arrow'],               // nebula
  ['block', 'barrel', 'galaga'],    // station
  ['galaga', 'block', 'barrel'],    // mothership
];
export function shapeFor(areaIdx: number, waveIdx: number): Shape {
  const list = SECTOR_SHAPES[Math.max(0, areaIdx) % SECTOR_SHAPES.length];
  return list[waveIdx % list.length];
}

export interface Home { def: EnemyDef; u: number; row: number }

/**
 * Lay out a wave: content gives breeds per row (top first); the shape gives the cells. Capturers lead (top rows),
 * then the content's rows in order. A full row hands its cells out centre-out or edge-in (alternating per wave, so
 * the breeds sit differently); a partial row (the end of the queue) packs side by side in the middle.
 * Cats beyond capacity are left out. Every (row, u) is handed out at most once.
 */
export function layout(w: WaveDef, shape: Shape, waveIdx: number, enemy: (id: string) => EnemyDef, cap = 99, M = MAX_COLS): Home[] {
  const groups = [...w.cats].sort((a, b) => a.row - b.row);
  const lead: EnemyDef[] = [], rest: EnemyDef[] = [];
  for (const g of groups) {
    const def = enemy(g.breed); const n = (g.cols ?? Array.from({ length: w.formation.cols }, (_, k) => k)).length;
    for (let k = 0; k < n; k++) (def.behavior === 'capturer' ? lead : rest).push(def);
  }
  const queue = [...lead.slice(0, 4), ...rest].slice(0, Math.max(2, cap));
  let R = 3; while (R < MAX_ROWS && capacity(shape, R, M) < queue.length) R++;
  const rows = shapeRows(shape, R, M); const out: Home[] = [];
  const edgeIn = waveIdx % 2 === 1;
  rows.forEach((us, ri) => {
    const take = Math.min(us.length, queue.length);
    if (!take) return;
    const cells = take === us.length ? us : line(take, M);
    const order = [...cells].sort((a, b) => edgeIn ? Math.abs(b) - Math.abs(a) || a - b : Math.abs(a) - Math.abs(b) || a - b);
    for (const u of order) out.push({ def: queue.shift()!, u, row: ri });
  });
  return out;
}

/** True when no two homes share a cell (the lattice invariant). */
export function cellsUnique(cells: { row: number; u: number }[]): boolean {
  const seen = new Set<string>();
  for (const c of cells) { const k = c.row + ':' + c.u; if (seen.has(k)) return false; seen.add(k); }
  return true;
}

/**
 * Close empty rows: when a whole row has been booped, every row below it moves up one row (columns never change,
 * rows keep their order), so the rack never shows a detached row under an empty gap. Returns the new row per input.
 */
export function closeRows(rows: number[]): number[] {
  const used = [...new Set(rows)].sort((a, b) => a - b);
  const map = new Map(used.map((r, i) => [r, i]));
  return rows.map(r => map.get(r)!);
}
