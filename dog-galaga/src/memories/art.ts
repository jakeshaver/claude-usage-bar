// Memories art: hand-placed pixel photos of Pom and her human Maya, the polaroid frame, the tiny polaroid a
// glowing cat carries and the flipping one that drifts down to Pom. Everything is integer fillRect / drawImage
// in palette colors (no arcs, strokes or alpha), cached to canvases on first use.
import { col } from '../core/palette';
import { pxRing, pxDisc, pxSpark } from '../core/pixel';

type Ctx = CanvasRenderingContext2D;
export const PHOTO_W = 56, PHOTO_H = 44;

const R = (ctx: Ctx, x: number, y: number, w: number, h: number, k: string) => { ctx.fillStyle = col(k); ctx.fillRect(Math.round(x), Math.round(y), w, h); };
const P = (ctx: Ctx, x: number, y: number, k: string) => R(ctx, x, y, 1, 1, k);
/** 50% checker of one key over a rect (soft light / shade made of hard pixels). */
const D = (ctx: Ctx, x: number, y: number, w: number, h: number, k: string, par = 0) => {
  ctx.fillStyle = col(k);
  for (let yy = 0; yy < h; yy++) for (let xx = (yy + par) & 1; xx < w; xx += 2) ctx.fillRect(x + xx, y + yy, 1, 1);
};

// ---------------------------------------------------------------- tiny figure sprites (palette keys, '.' clear)
const MAYA = [
  '..bbbbbbb..',
  '.bbbbbbbbb.',
  '.bb99999bb.',
  '.b9909099b.',
  '.b9999999b.',
  '.bb99c99bb.',
  '.bbb999bbb.',
  '.bb.999.bb.',
  '..ddddddd..',
  '.ddddddddd.',
  '9ddddddddd9',
  '9ddddddddd9',
  '9.ddddddd.9',
  '..ddddddd..',
  '..nnnnnnn..',
  '..nnnnnnn..',
  '..nnn.nnn..',
  '..nnn.nnn..',
  '..nnn.nnn..',
  '..nnn.nnn..',
  '..000.000..',
];
/** eyes shut: the photo's 2-frame idle (the subject blinks while the photo develops) */
const MAYA_B = MAYA.map((r, i) => i === 3 ? '.b9999999b.' : i === 4 ? '.b9a090a9b.' : r);
const MAYA_SIT = [...MAYA.slice(0, 14), '.nnnnnnnnn.', '.nnnnnnnnn.', '.000...000.'];
const MAYA_SIT_B = [...MAYA_B.slice(0, 14), ...MAYA_SIT.slice(14)];
/** Maya's head and shoulders (peeking out of forts, beds, car windows). */
const MAYA_HEAD = MAYA.slice(0, 10);
const MAYA_HEAD_B = MAYA_B.slice(0, 10);
const POM = [
  '...66666...',
  '..6777776..',
  '.667070766.',
  '.667707766.',
  '..67ccc76..',
  '...dd6dd...',
  '..6777776..',
  '.667777766.',
  '.667777766.',
  '..66...66..',
  '..77...77..',
];
const POM_B = POM.map((r, i) => i === 2 ? '.667777766.' : i === 3 ? '.660707066.' : r);
const POM_HEAD = POM.slice(0, 6);
const POM_HEAD_B = POM_B.slice(0, 6);
/** set while a scene is painted for its blink frame */
let BLINK = false;
const PUPPY = ['.a99a.', 'a9999a', '909909', '.9cc9.'];

