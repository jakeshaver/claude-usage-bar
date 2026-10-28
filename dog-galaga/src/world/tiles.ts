// World tilesets: each area is a stack of parallax layers (far / main / fg).
// Each layer is painted in 448x256 segments (8 rows of 32px tiles) by a seeded
// painter, then cached per time-of-day. Backgrounds are authored in dark,
// low-noise mid-tones so cats, turds and hairballs pop (Galaga readability).
import { Rng } from '../core/rng';
import { Painter, spans, bayer } from './paint';

export const SEG = 256;
export const SW = 448;
const T = 32;

export interface Seg { s: number; r: Rng; seed: number; wy(y: number): number }
export interface LayerDef { speed: number; opaque?: boolean; paint(p: Painter, z: Seg): void }
export interface Tileset {
  id: string;
  /** default scroll px/tick of the main layer */
  speed: number;
  /** space tilesets keep their palette at every time of day */
  space?: boolean;
  /** interiors: the lights are on, so dusk/night only warm the room */
  indoor?: boolean;
  /** colour under everything (for transparent main layers) */
  base: string;
  far?: LayerDef; main: LayerDef; fg?: LayerDef;
  /** cheap per-frame sparkle drawn over the layers (palette pixels only) */
  anim?: (px: (k: string, x: number, y: number, w?: number, h?: number) => void, scroll: number, t: number, seed: number) => void;
}

// ---------------------------------------------------------------- helpers
const grid = (p: Painter, k: string, x: number, y: number, w: number, h: number, step = T) => {
  for (let gx = x; gx < x + w; gx += step) p.r(k, gx, y, 1, h);
  for (let gy = y; gy < y + h; gy += step) p.r(k, x, gy, w, 1);
};
/** soft-edged blob: union of ellipses */
function blob(p: Painter, k: string, cx: number, cy: number, r: number, rng: Rng, lobes = 5) {
  p.ell(k, cx, cy, r, r * 0.9);
  for (let i = 0; i < lobes; i++) { const a = (i / lobes) * Math.PI * 2 + rng.range(0, 0.8); p.disc(k, cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.6, r * rng.range(0.45, 0.65)); }
}
/** tree canopy seen from above: outlined leafy clumps, lit top-left, shaded bottom-right */
function canopy(p: Painter, cx: number, cy: number, r: number, rng: Rng, keys = ['1', 'k', 'j']) {
  const [shade, body, hi] = keys;
  const seed = rng.int(0, 1e6);
  const clumps: [number, number, number][] = [[cx, cy, r * 0.62]];
  const cr = new Rng(seed);
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2 + cr.range(0, 0.5); const d = r * cr.range(0.45, 0.62); clumps.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.92, r * cr.range(0.3, 0.42)]); }
  for (const [x, y, rr] of clumps) p.disc('0', x + 5, y + 6, rr + 1); // drop shadow onto what is below
  for (const [x, y, rr] of clumps) p.disc('0', x, y, rr + 1);
  for (const [x, y, rr] of clumps) p.disc(body, x, y, rr);
  for (const [x, y, rr] of clumps) p.disc(shade, x + rr * 0.35, y + rr * 0.4, rr * 0.6);
  for (const [x, y, rr] of clumps) p.disc(body, x - rr * 0.1, y - rr * 0.1, rr * 0.55);
  for (const [x, y, rr] of clumps) { p.ell(hi, x - rr * 0.35, y - rr * 0.4, rr * 0.32, rr * 0.22); p.r(shade, x + rr * 0.2, y + rr * 0.1, 1, 1); }
}
/** dense procedural fill: f(x,y) in 0..1 picks a palette band, with ordered dither between bands */
function field(p: Painter, keys: string[], f: (x: number, y: number) => number, skipBelow = -1) {
  const n = keys.length - 1;
  const row = new Float32Array(SW >> 1);
  p.pixels(set => {
    for (let y = 0; y < SEG; y++) for (let x = 0; x < SW; x++) {
      if (x === 0 && (y & 1) === 0) for (let i = 0; i < row.length; i++) row[i] = f(i * 2 + 1, y + 1); // smooth fields: sample per 2x2 cell
      const v = row[x >> 1]; if (v < skipBelow) continue;
      const lv = Math.max(0, Math.min(0.999, v)) * n; const band = Math.floor(lv);
      set((lv - band) * 16 > bayer(x, y) && band < n ? keys[band + 1] : keys[band], x, y);
    }
  });
}
function tuft(p: Painter, k: string, x: number, y: number) { p.r(k, x, y, 1, 2); p.r(k, x + 2, y - 1, 1, 3); p.r(k, x + 4, y, 1, 2); }
function grass(p: Painter, x: number, y: number, w: number, h: number, rng: Rng, base = 'k', hi = 'j', density = 1) {
  p.r(base, x, y, w, h);
  const n = Math.floor((w * h) / 520 * density);
  for (let i = 0; i < n; i++) tuft(p, rng.chance(0.75) ? hi : '1', x + rng.int(1, w - 6), y + rng.int(2, h - 2));
}
function lamp(p: Painter, x: number, y: number, r = 40) {
  p.shRect(x - 1, y - 1, 3, 3, 14);
  p.obj(() => { p.disc('0', x + 0.5, y + 0.5, 3); p.disc('p', x + 0.5, y + 0.5, 2); p.glow('q', 'f', x, y, 1, 1); p.glow('o', '7', x - 1, y - 1, 1, 1); });
  p.pool(x, y + 2, r);
}
function crate(p: Painter, x: number, y: number, w = 20, h = 20, k = 'a') {
  p.shRect(x, y, w, h, 8);
  p.obj(() => { p.r('b', x, y, w, h); p.r(k, x + 1, y + 1, w - 2, h - 2); p.r('b', x + 1, y + (h >> 1), w - 2, 1); p.frame('b', x + 2, y + 2, w - 4, h - 4); p.r('9', x + 1, y + 1, w - 2, 1); });
}
function car(p: Painter, x: number, y: number, body: string, down: boolean) {
  const w = 22, h = 42;
  p.shRect(x, y + 2, w, h - 4, 7);
  p.obj(() => {
    p.r('0', x - 1, y + 7, 2, 7); p.r('0', x + w - 1, y + 7, 2, 7); p.r('0', x - 1, y + h - 14, 2, 7); p.r('0', x + w - 1, y + h - 14, 2, 7);
    p.r('0', x + 1, y, w - 2, h); p.r('0', x, y + 1, w, h - 2);
    p.r(body, x + 1, y + 1, w - 2, h - 2);
    const front = down ? y + h - 15 : y + 7, back = down ? y + 7 : y + h - 13;
    p.r('1', x + 3, front, w - 6, 8); p.r('2', x + 4, front + (down ? 6 : 1), w - 8, 1);
    p.r('1', x + 3, back, w - 6, 6);
    p.r(body, x + 3, Math.min(front, back) + 8, w - 6, Math.abs(front - back) - 8 + (down ? 0 : 0));
    p.r('o', x + 2, y + 2, 1, h - 4);
    const hy = down ? y + h - 2 : y + 1, ty = down ? y + 1 : y + h - 2;
    p.glow('7', 'f', x + 2, hy, 4, 1); p.glow('7', 'f', x + w - 6, hy, 4, 1);
    p.glow('e', 'r', x + 2, ty, 4, 1); p.glow('e', 'r', x + w - 6, ty, 4, 1);
  });
}
function bench(p: Painter, x: number, y: number, vertical: boolean) {
  const w = vertical ? 12 : 36, h = vertical ? 36 : 12;
  p.shRect(x, y, w, h, 5);
  p.obj(() => {
    p.r('0', x, y, w, h);
    if (vertical) for (let i = 0; i < 3; i++) p.r(i ? 'a' : '9', x + 1 + i * 4, y + 1, 3, h - 2);
    else for (let i = 0; i < 3; i++) p.r(i ? 'a' : '9', x + 1, y + 1 + i * 4, w - 2, 3);
    p.r('q', vertical ? x : x + 3, vertical ? y + 3 : y, vertical ? w : 2, vertical ? 2 : h); p.r('q', vertical ? x : x + w - 5, vertical ? y + h - 5 : y, vertical ? w : 2, vertical ? 2 : h);
  });
}
function bin(p: Painter, x: number, y: number, k = 'q') {
  p.shEll(x, y, 6, 6, 8);
  p.obj(() => { p.disc('0', x, y, 7); p.disc(k, x, y, 6); p.disc('0', x, y, 4); p.disc('1', x + 0.5, y + 0.5, 3); p.r('p', x - 4, y - 4, 2, 1); });
}
function planter(p: Painter, x: number, y: number, w: number, h: number, rng: Rng, flowers = true) {
  p.shRect(x, y, w, h, 5);
  p.obj(() => {
    p.r('b', x, y, w, h); p.r('v', x + 2, y + 2, w - 4, h - 4);
    for (let i = 0; i < (w * h) / 60; i++) { const cx = x + rng.int(4, w - 4), cy = y + rng.int(4, h - 4); p.disc('k', cx, cy, 4); p.r('j', cx - 2, cy - 2, 2, 1); }
    if (flowers) for (let i = 0; i < (w * h) / 140; i++) p.r(rng.pick(['c', 'f', 't']), x + rng.int(3, w - 4), y + rng.int(3, h - 4), 1, 1);
    p.r('a', x, y, w, 1); p.r('a', x, y, 1, h);
  });
}
/** brownstone / tenement roof block: tar with parapet bevel and grid seams */
function roof(p: Painter, x: number, y: number, w: number, h: number, height: number, tar = 'q', rim = 'p') {
  p.shRect(x, y, w, h, height);
  p.obj(() => {
    p.r('0', x, y, w, h);
    p.r(rim, x + 1, y + 1, w - 2, h - 2);
    p.r('o', x + 1, y + 1, w - 2, 1); p.r('o', x + 1, y + 1, 1, h - 2);
    p.r(tar, x + 4, y + 4, w - 8, h - 8);
    p.r('v', x + 4, y + 4, w - 8, 1); p.r('v', x + 4, y + 4, 1, h - 8);
    for (let gx = x + 4 + T; gx < x + w - 4; gx += T) p.r('v', gx, y + 5, 1, h - 9);
    for (let gy = y + 4 + T; gy < y + h - 4; gy += T) p.r('v', x + 5, gy, w - 9, 1);
  });
}
function vent(p: Painter, x: number, y: number) {
  p.shEll(x, y, 4, 4, 6);
  p.obj(() => { p.disc('0', x, y, 5); p.disc('p', x, y, 4); p.r('q', x - 3, y, 6, 1); p.r('q', x - 3, y - 2, 6, 1); p.r('q', x - 3, y + 2, 6, 1); });
}
function acUnit(p: Painter, x: number, y: number) {
  p.shRect(x, y, 22, 16, 8);
  p.obj(() => { p.r('0', x, y, 22, 16); p.r('p', x + 1, y + 1, 20, 14); p.r('o', x + 1, y + 1, 20, 1); p.disc('q', x + 8, y + 8, 5); p.disc('0', x + 8, y + 8, 2); for (let i = 0; i < 4; i++) p.r('q', x + 15, y + 3 + i * 3, 5, 1); });
}
function skylight(p: Painter, x: number, y: number, w: number, h: number, chance = 0.8, roll = 0) {
  p.shRect(x, y, w, h, 3);
  p.obj(() => { p.r('0', x, y, w, h); p.r('p', x + 1, y + 1, w - 2, h - 2); p.glow('2', 'g', x + 2, y + 2, w - 4, h - 4, chance, roll); p.glow('3', 'f', x + 3, y + 3, 3, 2, chance, roll); });
  p.obj(() => { p.lateBars.push([x + (w >> 1), y + 1, 1, h - 2], [x + 1, y + (h >> 1), w - 2, 1]); });
}
function waterTower(p: Painter, cx: number, cy: number, r = 14) {
  p.shEll(cx, cy, r, r, 30);
  p.obj(() => {
    for (const [dx, dy] of [[-r + 2, -r + 2], [r - 3, -r + 2], [-r + 2, r - 3], [r - 3, r - 3]]) p.r('0', cx + dx, cy + dy, 2, 2);
    p.disc('0', cx, cy, r + 1); p.disc('b', cx, cy, r); p.disc('a', cx - 1, cy - 1, r - 2);
    // conical roof: shingle rings + radial seams
    p.ring('b', cx, cy, r - 4, r - 4, 1); p.disc('9', cx - 2, cy - 2, r - 8);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; p.line('b', cx, cy, cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2)); }
    p.ring('0', cx, cy, r, r, 1);
    p.disc('q', cx, cy, 2); p.r('p', cx - 1, cy - 1, 1, 1);
    p.glow('q', 'r', cx - 1, cy - 1, 2, 2);
  });
}
function stringLights(p: Painter, x0: number, y0: number, x1: number, y1: number, rng: Rng) {
  p.obj(() => {
    p.line('0', x0, y0, x1, y1);
    const n = Math.floor(Math.hypot(x1 - x0, y1 - y0) / 8);
    for (let i = 1; i < n; i++) { const x = Math.round(x0 + ((x1 - x0) * i) / n), y = Math.round(y0 + ((y1 - y0) * i) / n) + (i % 2); p.glow('q', rng.pick(['f', 'c', 'l', 'g']), x, y, 1, 2); }
  });
}
/** pointed hull boat seen from above */
function boat(p: Painter, x: number, y: number, w: number, len: number, hull: string, rng: Rng, bowUp = true) {
  const shape = (k: string, inset: number, dx = 0, dy = 0) => {
    for (let j = inset; j < len - inset; j++) {
      const t = bowUp ? j / len : 1 - j / len; const taper = t < 0.32 ? Math.sqrt(t / 0.32) : 1; const hw = Math.max(1, Math.round((w / 2 - inset) * taper - (t > 0.95 ? 1 : 0)));
      p.r(k, x + dx + Math.round(w / 2) - hw, y + dy + j, hw * 2, 1);
    }
  };
  for (let j = 0; j < len; j += 2) p.r('1', x + 3 + 2, y + j + 3, w - 4, 2); // shadow on water (painted direct: water is in this layer)
  p.obj(() => {
    shape('0', 0); shape(hull, 1); shape('a', 3);
    for (let j = 6; j < len - 4; j += 4) p.r('b', x + 4, y + j, w - 8, 1);
    const cab = bowUp ? y + Math.round(len * 0.45) : y + Math.round(len * 0.25);
    p.r('0', x + 5, cab, w - 10, Math.round(len * 0.28)); p.r('p', x + 6, cab + 1, w - 12, Math.round(len * 0.28) - 2); p.r('o', x + 6, cab + 1, w - 12, 1);
    p.glow('2', 'f', x + 7, cab + 3, 2, 2, 0.8, rng.next()); p.glow('2', 'f', x + w - 9, cab + 3, 2, 2, 0.8, rng.next());
    p.r('o', x + Math.round(w / 2), bowUp ? y + 2 : y + len - 3, 1, 1);
  });
}

