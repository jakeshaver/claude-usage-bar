// Flight paths in world coordinates (world is 448 wide, formation sits at y ~46..160).
// Control points are smoothed with Catmull-Rom and re-parameterized by arc length (Track), so cats fly
// at a constant, readable speed through curves instead of speeding up on long segments.
export type Pt = [number, number];
export const CX = 224;
const TAU = Math.PI * 2;

/** Points along a circular arc (screen coords: y down, angle grows clockwise on screen). Excludes a0. */
export function arc(cx: number, cy: number, r: number, a0: number, a1: number, step = Math.PI / 6): Pt[] {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / step)); const out: Pt[] = [];
  for (let i = 1; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return out;
}
const mir = (s: number) => (p: Pt): Pt => (s < 0 ? [448 - p[0], p[1]] : p);

export interface TrackPos { x: number; y: number; hx: number; hy: number }

/** Arc-length parameterized smooth curve. */
export class Track {
  xs: number[] = []; ys: number[] = []; ls: number[] = []; len = 0;
  constructor(pts: Pt[], res = 10) {
    if (pts.length < 2) pts = [pts[0] ?? [0, 0], pts[0] ?? [0, 0]];
    const n = pts.length - 1;
    for (let i = 0; i < n; i++) for (let k = 0; k < res; k++) { const p = cr(pts, i, k / res); this.push(p[0], p[1]); }
    this.push(pts[n][0], pts[n][1]);
  }
  private push(x: number, y: number) {
    const i = this.xs.length;
    if (i) this.len += Math.hypot(x - this.xs[i - 1], y - this.ys[i - 1]);
    this.xs.push(x); this.ys.push(y); this.ls.push(this.len);
  }
  /** Position at distance s along the track, written into o (x, y and unit heading hx, hy). */
  at(s: number, o: TrackPos): TrackPos {
    const ls = this.ls; const n = ls.length - 1;
    if (s <= 0) s = 0; if (s >= this.len) s = this.len;
    let lo = 0, hi = n;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ls[m] <= s) lo = m; else hi = m; }
    const seg = ls[hi] - ls[lo] || 1; const t = (s - ls[lo]) / seg;
    o.x = this.xs[lo] + (this.xs[hi] - this.xs[lo]) * t; o.y = this.ys[lo] + (this.ys[hi] - this.ys[lo]) * t;
    const hx = this.xs[hi] - this.xs[lo], hy = this.ys[hi] - this.ys[lo]; const hl = Math.hypot(hx, hy) || 1;
    o.hx = hx / hl; o.hy = hy / hl;
    return o;
  }
}
function cr(pts: Pt[], i: number, t: number): Pt {
  const n = pts.length - 1;
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
  const f = (a: number, b: number, c: number, d: number) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])];
}

/**
 * Entry choreography, Galaga style. `side` +1 enters from the left, -1 is the mirror image. `below` is a y just under
 * the whole rack: every stream loops and weaves in the open field below the rack (or comes down the side gutters
 * outside it), never across parked cats, then swings under its own column and rises straight up into its cell.
 * The caller orders arrivals so a column fills top cell first: the climb only ever passes empty cells.
 */
