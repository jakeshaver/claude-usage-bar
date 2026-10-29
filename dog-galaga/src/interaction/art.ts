// Interaction-owned pixel art: bullet sprites (generated from shape functions into palette-indexed rows at load),
// dithered shadows/lanes, the captive-pup bubble, boss rigs (the hover craft late Big Cats ride) and the boss HP bar.
// Everything is integer fillRect / sprite blits in palette colors: no alpha blending, no anti-aliased primitives.
import { defineSprites, drawSprite, frameCount, spriteRows, spriteCanvas } from '../art/sprite';
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
 * Cat hairball: a purple fuzzball (the only purple thing in the air: pickups are red/yellow/cream, turds brown, props
 * never purple) with a violet top light, a white glint and four ink tufts sticking out of the fur, so its silhouette
 * is spiky-round. `spin` turns the glint and the tufts a step per frame.
 */
const fur = (spin: number): Paint => (dx, dy) => {
  // 7px round body plus four 1px fur tufts (the pinwheel turns a notch per frame): after the ink and
  // light rings grow around it the silhouette is a bumpy round ball, nothing like a framed pickup or a gem
  const tufts = spin & 1 ? [[1, -4], [4, 1], [-1, 4], [-4, -1]] : [[0, -4], [4, 0], [0, 4], [-4, 0]];
  const body = dx * dx + dy * dy <= 13;
  if (!body && !tufts.some(([x, y]) => x === dx && y === dy)) return null;
  if (dx === -1 && dy === -1) return '6';
  if ((dx === -2 && dy === -1) || (dx === -1 && dy === -2) || (dx === 0 && dy === -2) || (dx === -2 && dy === 0)) return 't';
  if (dx + dy >= 3) return 'v';
  return 'u';
};
/** Capturer yarn: an ice-cyan wound ball with teal stripes (cool family, distinct from the pink hairball). */
const yarn = (spin: number): Paint => (dx, dy) => !disc(3, dx, dy) ? null : (dx === -1 && dy === -2) ? '6' : (((dx + dy * 2 + spin) % 3 + 3) % 3 === 0 ? 'n' : ((dx - dy) & 1 ? 'm' : 'l'));
/**
 * Boss bullets share one danger language, unlike anything else in the air: a SOLID round orb (or capsule) with a hot
 * white core, a lit upper-left and a shaded lower-right, a 1px ink outline and an outer ring pulsing white / red. Nothing
 * friendly is ever a filled disc with a red ring (sparkle fx are thin 4-point stars, pickups are framed squares), and
 * each Big Cat keeps its own colour and a small silhouette cue (paw toes, a bone's knobs, a yarn strand, a crown).
 */
const orb = (body: string, hi: string, lo: string, r = 3.6): Paint => (dx, dy) => {
  if (!disc(r, dx, dy)) return null;
  if (Math.abs(dx + 0.5) <= 1 && Math.abs(dy + 0.5) <= 1) return '6';   // hot 2x2 core, a hair up-left of centre
  if (dx + dy <= -3) return hi;
  if (dx + dy >= 3) return lo;
  return body;
};
/** Boss sweep: a purple orb (the hairball's colour family). */
const paw: Paint = orb('u', 't', 'v');
/** Boss charge: a fish-bone capsule dropping head first (a solid cyan capsule with a hot core). */
const bone: Paint = (dx, dy) => {
  if (Math.abs(dx) > 2 || Math.abs(dy) > 5 || (Math.abs(dx) === 2 && Math.abs(dy) >= 4)) return null;
  return Math.abs(dx) === 0 && Math.abs(dy) <= 2 ? '6' : dx <= -1 && dy < 3 ? 's' : dx >= 1 || dy >= 3 ? 'm' : 'l';
};
/** Boss summon: a big candy yarn orb (cyan / teal stripes around a hot core). */
const yarnBig: Paint = (dx, dy) => {
  if (!disc(3.6, dx, dy)) return null;
  return Math.abs(dx + 0.5) <= 1 && Math.abs(dy + 0.5) <= 1 ? '6' : ((Math.round(dx + dy) & 1) ? 'l' : 'm');
};
/** Boss spiral (the Empress, Madame Mau, Foreman Fold, Commodore Blue): a hot-pink royal orb (never the old 4-point
 *  catnip star: that read as a hit sparkle). */
