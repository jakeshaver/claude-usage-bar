import { col } from '../core/palette';
import { Rng, hash } from '../core/rng';
import { WORLD_W, H } from '../core/game';

type TileFn = (ctx: CanvasRenderingContext2D, rng: Rng, v: number) => void;
export interface Tileset {
  id: string; speed: number;
  tiles: Record<string, TileFn>;
  row: (i: number, rng: Rng, cols: number) => string[];
  sky?: (ctx: CanvasRenderingContext2D, scroll: number, tod: string) => void;
  decor?: (ctx: CanvasRenderingContext2D, scroll: number, tod: string, seed: number) => void;
}

const P = (ctx: CanvasRenderingContext2D, k: string, x: number, y: number, w = 1, h = 1) => { ctx.fillStyle = col(k); ctx.fillRect(x, y, w, h); };
const fill = (ctx: CanvasRenderingContext2D, k: string) => P(ctx, k, 0, 0, 32, 32);
const speckle = (ctx: CanvasRenderingContext2D, rng: Rng, keys: string[], n: number) => { for (let i = 0; i < n; i++) P(ctx, rng.pick(keys), rng.int(0, 31), rng.int(0, 31)); };
const tuft = (ctx: CanvasRenderingContext2D, k: string, x: number, y: number) => { P(ctx, k, x, y, 1, 2); P(ctx, k, x + 2, y - 1, 1, 3); P(ctx, k, x + 4, y, 1, 2); };

