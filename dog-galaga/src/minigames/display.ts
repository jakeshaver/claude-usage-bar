import { PALETTE, KEY } from '../core/palette';

/**
 * Bonanza display face: a hand-authored 13px-cap, chamfered, 3px-stem arcade face for the big banner words
 * (stage title, 3-2-1, GO!, PERFECT!). Masks are authored here; the renderer turns each into a palette-indexed
 * sprite with a per-row 2-tone grade (bright top band to a burnt base), a 1px bevel highlight on every
 * top-facing edge, a darker lip on bottom-facing edges, a 1px ink outline and a 1px drop shadow.
 * Scaling happens on the MASK, and the shading is applied afterwards at native resolution, so a 2x glyph
 * still gets 1px highlight rows and a 1px outline (never fat 2px stair blocks with no shaping).
 */
const M: Record<string, string[]> = {
  A: ['..#####..', '.#######.', '###...###', '###...###', '###...###', '###...###', '#########', '#########', '###...###', '###...###', '###...###', '###...###', '###...###'],
  B: ['#######..', '########.', '###...###', '###...###', '###..###.', '#######..', '########.', '###...###', '###...###', '###...###', '###...###', '########.', '#######..'],
  C: ['..#######', '.########', '###......', '###......', '###......', '###......', '###......', '###......', '###......', '###......', '###......', '.########', '..#######'],
  D: ['#######..', '########.', '###..####', '###...###', '###...###', '###...###', '###...###', '###...###', '###...###', '###...###', '###..####', '########.', '#######..'],
  E: ['#########', '#########', '###......', '###......', '###......', '#######..', '#######..', '###......', '###......', '###......', '###......', '#########', '#########'],
  F: ['#########', '#########', '###......', '###......', '###......', '#######..', '#######..', '###......', '###......', '###......', '###......', '###......', '###......'],
  G: ['..#######', '.########', '###......', '###......', '###......', '###..####', '###..####', '###...###', '###...###', '###...###', '###...###', '.########', '..######.'],
  H: ['###...###', '###...###', '###...###', '###...###', '###...###', '#########', '#########', '###...###', '###...###', '###...###', '###...###', '###...###', '###...###'],
  I: ['#####', '#####', '.###.', '.###.', '.###.', '.###.', '.###.', '.###.', '.###.', '.###.', '.###.', '#####', '#####'],
  J: ['......###', '......###', '......###', '......###', '......###', '......###', '......###', '......###', '......###', '###...###', '###...###', '.#######.', '..#####..'],
  K: ['###...###', '###...###', '###..###.', '###.###..', '######...', '#####....', '#####....', '######...', '###.###..', '###..###.', '###...###', '###...###', '###...###'],
  L: ['###......', '###......', '###......', '###......', '###......', '###......', '###......', '###......', '###......', '###......', '###......', '#########', '#########'],
  M: ['###.....###', '####...####', '#####.#####', '###.###.###', '###..#..###', '###.....###', '###.....###', '###.....###', '###.....###', '###.....###', '###.....###', '###.....###', '###.....###'],
  N: ['###....###', '####...###', '####...###', '#####..###', '#####..###', '###.##.###', '###.##.###', '###..#####', '###..#####', '###...####', '###...####', '###....###', '###....###'],
  O: ['..#####..', '.#######.', '###...###', '###...###', '###...###', '###...###', '###...###', '###...###', '###...###', '###...###', '###...###', '.#######.', '..#####..'],
  P: ['#######..', '########.', '###...###', '###...###', '###...###', '###...###', '########.', '#######..', '###......', '###......', '###......', '###......', '###......'],
  Q: ['..#####..', '.#######.', '###...###', '###...###', '###...###', '###...###', '###...###', '###...###', '###...###', '###.#.###', '###..####', '.########', '..#######'],
  R: ['#######..', '########.', '###...###', '###...###', '###...###', '###...###', '########.', '#######..', '###.###..', '###..###.', '###...###', '###...###', '###...###'],
  S: ['..#######', '.########', '###......', '###......', '###......', '########.', '.########', '......###', '......###', '......###', '......###', '########.', '#######..'],
  T: ['#########', '#########', '...###...', '...###...', '...###...', '...###...', '...###...', '...###...', '...###...', '...###...', '...###...', '...###...', '...###...'],
  U: ['###...###', '###...###', '###...###', '###...###', '###...###', '###...###', '###...###', '###...###', '###...###', '###...###', '###...###', '.#######.', '..#####..'],
  V: ['###...###', '###...###', '###...###', '###...###', '###...###', '###...###', '###...###', '###...###', '.###.###.', '.###.###.', '..#####..', '..#####..', '...###...'],
  W: ['###.....###', '###.....###', '###.....###', '###.....###', '###.....###', '###.....###', '###.....###', '###.....###', '###..#..###', '###.###.###', '#####.#####', '####...####', '###.....###'],
  X: ['###...###', '###...###', '.###.###.', '.###.###.', '..#####..', '...###...', '...###...', '..#####..', '.###.###.', '.###.###.', '###...###', '###...###', '###...###'],
  Y: ['###...###', '###...###', '.###.###.', '.###.###.', '..#####..', '...###...', '...###...', '...###...', '...###...', '...###...', '...###...', '...###...', '...###...'],
  Z: ['#########', '#########', '......###', '.....###.', '.....###.', '....###..', '...###...', '..###....', '.###.....', '.###.....', '###......', '#########', '#########'],
  0: ['..#####..', '.#######.', '###...###', '###..####', '###..####', '###.#.###', '###.#.###', '###.#.###', '####..###', '####..###', '###...###', '.#######.', '..#####..'],
  1: ['..###.', '.####.', '#####.', '..###.', '..###.', '..###.', '..###.', '..###.', '..###.', '..###.', '..###.', '######', '######'],
  2: ['#######..', '########.', '......###', '......###', '......###', '.########', '########.', '###......', '###......', '###......', '###......', '#########', '#########'],
  3: ['#######..', '########.', '......###', '......###', '......###', '..######.', '..######.', '......###', '......###', '......###', '......###', '########.', '#######..'],
  4: ['###...###', '###...###', '###...###', '###...###', '###...###', '###...###', '#########', '#########', '......###', '......###', '......###', '......###', '......###'],
  5: ['#########', '#########', '###......', '###......', '###......', '#######..', '########.', '......###', '......###', '......###', '......###', '########.', '#######..'],
  6: ['..#######', '.########', '###......', '###......', '###......', '#######..', '########.', '###...###', '###...###', '###...###', '###...###', '.#######.', '..#####..'],
  7: ['#########', '#########', '......###', '......###', '......###', '.....###.', '....###..', '...###...', '...###...', '...###...', '...###...', '...###...', '...###...'],
  8: ['..#####..', '.#######.', '###...###', '###...###', '###...###', '.#######.', '.#######.', '###...###', '###...###', '###...###', '###...###', '.#######.', '..#####..'],
  9: ['..#####..', '.#######.', '###...###', '###...###', '###...###', '###...###', '.########', '..#######', '......###', '......###', '......###', '########.', '#######..'],
  '!': ['###', '###', '###', '###', '###', '###', '###', '###', '###', '...', '...', '###', '###'],
  "'": ['###', '###', '.#.', '...', '...', '...', '...', '...', '...', '...', '...', '...', '...'],
  '-': ['.....', '.....', '.....', '.....', '.....', '#####', '#####', '.....', '.....', '.....', '.....', '.....', '.....'],
};
export const DISPLAY_H = 13;
const GAP = 2;          // mask columns between glyphs (their outlines merge into one ink seam)
const SPACE = 5;