const star = (_spin: boolean): Paint => orb('d', 'c', 'e');
/** Band-aid on a hurt cat: a short diagonal tan strip with a pad (never a white '+', which reads as a sparkle). */
const bandaid: Paint = (dx, dy) => {
  if (Math.abs(dx - dy) > 1 || Math.abs(dx + dy) > 4) return null;
  return Math.abs(dx + dy) <= 1 ? '9' : dx - dy === -1 ? '7' : '8';
};

// Every enemy bullet has 2 frames: the halo alternates white / a second colour (cats: their own pulse, Big Cats: red)
defineSprites({
  blt_fur: { rows: bullet(9, 9, fur(0), '6'), frames: [bullet(9, 9, fur(1), 't'), bullet(9, 9, fur(2), '6'), bullet(9, 9, fur(3), 't')] },
  blt_yarn: { rows: bullet(7, 7, yarn(0), '6'), frames: [bullet(7, 7, yarn(1), 's')] },
  blt_paw: { rows: bullet(9, 9, paw, '6'), frames: [bullet(9, 9, paw, 'r')] },
  blt_bone: { rows: bullet(7, 13, bone, '6'), frames: [bullet(7, 13, bone, 'r')] },
  blt_yarnbig: { rows: bullet(9, 9, yarnBig, '6'), frames: [bullet(9, 9, yarnBig, 'r')] },
  blt_star: { rows: bullet(9, 9, star(false), '6'), frames: [bullet(9, 9, star(true), 'r')] },
  fx_bandaid: { rows: bullet(9, 9, bandaid, '.') },
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

/**
 * Draw a combat sprite with optional outline treatments:
 *   rim: 1px light ring (dark stages / dusk / night, so navy cats separate from navy floors),
 *   sil: draw a solid silhouette of this key (with its own ring) instead of the sprite (hit flash),
 *   recolor: palette remap (time-of-day tint), `tintKey` names it for the cache.
 * The rim, the recolour and the vertical flip are baked once into one cached canvas per combination, so each cat
 * costs a single drawImage per frame (no per-frame recolour, no save/scale/restore).
 */
const combatCache = new Map<string, HTMLCanvasElement | null>();
function combatCanvas(name: string, f: number, flipY: boolean, rim: string, sil: string, recolor: Record<string, string> | undefined, tintKey: string) {
  const ck = `${name}|${f}|${flipY ? 1 : 0}|${rim}|${sil}|${tintKey}`;
  const hit = combatCache.get(ck); if (hit !== undefined) return hit;
  let out: HTMLCanvasElement | null = null;
  const base = sil ? outlineCanvas(name, f, sil, true) : spriteCanvas(name, f, false, recolor);
  if (base && typeof document !== 'undefined') {
    const W = sil ? base.width : base.width + 2, H = sil ? base.height : base.height + 2;
    out = document.createElement('canvas'); out.width = W; out.height = H;
    const c = out.getContext('2d')!;
    if (flipY) { c.translate(0, H); c.scale(1, -1); }
    if (sil) c.drawImage(base, 0, 0);
    else {
      if (rim) { const r = outlineCanvas(name, f, rim, false); if (r) c.drawImage(r, 0, 0); }
      c.drawImage(base, 1, 1);
    }
  }
  combatCache.set(ck, out); return out;
}
export function drawCombat(ctx: Ctx, name: string, x: number, y: number, o: { frame?: number; flipY?: boolean; rim?: string; sil?: string; recolor?: Record<string, string>; tintKey?: string } = {}) {
  const f = o.frame ?? 0;
  const c = combatCanvas(name, f, !!o.flipY, o.rim ?? '', o.sil ?? '', o.recolor, o.recolor ? (o.tintKey ?? JSON.stringify(o.recolor)) : '');
  if (c) { ctx.drawImage(c, Math.round(x - c.width / 2), Math.round(y - c.height / 2)); return; }
  drawSprite(ctx, name, x, y, { frame: f, flipY: o.flipY, recolor: o.recolor });
}

/**
 * A Big Cat's warm glow: a 1px orange rim hugging the sprite, then a dithered burnt-orange second ring that falls
 * off to nothing. Separates the boss from busy level art without painting a dark pit under it. Cached per frame.
 */
const glowCache = new Map<string, HTMLCanvasElement | null>();
export function bossGlow(ctx: Ctx, name: string, frame: number, x: number, y: number, hot: boolean) {
  const ck = `${name}|${frame}|${hot ? 1 : 0}`;
  let out = glowCache.get(ck);
  if (out === undefined) {
    out = null; const rows = spriteRows(name, frame);
    if (rows && typeof document !== 'undefined') {
      const h = rows.length, w = Math.max(...rows.map(r => r.length)), P = 4;
      const on = (x: number, y: number) => { const ch = rows[y]?.[x]; return !!ch && ch !== '.' && ch !== ' '; };
      out = document.createElement('canvas'); out.width = w + P * 2; out.height = h + P * 2;
      const c = out.getContext('2d')!;
      for (let yy = -P; yy < h + P; yy++) for (let xx = -P; xx < w + P; xx++) {
        if (on(xx, yy)) continue;
        let d = 99;
        for (let j = -P; j <= P; j++) for (let i = -P; i <= P; i++) if (on(xx + i, yy + j)) d = Math.min(d, Math.max(Math.abs(i), Math.abs(j)) + (i && j ? 0.5 : 0));
        const X = xx + P, Y = yy + P;
        if (d <= 1) { c.fillStyle = col(hot ? 'f' : 'g'); c.fillRect(X, Y, 1, 1); }
        else if (d <= 2.5) { if (((X + Y) & 1) === 0) { c.fillStyle = col(hot ? 'g' : 'h'); c.fillRect(X, Y, 1, 1); } }
        else if (d <= 4 && ((X + Y) & 3) === 0 && (Y & 1) === 0) { c.fillStyle = col('h'); c.fillRect(X, Y, 1, 1); }
      }
    }
    glowCache.set(ck, out);
  }
  if (out) ctx.drawImage(out, Math.round(x - out.width / 2), Math.round(y - out.height / 2));
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

/** A small band-aid: a tank cat that has taken a hit wears it until it is booped (a diagonal tan strip, not a '+'). */
export function plaster(ctx: Ctx, x: number, y: number) { drawSprite(ctx, 'fx_bandaid', Math.round(x), Math.round(y)); }

/** Rectangle filled with a 50% checkerboard of one palette color (one pattern fill, not a fillRect per pixel). */
const patCache = new Map<string, CanvasPattern | null>();
export function ditherRect(ctx: Ctx, x: number, y: number, w: number, h: number, key: string, parity = 0) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h); if (w <= 0 || h <= 0) return;
  // the pattern is anchored to the canvas origin: pick the phase so pixel (x+i, y+j) is lit when (x+y+i+j+parity) is even
  // in user space (the camera translate is always a whole pixel, so the checkerboard never shimmers)
  const ph = (parity & 1); const ck = key + ph;
  let pat = patCache.get(ck);
  if (pat === undefined) {
    pat = null;
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas'); c.width = 2; c.height = 2; const cx = c.getContext('2d')!;
      cx.fillStyle = col(key); if (ph) { cx.fillRect(1, 0, 1, 1); cx.fillRect(0, 1, 1, 1); } else { cx.fillRect(0, 0, 1, 1); cx.fillRect(1, 1, 1, 1); }
      pat = ctx.createPattern(c, 'repeat');
    }
    patCache.set(ck, pat);
  }
  if (pat) { ctx.fillStyle = pat; ctx.fillRect(x, y, w, h); return; }
  ctx.fillStyle = col(key);
  for (let j = 0; j < h; j++) for (let i = ((x + y + j + parity) & 1); i < w; i += 2) ctx.fillRect(x + i, y + j, 1, 1);
}

