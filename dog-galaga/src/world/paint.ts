// Pixel-exact, palette-exact painting helpers for world backgrounds.
// Everything here draws with integer fillRects in fixed-palette colors only:
// no arcs, no strokes, no alpha blending. Lighting (shadows, time of day, lamp
// pools) is done by remapping palette indices in an index buffer, painted once per segment.
import { PALETTE, KEY } from '../core/palette';
import type { Tod } from '../core/types';

export { remap };
export const RGB: [number, number, number][] = PALETTE.map(h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);

/**
 * A palette ramp: pixel index i maps to a[i], or to b[i] where the 4x4 Bayer
 * threshold at (x,y) is below lv[i] (ordered-dither mix of two palette
 * entries). That gives in-between tones (e.g. a night green darker than the
 * darkest green in the palette) while every pixel stays a palette colour.
 */
export interface Ramp { a: Uint8Array; b: Uint8Array; lv: Uint8Array; id: boolean }
/** Build a ramp from "from:to" pairs; "from:toX/N" mixes in X at level N/16. Missing keys map to themselves. */
export function ramp(map: string, base?: Ramp): Ramp {
  const a = new Uint8Array(32), b = new Uint8Array(32), lv = new Uint8Array(32);
  for (let i = 0; i < 32; i++) { a[i] = base ? base.a[i] : i; b[i] = base ? base.b[i] : i; lv[i] = base ? base.lv[i] : 0; }
  for (const pair of map.trim().split(/\s+/).filter(Boolean)) {
    const [f, t] = pair.split(':'); const i = KEY.indexOf(f);
    const [cols, n] = t.split('/');
    a[i] = KEY.indexOf(cols[0]); b[i] = KEY.indexOf(cols[1] ?? cols[0]); lv[i] = cols.length > 1 ? +(n ?? 8) : 0;
  }
  let id = true; for (let i = 0; i < 32; i++) if (a[i] !== i || lv[i]) id = false;
  return { a, b, lv, id };
}
/** One step darker, same hue family (used for cast shadows at day/night). */
export const SHADE = ramp('1:0 2:1 3:2 4:3 5:4 6:5 7:8 8:9 9:a a:b b:v c:d d:e e:v f:g g:h h:a i:j j:k k:1 l:m m:n n:2 o:p p:q q:v r:h s:l t:u u:2 v:1');
/** Cast shadows per time of day: cool lavender-blue at dawn, plum at dusk, deep navy at night. Never dithered. */
export const SHADE_TOD: Record<Tod, Ramp> = {
  day: SHADE,
  night: remap('2:1 q:1 3:2 k:1 j:1 n:1 p:2 4:3 u:2 o:q 9:b a:v 8:p 1:0', SHADE),
  dawn: remap('k:1 j:k i:k q:2 p:q o:3 7:o 8:p 9:b a:b b:v h:a v:1 3:2 4:3 5:4 6:5 n:2 m:n c:d', SHADE),
  dusk: remap('k:v j:b i:b q:v p:q o:p 8:a 9:b a:v b:v h:b g:h 4:u 3:2 2:v n:v m:n 1:0 e:v u:v', SHADE),
};
// ---------------------------------------------------------------- lighting
// Time of day is a PALETTE REMAP: each time of day is a palette index -> palette index table applied once,
// when a segment is cached. Every pixel maps to exactly ONE palette entry: there is no dither between two
// time-of-day colours anywhere (so the band behind the formation stays calm and flat); each material keeps
// its hue family and two value steps while value and temperature move. Dither is only used for small local
// light falloff (lamp pool rings, beam edges).
// Time of day is modelled as LIGHT, not a wash: every material keeps its own hue family (wood stays wood-brown, grass
// green, metal cool grey, water blue) and only value and temperature move.
//   day   brightest, most neutral (identity: backgrounds are authored in day colours)
//   dawn  a little lower: cool lavender cast shadows, soft peach on highlights (creams, blade tips) and in sky-facing glass
//         (pink), a peach rim on the sun-facing top / east edges
//   dusk  lower and warm: woods and creams a step deeper, greys a step down (still grey), a warm amber rim on the west
//         faces, long plum cast shadows
//   night dark, cool, desaturated: greys to slate and deep navy, creams to grey, lawns a dark teal-green (blades on a
//         deep-night ground); warm emissive windows and sodium lamp pools (WARM_LIFT) carry the colour
/** a strict remap from "from:to" pairs (missing keys map to themselves); mixes are refused */
function remap(map: string, base?: Ramp): Ramp {
  if (map.includes('/')) throw new Error('time-of-day remaps map each palette index to exactly one index: ' + map);
  return ramp(map, base);
}
const ID = ramp('');
/** outdoor time-of-day remaps (single index -> single index) */
export const TOD_RAMP: Record<Tod, Ramp> = {
  day: ID,
  // lawns stay a cool fresh green (grass blades green, their tips peach), stone to indigo-slate, creams/yellows to peach-pink
  dawn: remap('6:7 7:8 i:8 l:m s:c'),
  // lawns olive-gold: the dark green ground under a carpet of green and sun-browned blades with orange tips; woods a step deeper,
  // stone cools to indigo for contrast against the warm ground, blues to violet
  dusk: remap('6:7 7:8 8:9 9:a a:b b:v c:d f:g g:h h:b r:h i:f j:k l:m s:m m:n o:p p:q 1:v 2:v 3:2 4:3 5:4 t:u'),
  // dark but legible: lawns keep the dark teal-green ground (k) under a carpet of deep-night blades (j -> 1) with a few
  // moonlit teal tips (i -> n), so the lawn reads as dark grass, never asphalt; stone periwinkle/indigo, creams to periwinkle
  night: remap('6:o 7:p 8:q 9:a a:b b:v c:e d:e e:v f:9 g:a h:b r:e i:n j:1 k:k l:m m:n n:2 s:p o:p p:q q:1 1:0 2:1 3:2 4:3 5:4 t:u u:2'),
};
/** Low sun on the sunward faces: warm amber at dusk (west faces), peach-pink at dawn (top / east edges). */
export const RIM_RAMP: Partial<Record<Tod, Ramp>> = {
  dusk: ramp('q:h p:g o:f v:a 1:b 2:e 3:d 4:c 5:7 a:g b:h 9:g 8:f 7:f k:a j:9 i:f n:e m:d 6:7 u:d t:c e:d'),
  dawn: ramp('q:p p:8 o:c v:q 1:v 2:3 3:4 4:c 5:c a:9 b:a 9:8 8:c 7:c k:j j:8 n:m m:4 h:g e:d u:t'),
};
/**
 * Outdoor lamp pools at night LIGHT what they land on: each pixel's night colour (the area's own night remap) is
 * lifted one warm step per ring along WARM_LIFT (dark -> plum -> warm brown -> amber -> orange-cream), so seams,
 * cracks, plank gaps and kerbs keep their contrast inside the pool and every material brightens in its own way.
 * Four steps from the rim inward (edge, middle, core, a small hot centre). Grass keeps its blades (lit green,
 * then gold-tipped yellow-green), water lifts through teal. No pixel is painted with a flat fill.
 */