const spriteCache = new Map<string, HTMLCanvasElement>();
/** Rows -> canvas with an automatic 1px ink outline (so pale figures read on any photo background). */
function sprite(key: string, rows: string[], outline = true): HTMLCanvasElement {
  let c = spriteCache.get(key); if (c) return c;
  const h = rows.length, w = rows[0].length, o = outline ? 1 : 0;
  c = document.createElement('canvas'); c.width = w + o * 2; c.height = h + o * 2;
  const x = c.getContext('2d')!;
  const at = (cx: number, cy: number) => cy >= 0 && cy < h && cx >= 0 && cx < w && rows[cy][cx] !== '.';
  if (outline) for (let yy = -1; yy <= h; yy++) for (let xx = -1; xx <= w; xx++)
    if (!at(xx, yy) && (at(xx - 1, yy) || at(xx + 1, yy) || at(xx, yy - 1) || at(xx, yy + 1))) { x.fillStyle = col('0'); x.fillRect(xx + o, yy + o, 1, 1); }
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const ch = rows[yy][xx]; if (ch !== '.') { x.fillStyle = col(ch); x.fillRect(xx + o, yy + o, 1, 1); } }
  spriteCache.set(key, c); return c;
}
/** Blit a figure by its top-left corner (outline included). flipY draws it upside down (belly up). */
function fig(ctx: Ctx, name: string, rows: string[], x: number, y: number, flipY = false) {
  const s = sprite(name, rows);
  if (!flipY) { ctx.drawImage(s, Math.round(x), Math.round(y)); return; }
  ctx.save(); ctx.translate(Math.round(x), Math.round(y) + s.height); ctx.scale(1, -1); ctx.drawImage(s, 0, 0); ctx.restore();
}
const maya = (ctx: Ctx, x: number, y: number) => BLINK ? fig(ctx, 'mayaB', MAYA_B, x, y) : fig(ctx, 'maya', MAYA, x, y);
const mayaSit = (ctx: Ctx, x: number, y: number) => BLINK ? fig(ctx, 'mayaSitB', MAYA_SIT_B, x, y) : fig(ctx, 'mayaSit', MAYA_SIT, x, y);
const mayaHead = (ctx: Ctx, x: number, y: number) => BLINK ? fig(ctx, 'mayaHeadB', MAYA_HEAD_B, x, y) : fig(ctx, 'mayaHead', MAYA_HEAD, x, y);
const pom = (ctx: Ctx, x: number, y: number, flipY = false) => BLINK ? fig(ctx, 'pomB', POM_B, x, y, flipY) : fig(ctx, 'pom', POM, x, y, flipY);
const pomHead = (ctx: Ctx, x: number, y: number) => BLINK ? fig(ctx, 'pomHeadB', POM_HEAD_B, x, y) : fig(ctx, 'pomHead', POM_HEAD, x, y);
const heart = (ctx: Ctx, x: number, y: number, k = 'd') => { R(ctx, x, y, 2, 1, k); R(ctx, x + 3, y, 2, 1, k); R(ctx, x, y + 1, 5, 1, k); R(ctx, x + 1, y + 2, 3, 1, k); P(ctx, x + 2, y + 3, k); };

// ---------------------------------------------------------------- backdrops
type Sky = 'day' | 'dusk' | 'night' | 'dawn';
function sky(ctx: Ctx, kind: Sky, h: number) {
  const bands: Record<Sky, string[]> = { day: ['4', '5', '5', 's'], dusk: ['u', 'd', 'g', 'f'], night: ['1', '1', '2', '2'], dawn: ['4', 'c', 'c', '7'] };
  const b = bands[kind]; const bh = Math.ceil(h / b.length);
  b.forEach((k, i) => { R(ctx, 0, i * bh, PHOTO_W, bh, k); if (i) D(ctx, 0, i * bh, PHOTO_W, 1, b[i - 1]); });
  if (kind === 'night') for (const [x, y] of [[6, 4], [19, 9], [33, 3], [47, 7], [52, 15], [11, 15], [41, 13]]) P(ctx, x, y, y % 2 ? '5' : '6');
  if (kind === 'day') { R(ctx, 8, 6, 9, 2, '6'); R(ctx, 10, 5, 4, 1, '6'); R(ctx, 36, 10, 8, 2, '6'); R(ctx, 38, 9, 3, 1, '6'); }
}
function grass(ctx: Ctx, y: number) {
  R(ctx, 0, y, PHOTO_W, PHOTO_H - y, 'j'); R(ctx, 0, y, PHOTO_W, 1, 'i');
  for (let x = 2; x < PHOTO_W; x += 7) { P(ctx, x, y + 4 + (x % 3), 'k'); P(ctx, x + 3, y + 9 + (x % 2), 'i'); }
}
function room(ctx: Ctx, wall: string, trim: string, floor: string, floorY = 31) {
  R(ctx, 0, 0, PHOTO_W, floorY, wall); D(ctx, 0, floorY - 6, PHOTO_W, 1, trim); R(ctx, 0, floorY - 5, PHOTO_W, 1, trim);
  R(ctx, 0, floorY, PHOTO_W, PHOTO_H - floorY, floor);
  for (let y = floorY + 4; y < PHOTO_H; y += 5) D(ctx, 0, y, PHOTO_W, 1, '0', y & 1);
}
function windowPane(ctx: Ctx, x: number, y: number, w: number, h: number, s: Sky) {
  R(ctx, x - 1, y - 1, w + 2, h + 2, '7');
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); sky(ctx, s, h); ctx.restore();
  R(ctx, x + (w >> 1), y, 1, h, '7'); R(ctx, x, y + (h >> 1), w, 1, '7');
}

