import type { Game } from '../core/game';
import { WORLD_W, H } from '../core/game';
import type { AreaDef } from '../core/types';
import { Rng, hash } from '../core/rng';
import { TILESETS, type Tileset } from './tiles';

const T = 32, COLS = WORLD_W / T; // 14 columns

/** Vertically scrolling 32px tile background with deterministic procedural rows. */
export class Background {
  ts: Tileset = TILESETS.backyard;
  area: AreaDef | null = null;
  scroll = 0; speed = 0.5;
  private rowCache = new Map<number, string[]>();
  private tileCache = new Map<string, HTMLCanvasElement>();
  private seed = 1;
  setArea(a: AreaDef, g: Game) {
    this.area = a; this.ts = TILESETS[a.tileset] ?? TILESETS.backyard;
    this.speed = a.scroll ?? this.ts.speed; this.scroll = 0; this.rowCache.clear();
    this.seed = hash(g.state.seed, a.id);
  }
  update(_g: Game) { this.scroll += this.speed; }
  row(i: number): string[] {
    let r = this.rowCache.get(i);
    if (!r) { r = this.ts.row(i, new Rng(hash(this.seed, i)), COLS); this.rowCache.set(i, r); if (this.rowCache.size > 64) this.rowCache.delete(this.rowCache.keys().next().value!); }
    return r;
  }
  tile(name: string, variant: number): HTMLCanvasElement {
    const key = this.ts.id + ':' + name + ':' + variant;
    let c = this.tileCache.get(key);
    if (!c) {
      c = document.createElement('canvas'); c.width = T; c.height = T;
      const ctx = c.getContext('2d')!;
      (this.ts.tiles[name] ?? this.ts.tiles[Object.keys(this.ts.tiles)[0]])(ctx, new Rng(hash(key)), variant);
      this.tileCache.set(key, c);
    }
    return c;
  }
  render(g: Game, r: any) {
    const tod = g.state.tod;
    r.push(-10, 0, (ctx: CanvasRenderingContext2D) => {
      const sc = Math.floor(this.scroll);
      if (this.ts.sky) this.ts.sky(ctx, sc, tod);
      else {
        const first = Math.floor(sc / T);
        for (let k = -1; k <= Math.ceil(H / T); k++) {
          const ri = first + k; const y = H - (k + 1) * T + (sc % T);
          const row = this.row(ri);
          for (let c = 0; c < COLS; c++) {
            const [name, v] = row[c].split('#');
            ctx.drawImage(this.tile(name, +(v ?? 0)), c * T, y);
          }
        }
      }
      if (this.ts.decor) this.ts.decor(ctx, sc, tod, this.seed);
      tint(ctx, tod, !!this.ts.sky);
    });
  }
}

function tint(ctx: CanvasRenderingContext2D, tod: string, space: boolean) {
  if (tod === 'day') return;
  const c = tod === 'night' ? (space ? 'rgba(29,27,51,0.25)' : 'rgba(29,27,80,0.5)') : tod === 'dusk' ? 'rgba(232,87,143,0.22)' : 'rgba(255,209,102,0.16)';
  ctx.fillStyle = c; ctx.fillRect(0, 0, WORLD_W, H);
}
