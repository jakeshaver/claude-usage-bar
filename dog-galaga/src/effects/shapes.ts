import { PALETTE, KEY } from '../core/palette';

/**
 * Pixel-art particle shapes. Each is a tiny bitmap:
 *   x = main color, o = shade (darker step of the main color), h = highlight (white), . = clear.
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
  chunk3: ['hx.', 'xxo', '.oo'],
  chunk4: ['.hx.', 'hxxx', 'xxxo', '.oo.'],
  splat9: ['x...x...x', '.x.xxx.x.', '..xhhxx..', 'xxhxxxxxo', '..xxxxo..', '.o.xxo.o.', 'o...o...o'],
  conf_h: ['xxx', 'ooo'], conf_d: ['xx.', 'xoo', '.oo'], conf_v: ['xo', 'xo', 'xo'], conf_s: ['xxx'],
  puff1: circleBitmap(1), puff2: circleBitmap(2), puff3: circleBitmap(3), puff4: circleBitmap(4),
  puff5: circleBitmap(5), puff6: circleBitmap(6),
};
/** shapes that get a 1px dark outline so they pop off busy backgrounds (Galaga-crisp) */
const OUTLINED = new Set(['star5', 'star7', 'heart5', 'heart7', 'spark5', 'chunk4', 'splat9', 'puff2', 'puff3', 'puff4', 'puff5', 'puff6']);
const INK = '#2a2438';
const NAMES = Object.keys(DEFS);
const ID: Record<string, number> = Object.fromEntries(NAMES.map((n, i) => [n, i]));
export const SH = ID;

/** animation sequences: a particle steps through these over its life */
export const SEQS: number[][] = [];
const seq = (...names: string[]) => { SEQS.push(names.map(n => ID[n])); return SEQS.length - 1; };
export const SEQ = {
  dot: seq('dot2', 'dot2', 'dot1'),
  spark: seq('spark5', 'plus3', 'plus3', 'dot1'),
  star: seq('star7', 'star7', 'star5', 'plus3', 'dot1'),
  heart: seq('heart7', 'heart7', 'heart5', 'heart5', 'heart3'),
  heartSmall: seq('heart5', 'heart5', 'heart3', 'dot1'),
  fur: seq('puff2', 'puff3', 'puff3', 'puff2', 'puff2', 'puff1', 'dot1'),
  chunk: seq('chunk4', 'chunk4', 'chunk3', 'dot2', 'dot1'),
  splat: seq('splat9', 'splat9', 'splat9', 'chunk4'),
  boom: seq('puff3', 'puff5', 'puff6', 'puff6', 'puff5', 'puff4', 'puff3', 'puff2', 'puff1'),
  confetti: seq('conf_h', 'conf_d', 'conf_v', 'conf_d', 'conf_h', 'conf_s'),
};

const shapeCache: (HTMLCanvasElement | undefined)[] = [];
export function shapeCanvas(shape: number, color: number): HTMLCanvasElement {
  const key = shape * 32 + color;
  let c = shapeCache[key];
  if (c) return c;
  const rows = DEFS[NAMES[shape]] ?? DEFS.dot1;
  const k = KEY[color] ?? '6';
  const main = PALETTE[color] ?? '#ffffff', shade = PALETTE[P(SHADE[k] ?? k)] ?? main, hi = PALETTE[6];
  const pad = OUTLINED.has(NAMES[shape]) ? 1 : 0, w = rows[0].length, h = rows.length;
  c = document.createElement('canvas'); c.width = w + pad * 2; c.height = h + pad * 2;
  const x = c.getContext('2d')!;
  const on = (i: number, y: number) => y >= 0 && y < h && i >= 0 && i < w && rows[y][i] !== '.';
  if (pad) { // outline: every clear pixel 4-adjacent to the shape
    x.fillStyle = INK;
    for (let y = -1; y <= h; y++) for (let i = -1; i <= w; i++)
      if (!on(i, y) && (on(i - 1, y) || on(i + 1, y) || on(i, y - 1) || on(i, y + 1))) x.fillRect(i + pad, y + pad, 1, 1);
  }
  for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) {
    const ch = rows[y][i]; if (ch === '.') continue;
    x.fillStyle = ch === 'o' ? shade : ch === 'h' ? hi : main; x.fillRect(i + pad, y + pad, 1, 1);
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