// ---------------------------------------------------------------- one scene per memory
const SCENES: Record<string, (ctx: Ctx) => void> = {
  mem_01(ctx) { // Gotcha Day: a crate of puppies, Pom chewing Maya's shoelace
    sky(ctx, 'day', 30); grass(ctx, 30);
    R(ctx, 30, 22, 22, 15, 'b'); R(ctx, 31, 23, 20, 13, 'a'); for (const y of [26, 31]) R(ctx, 31, y, 20, 1, '9');
    for (const x of [33, 39, 45]) { const p = x === 39 ? 2 : 0; ctx.drawImage(sprite('puppy', PUPPY), x - 1, 17 + p); }
    maya(ctx, 4, 13); R(ctx, 13, 35, 9, 1, '6'); pom(ctx, 17, 27);
  },
  mem_02(ctx) { // First Bath: a sudsy tub, Maya laughing
    room(ctx, 's', 'm', 'o', 30); for (let x = 4; x < PHOTO_W; x += 8) R(ctx, x, 0, 1, 24, '5');
    maya(ctx, 3, 11);
    R(ctx, 19, 27, 34, 12, '0'); R(ctx, 20, 28, 32, 10, '6'); R(ctx, 20, 36, 32, 2, 'o');
    pomHead(ctx, 30, 20);
    for (const [x, y, r] of [[22, 26, 2], [26, 24, 3], [42, 25, 3], [47, 27, 2], [36, 18, 1], [44, 15, 1], [25, 16, 1]]) { pxDisc(ctx, x, y, r, '6'); P(ctx, x - 1, y - 1, 's'); }
    pxRing(ctx, 36, 18, 2, '5'); pxRing(ctx, 44, 15, 2, '5');
  },
  mem_03(ctx) { // The Mail Carrier: Pom on guard by the mailbox
    sky(ctx, 'day', 26); R(ctx, 0, 26, PHOTO_W, 8, 'o'); D(ctx, 0, 33, PHOTO_W, 1, 'p'); R(ctx, 0, 34, PHOTO_W, 10, 'q');
    for (let x = 3; x < PHOTO_W; x += 12) R(ctx, x, 38, 6, 1, 'f');
    R(ctx, 44, 20, 2, 12, 'b'); R(ctx, 39, 12, 12, 9, '0'); R(ctx, 40, 13, 10, 7, 'n'); R(ctx, 40, 13, 10, 2, 'm'); R(ctx, 50, 9, 1, 5, 'r'); R(ctx, 50, 9, 3, 2, 'r');
    maya(ctx, 5, 9); pom(ctx, 23, 21);
    R(ctx, 36, 17, 1, 4, 'f'); P(ctx, 36, 22, 'f'); R(ctx, 34, 16, 1, 3, '6'); P(ctx, 34, 20, '6');
  },
  mem_04(ctx) { // Sprinkler Season: arcs of water, Maya mid-run
    sky(ctx, 'day', 26); grass(ctx, 26);
    R(ctx, 27, 34, 3, 2, 'p'); R(ctx, 28, 33, 1, 1, '6');
    for (let i = 0; i < 9; i++) { const a = -Math.PI / 2 + (i - 4) * 0.33; for (let s = 3; s < 16; s += 3) P(ctx, Math.round(28 + Math.cos(a) * s * 1.4), Math.round(33 + Math.sin(a) * s), s % 2 ? 'l' : 's'); }
    maya(ctx, 4, 13); pom(ctx, 41, 28);
    for (const [x, y] of [[44, 24], [48, 22], [16, 10]]) P(ctx, x, y, 'l');
  },
  mem_05(ctx) { // Tennis Ball Champion: the 47th ball, forever in the pond
    sky(ctx, 'day', 24); grass(ctx, 24);
    R(ctx, 30, 29, 26, 11, 'n'); R(ctx, 28, 31, 2, 7, 'n'); R(ctx, 31, 30, 24, 9, 'm'); D(ctx, 33, 32, 18, 1, 'l');
    pxDisc(ctx, 44, 34, 2, 'i'); P(ctx, 43, 33, '6'); R(ctx, 41, 37, 7, 1, 'l');
    maya(ctx, 3, 11); pom(ctx, 16, 28);
    R(ctx, 25, 16, 1, 3, '6'); P(ctx, 25, 20, '6');
  },
  mem_06(ctx) { // Bodega Bacon: the Sunday strip under the striped awning
    room(ctx, 'v', 'q', 'q', 33);
    for (let x = 0; x < PHOTO_W; x += 8) { R(ctx, x, 0, 4, 7, 'r'); R(ctx, x + 4, 0, 4, 7, '6'); } R(ctx, 0, 7, PHOTO_W, 1, '0');
    R(ctx, 30, 22, 26, 11, 'a'); R(ctx, 30, 22, 26, 2, '9'); R(ctx, 34, 12, 6, 8, 'f'); R(ctx, 42, 14, 5, 6, 'i'); R(ctx, 49, 11, 5, 9, 'c');
    maya(ctx, 3, 12); pom(ctx, 17, 26);
    for (let x = 0; x < 9; x++) P(ctx, 18 + x, 20 + ((x >> 1) & 1), x % 3 ? 'r' : 'c');
  },
  mem_07(ctx) { // Fireworks Night: on the roof, ears covered
    sky(ctx, 'night', 30); R(ctx, 0, 30, PHOTO_W, 14, '2'); D(ctx, 0, 30, PHOTO_W, 1, '3'); for (let x = 0; x < PHOTO_W; x += 9) R(ctx, x, 34, 1, 10, '1');
    pxRing(ctx, 12, 9, 5, 'd', 3); pxSpark(ctx, 12, 9, 'f', 1); pxRing(ctx, 43, 7, 6, 'f', 3); pxSpark(ctx, 43, 7, '6', 1); pxRing(ctx, 30, 14, 3, 'l', 2);
    mayaSit(ctx, 17, 15); pom(ctx, 28, 21); R(ctx, 27, 22, 2, 3, '9'); R(ctx, 37, 22, 2, 3, '9');
  },
  mem_08(ctx) { // The Big Move: five flights of stairs, Pom carried
    room(ctx, '8', '9', 'a', 34);
    for (let i = 0; i < 6; i++) { R(ctx, 30 + i * 4, 30 - i * 5, 26 - i * 4, 5, 'a'); R(ctx, 30 + i * 4, 30 - i * 5, 26 - i * 4, 1, '9'); }
    R(ctx, 3, 25, 12, 9, '9'); R(ctx, 3, 25, 12, 1, '8'); R(ctx, 8, 25, 2, 9, '7'); R(ctx, 5, 18, 9, 7, '8'); R(ctx, 9, 18, 1, 7, '7');
    maya(ctx, 18, 12); pomHead(ctx, 19, 21); R(ctx, 19, 22, 2, 2, '9'); R(ctx, 29, 22, 2, 2, '9');
  },
  mem_09(ctx) { // Pup Cup: the whole cafe sang, paper crown on
    room(ctx, 'k', 'j', 'b', 32); for (const x of [6, 18, 30, 42]) { R(ctx, x + 2, 0, 1, 5, '0'); R(ctx, x, 5, 5, 2, 'f'); D(ctx, x - 1, 7, 7, 2, 'f'); }
    R(ctx, 26, 30, 30, 3, 'a'); R(ctx, 26, 29, 30, 1, '9'); R(ctx, 30, 33, 2, 11, 'a'); R(ctx, 50, 33, 2, 11, 'a');
    R(ctx, 41, 22, 7, 8, '6'); R(ctx, 41, 26, 7, 1, 'c'); pxDisc(ctx, 44, 21, 3, '7'); P(ctx, 44, 17, 'r');
    maya(ctx, 4, 11); pom(ctx, 26, 18); R(ctx, 28, 15, 7, 3, 'f'); P(ctx, 28, 14, 'f'); P(ctx, 31, 14, 'f'); P(ctx, 34, 14, 'f'); P(ctx, 31, 16, 'r');
    for (const [x, y] of [[20, 4], [52, 12]]) { R(ctx, x, y, 1, 4, '6'); R(ctx, x + 1, y, 2, 1, '6'); P(ctx, x - 1, y + 4, '6'); }
  },
  mem_10(ctx) { // Sunrise Walk: watching the sun come up over the water
    sky(ctx, 'dawn', 26); pxDisc(ctx, 40, 26, 7, 'f'); R(ctx, 0, 26, PHOTO_W, 18, 'n'); R(ctx, 0, 26, PHOTO_W, 1, 'm');
    for (let y = 28; y < 40; y += 3) R(ctx, 36 - ((y - 28) >> 1), y, 9 + (y - 28), 1, (y >> 1) & 1 ? 'g' : 'f');
    R(ctx, 0, 37, 30, 7, 'b'); R(ctx, 0, 37, 30, 1, '9');
    mayaSit(ctx, 6, 20); pom(ctx, 18, 26);
  },
  mem_11(ctx) { // Yarn Disaster: the unravelled scarf, Pom holding the end
    room(ctx, 'c', 'e', '9', 31); windowPane(ctx, 33, 4, 16, 12, 'day');
    R(ctx, 2, 18, 18, 13, 'e'); R(ctx, 2, 18, 18, 3, 'd'); R(ctx, 2, 30, 2, 4, 'b'); R(ctx, 18, 30, 2, 4, 'b');
    mayaSit(ctx, 6, 12); R(ctx, 8, 21, 7, 2, 'r');
    let px = 15, py = 22; for (let i = 0; i < 24; i++) { px += 1; py += i < 8 ? 1 : i < 14 ? 0 : -((i & 1)); P(ctx, px, Math.min(41, py), 'r'); }
    pxDisc(ctx, 43, 39, 3, 'r'); P(ctx, 42, 38, 'c'); pom(ctx, 32, 24);
  },
  mem_12(ctx) { // Car Window: ears flying on the highway
    sky(ctx, 'day', 24); R(ctx, 0, 24, PHOTO_W, 4, 'j'); R(ctx, 0, 28, PHOTO_W, 16, 'q'); for (let x = 2; x < PHOTO_W; x += 10) R(ctx, x, 32, 5, 1, '6');
    R(ctx, 0, 22, PHOTO_W, 22, 'r'); R(ctx, 0, 22, PHOTO_W, 1, 'c'); R(ctx, 0, 43, PHOTO_W, 1, 'e');
    R(ctx, 6, 8, 44, 15, '0'); R(ctx, 7, 9, 42, 13, 's'); D(ctx, 7, 9, 42, 13, '5'); R(ctx, 28, 9, 1, 13, '0');
    mayaHead(ctx, 33, 9); pomHead(ctx, 11, 14); R(ctx, 4, 14, 7, 2, '6'); R(ctx, 2, 13, 3, 2, '7'); R(ctx, 22, 14, 6, 2, '6');
    R(ctx, 46, 4, 1, 3, '0'); P(ctx, 47, 3, '0'); R(ctx, 50, 6, 1, 3, '0'); P(ctx, 51, 5, '0');
  },
  mem_13(ctx) { // Rainy Day: a blanket fort and cartoons
    room(ctx, '3', '2', 'v', 32); windowPane(ctx, 4, 4, 14, 14, 'night');
    for (const [x, y] of [[6, 6], [10, 11], [14, 7], [8, 14], [15, 13]]) R(ctx, x, y, 1, 3, '4');
    R(ctx, 41, 18, 13, 10, '0'); R(ctx, 42, 19, 11, 8, 'l'); D(ctx, 42, 19, 11, 8, 'm'); R(ctx, 44, 28, 7, 2, '0');
    for (let i = 0; i < 14; i++) { R(ctx, 22 - i, 12 + i, 2 + i * 2, 1, i % 4 < 2 ? 'u' : 't'); } R(ctx, 8, 26, 30, 2, 'u');
    R(ctx, 16, 19, 12, 9, '1'); mayaHead(ctx, 14, 18); pomHead(ctx, 24, 22);
  },
  mem_14(ctx) { // Night Light: the hallway light left on
    room(ctx, '1', '2', '2', 32);
    R(ctx, 20, 6, 16, 26, '0'); R(ctx, 21, 7, 14, 25, 'f'); D(ctx, 21, 7, 14, 25, '7'); R(ctx, 21, 7, 14, 2, '6');
    for (let y = 32; y < PHOTO_H; y++) { const s = (y - 32) * 2; D(ctx, 20 - s, y, 16 + s * 2, 1, (y - 32) < 5 ? 'f' : 'g', y & 1); }
    pom(ctx, 22, 25);
    R(ctx, 46, 15, 4, 4, 'f'); R(ctx, 47, 14, 2, 1, '6');
  },
  mem_15(ctx) { // Belly Rubs: the magic spot
    room(ctx, '8', 'a', '9', 26); R(ctx, 4, 28, 48, 14, 'd'); R(ctx, 6, 30, 44, 10, 'c'); D(ctx, 6, 30, 44, 10, 'd');
    pom(ctx, 22, 25, true); R(ctx, 34, 29, 3, 2, '7'); R(ctx, 37, 27, 2, 3, '7');
    R(ctx, 26, 23, 10, 3, '9'); R(ctx, 25, 22, 3, 2, '9'); R(ctx, 36, 21, 12, 4, 'd');
    heart(ctx, 14, 10); heart(ctx, 38, 6, 'c'); heart(ctx, 26, 3);
  },
  mem_16(ctx) { // Sick Day: the best nurse in Brooklyn
    room(ctx, 't', 'u', 'b', 34); windowPane(ctx, 38, 4, 14, 12, 'day');
    R(ctx, 3, 18, 2, 18, 'b'); R(ctx, 3, 18, 48, 2, 'b');
    R(ctx, 5, 20, 14, 8, '6'); mayaHead(ctx, 6, 14); R(ctx, 5, 26, 46, 10, 'm'); D(ctx, 5, 26, 46, 10, 'n'); R(ctx, 5, 26, 46, 1, 's');
    pom(ctx, 24, 17); R(ctx, 44, 30, 8, 6, '6'); R(ctx, 44, 30, 8, 1, 'c'); R(ctx, 47, 27, 3, 3, '6');
  },
  mem_17(ctx) { // Waiting by the Door: six o'clock, every evening
    room(ctx, 'c', 'e', 'a', 33);
    R(ctx, 30, 4, 20, 29, 'b'); R(ctx, 31, 5, 18, 28, 'a'); R(ctx, 34, 8, 12, 8, 'f'); D(ctx, 34, 8, 12, 8, 'g'); R(ctx, 34, 12, 12, 1, 'a'); R(ctx, 33, 20, 14, 9, '9');
    R(ctx, 45, 21, 2, 2, 'f');
    R(ctx, 8, 6, 10, 10, '0'); R(ctx, 9, 7, 8, 8, '7'); R(ctx, 13, 8, 1, 4, '0'); R(ctx, 13, 11, 3, 1, '0');
    pom(ctx, 18, 22); heart(ctx, 21, 15);
  },
  mem_18(ctx) { // Good Girl: lights out, said every night
    room(ctx, '2', '1', 'v', 30); windowPane(ctx, 34, 4, 16, 14, 'night'); pxDisc(ctx, 45, 8, 2, 'f'); P(ctx, 44, 7, '6');
    R(ctx, 3, 22, 28, 11, '7'); R(ctx, 3, 26, 28, 7, 'u'); D(ctx, 3, 26, 28, 7, 't'); R(ctx, 2, 18, 2, 18, 'b');
    mayaHead(ctx, 4, 13); pom(ctx, 17, 16); heart(ctx, 22, 4, 'c');
    R(ctx, 38, 24, 6, 9, 'b'); R(ctx, 39, 21, 4, 3, 'f'); D(ctx, 37, 20, 8, 1, 'g');
  },
};
/** A memory without a scene of its own still gets a warm generic snapshot. */
function generic(ctx: Ctx) { sky(ctx, 'dusk', 28); grass(ctx, 28); maya(ctx, 12, 9); pom(ctx, 28, 24); heart(ctx, 26, 8); }