/** Palette-key grades: [bevel highlight, top band, mid band, base band, bottom lip, drop shadow]. */
export const SCHEMES = {
  gold: '7fgha0',      // cream bevel, yellow -> orange -> burnt, brown lip
  ice: '6slmn0',       // white bevel, ice -> cyan -> teal, deep blue lip
  violet: '65tuv0',    // white bevel, pale -> violet -> purple, plum lip
  hot: '6cde10',       // white bevel, pink -> hot -> magenta, night lip
  lime: '7ijk00',      // cream bevel, lime -> green -> dark green
  flash: '666650',     // pure white with a pale base (1-2 frame impact flash)
} as const;
export type Scheme = keyof typeof SCHEMES;

const has = (ch: string) => ch === ' ' || !!M[ch];
const gw = (ch: string) => ch === ' ' ? SPACE : M[ch]?.[0].length ?? 0;

/** Width in screen pixels of `s` at `scale` (glyph bodies + gaps, excluding the 1px outline on each side). */
export function displayWidth(s: string, scale = 1): number {
  const cs = [...s.toUpperCase()].filter(has); if (!cs.length) return 0;
  return cs.reduce((a, ch) => a + gw(ch) * scale, 0) + (cs.length - 1) * GAP * scale;
}
/** True when every character of `s` has a display glyph. */
export const displayCovers = (s: string) => [...s.toUpperCase()].every(has);

