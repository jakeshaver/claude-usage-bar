// Interaction-owned pixel art: bullet sprites (generated from shape functions into palette-indexed rows at load),
// dithered shadows/lanes, the captive-pup bubble, boss rigs (the hover craft late Big Cats ride) and the boss HP bar.
// Everything is integer fillRect / sprite blits in palette colors: no alpha blending, no anti-aliased primitives.
import { defineSprites, drawSprite } from '../art/sprite';
import { col } from '../core/palette';
import { pxRing } from '../core/pixel';

type Ctx = CanvasRenderingContext2D;
/** Returns a palette key for a pixel inside the shape, or null outside. (dx, dy) is relative to the sprite center. */
type Paint = (dx: number, dy: number) => string | null;

/**
 * Build a bullet sprite: the painted body, a 1px ink outline around it, and a 1px light outer ring around that,
 * so the bullet reads on dark floors (light ring) and on pale ones (ink outline) alike.
 */
function bullet(w: number, h: number, paint: Paint, ring = '6'): string[] {
  const W = w + 4, H = h + 4, cx = (W - 1) / 2, cy = (H - 1) / 2;
  const g: string[][] = Array.from({ length: H }, () => Array(W).fill('.'));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = paint(x - cx, y - cy); if (k) g[y][x] = k; }
  const grow = (from: (k: string) => boolean, key: string) => {
    const add: [number, number][] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (g[y][x] !== '.') continue;
      for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const v = g[y + ay]?.[x + ax]; if (v && from(v)) { add.push([x, y]); break; } }
    }
    for (const [x, y] of add) g[y][x] = key;
  };
  grow(k => k !== '.', '0');            // ink outline
  grow(k => k === '0', ring);           // light outer ring
  return g.map(r => r.join(''));
}
const disc = (r: number, dx: number, dy: number) => dx * dx + dy * dy <= r * r + r * 0.6;

/** Cat hairball: warm yellow fuzz ball with a highlight and an orange underside. 7px body, 9px with its halo. */
const fur: Paint = (dx, dy) => !disc(2.4, dx, dy) ? null : (dx < 0 && dy < 0 && dx + dy <= -2) ? '6' : (dx + dy >= 2 ? 'g' : 'f');
/** Capturer yarn: a pink wound ball with stripes. */
const yarn: Paint = (dx, dy) => !disc(3, dx, dy) ? null : (dx === -1 && dy === -2) ? '6' : (((dx + dy * 2) % 3 + 3) % 3 === 0 ? 'e' : ((dx - dy) & 1 ? 'd' : 'c'));
/** Boss sweep: a hot pink paw print (toe beans and a pad). */
const paw: Paint = (dx, dy) => {
  if (disc(2.2, dx, dy - 1.5)) return dx < 0 && dy < 1 ? 'c' : 'd';
  for (const [tx, ty] of [[-3, -2.5], [0, -3.8], [3, -2.5]]) if ((dx - tx) ** 2 + (dy - ty) ** 2 <= 1.6) return 'c';
  return null;
};
/** Boss charge: a fish bone dropping head first (spine, ribs, orange head, forked tail). */
const bone: Paint = (dx, dy) => {
  if (dy >= 2.5 && (dx * dx) / 5 + ((dy - 4) * (dy - 4)) / 3 <= 1) return dx === 1 && dy === 4 ? '0' : 'g';
  if (Math.abs(dx) < 0.6 && dy > -4 && dy < 3) return '7';
  if ((dy === -3 || dy === -1 || dy === 1) && Math.abs(dx) <= 2.5) return Math.abs(dx) > 1.6 ? 'o' : '7';
  if (dy <= -4 && dy >= -6 && Math.abs(dx) <= -dy - 3.5 && Math.abs(dx) >= -dy - 5.5) return 'f';
  return null;
};
/** Boss summon: a big candy yarn ball with a loose strand. */
const yarnBig: Paint = (dx, dy) => {
  if (disc(3.6, dx, dy)) return dx === -2 && dy === -2 ? '6' : ((Math.round(dx + dy) & 1) ? 'l' : 'm');
  if (dy >= 3 && dy <= 4.5 && dx >= 2 && dx <= 4 && Math.round(dx - dy) === 0) return 'l';
  return null;
};
/** Boss spiral: a 4-point catnip star in cyan with a white heart. Two frames: + and x. */
const star = (diag: boolean): Paint => (dx, dy) => {
  const a = diag ? (dx + dy) / Math.SQRT2 : dx, b = diag ? (dx - dy) / Math.SQRT2 : dy;
  if (Math.abs(dx) + Math.abs(dy) <= 1.2) return '6';
  if (Math.abs(a) + Math.abs(b) <= 2.2) return 'f';
  if ((Math.abs(a) <= 0.75 && Math.abs(b) <= 4) || (Math.abs(b) <= 0.75 && Math.abs(a) <= 4)) return 'f';
  return null;
};

