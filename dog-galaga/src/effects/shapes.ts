import { PALETTE, KEY } from '../core/palette';

/**
 * Pixel-art particle shapes and hand-composed effect frames. Each is a tiny palette-indexed bitmap:
 *   x = main (tint) color, o = shade (darker step of the tint), h / w = white highlight,
 *   l = cream light (warm highlight, used on turd crumbs), p = pink, q = hot pink (pink shade),
 *   k = ink, . = clear.
 * Shapes are rasterized once per (shape, palette color) into a cached canvas, so drawing a particle
 * is a single integer-aligned drawImage. Circles (rings / discs) use the midpoint algorithm: no ctx.arc,
 * no anti-aliasing.
 */

const P = (k: string) => KEY.indexOf(k);
/** shade step per palette key (main -> darker neighbour in the same hue family) */
const SHADE: Record<string, string> = {
  '6': '5', '7': '8', '8': '9', '9': 'a', 'a': 'b', 'b': '0', 'c': 'd', 'd': 'e', 'e': 'v', 'f': 'g', 'g': 'h', 'h': 'b',
  'i': 'j', 'j': 'k', 'k': '1', 'l': 'm', 'm': 'n', 'n': '2', 'o': 'p', 'p': 'q', 'q': '0', 'r': 'e', 's': 'l', 't': 'u', 'u': '2',
  '5': '4', '4': '3', '3': '2', '2': '1', '1': '0', '0': '0', 'v': '0',
};
export const INK = '#2a2438';

function circleBitmap(r: number): string[] { // filled, with highlight top-left and shade bottom-right
  const n = r * 2 + 1, rows: string[] = [];
  for (let y = 0; y < n; y++) {
    let s = '';
    for (let x = 0; x < n; x++) {
      const dx = x - r, dy = y - r, d2 = dx * dx + dy * dy, lim = r * r + r * 0.8;
      if (d2 > lim) { s += '.'; continue; }
      const hx = dx + r * 0.4, hy = dy + r * 0.4;
      if (r >= 2 && hx * hx + hy * hy <= (r * 0.35) * (r * 0.35) + 0.5) s += 'h';
      else if (r >= 2 && (dx + dy) > r * 0.9 && d2 > (r - 1.4) * (r - 1.4)) s += 'o';
      else s += 'x';
    }
    rows.push(s);
  }
  return rows;
}