const photoCache = new Map<string, HTMLCanvasElement>();
/** The 56x44 photo of a memory (cached). blink = the idle frame where Maya / Pom shut their eyes. */
export function photo(id: string, blink = false): HTMLCanvasElement {
  const key = blink ? id + ':b' : id;
  let c = photoCache.get(key); if (c) return c;
  c = document.createElement('canvas'); c.width = PHOTO_W; c.height = PHOTO_H;
  const ctx = c.getContext('2d')!; ctx.imageSmoothingEnabled = false;
  BLINK = blink;
  try { (SCENES[id] ?? generic)(ctx); } finally { BLINK = false; }
  photoCache.set(key, c); return c;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/**
 * Polaroid card (frame 64x62: 4px borders, 14px chin) with its photo at top-left (x, y).
 * dev 0..1 "develops" the photo: an ordered-dither veil of plum lifts pixel by pixel. scale is an integer.
 */
export function polaroid(ctx: Ctx, id: string, x: number, y: number, dev = 1, scale = 1, blink = false) {
  const s = Math.max(1, Math.round(scale)); x = Math.round(x); y = Math.round(y);
  const fw = 64 * s, fh = 62 * s;
  R(ctx, x + 1, y + fh + 1, fw + 1, 1, '1'); R(ctx, x + fw + 1, y + 1, 1, fh + 1, '1');   // solid 1px drop shadow
  R(ctx, x - 1, y - 1, fw + 2, fh + 2, '0');
  R(ctx, x, y, fw, fh, '6'); R(ctx, x, y + fh - s, fw, s, '7'); R(ctx, x + fw - s, y, s, fh, '7');
  const px = x + 4 * s, py = y + 4 * s;
  R(ctx, px - 1, py - 1, PHOTO_W * s + 2, PHOTO_H * s + 2, 'o');
  ctx.drawImage(photo(id, blink && dev >= 1), px, py, PHOTO_W * s, PHOTO_H * s);
  if (dev < 1) {
    const th = Math.floor(dev * 17);
    for (let yy = 0; yy < PHOTO_H; yy++) for (let xx = 0; xx < PHOTO_W; xx++) {
      const b = BAYER[(yy & 3) * 4 + (xx & 3)];
      if (b >= th) { ctx.fillStyle = col(b >= th + 6 ? 'v' : '2'); ctx.fillRect(px + xx * s, py + yy * s, s, s); }
    }
  }
  // a strip of tape across the top edge
  const tx = x + fw / 2 - 9 * s, ty = y - 3 * s;
  R(ctx, tx, ty, 18 * s, 6 * s, '7'); D(ctx, tx, ty, 18 * s, 6 * s, 'o', 1);
  for (let k = 0; k < 6 * s; k += 2) { P(ctx, tx - 1, ty + k, '7'); P(ctx, tx + 18 * s, ty + k + 1, '7'); }
}

// ---------------------------------------------------------------- tiny polaroids in the playfield
/**
 * The real photo boiled down to a w x h thumbnail: each cell takes the most common palette colour of its
 * block of the 56x44 scene, so a falling or carried polaroid shows a hint of that memory's actual picture.
 */
const microCache = new Map<string, HTMLCanvasElement>();
function micro(id: string, w: number, h: number): HTMLCanvasElement {
  const key = `${id}|${w}x${h}`; let c = microCache.get(key); if (c) return c;
  c = document.createElement('canvas'); c.width = w; c.height = h;
  const out = c.getContext('2d')!;
  let data: Uint8ClampedArray | null = null;
  try { data = photo(id).getContext('2d')!.getImageData(0, 0, PHOTO_W, PHOTO_H).data; } catch { data = null; }
  if (!data) { R(out, 0, 0, w, h, '5'); R(out, 0, h - 2, w, 2, 'j'); }
  else for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
    const x0 = Math.floor(cx * PHOTO_W / w), x1 = Math.floor((cx + 1) * PHOTO_W / w), y0 = Math.floor(cy * PHOTO_H / h), y1 = Math.floor((cy + 1) * PHOTO_H / h);
    const n = new Map<number, number>(); let best = 0, bn = -1;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
      const i = (yy * PHOTO_W + xx) * 4; const v = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      const k = (n.get(v) ?? 0) + 1; n.set(v, k); if (k > bn) { bn = k; best = v; }
    }
    out.fillStyle = '#' + best.toString(16).padStart(6, '0'); out.fillRect(cx, cy, 1, 1);
  }
  microCache.set(key, c); return c;
}