// ---------------------------------------------------------------- BACKYARD
function doghouse(p: Painter, x: number, y: number) {
  p.shRect(x, y, 30, 26, 14);
  p.obj(() => {
    p.r('0', x - 1, y - 1, 32, 28);
    p.r('h', x, y, 15, 26); p.r('a', x + 15, y, 15, 26); // gable roof: lit / shaded halves
    for (let j = 3; j < 26; j += 4) { p.r('a', x, y + j, 15, 1); p.r('b', x + 15, y + j, 15, 1); }
    p.r('9', x + 14, y, 2, 26); p.r('f', x + 14, y + 1, 1, 1);
    p.r('0', x + 10, y + 26, 10, 3); // door shadow under eave
  });
  // bowl + bone
  p.obj(() => { p.disc('0', x + 40, y + 22, 4); p.disc('e', x + 40, y + 22, 3); p.r('a', x + 39, y + 21, 2, 1); p.r('8', x + 34, y + 34, 6, 2); p.r('8', x + 33, y + 33, 2, 1); p.r('8', x + 33, y + 36, 2, 1); p.r('8', x + 39, y + 33, 2, 1); p.r('8', x + 39, y + 36, 2, 1); });
}
function kiddiePool(p: Painter, cx: number, cy: number, r = 22) {
  p.shEll(cx, cy, r, r * 0.9, 4);
  p.obj(() => {
    p.ell('0', cx, cy, r + 1, r * 0.9 + 1); p.ell('d', cx, cy, r, r * 0.9); p.ell('e', cx + 1, cy + 1, r - 1, r * 0.9 - 1);
    p.ell('c', cx - 1, cy - 1, r - 2, r * 0.9 - 2); p.ell('d', cx, cy, r - 3, r * 0.9 - 3);
    p.ell('n', cx, cy, r - 5, r * 0.9 - 5); p.ell('m', cx - 2, cy - 2, r - 9, r * 0.9 - 10);
    p.ell('n', cx + 1, cy + 1, r - 11, r * 0.9 - 12);
    p.r('l', cx - 8, cy - 6, 4, 1); p.r('l', cx + 3, cy + 4, 3, 1);
    p.r('0', cx + 4, cy - 5, 5, 4); p.r('f', cx + 4, cy - 5, 4, 3); p.r('g', cx + 8, cy - 4, 1, 1); // duck
  });
}
function patio(p: Painter, x: number, y: number, w: number, h: number, rng: Rng) {
  p.r('v', x, y, w, h);
  for (let j = 0; j < h; j += 16) for (let i = (j / 16) % 2 ? -8 : 0; i < w; i += 16) { const xx = Math.max(x, x + i + 1), ww = Math.min(x + w, x + i + 15) - xx; if (ww > 0) p.r(rng.chance(0.3) ? 'p' : 'q', xx, y + j + 1, ww, Math.min(14, h - j - 1)); }
}
function grill(p: Painter, x: number, y: number) {
  p.shEll(x, y, 7, 7, 12);
  p.obj(() => { p.disc('0', x, y, 8); p.disc('q', x, y, 7); p.disc('p', x - 1, y - 1, 5); p.r('o', x - 3, y - 4, 2, 1); p.r('0', x - 1, y - 9, 2, 2); p.glow('q', 'g', x - 4, y + 2, 1, 1, 0.4, 0); });
}
function umbrellaTable(p: Painter, cx: number, cy: number) {
  p.shEll(cx, cy, 16, 16, 18);
  p.obj(() => {
    for (const [dx, dy] of [[-18, 0], [18, 0], [0, 20], [0, -20]]) { p.r('0', cx + dx - 4, cy + dy - 4, 8, 8); p.r('o', cx + dx - 3, cy + dy - 3, 6, 6); }
    p.disc('0', cx, cy, 16); p.disc('h', cx, cy, 15);
    for (let a = 0; a < 8; a += 2) for (let rr = 2; rr < 15; rr++) { const t1 = (a / 8) * Math.PI * 2, t2 = ((a + 1) / 8) * Math.PI * 2; for (let tt = t1; tt < t2; tt += 0.08) p.r('8', cx + Math.cos(tt) * rr, cy + Math.sin(tt) * rr); }
    p.disc('0', cx, cy, 2); p.r('7', cx - 1, cy - 1, 1, 1);
  });
}
function garden(p: Painter, x: number, y: number, w: number, h: number, rng: Rng) {
  p.shRect(x, y, w, h, 3);
  p.obj(() => {
    p.r('0', x - 1, y - 1, w + 2, h + 2); p.r('b', x, y, w, h);
    for (let j = 4; j < h - 2; j += 8) { p.r('v', x + 2, y + j + 3, w - 4, 1); for (let i = 4; i < w - 4; i += 7) { p.disc('k', x + i + 1, y + j + 1, 3); p.r('j', x + i, y + j, 1, 1); if (rng.chance(0.3)) p.r('r', x + i + 2, y + j + 2, 1, 1); } }
  });
}
function clothesline(p: Painter, x0: number, x1: number, y: number, rng: Rng) {
  p.obj(() => {
    p.r('0', x0 - 1, y - 1, 3, 3); p.r('0', x1 - 1, y - 1, 3, 3); p.r('q', x0, y, x1 - x0, 1);
    for (let x = x0 + 8; x < x1 - 14; x += rng.int(14, 22)) { const k = rng.pick(['n', 'e', '8', 'u', 'p']); const ww = rng.int(8, 12), hh = rng.int(8, 14); p.r('0', x, y + 1, ww, hh); p.r(k, x + 1, y + 1, ww - 2, hh - 1); p.r('o', x + 1, y + 1, ww - 2, 1); }
  });
}
function fenceV(p: Painter, x: number, y0: number, y1: number) {
  p.shRect(x, y0, 4, y1 - y0, 10);
  p.obj(() => { p.r('b', x, y0, 4, y1 - y0); p.r('9', x, y0, 1, y1 - y0); p.r('a', x + 1, y0, 2, y1 - y0); for (let y = y0; y < y1; y += 32) { p.r('0', x - 1, y + 14, 6, 5); p.r('9', x, y + 15, 4, 3); } });
}
function fenceH(p: Painter, x0: number, x1: number, y: number) {
  p.shRect(x0, y, x1 - x0, 4, 10);
  p.obj(() => { p.r('b', x0, y, x1 - x0, 4); p.r('9', x0, y, x1 - x0, 1); p.r('a', x0, y + 1, x1 - x0, 2); for (let x = x0 + 6; x < x1; x += 32) { p.r('0', x, y - 1, 5, 6); p.r('9', x + 1, y, 3, 4); } });
}
function brownstoneBacks(p: Painter, y: number, h: number, rng: Rng) {
  for (let x = 0; x < SW; x += 112) {
    const ww = 112; roof(p, x, y, ww, h, 26, 'q', 'a');
    p.obj(() => {
      p.r('h', x + 1, y + h - 3, ww - 2, 2); // cornice
      for (let i = x + 4; i < x + ww - 4; i += 6) p.r('b', i, y + h - 3, 2, 2);
      const cx = x + rng.int(12, 40); p.r('0', cx, y + 10, 14, 12); p.r('a', cx + 1, y + 11, 12, 10); p.r('9', cx + 1, y + 11, 12, 1); p.r('0', cx + 4, y + 14, 6, 4); // chimney
    });
    skylight(p, x + rng.int(60, 80), y + 12, 22, 14, 0.9, rng.next());
    vent(p, x + rng.int(20, 90), y + h - 16);
    // fire escape on the rear wall
    const fx = x + rng.int(30, 60);
    p.shRect(fx, y + h, 36, 10, 6);
    p.obj(() => { p.r('0', fx, y + h, 36, 10); for (let i = 1; i < 36; i += 3) p.r('q', fx + i, y + h + 1, 1, 8); p.r('p', fx, y + h, 36, 1); p.line('p', fx + 30, y + h + 1, fx + 34, y + h + 9); });
    p.glow('q', 'g', x + 96, y + h + 2, 2, 2, 0.9, rng.next()); p.pool(x + 96, y + h + 8, 28);
  }
}
const backyard: LayerDef = { speed: 1, opaque: true, paint(p, z) {
  const r = z.r; const top = z.s % 3 === 0 ? 72 : 0;
  grass(p, 0, 0, SW, SEG, r, 'k', 'j', 0.8);
  if (top) brownstoneBacks(p, 0, 64, r);
  // stepping stones / dirt patch
  const lots = [[0, 144], [148, 300], [304, 448]];
  const kinds = ['dog', 'pool', 'patio', 'garden', 'clothes', 'yard'];
  for (let i = kinds.length - 1; i > 0; i--) { const j = r.int(0, i); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
  lots.forEach(([x0, x1], li) => {
    const kind = kinds[li];
    const cx = (x0 + x1) >> 1, y0 = top + 14, y1 = SEG - 8;
    if (li === z.s % 3 && kind !== 'patio') for (let y = y0 + 8; y < y1 - 8; y += 20) { const sx = cx + Math.round(Math.sin((z.wy(y) + li * 50) / 40) * 14) + ((y / 20) % 2 ? 4 : -4); p.ell('0', sx, y + 3, 6, 4); p.ell('q', sx, y + 3, 5, 3); p.r('p', sx - 3, y + 1, 4, 1); }
    if (kind === 'dog') { doghouse(p, x0 + 20, y0 + 30); p.r('b', x0 + 20, y0 + 70, 40, 2); }
    else if (kind === 'pool') { kiddiePool(p, cx + 10, y0 + 60); bin(p, x1 - 18, y1 - 20, 'k'); }
    else if (kind === 'patio') { patio(p, x0 + 8, y0 + 4, x1 - x0 - 16, 90, r); umbrellaTable(p, cx, y0 + 48); grill(p, x1 - 22, y0 + 18); }
    else if (kind === 'garden') { garden(p, x0 + 12, y0 + 16, x1 - x0 - 24, 40, r); garden(p, x0 + 12, y0 + 72, (x1 - x0) / 2 - 12, 32, r); }
    else if (kind === 'clothes') { clothesline(p, x0 + 12, x1 - 12, y0 + 40, r); bin(p, x0 + 20, y1 - 30); bin(p, x0 + 36, y1 - 30, 'n'); }
    else { for (let i = 0; i < 6; i++) { const fx = r.int(x0 + 10, x1 - 10), fy = r.int(y0 + 10, y1 - 10); p.r(r.pick(['c', 'f', 't']), fx, fy, 1, 1); p.r('j', fx - 1, fy + 1, 3, 1); } p.obj(() => { p.disc('0', cx, y0 + 70, 5); p.disc('r', cx, y0 + 70, 4); p.r('c', cx - 2, y0 + 68, 2, 1); }); }
    if (r.chance(0.5)) stringLights(p, x0 + 6, y0 + 4, x1 - 6, y0 + 10, r);
  });
  fenceV(p, 144, top ? 64 : 0, SEG); fenceV(p, 300, top ? 64 : 0, SEG);
  fenceH(p, 0, SW, top ? 64 : 0);
  if (!top) lamp(p, 224, 100, 34);
} };
const treesFg = (keys = ['1', 'k', 'j'], density = 0.6): LayerDef => ({ speed: 1.35, paint(p, z) {
  const r = z.r;
  if (r.chance(density)) canopy(p, r.chance(0.5) ? r.int(-10, 70) : r.int(380, 460), r.int(50, 200), r.int(30, 46), r, keys);
  if (r.chance(density * 0.5)) canopy(p, r.int(120, 330), r.int(40, 210), r.int(22, 30), r, keys);
} });

// ---------------------------------------------------------------- STREET
const street: LayerDef = { speed: 1, opaque: true, paint(p, z) {
  const r = z.r; const cross = z.s % 4 === 3; const cy0 = 150, cy1 = 230;
  // road
  p.r('v', 0, 0, SW, SEG);
  for (let i = 0; i < 90; i++) p.r('1', r.int(120, 328), r.int(0, SEG - 1), r.int(2, 4), 1);
  for (let i = 0; i < 18; i++) p.r('q', r.int(120, 328), r.int(0, SEG - 1), 1, 1);
  const segs: [number, number][] = cross ? [[0, cy0], [cy1, SEG]] : [[0, SEG]];
  // centre line + lanes
  for (const [a, b] of segs) for (let y = a; y < b; y += 32) { if (y + 14 < b) { p.r('g', 222, y + 4, 2, 14); p.r('g', 225, y + 4, 2, 14); } }
  for (const side of [0, 1]) {
    const sx = side ? 328 : 64; // sidewalk x
    for (const [a, b] of segs) {
      p.r('q', sx, a, 56, b - a);
      for (let y = a; y < b; y += 28) p.r('v', sx, y, 56, 1);
      p.r('v', sx + 28, a, 1, b - a);
      p.r(side ? 'p' : 'p', side ? sx : sx + 54, a, 2, b - a); // curb
      p.r('0', side ? sx - 1 : sx + 56, a, 1, b - a);
      // buildings: brownstone roofs with cornice toward the street
      const bx = side ? 384 : 0;
      for (let y = a; y < b; y += 64) {
        const hh = Math.min(64, b - y);
        if (hh < 20) continue;
        roof(p, bx, y, 64, hh, 30, 'q', 'b');
        const cornX = side ? bx : bx + 60;
        p.obj(() => { p.r('h', cornX, y + 1, 4, hh - 2); for (let j = y + 3; j < y + hh - 3; j += 5) p.r('b', cornX + (side ? 0 : 2), j, 2, 2); });
        skylight(p, bx + 20, y + 18, 16, 12, 0.85, r.next());
        if (r.chance(0.5)) vent(p, bx + (side ? 50 : 14), y + 46);
        // stoop
        const st = side ? sx + 56 - 56 - 0 : sx; const stx = side ? 384 - 14 : 64;
        if (hh >= 40) { p.shRect(stx, y + 22, 14, 18, 4); p.obj(() => { p.r('0', stx, y + 22, 14, 18); for (let i = 0; i < 5; i++) p.r(i % 2 ? 'a' : '9', side ? stx + 1 + i * 2 + 2 : stx + 1 + (4 - i) * 2, y + 23, 2, 16); p.r('0', stx, y + 22, 14, 1); }); void st; }
      }
      // trees pits / lamps / hydrant
      for (let y = a + 20; y < b - 20; y += 64) {
        const tx = side ? sx + 34 : sx + 14;
        p.r('0', tx - 1, y - 1, 14, 14); p.r('b', tx, y, 12, 12); p.r('a', tx + 3, y + 3, 6, 6);
      }
      if (b - a > 100) lamp(p, side ? sx + 6 : sx + 48, a + 54, 44);
      if (r.chance(0.5) && b - a > 120) { const hx = side ? sx + 8 : sx + 44, hy = a + r.int(90, b - a - 10); p.shEll(hx, hy, 3, 3, 6); p.obj(() => { p.disc('0', hx, hy, 4); p.disc('r', hx, hy, 3); p.r('c', hx - 1, hy - 2, 1, 1); }); }
      if (r.chance(0.4) && b - a > 120) { const mx = side ? sx + 12 : sx + 36, my = a + r.int(110, b - a - 20); p.shRect(mx, my, 10, 12, 10); p.obj(() => { p.r('0', mx, my, 10, 12); p.r('n', mx + 1, my + 1, 8, 10); p.r('m', mx + 1, my + 1, 8, 2); }); }
    }
  }
  // parked cars
  for (const [a, b] of segs) for (const lane of [124, 302]) for (let y = a + 6; y + 46 < b; y += 52) if (r.chance(0.55)) car(p, lane, y + r.int(0, 4), r.pick(['n', 'e', 'u', 'h', 'k', 'q', '2']), lane > 200);
  if (cross) {
    p.r('v', 0, cy0, SW, cy1 - cy0);
    for (let x = 0; x < SW; x += 40) { p.r('g', x + 6, cy0 + 38, 14, 2); p.r('g', x + 6, cy0 + 41, 14, 2); }
    for (const [x0, x1] of [[64, 120], [328, 384]]) for (const yy of [cy0 + 4, cy1 - 18]) void yy, void x1, void x0;
    for (let x = 124; x < 324; x += 10) { p.r('p', x, cy0 + 4, 6, 14); p.r('p', x, cy1 - 18, 6, 14); }
    for (let y = cy0 + 24; y < cy1 - 24; y += 10) { p.r('p', 70, y, 14, 6); p.r('p', 364, y, 14, 6); }
    p.r('o', 128, cy0 - 3, 64, 2); p.r('o', 256, cy1 + 1, 64, 2);
    p.disc('0', 200, cy0 + 50, 7); p.disc('q', 200, cy0 + 50, 6); p.ring('1', 200, cy0 + 50, 4, 4, 1);
    lamp(p, 60, cy0 - 6, 40); lamp(p, 388, cy1 + 6, 40);
  } else {
    const my = r.int(30, 200); p.disc('0', 188, my, 7); p.disc('q', 188, my, 6); p.ring('1', 188, my, 4, 4, 1); p.r('1', 186, my - 1, 5, 1); p.r('1', 186, my + 1, 5, 1);
  }
} };

// ---------------------------------------------------------------- PARK
function aFrame(p: Painter, x: number, y: number) {
  p.shRect(x, y, 36, 70, 16);
  p.obj(() => {
    p.r('0', x - 1, y - 1, 38, 72);
    p.r('n', x, y, 36, 35); p.r('2', x, y + 35, 36, 35);
    p.r('h', x, y, 36, 14); p.r('a', x, y + 56, 36, 14);
    for (let j = 4; j < 70; j += 6) p.r(j < 35 ? 'm' : '1', x + 2, y + j, 32, 1);
    p.r('o', x, y + 34, 36, 2);
  });
}
function weavePoles(p: Painter, x: number, y: number) {
  for (let i = 0; i < 6; i++) { const yy = y + i * 14, xx = x + (i % 2) * 3; p.shRect(xx, yy, 3, 3, 12); p.obj(() => { p.r('0', xx - 1, yy - 1, 5, 5); p.r(i % 2 ? 'h' : 'o', xx, yy, 3, 3); }); }
  p.r('q', x + 1, y, 2, 72);
}
function tireJump(p: Painter, x: number, y: number) {
  p.shRect(x, y, 44, 6, 18);
  p.obj(() => { p.r('0', x, y, 44, 6); p.r('p', x + 1, y + 1, 42, 4); p.r('0', x + 12, y - 4, 20, 14); p.r('q', x + 13, y - 3, 18, 12); p.r('0', x + 16, y, 12, 6); p.r('h', x + 13, y - 3, 18, 2); });
}
function tunnel(p: Painter, x: number, y: number, len: number) {
  p.shRect(x, y, 22, len, 12);
  p.obj(() => { p.r('0', x - 1, y, 24, len); p.r('u', x, y, 22, len); p.r('t', x + 3, y, 3, len); p.r('2', x + 16, y, 5, len); for (let j = 3; j < len; j += 7) p.r('e', x, y + j, 22, 2); p.r('0', x + 3, y, 16, 3); p.r('0', x + 3, y + len - 3, 16, 3); });
}
function pond(p: Painter, cx: number, cy: number, rng: Rng) {
  p.ell('0', cx, cy, 52, 32); p.ell('b', cx, cy, 51, 31); p.ell('n', cx, cy, 48, 28); p.ell('2', cx + 4, cy + 4, 40, 22); p.ell('n', cx - 2, cy - 2, 36, 18);
  for (let i = 0; i < 5; i++) { const x = cx + rng.int(-36, 36), y = cy + rng.int(-16, 16); p.ell('k', x, y, 5, 4); p.r('n', x, y - 1, 4, 1); p.r('j', x - 3, y - 2, 2, 1); }
  p.r('m', cx - 20, cy - 8, 8, 1); p.r('m', cx + 10, cy + 6, 6, 1);
}
const park: LayerDef = { speed: 1, opaque: true, paint(p, z) {
  const r = z.r;
  grass(p, 0, 0, SW, SEG, r, 'k', 'j', 0.7);
  // winding gravel path (continuous in world space)
  const px = (y: number) => 224 + Math.round(Math.sin(z.wy(y) / 170) * 96 + Math.sin(z.wy(y) / 61) * 10);
  for (let y = 0; y < SEG; y++) { const x = px(y); p.r('1', x - 17, y, 35, 1); p.r('q', x - 15, y, 31, 1); if ((y + z.s) % 5 === 0) p.r('p', x - 10 + ((y * 7) % 20), y, 1, 1); }
  // chain-link perimeter
  for (const fx of [6, 438]) { p.r('0', fx, 0, 3, SEG); p.checker('p', fx - 2, 0, 7, SEG); for (let y = 0; y < SEG; y += 32) { p.r('0', fx - 1, y, 5, 5); p.r('o', fx, y + 1, 3, 3); } }
  const side = px(128) > 224 ? 0 : 1; // put equipment on the open side
  const ex = side ? 260 : 40;
  const k = (z.s * 5 + r.int(0, 3)) % 4;
  if (k === 0) { aFrame(p, ex + 30, 60); weavePoles(p, ex + 110, 50); }
  else if (k === 1) { tunnel(p, ex + 20, 40, 120); tireJump(p, ex + 70, 140); }
  else if (k === 2) pond(p, ex + 80, 130, r);
  else { tireJump(p, ex + 20, 70); weavePoles(p, ex + 100, 110); bin(p, ex + 140, 40); }
  // flower beds and a picnic blanket on the open grass
  for (let i = 0; i < 2; i++) { const fx = side ? r.int(40, 150) : r.int(290, 400), fy = r.int(30, 220); if (Math.abs(px(fy) - fx) < 50) continue; p.ell('0', fx, fy, 15, 9); p.ell('b', fx, fy, 14, 8); for (let k2 = 0; k2 < 14; k2++) { const a = r.range(0, 6.28), d = r.range(0, 1); p.r(r.pick(['c', 'f', 't', 'd', '7']), fx + Math.cos(a) * d * 11, fy + Math.sin(a) * d * 5, 1, 1); p.r('j', fx + Math.cos(a) * d * 11 + 1, fy + Math.sin(a) * d * 5 + 1, 1, 1); } }
  if (r.chance(0.5)) { const bx = side ? r.int(40, 120) : r.int(300, 380), by = r.int(40, 200); if (Math.abs(px(by) - bx) > 60) { p.r('0', bx - 1, by - 1, 34, 26); for (let j = 0; j < 24; j += 6) for (let i2 = 0; i2 < 32; i2 += 6) p.r(((i2 + j) / 6) % 2 ? 'h' : '8', bx + i2, by + j, Math.min(6, 32 - i2), Math.min(6, 24 - j)); p.r('0', bx + 10, by + 8, 10, 8); p.r('a', bx + 11, by + 9, 8, 6); p.r('9', bx + 11, by + 9, 8, 1); } }
  // benches + lamps along the path
  for (const y of [40, 170]) { const x = px(y); bench(p, x + (y > 100 ? 22 : -34), y, true); }
  const ly = r.int(80, 140); lamp(p, px(ly) + 24, ly, 44);
  // ball / frisbee / paw prints
  if (r.chance(0.6)) { const bx = r.int(30, 410), by = r.int(20, 236); p.obj(() => { p.disc('0', bx, by, 4); p.disc('i', bx, by, 3); p.r('7', bx - 1, by - 2, 1, 1); }); }
  for (let i = 0; i < 6; i++) { const y = 20 + i * 36, x = px(y) + (i % 2 ? 6 : -8); p.r('v', x, y, 3, 3); p.r('v', x - 2, y - 3, 1, 1); p.r('v', x + 1, y - 4, 1, 1); p.r('v', x + 4, y - 3, 1, 1); }
} };

// ---------------------------------------------------------------- ALLEY
function dumpster(p: Painter, x: number, y: number) {
  p.shRect(x, y, 44, 26, 16);
  p.obj(() => { p.r('0', x - 1, y - 1, 46, 28); p.r('k', x, y, 44, 26); p.r('1', x, y + 12, 44, 2); p.r('j', x, y, 44, 1); p.r('j', x, y + 14, 44, 1); p.r('1', x + 21, y, 2, 26); p.r('q', x + 2, y + 2, 4, 2); p.r('q', x + 38, y + 2, 4, 2); });
}
function bags(p: Painter, x: number, y: number, rng: Rng) {
  for (let i = 0; i < 4; i++) { const bx = x + rng.int(0, 22), by = y + rng.int(0, 14), rr = rng.int(5, 7); p.shEll(bx, by, rr, rr, 4); p.obj(() => { p.disc('0', bx, by, rr + 1); p.disc('1', bx, by, rr); p.disc('q', bx - 2, by - 2, 2); p.r('p', bx - 3, by - 3, 1, 1); }); }
}
function puddle(p: Painter, x: number, y: number, rng: Rng) {
  p.ell('1', x, y, 18, 7); p.ell('2', x + 6, y + 1, 12, 5); p.ell('2', x - 8, y - 1, 9, 4); p.r('n', x - 6, y - 2, 6, 1); p.r('n', x + 6, y + 2, 4, 1);
  void rng;
}
function fireEscape(p: Painter, x: number, y: number, left: boolean) {
  const w = 22, h = 48;
  p.shRect(x, y, w, h, 18);
  p.obj(() => {
    p.r('0', x, y, w, h);
    for (let j = 2; j < h - 1; j += 3) p.r('q', x + 1, y + j, w - 2, 1);
    p.r('p', left ? x + w - 2 : x, y, 2, h); p.r('p', x, y, w, 1); p.r('p', x, y + h - 1, w, 1);
    for (let j = 6; j < h - 6; j += 4) p.r('o', left ? x + 4 : x + w - 8, y + j, 4, 1);
  });
}
const alley: LayerDef = { speed: 1, opaque: true, paint(p, z) {
  const r = z.r;
  p.r('v', 96, 0, 256, SEG);
  for (let i = 0; i < 40; i++) { const x = r.int(100, 340), y = r.int(0, SEG - 4); p.line('1', x, y, x + r.int(-4, 4), y + r.int(2, 6)); }
  // centre drain gutter
  p.r('1', 222, 0, 4, SEG); for (let y = 0; y < SEG; y += 64) { p.r('0', 216, y + 20, 16, 12); for (let i = 0; i < 4; i++) p.r('q', 218 + i * 4, y + 21, 2, 10); }
  puddle(p, r.int(130, 320), r.int(30, 220), r);
  if (r.chance(0.6)) puddle(p, r.int(130, 320), r.int(30, 220), r);
  // buildings either side (roofs) + wall shadow
  for (const side of [0, 1]) {
    const bx = side ? 352 : 0;
    let y = -(z.s * 37 % 64);
    while (y < SEG) { const hh = r.int(80, 140); roof(p, bx, y, 96, hh, 40, r.pick(['q', 'v']), r.pick(['p', 'b', 'h'])); acUnit(p, bx + r.int(20, 50), y + r.int(20, Math.max(24, hh - 40))); y += hh; }
    for (let fy = 20; fy < SEG - 50; fy += r.int(90, 120)) fireEscape(p, side ? 330 : 96, fy, !side);
  }
  // clutter
  const items = r.int(4, 5);
  for (let i = 0; i < items; i++) {
    const left = i % 2 === (z.s & 1); const y = 10 + i * 48 + r.int(0, 16);
    const x = left ? 122 : 286;
    const k = r.int(0, 4);
    if (k === 4) { p.obj(() => { p.disc('0', x + 6, y + 6, 5); p.disc('p', x + 6, y + 6, 4); p.disc('a', x + 6, y + 6, 2); p.disc('0', x + 18, y + 8, 5); p.disc('n', x + 18, y + 8, 4); p.disc('7', x + 18, y + 8, 2); p.r('9', x + 2, y + 18, 22, 14); p.r('a', x + 2, y + 25, 22, 1); p.r('b', x + 12, y + 18, 1, 14); }); }
    else if (k === 0) dumpster(p, left ? x : x - 6, y);
    else if (k === 1) bags(p, x, y, r);
    else if (k === 2) { crate(p, x, y, 20, 20); crate(p, x + 6, y + 22, 18, 18, '9'); }
    else { p.shRect(x, y, 18, 14, 6); p.obj(() => { p.r('0', x, y, 18, 14); p.r('n', x + 1, y + 1, 16, 12); for (let i2 = 3; i2 < 16; i2 += 4) p.r('2', x + i2, y + 2, 2, 10); }); }
  }
  // bodega: awning + neon sign + door light
  if (z.s % 2 === 0) {
    const ay = r.int(60, 160);
    p.shRect(96, ay, 26, 54, 12);
    p.obj(() => { p.r('0', 96, ay, 26, 54); for (let j = 0; j < 54; j += 6) p.r(j % 12 ? '7' : 'k', 96, ay + j + 1, 25, 5); p.r('j', 96, ay + 1, 2, 52); });
    p.obj(() => { p.r('0', 74, ay + 6, 20, 42); p.r('1', 75, ay + 7, 18, 40); });
    p.obj(() => { const nx = 79, ny = ay + 10; for (const [dx, dy, w, h] of [[0, 0, 10, 1], [0, 0, 1, 34], [9, 0, 1, 34], [0, 33, 10, 1], [3, 6, 4, 4], [3, 16, 4, 1], [3, 22, 4, 6]]) p.glow('e', dx < 1 || dx > 8 || dy === 0 || dy === 33 ? 'd' : 'l', nx + dx, ny + dy, w, h); });
    p.pool(130, ay + 27, 46);
  }
  p.pool(r.chance(0.5) ? 110 : 338, r.int(30, 220), 34);
} };
const laundryFg: LayerDef = { speed: 1.45, paint(p, z) {
  const r = z.r;
  for (let n = 0; n < 2; n++) if (r.chance(0.55)) {
    const y = r.int(20, 220), y2 = y + r.int(-10, 10);
    p.line('0', 80, y, 368, y2);
    for (let x = 100; x < 350; x += r.int(16, 30)) { const yy = Math.round(y + ((y2 - y) * (x - 80)) / 288); const k = r.pick(['n', 'e', '9', 'u', 'p', 'h', 'k']); const ww = r.int(8, 14), hh = r.int(10, 18); p.r('0', x, yy + 1, ww, hh); p.r(k, x + 1, yy + 1, ww - 2, hh - 1); p.r('0', x + 1, yy + 2, ww - 2, 1); }
  }
} };

// ---------------------------------------------------------------- ROOFTOPS
const cityBelow: LayerDef = { speed: 0.45, opaque: true, paint(p, z) {
  const r = z.r;
  p.r('1', 0, 0, SW, SEG);
  // tiny blocks far below
  for (let by = 0; by < SEG; by += 64) for (let bx = -8 + (z.s % 2) * 20; bx < SW; bx += 56) {
    p.r('v', bx + 6, by + 6, 44, 52); p.r('2', bx + 8, by + 8, 40, 48); p.r('3', bx + 8, by + 8, 40, 1); p.r('v', bx + 8 + r.int(8, 30), by + 8, 1, 48);
    for (let i = 0; i < 5; i++) p.glow('1', r.pick(['f', 'g', '7']), bx + r.int(10, 44), by + r.int(10, 52), 1, 1, 0.6, r.next());
    if (r.chance(0.3)) p.r('k', bx + 12, by + 12, 16, 12);
  }
  // avenues: lane lines + car lights
  for (let x = 2 + (z.s % 2) * 20; x < SW; x += 56) for (let y = 0; y < SEG; y += 12) { if (r.chance(0.1)) { p.glow('q', 'f', x - 1, y, 1, 1); p.glow('q', 'f', x + 1, y, 1, 1); } if (r.chance(0.08)) { p.glow('q', 'r', x + 2, y, 1, 1); } }
  for (let y = 0; y < SEG; y += 64) for (let x = 0; x < SW; x += 9) if (r.chance(0.12)) p.glow('q', 'g', x, y + 2, 1, 1, 0.8, r.next());
} };
/** occupancy grid (8px cells) for packing roof furniture without overlaps */
class Packer {
  cells = new Set<number>();
  constructor(public x: number, public y: number, public w: number, public h: number, public r: Rng) {}
  place(w: number, h: number, tries = 14): [number, number] | null {
    for (let t = 0; t < tries; t++) {
      const x = this.x + this.r.int(0, Math.max(0, Math.floor((this.w - w) / 8))) * 8, y = this.y + this.r.int(0, Math.max(0, Math.floor((this.h - h) / 8))) * 8;
      if (x + w > this.x + this.w || y + h > this.y + this.h) continue;
      let ok = true; const ks: number[] = [];
      for (let j = y - 4; j < y + h + 4 && ok; j += 8) for (let i = x - 4; i < x + w + 4; i += 8) { const k = (j >> 3) * 1000 + (i >> 3); if (this.cells.has(k)) { ok = false; break; } ks.push(k); }
      if (!ok) continue; ks.forEach(k => this.cells.add(k)); return [x, y];
    }
    return null;
  }
}
function solar(p: Painter, sx: number, sy: number, sw: number) {
  p.shRect(sx, sy, sw, 20, 4);
  p.obj(() => { p.r('0', sx, sy, sw, 20); p.r('2', sx + 1, sy + 1, sw - 2, 18); for (let k = sx + 1; k < sx + sw; k += 12) p.r('1', k, sy + 1, 1, 18); p.r('1', sx + 1, sy + 10, sw - 2, 1); p.r('3', sx + 1, sy + 1, sw - 2, 1); });
}
function bulkhead(p: Painter, x: number, y: number) {
  p.shRect(x, y, 26, 28, 24);
  p.obj(() => { p.r('0', x, y, 26, 28); p.r('p', x + 1, y + 1, 24, 26); p.r('o', x + 1, y + 1, 24, 1); p.r('q', x + 3, y + 4, 20, 20); p.r('v', x + 3, y + 14, 20, 1); });
  p.glow('q', 'f', x + 9, y + 28, 8, 2); p.pool(x + 13, y + 36, 24);
}
function roofGarden(p: Painter, x: number, y: number, w: number, h: number, rng: Rng) {
  p.r('b', x, y, w, h); for (let j = y + 1; j < y + h; j += 4) p.r('a', x + 1, j, w - 2, 3);
  for (let i = x + 24; i < x + w; i += 24) p.r('b', i, y, 1, h);
  planter(p, x, y, w, 12, rng); planter(p, x, y + 12, 12, h - 12, rng);
  p.obj(() => { const tx = x + (w >> 1) + 4, ty = y + (h >> 1) + 4; p.disc('0', tx, ty, 7); p.disc('7', tx, ty, 6); p.disc('8', tx + 1, ty + 1, 4); for (const [dx, dy] of [[-11, 0], [11, 0]]) { p.r('0', tx + dx - 3, ty + dy - 3, 7, 7); p.r('n', tx + dx - 2, ty + dy - 2, 5, 5); } });
  stringLights(p, x + 14, y + 16, x + w - 2, y + 20, rng);
  p.pool(x + (w >> 1), y + (h >> 1), 30);
}
function dish(p: Painter, x: number, y: number) {
  p.shEll(x, y, 6, 6, 10);
  p.obj(() => { p.disc('0', x, y, 7); p.disc('o', x, y, 6); p.disc('p', x + 1, y + 1, 4); p.line('q', x, y, x + 4, y - 4); p.r('r', x + 4, y - 4, 1, 1); });
}
function coop(p: Painter, x: number, y: number) {
  p.shRect(x, y, 30, 22, 12);
  p.obj(() => { p.r('0', x, y, 30, 22); p.r('a', x + 1, y + 1, 28, 20); p.r('9', x + 1, y + 1, 28, 1); for (let i = x + 4; i < x + 28; i += 4) p.r('b', i, y + 4, 1, 15); p.r('b', x + 3, y + 11, 24, 1); });
}
const rooftops: LayerDef = { speed: 1, paint(p, z) {
  const r = z.r; const gap = 40; const bh = SEG - gap;
  let x = -r.int(0, 24);
  while (x < SW) {
    const w = r.int(3, 5) * 32; const split = r.chance(0.7);
    const rows: [number, number][] = split ? (() => { const m = r.int(2, 4) * 32 + 8; return [[r.int(0, 1) * 8, m - 4], [m + 4, bh - m - 4 - r.int(0, 1) * 8]]; })() : [[r.int(0, 2) * 8, bh - r.int(0, 2) * 8]];
    for (const [y, h0] of rows) {
      const h = Math.max(48, h0);
      const height = r.int(14, 40); const rim = r.pick(['p', 'b', 'h', 'p', 'a']);
      roof(p, x, y, w - 4, h, height, r.pick(['q', 'q', 'v']), rim);
      const pk = new Packer(x + 8, y + 8, w - 20, h - 16, r);
      const want = ['tower', 'ac', 'vent', 'sky', 'ac', 'dish', 'vent', 'chimney', 'tower', 'sky'];
      if (r.chance(0.35) && w >= 128 && h >= 80) { const at = pk.place(Math.min(w - 28, 112), Math.min(h - 24, 72)); if (at) roofGarden(p, at[0], at[1], Math.min(w - 28, 112), Math.min(h - 24, 72), r); }
      if (r.chance(0.3) && w >= 128) { const at = pk.place(96, 20); if (at) solar(p, at[0], at[1], 96); const at2 = pk.place(96, 20); if (at2) solar(p, at2[0], at2[1], 96); }
      if (r.chance(0.5)) { const at = pk.place(26, 28); if (at) bulkhead(p, at[0], at[1]); }
      const nItems = Math.round((w * h) / 2600) + r.int(1, 3);
      for (let i = 0; i < nItems; i++) {
        const f = r.pick(want);
        if (f === 'tower') { const rr = r.int(12, 15); const at = pk.place(rr * 2 + 4, rr * 2 + 4); if (at) waterTower(p, at[0] + rr + 2, at[1] + rr + 2, rr); }
        else if (f === 'ac') { const at = pk.place(22, 16); if (at) acUnit(p, at[0], at[1]); }
        else if (f === 'vent') { const at = pk.place(10, 10); if (at) vent(p, at[0] + 5, at[1] + 5); }
        else if (f === 'sky') { const at = pk.place(24, 16); if (at) skylight(p, at[0], at[1], 24, 16, 0.85, r.next()); }
        else if (f === 'dish') { const at = pk.place(14, 14); if (at) dish(p, at[0] + 7, at[1] + 7); }
        else if (f === 'chimney') { const at = pk.place(16, 12); if (at) { const [cx, cy] = at; p.shRect(cx, cy, 16, 12, 16); p.obj(() => { p.r('0', cx, cy, 16, 12); p.r('h', cx + 1, cy + 1, 14, 10); p.r('a', cx + 1, cy + 6, 14, 1); p.r('0', cx + 3, cy + 3, 4, 4); p.r('0', cx + 9, cy + 3, 4, 4); }); } }
      }
      if (r.chance(0.25)) { const at = pk.place(30, 22); if (at) coop(p, at[0], at[1]); }
    }
    x += w + r.pick([0, 0, 8, 16]);
  }
} };
const pigeonsFg: LayerDef = { speed: 1.6, paint(p, z) {
  const r = z.r;
  if (r.chance(0.45)) { const cx = r.int(60, 380), cy = r.int(40, 200); for (let i = 0; i < r.int(3, 5); i++) { const x = cx + r.int(-30, 30), y = cy + r.int(-20, 20); p.r('0', x - 4, y, 9, 2); p.r('q', x - 3, y, 7, 1); p.r('0', x, y - 1, 2, 4); p.r('p', x, y - 2, 1, 1); } }
  if (r.chance(0.35)) { const x = r.int(40, 400), y = r.int(30, 220); for (let i = 0; i < 4; i++) p.checker('3', x + i * 6, y - i * 8, 18 - i * 2, 6); }
} };

// ---------------------------------------------------------------- CAFE
function cafeTable(p: Painter, cx: number, cy: number, rng: Rng) {
  for (const [dx, dy] of [[-17, 0], [17, 0], [0, -17], [0, 17]]) { if (rng.chance(0.25)) continue; const x = cx + dx, y = cy + dy; p.shRect(x - 5, y - 5, 10, 10, 6); p.obj(() => { p.r('0', x - 5, y - 5, 10, 10); p.r('b', x - 4, y - 4, 8, 8); p.r('a', x - 4, y - 4, 8, 2); }); }
  p.shEll(cx, cy, 12, 12, 14);
  p.obj(() => {
    p.disc('0', cx, cy, 13); p.disc('q', cx, cy, 12); p.disc('p', cx - 1, cy - 1, 10); p.disc('q', cx + 1, cy + 1, 8);
    const ux = cx + rng.int(-5, 3), uy = cy + rng.int(-5, 3); p.disc('0', ux, uy, 3); p.disc('7', ux, uy, 2); p.r('a', ux, uy, 1, 1);
    if (rng.chance(0.6)) { p.disc('0', cx - 4, cy + 4, 3); p.disc('8', cx - 4, cy + 4, 2); }
  });
}
function catBed(p: Painter, cx: number, cy: number) {
  p.shEll(cx, cy, 12, 10, 4);
  p.obj(() => { p.ell('0', cx, cy, 13, 11); p.ell('e', cx, cy, 12, 10); p.ell('d', cx - 1, cy - 1, 10, 8); p.ell('e', cx, cy, 8, 6); p.ell('u', cx + 1, cy + 1, 6, 4); p.r('c', cx - 6, cy - 6, 3, 1); });
}
function catTree(p: Painter, cx: number, cy: number) {
  p.shRect(cx - 18, cy - 18, 36, 36, 26);
  p.obj(() => {
    p.r('0', cx - 19, cy - 19, 38, 38); p.r('u', cx - 18, cy - 18, 36, 36); p.r('t', cx - 18, cy - 18, 36, 1);
    p.disc('0', cx + 8, cy + 8, 8); p.disc('9', cx + 8, cy + 8, 7); p.ring('a', cx + 8, cy + 8, 5, 5, 1); p.ring('a', cx + 8, cy + 8, 3, 3, 1);
    p.disc('0', cx - 6, cy - 6, 12); p.disc('e', cx - 6, cy - 6, 11); p.disc('u', cx - 7, cy - 7, 9); p.disc('0', cx - 6, cy - 6, 3);
    p.r('c', cx - 10, cy + 6, 2, 8); p.disc('t', cx - 9, cy + 15, 2);
  });
}
const cafe: LayerDef = { speed: 1, opaque: true, paint(p, z) {
  const r = z.r;
  // floor: dark hex-ish tiles in plum/indigo, quiet grout
  for (let y = 0; y < SEG; y += 32) for (let x = 0; x < SW; x += 32) { p.r(((x + y) / 32) % 2 ? 'q' : 'v', x, y, 32, 32); p.r('1', x, y, 32, 1); p.r('1', x, y, 1, 32); }
  // counter on the left
  p.shRect(0, 0, 70, SEG, 18);
  p.obj(() => {
    p.r('0', 0, 0, 70, SEG); p.r('a', 0, 0, 68, SEG); p.r('9', 64, 0, 4, SEG); p.r('b', 0, 0, 4, SEG);
    for (let y = 0; y < SEG; y += 32) p.r('b', 4, y, 60, 1);
  });
  const ey = r.int(10, 130);
  p.obj(() => { p.r('0', 10, ey, 40, 32); p.r('p', 11, ey + 1, 38, 30); p.r('o', 11, ey + 1, 38, 2); p.r('q', 14, ey + 8, 32, 14); p.r('0', 18, ey + 22, 6, 6); p.r('0', 34, ey + 22, 6, 6); });
  p.glow('q', 'r', 44, ey + 4, 2, 2); p.glow('q', 'i', 40, ey + 4, 2, 2);
  p.obj(() => { const cy = (ey + 120) % 220 + 10; p.r('0', 8, cy, 52, 26); p.r('2', 9, cy + 1, 50, 24); p.r('n', 9, cy + 1, 50, 2); for (let i = 0; i < 6; i++) { p.disc('0', 16 + i * 7, cy + 14, 3); p.disc(i % 2 ? '8' : 'c', 16 + i * 7, cy + 14, 2); } });
  for (let y = 24; y < SEG; y += 52) { const sy = y; p.shEll(84, sy, 6, 6, 10); p.obj(() => { p.disc('0', 84, sy, 7); p.disc('e', 84, sy, 6); p.disc('d', 83, sy - 1, 3); }); }
  // windows + plants on the right wall
  p.obj(() => { p.r('0', SW - 30, 0, 30, SEG); p.r('b', SW - 28, 0, 28, SEG); for (let y = 8; y < SEG; y += 64) { p.r('0', SW - 26, y, 22, 48); p.glow('2', 'g', SW - 24, y + 2, 18, 44, 1); p.r('1', SW - 15, y + 2, 1, 44); } });
  for (let y = 40; y < SEG; y += 128) { const px = SW - 46, py = y; p.shEll(px, py, 9, 9, 12); p.obj(() => { p.disc('0', px, py, 10); p.disc('h', px, py, 9); for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.28; p.ell('k', px + Math.cos(a) * 6, py + Math.sin(a) * 6, 4, 4); } p.disc('j', px - 1, py - 1, 3); }); }
  // a rug with tables or cat furniture
  const k = (z.s + r.int(0, 2)) % 3;
  if (k === 0) { p.ell('0', 230, 128, 92, 62); p.ell('e', 230, 128, 90, 60); p.ell('v', 230, 128, 86, 56); p.ring('e', 230, 128, 80, 50, 1); for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.28; p.disc('u', 230 + Math.cos(a) * 60, 128 + Math.sin(a) * 34, 3); } cafeTable(p, 190, 110, r); cafeTable(p, 272, 150, r); catBed(p, 240, 80); }
  else if (k === 1) { for (const [tx, ty] of [[140, 50], [250, 60], [340, 120], [160, 180], [280, 210]]) cafeTable(p, tx + r.int(-8, 8), ty + r.int(-8, 8), r); p.pool(250, 60, 40); p.pool(160, 180, 40); }
  else { p.r('0', 120, 40, 200, 180); p.r('u', 121, 41, 198, 178); p.r('2', 123, 43, 194, 174); for (let j = 47; j < 214; j += 6) for (let i = 127 + (j % 12 ? 3 : 0); i < 314; i += 6) p.r('v', i, j, 1, 1); catTree(p, 180, 100); catBed(p, 270, 90); catBed(p, 260, 180); p.obj(() => { p.disc('0', 160, 190, 6); p.disc('l', 160, 190, 5); p.line('m', 156, 188, 163, 193); p.line('0', 165, 194, 180, 205); }); }
  p.pool(200, r.int(60, 200), 38);
} };
const pendantsFg: LayerDef = { speed: 1.3, paint(p, z) {
  const r = z.r;
  for (let i = 0; i < 2; i++) if (r.chance(0.6)) {
    const x = r.int(110, 380), y = r.int(30, 220);
    p.disc('0', x, y, 9); p.disc('v', x, y, 8); p.ring('q', x, y, 8, 8, 1); p.disc('1', x + 1, y + 1, 5); p.r('p', x - 5, y - 5, 2, 1);
    p.glow('2', 'f', x - 1, y - 1, 3, 3); p.glow('v', '7', x, y, 1, 1);
  }
  if (r.chance(0.4)) { const x = r.int(140, 330), y = r.int(60, 200); p.disc('0', x, y, 4); p.disc('q', x, y, 3); for (let i = 0; i < 4; i++) { const a = (i / 4) * 6.28 + 0.4; p.line('0', x + Math.cos(a) * 4, y + Math.sin(a) * 4, x + Math.cos(a) * 26, y + Math.sin(a) * 26); p.line('v', x + Math.cos(a) * 4 + 1, y + Math.sin(a) * 4, x + Math.cos(a) * 26 + 1, y + Math.sin(a) * 26); } }
} };

