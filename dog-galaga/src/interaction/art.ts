// Interaction-owned pixel art: bullet sprites (generated from shape functions into palette-indexed rows at load),
// dithered shadows/lanes, the captive-pup bubble, boss rigs (the hover craft late Big Cats ride) and the boss HP bar.
// Everything is integer fillRect / sprite blits in palette colors: no alpha blending, no anti-aliased primitives.
import { defineSprites, drawSprite, frameCount, spriteRows } from '../art/sprite';
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

/**
 * Cat hairball: a hot pink fuzz ball (a colour family no prop, floor or turd uses) with a white glint and a magenta
 * underside, 7px body, 11px with ink outline and pulsing halo. `spin` moves the glint a quarter turn per frame.
 */
const fur = (spin: number): Paint => (dx, dy) => {
  if (!disc(3, dx, dy)) return null;
  const [gx, gy] = [[-1, -1], [1, -1], [1, 1], [-1, 1]][spin & 3];
  if (dx === gx && dy === gy) return '6';
  if ((dx === gx * 2 && dy === gy) || (dx === gx && dy === gy * 2)) return 'c';
  if (dx * gx + dy * gy <= -3) return 'e';
  return 'd';
};
/** Capturer yarn: an ice-cyan wound ball with teal stripes (cool family, distinct from the pink hairball). */
const yarn = (spin: number): Paint => (dx, dy) => !disc(3, dx, dy) ? null : (dx === -1 && dy === -2) ? '6' : (((dx + dy * 2 + spin) % 3 + 3) % 3 === 0 ? 'n' : ((dx - dy) & 1 ? 'm' : 'l'));
/** Boss sweep: a hot pink paw print (toe beans and a pad). */
const paw: Paint = (dx, dy) => {
  if (disc(2.2, dx, dy - 1.5)) return dx < 0 && dy < 1 ? 'c' : 'd';
  for (const [tx, ty] of [[-3, -2.5], [0, -3.8], [3, -2.5]]) if ((dx - tx) ** 2 + (dy - ty) ** 2 <= 1.6) return 'c';
  return null;
};
/** Boss charge: a fish bone dropping head first (spine, ribs, cyan head, forked tail). */
const bone: Paint = (dx, dy) => {
  if (dy >= 2.5 && (dx * dx) / 5 + ((dy - 4) * (dy - 4)) / 3 <= 1) return dx === 1 && dy === 4 ? '0' : 'l';
  if (Math.abs(dx) < 0.6 && dy > -4 && dy < 3) return '6';
  if ((dy === -3 || dy === -1 || dy === 1) && Math.abs(dx) <= 2.5) return Math.abs(dx) > 1.6 ? 's' : '6';
  if (dy <= -4 && dy >= -6 && Math.abs(dx) <= -dy - 3.5 && Math.abs(dx) >= -dy - 5.5) return 'l';
  return null;
};
/** Boss summon: a big candy yarn ball with a loose strand. */
const yarnBig: Paint = (dx, dy) => {
  if (disc(3.6, dx, dy)) return dx === -2 && dy === -2 ? '6' : ((Math.round(dx + dy) & 1) ? 'l' : 'm');
  if (dy >= 3 && dy <= 4.5 && dx >= 2 && dx <= 4 && Math.round(dx - dy) === 0) return 'l';
  return null;
};
/** Boss spiral: a 4-point catnip star in yellow with a white heart. Two frames: + and x. */
const star = (diag: boolean): Paint => (dx, dy) => {
  const a = diag ? (dx + dy) / Math.SQRT2 : dx, b = diag ? (dx - dy) / Math.SQRT2 : dy;
  if (Math.abs(dx) + Math.abs(dy) <= 1.2) return '6';
  if (Math.abs(a) + Math.abs(b) <= 2.2) return 'f';
  if ((Math.abs(a) <= 0.75 && Math.abs(b) <= 4) || (Math.abs(b) <= 0.75 && Math.abs(a) <= 4)) return 'f';
  return null;
};

// Every enemy bullet has 2 frames: the halo alternates white / a second bright colour (pulse) and the body spins.
defineSprites({
  blt_fur: { rows: bullet(7, 7, fur(0), '6'), frames: [bullet(7, 7, fur(1), 'c'), bullet(7, 7, fur(2), '6'), bullet(7, 7, fur(3), 'c')] },
  blt_yarn: { rows: bullet(7, 7, yarn(0), '6'), frames: [bullet(7, 7, yarn(1), 's')] },
  blt_paw: { rows: bullet(9, 9, paw, '6'), frames: [bullet(9, 9, paw, 'c')] },
  blt_bone: { rows: bullet(7, 13, bone, '6'), frames: [bullet(7, 13, bone, 'l')] },
  blt_yarnbig: { rows: bullet(9, 9, yarnBig, '6'), frames: [bullet(9, 9, yarnBig, 's')] },
  blt_star: { rows: bullet(9, 9, star(false), 'u'), frames: [bullet(9, 9, star(true), 't')] },
});

/** Bullet art per boss pattern: each Big Cat throws its own thing. */
export const BOSS_BULLET: Record<string, string> = { sweep: 'blt_paw', charge: 'blt_bone', summon: 'blt_yarnbig', spiral: 'blt_star' };

export function drawBullet(ctx: Ctx, art: string, x: number, y: number, t: number) {
  const n = frameCount(art);
  drawSprite(ctx, art, x, y, { frame: n > 1 ? (t >> 2) % n : 0 });
}