/** The carried polaroid (9x10 card + 1px ink), cached per memory. Photo window 7x6 at (1,1). */
const carryCache = new Map<string, HTMLCanvasElement>();
function carryCard(id: string, flipY: boolean): HTMLCanvasElement {
  const key = flipY ? id + ':u' : id;
  let c = carryCache.get(key); if (c) return c;
  c = document.createElement('canvas'); c.width = 11; c.height = 12;
  const x = c.getContext('2d')!;
  if (flipY) { x.translate(0, 12); x.scale(1, -1); }   // a belly-up cat holds it the same way, turned round
  R(x, 0, 0, 11, 12, '0'); R(x, 1, 1, 9, 10, '6'); R(x, 9, 1, 1, 10, '7'); R(x, 1, 10, 9, 1, '7');
  x.drawImage(micro(id, 7, 6), 2, 2);
  carryCache.set(key, c); return c;
}
/**
 * The little polaroid a memory cat holds in its mouth. (cx, chinY) is the cat's chin pixel; dir is +1 when the
 * cat faces down (the photo hangs below), -1 when it flies belly-up (the photo points up). The card tucks 3px
 * into the muzzle, a jaw line with two fangs bites its edge, and its far end swings a pixel per step.
 * extra = more photos in the same bite (a bundle of lost memories): their corners peek out behind.
 */