/**
 * Cached pixel ring: the same pixels as core/pixel's pxRing (dashed rings turning with `phase`), pre-rendered once per
 * radius / colour / dash / phase step and blitted, so the boss's halos and telegraphs cost one drawImage a frame.
 */
const ringCache = new Map<string, HTMLCanvasElement | null>();
export function ringC(ctx: Ctx, cx: number, cy: number, r: number, key: string, dash = 0, phase = 0) {
  r = Math.max(1, Math.round(r));
  let q = 0;
  if (dash > 0) { const per = (Math.PI * 2) / dash; q = Math.round((((phase % per) + per) % per) / per * 16) % 16; phase = (q / 16) * per; }
  const ck = `${r}|${key}|${dash}|${q}`;
  let cv = ringCache.get(ck);
  if (cv === undefined) {
    cv = null;
    if (typeof document !== 'undefined') {
      if (ringCache.size > 900) ringCache.clear();
      cv = document.createElement('canvas'); cv.width = cv.height = r * 2 + 3;
      pxRing(cv.getContext('2d')!, r + 1, r + 1, r, key, dash, phase);
    }
    ringCache.set(ck, cv);
  }
  if (cv) ctx.drawImage(cv, Math.round(cx) - r - 1, Math.round(cy) - r - 1);
  else pxRing(ctx, cx, cy, r, key, dash, phase);
}

