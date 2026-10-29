// Formation layouts, Galaga style: ONE fixed lattice per wave. Every cat owns one cell for the whole wave (it enters
// into it, dives from it and returns to it); cells never move sideways, so the rack always reads as a grid with holes.
// The lattice is centred on the area's lane (not on the camera) and is never wider than the lane allows:
// cols = how many COL_SP cells (plus the sway) fit between the lane's walls, at most MAX_COLS. The pitch never shrinks
// to fit more cats: a narrow lane gets fewer columns, and cats that do not fit with air wait as reinforcements.
import type { EnemyDef, WaveDef } from '../core/types';

export const COL_SP = 40;     // cats are 28px wide opaque (32px sprite): 12px of air between neighbours (8px sprite to sprite)
export const ROW_SP = 34;     // cats are 28px tall opaque: 6px of air between rows (the rack reads as a lattice, not a blob)
export const MAX_COLS = 7;
export const MAX_ROWS = 4;
/** At most this many cats parked on screen at once (Galaga's rack is 40, but ours has wider air): a bigger wave keeps
 *  its extras off stage as reinforcements, so even the late sectors read as 20-24 cats, never an overstuffed wall. */
export const ON_CAP = 24;    // four rows: the rack's bottom row stays well above Pom's flight band (y >= 196)
const CAT_W = 28;

/** Lane walls per area (world x, the playfield is 448 wide): buildings, rails, conduits the rack must stay inside. */
const LANES: Record<string, [number, number]> = {
  street: [112, 336],     // the road between the curbs (x 120-327): the rack never hangs over the sidewalks or houses
  alley: [98, 350],       // the drawn drainpipes (x ~93-97 left, ~350 right), not the brick behind them
  cafe: [80, 382],        // window wall left, pendant windows right
  docks: [104, 400],      // boardwalk on the left
  factory: [70, 374],     // pipe wall left, catwalk right
  mothership: [128, 320], // yarn cable (x 113-123) and the grey conduit (x 326-338): a still 6-wide rack
};
const DEFAULT_LANE: [number, number] = [64, 384];
export function laneOf(areaId: string): [number, number] { return LANES[areaId] ?? DEFAULT_LANE; }

/** Air kept between the outermost cat (at the far end of its sway) and the lane wall. */
export const WALL_GAP = 16;
/** Side-gutter entry streams run down the lane at wall + GUTTER (a stream cat's sprite stays inside the lane), and the
 *  rack leaves them room: its outer column never comes within a sprite of the gutter line. */
export const GUTTER = 18;
/** Column pitch for a wave whose widest breed is `w` px wide (opaque): at least COL_SP, and always 10px of air between
 *  two neighbours of that breed (a 1px rim on each side included), so maine coons and folds never touch. */
export function pitchFor(w: number): number { return Math.max(COL_SP, Math.ceil((w + 12) / 2) * 2); }
/** The lattice for an area: centre x, column count, and the sway amplitude that keeps every cell inside the lane
 *  with WALL_GAP px of air, so even a partly cleared grid swaying to its far side never touches a wall. Lanes wide
 *  enough keep a side gutter free for the entry streams (`gutter`); narrow lanes (street, alley, mothership) fly
 *  their entries from above or below the rack instead. The pitch never shrinks: wider cells mean fewer columns. */
export function latticeFor(areaId: string, pitch = COL_SP): { cx: number; cols: number; amp: number; gutter: boolean } {
  const [l, r] = laneOf(areaId); const w = r - l; const cx = Math.round((l + r) / 2);
  for (let cols = MAX_COLS; cols >= 5; cols--) {
    const slack = Math.floor(w / 2 - GUTTER - CAT_W / 2 - ((cols - 1) * pitch) / 2 - CAT_W / 2);
    if (slack >= 4) return { cx, cols, amp: Math.min(6, slack - 2), gutter: true };
  }
  let cols = MAX_COLS;
  while (cols > 4 && (cols - 1) * pitch + CAT_W + 2 * WALL_GAP > w) cols--;
  const amp = Math.max(0, Math.min(6, Math.floor((w - ((cols - 1) * pitch + CAT_W)) / 2) - WALL_GAP));
  return { cx, cols, amp, gutter: false };
}