// sodium lamp light: each pixel's night colour is remapped one step toward the warm ramp per ring (night-dark -> plum
// -> dark brown -> brown -> light brown -> tan), so the floor texture (seams, cracks, specks) is kept inside the pool and
// only value and temperature move; pools are two clean steps (edge one step, core two) with organic, undithered edges
// (one value step per ring in each material's own family: night navy / slate floors lift to the next lighter warm-leaning
// grey (deep night -> plum slate -> dark grey -> grey -> light grey -> tan), woods one brown step, so a pool reads as lit
// floor under a lamp, never as a fixed brown / tan disc)
const WARM_LIFT = remap('0:1 1:v v:q 2:q q:p 3:p n:3 p:o 4:o o:8 5:7 8:7 7:7 6:6 b:a a:9 9:8 h:g g:f f:7 e:d d:c c:7 r:g u:t t:c m:l l:s s:7 k:j j:i i:f');
function liftN(v: number, n: number) { for (let i = 0; i < n; i++) v = WARM_LIFT.a[v]; return v; }
// the small hot centre right under the lamp head: the 2-step lift, then one warm step (greys to tan / light brown)
const GK = KEY.indexOf('k'), GJ = KEY.indexOf('j'), GI = KEY.indexOf('i');
/** grass under a lamp, by ring (edge..hot) for the day indices k (ground), j (blade), i (tip) */
// (a remap of the night lawn texture: k and j swap up one step (the green turf to mid green, the deep-night blades /
// moon-shade turf to dark green), so the blade texture survives everywhere in the pool and it never reads as a flat
// green disc; the core adds lime tips)
export const GRASS_LIT: [string, string, string][] = [['j', 'k', 'j'], ['j', 'k', 'j'], ['j', 'k', 'i'], ['j', 'k', 'i']];
const lampCache = new WeakMap<Ramp, Map<string, Ramp[]>>();
/** the four lamp ring ramps (edge, middle, core, hot), built from the area's night remap; lifts = warm steps per ring */
export function lampRamps(night: Ramp, lifts: number[] = [1, 2, 3, 4], grass: [string, string, string][] = GRASS_LIT, extra = '', warm = ''): Ramp[] {
  let m = lampCache.get(night); if (!m) lampCache.set(night, m = new Map());
  const key = lifts.join() + '|' + grass.map(g => g.join('')).join() + '|' + extra + '|' + warm;
  const W = remap(warm);
  let r = m.get(key); if (r) return r;
  r = lifts.map((n, ring) => {
    const a = new Uint8Array(32);
    for (let i = 0; i < 32; i++) { const k = n + (extra.includes(KEY[i]) ? 1 : 0); a[i] = ring >= 2 ? W.a[liftN(night.a[i], k)] : liftN(night.a[i], k); }
    const g = grass[ring]; a[GK] = KEY.indexOf(g[0]); a[GJ] = KEY.indexOf(g[1]); a[GI] = KEY.indexOf(g[2]);
    a[0] = ring >= 2 ? 1 : 0; // ink outlines stay outlines
    return { a, b: a, lv: new Uint8Array(32), id: false };
  });
  m.set(key, r); return r;
}
/** kept for callers that pass a pool ramp: the stepped outdoor lamp model */
export const LAMP_RAMP = remap('');
export const LAMP_EDGE = remap('');
/** Interiors: the lights are on, so the room dims and warms instead of going black (pendant pools stay at day colours). */
export const INDOOR_RAMP: Record<Tod, Ramp> = {
  day: ID,
  // early: the room is cooler and a step dimmer (woods toward grey-brown, greys toward slate); peach from the low sunbeams
  dawn: remap('6:7 s:o l:m 9:a a:b 8:9'),
  // golden hour: woods warm and a step deeper, greys to warm brown, shadows plum; amber beams and the first pools on top
  dusk: remap('6:7 7:8 o:p s:o 1:v'),
  // closing time: a dim room that keeps its dark wood planks and slate tiles; only the pendant pools stay warm
  night: remap('6:o 7:8 8:9 9:a a:b b:v o:p p:q q:1 5:4 4:3 3:2 2:1 1:0 v:1 s:p f:9 g:a h:b c:d d:e e:v k:1 j:k i:j n:2 m:n l:m'),
};
/** Falloff ring of an indoor pendant pool (between the lit room and the dim one). */
export const INDOOR_EDGE: Partial<Record<Tod, Ramp>> = {
  dusk: remap('6:7 7:8 8:9 9:a a:a b:b o:p p:q q:v'),
  night: remap('6:7 7:8 8:9 9:a a:b b:v o:p p:q q:v 5:4 4:3 3:2 2:v'),
};
/** Sunbeams through windows (interiors by day/dawn): warm lift. */
export const SUN_RAMP = ramp('0:1 1:v v:b b:a a:a 9:9 8:8 q:p p:p 2:3 3:3 e:e u:u n:n k:k');
/** Low dusk sun through the windows: deep amber / rust beams. */
export const DUSK_SUN = ramp('0:1 1:b v:b b:a a:h 9:9 q:b p:a 2:e 3:u n:2 k:k');
/** Space: day = sunlit hull, night = eclipse (highlights drop, running lights on). */
export const SPACE_RAMP: Record<Tod, Ramp> = {
  // sunlit: the void lifts to a deep indigo haze and hull plates catch white light
  day: ramp('0:1 1:2 v:2 2:3'),
  // a sunrise over the planet's rim: plum void, hull metal stays slate, pink and violet glints on the edges
  dawn: remap('0:1 1:v v:2 5:c 6:7'),
  // sunset glare: the hull stays metal (never brown); only the edges catch warm tan / cream light
  dusk: remap('0:1 1:v v:2 o:p 5:8 6:7 4:3 p:q'),
  night: remap('o:p 5:4 6:o 4:3 3:2 8:9 7:8'),
};

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const bayer = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];