export function entryPath(kind: string, side: number, slot: Pt, below = slot[1] + 40, gutter = 999): Pt[] {
  const b = Math.round(below);
  let pts = entryCurve(kind, side, slot, b);
  // `gutter`: the furthest-in x (in the unmirrored, enter-from-the-left frame) the curve may end at, so it always
  // finishes outside the rack's outermost column on its side, even on lanes that sit off centre
  if (pts.length > 2) {
    const endX = side < 0 ? 448 - pts[pts.length - 2][0] : pts[pts.length - 2][0];
    const dx = Math.min(0, gutter - endX) * (side < 0 ? -1 : 1);
    if (dx) pts = pts.map((p, i) => (i < pts.length - 1 ? [p[0] + dx, p[1]] as Pt : p));
  }
  if (pts.length <= 2) return pts;
  // every curve ends in the side gutter heading in: run along one shared approach line under the rack, turn up under
  // the cat's own column and rise into the cell (the cat ahead has already turned up when the next one passes below)
  const last = pts[pts.length - 2]; const dir = slot[0] >= last[0] ? 1 : -1;
  return [...pts.slice(0, -1), [slot[0] - 26 * dir, b + 12], [slot[0], b - 6], slot];
}
function entryCurve(kind: string, side: number, slot: Pt, b: number): Pt[] {
  const m = mir(side);
  switch (kind) {
    case 'swirl-left': case 'swirl-right': {
      // sweeps in from the side edge, curls down the gutter and turns in under the rack
      const y0 = kind === 'swirl-left' ? 52 : 104;
      const pts: Pt[] = [[-28, y0], [22, y0 + 18], [40, Math.max(y0 + 50, b - 24)], [62, b + 12]];
      return [...pts.map(m), slot];
    }
    case 'split': {
      // pours down the gutter, dips deep under the rack and swings back up into the approach line
      const pts: Pt[] = [[44, -28], [36, b - 16], [44, b + 46], [76, b + 52]];
      return [...pts.map(m), slot];
    }
    case 'rain': {
      // rains straight down the side gutter from the top and hooks in
      const pts: Pt[] = [[54, -28], [50, 80], [52, b - 14], [72, b + 12]];
      return [...pts.map(m), slot];
    }
    case 'loop': {
      // in low from the side edge, a J-hook that climbs into the approach line
      const pts: Pt[] = [[-28, b + 66], [28, b + 62], [58, b + 40], [66, b + 14]];
      return [...pts.map(m), slot];
    }
    case 'convoy': {
      // a single-file snake weaving in along the bottom of the field, right up to its own column
      const tx = (side < 0 ? 448 - slot[0] : slot[0]) - 46; const pts: Pt[] = [[-28, b + 30]];
      for (let x = 12, k = 0; x < tx; x += 50, k++) pts.push([x, k % 2 ? b + 20 : b + 42]);
      return [...pts.map(m), slot];
    }
    case 'flank': {
      // two squadrons sweep in low from both sides at once and curl up into their own halves of the rack
      const pts: Pt[] = [[-28, b + 96], [22, b + 84], [54, b + 50], [70, b + 14]];
      return [...pts.map(m), slot];
    }
    case 'escort': {
      // trios (a leader, two wingmen on its tail) sweep in from the side edge in a long shallow glide
      const pts: Pt[] = [[-28, b + 30], [40, b + 20], [74, b + 12]];
      return [...pts.map(m), slot];
    }
    case 'drop': // straight down the cat's own column (the rack fills bottom row first, so it only passes empty cells)
    default: return [[slot[0], -40], slot];
  }
}

/**
 * Dive attack path. Peels out of the formation with an outward half loop, then swoops at the player.
 * Diver breeds add a full loop-de-loop mid-screen; basic cats curl back up (Galaga bees).
 * Paths end off screen (below or above); the cat then re-enters from the top and homes to its slot.
 */