export type Shape = 'galaga' | 'chevron' | 'wings' | 'barrel' | 'block' | 'arrow' | 'diamond' | 'vee' | 'flanks' | 'pillars' | 'checker' | 'squads';

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
function widths(shape: 'galaga' | 'chevron' | 'barrel' | 'block' | 'arrow' | 'diamond' | 'vee', M: number, R: number): number[] {
  const c = (n: number) => Math.max(2, Math.min(M, n));
  const out: number[] = [];
  for (let i = 0; i < R; i++) {
    switch (shape) {
      case 'galaga': out.push(i === 0 ? c(M >= 7 ? 4 : 2) : i === 1 ? c(M - 2) : M); break;   // bosses, butterflies, bees
      case 'chevron': out.push(c(M - 2 * Math.max(0, (R >= 4 ? 3 : 2) - i))); break;     // a wedge, point at the top
      case 'barrel': out.push(i === 0 || i === R - 1 ? c(M - 2) : M); break;
      case 'block': out.push(M); break;
      case 'arrow': out.push(i === 0 ? (M % 2 ? 1 : 2) : i === 1 ? c(M - 2) : M); break;
      case 'diamond': out.push(c(M - 2 * Math.ceil(Math.abs(i - (R - 1) / 2)))); break; // widest in the middle
      case 'vee': out.push(c(M - 2 * Math.max(0, i - (R >= 5 ? 1 : 0)))); break;          // a wedge, point at the bottom
    }
  }
  return out;
}

/** Rows of a shape for a formation of R rows (3..MAX_ROWS) on an M-column lattice. Offsets may be half cells
 *  (checker, squads): such a row sits between the columns of its neighbours, a full row pitch above or below them. */
export function shapeRows(shape: Shape, R: number, M = MAX_COLS): number[][] {
  const r = Math.max(3, Math.min(MAX_ROWS, R));
  if (shape === 'wings') { // two wing blocks with an open lane down the middle and the leaders riding over the gap
    const all = columns(M); const gap = M % 2 ? 1 : 2; const a = (M - gap) / 2;
    const wing = all.filter((_, i) => i < a || i >= a + gap);
    return Array.from({ length: r }, (_, i) => (i === 0 ? line(M % 2 ? 3 : M >= 8 ? 4 : 2, M) : wing));
  }
  if (shape === 'flanks') { // two mirrored squadrons, an open channel down the middle
    const all = columns(M); const k = Math.max(2, Math.floor((M - 1) / 2));
    const left = all.slice(0, k), right = all.slice(M - k);
    return Array.from({ length: r }, () => [...left, ...right]);
  }
  if (shape === 'pillars') { // columns with an empty column between them (they drop in from above)
    const all = columns(M);
    const keep = all.filter((_, i) => M % 2 ? i % 2 === 0 : M % 3 === 0 ? i % 3 !== 1 : i < 2 || i >= M - 2);
    return Array.from({ length: r }, () => keep);
  }
  if (shape === 'checker') { // staggered rows: every other row sits half a cell over, between the columns above it
    return Array.from({ length: r }, (_, i) => (i % 2 ? columns(M - 1) : columns(M)));
  }
  if (shape === 'squads') { // 2x2 squadrons: a top line of squadrons, a second line in the gaps between them
    const k = M >= 7 ? 3 : 2; const span = (M - 2) / 2;
    const top = Array.from({ length: k }, (_, i) => -span + (2 * span * i) / (k - 1));
    const low = top.slice(1).map((x, i) => (x + top[i]) / 2);
    const cells = (cs: number[]) => cs.flatMap(x => [x - 0.5, x + 0.5]);
    return Array.from({ length: r }, (_, i) => cells(i < 2 ? top : low));
  }
  return widths(shape, M, r).map(n => line(n, M));
}
const capacity = (shape: Shape, R: number, M: number) => shapeRows(shape, R, M).reduce((a, r) => a + r.length, 0);

/**
 * Every formation silhouette, in the order a sector walks them (one step per wave, from its own start), so a 10-wave
 * sector shows every one of them. The four lattice-like blocks (galaga, block, barrel, arrow all read as a 3-4 row
 * rectangle on screen) sit at ring positions 0, 2, 5, 7: never next to each other, also around the wrap, so two
 * consecutive waves are never both a plain block. Deterministic: wavePreview and startWave always agree.
 */
export const SHAPES: Shape[] = ['galaga', 'flanks', 'block', 'vee', 'diamond', 'barrel', 'pillars', 'arrow', 'wings', 'chevron'];
/** Narrow lanes (5 columns or fewer: street, alley, mothership) would collapse wings / flanks / pillars / block into
 *  the same little rectangle: they walk their own ring of shapes that read on a narrow lattice. */
