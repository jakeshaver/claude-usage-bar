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
    // sky, far hills and a speed blur of fence posts behind the car
    sky(ctx, 'day', 22); R(ctx, 0, 17, PHOTO_W, 3, 'j'); D(ctx, 0, 16, PHOTO_W, 1, 'j'); R(ctx, 0, 20, PHOTO_W, 2, 'k');
    for (let x = 1; x < PHOTO_W; x += 6) R(ctx, x, 18, 3, 1, 'i');
    // the window opening: ink frame, grey upholstery inside, the B pillar, the back window rolled up (glass glint)
    R(ctx, 3, 5, 50, 20, '0'); R(ctx, 4, 6, 48, 18, 'p'); R(ctx, 4, 6, 48, 2, 'o'); R(ctx, 4, 21, 48, 2, 'q');
    R(ctx, 29, 5, 2, 20, '0');
    R(ctx, 31, 6, 21, 4, 's'); D(ctx, 31, 9, 21, 1, '5'); R(ctx, 31, 10, 21, 1, '0');
    for (const gx of [35, 44]) { P(ctx, gx, 8, '6'); P(ctx, gx + 1, 7, '6'); P(ctx, gx + 2, 6, '6'); }
    mayaHead(ctx, 36, 11); pomHead(ctx, 13, 13);
    // the door: chrome sill, a pale highlight band, door seam, two handles, a darker lower crease, the rocker
    R(ctx, 0, 25, PHOTO_W, 1, '7'); R(ctx, 0, 26, PHOTO_W, 13, 'r'); R(ctx, 0, 26, PHOTO_W, 1, 'o');
    R(ctx, 0, 28, PHOTO_W, 2, 'c'); D(ctx, 0, 30, PHOTO_W, 1, 'c');
    R(ctx, 0, 35, PHOTO_W, 2, 'e'); D(ctx, 0, 34, PHOTO_W, 1, 'e', 1);
    R(ctx, 30, 26, 1, 11, 'e'); P(ctx, 31, 26, 'c');
    for (const hx of [21, 44]) { R(ctx, hx - 1, 30, 8, 3, '0'); R(ctx, hx, 31, 6, 1, '7'); P(ctx, hx + 5, 31, 'o'); }
    R(ctx, 52, 21, 4, 5, '0'); R(ctx, 53, 22, 3, 3, 'r'); P(ctx, 53, 22, 'c');            // side mirror
    R(ctx, 0, 37, PHOTO_W, 1, '0'); R(ctx, 0, 38, PHOTO_W, 1, 'q');
    // the road rushing by under the car: asphalt, a dashed lane line, a sliver of the front wheel
    R(ctx, 0, 39, PHOTO_W, 5, 'q'); D(ctx, 0, 39, PHOTO_W, 1, '0');
    for (let x = 1; x < PHOTO_W; x += 11) R(ctx, x, 42, 6, 1, 'f');
    R(ctx, 3, 35, 15, 4, '0'); R(ctx, 2, 36, 17, 3, '0');                                  // wheel arch
    pxDisc(ctx, 10, 40, 4, '0'); pxDisc(ctx, 10, 40, 3, 'q'); R(ctx, 9, 39, 3, 3, 'o'); P(ctx, 10, 40, 'p');
    // ears flying in the wind, wind streaks, Maya singing badly
    R(ctx, 6, 13, 7, 2, '6'); R(ctx, 3, 12, 3, 2, '7'); R(ctx, 24, 13, 5, 2, '6');
    R(ctx, 8, 10, 4, 1, '6'); R(ctx, 5, 17, 6, 1, '6');
    R(ctx, 47, 13, 1, 3, '0'); P(ctx, 48, 12, '0'); P(ctx, 46, 16, '0'); R(ctx, 50, 15, 1, 3, '0'); P(ctx, 51, 14, '0'); P(ctx, 49, 18, '0');
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
 * lost = a recovered photo: periwinkle-weathered frame instead of fresh white.
 * dev 0..1 "develops" the photo: a milky cream ordered-dither veil lifts pixel by pixel, like an instant photo. scale is an integer.
 */