/**
 * Sprite outline canvases (cached): `rim` = 1px ring of `key` around the sprite's opaque pixels (4-neighbour),
 * `sil` = the same ring plus the whole silhouette filled with `key`. Canvas is 2px larger than the sprite.
 */
const outlineCache = new Map<string, HTMLCanvasElement | null>();
function outlineCanvas(name: string, frame: number, key: string, sil: boolean): HTMLCanvasElement | null {
  const ck = `${name}|${frame}|${key}|${sil ? 1 : 0}`;
  if (outlineCache.has(ck)) return outlineCache.get(ck)!;
  const rows = spriteRows(name, frame); let out: HTMLCanvasElement | null = null;
  if (rows && typeof document !== 'undefined') {
    const h = rows.length, w = Math.max(...rows.map(r => r.length));
    const on = (x: number, y: number) => { const ch = rows[y]?.[x]; return !!ch && ch !== '.' && ch !== ' '; };
    out = document.createElement('canvas'); out.width = w + 2; out.height = h + 2;
    const c = out.getContext('2d')!; c.fillStyle = col(key);
    for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) {
      if (on(x, y)) { if (sil) c.fillRect(x + 1, y + 1, 1, 1); continue; }
      if (on(x + 1, y) || on(x - 1, y) || on(x, y + 1) || on(x, y - 1)) c.fillRect(x + 1, y + 1, 1, 1);
    }
  }
  outlineCache.set(ck, out); return out;
}
function blit(ctx: Ctx, c: HTMLCanvasElement, cx: number, cy: number, flipY?: boolean) {
  const x = Math.round(cx - c.width / 2), y = Math.round(cy - c.height / 2);
  if (flipY) { ctx.save(); ctx.translate(x, y + c.height); ctx.scale(1, -1); ctx.drawImage(c, 0, 0); ctx.restore(); }
  else ctx.drawImage(c, x, y);
}

/**
 * Draw a combat sprite with optional outline treatments:
 *   rim: 1px light ring (dark stages / dusk / night, so navy cats separate from navy floors),
 *   sil: draw a solid silhouette of this key (with its own ring) instead of the sprite (hit flash frame 1),
 *   recolor: palette remap (time-of-day tint).
 */
export function drawCombat(ctx: Ctx, name: string, x: number, y: number, o: { frame?: number; flipY?: boolean; rim?: string; sil?: string; recolor?: Record<string, string> } = {}) {
  const f = o.frame ?? 0;
  if (o.sil) { const s = outlineCanvas(name, f, o.sil, true); if (s) { blit(ctx, s, x, y, o.flipY); return; } }
  if (o.rim) { const r = outlineCanvas(name, f, o.rim, false); if (r) blit(ctx, r, x, y, o.flipY); }
  drawSprite(ctx, name, x, y, { frame: f, flipY: o.flipY, recolor: o.recolor });
}

/** A Big Cat's dark arena: a solid deep-night oval with a 2-step dithered edge, so the boss never melts into props. */
export function bossAura(ctx: Ctx, cx: number, cy: number, rx: number, ry: number) {
  const X = Math.round(cx), Y = Math.round(cy);
  for (let dy = -ry - 6; dy <= ry + 6; dy++) {
    for (const [grow, mode] of [[6, 2], [3, 1], [0, 0]] as [number, number][]) {
      const a = rx + grow, b = ry + grow; if (Math.abs(dy) > b) continue;
      const w = Math.round(a * Math.sqrt(1 - (dy * dy) / (b * b)));
      if (mode === 0) { ctx.fillStyle = col('1'); ctx.fillRect(X - w, Y + dy, w * 2 + 1, 1); continue; }
      ctx.fillStyle = col(mode === 1 ? '1' : '0');
      for (let dx = -w; dx <= w; dx++) if (((dx + dy) & 1) === 0 && (mode === 1 || ((dx >> 1) + dy) % 2 === 0)) ctx.fillRect(X + dx, Y + dy, 1, 1);
    }
  }
}

/** Oval drop shadow (rx, ry radii) as a 50% checkerboard of ink pixels (palette-exact, no translucency). */
export function ditherShadow(ctx: Ctx, cx: number, cy: number, w: number, h = 4) {
  const x0 = Math.round(cx), y0 = Math.round(cy); const rx = Math.max(2, w / 2), ry = Math.max(1, h / 2);
  ctx.fillStyle = col('0');
  for (let dy = -Math.floor(ry); dy <= Math.floor(ry); dy++) {
    const rw = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / ((ry + 0.5) * (ry + 0.5)))));
    for (let dx = -rw; dx <= rw; dx++) if (((x0 + dx + y0 + dy) & 1) === 0) ctx.fillRect(x0 + dx, y0 + dy, 1, 1);
  }
}

/** A small first-aid plaster: a tank cat that has taken a hit wears it until it is booped. */
export function plaster(ctx: Ctx, x: number, y: number) {
  const X = Math.round(x), Y = Math.round(y);
  ctx.fillStyle = col('0'); ctx.fillRect(X - 4, Y - 2, 9, 5); ctx.fillRect(X - 2, Y - 4, 5, 9);
  ctx.fillStyle = col('7'); ctx.fillRect(X - 3, Y - 1, 7, 3); ctx.fillRect(X - 1, Y - 3, 3, 7);
  ctx.fillStyle = col('8'); ctx.fillRect(X, Y, 1, 1);
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