export const NARROW_SHAPES: Shape[] = ['chevron', 'checker', 'diamond', 'squads', 'vee', 'galaga', 'wings', 'arrow'];
/** Shapes that read as the same rectangular rack on screen. */
export const LATTICE_FAMILY = new Set<Shape>(['galaga', 'block', 'barrel', 'arrow']);
export function shapeFor(areaIdx: number, waveIdx: number, cols = MAX_COLS): Shape {
  const ring = cols <= 5 ? NARROW_SHAPES : SHAPES;
  return ring[(Math.max(0, areaIdx) * 3 + waveIdx) % ring.length];
}

/** Entry choreographies: the content's five, plus convoy (two snakes), drop (columns fall in), flank (two squadrons
 *  sweep in from the sides) and escort (tight trios, Galaga's challenging-stage look), plus one signature entry per
 *  sector (SIGNATURES). */
export type Entry = 'swirl-left' | 'swirl-right' | 'split' | 'rain' | 'loop' | 'convoy' | 'drop' | 'flank' | 'escort'
  | 'ambush' | 'frisbee' | 'popout' | 'swoop' | 'conga' | 'tide' | 'conveyor' | 'cloudloop' | 'float' | 'zigzag' | 'orbit';
/**
 * Sector signatures: each sector flies one entry of its own on its signature waves (SIG_WAVES), so the middle of the
 * campaign never feels like the same wave again. street: a mailbox ambush (whole columns slam down one after another);
 * park: frisbee arcs over the top; alley: cats pop out of the side walls row by row; rooftops: a water-tower swoop;
 * cafe: one long conga line; docks: rolling tide streams and a rack that bobs like moored boats; factory: a conveyor
 * belt along the bottom; sky: loop-the-loops through the clouds; moon: a slow floaty drift down (and floaty dives all
 * sector long); nebula: zigzag drifts down the gutters; station: an orbiting ring; mothership: every signature remixed.
 */
export const SIGNATURES: Record<string, Entry> = {
  street: 'ambush', park: 'frisbee', alley: 'popout', rooftops: 'swoop', cafe: 'conga', docks: 'tide', factory: 'conveyor',
  sky: 'cloudloop', moon: 'float', nebula: 'zigzag', station: 'orbit',
};
/** The mothership's narrow hall has no side gutters: its remix flies the signatures that come in from above, the
 *  sides of a row, or the open field below the rack. */
const REMIX: Entry[] = ['popout', 'tide', 'ambush', 'frisbee', 'conga', 'float', 'conveyor', 'cloudloop', 'orbit', 'zigzag', 'swoop'];
/** Entries that run down a side gutter: what a gutterless (narrow) lane flies instead. */
export const NO_GUTTER: Partial<Record<Entry, Entry>> = { 'swirl-left': 'loop', 'swirl-right': 'escort', split: 'flank', rain: 'drop', zigzag: 'convoy', orbit: 'tide', swoop: 'conveyor', cloudloop: 'convoy' };
/** The signature entry of wave i in an area, or null. Two signature waves per sector (the 3rd and the 7th), every
 *  other wave on the mothership. */
export function signatureFor(areaId: string | undefined, waveIdx: number): Entry | null {
  if (!areaId) return null;
  if (areaId === 'mothership') return waveIdx % 2 === 1 ? REMIX[(waveIdx >> 1) % REMIX.length] : null;
  const s = SIGNATURES[areaId];
  return s && (waveIdx === 2 || waveIdx === 6) ? s : null;
}
/** The entry a wave flies: a signature wave flies its sector's signature; else the shape picks its natural one
 *  (pillars drop, flanks sweep in), otherwise every third wave is a convoy or an escort run, else the content's own
 *  entry. Consecutive waves never share an entry. */
export function entryFor(areaIdx: number, waveIdx: number, entries: string[], areaId?: string, cols = MAX_COLS): Entry {
  // a narrow lane has no side gutter: the gutter runs come in from below the rack (or straight down) instead
  const gut = areaId ? latticeFor(areaId).gutter : true;
  const pick = (i: number): Entry => {
    const sig = signatureFor(areaId, i); if (sig) return sig;
    const sh = shapeFor(areaIdx, i, cols);
    if (sh === 'pillars') return 'drop';
    if (sh === 'flanks') return 'flank';
    if ((i + areaIdx) % 3 === 1) return (i >> 1) % 2 ? 'escort' : 'convoy';
    const e = (entries[i] ?? 'swirl-left') as Entry;
    return gut ? e : NO_GUTTER[e] ?? e;
  };
  const ALT: Entry[] = gut ? ['loop', 'split', 'swirl-left', 'rain'] : ['loop', 'convoy', 'flank', 'escort'];
  let prev: Entry | null = null;
  for (let j = 0; j <= waveIdx; j++) {
    let e = pick(j);
    if (e === prev) { const next = pick(j + 1); e = ALT.find(a => a !== prev && a !== next) ?? e; }
    prev = e;
  }
  return prev!;
}