export function polaroid(ctx: Ctx, id: string, x: number, y: number, dev = 1, scale = 1, blink = false, lost = false) {
  const s = Math.max(1, Math.round(scale)); x = Math.round(x); y = Math.round(y);
  const fw = 64 * s, fh = 62 * s;
  R(ctx, x + 1, y + fh + 1, fw + 1, 1, '1'); R(ctx, x + fw + 1, y + 1, 1, fh + 1, '1');   // solid 1px drop shadow
  R(ctx, x - 1, y - 1, fw + 2, fh + 2, '0');
  R(ctx, x, y, fw, fh, lost ? '5' : '6'); R(ctx, x, y + fh - s, fw, s, lost ? '4' : '7'); R(ctx, x + fw - s, y, s, fh, lost ? '4' : '7');
  if (lost) D(ctx, x + s, y + (PHOTO_H + 6) * s, fw - 2 * s, fh - (PHOTO_H + 7) * s, '4', 1);   // a weathered periwinkle chin: it has been somewhere
  const px = x + 4 * s, py = y + 4 * s;
  R(ctx, px - 1, py - 1, PHOTO_W * s + 2, PHOTO_H * s + 2, 'o');
  ctx.drawImage(photo(id, blink && dev >= 1), px, py, PHOTO_W * s, PHOTO_H * s);
  if (dev < 1) {
    const th = Math.floor(dev * 17);
    for (let yy = 0; yy < PHOTO_H; yy++) for (let xx = 0; xx < PHOTO_W; xx++) {
      const b = BAYER[(yy & 3) * 4 + (xx & 3)];
      if (b < th) continue;
      // milky cream emulsion first (cream / light grey dither), warming to tan right before a pixel develops
      const k = b >= th + 5 ? (((xx + yy) & 1) ? '7' : (b & 1 ? 'o' : '7')) : '8';
      ctx.fillStyle = col(k); ctx.fillRect(px + xx * s, py + yy * s, s, s);
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

/** Top of a cat's head: the first row at least 40% as wide as the sprite (skips a tail tip sticking up). */
const headCache = new Map<string, number>();
export function spriteHeadTop(rows: string[] | null, key: string) {
  let v = headCache.get(key); if (v !== undefined) return v;
  v = 0;
  if (rows) {
    const w = Math.max(...rows.map(r => r.length));
    for (let y = 0; y < rows.length; y++) { let n = 0; for (const ch of rows[y]) if (ch !== '.' && ch !== ' ') n++; if (n >= w * 0.4) { v = y; break; } }
  }
  headCache.set(key, v); return v;
}

/**
 * The carrier's golden rim: a 2px band hugging the sprite's silhouette right outside its own ink outline
 * (gold 'f' inside, orange 'g' outside), closed by 1px of ink so it reads on pale floors too. It stays within
 * the 4px of air between formation neighbours, so it never crosses another cat. White shimmer pixels walk
 * round the gold band (three heads with short cream tails): unmistakable at 1x, never a blink.
 * It is drawn right AFTER the cat, so its inner pixel row covers the light readability rim interaction gives every
 * cat at dusk and night (the carrier swaps that rim for gold instead of stacking outside it). solid = both rows
 * gold (night: out-shines the lavender rims of its neighbours).
 */
interface Rim { img: HTMLCanvasElement; perim: [number, number][] }
const rimCache = new Map<string, Rim | null>();
export function carrierRim(ctx: Ctx, rows: string[] | null, cacheKey: string, flipY: boolean, cx: number, cy: number, t: number, solid = false) {
  const ck = `${cacheKey}|${flipY ? 1 : 0}|${solid ? 1 : 0}`;
  let rim = rimCache.get(ck);
  if (rim === undefined) {
    rim = null;
    if (rows && typeof document !== 'undefined') {
      const h = rows.length, w = Math.max(...rows.map(r => r.length)), M = 3;
      const on = (x: number, y: number) => { const ch = rows[flipY ? h - 1 - y : y]?.[x]; return !!ch && ch !== '.' && ch !== ' '; };
      // distance rings (4-neighbour) out from the silhouette
      const W2 = w + M * 2, H2 = h + M * 2; const dist = new Int8Array(W2 * H2).fill(99);
      for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) if (on(x - M, y - M)) dist[y * W2 + x] = 0;
      for (let k = 1; k <= M; k++) for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
        if (dist[y * W2 + x] !== 99) continue;
        const n = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < W2 && yy < H2 && dist[yy * W2 + xx] === k - 1;
        if (n(x + 1, y) || n(x - 1, y) || n(x, y + 1) || n(x, y - 1)) dist[y * W2 + x] = k;
      }
      const img = document.createElement('canvas'); img.width = W2; img.height = H2;
      const c = img.getContext('2d')!; const perim: [number, number][] = [];
      for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
        const d = dist[y * W2 + x]; if (d < 1 || d > M) continue;
        c.fillStyle = col(d === 1 ? 'f' : d === 2 ? (solid ? 'f' : 'g') : '0'); c.fillRect(x, y, 1, 1);
        if (d === 1) perim.push([x, y]);
      }
      const ox = W2 / 2, oy = H2 / 2;
      perim.sort((p, q) => Math.atan2(p[1] - oy, p[0] - ox) - Math.atan2(q[1] - oy, q[0] - ox));
      rim = { img, perim };
    }
    rimCache.set(ck, rim);
  }
  if (!rim) return;
  const x0 = Math.round(cx - rim.img.width / 2), y0 = Math.round(cy - rim.img.height / 2);
  ctx.drawImage(rim.img, x0, y0);
  const n = rim.perim.length; if (!n) return;
  for (let k = 0; k < 3; k++) {
    const head = ((t >> 1) + Math.floor((k * n) / 3)) % n;
    for (let s = 0; s < 3; s++) {
      const [px, py] = rim.perim[(head - s + n) % n];
      ctx.fillStyle = col(s === 0 ? '6' : '7'); ctx.fillRect(x0 + px, y0 + py, 1, 1);
    }
  }
}