/** palette key char code -> palette index */
const KI = new Uint8Array(128); for (let i = 0; i < 32; i++) KI[KEY.charCodeAt(i)] = i;
const ci = (k: string) => KI[k.charCodeAt(0)];
const CLEAR = 255;

/** spill: the light source is world-spaced (painted in both neighbouring segments), so the pool may cross the segment edge */
export interface Pool { x: number; y: number; r: number; clip?: [number, number, number, number]; spill?: boolean; all?: boolean }

/**
 * Painter over one segment. Everything is drawn into a palette-index buffer
 * (255 = transparent), so primitives, shadows and lighting remaps are plain
 * typed-array writes; the buffer is converted to pixels once, in finish().
 */
export class Painter {
  buf: Uint8Array;
  shadow: Uint8Array;
  pools: Pool[] = [];
  /** skewed sunbeam parallelograms (interiors at dawn/day) */
  beams: { x: number; y: number; w: number; h: number; skew: number; x0?: number; x1?: number; soft?: boolean; tilt?: number }[] = [];
  /** ramp used inside the soft outer halo of a sunbeam */
  sunSoft: Ramp | null = null;
  /** low-sun rim light rows [x, y, w] (west faces at dusk, east faces at dawn) */
  rims: number[] = [];
  glows: { lit: number; x: number; y: number; w: number; h: number; on: boolean }[] = [];
  objs: (() => void)[] = [];
  /** dark frame bars drawn over emissives (window mullions) */
  lateBars: [number, number, number, number][] = [];
  /** rim lights on (outdoor tilesets only) */
  rimLight = true;
  /** ramp used inside sunbeams */
  sunRamp: Ramp = SUN_RAMP;
  /** props' cast shadows cut through sunbeams / shafts (the light falls round the objects instead of over them) */
  beamShade = false;
  /** light spilling from a lit doorway / window across the floor: a cone that fades in steps with distance */
  spills: { x: number; y: number; h: number; len: number; tilt: number; dir: number }[] = [];
  /** ramp for the 1px rim along the long edges of a spill cone (e.g. a faint peach edge at dawn); null = no rim */
  spillRim: Ramp | null = null;
  /** ramp for the faint outer step of a spill (falls back to the soft ramp) */
  sunTail: Ramp | null = null;
  /** palette key a shadow takes where it falls onto the (clear) layer below */
  clearShadow = 1;
  /** lamp pools are scaled by this (busy tilesets keep them small) */
  poolScale = 0.55;
  /** warm lift steps of the four lamp rings (edge, middle, core, hot): lower = a softer, lower-contrast pool */
  poolLift = [1, 1, 2, 2];
  /** lit grass per lamp ring (edge..hot) for the day indices k, j, i */
  grassLit: [string, string, string][] = GRASS_LIT;
  /** cast-shadow ramp override (interiors keep plain shade instead of the outdoor sky-tinted one) */
  shade: Ramp | null = null;
  /** how lumpy a lamp pool's outline is (1 = uneven ground; lower = a rounder, cleaner pool on smooth floors) */
  poolWobble = 1;
  /** day palette keys that take one extra warm step inside a pool (a dark road beside a pale sidewalk: the pool keeps
   *  the same strength across the curb instead of fading to a faint slab over the asphalt) */
  poolExtra = '';
  /** a warm remap applied after the lift in a pool's core only (e.g. 'o:8': the lit tread studs under a work lamp turn
   *  tan while the plates stay grey), so the warmth sits in the floor texture, never in a flat disc */
  poolWarm = '';
  /** pools also light pixels drawn by props (tilesets whose walkable surface is itself drawn as objects, e.g. roof decks) */
  poolsOnProps = false;
  constructor(public canvas: HTMLCanvasElement, public w: number, public h: number, public tod: Tod) {
    this.buf = new Uint8Array(w * h).fill(CLEAR);
    this.shadow = new Uint8Array(w * h);
  }
  /** pixels written by props (obj passes): lamp pools light the floor layer only, never the props standing on it */
  private objMask: Uint8Array | null = null;
  private fill(i: number, x: number, y: number, w: number, h: number) {
    let x0 = x | 0, y0 = y | 0; let x1 = x0 + (w | 0), y1 = y0 + (h | 0);
    if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 > this.w) x1 = this.w; if (y1 > this.h) y1 = this.h;
    if (x1 <= x0) return;
    for (let j = y0; j < y1; j++) this.buf.fill(i, j * this.w + x0, j * this.w + x1);
    const om = this.objMask; if (om) for (let j = y0; j < y1; j++) om.fill(1, j * this.w + x0, j * this.w + x1);
  }
  /** filled rect in palette key k */
  r(k: string, x: number, y: number, w = 1, h = 1) { if (w <= 0 || h <= 0) return; this.fill(ci(k), x, y, w, h); }
  /** palette index at (x,y), 255 if clear */
  at(x: number, y: number) { x |= 0; y |= 0; return x < 0 || y < 0 || x >= this.w || y >= this.h ? CLEAR : this.buf[y * this.w + x]; }
  /** 1px rectangular outline */
  frame(k: string, x: number, y: number, w: number, h: number) { this.r(k, x, y, w, 1); this.r(k, x, y + h - 1, w, 1); this.r(k, x, y, 1, h); this.r(k, x + w - 1, y, 1, h); }
  /** pixel-exact filled ellipse centred on (cx,cy) (half-pixel centres allowed via .5) */
  ell(k: string, cx: number, cy: number, rx: number, ry: number) {
    const i = ci(k); spans(cx, cy, rx, ry, (x, y, w) => this.fill(i, x, y, w, 1));
  }
  disc(k: string, cx: number, cy: number, r: number) { this.ell(k, cx, cy, r, r); }
  /** ellipse ring of thickness t */
  ring(k: string, cx: number, cy: number, rx: number, ry: number, t = 1) {
    const inner = new Map<number, [number, number]>();
    spans(cx, cy, rx - t, ry - t, (x, y, w) => inner.set(y, [x, x + w]));
    spans(cx, cy, rx, ry, (x, y, w) => { const i = inner.get(y); if (!i) this.r(k, x, y, w, 1); else { this.r(k, x, y, i[0] - x, 1); this.r(k, i[1], y, x + w - i[1], 1); } });
  }
  /** Bresenham line */
  line(k: string, x0: number, y0: number, x1: number, y1: number) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0; const c = ci(k);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy;
    for (;;) { this.fill(c, x0, y0, 1, 1); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
  }
  /** ordered-dither fill: level 0..16 of key k over the rect */
  dith(k: string, x: number, y: number, w: number, h: number, level: number) {
    const c = ci(k);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (bayer(x + i, y + j) < level) this.fill(c, x + i, y + j, 1, 1);
  }
  /** checkerboard dither (cheap 50%) */
  checker(k: string, x: number, y: number, w: number, h: number, phase = 0) {
    const c = ci(k);
    for (let j = 0; j < h; j++) for (let i = (j + phase + x + y) & 1; i < w; i += 2) this.fill(c, x + i, y + j, 1, 1);
  }
  /** direct pixel writes (for dense procedural fills); keys index the palette */
  pixels(fn: (set: (k: string, x: number, y: number) => void) => void) {
    const b = this.buf, w = this.w, h = this.h;
    const om = this.objMask;
    fn((k, x, y) => { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= w || y >= h) return; b[y * w + x] = KI[k.charCodeAt(0)]; if (om) om[y * w + x] = 1; });
  }

  // ---- lighting model ----
  /** Shadow offset per unit of object height for the current time of day (long and low at dawn / dusk). */
  cast(height: number): [number, number] {
    const t = this.tod;
    const [ax, ay] = t === 'dawn' ? [-1.1, 1.0] : t === 'dusk' ? [1.7, 0.45] : t === 'night' ? [0.2, 0.25] : [0.45, 0.55];
    return [Math.round(ax * height), Math.round(ay * height)];
  }
  /** shadows are painted as objects (in draw order, onto what is drawn before them) instead of onto the ground pass:
   * props standing on a roof that is itself drawn as an object cast onto that roof */
  deferShadows = false;
  private pend: number[] = [];
  private flushPend() {
    if (!this.pend.length) return;
    const R = this.pend; this.pend = [];
    this.objs.push(() => {
      const sh = this.shade ?? SHADE_TOD[this.tod], w = this.w, done = new Set<number>();
      for (let k = 0; k < R.length; k += 4) for (let j = R[k + 1]; j < R[k + 3]; j++) for (let i = R[k]; i < R[k + 2]; i++) {
        const o = j * w + i; if (done.has(o)) continue; done.add(o);
        const v = this.buf[o]; this.buf[o] = v === CLEAR ? this.clearShadow : sh.a[v];
      }
    });
  }
  private sm(x: number, y: number, w: number, h: number) {
    if (this.deferShadows) { const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0), x1 = Math.min(this.w, (x + w) | 0), y1 = Math.min(this.h, (y + h) | 0); if (x1 > x0 && y1 > y0) this.pend.push(x0, y0, x1, y1); return; }
    const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0), x1 = Math.min(this.w, (x + w) | 0), y1 = Math.min(this.h, (y + h) | 0);
    for (let j = y0; j < y1; j++) this.shadow.fill(1, j * this.w + x0, j * this.w + Math.max(x0, x1));
  }
  /** rows of the low-sun rim: 2px on the sunward edge of a footprint row */
  private rimRow(x: number, y: number, w: number) {
    if (!this.rimLight || w < 4) return;
    // dusk: the low west sun lays a 3px warm key on the west face; dawn: a 2px peach rim on the east face
    if (this.tod === 'dusk') this.rims.push(x + 1, y, w >= 10 ? 3 : 2);
    else if (this.tod === 'dawn') this.rims.push(x + w - 3, y, 2);
  }
  /** dawn: the low north-east sun catches the top (and right) edge of an object */
  private rimTop(x: number, y: number, w: number) {
    if (!this.rimLight || w < 4) return;
    // dawn: the sky-facing top edge catches a 3-row peach lip (tapering); dusk: a 1-row warm glance on the top edge
    if (this.tod === 'dawn') { this.rims.push(x + 1, y, w - 2, x + 2, y + 1, w - 3); if (w >= 10) this.rims.push(x + 3, y + 2, w - 5); }
    else if (this.tod === 'dusk') this.rims.push(x + 1, y, Math.max(2, Math.round((w - 2) * 0.6)));
  }
  /** rectangular object footprint of given height casts a swept shadow (and catches a rim of low sun) */
  shRect(x: number, y: number, w: number, h: number, height: number) {
    const [dx, dy] = this.cast(height); const n = Math.max(Math.abs(dx), Math.abs(dy), 1);
    for (let i = 0; i <= n; i++) this.sm(x + Math.round(dx * i / n), y + Math.round(dy * i / n), w, h);
    if (height >= 5) { for (let j = 1; j < h - 1; j++) this.rimRow(x, y + j, w); this.rimTop(x, y, w); }
    this.flushPend();
  }
  shEll(cx: number, cy: number, rx: number, ry: number, height: number) {
    const [dx, dy] = this.cast(height); const n = Math.max(Math.abs(dx), Math.abs(dy), 1);
    for (let i = 0; i <= n; i += Math.max(1, (n / 6) | 0)) spans(cx + Math.round(dx * i / n), cy + Math.round(dy * i / n), rx, ry, (x, y, w) => this.sm(x, y, w, 1));
    spans(cx + dx, cy + dy, rx, ry, (x, y, w) => this.sm(x, y, w, 1));
    if (height >= 5) { let n2 = 0; spans(cx, cy, rx, ry, (x, y, w) => { this.rimRow(x, y, w); if (n2++ < (this.tod === 'dawn' ? 2 : 1)) this.rimTop(x, y, w); }); }
    this.flushPend();
  }
  /** draw this after the ground shadows are applied */
  obj(fn: () => void) { this.objs.push(fn); }
  /** a sunbeam: parallelogram lit with SUN_RAMP (only shown when the caller decides it is daytime) */
  beam(x: number, y: number, w: number, h: number, skew: number, x0?: number, x1?: number, soft = false) { this.beams.push({ x, y, w, h, skew, x0, x1, soft }); }
  /** a diagonal shaft: columns x..x+w, each lit from y + (col - x) * tilt for h rows (a band slanting across the floor) */
  shaft(x: number, y: number, w: number, h: number, tilt: number, soft = false) { this.beams.push({ x, y, w, h, skew: 0, soft, tilt }); }
  /** light spilling out of an opening at wall x (rows y..y+h) across the floor in direction dir (+1 right, -1 left) */
  spill(x: number, y: number, h: number, len: number, tilt: number, dir: number) { this.spills.push({ x, y, h, len, tilt, dir }); }
  /** a light source: lamp pool at night */
  pool(x: number, y: number, r: number, clip?: [number, number, number, number], spill = false) { this.pools.push({ x, y, r, clip, spill }); }
  /** a small warm glow that also lifts the props / walls round the source (a wall lamp on brick); one step, no core */
  glowPool(x: number, y: number, r: number) { this.pools.push({ x, y, r, all: true }); }
  /** emissive rect: shows `day` normally, `lit` (unaffected by darkness) when the light is on */
  glow(day: string, lit: string, x: number, y: number, w: number, h: number, chance = 1, roll = 0) {
    const t = this.tod; const p = t === 'night' ? chance : t === 'dusk' ? chance * 0.7 : t === 'dawn' ? chance * 0.3 : 0;
    this.r(day, x, y, w, h);
    this.glows.push({ lit: ci(lit), x, y, w, h, on: roll < p });
  }
  /** Run the passes: shade shadows -> objects -> time-of-day remap (with lamp pools, sunbeams, rim light) -> emissives -> pixels. */
  finish(todRamp: Ramp, pools: boolean, poolRamp: Ramp = LAMP_RAMP, rimRamp: Ramp | null = null, edgeRamp: Ramp = LAMP_EDGE) {
    const stepped = poolRamp === LAMP_RAMP; // outdoor lamps: three solid warm rings (interior pendants keep core + thin ring)
    const { w, h, buf } = this;
    const sh = this.shade ?? SHADE_TOD[this.tod];
    for (let i = 0; i < w * h; i++) if (this.shadow[i]) {
      const v = buf[i];
      if (v === CLEAR) { buf[i] = this.clearShadow; continue; } // a shadow cast onto the layer below: one solid deep tone (never a checker)
      buf[i] = sh.lv[v] > BAYER[(((i / w) | 0) & 3) * 4 + ((i % w) & 3)] ? sh.b[v] : sh.a[v];
    }
    if (stepped && !this.poolsOnProps && pools && this.pools.length && this.pools.some(p => !p.all)) this.objMask = new Uint8Array(w * h);
    for (const f of this.objs) f();
    const om = this.objMask; this.objMask = null;
    // light mask: 1 lamp pool, 2 sunbeam, 3 rim, 4 lamp falloff, 5 lamp middle ring, 6 soft sunbeam edge, 7 hot lamp centre, 8 faint spill tail, 9 spill rim
    let mask: Uint8Array | null = null;
    if (rimRamp && this.rims.length) {
      mask = new Uint8Array(w * h); const R = this.rims;
      for (let k = 0; k < R.length; k += 3) { const x = R[k], y = R[k + 1]; if (y < 0 || y >= h) continue; for (let i = Math.max(0, x); i < Math.min(w, x + R[k + 2]); i++) mask[y * w + i] = 3; }
    }
    if (pools && this.pools.length) {
      // a lamp pool centred on its source: one solid lit colour per material, with a 2px falloff ring
      mask = mask ?? new Uint8Array(w * h);
      for (const p of this.pools) {
        let R = p.all ? p.r : Math.max(6, Math.round(p.r * this.poolScale));
        // a pool whose source lives in this segment only must not be cut by the segment edge: it shrinks to fit instead
        if (!p.spill) R = Math.min(R, Math.floor(Math.min(p.y, h - 1 - p.y) * 1.15));
        if (R < 5) continue;
        // one solid lit core, a 1px solid falloff ring and a 1px 50% ring; never clipped to a tile or path edge
        for (let y = Math.max(0, p.y - R); y < Math.min(h, p.y + R + 1); y++) for (let x = Math.max(0, p.x - R); x < Math.min(w, p.x + R + 1); x++) {
          const ddx = x + 0.5 - (p.x + 0.5), ddy = (y + 0.5 - (p.y + 0.5)) * 1.15;
          // a lumpy outline (light catches the ground unevenly), never a perfect coin
          const ang = Math.atan2(ddy, ddx), wob = 1 + (0.07 * Math.sin(ang * 3 + p.x * 0.7) + 0.05 * Math.sin(ang * 5 + p.y * 1.3)) * this.poolWobble;
          const d = Math.hypot(ddx, ddy) / wob; if (d > R) continue;
          const o = y * w + x;
          if (om && !p.all && om[o]) continue; // props keep their own colours: the pool lies on the floor under them
          if (p.all) { if (!mask[o]) mask[o] = 4; continue; }
          // stepped: hot centre, core, middle, edge; each boundary is a ~2px ordered-dither seam so the steps melt
          // two clean steps (a 2-step falloff): the lit core under the lamp and one softer ring; organic edges, no dither
          const v = stepped ? (d <= R * 0.58 ? 1 : 4)
            : d <= R - 2 ? 1 : d <= R - 1 ? 4 : ((x + y) & 1 ? 4 : 0);
          const rank = (m: number) => m === 7 ? 4 : m === 1 ? 3 : m === 5 ? 2 : m === 4 ? 1 : 0;
          if (v && rank(v) > rank(mask[o])) mask[o] = v;
        }
      }
    }
    if (this.spills.length) {
      // a cone from the opening: a bright core near the door, a softer middle and a faint dithered tail that ends softly
      mask = mask ?? new Uint8Array(w * h);
      for (const sp of this.spills) for (let d = 0; d < sp.len; d++) {
        const x = sp.x + d * sp.dir; if (x < 0 || x >= w) continue;
        const f = d / sp.len, half = sp.h / 2 + d * 0.22, c = sp.y + sp.h / 2 + d * sp.tilt;
        for (let y = Math.max(0, Math.floor(c - half - 1)); y < Math.min(h, Math.ceil(c + half + 1)); y++) {
          const e = Math.abs(y + 0.5 - c) / half; if (e > 1) continue;
          // clean stepped bands (no dither seams): bright core by the door, a softer middle, a faint tail that just ends
          const v = f * 0.82 + e * e * 0.3, o = y * w + x;
          let m = v < 0.34 ? 2 : v < 0.58 ? 6 : v < 0.86 ? 8 : 0;
          // a 1px rim along the cone's long edges (never past the faint tail)
          if (this.spillRim && (m === 2 || m === 6) && Math.abs(y + 0.5 - c) > half - 1) m = 9;
          const rank = (k: number) => k === 9 ? 4 : k === 2 ? 3 : k === 6 ? 2 : k === 8 ? 1 : 0;
          if (m && mask[o] !== 1 && rank(m) > rank(mask[o])) mask[o] = m;
        }
      }
    }
    if (this.beams.length) {
      mask = mask ?? new Uint8Array(w * h);
      for (const b of this.beams) if (b.tilt !== undefined) {
        for (let x = Math.max(0, b.x); x < Math.min(w, b.x + b.w); x++) { const y0 = b.y + Math.round((x - b.x) * b.tilt);
          for (let y = Math.max(0, y0); y < Math.min(h, y0 + b.h); y++) { const o = y * w + x;
            // clean 2-step edges: the solid core, and (from a soft shaft laid under it) one solid halo step; never a dither seam
            if (b.soft) { if (mask[o] !== 1 && mask[o] !== 2) mask[o] = 6; } else if (mask[o] !== 1) mask[o] = 2; } }
      } else for (let y = Math.max(0, b.y); y < Math.min(h, b.y + b.h); y++) {
        const x0 = b.x + Math.round((y - b.y) * b.skew);
        // crisp beams: solid inside, one 50% pixel row on the edge (no wide halftone falloff)
        for (let x = Math.max(0, x0, b.x0 ?? 0); x < Math.min(w, x0 + b.w, b.x1 ?? w); x++) {
          const o = y * w + x;
          if (b.soft) { if (mask[o] !== 1 && mask[o] !== 2) mask[o] = 6; continue; } // a solid soft halo: never dithered
          const e = Math.min(x - x0, x0 + b.w - 1 - x, y - b.y, b.y + b.h - 1 - y); if (e >= 1 || ((x + y) & 1) === 0) { if (mask[o] !== 1) mask[o] = 2; }
        }
      }
    }
    if (!todRamp.id || mask) {
      const L = stepped ? lampRamps(todRamp, this.poolLift, this.grassLit, this.poolExtra, this.poolWarm) : null;
      const tail = this.sunTail ?? this.sunSoft ?? this.sunRamp;
      const ramps: (Ramp | null)[] = L ? [todRamp, L[2], this.sunRamp, rimRamp, L[0], L[1], this.sunSoft ?? this.sunRamp, L[3], tail, this.spillRim]
        : [todRamp, poolRamp, this.sunRamp, rimRamp, edgeRamp, poolRamp, this.sunSoft ?? this.sunRamp, null, tail, this.spillRim];
      for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
        const v = buf[i]; if (v === CLEAR) continue;
        const m = mask ? mask[i] : 0;
        const rm = (this.beamShade && (m === 2 || m === 6) && this.shadow[i] ? todRamp : ramps[m]) ?? todRamp; if (rm.id) continue;
        buf[i] = rm.lv[v] > BAYER[(y & 3) * 4 + (x & 3)] ? rm.b[v] : rm.a[v];
      }
    }
    for (const g of this.glows) if (g.on) this.fill(g.lit, g.x, g.y, g.w, g.h);
    for (const [x, y, ww, hh] of this.lateBars) this.r('0', x, y, ww, hh);
    this.flush();
  }
  /** write the index buffer to the canvas */
  flush() {
    const ctx = this.canvas.getContext('2d')!;
    const img = ctx.createImageData(this.w, this.h); const d = new Uint32Array(img.data.buffer); const b = this.buf;
    for (let i = 0; i < b.length; i++) { const v = b[i]; if (v !== CLEAR) d[i] = ABGR[v]; }
    ctx.putImageData(img, 0, 0);
  }
}
/** palette as little-endian RGBA words */
const ABGR = new Uint32Array(RGB.map(([r, g, b]) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0));

/** Row spans of a pixel ellipse. */
export function spans(cx: number, cy: number, rx: number, ry: number, fn: (x: number, y: number, w: number) => void) {
  if (rx < 0.5 || ry < 0.5) { fn(Math.round(cx), Math.round(cy), 1); return; }
  const y0 = Math.ceil(cy - ry - 0.5), y1 = Math.floor(cy + ry - 0.5);
  for (let y = y0; y <= y1; y++) {
    const dy = (y + 0.5 - cy) / ry; const t = 1 - dy * dy; if (t < 0) continue;
    const hw = rx * Math.sqrt(t); const xa = Math.round(cx - hw), xb = Math.round(cx + hw);
    if (xb > xa) fn(xa, y, xb - xa);
  }
}