defineSprites({
  blt_fur: { rows: bullet(5, 5, fur) },
  blt_yarn: { rows: bullet(7, 7, yarn) },
  blt_paw: { rows: bullet(9, 9, paw) },
  blt_bone: { rows: bullet(7, 13, bone) },
  blt_yarnbig: { rows: bullet(9, 9, yarnBig) },
  blt_star: { rows: bullet(9, 9, star(false), 'u'), frames: [bullet(9, 9, star(true), 'u')] },
});

/** Bullet art per boss pattern: each Big Cat throws its own thing. */
export const BOSS_BULLET: Record<string, string> = { sweep: 'blt_paw', charge: 'blt_bone', summon: 'blt_yarnbig', spiral: 'blt_star' };

export function drawBullet(ctx: Ctx, art: string, x: number, y: number, t: number) {
  drawSprite(ctx, art, x, y, { frame: art === 'blt_star' ? (t >> 3) & 1 : 0 });
}

/** Flat oval shadow as a 50% checkerboard of ink pixels (palette-exact, no translucency). */
export function ditherShadow(ctx: Ctx, cx: number, cy: number, w: number, h = 4) {
  const x0 = Math.round(cx), y0 = Math.round(cy); const hw = Math.max(2, Math.round(w / 2)); const hh = Math.max(1, h / 2);
  ctx.fillStyle = col('0');
  for (let dy = -Math.floor(hh); dy <= Math.floor(hh); dy++) {
    const rw = Math.round(hw * Math.sqrt(Math.max(0, 1 - (dy * dy) / ((hh + 0.5) * (hh + 0.5)))));
    for (let dx = -rw; dx <= rw; dx++) if (((x0 + dx + y0 + dy) & 1) === 0) ctx.fillRect(x0 + dx, y0 + dy, 1, 1);
  }
}

/** Rectangle filled with a 50% checkerboard of one palette color. */
export function ditherRect(ctx: Ctx, x: number, y: number, w: number, h: number, key: string, parity = 0) {
  x = Math.round(x); y = Math.round(y); ctx.fillStyle = col(key);
  for (let j = 0; j < h; j++) for (let i = ((x + y + j + parity) & 1); i < w; i += 2) ctx.fillRect(x + i, y + j, 1, 1);
}

/** Soap bubble around a captive / floating pup: dithered ice fill, solid rim, two glints. */
export function bubble(ctx: Ctx, x: number, y: number, r: number, t: number) {
  const x0 = Math.round(x), y0 = Math.round(y);
  ctx.fillStyle = col('s');
  for (let dy = -r + 1; dy <= r - 1; dy++) {
    const w = Math.floor(Math.sqrt((r - 1) * (r - 1) - dy * dy));
    for (let dx = -w; dx <= w; dx++) if (((dx + dy + (t >> 4)) & 3) === 0) ctx.fillRect(x0 + dx, y0 + dy, 1, 1);
  }
  pxRing(ctx, x0, y0, r + 1, '0'); pxRing(ctx, x0, y0, r, 's');
  ctx.fillStyle = col('6'); ctx.fillRect(x0 - Math.round(r * 0.55), y0 - Math.round(r * 0.6), 2, 2); ctx.fillRect(x0 - Math.round(r * 0.75), y0 - Math.round(r * 0.2), 1, 2);
}

/** Capture beam: a widening cone of dithered ice stripes that ripple downward (Galaga's tractor beam, cozy edition). */
export function captureBeam(ctx: Ctx, x: number, y: number, len: number, t: number, k: number) {
  const x0 = Math.round(x), y0 = Math.round(y); const L = Math.round(len * k);
  for (let j = 0; j < L; j++) {
    const hw = 4 + Math.floor(j * 0.32); const band = ((j + 64 - (t * 2) % 64) >> 3) & 1;
    ctx.fillStyle = col(band ? 'l' : 's');
    ctx.fillRect(x0 - hw - 1, y0 + j, 1, 1); ctx.fillRect(x0 + hw + 1, y0 + j, 1, 1);   // solid edges
    for (let i = -hw; i <= hw; i++) if (((i + j + (band ? 0 : 1)) & 1) === 0 && (band || (j & 1))) ctx.fillRect(x0 + i, y0 + j, 1, 1);
  }
}