// ------------------------------------------------------------ the designed 'boop' kill animation
// A 7-frame hand-composed pop: white disc -> bigger disc with a tint rim -> 6-point star with bevel ->
// bigger star -> breaks into 4 hearts flying out on the diagonals -> hearts shrink and twinkle out.
// Composed on a fixed 49x49 grid (center 24,24) so every frame shares one anchor.
const BS = 24, BN = BS * 2 + 1;
type Grid = string[][];
const grid = (): Grid => { const g: Grid = []; for (let y = 0; y < BN; y++) { g.push([]); for (let x = 0; x < BN; x++) g[y].push('.'); } return g; };
const put = (g: Grid, x: number, y: number, ch: string) => { if (x >= 0 && y >= 0 && x < BN && y < BN) g[y][x] = ch; };
function stamp(g: Grid, rows: string[], cx: number, cy: number) {
  const ox = cx - (rows[0].length >> 1), oy = cy - (rows.length >> 1);
  rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] !== '.') put(g, ox + x, oy + y, r[x]); });
}
function disc(g: Grid, r: number, body: string, rim: string) {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const d2 = dx * dx + dy * dy; if (d2 > r * r + r * 0.8) continue;
    put(g, BS + dx, BS + dy, d2 > (r - 1) * (r - 1) + (r - 1) * 0.8 ? rim : body);
  }
}
function inPoly(px: number, py: number, vs: number[]) {
  let inside = false;
  for (let i = 0, j = vs.length - 2; i < vs.length; j = i, i += 2) {
    const xi = vs[i], yi = vs[i + 1], xj = vs[j], yj = vs[j + 1];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** 6-point star with a bevel: highlight on the upper-left rim, shade on the lower-right rim, white core */
function star(g: Grid, R: number, r: number, core: number) {
  const vs: number[] = [];
  for (let i = 0; i < 12; i++) { const a = -Math.PI / 2 + i * Math.PI / 6, rr = i & 1 ? r : R; vs.push(Math.cos(a) * rr, Math.sin(a) * rr); }
  const on = (dx: number, dy: number) => inPoly(dx, dy, vs);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    if (!on(dx, dy)) continue;
    let ch = 'x';
    if (dx * dx + dy * dy <= core * core + core * 0.8) ch = 'w';
    else if (!on(dx + 1, dy + 1) || !on(dx + 1, dy)) ch = 'o';
    else if (!on(dx - 1, dy - 1) || !on(dx - 1, dy)) ch = 'h';
    put(g, BS + dx, BS + dy, ch);
  }
}
const HEART7P = ['.pp.pp.', 'pwppppp', 'pwppppq', 'ppppppq', '.ppppq.', '..ppq..', '...q...'];
const HEART5P = ['pp.pp', 'pwppp', 'ppppq', '.ppq.', '..q..'];
const HEART3P = ['p.p', 'ppp', '.q.'];
const SPARK5W = ['..w..', '..w..', 'wwwww', '..w..', '..w..'];
function hearts(g: Grid, d: number, rows: string[]) {
  const o = Math.round(d * 0.7071);
  stamp(g, rows, BS - o, BS - o); stamp(g, rows, BS + o, BS - o); stamp(g, rows, BS - o, BS + o); stamp(g, rows, BS + o, BS + o);
}
/** ink outline around the composed frame (8-neighbour so diagonals of the star tips stay closed) */
function outline(g: Grid) {
  const src = g.map(r => r.slice());
  for (let y = 0; y < BN; y++) for (let x = 0; x < BN; x++) {
    if (src[y][x] !== '.') continue;
    let hit = false;
    for (let j = -1; j <= 1 && !hit; j++) for (let i = -1; i <= 1; i++) { const yy = y + j, xx = x + i; if (yy >= 0 && xx >= 0 && yy < BN && xx < BN && src[yy][xx] !== '.') { hit = true; break; } }
    if (hit) g[y][x] = 'k';
  }
}
function boopFrame(n: number): string[] {
  const g = grid();
  switch (n) {
    case 0: disc(g, 6, 'w', 'w'); break;
    case 1: disc(g, 9, 'w', 'x'); break;
    case 2: star(g, 13, 6, 3); break;
    case 3: star(g, 17, 8, 3); stamp(g, SPARK5W, BS, BS); break;
    case 4: hearts(g, 13, HEART7P); stamp(g, ['.w.', 'wxw', '.w.'], BS, BS); break;
    case 5: hearts(g, 18, HEART5P); stamp(g, ['x'], BS, BS - 14); stamp(g, ['x'], BS, BS + 14); stamp(g, ['x'], BS - 14, BS); stamp(g, ['x'], BS + 14, BS); break;
    default: hearts(g, 22, HEART3P); break;
  }
  outline(g);
  return g.map(r => r.join(''));
}

const DEFS: Record<string, string[]> = {
  dot1: ['x'],
  dot2: ['xx', 'xo'],
  plus3: ['.x.', 'xhx', '.x.'],
  spark5: ['..x..', '..x..', 'xxhxx', '..x..', '..x..'],
  star5: ['..x..', '.xhx.', 'xxxxo', '.xxo.', '.o.o.'],
  star7: ['...x...', '..xhx..', 'xxxhxxo', '.xxxxo.', '..xxo..', '.xo.xo.', '.o...o.'],
  heart3: ['x.x', 'xxx', '.o.'],
  heart5: ['xx.xx', 'xhxxx', 'xxxxo', '.xxo.', '..o..'],
  heart7: ['.xx.xx.', 'xhxxxxx', 'xhxxxxo', 'xxxxxxo', '.xxxxo.', '..xxo..', '...o...'],
  // turd crumbs: cream highlight rim so they read on navy night stages
  chunk3: ['ll.', 'lxx', '.xo'],
  chunk4: ['.ll.', 'lxxx', 'lxxo', '.oo.'],
  chunk5: ['.lll.', 'lxxxl', 'lxxxo', 'xxxoo', '.ooo.'],
  splatSquash: ['..l.lll.l..', '.lxxxxxxxl.', 'lxxxxxxxxxo', '.oxxxxxxoo.', '..o.ooo.o..'],
  splat9: ['l...l...l', '.x.lll.x.', '..lllxx..', 'xxlxxxxxo', '..xxxxo..', '.o.xxo.o.', 'o...o...o'],
  splat11: ['l....l....l', '.x...l...x.', '..x.lll.x..', '...llxxx...', 'xxllxxxxxxo', '...xxxxxo..', '..o.xxo.o..', '.o...o...o.', 'o.........o'],
  // confetti: 2x4 strip and 3x3 square, front -> shade -> edge-on flip
  c24f: ['xx', 'xh', 'xx', 'xx'], c24s: ['oo', 'oo', 'oo', 'oo'], c24e: ['o', 'o', 'o', 'o'], c24d: ['x.', 'xo', 'xo', '.o'],
  c33f: ['xxx', 'xhx', 'xxx'], c33s: ['ooo', 'ooo', 'ooo'], c33e: ['xxx'], c33d: ['.xo', 'xxo', 'xo.'],
  // streamers: 1px wavy ribbon, 6 tall, two phases
  strA: ['x.', 'x.', '.x', '.o', 'x.', 'o.'], strB: ['.x', '.x', 'x.', 'o.', '.x', '.o'],
  puff1: circleBitmap(1), puff2: circleBitmap(2), puff3: circleBitmap(3), puff4: circleBitmap(4),
  puff5: circleBitmap(5), puff6: circleBitmap(6),
  boop0: boopFrame(0), boop1: boopFrame(1), boop2: boopFrame(2), boop3: boopFrame(3), boop4: boopFrame(4), boop5: boopFrame(5), boop6: boopFrame(6),
};
/** shapes that get a 1px dark outline so they pop off busy backgrounds (Galaga-crisp) */
const OUTLINED = new Set(['star5', 'star7', 'heart5', 'heart7', 'spark5', 'chunk3', 'chunk4', 'chunk5', 'splat9', 'splat11', 'splatSquash']);
/** shapes drawn in two passes (all ink silhouettes first, then all fills) so overlapping clusters merge
 *  into one outlined cloud instead of a honeycomb of separately outlined circles */
const MERGED = new Set(['puff2', 'puff3', 'puff4', 'puff5', 'puff6']);
const NAMES = Object.keys(DEFS);
const ID: Record<string, number> = Object.fromEntries(NAMES.map((n, i) => [n, i]));
export const SH = ID;
export const MERGED_FLAG: boolean[] = NAMES.map(n => MERGED.has(n));

/** animation sequences: a particle steps through these over its life */
export const SEQS: number[][] = [];
const seq = (...names: string[]) => { SEQS.push(names.map(n => ID[n])); return SEQS.length - 1; };
export const SEQ = {
  dot: seq('dot2', 'dot2', 'dot1'),
  spark: seq('spark5', 'plus3', 'plus3', 'dot1'),
  star: seq('star7', 'star7', 'star5', 'plus3', 'dot1'),
  heart: seq('heart7', 'heart7', 'heart5', 'heart5', 'heart3'),
  heartSmall: seq('heart5', 'heart5', 'heart3', 'dot1'),
  fur: seq('puff2', 'puff3', 'puff3', 'puff2', 'puff2', 'puff1'),
  chunk: seq('chunk5', 'chunk4', 'chunk4', 'chunk3', 'chunk3', 'dot2'),
  splat: seq('splatSquash', 'splat11', 'splat9', 'splat9', 'splat9', 'splat9', 'chunk5'),
  boom: seq('puff3', 'puff5', 'puff6', 'puff6', 'puff5', 'puff4', 'puff3', 'puff2', 'puff1'),
  // confetti flips (indexed by its own flutter clock, not by life)
  confRect: seq('c24f', 'c24f', 'c24d', 'c24e', 'c24s', 'c24s', 'c24d', 'c24e'),
  confSq: seq('c33f', 'c33f', 'c33d', 'c33e', 'c33s', 'c33s', 'c33d', 'c33e'),
  streamer: seq('strA', 'strB'),
};
/** the designed kill pop: frame shape ids and per-frame durations (ticks) */
export const BOOP_FRAMES = ['boop0', 'boop1', 'boop2', 'boop3', 'boop4', 'boop5', 'boop6'].map(n => ID[n]);
export const BOOP_DUR = [4, 4, 4, 4, 5, 5, 5];

const shapeCache: (HTMLCanvasElement | undefined)[] = [];
/** mode 0 = normal, 1 = ink silhouette grown by 1px (for merged two-pass clusters) */
export function shapeCanvas(shape: number, color: number, mode = 0): HTMLCanvasElement {
  const key = (shape * 32 + color) * 2 + mode;
  let c = shapeCache[key];
  if (c) return c;
  const rows = DEFS[NAMES[shape]] ?? DEFS.dot1;
  const k = KEY[color] ?? '6';
  const main = PALETTE[color] ?? '#ffffff', shade = PALETTE[P(SHADE[k] ?? k)] ?? main;
  const pad = mode === 1 || OUTLINED.has(NAMES[shape]) ? 1 : 0, w = rows[0].length, h = rows.length;
  c = document.createElement('canvas'); c.width = w + pad * 2; c.height = h + pad * 2;
  const x = c.getContext('2d')!;
  const on = (i: number, y: number) => y >= 0 && y < h && i >= 0 && i < w && rows[y][i] !== '.';
  if (pad) { // outline: every clear pixel 4-adjacent to the shape (silhouette mode: the shape too)
    x.fillStyle = INK;
    for (let y = -1; y <= h; y++) for (let i = -1; i <= w; i++)
      if ((mode === 1 && on(i, y)) || (!on(i, y) && (on(i - 1, y) || on(i + 1, y) || on(i, y - 1) || on(i, y + 1)))) x.fillRect(i + pad, y + pad, 1, 1);
  }
  if (mode === 0) for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) {
    const ch = rows[y][i]; if (ch === '.') continue;
    x.fillStyle = ch === 'x' ? main : ch === 'o' ? shade : ch === 'h' || ch === 'w' ? PALETTE[6] : ch === 'l' ? PALETTE[7]
      : ch === 'p' ? PALETTE[12] : ch === 'q' ? PALETTE[13] : ch === 'k' ? INK : main;
    x.fillRect(i + pad, y + pad, 1, 1);
  }
  shapeCache[key] = c; return c;
}