export function carriedPolaroid(ctx: Ctx, id: string, cx: number, chinY: number, dir: 1 | -1, t: number, extra = 0) {
  const sw = [0, 1, 0, -1][(t >> 4) & 3];
  const card = carryCard(id, dir < 0);
  const x = Math.round(cx) - 5, top = dir > 0 ? Math.round(chinY) - 2 : Math.round(chinY) + 2 - 11;
  for (let e = Math.min(2, extra); e > 0; e--) { // peeking corners of the other photos
    const ex = x + e * 3 - sw, ey = top + dir * e;
    R(ctx, ex, ey, 11, 12, '0'); R(ctx, ex + 1, ey + 1, 9, 10, e === 1 ? '7' : '8');
  }
  // near half (by the mouth) stays put, far half swings: a 1px tilt
  const near = 6;
  if (dir > 0) { ctx.drawImage(card, 0, 0, 11, near, x, top, 11, near); ctx.drawImage(card, 0, near, 11, 12 - near, x + sw, top + near, 11, 12 - near); }
  else { ctx.drawImage(card, 0, 12 - near, 11, near, x, top + 12 - near, 11, near); ctx.drawImage(card, 0, 0, 11, 12 - near, x + sw, top, 11, 12 - near); }
  if (((t >> 3) & 7) === 0) P(ctx, x + 3 + sw, top + (dir > 0 ? 5 : 6), '6');   // a glint runs across the photo now and then
  // the bite: jaw line over the card's edge, two fangs on the white border
  const jy = Math.round(chinY);
  R(ctx, x + 2, jy, 7, 1, '0'); P(ctx, x + 1, jy - dir, '0'); P(ctx, x + 9, jy - dir, '0');
  P(ctx, x + 3, jy + dir, '6'); P(ctx, x + 7, jy + dir, '6');
}

