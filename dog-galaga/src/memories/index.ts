import type { Game, Module, Renderer } from '../core/game';
import { PF_X, PF_W } from '../core/game';
import type { MemoryDef } from '../core/types';
import { col } from '../core/palette';
import { pxRing, pxDither, pxSpark } from '../core/pixel';
import { text, textWidth, wrap } from '../art/font';
import { polaroid, carriedPolaroid, fallingPolaroid } from './art';

type Ctx = CanvasRenderingContext2D;

/** A polaroid let loose by its cat, drifting down to Pom. */
interface Drop { id: string; x: number; y: number; vx: number; vy: number; t: number; lost: boolean; swoop: boolean }
/** The reveal card queued after a pickup. */
interface Reveal { id: string; t: number; lost: boolean; n: number }
interface Mote { x: number; y: number; t: number; life: number; k: string }

/** reveal card timing (ticks): slide in, hold, slide out (~2.7 s in all; the action never stops) */
const IN = 16, HOLD = 132, OUT = 14, REVEAL = IN + HOLD + OUT;
/** the polaroid pops up out of the cat, hangs for a beat, then drifts */
const POP = 40;
const CARD_W = 300, CARD_H = 70, CARD_Y = 30;

/**
 * Memories: polaroids of Pom's human Maya. In the wave content/memories.json names, one cat glows gold and
 * carries a little polaroid in its mouth; booping it pops the photo free and it drifts, flipping like a leaf,
 * down to Pom (it homes in gently and can never be lost). Catching it develops the photo on a reveal card.
 *
 * Never lost forever: a memory whose wave went by uncollected (napped, timed out, or its sector was on the
 * route not taken) comes back as a LOST MEMORY carried by a glowing cat in the next wave that has no memory
 * of its own. Which one is offered is derived from content + state only, so it needs no save data.
 */
class Memories implements Module {
  id = 'memories';
  api = this;
  g!: Game;
  /** memory carried by this wave's glowing cat */
  pending: { id: string; lost: boolean } | null = null;
  drops: Drop[] = [];
  reveals: Reveal[] = [];
  motes: Mote[] = [];
  /** drop-moment rings (world coords) */
  rings: { x: number; y: number; t: number }[] = [];
  t = 0;
  private staged = false;
  private lostIds = new Set<string>();

  init(g: Game) {
    this.g = g;
    g.bus.on('wave:start', (p: any) => {
      this.pending = this.offer(p.areaId, p.waveIndex);
      if (this.pending) g.mods.interaction?.markGlow?.();
    });
    g.bus.on('cat:boop', (p: any) => {
      if (!p.glow || p.bonus || !this.pending) return;
      this.spawnDrop(this.pending.id, p.x, p.y, this.pending.lost); this.pending = null;
    });
    g.bus.on('wave:clear', () => { this.pending = null; for (const d of this.drops) d.swoop = true; });
    // leaving the playfield with a photo still in the air: it was earned, so Pom gets it
    g.bus.on('area:enter', () => this.flush());
    g.bus.on('area:clear', () => this.flush());
    g.bus.on('scene:change', (p: any) => { if (p.to !== 'play' && p.to !== 'dialogue' && p.to !== 'bonus') this.flush(); });
  }

