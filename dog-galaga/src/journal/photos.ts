// Polaroid photo composer: each memory becomes a tiny 88x64 pixel scene (area backdrop, Pom, a prop and a
// little story detail), rendered once into a cached palette-exact canvas. Thumbnails are a 44x40 crop of the
// same canvas and the viewer shows it at an integer 2x, so every size is the same picture.
import { col } from '../core/palette';
import { spriteCanvas } from '../art/sprite';

export const PHOTO_W = 88, PHOTO_H = 64;
/** Thumbnail crop window inside the photo (keeps Pom's face and the edge of the prop). */
export const THUMB = { x: 34, y: 14, w: 44, h: 40 };

type Ctx = CanvasRenderingContext2D;
type Deco = 'fence' | 'road' | 'trees' | 'brick' | 'skyline' | 'cafe' | 'water' | 'pipes' | 'clouds' | 'stars' | 'swirl' | 'panels' | 'hull';
interface Look { sky: [string, string, string]; ground: [string, string]; horizon: number; deco: Deco }
/** Area backdrops (palette keys, see core/palette.ts). */
const LOOK: Record<string, Look> = {
  backyard: { sky: ['m', 'l', 's'], ground: ['j', 'k'], horizon: 40, deco: 'fence' },
  street: { sky: ['m', 'l', 's'], ground: ['p', 'q'], horizon: 42, deco: 'road' },
  park: { sky: ['l', 's', '6'], ground: ['i', 'j'], horizon: 42, deco: 'trees' },
  alley: { sky: ['u', 'e', 'd'], ground: ['q', 'v'], horizon: 44, deco: 'brick' },
  rooftops: { sky: ['0', '1', '2'], ground: ['q', 'v'], horizon: 44, deco: 'skyline' },
  cafe: { sky: ['8', '7', '7'], ground: ['a', 'b'], horizon: 44, deco: 'cafe' },
  docks: { sky: ['d', 'g', 'f'], ground: ['n', 'm'], horizon: 40, deco: 'water' },
  factory: { sky: ['q', 'p', 'p'], ground: ['v', 'q'], horizon: 44, deco: 'pipes' },
  sky: { sky: ['m', 'l', 's'], ground: ['6', 's'], horizon: 50, deco: 'clouds' },
  moon: { sky: ['0', '1', '1'], ground: ['o', 'p'], horizon: 46, deco: 'stars' },
  nebula: { sky: ['u', 't', 'c'], ground: ['e', 'u'], horizon: 48, deco: 'swirl' },
  station: { sky: ['1', '2', '3'], ground: ['q', 'p'], horizon: 44, deco: 'panels' },
  mothership: { sky: ['e', 'd', 'c'], ground: ['u', 'v'], horizon: 46, deco: 'hull' },
};
type Extra = 'bubbles' | 'drops' | 'ball' | 'sparks' | 'box' | 'cup' | 'sun' | 'window' | 'rain' | 'moonglow' | 'hearts' | 'door' | 'stars2' | 'letter' | 'bacon' | 'blanket';
interface Shot { prop?: string; extra: Extra[]; pup?: boolean }
/** Per-memory story detail. Unknown ids fall back to a hearts snapshot of their area. */
const SHOTS: Record<string, Shot> = {
  mem_01: { extra: ['hearts'], pup: true },
  mem_02: { extra: ['bubbles'] },
  mem_03: { extra: ['letter'], prop: 'pk_sneaker' },
  mem_04: { extra: ['drops'] },
  mem_05: { extra: ['ball'] },
  mem_06: { extra: ['bacon'] },
  mem_07: { extra: ['sparks'] },
  mem_08: { extra: ['box'] },
  mem_09: { extra: ['cup'] },
  mem_10: { extra: ['sun'] },
  mem_11: { extra: [], prop: 'yarn' },
  mem_12: { extra: ['window'] },
  mem_13: { extra: ['rain'] },
  mem_14: { extra: ['moonglow'] },
  mem_15: { extra: ['hearts'] },
  mem_16: { extra: ['blanket'], prop: 'pk_bandana' },
  mem_17: { extra: ['door'] },
  mem_18: { extra: ['stars2', 'hearts'], prop: 'pk_bone' },
};

