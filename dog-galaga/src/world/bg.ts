import type { Game } from '../core/game';
import { H } from '../core/game';
import type { AreaDef, Tod } from '../core/types';
import { Rng, hash } from '../core/rng';
import { col } from '../core/palette';
import { TILESETS, SEG, SW, type Tileset, type LayerDef } from './tiles';
import { Painter, TOD_RAMP, SPACE_RAMP, INDOOR_RAMP, RIM_RAMP, type Ramp } from './paint';

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

  setArea(a: AreaDef, g: Game) {
    this.area = a;
    this.ts = TILESETS[a.tileset] ?? TILESETS.backyard;
    this.speed = a.scroll ?? this.ts.speed; this.scroll = 0;
    this.seed = hash(g.state.seed, a.id);
    this.cache.clear(); this.statics.clear();
  }
  update(_g: Game, pace = 1) { this.pace += (pace - this.pace) * 0.05; this.scroll += this.speed * this.pace; this.t++; }

  private ramp(tod: Tod): Ramp {
    const ts = this.ts;
    return ts.ramps?.[tod] ?? (ts.space ? SPACE_RAMP : ts.indoor ? INDOOR_RAMP : TOD_RAMP)[tod];
  }
  private light(p: Painter, tod: Tod) {
    const ts = this.ts; const outdoor = !ts.space && !ts.indoor;
    p.finish(this.ramp(tod), tod === 'night' || (tod === 'dusk' && !!ts.indoor), ts.indoor ? TOD_RAMP.day : undefined, outdoor && ts.rim !== false ? RIM_RAMP[tod] ?? null : null);
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
    this.cache.set(key, c);
    while (this.cache.size > 16) this.cache.delete(this.cache.keys().next().value!);
    return c;
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
    if (tod !== this.cacheTod) { this.cache.clear(); this.statics.clear(); this.cacheTod = tod; }
    const ts = this.ts;
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