/**
 * The craft a Big Cat rides, by tier: 0 none, 1 hover jets, 2 a saucer, 3 the Empress's winged throne.
 * `back` draws the part behind the cat sprite, otherwise the front lip in front of its lower body.
 */
export function bossRig(ctx: Ctx, tier: number, x: number, y: number, t: number, phase: number, back: boolean) {
  const X = Math.round(x), Y = Math.round(y);
  const R = (dx: number, dy: number, w: number, h: number, k: string) => { ctx.fillStyle = col(k); ctx.fillRect(X + dx, Y + dy, w, h); };
  const flame = (dx: number, dy: number) => { const f = (t >> 2) & 1; R(dx - 2, dy, 5, 2, 'f'); R(dx - 1, dy + 2, 3, 2 + f, 'g'); R(dx, dy + 4 + f, 1, 1, 'r'); };
  if (tier === 1) {
    if (back) return;
    for (const s of [-1, 1]) { // twin hover jets at the hips
      const jx = s * 25 - 5; R(jx - 1, 14, 12, 10, '0'); R(jx, 15, 10, 8, 'p'); R(jx, 15, 10, 2, 'o'); R(jx + 2, 19, 6, 2, 'q');
      flame(jx + 5, 24);
    }
    return;
  }
  if (tier === 2) { // saucer: dish behind, a lit rim band in front
    const hw = 46;
    if (back) {
      for (let j = 0; j < 14; j++) { const w = Math.round(hw * Math.sqrt(1 - ((j - 7) / 8) ** 2)); R(-w - 1, 14 + j, w * 2 + 2, 1, '0'); R(-w, 14 + j, w * 2, 1, j < 4 ? 'o' : 'q'); }
      return;
    }
    R(-hw - 1, 22, hw * 2 + 2, 9, '0'); R(-hw, 23, hw * 2, 7, 'p'); R(-hw, 23, hw * 2, 1, 'o'); R(-hw + 6, 30, hw * 2 - 12, 3, '0'); R(-hw + 7, 30, hw * 2 - 14, 2, 'q');
    for (let i = 0; i < 9; i++) { const lx = -hw + 6 + i * 10; const on = ((t >> 3) + i) % 3 === 0; R(lx, 25, 4, 3, '0'); R(lx + 1, 25, 2, 2, on ? 'f' : (i & 1 ? 'l' : 'm')); }
    if (phase >= 2) { R(-30, 24, 1, 5, '0'); R(-29, 27, 3, 1, '0'); R(22, 23, 1, 4, '0'); R(23, 26, 2, 1, '0'); if ((t >> 2) & 1) { R(-28, 21, 1, 1, 'f'); R(24, 20, 1, 1, 'f'); } }
    flame(-20, 33); flame(20, 33);
    return;
  }
  if (tier === 3) { // the Empress's throne: wide gilded shell, wings, gem lights, crown spikes
    const hw = 56;
    if (back) {
      const fl = (t >> 4) & 1;
      for (const s of [-1, 1]) { // feathered wings sweeping out and up from the throne's sides, flapping a pixel
        for (let j = 0; j < 30; j++) {
          const yy = -14 + j + (j < 12 ? fl : 0);
          const e = j < 18 ? 8 + Math.round(j * 1.4) : Math.max(0, 33 - (j - 18) * 3);   // outer reach of this row
          if (e <= 0) continue;
          const x0 = 44, len = Math.max(2, e - (j < 6 ? 6 - j : 0));
          const L = s > 0 ? x0 : -x0 - len;
          R(L - 1, yy - 1, len + 2, 3, '0');
        }
        for (let j = 0; j < 30; j++) {
          const yy = -14 + j + (j < 12 ? fl : 0);
          const e = j < 18 ? 8 + Math.round(j * 1.4) : Math.max(0, 33 - (j - 18) * 3);
          if (e <= 0) continue;
          const x0 = 44, len = Math.max(2, e - (j < 6 ? 6 - j : 0));
          const L = s > 0 ? x0 : -x0 - len;
          const sep = j % 6 === 5;               // dark line between feathers
          R(L, yy, len, 1, sep ? 'e' : j % 6 === 0 ? '6' : '7');
          if (!sep && len > 4) R(s > 0 ? L + len - 4 : L, yy, 4, 1, 'c');   // pink feather tips
        }
      }
      // gilded throne back: a rounded arch behind the cat with a jewel on top
      for (let j = 0; j < 40; j++) { const hw2 = Math.round(34 * Math.sqrt(Math.max(0, 1 - ((40 - j) / 41) ** 2))); R(-hw2 - 1, -30 + j, hw2 * 2 + 2, 1, '0'); if (hw2 > 1) { R(-hw2, -30 + j, hw2 * 2, 1, 'f'); if (hw2 > 4 && j > 2) R(-hw2 + 3, -30 + j, hw2 * 2 - 6, 1, 'h'); } }
      R(-4, -38, 9, 9, '0'); R(-3, -37, 7, 7, 'd'); R(-2, -36, 2, 2, '6');
      for (let j = 0; j < 18; j++) { const w = Math.round(hw * Math.sqrt(1 - ((j - 9) / 10) ** 2)); R(-w - 1, 12 + j, w * 2 + 2, 1, '0'); R(-w, 12 + j, w * 2, 1, j < 5 ? 'f' : 'g'); }
      return;
    }
    R(-hw - 1, 22, hw * 2 + 2, 12, '0'); R(-hw, 23, hw * 2, 10, 'g'); R(-hw, 23, hw * 2, 2, 'f'); R(-hw + 8, 34, hw * 2 - 16, 4, '0'); R(-hw + 9, 34, hw * 2 - 18, 3, 'h');
    for (let i = 0; i < 7; i++) { const gx = -hw + 10 + i * 16; const on = ((t >> 3) + i) % 4 === 0; R(gx - 1, 25, 7, 6, '0'); R(gx, 26, 5, 4, on ? '6' : (i % 2 ? 'd' : 'u')); R(gx, 26, 2, 1, '6'); }
    if (phase >= 2) { R(-40, 24, 1, 8, '0'); R(-39, 28, 4, 1, '0'); R(30, 23, 1, 6, '0'); R(31, 27, 3, 1, '0'); R(5, 30, 1, 4, '0'); }
    flame(-30, 38); flame(0, 39); flame(30, 38);
  }
}