const R = (x: Ctx, k: string, px: number, py: number, w: number, h: number) => { x.fillStyle = col(k); x.fillRect(px, py, w, h); };
/** Hard checker transition row between two bands (no gradients, no alpha). */
const checkRow = (x: Ctx, k: string, py: number, w: number, ph = 0) => { x.fillStyle = col(k); for (let i = ph; i < w; i += 2) x.fillRect(i, py, 1, 1); };
const disc = (x: Ctx, k: string, cx: number, cy: number, r: number) => {
  x.fillStyle = col(k); for (let dy = -r; dy <= r; dy++) { const dx = Math.floor(Math.sqrt(r * r - dy * dy) + 0.35); x.fillRect(cx - dx, cy + dy, dx * 2 + 1, 1); }
};
const sprite = (x: Ctx, name: string, cx: number, cy: number, recolor?: Record<string, string>) => {
  const c = spriteCanvas(name, 0, false, recolor); if (c) x.drawImage(c, Math.round(cx - c.width / 2), Math.round(cy - c.height / 2));
};

function backdrop(x: Ctx, L: Look) {
  const hz = L.horizon; const b1 = Math.round(hz * 0.4), b2 = Math.round(hz * 0.75);
  R(x, L.sky[0], 0, 0, PHOTO_W, b1); R(x, L.sky[1], 0, b1, PHOTO_W, b2 - b1); R(x, L.sky[2], 0, b2, PHOTO_W, hz - b2);
  checkRow(x, L.sky[1], b1 - 1, PHOTO_W); checkRow(x, L.sky[2], b2 - 1, PHOTO_W, 1);
  R(x, L.ground[0], 0, hz, PHOTO_W, PHOTO_H - hz); checkRow(x, L.ground[1], hz + 6, PHOTO_W); R(x, L.ground[1], 0, hz + 7, PHOTO_W, PHOTO_H - hz - 7);
  switch (L.deco) {
    case 'fence': for (let i = 2; i < PHOTO_W; i += 8) { R(x, '9', i, hz - 14, 6, 14); R(x, '8', i, hz - 14, 6, 1); R(x, 'a', i + 5, hz - 13, 1, 13); } R(x, 'a', 0, hz - 9, PHOTO_W, 2); break;
    case 'road': R(x, 'o', 0, hz, PHOTO_W, 2); for (let i = 0; i < PHOTO_W; i += 14) R(x, 'f', i, hz + 10, 7, 2); for (let i = 4; i < PHOTO_W; i += 24) { R(x, 'n', i, hz - 18, 14, 18); R(x, 'f', i + 3, hz - 14, 3, 3); R(x, 'f', i + 8, hz - 14, 3, 3); } break;
    case 'trees': for (let i = 6; i < PHOTO_W; i += 26) { R(x, 'b', i + 5, hz - 8, 3, 8); disc(x, 'k', i + 6, hz - 13, 7); disc(x, 'j', i + 5, hz - 14, 5); R(x, 'i', i + 2, hz - 18, 3, 2); } break;
    case 'brick': for (let r = 0; r < hz; r += 5) { R(x, 'b', 0, r + 4, PHOTO_W, 1); for (let i = (r / 5) % 2 ? 0 : 6; i < PHOTO_W; i += 12) R(x, 'b', i, r, 1, 4); } R(x, 'f', 70, 8, 8, 6); R(x, 'g', 70, 14, 8, 1); break;
    case 'skyline': for (let i = 0; i < PHOTO_W; i += 11) { const h = 10 + ((i * 7) % 13); R(x, '1', i, hz - h, 10, h); for (let w = hz - h + 3; w < hz - 2; w += 4) if ((i + w) % 3) R(x, 'f', i + 3, w, 1, 1); } break;
    case 'cafe': R(x, 'h', 0, 10, PHOTO_W, 3); for (let i = 0; i < PHOTO_W; i += 8) R(x, i % 16 ? '6' : 'r', i, 13, 8, 4); R(x, 'a', 0, hz - 1, PHOTO_W, 2); break;
    case 'water': for (let r = hz + 3; r < PHOTO_H; r += 4) for (let i = (r % 8) ? 2 : 6; i < PHOTO_W; i += 9) R(x, 's', i, r, 3, 1); R(x, '9', 0, hz - 3, PHOTO_W, 3); R(x, 'a', 0, hz - 1, PHOTO_W, 1); break;
    case 'pipes': R(x, 'o', 0, 8, PHOTO_W, 3); R(x, 'p', 0, 11, PHOTO_W, 1); for (let i = 10; i < PHOTO_W; i += 30) { R(x, 'o', i, 0, 3, hz); R(x, 'p', i + 2, 0, 1, hz); } break;
    case 'clouds': disc(x, '6', 12, 30, 7); disc(x, '6', 22, 28, 9); disc(x, '6', 70, 18, 6); disc(x, '6', 78, 20, 7); break;
    case 'stars': for (let i = 0; i < 16; i++) R(x, i % 3 ? '5' : '6', (i * 37) % PHOTO_W, (i * 23) % (L.horizon - 4), 1, 1); disc(x, 'p', 20, hz + 9, 4); disc(x, 'q', 20, hz + 9, 2); break;
    case 'swirl': for (let i = 0; i < 20; i++) R(x, i % 2 ? 'c' : '6', (i * 29) % PHOTO_W, (i * 13) % L.horizon, 1, 1); for (let k = 0; k < 30; k++) R(x, 't', 8 + k * 2, 14 + Math.round(Math.sin(k / 3) * 4), 2, 1); break;
    case 'panels': for (let i = 0; i < PHOTO_W; i += 22) { R(x, '3', i, 4, 20, hz - 10); R(x, '2', i + 1, 5, 18, hz - 12); R(x, 'l', i + 3, 8, 6, 1); R(x, i % 44 ? 'i' : 'r', i + 14, 8, 2, 2); } break;
    case 'hull': for (let i = 0; i < PHOTO_W; i += 16) { R(x, 'e', i, 0, 1, hz); R(x, 'c', i + 6, 6, 3, 3); } R(x, 'f', 0, hz - 3, PHOTO_W, 1); break;
  }
}