// ---------------------------------------------------------------- DOCKS
function fishCrate(p: Painter, x: number, y: number, rng: Rng) {
  p.shRect(x, y, 22, 16, 7);
  p.obj(() => {
    p.r('0', x, y, 22, 16); p.r('a', x + 1, y + 1, 20, 14); p.r('s', x + 3, y + 3, 16, 10); p.r('l', x + 3, y + 3, 16, 1);
    for (let i = 0; i < 3; i++) { const fy = y + 4 + i * 3; const fx = x + 4 + rng.int(0, 4); p.r('p', fx, fy, 10, 2); p.r('o', fx, fy, 10, 1); p.r('0', fx + 1, fy, 1, 1); p.r('p', fx + 10, fy - 1, 2, 1); p.r('p', fx + 10, fy + 2, 2, 1); }
    p.r('b', x + 1, y + 1, 20, 1);
  });
}
function bollard(p: Painter, x: number, y: number) { p.shEll(x, y, 3, 3, 6); p.obj(() => { p.disc('0', x, y, 4); p.disc('q', x, y, 3); p.r('p', x - 1, y - 2, 2, 1); }); }
const docks: LayerDef = { speed: 1, opaque: true, paint(p, z) {
  const r = z.r;
  p.r('2', 0, 0, SW, SEG);
  for (let i = 0; i < 40; i++) { const x = r.int(0, SW), y = r.int(0, SEG); p.r(r.chance(0.75) ? 'n' : '3', x, y, r.int(3, 8), 1); }
  // boardwalk on the left (continuous)
  const bw = 104;
  p.r('1', bw, 0, 6, SEG); // shadow on water
  p.r('0', 0, 0, bw + 1, SEG); p.r('p', 0, 0, bw, SEG);
  for (let y = 0; y < SEG; y += 8) { p.r('q', 0, y, bw, 1); for (let x = (y / 8 % 2) * 26; x < bw; x += 52) p.r('q', x, y, 1, 8); p.r('o', 2 + (y * 13) % 90, y + 3, 1, 1); }
  for (let y = 12; y < SEG; y += 48) bollard(p, bw - 6, y);
  // finger piers + boats
  const fy = r.int(40, 70); const len = r.int(220, 300);
  p.r('1', bw, fy + 34, len + 6, 5);
  p.r('0', bw, fy - 1, len + 1, 34); p.r('p', bw, fy, len, 32);
  for (let x = bw; x < bw + len; x += 8) p.r('q', x, fy, 1, 32);
  for (let x = bw + 8; x < bw + len; x += 40) { p.disc('0', x, fy - 1, 3); p.disc('b', x, fy - 1, 2); p.disc('0', x, fy + 33, 3); p.disc('b', x, fy + 33, 2); }
  fishCrate(p, bw + r.int(30, 60), fy + 8, r); fishCrate(p, bw + r.int(100, 140), fy + 8, r);
  if (r.chance(0.6)) { const cx = bw + r.int(160, len - 30); p.obj(() => { p.ring('0', cx, fy + 16, 9, 9, 1); p.ring('9', cx, fy + 16, 8, 8, 2); p.ring('a', cx, fy + 16, 5, 5, 1); p.ring('9', cx, fy + 16, 3, 3, 1); }); }
  lamp(p, bw + len - 10, fy + 16, 46);
  // boats moored above/below the pier
  boat(p, bw + r.int(16, 60), fy + 44, 30, r.int(84, 110), r.pick(['p', 'h', 'k', 'n', 'e']), r, r.chance(0.5));
  if (r.chance(0.8)) boat(p, bw + r.int(120, 180), fy + 42, 34, r.int(90, 130), r.pick(['p', 'h', 'o']), r, false);
  if (fy > 54 && len < 280) boat(p, bw + len + 12, 4, 22, 46, r.pick(['h', 'k', 'n']), r, true);
  // stacked crates and nets on the boardwalk
  for (let y = 20; y < SEG - 30; y += r.int(50, 80)) { const k = r.int(0, 2); if (k === 0) { fishCrate(p, 14, y, r); fishCrate(p, 16, y + 18, r); } else if (k === 1) { p.shEll(40, y + 10, 14, 10, 4); p.obj(() => { p.ell('0', 40, y + 10, 15, 11); p.ell('k', 40, y + 10, 14, 10); p.checker('1', 28, y + 2, 26, 18); }); } else { crate(p, 20, y, 24, 24); } }
  // buoys + lobster traps
  for (let i = 0; i < 3; i++) { const x = r.int(bw + 30, SW - 10), y = r.int(4, SEG - 4); p.obj(() => { p.disc('0', x, y, 3); p.disc('r', x, y, 2); p.r('7', x - 1, y - 1, 1, 1); }); }
  p.pool(50, r.int(40, 200), 40);
} };
const gullsFg: LayerDef = { speed: 1.7, paint(p, z) {
  const r = z.r;
  for (let i = 0; i < 2; i++) if (r.chance(0.5)) { const x = r.int(40, 400), y = r.int(20, 230); p.r('0', x - 5, y, 11, 2); p.r('o', x - 4, y, 4, 1); p.r('o', x + 1, y, 4, 1); p.r('0', x - 1, y - 2, 3, 5); p.r('7', x, y - 1, 1, 2); p.r('g', x, y - 3, 1, 1); }
} };

