// Polaroid photo composer. Every memory is its own little 88x64 pixel-art scene with its own framing: Maya's
// hands holding a puppy, a bath tub close-up, Pom from behind at a window, a pond with no dog at all, two
// figures on a bench at sunrise... Each scene paints a background layer and a subject layer into a cached,
// palette-exact canvas. Locked polaroids reuse the subject layer flattened to one colour, so every locked photo
// is its own silhouette that hints at what is in it. Thumbnails are a 44x40 crop around each scene's focus.
import { col } from '../core/palette';
import { spriteCanvas } from '../art/sprite';

export const PHOTO_W = 88, PHOTO_H = 64;
export const THUMB_W = 44, THUMB_H = 40;

type Ctx = CanvasRenderingContext2D;
const R = (x: Ctx, k: string, px: number, py: number, w: number, h: number) => { x.fillStyle = col(k); x.fillRect(px, py, w, h); };
/** Hard checker row (no gradients, no alpha). */
const checkRow = (x: Ctx, k: string, py: number, w: number, ph = 0, x0 = 0) => { x.fillStyle = col(k); for (let i = x0 + ph; i < x0 + w; i += 2) x.fillRect(i, py, 1, 1); };
const disc = (x: Ctx, k: string, cx: number, cy: number, r: number) => {
  x.fillStyle = col(k); for (let dy = -r; dy <= r; dy++) { const dx = Math.floor(Math.sqrt(r * r - dy * dy) + 0.35); x.fillRect(cx - dx, cy + dy, dx * 2 + 1, 1); }
};
/** Filled pixel ellipse. */
function oval(x: Ctx, k: string, cx: number, cy: number, rx: number, ry: number) {
  x.fillStyle = col(k); for (let dy = -ry; dy <= ry; dy++) { const dx = Math.floor(rx * Math.sqrt(1 - (dy * dy) / (ry * ry)) + 0.35); x.fillRect(cx - dx, cy + dy, dx * 2 + 1, 1); }
}
/** Pixel ellipse outline (or arc between angles a0..a1, radians, 0 = right, clockwise in screen space). */
function ring(x: Ctx, k: string, cx: number, cy: number, rx: number, ry: number, a0 = 0, a1 = Math.PI * 2) {
  x.fillStyle = col(k); const seen = new Set<number>(); const n = Math.max(12, Math.round((rx + ry) * 4));
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * i / n; const px = Math.round(cx + Math.cos(a) * rx), py = Math.round(cy + Math.sin(a) * ry);
    const key = px * 1000 + py; if (seen.has(key)) continue; seen.add(key); x.fillRect(px, py, 1, 1);
  }
}
/** Char-grid mini sprite (palette keys, '.' transparent), optional mirror, scale and 1px outline. */
function spr(x: Ctx, rows: string[], px: number, py: number, o: { flip?: boolean; vflip?: boolean; s?: number; outline?: string; map?: Record<string, string> } = {}) {
  const s = o.s ?? 1; const w = Math.max(...rows.map(r => r.length)); if (o.vflip) rows = [...rows].reverse();
  const at = (cb: (cx: number, cy: number, ch: string) => void) => rows.forEach((r, yy) => { for (let xx = 0; xx < r.length; xx++) { const ch = r[xx]; if (ch !== '.' && ch !== ' ') cb(px + (o.flip ? w - 1 - xx : xx) * s, py + yy * s, ch); } });
  if (o.outline) { x.fillStyle = col(o.outline); at((cx, cy) => { x.fillRect(cx - s, cy, s, s); x.fillRect(cx + s, cy, s, s); x.fillRect(cx, cy - s, s, s); x.fillRect(cx, cy + s, s, s); }); }
  at((cx, cy, ch) => { x.fillStyle = col(o.map?.[ch] ?? ch); x.fillRect(cx, cy, s, s); });
}
const sprite = (x: Ctx, name: string, cx: number, cy: number, recolor?: Record<string, string>) => {
  const c = spriteCanvas(name, 0, false, recolor); if (c) x.drawImage(c, Math.round(cx - c.width / 2), Math.round(cy - c.height / 2));
};
/** Sky in three hard bands with checker seams. */
function sky(x: Ctx, k: [string, string, string], hz: number) {
  const b1 = Math.round(hz * 0.4), b2 = Math.round(hz * 0.75);
  R(x, k[0], 0, 0, PHOTO_W, b1); R(x, k[1], 0, b1, PHOTO_W, b2 - b1); R(x, k[2], 0, b2, PHOTO_W, hz - b2);
  checkRow(x, k[1], b1 - 1, PHOTO_W); checkRow(x, k[2], b2 - 1, PHOTO_W, 1);
}
function heart(x: Ctx, k: string, hx: number, hy: number) {
  R(x, k, hx, hy, 2, 1); R(x, k, hx + 3, hy, 2, 1); R(x, k, hx - 1, hy + 1, 7, 2); R(x, k, hx, hy + 3, 5, 1); R(x, k, hx + 1, hy + 4, 3, 1); R(x, k, hx + 2, hy + 5, 1, 1);
}
function burst(x: Ctx, k: string, k2: string, cx: number, cy: number, r: number) {
  for (let a = 0; a < 12; a++) { const ang = a * Math.PI / 6; for (let d = r - 3; d <= r; d++) R(x, d === r ? k2 : k, cx + Math.round(Math.cos(ang) * d), cy + Math.round(Math.sin(ang) * d), 1, 1); }
  R(x, k2, cx, cy, 1, 1);
}