function extras(x: Ctx, list: Extra[]) {
  for (const e of list) switch (e) {
    case 'hearts': for (const [hx, hy] of [[66, 12], [74, 22], [60, 24]]) { R(x, 'd', hx, hy, 2, 1); R(x, 'd', hx + 3, hy, 2, 1); R(x, 'd', hx - 1, hy + 1, 7, 2); R(x, 'd', hx, hy + 3, 5, 1); R(x, 'd', hx + 1, hy + 4, 3, 1); R(x, 'd', hx + 2, hy + 5, 1, 1); R(x, 'c', hx, hy + 1, 1, 1); } break;
    case 'bubbles': R(x, 'n', 54, 40, 34, 24); R(x, 'm', 54, 40, 34, 2); for (const [bx, by, r] of [[60, 36, 4], [70, 30, 3], [78, 38, 5], [64, 22, 2], [80, 26, 2], [52, 46, 3]]) { disc(x, 's', bx, by, r); disc(x, 'm', bx, by, r - 1); R(x, '6', bx - 1, by - r + 1, 1, 1); } break;
    case 'letter': R(x, '6', 62, 18, 16, 11); R(x, 'o', 62, 28, 16, 1); for (let i = 0; i < 6; i++) { R(x, 'o', 62 + i, 18 + i, 1, 1); R(x, 'o', 77 - i, 18 + i, 1, 1); } R(x, 'r', 74, 19, 3, 3); break;
    case 'drops': for (let i = 0; i < 14; i++) { const dx = 48 + (i * 13) % 40, dy = 4 + (i * 11) % 38; R(x, 's', dx, dy, 1, 2); R(x, 'l', dx, dy + 2, 1, 1); } R(x, 'p', 74, 50, 6, 4); R(x, 'q', 76, 46, 2, 4); break;
    case 'ball': disc(x, 'i', 70, 34, 5); R(x, 'f', 66, 33, 3, 1); R(x, 'f', 71, 35, 3, 1); R(x, '6', 68, 31, 1, 1); R(x, 'k', 66, 40, 9, 1); break;
    case 'bacon': for (let i = 0; i < 18; i++) { const yy = 24 + Math.round(Math.sin(i / 2.5) * 2); R(x, 'r', 60 + i, yy, 1, 3); R(x, 'c', 60 + i, yy + 1, 1, 1); } R(x, '6', 62, 18, 1, 3); R(x, '6', 70, 16, 1, 3); break;
    case 'sparks': for (const [sx, sy, k] of [[60, 12, 'd'], [76, 8, 'f'], [70, 26, 'l'], [16, 10, 'c']] as [number, number, string][]) { for (let a = 0; a < 8; a++) { const ang = a * Math.PI / 4; R(x, k, sx + Math.round(Math.cos(ang) * 5), sy + Math.round(Math.sin(ang) * 5), 1, 1); } R(x, '6', sx, sy, 1, 1); } break;
    case 'box': R(x, '9', 58, 36, 24, 18); R(x, '8', 58, 36, 24, 2); R(x, 'a', 69, 36, 2, 18); R(x, 'a', 58, 53, 24, 1); R(x, 'q', 61, 42, 6, 1); R(x, 'q', 61, 45, 4, 1); break;
    case 'cup': R(x, '7', 62, 34, 14, 14); R(x, '8', 62, 46, 14, 2); R(x, '6', 62, 34, 14, 2); R(x, '7', 76, 37, 3, 6); R(x, 'h', 66, 38, 6, 1); R(x, 'd', 66, 41, 6, 1); R(x, 'p', 60, 48, 18, 2); break;
    case 'sun': disc(x, 'f', 70, 26, 8); disc(x, '6', 70, 26, 5); R(x, 'g', 58, 34, 26, 1); break;
    case 'window': R(x, 'p', 0, 0, PHOTO_W, 4); R(x, 'p', 0, 0, 6, PHOTO_H); R(x, 'p', 82, 0, 6, PHOTO_H); R(x, 'q', 0, 52, PHOTO_W, 12); for (let i = 0; i < 4; i++) R(x, '6', 10 + i * 18, 8 + i * 9, 10, 1); break;
    case 'rain': for (let i = 0; i < 30; i++) { const rx = (i * 17) % PHOTO_W, ry = (i * 29) % PHOTO_H; R(x, 'm', rx, ry, 1, 3); } R(x, 'r', 56, 22, 26, 3); R(x, 'h', 68, 25, 1, 16); break;
    case 'moonglow': disc(x, '2', 70, 16, 9); disc(x, 'f', 70, 16, 6); disc(x, '7', 68, 14, 3); break;
    case 'door': R(x, 'a', 56, 6, 26, 48); R(x, '9', 58, 8, 22, 46); R(x, 'a', 60, 12, 18, 14); R(x, 'a', 60, 30, 18, 18); R(x, 'f', 76, 32, 2, 3); R(x, 'l', 64, 54, 14, 2); break;
    case 'stars2': for (const [sx, sy] of [[60, 8], [80, 14], [14, 6], [74, 34]]) { R(x, 'f', sx - 2, sy, 5, 1); R(x, 'f', sx, sy - 2, 1, 5); R(x, '6', sx, sy, 1, 1); } break;
    case 'blanket': R(x, 'd', 0, 52, PHOTO_W, 12); for (let i = 0; i < PHOTO_W; i += 8) R(x, 'c', i, 54 + ((i / 8) % 2) * 4, 4, 2); break;
  }
}