  // ------------------------------------------------------------------ public API
  placed(areaId: string): MemoryDef[] { return this.g.content.memories.filter(m => m.area === areaId); }
  placedAt(areaId: string, wave: number) { return this.g.content.memories.find(m => m.area === areaId && m.wave === wave); }
  /** Memories already passed by (their wave is behind Pom) that are still uncollected. */
  missed(areaId: string, wave: number): MemoryDef[] {
    const g = this.g; const s = g.state; const order = (id: string) => g.content.areas.findIndex(a => a.id === id);
    const here = order(areaId);
    return g.content.memories.filter(m => !s.memories.includes(m.id) && (m.area === areaId ? m.wave < wave : s.areasCleared.includes(m.area) || (order(m.area) >= 0 && order(m.area) < here)));
  }
  /** What this wave's glowing cat should carry: the wave's own memory first, otherwise the oldest lost one. */
  offer(areaId: string, wave: number): { id: string; lost: boolean } | null {
    const s = this.g.state; const flying = new Set(this.drops.map(d => d.id));
    const own = this.placedAt(areaId, wave);
    if (own && !s.memories.includes(own.id) && !flying.has(own.id)) return { id: own.id, lost: false };
    if (own && !s.memories.includes(own.id)) return null;  // its photo is still drifting down from the last try
    const lost = this.missed(areaId, wave).find(m => !flying.has(m.id));
    return lost ? { id: lost.id, lost: true } : null;
  }
  collect(id: string) {
    const g = this.g; const m = g.content.memories.find(x => x.id === id); if (!m) return;
    this.drops = this.drops.filter(d => d.id !== id);
    if (g.state.memories.includes(id)) return;
    const lost = this.lostIds.has(id);
    g.ops.addMemory(id);
    this.reveals.push({ id, t: 0, lost, n: g.state.memories.length });
    g.mods.audio?.sfx('memory');
    const P = g.mods.player;
    if (P && g.state.scene === 'play') { g.mods.effects?.burst(P.x, P.y - 6, 'hearts'); g.mods.effects?.burst(P.x, P.y - 10, 'sparkle'); }
  }
  /** True while a reveal card is up (other modules may keep toasts out of its way). */
  revealing() { return this.reveals.length > 0; }
  /** Stage a moment for screenshots: carrier | drop | reveal | lost, for memory #index. */
  stage(kind: string, index = 0) {
    const g = this.g; const m = g.content.memories[index] ?? g.content.memories[0]; if (!m) return;
    g.mods.ui?.muteToasts?.(true);
    for (const k of g.mods.interaction?.pickups ?? []) if (String(k.kind).startsWith('memory:')) k.y = 99999;
    if (kind === 'drop') { this.pending = null; this.spawnDrop(m.id, 224, 120, false); for (let i = 0; i < 88; i++) this.sim(g); }
    else if (kind === 'reveal' || kind === 'lost') {
      this.drops = []; g.state.memories = g.state.memories.filter(x => x !== m.id);
      if (kind === 'lost') this.lostIds.add(m.id);
      this.collect(m.id);
      for (let i = 0; i < 70; i++) this.sim(g);
    }
    else if (kind === 'carrier') { this.drops = []; this.pending = this.pending ?? { id: m.id, lost: false }; if (!(g.mods.interaction?.cats ?? []).some((c: any) => c.glow)) g.mods.interaction?.markGlow?.(); }
  }

  // ------------------------------------------------------------------ simulation
  private spawnDrop(id: string, x: number, y: number, lost: boolean) {
    const g = this.g; if (this.drops.some(d => d.id === id) || g.state.memories.includes(id)) return;
    if (lost) this.lostIds.add(id);
    this.drops.push({ id, x, y, vx: 0, vy: -1.7, t: 0, lost, swoop: false });
    this.rings.push({ x, y, t: 0 });
    g.mods.effects?.burst(x, y, 'sparkle');
    g.mods.audio?.sfx('toast');
  }
  private flush() { for (const d of [...this.drops]) this.collect(d.id); this.pending = null; }

  update(g: Game) {
    if (!this.staged && !g.headless) this.selfStage(g);
    if (!g.paused) this.sim(g);
  }

  private sim(g: Game) {
    const sc = g.state.scene;
    this.t++;
    // anything that hands interaction a 'memory:<id>' pickup (older code paths, showcases) becomes a drifting polaroid
    const I = g.mods.interaction;
    if (I?.pickups) for (const k of I.pickups) if (typeof k.kind === 'string' && k.kind.startsWith('memory:')) { this.spawnDrop(k.kind.slice(7), k.x, k.y, false); k.y = 99999; }
    if (sc === 'play' || sc === 'bonus') this.stepDrops(g);
    if (this.reveals.length && (sc === 'play' || sc === 'bonus')) { const r = this.reveals[0]; if (++r.t >= REVEAL) this.reveals.shift(); }
    for (const m of this.motes) { m.t++; m.y += 0.35; }
    this.motes = this.motes.filter(m => m.t < m.life);
    for (const r of this.rings) r.t++;
    this.rings = this.rings.filter(r => r.t < 26);
  }

  private stepDrops(g: Game) {
    const P = g.mods.player; const catsGone = (g.mods.interaction?.cats?.length ?? 0) === 0;
    for (const d of [...this.drops]) {
      d.t++;
      if (d.t < POP) { d.vy += 0.045; d.y += d.vy; d.x += d.vx; }
      else if (P) {
        const dx = P.x - d.x, dy = P.y - 4 - d.y, dist = Math.hypot(dx, dy) || 1;
        const k = d.t - POP;
        const sp = d.swoop || catsGone ? Math.min(5, 1.4 + k * 0.08) : Math.min(2.4, 0.3 + k * 0.011);
        d.x += (dx / dist) * Math.min(sp, dist) + Math.sin(d.t / 16) * 0.55 * Math.min(1, dist / 40);
        d.y += (dy / dist) * Math.min(sp, dist);
        if (dist < 16) { this.collect(d.id); continue; }
      } else d.y += 0.4;
      if (d.t % 5 === 0) { const h = (d.t * 37 + d.id.length * 11) % 13; this.motes.push({ x: d.x - 6 + h, y: d.y + 4, t: 0, life: 22, k: h & 1 ? 'f' : '6' }); }
    }
  }

