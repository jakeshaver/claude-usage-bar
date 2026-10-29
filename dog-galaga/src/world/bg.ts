import type { Game } from '../core/game';
import { H } from '../core/game';
import type { AreaDef, Tod } from '../core/types';
import { Rng, hash } from '../core/rng';
import { col } from '../core/palette';
import { TILESETS, SEG, SW, type Tileset, type LayerDef } from './tiles';
import { Painter, TOD_RAMP, SPACE_RAMP, INDOOR_RAMP, INDOOR_EDGE, RIM_RAMP, LAMP_EDGE, RGB, ramp, type Ramp } from './paint';

/** Busy stages: the ground under the formation rack is remapped one value step darker (same hue family) inside a soft,
 *  organic blob that follows the rack, so the cats keep their silhouettes over boats, machines and brick. */
const RACK_DIM = new Set(['docks', 'factory', 'alley']);
/** one value step darker, same hue family (ink stays ink) */
const DIM = ramp('1:0 2:1 3:2 4:3 5:4 6:5 7:8 8:9 9:a a:b b:v c:d d:e e:v f:g g:h h:a i:j j:k k:1 l:m m:n n:n o:p p:q q:v r:h s:o t:u u:2 v:1');
const DIM_ABGR = new Uint32Array(32).map((_, i) => { const [r, g, b] = RGB[DIM.a[i]]; return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0; });

const LAYERS = ['far', 'main', 'fg'] as const;
type LayerKey = typeof LAYERS[number];

/**
 * Parallax scrolling background. An optional screen-fixed backdrop, then each
 * layer (far / main / fg) painted in 448x256 segments by the tileset, lit for
 * the current time of day (palette remap, cast shadows, rim light, lamp pools,
 * emissive windows) and cached as plain canvases, so a frame is a handful of
 * blits. Layers hidden under an opaque layer are skipped.
 */
export class Background {
  ts: Tileset = TILESETS.backyard;
  area: AreaDef | null = null;
  scroll = 0; speed = 0.5; t = 0;
  /** 0..1 speed multiplier (eases down during dialogue so the world keeps drifting) */
  pace = 1;
  private seed = 1;
  private cache = new Map<string, HTMLCanvasElement>();
  private statics = new Map<string, HTMLCanvasElement>();
  private cacheTod: Tod | null = null;
  /** final palette indices of each cached segment (for the rack dim) and their dimmed canvases */
  private bufs = new Map<string, Uint8Array>();
  private dims = new Map<string, HTMLCanvasElement>();
  /** rack dim: 0..1 opening, and the last rack bounds [x0, y0, x1, y1] in world px */
  private dimK = 0; private dimBox: [number, number, number, number] | null = null;

  setArea(a: AreaDef, g: Game) {
    this.area = a;
    this.ts = TILESETS[a.tileset] ?? TILESETS.backyard;
    this.speed = a.scroll ?? this.ts.speed; this.scroll = 0;
    this.seed = hash(g.state.seed, a.id);
    this.cache.clear(); this.statics.clear(); this.bufs.clear(); this.dims.clear(); this.dimK = 0; this.dimBox = null;
  }
  update(_g: Game, pace = 1) { this.pace += (pace - this.pace) * 0.05; this.scroll += this.speed * this.pace; this.t++; }

  private ramp(tod: Tod): Ramp {
    const ts = this.ts;
    return ts.ramps?.[tod] ?? (ts.space ? SPACE_RAMP : ts.indoor ? INDOOR_RAMP : TOD_RAMP)[tod];
  }
  private light(p: Painter, tod: Tod) {
    const ts = this.ts; const outdoor = !ts.space && !ts.indoor;
    const todRamp = this.ramp(tod);
    p.finish(todRamp, tod === 'night' || (tod === 'dusk' && !!ts.indoor), ts.indoor ? TOD_RAMP.day : undefined, outdoor && ts.rim !== false ? RIM_RAMP[tod] ?? null : null,
      ts.indoor ? INDOOR_EDGE[tod] ?? todRamp : LAMP_EDGE);
  }