// ---------- shared tile painters ----------
const grass: TileFn = (c, r, v) => { fill(c, 'j'); speckle(c, r, ['k', 'i'], 22); for (let i = 0; i < 3; i++) tuft(c, v % 2 ? 'i' : 'k', r.int(2, 26), r.int(4, 28)); };
const flowers: TileFn = (c, r) => { grass(c, r, 0); for (let i = 0; i < 5; i++) { const x = r.int(3, 28), y = r.int(3, 28), k = r.pick(['c', 'f', '6', 't']); P(c, k, x - 1, y, 3, 1); P(c, k, x, y - 1, 1, 3); P(c, 'f', x, y); } };
const path: TileFn = (c, r) => { fill(c, '8'); speckle(c, r, ['9', '7'], 30); P(c, '9', 0, 0, 32, 1); };
const fence: TileFn = (c) => { fill(c, 'j'); P(c, 'k', 0, 22, 32, 4); for (let x = 2; x < 32; x += 8) { P(c, '7', x, 4, 5, 22); P(c, '8', x + 4, 4, 1, 22); P(c, '0', x, 26, 5, 1); } P(c, '7', 0, 9, 32, 3); P(c, '7', 0, 18, 32, 3); P(c, '8', 0, 11, 32, 1); P(c, '8', 0, 20, 32, 1); };
const water: TileFn = (c, r, v) => { fill(c, 'm'); for (let i = 0; i < 6; i++) { const x = r.int(0, 26), y = r.int(0, 30); P(c, v % 2 ? 's' : 'l', x, y, 5, 1); } P(c, 'n', 0, 31, 32, 1); };
const asphalt: TileFn = (c, r) => { fill(c, 'q'); speckle(c, r, ['p', 'v', '0'], 40); };
const laneLine: TileFn = (c, r) => { asphalt(c, r, 0); P(c, 'f', 14, 4, 4, 14); };
const sidewalk: TileFn = (c, r) => { fill(c, 'o'); P(c, 'p', 0, 15, 32, 1); P(c, 'p', 15, 0, 1, 32); speckle(c, r, ['5', 'p'], 10); };
const roofTar: TileFn = (c, r) => { fill(c, 'v'); speckle(c, r, ['q', '2', '0'], 50); P(c, 'q', 0, 0, 32, 1); };
const roofEdge: TileFn = (c) => { fill(c, 'h'); for (let y = 0; y < 32; y += 6) { P(c, 'a', 0, y, 32, 1); for (let x = (y / 6) % 2 ? 0 : 4; x < 32; x += 8) P(c, 'a', x, y, 1, 6); } };
const brick: TileFn = (c) => { fill(c, 'h'); for (let y = 0; y < 32; y += 8) { P(c, 'b', 0, y, 32, 1); for (let x = (y / 8) % 2 ? 0 : 8; x < 32; x += 16) P(c, 'b', x, y, 1, 8); } };
const waterTower: TileFn = (c) => { roofTar(c, new Rng(9), 0); P(c, '0', 5, 5, 23, 23); P(c, 'a', 6, 6, 21, 21); P(c, '9', 8, 8, 17, 17); P(c, 'b', 15, 6, 2, 21); P(c, 'b', 6, 15, 21, 2); P(c, '8', 9, 9, 4, 3); };
const ac: TileFn = (c) => { roofTar(c, new Rng(3), 0); P(c, '0', 4, 6, 24, 20); P(c, 'o', 5, 7, 22, 18); P(c, 'p', 7, 9, 18, 14); for (let y = 10; y < 22; y += 3) P(c, 'q', 8, y, 16, 1); P(c, 'l', 24, 8, 2, 2); };
const skylight: TileFn = (c) => { roofTar(c, new Rng(5), 0); P(c, '0', 6, 6, 20, 20); P(c, 'n', 7, 7, 18, 18); P(c, 'm', 8, 8, 8, 8); P(c, 'm', 17, 17, 7, 7); P(c, 's', 9, 9, 3, 1); };
const wood: TileFn = (c, r) => { fill(c, '9'); for (let y = 0; y < 32; y += 8) P(c, 'a', 0, y, 32, 1); for (let i = 0; i < 6; i++) P(c, 'a', r.int(0, 28), r.int(0, 31), 3, 1); };
const crate: TileFn = (c) => { wood(c, new Rng(2), 0); P(c, '0', 3, 3, 26, 26); P(c, 'h', 4, 4, 24, 24); P(c, 'a', 4, 4, 24, 2); P(c, 'a', 4, 15, 24, 2); P(c, 'a', 4, 26, 24, 2); P(c, 'g', 6, 8, 2, 2); };
const checker: TileFn = (c) => { for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) P(c, (x + y) % 2 ? '7' : 'e', x * 8, y * 8, 8, 8); };
const rug: TileFn = (c) => { fill(c, 'd'); P(c, 'c', 2, 2, 28, 28); P(c, 'e', 4, 4, 24, 24); P(c, 'f', 14, 14, 4, 4); };
const metal: TileFn = (c, r) => { fill(c, 'p'); P(c, 'o', 0, 0, 32, 1); P(c, 'q', 0, 31, 32, 1); P(c, 'q', 31, 0, 1, 32); for (const [x, y] of [[3, 3], [28, 3], [3, 28], [28, 28]]) P(c, 'o', x, y); speckle(c, r, ['q'], 8); };
const conveyor: TileFn = (c) => { fill(c, 'q'); for (let y = 0; y < 32; y += 4) P(c, '0', 0, y, 32, 1); P(c, 'f', 0, 0, 2, 32); P(c, 'f', 30, 0, 2, 32); };
const spool: TileFn = (c, r) => { conveyor(c, r, 0); P(c, '0', 7, 7, 18, 18); const k = r.pick(['d', 't', 'l', 'f']); P(c, k, 8, 8, 16, 16); P(c, '6', 10, 10, 3, 2); for (let y = 11; y < 24; y += 3) P(c, '0', 9, y, 14, 1); };
const regolith: TileFn = (c, r, v) => { fill(c, 'o'); speckle(c, r, ['p', '5'], 40); if (v % 3 === 0) { P(c, 'p', 8, 8, 16, 14); P(c, 'q', 9, 9, 14, 3); P(c, '5', 10, 21, 12, 1); } };
const litter: TileFn = (c, r) => { fill(c, '8'); speckle(c, r, ['9', '7', 'o'], 70); };
const hull: TileFn = (c, r, v) => { fill(c, '2'); P(c, '3', 0, 0, 32, 1); P(c, '1', 0, 31, 32, 1); P(c, '1', 31, 0, 1, 32); if (v % 2) { P(c, '1', 6, 6, 20, 20); P(c, v % 4 === 1 ? 'l' : 'd', 7, 7, 18, 1); } speckle(c, r, ['3'], 6); };
const hullLight: TileFn = (c, r, v) => { hull(c, r, 0); P(c, '0', 12, 12, 8, 8); P(c, v % 2 ? 'l' : 'd', 13, 13, 6, 6); P(c, '6', 14, 14, 2, 2); };
const carpet: TileFn = (c, r) => { fill(c, 'u'); speckle(c, r, ['t', 'e'], 30); };
const post: TileFn = (c) => { carpet(c, new Rng(4), 0); P(c, '0', 9, 0, 14, 32); P(c, '8', 10, 0, 12, 32); for (let y = 2; y < 32; y += 4) P(c, '9', 10, y, 12, 1); };