  /** ?showcase=memories&stage=carrier|drop|reveal|lost, until the showcase calls stage() itself (see core request). */
  private selfStage(g: Game) {
    let want: string | null = null, at = 0;
    try { const p = new URLSearchParams(location.search); if (p.get('showcase') === 'memories') { want = p.get('stage'); at = +(p.get('at') ?? 0) || 0; } } catch { /* no location */ }
    if (!want) { this.staged = true; return; }
    // the showcase runs ~400 ticks first and then hands interaction a memory pickup: stage once that exists
    if (!(g.mods.interaction?.pickups ?? []).some((k: any) => String(k.kind).startsWith('memory:'))) return;
    this.staged = true; this.stage(want, at);
  }

  // ------------------------------------------------------------------ playfield art
  render(g: Game, r: Renderer) {
    const sc = g.state.scene; if (sc !== 'play' && sc !== 'bonus' && sc !== 'dialogue') return;
    const t = this.t;
    const carried = this.pending?.id ?? g.content.memories[0]?.id ?? '';
    for (const c of g.mods.interaction?.cats ?? []) {
      if (!c.glow || c.dead) continue;
      const x = c.x, y = c.y, up = !!c.up;
      // behind the cat: a slow outer halo ring turning the other way, and a golden pulse rolling outwards
      r.push(2, y - 0.01, (ctx: Ctx) => {
        pxRing(ctx, x, y, 21, 'g', 4, -t / 30);
        const pr = t % 40; if (pr < 22) pxRing(ctx, x, y, 19 + (pr >> 1), pr < 8 ? '6' : pr < 15 ? 'f' : 'g', 5, t / 50);
      });
      // in front: the polaroid in its mouth, three orbiting twinkles and motes of gold rising off it
      r.push(2, y + 0.01, (ctx: Ctx) => {
        carriedPolaroid(ctx, carried, x, up ? y - 23 : y + 12, t);
        for (let k = 0; k < 3; k++) {
          const a = t / 22 + k * 2.094; const sx = x + Math.cos(a) * 20, sy = y + Math.sin(a) * 17;
          pxSpark(ctx, sx, sy, (t + k * 8) % 24 < 12 ? '6' : 'f', ((t >> 3) + k) % 3 === 0 ? 2 : 1);
        }
        for (let k = 0; k < 4; k++) {
          const ph = (t + k * 13) % 52; const mx = Math.round(x - 12 + k * 8 + Math.sin((t + k * 20) / 9) * 2), my = Math.round(y + 14 - ph * 0.7);
          ctx.fillStyle = col(ph < 26 ? 'f' : ph < 42 ? 'g' : 'h'); ctx.fillRect(mx, my, ph < 20 ? 2 : 1, ph < 20 ? 2 : 1);
        }
      });
    }
    for (const ring of this.rings) r.push(4, ring.y, (ctx: Ctx) => {
      const k = ring.t; pxRing(ctx, ring.x, ring.y, 6 + k * 1.6, k < 8 ? '6' : k < 16 ? 'f' : 'g', 6, k / 9);
      if (k < 14) pxRing(ctx, ring.x, ring.y, 3 + k, 'f', 3, -k / 7);
    });
    for (const m of this.motes) r.push(3, m.y, (ctx: Ctx) => {
      if (m.t > m.life - 6 && (m.t & 1)) return;           // the last few frames twinkle out instead of fading
      if (m.t < 6) pxSpark(ctx, m.x, m.y, m.k, 1); else { ctx.fillStyle = col(m.k); ctx.fillRect(Math.round(m.x), Math.round(m.y), 1, 1); }
    });
    for (const d of this.drops) r.push(3, d.y + 1, (ctx: Ctx) => {
      const bob = d.t < POP ? 0 : Math.round(Math.sin(d.t / 11) * 1.5);
      const cy = d.y + bob;
      pxDither(ctx, d.x, cy, 15, 'f', (t >> 3) & 1);
      pxRing(ctx, d.x, cy, 16, 'g');
      pxRing(ctx, d.x, cy, 17, (t >> 3) & 1 ? '6' : 'f', 4, t / 20);
      fallingPolaroid(ctx, d.id, d.x, cy, d.t, d.t >= POP / 2);
      for (let k = 0; k < 4; k++) { // four twinkles riding the ring, the leading one big
        const a = t / 18 + k * 1.571; pxSpark(ctx, d.x + Math.cos(a) * 19, cy + Math.sin(a) * 19, k === 0 ? '6' : 'f', k === 0 ? 2 : 1);
      }
    });
  }