// ---------------------------------------------------------------- FACTORY
function yarnBall(p: Painter, x: number, y: number, k: string, hi: string) {
  p.disc('0', x, y, 8); p.disc(k, x, y, 7);
  p.ring(hi, x - 1, y - 1, 5, 4, 1); p.line(hi, x - 5, y + 2, x + 2, y - 5); p.line('0', x - 2, y + 5, x + 5, y - 2); p.r('7', x - 3, y - 4, 1, 1);
}
function conveyor(p: Painter, x: number, rng: Rng) {
  p.r('0', x - 2, 0, 36, SEG); p.r('p', x - 1, 0, 2, SEG); p.r('p', x + 31, 0, 2, SEG); p.r('v', x + 1, 0, 30, SEG);
  for (let y = 0; y < SEG; y += 6) p.r('1', x + 1, y, 30, 2);
  for (let y = 0; y < SEG; y += 32) { p.r('o', x - 1, y, 2, 2); p.r('o', x + 31, y, 2, 2); }
  for (let y = 10; y < SEG - 10; y += rng.int(28, 48)) { const [k, hi] = rng.pick([['e', 'd'], ['u', 't'], ['n', 'm'], ['k', 'j'], ['h', 'g']]); const yy = y; p.obj(() => yarnBall(p, x + 16, yy, k, hi)); }
}
function vat(p: Painter, cx: number, cy: number, k: string, hi: string) {
  p.shEll(cx, cy, 26, 26, 20);
  p.obj(() => { p.disc('0', cx, cy, 28); p.disc('p', cx, cy, 27); p.ring('o', cx - 1, cy - 1, 26, 26, 1); p.disc('q', cx, cy, 23); p.disc(k, cx, cy, 21); p.ring(hi, cx, cy, 14, 14, 1); p.ring(hi, cx + 3, cy + 2, 7, 7, 1); p.r('0', cx - 1, cy - 22, 2, 44); p.r('p', cx - 1, cy - 22, 1, 44); });
}
function spinner(p: Painter, x: number, y: number, rng: Rng) {
  const w = 96, h = 56;
  p.shRect(x, y, w, h, 22);
  p.obj(() => {
    p.r('0', x, y, w, h); p.r('q', x + 1, y + 1, w - 2, h - 2); p.r('p', x + 1, y + 1, w - 2, 2); p.r('p', x + 1, y + 1, 2, h - 2);
    for (let j = 0; j < 2; j++) for (let i = 0; i < 6; i++) { const cx = x + 10 + i * 15, cy = y + 16 + j * 24; const k = rng.pick(['e', 'u', 'n', 'k', 'h']); p.disc('0', cx, cy, 6); p.disc(k, cx, cy, 5); p.ring('7', cx, cy, 3, 3, 1); p.disc('0', cx, cy, 1); }
  });
  p.glow('1', 'i', x + w - 8, y + 4, 3, 2); p.glow('1', 'r', x + w - 14, y + 4, 3, 2, 0.6, rng.next());
}
const factory: LayerDef = { speed: 1, opaque: true, paint(p, z) {
  const r = z.r;
  // steel floor plates
  p.r('q', 0, 0, SW, SEG);
  for (let y = 0; y < SEG; y += 32) for (let x = 0; x < SW; x += 32) { p.r('v', x, y, 32, 1); p.r('v', x, y, 1, 32); p.r('p', x + 3, y + 3, 1, 1); p.r('p', x + 28, y + 3, 1, 1); p.r('p', x + 3, y + 28, 1, 1); p.r('p', x + 28, y + 28, 1, 1); if ((x / 32 + y / 32 + z.s) % 5 === 0) for (let j = 6; j < 28; j += 5) for (let i = 6 + (j % 2) * 2; i < 28; i += 5) p.r('v', x + i, y + j, 2, 1); }
  // hazard walkway edges
  for (const hx of [134, 306]) for (let y = 0; y < SEG; y += 8) { p.r('h', hx, y, 6, 4); p.r('0', hx, y + 4, 6, 4); }
  conveyor(p, 94, r); conveyor(p, 322, r);
  // pipes along the walls
  for (const px0 of [6, 420]) { p.shRect(px0, 0, 20, SEG, 10); p.obj(() => { p.r('0', px0, 0, 20, SEG); p.r('p', px0 + 1, 0, 18, SEG); p.r('o', px0 + 3, 0, 3, SEG); p.r('q', px0 + 14, 0, 4, SEG); for (let y = 16; y < SEG; y += 64) { p.r('0', px0 - 2, y, 24, 8); p.r('q', px0 - 1, y + 1, 22, 6); p.r('p', px0 - 1, y + 1, 22, 1); } }); }
  const k = (z.s + r.int(0, 2)) % 3;
  if (k === 0) { vat(p, 224, 80, 'e', 'd'); vat(p, 224, 190, 'u', 't'); }
  else if (k === 1) { spinner(p, 176, 40, r); spinner(p, 176, 150, r); }
  else { vat(p, 224, 100, 'n', 'm'); p.shRect(170, 170, 110, 40, 10); p.obj(() => { p.r('0', 170, 170, 110, 40); p.r('a', 171, 171, 108, 38); for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { const cx = 186 + i * 26, cy = 181 + j * 18; p.disc('0', cx, cy, 8); p.disc(r.pick(['e', 'u', 'k', 'h']), cx, cy, 7); p.disc('b', cx, cy, 3); } }); }
  // spools scattered on pallets near conveyors
  for (const sx of [44, 370]) { const sy = r.int(30, 200); crate(p, sx, sy, 32, 32, 'b'); p.obj(() => { for (let i = 0; i < 4; i++) { const cx = sx + 8 + (i % 2) * 16, cy = sy + 8 + (i >> 1) * 16; p.disc('0', cx, cy, 7); p.disc(r.pick(['e', 'u', 'n', 'k', 'h']), cx, cy, 6); p.ring('7', cx, cy, 3, 3, 1); } }); }
  p.pool(224, r.int(40, 220), 50);
} };
const girdersFg: LayerDef = { speed: 1.4, paint(p, z) {
  const r = z.r;
  if (r.chance(0.7)) {
    const y = r.int(20, 220);
    p.r('0', 0, y - 1, SW, 14); p.r('v', 0, y, SW, 12); p.r('q', 0, y, SW, 2); p.r('1', 0, y + 10, SW, 2);
    for (let x = 4; x < SW; x += 16) { p.r('q', x, y + 5, 2, 2); }
    for (let x = 16; x < SW; x += 48) p.line('1', x, y + 2, x + 24, y + 9);
    const lx = r.int(120, 330); p.r('0', lx - 6, y + 12, 12, 8); p.r('q', lx - 5, y + 12, 10, 6); p.glow('1', 'f', lx - 3, y + 17, 6, 2);
  }
} };