// ---------- row generators ----------
function yardRow(i: number, r: Rng, cols: number) {
  const row = Array.from({ length: cols }, () => (r.chance(0.12) ? 'flowers' : 'grass#' + r.int(0, 1)));
  if (i % 24 === 0) return row.map(() => 'fence');
  if (i % 9 < 2) row[6] = row[7] = 'path';
  if (i % 31 > 25 && i % 31 < 29) for (let c = 1; c < 4; c++) row[c] = 'water#' + (i % 2);
  return row;
}
function streetRow(i: number, r: Rng, cols: number) {
  return Array.from({ length: cols }, (_, c) => c < 2 || c > 11 ? (r.chance(0.2) ? 'grass#0' : 'sidewalk') : c === 2 || c === 11 ? 'sidewalk' : (c === 6 || c === 7) && i % 3 === 0 ? 'laneLine' : 'asphalt');
}
function roofRow(i: number, r: Rng, cols: number) {
  const block = Math.floor(i / 8) % 3;
  if (i % 8 === 0) return Array.from({ length: cols }, () => 'asphalt');
  return Array.from({ length: cols }, (_, c) => {
    if (c === 0 || c === cols - 1) return 'roofEdge';
    if ((c === 3 || c === 10) && i % 8 === 4 && block !== 1) return 'waterTower';
    if (r.chance(0.06)) return 'ac'; if (r.chance(0.05)) return 'skylight';
    return block === 2 ? 'brick' : 'roofTar';
  });
}
function generic(main: string, accents: string[], p = 0.12) {
  return (_i: number, r: Rng, cols: number) => Array.from({ length: cols }, () => (r.chance(p) ? r.pick(accents) : main + '#' + r.int(0, 3)));
}

// ---------- sky / space ----------
function stars(ctx: CanvasRenderingContext2D, scroll: number, seed: number, layers: [number, number, string[]][]) {
  for (const [n, sp, keys] of layers) {
    const r = new Rng(seed + n);
    for (let i = 0; i < n; i++) {
      const x = r.int(0, WORLD_W - 1); const y = Math.floor((r.int(0, H * 2) + scroll * sp) % (H + 4)) - 2;
      const k = keys[i % keys.length]; P(ctx, k, x, y);
      if (sp > 0.9 && i % 7 === 0) { P(ctx, k, x - 1, y); P(ctx, k, x + 1, y); P(ctx, k, x, y - 1); P(ctx, k, x, y + 1); }
    }
  }
}
function gradient(ctx: CanvasRenderingContext2D, bands: string[]) {
  const bh = Math.ceil(H / bands.length);
  bands.forEach((k, i) => { P(ctx, k, 0, i * bh, WORLD_W, bh); if (i > 0) for (let x = (i % 2) * 2; x < WORLD_W; x += 4) P(ctx, bands[i - 1], x, i * bh, 2, 1); });
}