  // ------------------------------------------------------------------ reveal card (screen space, over the playfield)
  overlay(g: Game, ctx: Ctx) {
    const r = this.reveals[0]; const sc = g.state.scene;
    if (!r || (sc !== 'play' && sc !== 'bonus')) return;   // parked during dialogue, resumes after
    const m = g.content.memories.find(x => x.id === r.id); if (!m) return;
    const reduce = !!g.state.settings.reduceMotion;
    // slide down from above with a 3px settle, then back up
    let y = CARD_Y;
    if (!reduce) {
      if (r.t < IN) { const f = r.t / IN; const e = 1 - Math.pow(1 - f, 3); y = Math.round(-CARD_H - 12 + (CARD_Y + CARD_H + 12 + 3) * e); }
      else if (r.t < IN + 5) y = CARD_Y + 3 - Math.round((r.t - IN) * 0.6);
      else if (r.t >= IN + HOLD) { const f = (r.t - IN - HOLD) / OUT; y = Math.round(CARD_Y - (CARD_Y + CARD_H + 12) * f * f); }
    } else if (r.t >= IN + HOLD) return;
    const x = PF_X + Math.round((PF_W - CARD_W) / 2);
    this.card(g, ctx, m, r, x, y);
  }

  private card(g: Game, ctx: Ctx, m: MemoryDef, r: Reveal, x: number, y: number) {
    const rect = (xx: number, yy: number, w: number, h: number, k: string) => { ctx.fillStyle = col(k); ctx.fillRect(xx, yy, w, h); };
    // frame: ink outline, gold rim, plum body, a darker inner bevel, corner studs
    rect(x - 1, y - 1, CARD_W + 2, CARD_H + 2, '0');
    rect(x, y, CARD_W, CARD_H, 'f'); rect(x + 1, y + 1, CARD_W - 2, CARD_H - 2, 'h');
    rect(x + 2, y + 2, CARD_W - 4, CARD_H - 4, 'v'); rect(x + 2, y + CARD_H - 4, CARD_W - 4, 2, '1');
    for (const [cx, cy] of [[x + 3, y + 3], [x + CARD_W - 5, y + 3], [x + 3, y + CARD_H - 5], [x + CARD_W - 5, y + CARD_H - 5]]) rect(cx, cy, 2, 2, 'g');
    // the polaroid: develops over the first ~45 ticks of the hold, sitting up out of the card a little
    const dev = Math.min(1, Math.max(0, (r.t - IN + 6) / 45));
    polaroid(ctx, m.id, x + 8, y - 2, dev);
    // text column
    const tx = x + 82, right = x + CARD_W - 8;
    const head = r.lost ? 'LOST MEMORY FOUND' : 'MEMORY FOUND';
    const blink = r.t < IN + 24 && ((r.t >> 2) & 1);
    text(ctx, head, tx, y + 7, col(blink ? '6' : 'f'), { shadow: col('0') });
    const count = `${r.n}/${g.content.memories.length}`;
    const cw = textWidth(count); const gx = right - cw - 10;   // a little photo glyph before the count
    rect(gx - 1, y + 6, 9, 9, '0'); rect(gx, y + 7, 7, 7, '6'); rect(gx + 1, y + 8, 5, 3, 'm'); rect(gx + 1, y + 11, 5, 1, 'j');
    text(ctx, count, right, y + 7, col('5'), { align: 'right' });
    rect(tx, y + 17, right - tx, 1, 'h'); for (let xx = tx; xx < right; xx += 2) rect(xx, y + 18, 1, 1, '1');
    const cols = Math.floor((right - tx + 1) / 6);
    const title = wrap(m.title.toUpperCase(), cols)[0] ?? '';
    text(ctx, title, tx, y + 22, col('6'), { shadow: col('0') });
    let lines = wrap(firstSentence(m.text), cols);
    if (lines.length > 3) { lines = lines.slice(0, 3); lines[2] = lines[2].slice(0, cols - 3).trimEnd() + '...'; }
    lines.forEach((ln, i) => text(ctx, ln, tx, y + 34 + i * 9, col(i === 0 ? '7' : '5')));
    if (lines.length < 3 && r.t > IN + 30) text(ctx, 'KEPT IN YOUR JOURNAL', right, y + CARD_H - 15, col('3'), { align: 'right' });
  }
}

/** first sentence of a memory, for the reveal card (the journal has the whole text) */
function firstSentence(s: string) { const m = s.match(/^.*?[.!?](\s|$)/); return (m ? m[0] : s).trim(); }

export const makeMemories = (): Module => new Memories();