// ---------------- mini sprites (outlined with ink '0' when drawn) ----------------
/** Pom sitting, side view facing right. */
const POM_SIT = [
  '..........6666....',
  '.........666667dd.',
  '........6666677dcd',
  '........66666677d.',
  '.......8866666660.',
  '.......8866666666b',
  '.......888777788..',
  '.66...8888.6667...',
  '6666..8866666677..',
  '6667.866666666677.',
  '.77.8666666666677.',
  '....866666666667..',
  '....8766666667777.',
  '.....877777887778.',
  '.....8777..8777...',
  '.....877....877...',
  '....8777...8777...',
];
/** Pom sitting, seen from behind (ears down both sides, pom-pom tail). */
const POM_BACK = [
  '.....6666.....',
  '...66666666dd.',
  '..666666666dcd',
  '..6666666666d.',
  '.886666666667.',
  '.8886666666788',
  '.8887766677888',
  '.888.877778888',
  '..88.666666.8.',
  '....66666666..',
  '...6666666666.',
  '...6666666667.',
  '...6667666677.',
  '...6676c66777.',
  '..87776667778.',
  '..888777777888',
];
/** Pom curled up asleep (head tucked, closed eye). */
const POM_SLEEP = [
  '......66666666......',
  '....666666666666....',
  '...66666666666666dd.',
  '..6666666668886666dc',
  '.66666666688888666d.',
  '.6666666668888b0667.',
  '.7666666666888866677',
  '..77666666666666677.',
  '...777766666667777..',
  '.....7777777777.....',
];
/** Puppy Pom, side view facing right. */
const PUPPY = [
  '.......666...',
  '......66666d.',
  '.....8660666c',
  '.....88666660',
  '.66..8866666.',
  '.66666666677.',
  '..6666666677.',
  '..66.7..67...',
  '..77.7..77...',
];
/** Pom's head only (front), for peeking out of things. */
const POM_HEAD = [
  '...666666.dd.',
  '..66666666dcd',
  '.8666666666d.',
  '886606606688.',
  '886666666688.',
  '888660066888.',
  '888.6cc6.888.',
  '.8...66...8..',
];
/** Maya's hand from the left, fingers curled up around something. */
const HAND = [
  '.......8.8.8..',
  '......8989898.',
  '.....89898989.',
  '....888888888.',
  '...8888888888.',
  '..88888888889.',
  'dd8888888889..',
  'ddd88888899...',
  'ddddd999......',
  'dddddd........',
  'eddddd........',
];
/** Maya sitting, seen from behind. */
const MAYA_BACK = [
  '...bbbb...',
  '..bbbbbbb.',
  '..bbbbbbb.',
  '..bbbbbbbb',
  '...bbbb..b',
  '...8888...',
  '.dddddddd.',
  'dddddddddd',
  'ddddeddddd',
  'ddddedddde',
  'dddddddddd',
  '.dddddddd.',
];
/** Maya running, side view facing right. */
const MAYA_RUN = [
  '...bbb..',
  '..bbbb8.',
  '.bbbb88.',
  '.b..88..',
  '...dddd8',
  '..dddd..',
  '.8dddd..',
  '...nnn..',
  '..nn.nn.',
  '.nn...n.',
  '.8.....8',
];
/** Mail carrier, side view facing left. */
const CARRIER = [
  '..nnnn.',
  '.nnnnnn',
  '..8888.',
  '..888..',
  '.mmmmm.',
  'ammmmmm',
  'aammmm8',
  'aa.mm..',
  '...nn..',
  '..n..n.',
];