const cache = new Map<string, HTMLCanvasElement>();
/** The finished photo for a memory (cached). `area` picks the backdrop. */
export function photo(id: string, area: string): HTMLCanvasElement | null {
  const key = id + '|' + area; const hit = cache.get(key); if (hit) return hit;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = PHOTO_W; c.height = PHOTO_H;
  const x = c.getContext('2d')!;
  const L = LOOK[area] ?? LOOK.backyard; const S = SHOTS[id] ?? { extra: ['hearts'] };
  backdrop(x, L);
  const late: Extra[] = S.extra.filter(e => e === 'window' || e === 'blanket');
  extras(x, S.extra.filter(e => !late.includes(e)));
  sprite(x, 'portrait_pom', 46, 40);
  if (S.pup) sprite(x, 'pup', 72, 50);
  if (S.prop) sprite(x, S.prop, 70, 48);
  extras(x, late);
  cache.set(key, c); return c;
}
/** Layers that cover the whole frame: left out of a locked photo's silhouette (they would read as noise). */
const BACKDROP_EXTRAS: Extra[] = ['window', 'rain', 'drops', 'blanket'];
/**
 * What a locked photo shows: a dark plate with Pom as a dim silhouette and the memory's own subject (pup, prop,
 * cup, door...) as a brighter silhouette, so every locked polaroid has its own shape. Cached per memory.
 */
export function lockedPhoto(id = ''): HTMLCanvasElement | null {
  const key = '#locked|' + id; const hit = cache.get(key); if (hit) return hit;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = PHOTO_W; c.height = PHOTO_H;
  const x = c.getContext('2d')!;
  R(x, '1', 0, 0, PHOTO_W, PHOTO_H);
  for (let yy = 0; yy < PHOTO_H; yy += 3) checkRow(x, '0', yy, PHOTO_W, (yy / 3) % 2);
  const all: Record<string, string> = {}; for (const k of '0123456789abcdefghijklmnopqrstuv') all[k] = '2';
  sprite(x, 'portrait_pom', 46, 40, all);
  const S = SHOTS[id];
  if (S) {
    // subject layer: drawn in full colour on a scratch canvas, then flattened to one palette colour
    const t = document.createElement('canvas'); t.width = PHOTO_W; t.height = PHOTO_H;
    const tx = t.getContext('2d')!;
    extras(tx, S.extra.filter(e => !BACKDROP_EXTRAS.includes(e)));
    if (S.pup) sprite(tx, 'pup', 72, 50);
    if (S.prop) sprite(tx, S.prop, 70, 48);
    tx.globalCompositeOperation = 'source-in'; R(tx, '3', 0, 0, PHOTO_W, PHOTO_H);
    x.drawImage(t, 0, 0);
  }
  cache.set(key, c); return c;
}