const cache = new Map<string, HTMLCanvasElement>();
/** Rasterise the whole string once per (string, scheme, scale) into a cached canvas (outline + shadow included). */
function sheet(s: string, scheme: Scheme, scale: number): HTMLCanvasElement | null {
  const key = `${s}|${scheme}|${scale}`; const hit = cache.get(key); if (hit) return hit;
  if (typeof document === 'undefined') return null;
  const bw = displayWidth(s, scale), bh = DISPLAY_H * scale; if (bw <= 0) return null;
  // mask at target scale, padded by 1 (outline) on every side + 1 extra row below (shadow)
  const W = bw + 2, H = bh + 3; const mask = new Uint8Array(W * H);
  let ox = 1;
  for (const ch of s.toUpperCase()) {
    if (!has(ch)) continue;
    const rows = M[ch];
    if (rows) for (let y = 0; y < bh; y++) { const r = rows[Math.floor(y / scale)]; for (let x = 0; x < r.length * scale; x++) if (r[Math.floor(x / scale)] === '#') mask[(y + 1) * W + ox + x] = 1; }
    ox += gw(ch) * scale + GAP * scale;
  }
  const m = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x] === 1;
  const g: string = SCHEMES[scheme]; const col = (i: number) => PALETTE[KEY.indexOf(g[i])];
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x2 = c.getContext('2d')!;
  const px = (x: number, y: number, k: string) => { x2.fillStyle = k; x2.fillRect(x, y, 1, 1); };
  // drop shadow (outline footprint shifted down 1) then the ink outline
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (m(x, y)) continue;
    let near = false; for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (m(x + dx, y + dy)) { near = true; break; }
    let shadow = false; if (!near) for (let dx = -1; dx <= 1; dx++) if (m(x + dx, y - 2)) shadow = true;
    if (near) px(x, y, PALETTE[0]);
    else if (shadow) px(x, y, PALETTE[KEY.indexOf('v')]);
  }
  // fill: row grade (top 45% / mid 30% / base 25%), bevel on top-facing edges, lip on bottom-facing edges
  for (let y = 1; y <= bh; y++) {
    const v = (y - 1) / Math.max(1, bh - 1); const band = v < 0.45 ? 1 : v < 0.75 ? 2 : 3;
    for (let x = 0; x < W; x++) {
      if (!m(x, y)) continue;
      let k = col(band);
      if (!m(x, y - 1)) k = col(0);
      else if (!m(x, y + 1)) k = col(4);
      else if (!m(x - 1, y) && band === 1) k = col(0);          // left rim catches the light in the top band
      px(x, y, k);
    }
  }
  cache.set(key, c); return c;
}

/**
 * Draw `s` in the display face. (x, y) is the top-left of the glyph bodies (the outline sits 1px outside),
 * or the top-centre with align 'center'. `clip` reveals only the columns left of that screen x (masked wipe).
 */
export function display(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, scheme: Scheme = 'gold', opts: { scale?: number; align?: 'left' | 'center'; clip?: number } = {}) {
  const scale = opts.scale ?? 1; const c = sheet(s, scheme, scale); if (!c) return;
  const bx = Math.round(opts.align === 'center' ? x - displayWidth(s, scale) / 2 : x) - 1, by = Math.round(y) - 1;
  if (opts.clip !== undefined) {
    const w = Math.max(0, Math.min(c.width, Math.round(opts.clip) - bx)); if (w <= 0) return;
    ctx.drawImage(c, 0, 0, w, c.height, bx, by, w, c.height);
  } else ctx.drawImage(c, bx, by);
}

// ------------------------------------------------------------------ celebration sprites (palette-indexed)

/** 9x9 four-point star, two frames (twinkle). Keys: palette indices. */
const STAR = [
  ['....0....', '...0f0...', '...0f0...', '.00f7f00.', '0ff767ff0', '.00f7f00.', '...0f0...', '...0f0...', '....0....'],
  ['.........', '....0....', '...0f0...', '..0f7f0..', '.0f767f0.', '..0f7f0..', '...0f0...', '....0....', '.........'],
];
const spr = new Map<string, HTMLCanvasElement>();
function spriteOf(rows: string[], recolor: Record<string, string> = {}): HTMLCanvasElement | null {
  const key = rows.join('/') + JSON.stringify(recolor); const hit = spr.get(key); if (hit) return hit;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = rows[0].length; c.height = rows.length; const x2 = c.getContext('2d')!;
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === '.') return; x2.fillStyle = PALETTE[KEY.indexOf(recolor[ch] ?? ch)]; x2.fillRect(x, y, 1, 1); }));
  spr.set(key, c); return c;
}
/** Star sprite centred on (cx, cy); `tint` swaps the yellow body for another palette key (e.g. 'l', 'c', 'i'). */
export function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, frame: number, tint = 'f') {
  const c = spriteOf(STAR[frame & 1], tint === 'f' ? {} : { f: tint }); if (!c) return;
  ctx.drawImage(c, Math.round(cx) - 4, Math.round(cy) - 4);
}