// ---------------------------------------------------------------- SKY / SPACE
/** cumulus seen from above at a low sun: lumpy lobes, flattened shaded base, small sunlit caps */
function cloudBank(p: Painter, cx: number, cy: number, r: number, rng: Rng, keys = ['2', '3', '4', '5']) {
  const lobes: [number, number, number][] = [];
  const n = rng.int(6, 9);
  for (let i = 0; i < n; i++) { const t = (i / (n - 1)) * 2 - 1; lobes.push([cx + t * r * 1.1 + rng.int(-4, 4), cy - (1 - t * t) * r * 0.35 + rng.int(-4, 4), Math.max(5, Math.round(r * (0.75 - Math.abs(t) * 0.35) * rng.range(0.85, 1.1)))]); }
  for (let i = 0; i < n; i += 2) lobes.push([cx + rng.int(-r, r) * 0.6, cy - rng.int(0, r) * 0.5, Math.round(r * rng.range(0.3, 0.45))]);
  const base = cy + r * 0.35;
  const lobe = (k: string, dx: number, dy: number, shrink: number, clip = true) => { for (const [x, y, rr] of lobes) spans(x + dx, y + dy, rr - shrink, rr - shrink, (sx, sy, w) => { if (!clip || sy < base + dy) p.r(k, sx, sy, w, 1); }); };
  lobe(keys[0], 3, 5, 0);          // underside shade
  lobe(keys[1], 0, 0, 0);          // body
  lobe(keys[2], -2, -3, 3, false); // lit tops
  lobe(keys[1], 1, 1, 6, false);   // body shows through: lobes read separately
  for (const [x, y, rr] of lobes) if (rr > 8) spans(x - rr * 0.4, y - rr * 0.5, rr * 0.22, rr * 0.12, (sx, sy, w) => p.r(keys[3], sx, sy, w, 1));
}
const skyFar: LayerDef = { speed: 0.35, opaque: true, paint(p, z) {
  // a sea of cloud tops far below: smooth world-space noise, dithered bands
  field(p, ['n', 'n', 'n', 'm'], (x, y) => { const w = z.wy(y); return 0.35 + 0.2 * Math.sin(x / 61 + Math.sin(w / 97) * 2) + 0.15 * Math.sin(w / 53 + x / 127); });
  const r = z.r;
  for (let i = 0; i < 9; i++) cloudBank(p, r.int(-20, SW + 20), r.int(10, SEG - 10), r.int(8, 16), r, ['2', '3', '3', '4']);
} };
const skyMain: LayerDef = { speed: 1, paint(p, z) {
  const r = z.r;
  const n = r.int(1, 3);
  for (let i = 0; i < n; i++) cloudBank(p, r.chance(0.5) ? r.int(-10, 110) : r.int(330, 460), r.int(50, 200), r.int(30, 44), r, ['2', '3', '4', '5']);
  if (r.chance(0.3)) cloudBank(p, r.int(150, 300), r.int(40, 210), r.int(16, 22), r, ['2', '3', '4', '5']);
} };
const wispsFg: LayerDef = { speed: 1.8, paint(p, z) {
  const r = z.r;
  for (let i = 0; i < 3; i++) if (r.chance(0.5)) { const x = r.int(-20, SW), y = r.int(0, SEG), w = r.int(30, 80); p.checker('m', x, y, w, 2); p.checker('4', x + 8, y + 2, w - 16, 1); }
} };
function stars(p: Painter, rng: Rng, n: number, keys: string[]) { for (let i = 0; i < n; i++) p.r(rng.pick(keys), rng.int(0, SW - 1), rng.int(0, SEG - 1), 1, 1); }
const starFar = (base = '0', n = 70): LayerDef => ({ speed: 0.25, opaque: true, paint(p, z) {
  p.r(base, 0, 0, SW, SEG); stars(p, z.r, n, ['2', '2', '3', 'v']);
  for (let i = 0; i < 6; i++) { const x = z.r.int(4, SW - 4), y = z.r.int(4, SEG - 4); p.r('4', x, y, 1, 1); p.r('2', x - 1, y, 1, 1); p.r('2', x + 1, y, 1, 1); p.r('2', x, y - 1, 1, 1); p.r('2', x, y + 1, 1, 1); }
} });
function catnipLeaf(p: Painter, x: number, y: number, rng: Rng) {
  const a = rng.range(0, 3.14); const len = rng.int(7, 11);
  for (let t = -len; t <= len; t++) { const w = Math.round(Math.sqrt(1 - (t / len) ** 2) * 4); for (let s = -w; s <= w; s++) p.r(Math.abs(s) === w ? '0' : s < 0 ? 'j' : 'k', x + Math.cos(a) * t - Math.sin(a) * s, y + Math.sin(a) * t + Math.cos(a) * s); }
  p.line('i', x - Math.cos(a) * (len - 2), y - Math.sin(a) * (len - 2), x + Math.cos(a) * (len - 2), y + Math.sin(a) * (len - 2));
}
const nebulaMain: LayerDef = { speed: 1, paint(p, z) {
  const r = z.r;
  // gas: dithered density bands (palette-exact soft edges), kept dark so hairballs read
  const blobs: [number, number, number, number][] = [];
  for (let i = 0; i < 4; i++) blobs.push([r.int(-40, SW + 40), r.int(-20, SEG + 20), r.int(50, 110), r.int(30, 60)]);
  field(p, ['v', 'v', '2', '2', 'e'], (x, y) => { let d = 0; for (const [bx, by, rx, ry] of blobs) { const dx = (x - bx) / rx, dy = (y - by) / ry; d = Math.max(d, 1 - (dx * dx + dy * dy)); } return d * 0.95 + Math.sin((x + z.wy(y)) / 19) * 0.05; }, 0.08);
  stars(p, r, 24, ['3', '4', 't']);
  for (let i = 0; i < r.int(1, 3); i++) catnipLeaf(p, r.int(20, SW - 20), r.int(20, SEG - 20), r);
} };
const streaksFg: LayerDef = { speed: 1.9, paint(p, z) {
  const r = z.r; for (let i = 0; i < 10; i++) { const x = r.int(0, SW), y = r.int(0, SEG); p.r(r.pick(['3', '4']), x, y, 1, r.int(3, 6)); }
} };