/** Bounds of a sprite's muzzle: the lowest opaque row near the centre column (the chin of a down-facing cat). */
const chinCache = new Map<string, { w: number; h: number; chin: number }>();
export function spriteChin(rows: string[] | null, key: string) {
  let v = chinCache.get(key); if (v) return v;
  if (!rows) return { w: 32, h: 32, chin: 28 };
  const h = rows.length, w = Math.max(...rows.map(r => r.length)), m = w >> 1; let chin = h - 1;
  for (let y = h - 1; y >= 0; y--) if ([-2, -1, 0, 1].some(d => { const ch = rows[y][m + d]; return ch && ch !== '.' && ch !== ' '; })) { chin = y; break; }
  v = { w, h, chin }; chinCache.set(key, v); return v;
}

/**
 * Gold rim hugging a sprite's silhouette: 1px `key` right outside the sprite's own ink outline, then 1px of ink
 * beyond it so the rim reads on light floors too. Drawn in front of the cat (it never touches sprite pixels).
 */
const rimCache = new Map<string, HTMLCanvasElement | null>();
export function silhouetteRim(ctx: Ctx, rows: string[] | null, key: string, cacheKey: string, flipY: boolean, cx: number, cy: number) {
  const ck = `${cacheKey}|${flipY ? 1 : 0}|${key}`;
  let out = rimCache.get(ck);
  if (out === undefined) {
    out = null;
    if (rows && typeof document !== 'undefined') {
      const h = rows.length, w = Math.max(...rows.map(r => r.length));
      const on = (x: number, y: number) => { const ch = rows[flipY ? h - 1 - y : y]?.[x]; return !!ch && ch !== '.' && ch !== ' '; };
      const ring1 = (x: number, y: number) => !on(x, y) && (on(x + 1, y) || on(x - 1, y) || on(x, y + 1) || on(x, y - 1));
      out = document.createElement('canvas'); out.width = w + 4; out.height = h + 4;
      const c = out.getContext('2d')!;
      for (let y = -2; y < h + 2; y++) for (let x = -2; x < w + 2; x++) {
        if (on(x, y)) continue;
        if (ring1(x, y)) { c.fillStyle = col(key); c.fillRect(x + 2, y + 2, 1, 1); continue; }
        let near = false; for (let j = -1; j <= 1 && !near; j++) for (let i = -1; i <= 1; i++) if (ring1(x + i, y + j)) { near = true; break; }
        if (near) { c.fillStyle = col('0'); c.fillRect(x + 2, y + 2, 1, 1); }
      }
    }
    rimCache.set(ck, out);
  }
  if (out) ctx.drawImage(out, Math.round(cx - out.width / 2), Math.round(cy - out.height / 2));
}