export interface Home { def: EnemyDef; u: number; row: number }
export interface Plan { homes: Home[]; reserve: EnemyDef[]; cells: { row: number; u: number }[]; cols: number; rows: number }

/**
 * Lay out a wave: content gives breeds per row (top first); the shape gives the cells. Capturers lead (top rows),
 * then the content's rows in order. A full row hands its cells out centre-out or edge-in (alternating per wave, so
 * the breeds sit differently); a partial row (the end of the queue) packs side by side in the middle (mirrored pairs
 * in gapped shapes). The rack never holds more than its cells: cats beyond capacity wait in `reserve` and fly in as
 * reinforcements once holes open (never overpacked). Every (row, u) is handed out at most once.
 */
export function plan(w: WaveDef, shape: Shape, waveIdx: number, enemy: (id: string) => EnemyDef, cap = 99, M = MAX_COLS): Plan {
  const groups = [...w.cats].sort((a, b) => a.row - b.row);
  const lead: EnemyDef[] = [], rest: EnemyDef[] = [];
  for (const g of groups) {
    const def = enemy(g.breed); const n = (g.cols ?? Array.from({ length: w.formation.cols }, (_, k) => k)).length;
    for (let k = 0; k < n; k++) (def.behavior === 'capturer' ? lead : rest).push(def);
  }
  const queue = [...lead.slice(0, 4), ...rest].slice(0, Math.max(2, cap));
  const onN = Math.min(queue.length, ON_CAP);
  let R = shape === 'diamond' ? 4 : 3; while (R < MAX_ROWS && capacity(shape, R, M) < onN) R++;
  // the silhouette shapes fit snugly (a narrower or deeper lattice), so a wave that would only fill the top rows of a
  // wide vee or diamond still shows its outline instead of collapsing into a plain block
  if (!LATTICE_FAMILY.has(shape)) {
    let best = { w: capacity(shape, R, M) - onN, m: M, r: R };
    if (best.w < 0) best.w = 1e9;
    const mMin = Math.max(shape === 'flanks' ? 5 : 4, M - 2);
    for (let m = M; m >= mMin; m--) for (let r = shape === 'diamond' ? 4 : 3; r <= MAX_ROWS; r++) {
      const w = capacity(shape, r, m) - onN;
      if (w >= 0 && w < best.w) best = { w, m, r };
    }
    if (best.w < 1e9) { M = best.m; R = best.r; }
  }
  const rows = shapeRows(shape, R, M); const out: Home[] = [];
  const cells = rows.flatMap((us, row) => us.map(u => ({ row, u })));
  // reinforcements: what does not fit waits (at most one more rackful, so a wave never drags on)
  const room = Math.min(cells.length, onN);
  const reserve = queue.splice(room).slice(0, Math.max(4, room));
  const edgeIn = waveIdx % 2 === 1;
  const gapped = shape === 'wings' || shape === 'flanks' || shape === 'pillars' || shape === 'squads' || shape === 'checker';
  rows.forEach((us, ri) => {
    let take = Math.min(us.length, queue.length);
    // a gapped shape stays mirrored: an odd cat left over for a partial row waits as a reinforcement
    if (gapped && take < us.length && take % 2 && us.length % 2 === 0) { reserve.unshift(queue.pop()!); take--; }
    if (!take) return;
    // a partial row packs into the middle, except in gapped shapes, where it keeps the shape's own cells nearest the
    // centre in mirrored pairs (never a lopsided row)
    const pick = take === us.length ? us : gapped ? [...us].sort((a, b) => Math.abs(a) - Math.abs(b) || a - b).slice(0, take) : line(take, M);
    const order = [...pick].sort((a, b) => edgeIn ? Math.abs(b) - Math.abs(a) || a - b : Math.abs(a) - Math.abs(b) || a - b);
    for (const u of order) out.push({ def: queue.shift()!, u, row: ri });
  });
  return { homes: out, reserve, cells, cols: M, rows: R };
}
export function layout(w: WaveDef, shape: Shape, waveIdx: number, enemy: (id: string) => EnemyDef, cap = 99, M = MAX_COLS): Home[] {
  return plan(w, shape, waveIdx, enemy, cap, M).homes;
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