  private segment(layer: LayerKey, def: LayerDef, s: number, tod: Tod): HTMLCanvasElement {
    const key = layer + ':' + s;
    let c = this.cache.get(key);
    if (c) { this.cache.delete(key); this.cache.set(key, c); return c; } // LRU touch
    c = document.createElement('canvas'); c.width = SW; c.height = SEG;
    const p = new Painter(c, SW, SEG, tod);
    if (def.opaque) p.r(this.ts.base, 0, 0, SW, SEG);
    const r = new Rng(hash(this.seed, layer, s));
    def.paint(p, { s, r, seed: this.seed, wy: (y: number) => (s + 1) * SEG - y });
    this.light(p, tod);
    this.cache.set(key, c); this.bufs.set(key, p.buf); this.dims.delete(key);
    while (this.cache.size > 16) { const k = this.cache.keys().next().value!; this.cache.delete(k); this.bufs.delete(k); this.dims.delete(k); }
    return c;
  }
  /** the segment one value step darker (painted lazily from its index buffer) */
  private dimmed(key: string): HTMLCanvasElement | null {
    let c = this.dims.get(key); if (c) return c;
    const b = this.bufs.get(key); if (!b) return null;
    c = document.createElement('canvas'); c.width = SW; c.height = SEG;
    const ctx = c.getContext('2d')!; const img = ctx.createImageData(SW, SEG); const d = new Uint32Array(img.data.buffer);
    for (let i = 0; i < b.length; i++) { const v = b[i]; if (v !== 255) d[i] = DIM_ABGR[v]; }
    ctx.putImageData(img, 0, 0); this.dims.set(key, c); return c;
  }
  /** rack bounds from interaction (its own rackBounds() when it has one, else the formation lattice) */
  private rackBox(g: Game): [number, number, number, number] | null {
    try {
      const it: any = g.mods.interaction; if (!it || it.mode !== 'wave' || !it.cells?.length) return null;
      if (typeof it.rackBounds === 'function') return it.rackBounds();
      const live = it.cats.filter((c: any) => !c.dead && !c.res && c.eslot === undefined && c.st !== 'leave');
      if (!live.length) return null;
      const maxRow = Math.max(...live.map((c: any) => c.row)); const us = it.cells.map((c: any) => c.u);
      const sw = Math.round(Math.sin(it.sway / 90) * (it.amp ?? 0));
      const half = Math.round((Math.max(...us) - Math.min(...us)) * it.colSp / 2);
      const cx = Math.round(it.cx + ((Math.max(...us) + Math.min(...us)) / 2) * it.colSp) + sw;
      const box: [number, number, number, number] = [cx - half - 24, it.formTop - 22, cx + half + 24, it.formTop + maxRow * it.rowSp + 24];
      return box.every(Number.isFinite) ? box : null;
    } catch { return null; }
  }
  /** row spans of the dim blob: a rounded, hand-cut outline (static wobble in screen space), opening from the centre */
  private dimPath(): Path2D | null {
    if (!this.dimBox || this.dimK <= 0.02) return null;
    const [x0, y0, x1, y1] = this.dimBox; const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const k = 1 - (1 - this.dimK) * (1 - this.dimK);
    const ax = (x1 - x0) / 2 * k, ay = (y1 - y0) / 2 * (0.6 + 0.4 * k);
    const path = new Path2D();
    for (let y = Math.floor(cy - ay); y < Math.ceil(cy + ay); y += 2) {
      const v = (y + 1 - cy) / ay; if (Math.abs(v) >= 1) continue;
      const base = ax * Math.pow(1 - Math.pow(Math.abs(v), 3), 1 / 3);
      const l = Math.round(cx - base + 4 * Math.sin(y * 0.09 + 1.3) + 2 * Math.sin(y * 0.23)), r = Math.round(cx + base + 4 * Math.sin(y * 0.08 + 4.1) + 2 * Math.sin(y * 0.27 + 2));
      if (r - l > 2) path.rect(l, y, r - l, 2);
    }
    return path;
  }