/** Solid pixel annulus (r0 inner, r1 outer radius) in one palette colour: two fillRects per row, no anti-aliasing. */
export function annulus(ctx: Ctx, cx: number, cy: number, r0: number, r1: number, key: string) {
  const X = Math.round(cx), Y = Math.round(cy); r1 = Math.round(r1); r0 = Math.max(0, Math.round(r0));
  ctx.fillStyle = col(key);
  for (let dy = -r1; dy <= r1; dy++) {
    const wo = Math.floor(Math.sqrt(r1 * r1 - dy * dy)); const wi = Math.abs(dy) < r0 ? Math.floor(Math.sqrt(r0 * r0 - dy * dy)) : -1;
    if (wi < 0) ctx.fillRect(X - wo, Y + dy, wo * 2 + 1, 1);
    else if (wo > wi) { ctx.fillRect(X - wo, Y + dy, wo - wi, 1); ctx.fillRect(X + wi + 1, Y + dy, wo - wi, 1); }
  }
}

/** Soap bubble around a captive / floating pup: dithered ice fill, solid rim, two glints. `pulse` makes it throb
 *  (radius +1 and a white rim on the beat, plus a spinning dashed halo) so a carried pup reads as "shoot my carrier". */
export function bubble(ctx: Ctx, x: number, y: number, r: number, t: number, pulse = false) {
  const x0 = Math.round(x), y0 = Math.round(y); const beat = pulse && ((t >> 3) & 1) === 1;
  if (beat) r += 1;
  ctx.fillStyle = col('s');
  for (let dy = -r + 1; dy <= r - 1; dy++) {
    const w = Math.floor(Math.sqrt((r - 1) * (r - 1) - dy * dy));
    for (let dx = -w; dx <= w; dx++) if (((dx + dy + (t >> 4)) & 3) === 0) ctx.fillRect(x0 + dx, y0 + dy, 1, 1);
  }
  pxRing(ctx, x0, y0, r + 1, '0'); pxRing(ctx, x0, y0, r, beat ? '6' : 's');
  if (pulse) pxRing(ctx, x0, y0, r + 3, beat ? 'l' : 's', 4, t / 16);
  ctx.fillStyle = col('6'); ctx.fillRect(x0 - Math.round(r * 0.55), y0 - Math.round(r * 0.6), 2, 2); ctx.fillRect(x0 - Math.round(r * 0.75), y0 - Math.round(r * 0.2), 1, 2);
}

/**
 * Stepped tractor beam from (x0, y0) toward (x1, y1): a cone that widens in 2px stair steps from half-width w0 to w1,
 * filled with a dithered cyan / ice band pattern marching along it, with cyan + ink edges so it reads on any floor.
 * `k` (0..1) unrolls it.
 */