export const CIRCLE_RING = 0, CIRCLE_DASH = 1, CIRCLE_FILL = 2;
const circCache: (HTMLCanvasElement | undefined)[] = [];
/** Midpoint circle of radius r (canvas is 2r+1 square; draw at cx-r, cy-r). */
export function circleCanvas(r: number, color: number, mode: number): HTMLCanvasElement {
  r = Math.max(0, Math.min(127, r | 0));
  const key = (r * 32 + color) * 3 + mode;
  let c = circCache[key];
  if (c) return c;
  const n = r * 2 + 1;
  c = document.createElement('canvas'); c.width = n; c.height = n;
  const g = c.getContext('2d')!; g.fillStyle = PALETTE[color] ?? '#ffffff';
  if (mode === CIRCLE_FILL) {
    let x = r, y = 0, err = 1 - r;
    while (x >= y) { // horizontal spans per octant pair
      g.fillRect(r - x, r + y, 2 * x + 1, 1); g.fillRect(r - x, r - y, 2 * x + 1, 1);
      g.fillRect(r - y, r + x, 2 * y + 1, 1); g.fillRect(r - y, r - x, 2 * y + 1, 1);
      y++; if (err < 0) err += 2 * y + 1; else { x--; err += 2 * (y - x) + 1; }
    }
  } else {
    let x = r, y = 0, err = 1 - r, step = 0;
    while (x >= y) {
      // dashed: keep 2 of every 4 steps along the arc
      if (mode !== CIRCLE_DASH || (step & 2) === 0) {
        const pts = [r + x, r + y, r - x, r + y, r + x, r - y, r - x, r - y, r + y, r + x, r - y, r + x, r + y, r - x, r - y, r - x];
        for (let i = 0; i < 16; i += 2) g.fillRect(pts[i], pts[i + 1], 1, 1);
      }
      step++; y++; if (err < 0) err += 2 * y + 1; else { x--; err += 2 * (y - x) + 1; }
    }
  }
  circCache[key] = c; return c;
}