/** A little gold pixel crown that floats over the carrier's head (jewels, a glint that runs along the band). */
const CROWN = [
  '6...6...6',
  'f...f...f',
  'ff.fff.ff',
  'fffffffff',
  'frfflffrf',
  'ggggggggg',
];
export function carrierCrown(ctx: Ctx, cx: number, baseY: number, flipY: boolean, t: number) {
  const s = sprite('crown', CROWN); const bob = ((t >> 4) & 1);
  const x = Math.round(cx) - (s.width >> 1);
  const y = flipY ? Math.round(baseY) + bob : Math.round(baseY) - s.height - bob;
  fig(ctx, 'crown', CROWN, x, y, flipY);
  const g = (t >> 2) % 14;   // a glint sweeps across the band, then rests
  if (g < 9) { ctx.fillStyle = col('6'); ctx.fillRect(x + 1 + g, y + (flipY ? s.height - 1 - 4 : 4), 1, 1); }
}

/** A red heart pin (with ink outline and a white glint) pushed through the top of a polaroid. */
const PIN = ['.rr.rr.', 'r6rrrrr', 'rrrrrre', '.rrrre.', '..rre..', '...e...'];
export function heartPin(ctx: Ctx, cx: number, cy: number) { fig(ctx, 'pin', PIN, Math.round(cx) - 4, Math.round(cy) - 4); }

/** A soft 1px-dither ink shadow on the ground (w x h oval), for the falling polaroid. */
export function groundShadow(ctx: Ctx, cx: number, cy: number, w: number, h: number) {
  cx = Math.round(cx); cy = Math.round(cy); ctx.fillStyle = col('0');
  const a = w / 2, b = h / 2;
  for (let yy = -Math.floor(b); yy <= Math.floor(b); yy++) for (let xx = -Math.floor(a); xx <= Math.floor(a); xx++) {
    if ((xx * xx) / (a * a) + (yy * yy) / (b * b) > 1) continue;
    if (((cx + xx + cy + yy) & 1) === 0) ctx.fillRect(cx + xx, cy + yy, 1, 1);
  }
}

/**
 * A falling polaroid (14x16 incl. its 1px ink line) that flips over as it drifts, like a leaf. The flip is drawn by
 * integer-width column scaling that sways 14 -> 12 -> 8 px and never goes edge-on or shows its
 * back, so the card always reads as a photo. The front's 10x8 photo window is the memory's own picture boiled down, with a tiny Maya (brown hair, pink
 * shirt) and Pom standing in it so it reads as "a photo of her" at a glance; the back is plain cream with a pen note.
 */