export const TILESETS: Record<string, Tileset> = {
  backyard: { id: 'backyard', speed: 0.4, tiles: { grass, flowers, path, fence, water }, row: yardRow },
  street: { id: 'street', speed: 0.6, tiles: { asphalt, laneLine, sidewalk, grass }, row: streetRow },
  park: { id: 'park', speed: 0.45, tiles: { grass, flowers, path, water, fence }, row: (i, r, c) => { const row = yardRow(i + 7, r, c); if (i % 13 < 3) row[9] = row[10] = 'path'; return row; } },
  alley: { id: 'alley', speed: 0.5, tiles: { asphalt, brick, crate }, row: (i, r, cols) => Array.from({ length: cols }, (_, c) => c < 2 || c > 11 ? 'brick' : r.chance(0.07) ? 'crate' : 'asphalt') },
  rooftops: { id: 'rooftops', speed: 0.55, tiles: { roofTar, roofEdge, brick, waterTower, ac, skylight, asphalt }, row: roofRow },
  cafe: { id: 'cafe', speed: 0.4, tiles: { checker, rug, wood }, row: (i, r, cols) => Array.from({ length: cols }, (_, c) => (i % 10 < 3 && c > 3 && c < 10 ? 'rug' : c < 1 || c > 12 ? 'wood' : 'checker')) },
  docks: { id: 'docks', speed: 0.5, tiles: { water, wood, crate }, row: (i, r, cols) => Array.from({ length: cols }, (_, c) => (c > 3 && c < 10 ? (r.chance(0.08) ? 'crate' : 'wood') : 'water#' + ((i + c) % 2))) },
  factory: { id: 'factory', speed: 0.6, tiles: { metal, conveyor, spool }, row: (i, r, cols) => Array.from({ length: cols }, (_, c) => (c % 4 === 1 || c % 4 === 2 ? (r.chance(0.15) ? 'spool' : 'conveyor') : 'metal')) },
  moon: { id: 'moon', speed: 0.35, tiles: { regolith, litter }, row: (i, r, cols) => Array.from({ length: cols }, () => (r.chance(0.08) ? 'litter' : 'regolith#' + r.int(0, 5))) },
  station: { id: 'station', speed: 0.5, tiles: { carpet, post, metal }, row: (i, r, cols) => Array.from({ length: cols }, (_, c) => (c === 2 || c === 11 ? 'post' : c === 0 || c === 13 ? 'metal' : 'carpet')) },
  mothership: { id: 'mothership', speed: 0.7, tiles: { hull, hullLight }, row: generic('hull', ['hullLight#0', 'hullLight#1'], 0.08) },
  sky: { id: 'sky', speed: 0.8, tiles: {}, row: () => [],
    sky: (ctx, s, tod) => { gradient(ctx, tod === 'night' ? ['1', '2', '2', '3'] : tod === 'dusk' ? ['u', 't', 'd', 'g'] : ['n', 'm', 'm', 's']); stars(ctx, s, 7, [[30, 0.2, ['5']]]); },
    decor: (ctx, s, _t, seed) => { const r = new Rng(seed); for (let i = 0; i < 9; i++) { const x = r.int(-40, WORLD_W), y = ((r.int(0, 800) + s * 1.3) % (H + 120)) - 60; cloud(ctx, x, y, r.int(2, 4)); } } },
  nebula: { id: 'nebula', speed: 0.7, tiles: {}, row: () => [],
    sky: (ctx, s) => { P(ctx, '1', 0, 0, WORLD_W, H); nebulaClouds(ctx, s); stars(ctx, s, 11, [[60, 0.3, ['3', '4']], [30, 0.7, ['5', 't']], [12, 1.4, ['6', 'l']]]); } },
};
TILESETS.space = TILESETS.nebula;

function cloud(ctx: CanvasRenderingContext2D, x: number, y: number, n: number) {
  for (let i = 0; i < n; i++) { P(ctx, '6', x + i * 14, y + (i % 2) * -6, 26, 10); P(ctx, '5', x + i * 14, y + 8 + (i % 2) * -6, 26, 3); }
}
function nebulaClouds(ctx: CanvasRenderingContext2D, s: number) {
  const r = new Rng(hash('neb'));
  for (let i = 0; i < 14; i++) {
    const x = r.int(-20, WORLD_W), y = ((r.int(0, 900) + s * 0.4) % (H + 160)) - 80; const k = r.pick(['u', 'e', '2', 'n']);
    for (let d = 0; d < 5; d++) P(ctx, k, x + d * 6 - 12, y + d * 4, 48 - d * 6, 6);
  }
}