// MOON
function crater(p: Painter, cx: number, cy: number, rr: number, rng: Rng, litter: boolean) {
  p.ell('o', cx - 1, cy - 1, rr + 2, rr * 0.85 + 2); // sunlit outer rim
  p.ell('v', cx + 1, cy + 1, rr + 2, rr * 0.85 + 2);
  p.ell('p', cx, cy, rr + 1, rr * 0.85 + 1);
  p.ell('v', cx, cy, rr, rr * 0.85); // inner shadow wall
  p.ell('q', cx + 2, cy + 2, rr - 2, rr * 0.85 - 2); // floor
  if (litter) { for (let i = 0; i < rr * 3; i++) { const a = rng.range(0, 6.28), d = rng.range(0, rr - 4); const x = cx + 2 + Math.cos(a) * d, y = cy + 2 + Math.sin(a) * d * 0.8; p.r(rng.pick(['p', 'p', 'o', '5']), x, y, 2, 2); } for (let i = 0; i < rr / 5; i++) { const x = cx + rng.int(-rr / 2, rr / 2), y = cy + rng.int(-rr / 3, rr / 3); p.disc('0', x, y, 4); p.disc('o', x, y, 3); p.r('5', x - 1, y - 1, 1, 1); } }
}
const moon: LayerDef = { speed: 1, opaque: true, paint(p, z) {
  const r = z.r;
  p.r('q', 0, 0, SW, SEG);
  field(p, ['p', 'q', 'q', 'q', 'v', 'v'], (x, y) => { const w = z.wy(y); return 0.55 + 0.25 * Math.sin(x / 53 + Math.sin(w / 71) * 2.5) + 0.18 * Math.sin(w / 37 - x / 89); });
  for (let i = 0; i < 90; i++) p.r(r.chance(0.6) ? 'v' : 'p', r.int(0, SW), r.int(0, SEG), 1, 1);
  for (let i = 0; i < 6; i++) { const rr = r.int(4, 9); crater(p, r.int(10, SW - 10), r.int(10, SEG - 10), rr, r, false); }
  const big = r.int(1, 2); for (let i = 0; i < big; i++) crater(p, r.int(60, SW - 60), r.int(50, SEG - 50), r.int(26, 44), r, r.chance(0.7));
  // poodle paw-print trail (continuous)
  for (let y = 0; y < SEG; y += 18) { const x = 300 + Math.round(Math.sin(z.wy(y) / 90) * 60) + ((y / 18) % 2 ? 6 : -6); p.r('v', x, y, 4, 3); p.r('v', x - 1, y - 3, 1, 1); p.r('v', x + 1, y - 4, 2, 1); p.r('v', x + 4, y - 3, 1, 1); }
  if (z.s % 3 === 1) { // giant litter scoop
    const sx = r.int(60, 300), sy = r.int(40, 160); p.shRect(sx, sy, 70, 40, 8);
    p.obj(() => { p.r('0', sx, sy, 50, 40); p.r('h', sx + 1, sy + 1, 48, 38); for (let j = 6; j < 36; j += 6) p.r('b', sx + 6, sy + j, 38, 2); p.r('g', sx + 1, sy + 1, 48, 1); p.r('0', sx + 50, sy + 14, 26, 12); p.r('h', sx + 50, sy + 15, 25, 10); p.r('g', sx + 50, sy + 15, 25, 1); });
  }
  if (z.s % 4 === 2) { const fx = r.int(80, 360), fy = r.int(60, 200); p.shRect(fx, fy, 2, 2, 24); p.obj(() => { p.r('0', fx - 1, fy - 1, 3, 3); p.r('o', fx, fy, 1, 1); p.r('0', fx + 1, fy - 1, 16, 11); p.r('7', fx + 2, fy, 14, 9); p.r('c', fx + 6, fy + 2, 6, 5); p.r('6', fx + 7, fy + 3, 4, 3); }); }
} };