  /** a cached, palette-exact canvas painted once per time of day (backdrops, conveyor strips, ...) */
  painted(key: string, w: number, h: number, tod: Tod, paint: (p: Painter) => void, lit = true): HTMLCanvasElement {
    let c = this.statics.get(key);
    if (c) return c;
    c = document.createElement('canvas'); c.width = w; c.height = h;
    const p = new Painter(c, w, h, tod);
    paint(p);
    if (lit) this.light(p, tod); else p.finish(TOD_RAMP.day, false);
    this.statics.set(key, c);
    return c;
  }

  render(g: Game, r: any) {
    const tod = g.state.tod;
    if (tod !== this.cacheTod) { this.cache.clear(); this.statics.clear(); this.bufs.clear(); this.dims.clear(); this.cacheTod = tod; }
    const ts = this.ts;
    // rack dim: eases open while a wave's rack is on stage and folds away between waves
    if (this.area && RACK_DIM.has(this.area.id)) {
      const box = g.state.scene === 'play' || g.state.scene === 'dialogue' ? this.rackBox(g) : null;
      if (box) this.dimBox = box;
      this.dimK = Math.max(0, Math.min(1, this.dimK + (box ? 0.04 : -0.06)));
    } else this.dimK = 0;
    const dimPath = this.dimPath();
    // the lowest layer that has to be drawn: anything under an opaque layer is hidden
    let first = 0; LAYERS.forEach((L, i) => { if (ts[L]?.opaque) first = i; });
    const covered = !!ts[LAYERS[first]]?.opaque;
    r.push(-10, 0, (ctx: CanvasRenderingContext2D) => {
      if (!covered) {
        if (ts.backdrop) ctx.drawImage(this.painted('backdrop', SW, H, tod, p => ts.backdrop!(p, tod), false), 0, 0);
        else { ctx.fillStyle = col(ts.base); ctx.fillRect(0, 0, SW, H); }
      }
      for (let i = covered ? first : 0; i < LAYERS.length; i++) {
        const L = LAYERS[i]; const def = ts[L]; if (!def) continue;
        const ls = Math.floor(this.scroll * def.speed);
        const s0 = Math.floor(ls / SEG), s1 = Math.floor((ls + H - 1) / SEG);
        for (let s = s0; s <= s1; s++) ctx.drawImage(this.segment(L, def, s, tod), 0, H - ((s + 1) * SEG - ls));
        if (dimPath) {
          ctx.save(); ctx.clip(dimPath);
          for (let s = s0; s <= s1; s++) { const d = this.dimmed(L + ':' + s); if (d) ctx.drawImage(d, 0, H - ((s + 1) * SEG - ls)); }
          ctx.restore();
        }
        if (L === (ts.fxAfter ?? 'main') && ts.fx) ts.fx(ctx, this.scroll, this.t, this.seed, tod, this);
      }
      if (ts.anim) {
        const px = (k: string, x: number, y: number, w = 1, h = 1) => { ctx.fillStyle = col(k); ctx.fillRect(x, y, w, h); };
        ts.anim(px, Math.floor(this.scroll), this.t, this.seed, tod);
      }
    });
    // paint the next segment of one layer ahead of time, spread over frames, so a fresh one never hitches
    const L = LAYERS[this.t % 3]; const def = ts[L];
    if (def && LAYERS.indexOf(L) >= (covered ? first : 0)) { const next = Math.floor((Math.floor(this.scroll * def.speed) + H) / SEG) + 1; if (!this.cache.has(L + ':' + next)) this.segment(L, def, next, tod); }
  }
}