/** Damage marks on the cat itself as hp drops: a bandage at phase 1, a second bandage and a sweat drop at phase 2. */
export function bossBruises(ctx: Ctx, x: number, y: number, t: number, phase: number) {
  const X = Math.round(x), Y = Math.round(y);
  const plaster = (px: number, py: number) => {
    ctx.fillStyle = col('0'); ctx.fillRect(X + px - 5, Y + py - 2, 11, 5); ctx.fillRect(X + px - 2, Y + py - 5, 5, 11);
    ctx.fillStyle = col('7'); ctx.fillRect(X + px - 4, Y + py - 1, 9, 3); ctx.fillRect(X + px - 1, Y + py - 4, 3, 9);
    ctx.fillStyle = col('8'); ctx.fillRect(X + px - 1, Y + py - 1, 3, 3);
  };
  if (phase >= 1) plaster(17, -19);
  if (phase >= 2) {
    plaster(-22, 9);
    const d = (t >> 3) % 6; ctx.fillStyle = col('0'); ctx.fillRect(X + 20, Y - 22 + d, 4, 6); ctx.fillStyle = col('s'); ctx.fillRect(X + 21, Y - 21 + d, 2, 4); ctx.fillStyle = col('6'); ctx.fillRect(X + 21, Y - 21 + d, 1, 1);
  }
}

/** Thin pixel HP bar under the boss with notches at the phase thresholds. */
export function bossBar(ctx: Ctx, x: number, y: number, w: number, hp: number, max: number, flash: boolean) {
  const X = Math.round(x - w / 2), Y = Math.round(y);
  ctx.fillStyle = col('0'); ctx.fillRect(X - 1, Y - 1, w + 2, 6);
  ctx.fillStyle = col('v'); ctx.fillRect(X, Y, w, 4);
  const f = Math.max(0, Math.ceil((w * hp) / max));
  ctx.fillStyle = col(flash ? '6' : 'r'); ctx.fillRect(X, Y, f, 4);
  ctx.fillStyle = col(flash ? '6' : 'c'); ctx.fillRect(X, Y, f, 1);
  ctx.fillStyle = col('0'); for (const k of [1 / 3, 2 / 3]) ctx.fillRect(X + Math.round(w * k), Y, 1, 4);
}