// STATION
function postColumn(p: Painter, cx: number, cy: number, rr: number) {
  p.shEll(cx, cy, rr, rr, 22);
  p.obj(() => { p.disc('0', cx, cy, rr + 1); p.disc('a', cx, cy, rr); for (let k = rr - 2; k > 2; k -= 3) p.ring(k % 2 ? '9' : 'a', cx, cy, k, k, 1); p.disc('8', cx - 1, cy - 1, 2); });
}
const station: LayerDef = { speed: 1, paint(p, z) {
  const r = z.r;
  // central truss spine (continuous)
  p.r('0', 200, 0, 48, SEG); p.r('q', 202, 0, 4, SEG); p.r('q', 242, 0, 4, SEG);
  for (let y = 0; y < SEG; y += 32) { p.line('q', 206, y, 241, y + 31); p.line('q', 241, y, 206, y + 31); p.r('p', 202, y, 44, 2); }
  p.r('p', 203, 0, 1, SEG);
  // carpeted deck modules either side
  for (const side of [0, 1]) {
    const mx = side ? 260 : 36, mw = 152; const my = r.int(10, 40), mh = r.int(120, 190);
    p.shRect(mx, my, mw, mh, 16);
    p.obj(() => {
      const ch = 10; // chamfer
      for (let j = 0; j < mh; j++) { const c = Math.max(0, ch - Math.min(j, mh - 1 - j)); p.r('0', mx + c, my + j, mw - 2 * c, 1); if (j > 0 && j < mh - 1) { const c2 = c + 1; p.r('p', mx + c2, my + j, mw - 2 * c2, 1); if (j > 2 && j < mh - 3) { const c3 = c + 3; p.r(j > 4 && j < mh - 5 ? 'v' : 'u', mx + c3, my + j, mw - 2 * c3, 1); if (j > 4 && j < mh - 5) { p.r('u', mx + c3, my + j, 2, 1); p.r('u', mx + mw - c3 - 2, my + j, 2, 1); } } } }
      for (let j = my + 10; j < my + mh - 10; j += 6) for (let i = mx + 10 + (j % 12 ? 3 : 0); i < mx + mw - 10; i += 6) p.r('2', i, j, 1, 1);
      p.r(side ? '0' : '0', side ? mx - 12 : mx + mw, my + mh / 2 - 6, 12, 12); p.r('q', side ? mx - 12 : mx + mw, my + mh / 2 - 5, 12, 10);
      for (let i = 0; i < 5; i++) p.glow('2', 'f', mx + 14 + i * 28, my + 3, 6, 2, 0.9, (i * 0.37) % 1);
    });
    postColumn(p, mx + r.int(30, 60), my + r.int(36, Math.max(37, mh - 40)), r.int(14, 20));
    if (mh > 150) postColumn(p, mx + r.int(90, 120), my + mh - 34, 12);
    p.obj(() => { const bx = mx + mw - 40, by = my + 24; p.r('0', bx, by, 28, 28); p.r('e', bx + 1, by + 1, 26, 26); p.r('u', bx + 1, by + 1, 26, 2); p.disc('0', bx + 14, by + 15, 6); });
    // solar panel wing
    const sy = my + mh + 14; if (sy < SEG - 30) { const sx = side ? 300 : 60; p.obj(() => { p.r('0', sx, sy, 100, 24); p.r('2', sx + 1, sy + 1, 98, 22); for (let i = sx + 1; i < sx + 99; i += 10) p.r('1', i, sy + 1, 1, 22); p.r('1', sx + 1, sy + 12, 98, 1); p.r('3', sx + 1, sy + 1, 98, 1); p.r('q', side ? sx - 40 : sx + 100, sy + 10, 40, 4); }); }
  }
} };

