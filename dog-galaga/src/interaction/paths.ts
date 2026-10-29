// Flight paths in world coordinates (world is 448 wide, formation sits at y 44..140).
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
 * Entry choreography, Galaga style. `side` +1 enters from the left, -1 is the mirror image.
 * The path ends at `slot` (the cat's formation home); the cat then homes onto the live, swaying slot.
 */
export function entryPath(kind: string, side: number, slot: Pt): Pt[] {
  const pts = entryCurve(kind, side, slot);
  if (pts.length <= 2) return pts;
  // finish every stream by swinging under the cat's own column and rising straight into its cell: the formation fills
  // top row first, so the climb only passes empty cells and never cuts through cats already parked
  const last = pts[pts.length - 2];
  const under: Pt = [slot[0], Math.max(slot[1] + 44, Math.min(236, last[1]))];
  return [...pts.slice(0, -1), [(last[0] + slot[0]) / 2, under[1] + 6], under, slot];
}
function entryCurve(kind: string, side: number, slot: Pt): Pt[] {
  const m = mir(side);
  switch (kind) {
    case 'swirl-left': case 'swirl-right': {
      // low in from the side, swing up and around a circle, then rise into the slot
      const mm = mir(kind === 'swirl-left' ? side : -side);
      const pts: Pt[] = [[-28, 300], [40, 270], [110, 248], ...arc(150, 192, 56, Math.PI / 2, -Math.PI * 0.55)];
      return [...pts.map(mm), slot];
    }
    case 'split': {
      // two streams drop in from the top and CROSS at the center, each loops outward and climbs home
      const pts: Pt[] = [[CX + 56, -28], [CX + 20, 40], [CX - 30, 110], [CX - 84, 170], ...arc(CX - 112, 142, 40, Math.PI / 4, Math.PI * 1.55)];
      return [...pts.map(m), slot];
    }
    case 'rain': {
      // two mirrored streams pour straight down the middle, fan out wide and hook back up into place
      const pts: Pt[] = [[CX - 36, -28], [CX - 42, 60], [CX - 60, 140], [CX - 104, 192], [CX - 156, 186], [CX - 176, 140]];
      return [...pts.map(m), slot];
    }
    case 'loop': {
      // in from the side at mid height, a full loop-de-loop, then up into the slot
      const pts: Pt[] = [[-28, 120], [50, 132], [120, 138], ...arc(140, 186, 48, -Math.PI / 2, Math.PI * 1.5), [196, 128]];
      return [...pts.map(m), slot];
    }
    default: return [[slot[0], -40], slot];
  }
}

/**
 * Dive attack path. Peels out of the formation with an outward half loop, then swoops at the player.
 * Diver breeds add a full loop-de-loop mid-screen; basic cats curl back up (Galaga bees).
 * Paths end off screen (below or above); the cat then re-enters from the top and homes to its slot.
 */
export function divePath(x0: number, y0: number, px: number, behavior: string, j: number, H: number): Pt[] {
  const s = x0 < CX ? -1 : 1; // peel toward the nearest edge
  const peel: Pt[] = [[x0, y0], [x0 + 10 * s, y0 - 18], [x0 + 30 * s, y0 - 24], [x0 + 44 * s, y0 - 6], [x0 + 40 * s, y0 + 22]];
  const lx = Math.max(60, Math.min(388, px));
  switch (behavior) {
    case 'diver': {
      // swoop inward, a full loop-de-loop turning toward the middle, then a fast strike at the player
      const cx = Math.max(100, Math.min(348, (x0 + lx) / 2 + 24 * s));
      const a1 = -Math.PI / 2 + (s < 0 ? TAU : -TAU);
      return [...peel, [cx + 40 * s, 128], [cx, 140], ...arc(cx, 176, 36, -Math.PI / 2, a1), [cx - 30 * s, 168], [lx + j * 20, 256], [lx - 30 * s, 320], [lx - 60 * s, H + 40]];
    }
    case 'shooter': // shallow strafing pass: swoop down, curve across, climb out
      return [...peel, [(x0 + lx) / 2, 150], [lx + 40 * s, 196], [lx - 50 * s, 206], [lx - 120 * s, 150], [lx - 150 * s, 40], [lx - 160 * s, -40]];
    case 'tank': // slow, heavy, nearly straight dive
      return [...peel, [(x0 * 2 + lx) / 3, 160], [lx + j * 30, 270], [lx + j * 40, H + 40]];
    case 'capturer': // wide swoop with a lazy turn near the bottom, escorts in tow
      return [...peel, [lx + 50 * s, 170], [lx, 246], [lx - 50 * s, 280], [lx - 90 * s, 246], [lx - 70 * s, 200], [lx - 20 * s, 228], [lx + 10 * s, H + 40]];
    case 'zigzag': // straight line, the weave is added on top while flying
      return [...peel, [(x0 + lx) / 2, 150], [lx, 240], [lx - 20 * s, H + 40]];
    default: // basic: swoop at the player then curl back up the other side
      return [...peel, [(x0 + lx) / 2 + 20 * s, 160], [lx + j * 24, 250], [lx - 40 * s, 296], [lx - 90 * s, 280], [lx - 110 * s, 220], [lx - 100 * s, -40]];
  }
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