export const DROP_W = 14, DROP_H = 16;
const MINI_MAYA = ['.bbb.', 'b999b', '9ddd9', '.ddd.', '.ddd.', '.n.n.'];
const MINI_POM = ['6.6', '666', '6.6'];
const flipCache = new Map<string, HTMLCanvasElement>();
function flipFace(id: string, back: boolean, lost = false): HTMLCanvasElement {
  const k = id + (back ? ':b' : ':f') + (lost ? 'L' : ''); let c = flipCache.get(k); if (c) return c;
  c = document.createElement('canvas'); c.width = DROP_W; c.height = DROP_H;
  const x = c.getContext('2d')!;
  const paper = lost ? '5' : '6', edge = lost ? '4' : '7';
  R(x, 0, 0, DROP_W, DROP_H, '0'); R(x, 1, 1, DROP_W - 2, DROP_H - 2, back ? '7' : paper);
  if (back) { R(x, 1, DROP_H - 2, DROP_W - 2, 1, '8'); R(x, 4, 1, 6, 2, 'o'); R(x, 3, 7, 8, 1, '8'); R(x, 3, 10, 5, 1, '8'); }
  else {
    R(x, DROP_W - 2, 1, 1, DROP_H - 2, edge); R(x, 1, DROP_H - 2, DROP_W - 2, 1, edge);
    x.drawImage(micro(id, 10, 8), 2, 2);
    // Maya (pink shirt) and a little white Pom stand in the picture, feet on its bottom edge
    MINI_MAYA.forEach((row, yy) => { for (let xx = 0; xx < row.length; xx++) if (row[xx] !== '.') P(x, 2 + xx, 4 + yy, row[xx]); });
    MINI_POM.forEach((row, yy) => { for (let xx = 0; xx < row.length; xx++) if (row[xx] !== '.') P(x, 8 + xx, 7 + yy, row[xx]); });
    P(x, 9, 7, '0');
  }
  flipCache.set(k, c); return c;
}
/** current on-screen width of the flipping card (14, 12, 8 or 4: never a 1-2px sliver) */
export function dropWidth(t: number, flip = true) {
  if (!flip) return DROP_W;
  // a leaf's sway, not a coin spin: the card turns at most ~70 degrees each way, so the photo side always faces Pom
  const a = Math.cos(Math.sin(t / 24) * 0.98);
  return a > 0.88 ? 14 : a > 0.7 ? 12 : 8;
}
/**
 * Draw the drifting polaroid centred on (cx, cy). extra > 0 = a bundle: up to two more cards peek out behind it.
 */
export function fallingPolaroid(ctx: Ctx, id: string, cx: number, cy: number, t: number, flip = true, extra = 0, lost = false) {
  const w = dropWidth(t, flip), back = false;
  const x = Math.round(cx - w / 2), y = Math.round(cy - DROP_H / 2);
  for (let e = Math.min(2, extra); e > 0; e--) { R(ctx, x + e * 3, y - e * 2, w, DROP_H, '0'); R(ctx, x + e * 3 + 1, y - e * 2 + 1, w - 2, DROP_H - 2, e === 1 ? '7' : '8'); }
  ctx.drawImage(flipFace(id, back, lost), x, y, w, DROP_H);
}
/**
 * The drop's halo: a crisp 1px gold outline right around the card (outside its ink line) plus a sparse 25% dither
 * of gold, then orange, no wider than 5px beyond it: a glint, not a fireball. Hugs the card's current flip width.
 */
export function dropHalo(ctx: Ctx, cx: number, cy: number, w: number, t: number, rimKey = 'f') {
  const x0 = Math.round(cx - w / 2) - 1, y0 = Math.round(cy - DROP_H / 2) - 1, x1 = x0 + w + 1, y1 = y0 + DROP_H + 1;
  R(ctx, x0, y0, w + 2, 1, rimKey); R(ctx, x0, y1, w + 2, 1, rimKey); R(ctx, x0, y0, 1, DROP_H + 2, rimKey); R(ctx, x1, y0, 1, DROP_H + 2, rimKey);
  const ph = (t >> 4) & 1;
  for (let yy = y0 - 5; yy <= y1 + 5; yy++) for (let xx = x0 - 5; xx <= x1 + 5; xx++) {
    const dx = xx < x0 ? x0 - xx : xx > x1 ? xx - x1 : 0, dy = yy < y0 ? y0 - yy : yy > y1 ? yy - y1 : 0;
    const d = Math.max(dx, dy) + (dx && dy ? 1 : 0); if (d < 2 || d > 5) continue;
    if (((xx + ph) & 1) || ((yy + (xx >> 1)) & 1)) continue;   // 25% ordered dither, shimmering by a pixel
    if (d === 5 && ((xx + yy) & 2)) continue;                   // the outer edge thins out
    ctx.fillStyle = col(d <= 3 ? rimKey : rimKey === 'f' ? 'g' : 'm'); ctx.fillRect(xx, yy, 1, 1);
  }
}