// MOTHERSHIP
const mothership: LayerDef = { speed: 1, paint(p, z) {
  const r = z.r;
  const L = 16, R = SW - 16;
  p.r('0', L, 0, R - L, SEG);
  for (let y = 0; y < SEG; y += 32) for (let x = L; x < R; x += 64) {
    const k = ((x / 64 + y / 32 + z.s) % 3 === 0) ? '2' : 'v';
    p.r(k, x + 1, y + 1, 63, 31); p.r('3', x + 1, y + 1, 63, 1); p.r('3', x + 1, y + 1, 1, 31); p.r('1', x + 1, y + 31, 63, 1);
    if (r.chance(0.25)) for (let i = 0; i < 5; i++) p.r('1', x + 10, y + 6 + i * 4, 44, 2);
  }
  // edges: armoured fins
  for (const [x0, dir] of [[L, 1], [R, -1]] as [number, number][]) { for (let y = 0; y < SEG; y += 64) { for (let j = 0; j < 40; j++) { const w = Math.round(14 - Math.abs(j - 20) * 0.7); p.r('2', dir > 0 ? x0 - w : x0, y + 12 + j, w, 1); } } }
  // glowing trenches (continuous)
  for (const tx of [120, 312]) {
    p.r('0', tx, 0, 16, SEG); p.r('1', tx + 2, 0, 12, SEG);
    for (let y = 0; y < SEG; y += 16) p.glow('e', 'd', tx + 7, y + 4, 2, 6);
    p.r('3', tx - 1, 0, 1, SEG); p.r('1', tx + 16, 0, 1, SEG);
  }
  // cat-face emblem
  if (z.s % 3 === 0) {
    const cx = 224, cy = 128;
    p.ell('0', cx, cy + 6, 46, 36); p.ell('1', cx, cy + 6, 44, 34);
    for (const sx of [-1, 1]) for (let j = 0; j < 30; j++) { const w = Math.round(j * 0.7); p.r('1', cx + sx * 30 - w, cy - 50 + j, w * 2 + 1, 1); }
    p.ell('u', cx, cy + 6, 38, 28); p.ell('2', cx, cy + 10, 34, 22);
    for (const sx of [-1, 1]) { p.ell('0', cx + sx * 15, cy + 2, 7, 5); p.glow('1', 'l', cx + sx * 15 - 4, cy + 1, 8, 2); }
    p.r('e', cx - 3, cy + 12, 6, 3); for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) p.r('3', sx > 0 ? cx + 12 : cx - 32, cy + 14 + i * 4, 20, 1);
  } else {
    for (let i = 0; i < 2; i++) { const cx = r.int(160, 290), cy = 40 + i * 120 + r.int(0, 40); p.shEll(cx, cy, 14, 14, 10); p.obj(() => { p.disc('0', cx, cy, 15); p.disc('q', cx, cy, 14); p.disc('2', cx + 1, cy + 1, 11); p.r('p', cx - 8, cy - 9, 6, 2); p.glow('n', 'l', cx - 2, cy - 2, 4, 4); }); }
  }
  for (let y = 8; y < SEG; y += 48) for (const wx of [40, 380]) for (let i = 0; i < 3; i++) p.glow('1', 'u', wx + i * 8, y, 5, 3, 0.8, r.next());
} };

const twinkle = (keys: string[]) => (px: (k: string, x: number, y: number, w?: number, h?: number) => void, scroll: number, t: number, seed: number) => {
  for (let i = 0; i < 9; i++) {
    const ph = (seed * (i + 3)) % 997; if (((t + ph * 7) % 90) > 14) continue;
    const x = (ph * 13 + i * 51) % SW, y = Math.floor((ph * 31 + scroll * 0.25) % 360);
    const k = keys[i % keys.length]; px(k, x, y); px(k, x - 1, y); px(k, x + 1, y); px(k, x, y - 1); px(k, x, y + 1); px('6', x, y);
  }
};

export const TILESETS: Record<string, Tileset> = {
  backyard: { id: 'backyard', speed: 0.4, base: 'k', main: backyard, fg: treesFg() },
  street: { id: 'street', speed: 0.6, base: 'v', main: street, fg: treesFg(['1', 'k', 'j'], 0.75) },
  park: { id: 'park', speed: 0.45, base: 'k', main: park, fg: treesFg(['1', 'k', 'j'], 0.9) },
  alley: { id: 'alley', speed: 0.5, base: 'v', main: alley, fg: laundryFg },
  rooftops: { id: 'rooftops', speed: 0.55, base: '1', far: cityBelow, main: rooftops, fg: pigeonsFg },
  cafe: { id: 'cafe', speed: 0.4, base: 'v', indoor: true, main: cafe, fg: pendantsFg },
  docks: { id: 'docks', speed: 0.5, base: 'n', main: docks, fg: gullsFg,
    anim: (px, scroll, t) => { for (let i = 0; i < 7; i++) { const x = 120 + ((i * 97) % 320), y = Math.floor((i * 71 + scroll) % 360); if (((t >> 3) + i) % 4 === 0) px('m', x, y, 3, 1); } } },
  factory: { id: 'factory', speed: 0.6, base: 'q', main: factory, fg: girdersFg },
  sky: { id: 'sky', speed: 0.8, base: 'n', far: skyFar, main: skyMain, fg: wispsFg },
  nebula: { id: 'nebula', speed: 0.7, space: true, base: '0', far: starFar('0', 80), main: nebulaMain, fg: streaksFg, anim: twinkle(['4', 't', 'l']) },
  moon: { id: 'moon', speed: 0.35, space: true, base: 'q', main: moon },
  station: { id: 'station', speed: 0.5, space: true, base: '0', far: starFar('0', 90), main: station, anim: twinkle(['4', 'l']) },
  mothership: { id: 'mothership', speed: 0.7, space: true, base: '0', far: starFar('1', 60), main: mothership },
};
TILESETS.space = TILESETS.nebula;