// ---------------- scenes ----------------
interface Scene { bg: (x: Ctx) => void; fg: (x: Ctx) => void; focus: [number, number] }
const O = { outline: '0' };
const SCENES: Record<string, Scene> = {
  // Maya's hands lift the puppy out of the crate; two siblings watch from the straw
  mem_01: {
    focus: [44, 34],
    bg: x => {
      R(x, 'a', 0, 0, PHOTO_W, PHOTO_H);
      for (let i = 0; i < PHOTO_W; i += 11) { R(x, '9', i, 0, 10, 44); R(x, '8', i, 0, 1, 44); R(x, 'b', i + 9, 0, 1, 44); R(x, 'q', i + 4, 6, 1, 1); R(x, 'q', i + 4, 36, 1, 1); }
      R(x, 'b', 0, 44, PHOTO_W, 2); R(x, 'g', 0, 46, PHOTO_W, 18);
      for (let i = 0; i < 26; i++) R(x, i % 3 ? 'f' : 'h', (i * 29) % PHOTO_W, 48 + (i * 7) % 15, 3, 1);
      spr(x, PUPPY, 2, 36, { ...O, map: { 6: 'a', 7: 'b', 8: 'b', d: 'a', c: 'a' } });
      spr(x, PUPPY, 72, 38, { ...O, flip: true, map: { 6: 'q', 7: '1', 8: '1', d: 'q', c: 'q' } });
    },
    fg: x => {
      // sleeves from the bottom corners, cupped hands under the puppy
      spr(x, PUPPY, 31, 26, { ...O, s: 2 });
      R(x, '0', 15, 44, 14, 20); R(x, 'd', 16, 45, 12, 19); R(x, 'e', 26, 45, 2, 19);
      R(x, '0', 59, 44, 14, 20); R(x, 'd', 60, 45, 12, 19); R(x, 'e', 60, 45, 2, 19);
      spr(x, HAND, 22, 35, O); spr(x, HAND, 52, 35, { ...O, flip: true });
      // the famous shoelace, still in her mouth
      for (let i = 0; i < 22; i++) R(x, '6', 57 + i, 33 + Math.round(Math.sin(i / 3) * 2) + (i >> 3), 1, 1);
      R(x, 'p', 78, 35, 2, 2);
    },
  },
  // bath tub close-up: just a soapy head and a very offended face
  mem_02: {
    focus: [44, 30],
    bg: x => {
      R(x, 's', 0, 0, PHOTO_W, PHOTO_H);
      for (let i = 0; i < PHOTO_W; i += 8) R(x, '5', i, 0, 1, 40); for (let j = 7; j < 40; j += 8) R(x, '5', 0, j, PHOTO_W, 1);
      R(x, 'o', 0, 40, PHOTO_W, PHOTO_H - 40);
    },
    fg: x => {
      sprite(x, 'portrait_pom', 44, 30);
      for (const [bx, by, r] of [[34, 12, 4], [42, 9, 5], [51, 11, 4], [57, 15, 3], [29, 16, 3], [47, 4, 2]]) { disc(x, '5', bx, by + 1, r); disc(x, '6', bx, by, r); }
      // the tub: white enamel with a rim, water line and a rubber duck
      R(x, '0', 4, 36, 80, 28); R(x, '6', 5, 37, 78, 27); R(x, '5', 5, 37, 78, 2); R(x, 'o', 5, 60, 78, 4);
      R(x, 'm', 8, 39, 72, 2); for (let i = 10; i < 78; i += 7) R(x, 's', i, 39, 3, 1);
      R(x, 'f', 70, 31, 7, 5); R(x, 'f', 74, 28, 4, 4); R(x, 'g', 78, 30, 2, 1); R(x, '0', 75, 29, 1, 1); R(x, 'h', 70, 35, 7, 1);
      for (const [dx, dy] of [[12, 20], [16, 12], [70, 14], [76, 22], [8, 28], [66, 6]]) { R(x, 'l', dx, dy, 1, 2); R(x, 'm', dx, dy + 2, 1, 1); }
    },
  },
  // Pom from behind, nose to the glass, keeping an eye on the mail carrier
  mem_03: {
    focus: [36, 34],
    bg: x => {
      R(x, '9', 0, 0, PHOTO_W, PHOTO_H); for (let i = 3; i < PHOTO_W; i += 6) R(x, '8', i, 0, 1, PHOTO_H);
      // window: sky, houses across the street, sidewalk
      R(x, 'a', 14, 4, 70, 44); R(x, 'm', 16, 6, 66, 14); R(x, 's', 16, 20, 66, 12); checkRow(x, 's', 19, 66, 0, 16);
      R(x, 'h', 20, 16, 18, 16); R(x, 'b', 24, 22, 4, 4); R(x, 'b', 31, 22, 4, 4); R(x, 'n', 50, 12, 22, 20); R(x, 'f', 54, 16, 4, 3); R(x, 'f', 62, 16, 4, 3);
      R(x, 'o', 16, 32, 66, 6); R(x, 'p', 16, 38, 66, 8);
      spr(x, CARRIER, 62, 25, O); R(x, '6', 60, 30, 3, 2);
      R(x, 'a', 48, 6, 2, 40); R(x, 'a', 16, 24, 66, 1); // window cross bars
      R(x, '8', 10, 46, 78, 4); R(x, 'a', 10, 50, 78, 2); // sill
    },
    fg: x => { spr(x, POM_BACK, 16, 22, { ...O, s: 2 }); },
  },
  // wide shot: sprinkler rainbow, Maya and Pom tiny in the spray
  mem_04: {
    focus: [58, 38],
    bg: x => {
      sky(x, ['m', 'l', 's'], 34);
      R(x, '7', 64, 10, 24, 24); R(x, 'h', 62, 6, 28, 5); R(x, 'n', 70, 18, 6, 6); R(x, 'a', 80, 22, 5, 12);
      R(x, 'j', 0, 34, PHOTO_W, 30); checkRow(x, 'i', 34, PHOTO_W); for (let i = 0; i < 30; i++) R(x, 'k', (i * 31) % PHOTO_W, 38 + (i * 11) % 25, 1, 2);
    },
    fg: x => {
      ring(x, 'r', 44, 46, 30, 26, Math.PI * 1.1, Math.PI * 1.9); ring(x, 'g', 44, 46, 29, 25, Math.PI * 1.1, Math.PI * 1.9);
      ring(x, 'f', 44, 46, 28, 24, Math.PI * 1.1, Math.PI * 1.9); ring(x, 'i', 44, 46, 27, 23, Math.PI * 1.1, Math.PI * 1.9);
      ring(x, 'm', 44, 46, 26, 22, Math.PI * 1.1, Math.PI * 1.9);
      for (let i = 0; i < 18; i++) { const a = Math.PI * (1.05 + 0.9 * i / 17); R(x, i % 2 ? 's' : '6', 44 + Math.round(Math.cos(a) * 22), 48 + Math.round(Math.sin(a) * 20), 1, 2); }
      R(x, 'q', 42, 46, 5, 3); R(x, 'p', 43, 44, 3, 2);
      spr(x, MAYA_RUN, 12, 40, O);
      spr(x, POM_SIT, 58, 42, O);
    },
  },
  // no dog in this one: the 47th ball, still floating in the pond
  mem_05: {
    focus: [46, 30],
    bg: x => {
      R(x, 'n', 0, 0, PHOTO_W, PHOTO_H); R(x, 'm', 0, 0, PHOTO_W, 10); checkRow(x, 'm', 10, PHOTO_W);
      for (let r = 14; r < PHOTO_H; r += 5) for (let i = (r % 10) ? 2 : 7; i < PHOTO_W; i += 13) R(x, 'm', i, r, 5, 1);
      // reeds on both sides, a lily pad
      for (const [rx, h] of [[3, 30], [7, 40], [11, 26], [76, 34], [81, 44], [85, 28]]) { R(x, 'k', rx, PHOTO_H - h, 2, h); R(x, 'j', rx, PHOTO_H - h, 1, h); R(x, 'a', rx - 1, PHOTO_H - h - 5, 3, 6); }
      disc(x, 'k', 20, 50, 6); disc(x, 'j', 20, 49, 5); R(x, 'n', 20, 45, 1, 5); R(x, 'c', 17, 46, 2, 2);
    },
    fg: x => {
      ring(x, 'l', 46, 32, 16, 6); ring(x, 'm', 46, 32, 22, 9); ring(x, 's', 46, 31, 10, 4);
      disc(x, '0', 46, 28, 7); disc(x, 'i', 46, 28, 6); R(x, '6', 43, 24, 2, 1);
      ring(x, 'f', 42, 28, 4, 6, -Math.PI / 2, Math.PI / 2); ring(x, 'f', 50, 28, 4, 6, Math.PI / 2, Math.PI * 1.5);
      R(x, 'j', 41, 33, 10, 1); R(x, 'm', 40, 35, 12, 1);
    },
  },
  // the bodega counter: a hand with bacon, a nose rising from below, the bodega cat pretending not to care
  mem_06: {
    focus: [44, 36],
    bg: x => {
      R(x, 'v', 0, 0, PHOTO_W, 40);
      for (let s = 4; s < 36; s += 11) { R(x, 'b', 0, s + 8, PHOTO_W, 2); for (let i = 2; i < PHOTO_W; i += 6) { const k = 'rfmigd'[(i + s) % 6]; R(x, k, i, s + 2, 4, 6); R(x, '6', i + 1, s + 3, 1, 2); } }
      R(x, 'a', 0, 40, PHOTO_W, 4); R(x, '9', 0, 40, PHOTO_W, 1); R(x, 'b', 0, 44, PHOTO_W, 20);
      spr(x, POM_SLEEP, 62, 31, { ...O, map: { 6: 'g', 7: 'h', 8: '6', d: 'g', c: 'g' } });
    },
    fg: x => {
      // a hand from the right dangles the bacon strip over the counter edge
      R(x, '0', 60, 9, 28, 9); R(x, 'n', 61, 10, 27, 7); R(x, 'm', 61, 10, 27, 1);
      spr(x, HAND, 46, 6, { ...O, flip: true, map: { d: 'n', e: 'n' } });
      for (let i = 0; i < 22; i++) { const xx = 48 + Math.round(Math.sin(i / 2.2) * 2); R(x, '0', xx - 1, 12 + i, 6, 1); }
      for (let i = 0; i < 22; i++) { const xx = 48 + Math.round(Math.sin(i / 2.2) * 2); R(x, 'r', xx, 12 + i, 4, 1); R(x, i % 4 < 2 ? 'c' : '7', xx + 1, 12 + i, 2, 1); }
      // the nose rising from below
      spr(x, POM_HEAD, 30, 48, { ...O, s: 2 });
    },
  },
  // night roof: Maya covers Pom's ears while the sky goes off
  mem_07: {
    focus: [44, 36],
    bg: x => {
      sky(x, ['0', '1', '2'], 46);
      for (let i = 0; i < PHOTO_W; i += 9) { const h = 8 + ((i * 7) % 11); R(x, 'v', i, 46 - h, 8, h); for (let w = 48 - h; w < 44; w += 4) if ((i + w) % 3) R(x, 'f', i + 3, w, 1, 1); }
      R(x, 'q', 0, 46, PHOTO_W, 4); R(x, 'p', 0, 46, PHOTO_W, 1); R(x, 'v', 0, 50, PHOTO_W, 14);
    },
    fg: x => {
      burst(x, 'd', 'c', 18, 12, 9); burst(x, 'f', '6', 64, 9, 7); burst(x, 'l', 's', 76, 24, 5);
      spr(x, MAYA_BACK, 28, 35, { ...O, map: { d: 'n', e: '1' } });
      spr(x, POM_BACK, 40, 32, O);
      R(x, '0', 37, 34, 4, 4); R(x, '8', 38, 35, 2, 2); R(x, '0', 52, 34, 4, 4); R(x, '8', 53, 35, 2, 2); R(x, 'n', 37, 38, 2, 5);
    },
  },
  // moving day: a tower of boxes on the stairs, one of them has ears
  mem_08: {
    focus: [36, 34],
    bg: x => {
      R(x, '5', 0, 0, PHOTO_W, PHOTO_H); R(x, '4', 0, 40, PHOTO_W, 24);
      for (let s = 0; s < 8; s++) { R(x, 'p', 40 + s * 6, 56 - s * 7, PHOTO_W, 7); R(x, 'o', 40 + s * 6, 56 - s * 7, PHOTO_W, 1); }
      R(x, 'a', 38, 0, 2, 64); R(x, '9', 46, 22, 42, 1); for (let i = 50; i < PHOTO_W; i += 8) R(x, '9', i, 22, 1, 10);
    },
    fg: x => {
      const box = (bx: number, by: number, w: number, h: number) => { R(x, '0', bx - 1, by - 1, w + 2, h + 2); R(x, '9', bx, by, w, h); R(x, '8', bx, by, w, 2); R(x, 'a', bx + (w >> 1) - 1, by, 2, h); R(x, 'q', bx + 2, by + h - 5, 5, 1); };
      box(6, 46, 26, 16); box(34, 50, 20, 12); box(10, 32, 20, 14);
      R(x, '0', 13, 23, 16, 10); R(x, '9', 14, 24, 14, 8); R(x, 'a', 14, 24, 14, 1);
      spr(x, POM_HEAD, 15, 15, O);
      R(x, '8', 13, 24, 4, 2); R(x, '8', 26, 24, 4, 2);
      R(x, 'r', 36, 54, 16, 3); R(x, '6', 38, 55, 3, 1); R(x, '6', 43, 55, 3, 1); R(x, '6', 48, 55, 2, 1);
    },
  },
  // birthday close-up: the pup cup, a candle and the paper crown
  mem_09: {
    focus: [44, 30],
    bg: x => {
      R(x, '7', 0, 0, PHOTO_W, 40); for (let i = 0; i < PHOTO_W; i += 8) R(x, '8', i, 0, 4, 40);
      for (let i = 0; i < PHOTO_W; i += 10) { const k = 'dfmi'[(i / 10) % 4]; const o = (i / 10) % 2; R(x, k, i, 4 + o, 6, 2); R(x, k, i + 1, 6 + o, 4, 2); R(x, k, i + 2, 8 + o, 2, 1); }
      R(x, '0', 0, 1, PHOTO_W, 1);
      R(x, 'a', 0, 40, PHOTO_W, 24); R(x, '9', 0, 40, PHOTO_W, 2); for (let i = 6; i < PHOTO_W; i += 17) R(x, 'b', i, 44, 9, 1);
    },
    fg: x => {
      // paper cup with stripes
      // paper cup (tapered, striped) on the table
      for (let j = 0; j < 20; j++) { const half = 15 - (j >> 2); R(x, '0', 44 - half - 1, 32 + j, half * 2 + 2, 1); R(x, '6', 44 - half, 32 + j, half * 2, 1); for (let i = -half + 2; i < half; i += 5) R(x, 'c', 44 + i, 32 + j, 2, 1); }
      R(x, '0', 38, 52, 12, 1); R(x, '5', 30, 32, 28, 2);
      // whipped cream: three soft tiers, a crumb on top
      disc(x, '0', 44, 29, 13); R(x, '0', 31, 30, 27, 4); disc(x, '6', 44, 29, 12); R(x, '6', 32, 30, 25, 3); R(x, '7', 33, 32, 23, 1);
      disc(x, '0', 44, 22, 9); disc(x, '6', 44, 22, 8); R(x, '7', 38, 25, 13, 1);
      disc(x, '0', 44, 16, 5); disc(x, '6', 44, 16, 4); R(x, '6', 44, 10, 2, 2); R(x, '5', 41, 18, 5, 1);
      R(x, 'a', 50, 20, 3, 2); R(x, 'b', 51, 21, 1, 1); R(x, 'a', 36, 26, 2, 2);
      // candle with a flame
      R(x, '0', 47, 2, 4, 11); R(x, 'd', 48, 6, 2, 7); R(x, 'c', 48, 6, 1, 7); R(x, 'g', 48, 2, 2, 3); R(x, 'f', 48, 3, 1, 2); R(x, '6', 49, 1, 1, 1);
      // the crown, waiting on the table
      R(x, '0', 63, 43, 20, 10); R(x, 'f', 64, 46, 18, 6); for (const cx of [64, 70, 76, 81]) R(x, 'f', cx, 43, 1, 3); R(x, 'g', 64, 50, 18, 2); R(x, 'd', 68, 47, 2, 2); R(x, 'l', 74, 47, 2, 2);
      for (const [cx, cy, k] of [[14, 46, 'd'], [22, 54, 'f'], [8, 58, 'l'], [60, 58, 'i'], [26, 44, 'c']] as [number, number, string][]) R(x, k, cx, cy, 2, 1);
    },
  },
  // dawn on the water: two figures on a bench, backlit
  mem_10: {
    focus: [44, 38],
    bg: x => {
      sky(x, ['u', 'c', 'g'], 36);
      disc(x, 'f', 56, 36, 10); disc(x, '7', 56, 36, 6);
      R(x, 'n', 0, 36, PHOTO_W, 28); for (let r = 38; r < 52; r += 3) R(x, r % 2 ? 'f' : 'g', 56 - (r - 34), r, (r - 34) * 2 - 6, 1);
      R(x, 'v', 0, 52, PHOTO_W, 12); R(x, 'b', 0, 52, PHOTO_W, 1);
    },
    fg: x => {
      R(x, '0', 16, 44, 46, 3); R(x, '0', 18, 47, 2, 6); R(x, '0', 58, 47, 2, 6); R(x, '0', 16, 38, 46, 2);
      spr(x, MAYA_BACK, 22, 32, { map: { b: '0', 8: '0', d: 'v', e: '0' } });
      spr(x, POM_BACK, 38, 30, { map: { 6: 'v', 7: 'v', 8: '0', d: 'e', c: 'e' } });
    },
  },
  // the scarf, unravelled across the floor to a very proud culprit
  mem_11: {
    focus: [52, 36],
    bg: x => {
      R(x, 't', 0, 0, PHOTO_W, 34); for (let i = 0; i < PHOTO_W; i += 12) { R(x, '5', i + 4, 6, 3, 3); R(x, '5', i + 10, 20, 3, 3); }
      R(x, 'a', 0, 34, PHOTO_W, 30); for (let j = 38; j < PHOTO_H; j += 6) R(x, '9', 0, j, PHOTO_W, 1); for (let i = 7; i < PHOTO_W; i += 19) R(x, 'b', i, 34, 1, 30);
    },
    fg: x => {
      // half a striped scarf on its needles
      for (let k = 0; k < 6; k++) R(x, k % 2 ? 'c' : 'r', 4 + k * 3, 40, 3, 12); R(x, 'o', 2, 38, 24, 1); R(x, 'o', 6, 36, 1, 18);
      disc(x, '0', 14, 58, 5); disc(x, 'r', 14, 58, 4); R(x, 'e', 12, 56, 4, 1); R(x, 'e', 11, 59, 6, 1);
      // the strand loops across the floor to her mouth
      for (let i = 0; i < 50; i++) R(x, 'r', 18 + i, 56 - Math.round(Math.sin(i / 5) * 4) - (i > 40 ? (i - 40) * 2 : 0), 1, 1);
      spr(x, POM_SIT, 54, 27, O);
    },
  },
  // head out the car window, ears flying
  mem_12: {
    focus: [46, 26],
    bg: x => {
      sky(x, ['m', 'l', 's'], 30);
      for (let i = 0; i < PHOTO_W; i += 14) { disc(x, 'k', i + 4, 30, 6); R(x, 'j', i, 28, 10, 1); }
      for (let j = 4; j < 28; j += 7) R(x, '6', (j * 13) % 60, j, 14, 1);
    },
    fg: x => {
      R(x, '0', 0, 38, PHOTO_W, 26); R(x, 'd', 0, 39, PHOTO_W, 25); R(x, 'c', 0, 40, PHOTO_W, 1); R(x, 'e', 0, 56, PHOTO_W, 8); R(x, 'q', 60, 46, 10, 2);
      R(x, '0', 6, 22, 70, 17); R(x, 's', 7, 23, 68, 16); R(x, '5', 7, 23, 20, 16);
      sprite(x, 'portrait_pom', 46, 20);
      // ears streaming back in the wind
      R(x, '8', 18, 14, 10, 3); R(x, '9', 12, 16, 8, 2); R(x, '8', 8, 18, 6, 2);
      for (const [lx, ly, w] of [[2, 8, 10], [4, 26, 8], [70, 6, 12], [0, 34, 6]]) R(x, '6', lx, ly, w, 1);
    },
  },
  // the blanket fort, lit by cartoons, two pairs of eyes inside
  mem_13: {
    focus: [44, 38],
    bg: x => {
      R(x, '2', 0, 0, PHOTO_W, 44); R(x, '3', 6, 4, 26, 20); R(x, 'n', 8, 6, 22, 16);
      for (let i = 0; i < 12; i++) R(x, 'm', 9 + (i * 7) % 20, 7 + (i * 5) % 13, 1, 3);
      R(x, 'f', 22, 7, 1, 3); R(x, 'f', 21, 10, 2, 1); R(x, 'f', 20, 11, 1, 3); // lightning
      R(x, 'v', 0, 44, PHOTO_W, 20); for (let i = 0; i < PHOTO_W; i += 8) R(x, 'u', i, 50, 4, 2);
    },
    fg: x => {
      for (let j = 0; j < 34; j++) { const half = Math.round(j * 1.1); R(x, j % 6 < 3 ? 'd' : 'c', 44 - half, 14 + j, half * 2 + 1, 1); }
      R(x, '0', 44, 12, 1, 3);
      for (let j = 0; j < 20; j++) { const half = Math.round(j * 0.6); R(x, '1', 44 - half, 28 + j, half * 2 + 1, 1); }
      R(x, 'l', 36, 44, 16, 4); R(x, 's', 37, 44, 14, 1);
      R(x, '6', 37, 38, 2, 2); R(x, '6', 41, 38, 2, 2); R(x, '0', 38, 39, 1, 1); R(x, '0', 42, 39, 1, 1);
      R(x, '6', 46, 40, 2, 2); R(x, '6', 50, 40, 2, 2); R(x, '0', 47, 41, 1, 1); R(x, '0', 51, 41, 1, 1); R(x, 'd', 48, 37, 3, 2);
      R(x, 'r', 4, 52, 16, 8); R(x, 'm', 66, 52, 18, 8);
    },
  },
  // the hallway at night, a door of warm light and one small dog in it
  mem_14: {
    focus: [44, 38],
    bg: x => {
      R(x, '1', 0, 0, PHOTO_W, PHOTO_H);
      for (let j = 0; j < 24; j++) { const w = Math.round(14 + j * 0.8); R(x, '2', 0, 40 + j, w, 1); R(x, '2', PHOTO_W - w, 40 + j, w, 1); }
      R(x, '0', 34, 8, 20, 32); R(x, 'f', 35, 9, 18, 31); R(x, '7', 38, 12, 12, 28);
      for (let j = 0; j < 24; j++) { const half = 9 + Math.round(j * 0.7); R(x, j % 2 ? 'g' : 'f', 44 - half, 40 + j, half * 2, 1); }
      R(x, '2', 4, 10, 10, 14); R(x, '3', 5, 11, 8, 12); disc(x, '5', 9, 15, 2);
    },
    fg: x => { spr(x, POM_SIT, 34, 38, { ...O, map: { 6: '7', 7: '8', 8: '9' } }); },
  },
  // belly up, one leg kicking, Maya's hand on the exact spot
  mem_15: {
    focus: [44, 34],
    bg: x => {
      R(x, 'u', 0, 0, PHOTO_W, PHOTO_H);
      for (let r = 0; r < PHOTO_H; r += 8) for (let i = (r / 8) % 2 ? 0 : 4; i < PHOTO_W; i += 8) R(x, 't', i, r, 2, 2);
      R(x, 'e', 0, 52, PHOTO_W, 12); for (let i = 2; i < PHOTO_W; i += 4) R(x, 'c', i, 62, 2, 2);
    },
    fg: x => {
      // Pom on her back: oval tummy, paws in the air, upside-down head on the left, one back leg kicking
      oval(x, '0', 50, 42, 19, 12); oval(x, '6', 50, 42, 18, 11); oval(x, '7', 50, 46, 15, 6); oval(x, 'c', 50, 40, 6, 4); R(x, '6', 47, 38, 3, 1);
      for (const [lx, ly, h] of [[36, 28, 7], [43, 26, 7], [56, 27, 6]]) { R(x, '0', lx - 1, ly - 1, 6, h + 2); R(x, '6', lx, ly, 4, h); R(x, '7', lx, ly, 4, 2); R(x, '8', lx + 1, ly, 2, 1); }
      R(x, '0', 64, 27, 10, 6); R(x, '6', 65, 28, 8, 4); R(x, '8', 72, 29, 1, 2);
      ring(x, '6', 66, 28, 10, 10, -Math.PI * 0.55, -Math.PI * 0.05); ring(x, '5', 66, 28, 13, 13, -Math.PI * 0.5, -Math.PI * 0.1);
      disc(x, '0', 72, 47, 3); disc(x, '6', 72, 47, 2);
      spr(x, POM_HEAD, 6, 32, { ...O, vflip: true, s: 2 });
      // Maya's hand on the exact spot
      R(x, '0', 52, 8, 36, 12); R(x, 'n', 53, 9, 35, 10); R(x, 'm', 53, 9, 35, 1);
      spr(x, HAND, 40, 14, { ...O, flip: true, vflip: true, map: { d: 'n', e: 'n' } });
      heart(x, 'd', 70, 6); heart(x, 'c', 10, 10);
    },
  },
  // sick day: Maya under the quilt, Pom on guard at her feet
  mem_16: {
    focus: [46, 36],
    bg: x => {
      R(x, 'n', 0, 0, PHOTO_W, 34); for (let i = 0; i < PHOTO_W; i += 10) R(x, 'm', i, 0, 1, 34);
      R(x, 'a', 0, 34, PHOTO_W, 30);
      R(x, 'b', 74, 24, 14, 20); R(x, '9', 74, 24, 14, 2); R(x, '6', 77, 17, 8, 7); R(x, '5', 79, 14, 4, 3); R(x, 'r', 78, 20, 6, 1);
    },
    fg: x => {
      R(x, '0', 2, 26, 70, 30); R(x, 'a', 2, 50, 70, 10);
      R(x, '6', 4, 24, 20, 10); R(x, '5', 4, 32, 20, 2);
      disc(x, '0', 14, 26, 6); disc(x, '8', 14, 26, 5); R(x, 'b', 8, 20, 12, 5); R(x, 'b', 7, 22, 3, 6); R(x, '0', 16, 27, 2, 1); R(x, 'c', 13, 29, 3, 1);
      R(x, 'd', 3, 31, 68, 20); for (let i = 3; i < 71; i += 8) for (let j = 31; j < 51; j += 8) R(x, ((i + j) / 8) % 2 ? 'c' : 'e', i + 2, j + 2, 4, 4);
      spr(x, POM_SLEEP, 46, 20, O);
    },
  },
  // the front door at six o'clock: waiting, waiting
  mem_17: {
    focus: [44, 38],
    bg: x => {
      R(x, '8', 0, 0, PHOTO_W, 50); for (let i = 0; i < PHOTO_W; i += 7) R(x, '9', i, 0, 1, 50);
      R(x, '0', 26, 2, 36, 48); R(x, 'a', 27, 3, 34, 47); R(x, 'b', 30, 20, 12, 12); R(x, 'b', 46, 20, 12, 12); R(x, 'b', 30, 36, 12, 12); R(x, 'b', 46, 36, 12, 12);
      R(x, 'g', 32, 6, 24, 10); R(x, 'f', 33, 7, 22, 4); R(x, '0', 43, 6, 1, 10);
      R(x, 'f', 56, 30, 2, 3);
      disc(x, '0', 12, 14, 7); disc(x, '6', 12, 14, 6); R(x, '0', 12, 9, 1, 5); R(x, '0', 12, 14, 1, 6); // six o'clock
      R(x, 'b', 0, 50, PHOTO_W, 14); R(x, 'a', 0, 50, PHOTO_W, 1);
    },
    fg: x => { R(x, 'r', 24, 54, 40, 7); R(x, 'h', 24, 60, 40, 1); spr(x, POM_BACK, 37, 40, O); },
  },
  // lights out: asleep on the pillow, moon at the window, one last heart
  mem_18: {
    focus: [44, 36],
    bg: x => {
      R(x, '1', 0, 0, PHOTO_W, PHOTO_H);
      R(x, '2', 52, 4, 30, 24); R(x, '0', 54, 6, 26, 20); disc(x, 'f', 70, 14, 5); disc(x, '0', 72, 13, 4);
      for (const [sx, sy] of [[58, 10], [62, 20], [76, 22], [57, 23]]) R(x, '5', sx, sy, 1, 1);
      R(x, '2', 66, 6, 1, 20); R(x, '2', 54, 16, 26, 1);
      R(x, 'v', 0, 46, PHOTO_W, 18);
    },
    fg: x => {
      R(x, 'u', 0, 44, PHOTO_W, 20); R(x, 't', 0, 44, PHOTO_W, 2); for (let i = 4; i < PHOTO_W; i += 10) R(x, 'e', i, 50, 6, 1);
      R(x, '0', 3, 35, 40, 11); R(x, '4', 4, 36, 38, 9); R(x, '5', 6, 36, 34, 2); R(x, '3', 4, 43, 38, 2);
      spr(x, POM_SLEEP, 12, 27, O);
      R(x, '8', 34, 44, 12, 4); R(x, '9', 34, 47, 12, 1);
      for (const [zx, zy, s] of [[36, 20, 3], [41, 13, 4], [47, 5, 5]]) { R(x, 't', zx, zy, s, 1); R(x, 't', zx, zy + s - 1, s, 1); for (let k = 0; k < s; k++) R(x, 't', zx + s - 1 - k, zy + k, 1, 1); }
      heart(x, 'd', 22, 14);
    },
  },
};
/** Notes written on each viewer page: a date stamp and a scribbled caption (uppercase font: kept short). */
export const NOTES: Record<string, [string, string]> = {
  mem_01: ['SPRING, YEAR 1', 'SHE PICKED ME!'],
  mem_02: ['APRIL, YEAR 1', 'NEVER AGAIN.'],
  mem_03: ['DAILY, 11:15', 'SUSPICIOUS.'],
  mem_04: ['JULY, YEAR 1', 'RAINBOW ZOOMIES'],
  mem_05: ['AUGUST, YEAR 2', 'BALL 47, R.I.P.'],
  mem_06: ['SUNDAYS', 'OUR SECRET'],
  mem_07: ['JULY 4, YEAR 2', 'BRAVE (MOSTLY)'],
  mem_08: ['MOVING DAY', 'FIVE FLIGHTS UP'],
  mem_09: ['MY BIRTHDAY', 'MAGNIFICENT.'],
  mem_10: ['5:52 AM', 'JUST US TWO'],
  mem_11: ['WINTER, YEAR 3', 'I HELPED.'],
  mem_12: ['ROAD TRIP', 'EARS: FLYING'],
  mem_13: ['A STORMY DAY', 'FORT POM'],
  mem_14: ['EVERY NIGHT', 'LEAVE IT ON'],
  mem_15: ['ANY TIME', 'THE SPOT!!'],
  mem_16: ['3 DAYS IN BED', 'BEST NURSE'],
  mem_17: ['6:00 PM', 'SHE IS HOME!'],
  mem_18: ['EVERY NIGHT', 'GOOD GIRL, POM'],
};
const FALLBACK: Scene = { focus: [44, 32], bg: x => sky(x, ['m', 'l', 's'], 44), fg: x => { R(x, 'j', 0, 44, PHOTO_W, 20); spr(x, POM_SIT, 34, 26, O); heart(x, 'd', 62, 12); } };