export function divePath(x0: number, y0: number, px: number, behavior: string, j: number, H: number, side = 0, exit?: Pt[]): Pt[] {
  const s = side || (x0 < CX ? -1 : 1); // peel toward the open side (default: the nearest edge)
  // a tight half loop: half a row up, one column over, then down that column (the caller picks a side whose column
  // and the cell above are empty, so the peel never crosses a parked neighbour). `exit` replaces it: the caller's own
  // route out of the rack (peel, then straight down the empty column to the open field under the rack)
  const peel: Pt[] = exit ?? [[x0, y0], [x0 + 10 * s, y0 - 12], [x0 + 26 * s, y0 - 16], [x0 + 36 * s, y0 - 4], [x0 + 32 * s, y0 + 22]];
  const lx = Math.max(60, Math.min(388, px));
  let rest: Pt[];
  switch (behavior) {
    case 'diver': {
      // swoop inward, a full loop-de-loop turning toward the middle, then a fast strike at the player
      const cx = Math.max(100, Math.min(348, (x0 + lx) / 2 + 24 * s));
      const a1 = -Math.PI / 2 + (s < 0 ? TAU : -TAU);
      rest = [[cx + 40 * s, 128], [cx, 140], ...arc(cx, 176, 36, -Math.PI / 2, a1), [cx - 30 * s, 168], [lx + j * 20, 256], [lx - 30 * s, 320], [lx - 60 * s, H + 40]];
      break;
    }
    case 'shooter': // shallow strafing pass: swoop down, curve across in front of Pom, then drop off the bottom
      // (never a long sideways exit along the screen edge, which reads as a straggler outside the lanes)
      rest = [[(x0 + lx) / 2, 150], [lx + 40 * s, 200], [lx - 40 * s, 214], [lx - 90 * s, 252], [lx - 110 * s, H + 40]]; break;
    case 'tank': // slow, heavy, nearly straight dive
      rest = [[(x0 * 2 + lx) / 3, 160], [lx + j * 30, 270], [lx + j * 40, H + 40]]; break;
    case 'capturer': // wide swoop with a lazy turn near the bottom, escorts in tow
      rest = [[lx + 50 * s, 170], [lx, 246], [lx - 50 * s, 280], [lx - 90 * s, 246], [lx - 70 * s, 200], [lx - 20 * s, 228], [lx + 10 * s, H + 40]]; break;
    case 'zigzag': // straight line, the weave is added on top while flying
      rest = [[(x0 + lx) / 2, 150], [lx, 240], [lx - 20 * s, H + 40]]; break;
    default: // basic: swoop at the player, hook past it and off the bottom (it drops back in above its slot)
      rest = [[(x0 + lx) / 2 + 20 * s, 160], [lx + j * 24, 250], [lx - 40 * s, 290], [lx - 80 * s, 296], [lx - 104 * s, H + 40]];
  }
  if (exit) { // the attack runs entirely below the rack: squash it into the field between the exit and the bottom
    const top = exit[exit.length - 1][1] + 18; const on = rest.filter(p => p[1] < H);
    const minY = Math.min(...on.map(p => p[1]));
    if (on.length && minY < top) rest = rest.map(p => (p[1] < H ? [p[0], top + (p[1] - minY) * (H - top) / (H - minY)] as Pt : p));
  }
  return [...peel, ...rest];
}

/** Treat Bonanza fly-by paths (no shooting: pure flying show). */
export function bonusPath(pattern: string, group: number): Pt[] {
  const m = mir(group % 2 ? -1 : 1);
  switch (pattern) {
    case 'figure8': return [m([-30, 80]), m([120, 140]), m([224, 200]), m([330, 140]), m([224, 80]), m([120, 140]), m([224, 260]), m([330, 300]), m([480, 260])];
    case 'cross': return [m([-30, 40]), m([120, 120]), m([224, 180]), m([330, 250]), m([480, 330])];
    case 'spiral': return [m([224, -30]), m([330, 120]), m([224, 220]), m([130, 140]), m([200, 90]), m([260, 160]), m([224, 200]), m([-40, 330])];
    default: return [m([-30, 60]), m([80, 160]), m([160, 60]), m([240, 160]), m([320, 60]), m([400, 160]), m([480, 60])];
  }
}

/** Legacy helpers (kept for compatibility). */
export function sample(pts: Pt[], u: number): Pt {
  const n = pts.length - 1; const f = Math.min(n - 1e-6, Math.max(0, u * n)); const i = Math.floor(f);
  return cr(pts, i, f - i);
}
export function pathLen(pts: Pt[]): number { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; }
