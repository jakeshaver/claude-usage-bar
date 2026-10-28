// Entry / dive / bonus flight paths in world coordinates (world is 448 wide).
export type Pt = [number, number];
const CX = 224;
export function entryPath(kind: string, side: number, slot: Pt): Pt[] {
  const m = (p: Pt): Pt => (side < 0 ? [448 - p[0], p[1]] : p);
  switch (kind) {
    case 'swirl-left': case 'swirl-right': {
      const s = kind === 'swirl-left' ? 1 : -1;
      const pts: Pt[] = [[-30, 230], [90, 250], [170, 200], [150, 140], [90, 160]];
      return [...pts.map(p => (s > 0 ? p : [448 - p[0], p[1]] as Pt)), slot];
    }
    case 'split': return [m([CX - 20, -30]), m([CX - 60, 120]), m([CX - 150, 210]), m([CX - 90, 260]), m([CX - 30, 180]), slot];
    case 'rain': return [[slot[0], -40], [slot[0] + 30 * side, 150], [slot[0] - 20 * side, 220], [slot[0], slot[1] + 40], slot];
    case 'loop': return [m([-30, 60]), m([140, 120]), m([CX, 220]), m([CX + 70, 160]), m([CX, 100]), slot];
    default: return [[slot[0], -40], slot];
  }
}
export function bonusPath(pattern: string, group: number): Pt[] {
  const s = group % 2 ? -1 : 1; const m = (p: Pt): Pt => (s < 0 ? [448 - p[0], p[1]] : p);
  switch (pattern) {
    case 'figure8': return [m([-30, 80]), m([120, 140]), m([224, 200]), m([330, 140]), m([224, 80]), m([120, 140]), m([224, 260]), m([330, 300]), m([480, 260])];
    case 'cross': return [m([-30, 40]), m([224, 180]), m([480, 330])];
    case 'spiral': return [m([224, -30]), m([330, 120]), m([224, 220]), m([130, 140]), m([200, 90]), m([260, 160]), m([224, 200]), m([-40, 330])];
    default: return [m([-30, 60]), m([80, 160]), m([160, 60]), m([240, 160]), m([320, 60]), m([400, 160]), m([480, 60])];
  }
}
/** Sample a smooth Catmull-Rom curve at u in [0,1] across all points. */
export function sample(pts: Pt[], u: number): Pt {
  const n = pts.length - 1; const f = Math.min(n - 1e-6, Math.max(0, u * n)); const i = Math.floor(f), t = f - i;
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
  const cr = (a: number, b: number, c: number, d: number) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  return [cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])];
}
export function pathLen(pts: Pt[]): number { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; }
