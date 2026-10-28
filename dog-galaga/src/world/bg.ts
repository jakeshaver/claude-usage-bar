import type { Game } from '../core/game';
import { H } from '../core/game';
import type { AreaDef, Tod } from '../core/types';
import { Rng, hash } from '../core/rng';
import { col } from '../core/palette';
import { TILESETS, SEG, SW, type Tileset, type LayerDef } from './tiles';
import { Painter, TOD_RAMP, SPACE_RAMP, INDOOR_RAMP } from './paint';

const LAYERS = ['far', 'main', 'fg'] as const;
type LayerKey = typeof LAYERS[number];

/**
 * Parallax scrolling background. Each layer (far / main / fg) is painted in
 * 448x256 segments by the tileset, lit for the current time of day (palette
 * remap, cast shadows, lamp pools, emissive windows) and cached.
 */
export class Background {
  ts: Tileset = TILESETS.backyard;
  area: AreaDef | null = null;
  scroll = 0; speed = 0.5; t = 0;
  private seed = 1;
  private cache = new Map<string, HTMLCanvasElement>();
  private cacheTod: Tod | null = null;

  setArea(a: AreaDef, g: Game) {
    this.area = a;
    this.ts = TILESETS[a.tileset] ?? TILESETS.backyard;
    this.speed = a.scroll ?? this.ts.speed; this.scroll = 0;
    this.seed = hash(g.state.seed, a.id);
    this.cache.clear();
  }
  update(_g: Game) { this.scroll += this.speed; this.t++; }

  private segment(layer: LayerKey, def: LayerDef, s: number, tod: Tod): HTMLCanvasElement {
    const key = layer + ':' + s;
    let c = this.cache.get(key);
    if (c) { this.cache.delete(key); this.cache.set(key, c); return c; } // LRU touch
    // paint on a CPU-readable scratch canvas, then copy into a GPU-friendly one: a
    // willReadFrequently canvas would be re-uploaded on every drawImage (that was the rooftops fps drop)
    const scratch = document.createElement('canvas'); scratch.width = SW; scratch.height = SEG;
    const p = new Painter(scratch, SW, SEG, tod);
    if (def.opaque) p.r(this.ts.base, 0, 0, SW, SEG);
    const r = new Rng(hash(this.seed, layer, s));
    def.paint(p, { s, r, seed: this.seed, wy: (y: number) => (s + 1) * SEG - y });
    p.finish(this.ts.ramps?.[tod] ?? (this.ts.space ? SPACE_RAMP : this.ts.indoor ? INDOOR_RAMP : TOD_RAMP)[tod], tod === 'night' || (tod === 'dusk' && !this.ts.space), this.ts.indoor ? TOD_RAMP.day : undefined);
    c = document.createElement('canvas'); c.width = SW; c.height = SEG;
    const cx = c.getContext('2d')!; cx.imageSmoothingEnabled = false; cx.drawImage(scratch, 0, 0);
    this.cache.set(key, c);
    while (this.cache.size > 16) this.cache.delete(this.cache.keys().next().value!);
    return c;
  }

  render(g: Game, r: any) {
    const tod = g.state.tod;
    if (tod !== this.cacheTod) { this.cache.clear(); this.cacheTod = tod; }
    const ts = this.ts;
    r.push(-10, 0, (ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = col(ts.base); ctx.fillRect(0, 0, SW, H);
      for (const L of LAYERS) {
        const def = ts[L]; if (!def) continue;
        const ls = Math.floor(this.scroll * def.speed);
        const s0 = Math.floor(ls / SEG), s1 = Math.floor((ls + H) / SEG);
        for (let s = s0; s <= s1; s++) ctx.drawImage(this.segment(L, def, s, tod), 0, H - ((s + 1) * SEG - ls));
      }
      if (ts.anim) {
        const px = (k: string, x: number, y: number, w = 1, h = 1) => { ctx.fillStyle = col(k); ctx.fillRect(x, y, w, h); };
        ts.anim(px, Math.floor(this.scroll), this.t, this.seed, tod);
      }
    });
    // paint the next segment of one layer ahead of time, spread over frames, so a fresh one never hitches
    const L = LAYERS[this.t % 3]; const def = ts[L];
    if (def) { const next = Math.floor((Math.floor(this.scroll * def.speed) + H) / SEG) + 1; if (!this.cache.has(L + ':' + next)) this.segment(L, def, next, tod); }
  }
}