/** Text with a 1px ink outline on all 8 neighbours (2px at scale >= 2), cached per (label, color, scale, drop).
 *  Optional drop color sits under the outline, offset down by one text pixel, for a chunky arcade look. */
const textCache = new Map<string, HTMLCanvasElement>();
type TextFn = (ctx: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, opts: { scale?: number }) => void;
export function outlinedText(draw: TextFn, label: string, color: string, scale = 1, drop = ''): HTMLCanvasElement {
  const key = label + '|' + color + '|' + scale + '|' + drop;
  let c = textCache.get(key); if (c) return c;
  const w = [...label].length * 6 * scale - scale, h = 7 * scale, o = scale > 1 ? 2 : 1, dy = drop ? scale : 0;
  c = document.createElement('canvas'); c.width = w + o * 2; c.height = h + o * 2 + dy;
  const x = c.getContext('2d')!;
  if (drop) for (let j = -o; j <= o; j++) for (let i = -o; i <= o; i++) draw(x, label, o + i, o + j + dy, drop, { scale });
  for (let j = -o; j <= o; j++) for (let i = -o; i <= o; i++) if (i || j) draw(x, label, o + i, o + j, INK, { scale });
  draw(x, label, o, o, color, { scale });
  if (textCache.size > 400) textCache.clear();
  textCache.set(key, c); return c;
}

/** Palette-legal flash: an ordered-dither screen of one color (density 2 = 50% checker, 4 = 25%, 8 = 12.5%). */
const flashCache = new Map<string, HTMLCanvasElement>();
export function ditherCanvas(color: string, w: number, h: number, density: number): HTMLCanvasElement {
  const key = color + density;
  let c = flashCache.get(key); if (c) return c;
  c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d')!; x.fillStyle = color;
  for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) {
    const on = density <= 2 ? ((i + y) & 1) === 0
      : density <= 4 ? (i & 1) === 0 && (y & 1) === 0
      : (y & 1) === 0 && ((i + (y & 2)) & 3) === 0;
    if (on) x.fillRect(i, y, 1, 1);
  }
  flashCache.set(key, c); return c;
}