const cache = new Map<string, HTMLCanvasElement>();
function make(key: string, paint: (x: Ctx) => void): HTMLCanvasElement | null {
  const hit = cache.get(key); if (hit) return hit;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = PHOTO_W; c.height = PHOTO_H;
  paint(c.getContext('2d')!); cache.set(key, c); return c;
}
/** The finished photo for a memory (cached). */
export function photo(id: string): HTMLCanvasElement | null {
  const S = SCENES[id] ?? FALLBACK;
  return make(id, x => { S.bg(x); S.fg(x); });
}
/** Subject layer flattened to one palette colour (scratch canvas). */
function flat(S: Scene, k: string): HTMLCanvasElement {
  const t = document.createElement('canvas'); t.width = PHOTO_W; t.height = PHOTO_H;
  const tx = t.getContext('2d')!; S.fg(tx); tx.globalCompositeOperation = 'source-in'; R(tx, k, 0, 0, PHOTO_W, PHOTO_H);
  return t;
}
/**
 * What a locked photo shows: a dark scan-lined plate with the memory's own subjects as one flat peri silhouette
 * (with a 1px indigo drop below), so every locked polaroid hints at its real contents.
 */
export function lockedPhoto(id: string): HTMLCanvasElement | null {
  const S = SCENES[id] ?? FALLBACK;
  return make('#locked|' + id, x => {
    R(x, '1', 0, 0, PHOTO_W, PHOTO_H);
    for (let yy = 0; yy < PHOTO_H; yy += 3) checkRow(x, '0', yy, PHOTO_W, (yy / 3) % 2);
    x.drawImage(flat(S, '2'), 0, 1); x.drawImage(flat(S, '3'), 0, 0);
  });
}
/** Top-left of the 44x40 thumbnail crop: centred on the scene's focus, clamped inside the photo. */
export function thumbAt(id: string): [number, number] {
  const [fx, fy] = (SCENES[id] ?? FALLBACK).focus;
  return [Math.max(0, Math.min(PHOTO_W - THUMB_W, fx - THUMB_W / 2)), Math.max(0, Math.min(PHOTO_H - THUMB_H, fy - THUMB_H / 2))];
}