export function tractor(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, w0: number, w1: number, t: number, k = 1) {
  const L = Math.max(1, Math.abs(Math.round(y1) - Math.round(y0))); const n = Math.round(L * Math.max(0, Math.min(1, k)));
  const dir = y1 >= y0 ? 1 : -1;
  for (let j = 0; j <= n; j++) {
    const f = j / L;
    const hw = w0 + Math.floor(((w1 - w0) * f) / 2) * 2;
    const cx = Math.round(x0 + (x1 - x0) * f), yy = Math.round(y0) + j * dir;
    const band = ((j + 64 - ((t * 2) % 64)) >> 2) & 1;
    ctx.fillStyle = col('0'); ctx.fillRect(cx - hw - 2, yy, 1, 1); ctx.fillRect(cx + hw + 2, yy, 1, 1);
    ctx.fillStyle = col('l'); ctx.fillRect(cx - hw - 1, yy, 1, 1); ctx.fillRect(cx + hw + 1, yy, 1, 1);
    ctx.fillStyle = col(band ? 's' : 'l');
    for (let i = -hw; i <= hw; i++) if (((i + j) & 1) === 0 || (band && (j & 1) === 0)) ctx.fillRect(cx + i, yy, 1, 1);
  }
}

/** Capture beam: the capturer's signature moment (Galaga's tractor beam, cozy edition): a tall stepped cone with
 *  sparkles riding up it. */
export function captureBeam(ctx: Ctx, x: number, y: number, len: number, t: number, k: number) {
  tractor(ctx, x, y, x, y + len, 3, 3 + Math.round(len * 0.3), t, k);
  const L = Math.round(len * k); const X = Math.round(x), Y = Math.round(y);
  ctx.fillStyle = col('6');
  for (let i = 0; i < 4 && L > 8; i++) {
    const sy = Math.round(L - ((t * 1.5 + i * 37) % L)); const sx = Math.round(Math.sin(t / 9 + i * 2) * (2 + sy * 0.2));
    ctx.fillRect(X + sx, Y + sy - 1, 1, 3); ctx.fillRect(X + sx - 1, Y + sy, 3, 1);
  }
}

/** Pickup badge: a notched square frame (ink, then blinking white / yellow) with a sparkle hopping between its corners,
 *  so a pickup always reads as treasure, never as an enemy shot (shots are round, purple and unframed). */
export function pickupBadge(ctx: Ctx, x: number, y: number, t: number) {
  const X = Math.round(x), Y = Math.round(y);
  const frame = (R: number, key: string) => {
    ctx.fillStyle = col(key);
    ctx.fillRect(X - R + 2, Y - R, R * 2 - 3, 1); ctx.fillRect(X - R + 2, Y + R, R * 2 - 3, 1);
    ctx.fillRect(X - R, Y - R + 2, 1, R * 2 - 3); ctx.fillRect(X + R, Y - R + 2, 1, R * 2 - 3);
    ctx.fillRect(X - R + 1, Y - R + 1, 1, 1); ctx.fillRect(X + R - 1, Y - R + 1, 1, 1); ctx.fillRect(X - R + 1, Y + R - 1, 1, 1); ctx.fillRect(X + R - 1, Y + R - 1, 1, 1);
  };
  frame(11, '0'); frame(10, (t >> 3) & 1 ? 'f' : '6'); frame(9, '0');
  // one small glint hops corner to corner on every other beat (a quiet sparkle, not a second outline)
  const k = (t >> 4) & 3; if ((t >> 3) & 1) return;
  const sx = X + (k === 1 || k === 2 ? 11 : -11), sy = Y + (k >= 2 ? 11 : -11);
  ctx.fillStyle = col('6'); ctx.fillRect(sx - 1, sy, 3, 1); ctx.fillRect(sx, sy - 1, 1, 3);
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

/** Damage marks on the cat itself as hp drops: one band-aid at phase 1, a sweat drop added at phase 2 (kept quiet: a
 *  diagonal tan strip, never a white '+' that reads as a sparkle on the boss's face). */
export function bossBruises(ctx: Ctx, x: number, y: number, t: number, phase: number) {
  const X = Math.round(x), Y = Math.round(y);
  if (phase >= 1) plaster(ctx, X + 17, Y - 19);
  if (phase >= 2) {
    const d = (t >> 3) % 6; ctx.fillStyle = col('0'); ctx.fillRect(X - 24, Y - 20 + d, 4, 6); ctx.fillStyle = col('s'); ctx.fillRect(X - 23, Y - 19 + d, 2, 4); ctx.fillStyle = col('6'); ctx.fillRect(X - 23, Y - 19 + d, 1, 1);
  }
}