/**
 * The carrier's halo: one clean two-tone pixel ring (gold outside, white inside) between two ink rings, with
 * bright pixels chasing round it. bright = the slow blink's lit frame (the inner band flares white).
 */
export function carrierHalo(ctx: Ctx, cx: number, cy: number, r: number, t: number, bright: boolean) {
  pxRing(ctx, cx, cy, r + 1, '0'); pxRing(ctx, cx, cy, r - 2, '0');
  pxRing(ctx, cx, cy, r, 'f'); pxRing(ctx, cx, cy, r - 1, bright ? '6' : 'f');
  const n = 6;
  for (let k = 0; k < n; k++) {
    const a = t / 24 + (k * Math.PI * 2) / n;
    for (let s = 0; s < 3; s++) { // a head pixel and a 2-pixel tail, all on the ring
      const b = a - s * 0.06; const px = Math.round(cx + Math.cos(b) * (r - 0.5)), py = Math.round(cy + Math.sin(b) * (r - 0.5));
      ctx.fillStyle = col(s === 0 ? '6' : s === 1 ? (bright ? '6' : 'f') : 'f'); ctx.fillRect(px, py, 1, 1);
      if (s === 0) { ctx.fillStyle = col('6'); ctx.fillRect(Math.round(cx + Math.cos(b) * r), Math.round(cy + Math.sin(b) * r), 1, 1); }
    }
  }
}

/**
 * A falling polaroid (14x16) that flips over as it drifts, like a leaf: drawn by integer-width column scaling
 * (cos of the flip -> 14, 12, 8, 4, 2 px wide), front shows a 12x10 thumbnail of the photo, back is plain cream.
 */
const flipCache = new Map<string, HTMLCanvasElement>();
function flipFace(id: string, back: boolean): HTMLCanvasElement {
  const k = id + (back ? ':b' : ':f'); let c = flipCache.get(k); if (c) return c;
  c = document.createElement('canvas'); c.width = 16; c.height = 18;
  const x = c.getContext('2d')!;
  R(x, 0, 0, 16, 18, '0'); R(x, 1, 1, 14, 16, back ? '7' : '6');
  if (back) { R(x, 1, 16, 14, 1, '8'); R(x, 5, 1, 6, 2, 'o'); R(x, 4, 8, 8, 1, '8'); R(x, 4, 11, 6, 1, '8'); }
  else { R(x, 14, 1, 1, 16, '7'); R(x, 1, 16, 14, 1, '7'); x.drawImage(micro(id, 12, 10), 2, 2); }
  flipCache.set(k, c); return c;
}
export function fallingPolaroid(ctx: Ctx, id: string, cx: number, cy: number, t: number, flip = true) {
  const a = flip ? Math.cos(t / 14) : 1;
  const w = Math.max(2, Math.round(Math.abs(a) * 8) * 2);
  const img = flipFace(id, a < 0);
  ctx.drawImage(img, Math.round(cx - w / 2), Math.round(cy - 9), w, 18);
}