/** Solid white silhouette (with a 1px ink ring) of a sprite: the carrier's 2-frame flash on the boop. */
const silCache = new Map<string, HTMLCanvasElement | null>();
export function whiteSilhouette(ctx: Ctx, rows: string[] | null, cacheKey: string, flipY: boolean, cx: number, cy: number) {
  const ck = `${cacheKey}|${flipY ? 1 : 0}`;
  let img = silCache.get(ck);
  if (img === undefined) {
    img = null;
    if (rows && typeof document !== 'undefined') {
      const h = rows.length, w = Math.max(...rows.map(r => r.length));
      const on = (x: number, y: number) => { const ch = rows[flipY ? h - 1 - y : y]?.[x]; return !!ch && ch !== '.' && ch !== ' '; };
      img = document.createElement('canvas'); img.width = w + 2; img.height = h + 2;
      const c = img.getContext('2d')!;
      for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) {
        if (on(x, y)) { c.fillStyle = col('6'); c.fillRect(x + 1, y + 1, 1, 1); }
        else if (on(x + 1, y) || on(x - 1, y) || on(x, y + 1) || on(x, y - 1)) { c.fillStyle = col('f'); c.fillRect(x + 1, y + 1, 1, 1); }
      }
    }
    silCache.set(ck, img);
  }
  if (img) ctx.drawImage(img, Math.round(cx - img.width / 2), Math.round(cy - img.height / 2));
}

/** A small "RECOVERED" rubber stamp (teal ink, 1px border, slightly uneven) for a lost memory's photo corner. */
export function recoveredStamp(ctx: Ctx, x: number, y: number, label: (c: Ctx, s: string, x: number, y: number) => void) {
  x = Math.round(x); y = Math.round(y);
  const w = 58, h = 11;
  R(ctx, x - 1, y - 1, w + 2, h + 2, '0');
  R(ctx, x, y, w, h, '7'); R(ctx, x, y, w, 1, 'm'); R(ctx, x, y + h - 1, w, 1, 'm'); R(ctx, x, y, 1, h, 'm'); R(ctx, x + w - 1, y, 1, h, 'm');
  R(ctx, x + 2, y + 2, w - 4, h - 4, 'l'); D(ctx, x + 2, y + 2, w - 4, h - 4, 'm');
  label(ctx, 'RECOVERED', x + 3, y + 2);
  P(ctx, x + 1, y + 1, '7'); P(ctx, x + w - 2, y + h - 2, '7');   // worn corners of the ink
}

/**
 * The polaroid at exactly half size (32x31 card + 1px ink, photo 28x22): the 56x44 photo drawn at an exact 2:1
 * nearest-neighbour step, so it stays crisp. Used mid-flight when a card files its photo into the album.
 */
export function halfPolaroid(ctx: Ctx, id: string, x: number, y: number, lost = false) {
  x = Math.round(x); y = Math.round(y);
  R(ctx, x + 1, y + 32, 33, 1, '1'); R(ctx, x + 33, y + 1, 1, 32, '1');
  R(ctx, x - 1, y - 1, 34, 33, '0');
  R(ctx, x, y, 32, 31, lost ? '5' : '6'); R(ctx, x, y + 30, 32, 1, lost ? '4' : '7'); R(ctx, x + 31, y, 1, 31, lost ? '4' : '7');
  R(ctx, x + 1, y + 1, 30, 24, 'o');
  ctx.drawImage(photo(id), 0, 0, PHOTO_W, PHOTO_H, x + 2, y + 2, PHOTO_W / 2, PHOTO_H / 2);
}
/** The 9x10 thumbnail polaroid (+1px ink) centred on (cx, cy): the last step before it lands in the album. */
export function tinyPolaroid(ctx: Ctx, id: string, cx: number, cy: number) {
  ctx.drawImage(carryCard(id, false), Math.round(cx) - 5, Math.round(cy) - 6);
}
