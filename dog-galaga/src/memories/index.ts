import type { Game, Module, Renderer } from '../core/game';
import { PF_X, PF_W, H } from '../core/game';
import type { MemoryDef } from '../core/types';
import { col, PALETTE } from '../core/palette';
import { pxSpark } from '../core/pixel';
import { spriteRows } from '../art/sprite';
import { text, textWidth, wrap } from '../art/font';
import { polaroid, carriedPolaroid, fallingPolaroid, carrierRim, carrierCrown, warmGlow, heartPin, groundShadow, spriteChin, spriteHeadTop } from './art';
import { memdrop } from './sound';

type Ctx = CanvasRenderingContext2D;

/** A polaroid let loose by its cat, drifting down to Pom. */
interface Drop { id: string; x: number; y: number; vx: number; vy: number; t: number; lost: boolean; swoop: boolean }
/** The reveal card queued after a pickup. */
interface Reveal { id: string; t: number; lost: boolean; n: number; hold: number }
interface Mote { x: number; y: number; t: number; life: number; k: string }
interface Carry { id: string; lost: boolean }
/** What this wave's glowing cat carries: one photo, plus (in the final sector) any lost ones bundled with it. */
export interface Pending extends Carry { more: Carry[] }

/**
 * Reveal timing (ticks). The reveal is a cozy beat: the playfield freezes and dims one step while the card
 * slides in, the photo develops and the cats go "aww"; then the card slides away and play resumes. No bullet
 * ever moves under the card. A fresh FIRE / confirm press after the photo has developed skips ahead.
 */
const IN = 14, HOLD = 112, HOLD_QUEUED = 80, OUT = 12;
/** a fresh FIRE can skip once the photo is mostly developed */
const SKIP_AT = IN + 20;
/** the photo develops over this many ticks */
const DEV = 34;
/** the polaroid pops up out of the cat, hangs for a beat, then drifts */
const POP = 40;
const CARD_W = 340, CARD_H = 74;
/** centred in the playfield, well below the toast stack (y 8.. / 24..) and the boss bar */
const CARD_Y = Math.round((H - CARD_H) / 2) - 6;

/**
 * Memories: polaroids of Pom's human Maya. In the wave content/memories.json names, one cat glows gold and
 * carries a little polaroid in its mouth; booping it pops the photo free (shutter click + music box) and it
 * drifts, flipping like a leaf, down to Pom (it homes in gently and can never be lost). Catching it develops
 * the photo on a reveal card during a short cozy freeze.
 *
 * Never lost forever: a memory whose wave went by uncollected (its sector was on the route not taken, or a
 * carrier never showed up) comes back as a LOST MEMORY carried by a glowing cat in the next wave that has no
 * memory of its own. In the final sector every lost memory rides along with the first carrier, so 18/18 stays
 * reachable on any route. Which one is offered is derived from content + state only, so it needs no save data.
 */
class Memories implements Module {
  id = 'memories';
  api = this;
  g!: Game;
  /** memory carried by this wave's glowing cat */
  pending: Pending | null = null;
  drops: Drop[] = [];
  reveals: Reveal[] = [];
  motes: Mote[] = [];
  /** drop-moment star bursts (world coords) */
  rings: { x: number; y: number; t: number }[] = [];
  /** Pom's little celebration burst waits until the reveal has finished (she stays readable during the freeze) */
  private cheerDue = false;
  /** toasts that arrived while a reveal card was up: shown right after it */
  private heldToasts: string[] = [];
  private toastOut: ((s: string) => void) | null = null;
  t = 0;
  /** true while the reveal holds the game (we set g.paused and must hand it back) */
  holding = false;
  /** a showcase stage froze the scene on its key frame */
  private stageFrozen = false;
  private staged = false;
  private lostIds = new Set<string>();

  init(g: Game) {
    this.g = g;
    g.bus.on('wave:start', (p: any) => {
      this.pending = this.offer(p.areaId, p.waveIndex);
      this.clearGlow();
      if (this.pending) g.mods.interaction?.markGlow?.();
    });
    g.bus.on('cat:boop', (p: any) => {
      if (!p.glow || p.bonus || !this.pending) return;
      const all = [this.pending, ...this.pending.more];
      all.forEach((m, i) => this.spawnDrop(m.id, p.x, p.y, m.lost, (i - (all.length - 1) / 2) * 1.3, i === 0));
      this.pending = null; this.clearGlow();
    });
    g.bus.on('wave:clear', () => { this.pending = null; this.clearGlow(); for (const d of this.drops) d.swoop = true; });
    // leaving the playfield with a photo still in the air: it was earned, so Pom gets it
    g.bus.on('area:enter', () => this.flush());
    g.bus.on('area:clear', () => this.flush());
    g.bus.on('scene:change', (p: any) => {
      if (p.to !== 'play' && p.to !== 'dialogue' && p.to !== 'bonus') this.flush();
      if (p.to !== 'play') this.release();
    });
  }

  // ------------------------------------------------------------------ public API
  placed(areaId: string): MemoryDef[] { return this.g.content.memories.filter(m => m.area === areaId); }
  placedAt(areaId: string, wave: number) { return this.g.content.memories.find(m => m.area === areaId && m.wave === wave); }
  /** Memories already passed by (their wave is behind Pom, or their sector is) that are still uncollected. */
  missed(areaId: string, wave: number): MemoryDef[] {
    const g = this.g; const s = g.state; const order = (id: string) => g.content.areas.findIndex(a => a.id === id);
    const here = order(areaId);
    return g.content.memories.filter(m => !s.memories.includes(m.id) && (m.area === areaId ? m.wave < wave : s.areasCleared.includes(m.area) || (order(m.area) >= 0 && order(m.area) < here)));
  }
  /** True when no sector follows this one: lost memories must ride along now or never. */
  private finalArea(areaId: string) { const a = this.g.content.areas.find(x => x.id === areaId); return !!a && !(a.exits ?? []).length; }
  /**
   * What this wave's glowing cat should carry: the wave's own memory first, otherwise the oldest lost one.
   * In the final sector the first carrier also brings every other lost memory (a bundle of photos), so a
   * backlog can never outnumber the waves that are left.
   */
  offer(areaId: string, wave: number): Pending | null {
    const s = this.g.state; const flying = new Set(this.drops.map(d => d.id));
    const own = this.placedAt(areaId, wave);
    const lost = this.missed(areaId, wave).filter(m => !flying.has(m.id) && m.id !== own?.id).map(m => ({ id: m.id, lost: true }));
    let first: Carry | null = null;
    if (own && !s.memories.includes(own.id)) {
      if (flying.has(own.id)) return null;   // its photo is still drifting down from the last try
      first = { id: own.id, lost: false };
    } else first = lost.shift() ?? null;
    if (!first) return null;
    return { ...first, more: this.finalArea(areaId) ? lost : [] };
  }
  collect(id: string) {
    const g = this.g; const m = g.content.memories.find(x => x.id === id); if (!m) return;
    this.drops = this.drops.filter(d => d.id !== id);
    if (g.state.memories.includes(id)) return;
    const lost = this.lostIds.has(id);
    // the card goes up before the state changes, so anything reacting to memory:get (quest toasts) sees revealing()
    this.reveals.push({ id, t: 0, lost, n: g.state.memories.length + 1, hold: HOLD });
    for (const r of this.reveals.slice(0, -1)) r.hold = Math.min(r.hold, HOLD_QUEUED);   // a queue of cards moves along faster
    this.hookToasts(g);
    g.ops.addMemory(id);
    g.mods.audio?.sfx('memory');
    this.cheerDue = true;
  }
  /** after the last card leaves: hearts and sparkles pop over Pom (never during the freeze, where they'd hide her) */
  private cheer(g: Game) {
    if (!this.cheerDue) return; this.cheerDue = false;
    const P = g.mods.player; const sc = g.state.scene;
    if (P && (sc === 'play' || sc === 'bonus')) { g.mods.effects?.burst(P.x, P.y - 14, 'hearts'); g.mods.effects?.burst(P.x, P.y - 22, 'sparkle'); }
  }
  /**
   * Toasts wait for the card: while a reveal is up, ui.toast() calls are held and replayed when it ends, so a
   * NEW QUEST banner never fights the polaroid for attention. (A shim until ui waits on revealing() itself:
   * see docs/core-requests/memories.md; if ui exposes holdToasts it is used instead.)
   */
  private hookToasts(g: Game) {
    const ui: any = g.mods.ui; if (!ui || this.toastOut || typeof ui.toast !== 'function') return;
    if (typeof ui.holdToasts === 'function') return;
    const orig = ui.toast.bind(ui); this.toastOut = orig;
    ui.toast = (s: string) => { if (this.holdingToasts(g)) { if (this.heldToasts.length < 4) this.heldToasts.push(s); } else orig(s); };
  }
  private holdingToasts(g: Game) { const sc = g.state.scene; return this.reveals.length > 0 && (sc === 'play' || sc === 'bonus'); }
  private flushToasts(g: Game) {
    if (!this.heldToasts.length || this.holdingToasts(g) || !this.toastOut) return;
    const q = this.heldToasts; this.heldToasts = []; for (const s of q) this.toastOut(s);
  }
  /** True while a reveal card is up (other modules may keep toasts out of its way). */
  revealing() { return this.reveals.length > 0; }
  /**
   * Stage a moment for screenshots and freeze it there: carrier | drop | reveal | lost, for memory #index,
   * `at` ticks into the moment (defaults: carrier 40, drop 88, reveal/lost 80 = photo fully developed).
   */
  stage(kind: string, index = 0, at = -1) {
    const g = this.g; const m = g.content.memories[index] ?? g.content.memories[0]; if (!m) return;
    g.mods.ui?.muteToasts?.(true);
    this.removeMemoryPickups();
    this.drops = []; this.reveals = []; this.motes = []; this.rings = []; this.heldToasts = [];
    const run = (n: number) => { for (let i = 0; i < n; i++) { this.sim(g); this.stepReveal(g, true); } };
    if (kind === 'drop') {
      this.pending = null; this.clearGlow();
      this.spawnDrop(m.id, 224, 120, false, 0, false); run(at >= 0 ? at : 88);
    } else if (kind === 'reveal' || kind === 'lost') {
      this.pending = null; this.clearGlow();
      g.state.memories = g.state.memories.filter(x => x !== m.id);
      if (kind === 'lost') this.lostIds.add(m.id); else this.lostIds.delete(m.id);
      this.collect(m.id); run(at >= 0 ? at : 80);
    } else {   // carrier (default)
      this.pending = { id: m.id, lost: false, more: [] };
      const cats = g.mods.interaction?.cats ?? [];
      if (!cats.some((c: any) => c.glow)) g.mods.interaction?.markGlow?.();
      run(at >= 0 ? at : 40);
    }
    this.cheerDue = false;
    this.stageFrozen = true; this.holding = false; g.paused = true;
  }

  // ------------------------------------------------------------------ simulation
  private clearGlow() { for (const c of this.g.mods.interaction?.cats ?? []) if (c.glow) c.glow = false; }
  /** anything that hands interaction a 'memory:<id>' pickup (older code paths, showcases) */
  private removeMemoryPickups(convert = false) {
    const list: any[] | undefined = this.g.mods.interaction?.pickups; if (!Array.isArray(list)) return;
    for (let i = list.length - 1; i >= 0; i--) {
      const k = list[i]; if (typeof k?.kind !== 'string' || !k.kind.startsWith('memory:')) continue;
      list.splice(i, 1);
      if (convert) this.spawnDrop(k.kind.slice(7), k.x, k.y, false, 0, true);
    }
  }
  private spawnDrop(id: string, x: number, y: number, lost: boolean, vx = 0, loud = true) {
    const g = this.g; if (this.drops.some(d => d.id === id) || g.state.memories.includes(id)) return;
    if (lost) this.lostIds.add(id);
    this.drops.push({ id, x, y, vx, vy: -1.7, t: 0, lost, swoop: false });
    if (!loud) return;
    this.rings.push({ x, y, t: 0 });
    g.mods.effects?.burst(x, y, 'sparkle');
    memdrop(g);
  }
  private flush() { for (const d of [...this.drops]) this.collect(d.id); this.pending = null; this.clearGlow(); }
  /** hand the pause back if the reveal is holding it (never leave the game frozen behind a dialogue or menu) */
  private release() {
    if (!this.holding) return; this.holding = false;
    if (!this.stageFrozen && (this.g.mods.ui?.menuOpen ?? 'none') === 'none') this.g.paused = false;
  }

  update(g: Game) {
    if (!this.staged && !g.headless) this.selfStage(g);
    if (this.stageFrozen) return;
    this.hookToasts(g);
    this.stepReveal(g, false);
    if (!g.paused) this.sim(g);
    this.flushToasts(g);
  }

  /** Advance the front reveal card and own the cozy freeze while it is up. */
  private stepReveal(g: Game, staged: boolean) {
    const sc = g.state.scene; const r = this.reveals[0];
    if (!r || (sc !== 'play' && sc !== 'bonus')) { this.release(); return; }
    const menu = (g.mods.ui?.menuOpen ?? 'none') !== 'none';
    if (!staged) {
      if (menu) return;                                   // the pause menu owns the clock; resume afterwards
      if (sc === 'play') { this.holding = true; g.paused = true; }
      const I = g.input;
      if (r.t >= SKIP_AT && r.t < IN + r.hold && (I?.pressed?.('fire') || I?.pressed?.('confirm'))) r.t = IN + r.hold;
    }
    if (++r.t >= IN + r.hold + OUT) { this.reveals.shift(); if (!this.reveals.length) { this.release(); if (!staged) this.cheer(g); } }
  }

  private sim(g: Game) {
    const sc = g.state.scene;
    this.t++;
    this.removeMemoryPickups(true);
    if (sc === 'play' || sc === 'bonus') this.stepDrops(g);
    for (const m of this.motes) { m.t++; m.y += 0.35; }
    this.motes = this.motes.filter(m => m.t < m.life);
    for (const r of this.rings) r.t++;
    this.rings = this.rings.filter(r => r.t < 26);
  }

  private stepDrops(g: Game) {
    const P = g.mods.player; const catsGone = (g.mods.interaction?.cats?.length ?? 0) === 0;
    for (const d of [...this.drops]) {
      d.t++;
      if (d.t < POP) { d.vy += 0.045; d.y += d.vy; d.x += d.vx; d.vx *= 0.96; }
      else if (P) {
        const dx = P.x - d.x, dy = P.y - 4 - d.y, dist = Math.hypot(dx, dy) || 1;
        const k = d.t - POP;
        const sp = d.swoop || catsGone ? Math.min(5, 1.4 + k * 0.08) : Math.min(2.4, 0.3 + k * 0.011);
        d.x += (dx / dist) * Math.min(sp, dist) + Math.sin(d.t / 16) * 0.55 * Math.min(1, dist / 40);
        d.y += (dy / dist) * Math.min(sp, dist);
        if (dist < 16) { this.collect(d.id); continue; }
      } else d.y += 0.4;
      // a short sparkle trail: one mote every 4 ticks, alternating sides
      if (d.t % 4 === 0) { const s = (d.t >> 2) & 1 ? 1 : -1; this.motes.push({ x: d.x + s * (3 + ((d.t >> 3) % 3)), y: d.y - 6, t: 0, life: 18, k: s > 0 ? '6' : 'f' }); }
    }
  }

  /**
   * ?showcase=memories&stage=carrier|drop|reveal|lost[:N]&phase=N&at=T, until the showcase calls stage() itself
   * (see core request). N (stage suffix or phase) picks memory #N, at = ticks into the moment.
   */
  private selfStage(g: Game) {
    let want: string | null = null, idx = 0, at = -1;
    try {
      const p = new URLSearchParams(location.search);
      if (p.get('showcase') === 'memories') {
        const [k, n] = (p.get('stage') ?? 'carrier').split(':'); want = k || 'carrier';
        idx = +(n ?? p.get('phase') ?? 0) || 0; at = p.get('at') !== null ? +(p.get('at') as string) || 0 : -1;
      }
    } catch { /* no location */ }
    if (!want) { this.staged = true; return; }
    // the showcase runs ~400 ticks first and then hands interaction a memory pickup: stage once that exists
    if (!(g.mods.interaction?.pickups ?? []).some((k: any) => String(k.kind).startsWith('memory:'))) return;
    this.staged = true; this.stage(want, idx, at);
  }

  // ------------------------------------------------------------------ playfield art
  render(g: Game, r: Renderer) {
    const sc = g.state.scene; if (sc !== 'play' && sc !== 'bonus' && sc !== 'dialogue') return;
    const t = this.t; const pend = this.pending;
    for (const c of g.mods.interaction?.cats ?? []) {
      if (!c.glow || c.dead || !pend) continue;
      if (c.st === 'wait' || c.y < -30) continue;
      const x = c.x, y = c.y, up = !!c.up, sz = c.def.size ?? 32;
      const frame = Math.floor((c.t + c.id * 7) / 12) % 2;   // same walk frame interaction draws
      const rows = spriteRows(c.def.sprite, frame); const ck = `${c.def.sprite}|${frame}`;
      // Behind the cat (before it and its same-row neighbours): the 2px gold/orange silhouette rim with white
      // shimmer walking round it. interaction still paints its own legacy checker disc for c.glow; the halo is
      // memories' job now (core request), so the flag is lowered just for that cat's draw and raised again right
      // after it (render-time only: the simulation never sees it change).
      r.push(2, y - 0.01, (ctx: Ctx) => { carrierRim(ctx, rows, ck, up, x, y, t); c.glow = false; });
      r.push(2, y + 0.01, (ctx: Ctx) => {
        c.glow = true;
        const { h, chin } = spriteChin(rows, ck);
        const chinY = up ? y + h / 2 - 1 - chin : y - h / 2 + chin;
        carriedPolaroid(ctx, pend.id, x, chinY, up ? -1 : 1, t, pend.more.length);
        // a little gold crown floats over the head (the ear side), with one twinkle hopping beside it
        const head = spriteHeadTop(rows, ck) + 3;   // sits on the head between the ears
        const top = up ? y + h / 2 - head : y - h / 2 + head;
        carrierCrown(ctx, x, top, up, t);
        const hop = (t >> 4) % 3; const sx = x + [-9, 9, 0][hop], sy = up ? top + 9 : top - 9 - (hop === 2 ? 3 : 0);
        if (((t >> 2) & 3) !== 3) pxSpark(ctx, sx, sy, (t >> 3) & 1 ? '6' : 'f', hop === 2 ? 2 : 1);
      });
    }
    // drop moment: an 8-ray pixel star burst (no rings: rings are the power-up language)
    for (const ring of this.rings) r.push(5, ring.y, (ctx: Ctx) => {
      const k = ring.t; if (k > 22) return;
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4 + Math.PI / 8; const ca = Math.cos(a), sa = Math.sin(a);
        const r0 = 6 + k * 1.3, len = Math.max(1, 5 - (k >> 2));
        for (let s2 = 0; s2 < len; s2++) {
          const px = Math.round(ring.x + ca * (r0 + s2)), py = Math.round(ring.y + sa * (r0 + s2));
          ctx.fillStyle = col(s2 === 0 ? (k < 8 ? '6' : 'f') : k < 12 ? 'f' : 'g'); ctx.fillRect(px, py, 1, 1);
        }
      }
    });
    // collectibles win: the drop, its shadow and motes sit above projectiles (layer 5), under only the HUD
    for (const m of this.motes) r.push(5, m.y, (ctx: Ctx) => {
      if (m.t > m.life - 6 && (m.t & 1)) return;           // the last few frames twinkle out instead of fading
      if (m.t < 5) pxSpark(ctx, m.x, m.y, m.k, 1); else { ctx.fillStyle = col(m.k); ctx.fillRect(Math.round(m.x), Math.round(m.y), 1, 1); }
    });
    const ground = g.mods.interaction?.grounded?.() ?? true;
    for (const d of this.drops) {
      // a soft dithered shadow on the ground below it (it hovers, floating down to Pom)
      const bob = d.t < POP ? 0 : Math.round(Math.sin(d.t / 11) * 1.5);
      if (ground) r.push(1, d.y, (ctx: Ctx) => groundShadow(ctx, d.x + 4, d.y + 18, 14 - Math.abs(bob) * 2, 4));
    }
    for (const d of this.drops) r.push(5, 1e6 + d.y, (ctx: Ctx) => {
      const bob = d.t < POP ? 0 : Math.round(Math.sin(d.t / 11) * 1.5);
      const cy = d.y + bob;
      // a warm dithered glow disc behind the card (not a ring), breathing by a pixel
      warmGlow(ctx, d.x, cy, 18 + (((t >> 4) & 1) ? 1 : 0));
      fallingPolaroid(ctx, d.id, d.x, cy, d.t, d.t >= POP / 2);
      heartPin(ctx, d.x, cy - 9);
    });
  }

  // ------------------------------------------------------------------ reveal card (screen space, over the playfield)
  overlay(g: Game, ctx: Ctx) {
    const r = this.reveals[0]; const sc = g.state.scene;
    if (!r || (sc !== 'play' && sc !== 'bonus')) return;   // parked during dialogue, resumes after
    const m = g.content.memories.find(x => x.id === r.id); if (!m) return;
    const reduce = !!g.state.settings.reduceMotion;
    const end = IN + r.hold;
    // the cozy beat: the playfield dims one step while the card is up, eased in and out through two ordered-dither
    // frames (25%, 50%) each way. At night the scene is already dark: it stops at the 50% checker and leaves the
    // bottom of each ramp alone, so the field stays readable instead of crushing to black.
    const k = Math.min(r.t - 1, end + OUT - 1 - r.t);
    const night = g.state.tod === 'night';
    const lvl = Math.max(0, Math.min(night ? 2 : 3, k));
    if (sc === 'play' && lvl > 0) { dimPlayfield(ctx, lvl, night); if (lvl >= 2) this.aww(g, ctx, r.t); }
    // slide in from the left with a 3px overshoot, settle, then slide out to the right
    const cx = PF_X + Math.round((PF_W - CARD_W) / 2);
    let x = cx;
    if (!reduce) {
      if (r.t < IN) { const f = r.t / IN; const e = 1 - Math.pow(1 - f, 3); x = Math.round(PF_X - CARD_W - 8 + (cx - PF_X + CARD_W + 8 + 3) * e); }
      else if (r.t < IN + 5) x = cx + 3 - Math.round((r.t - IN) * 0.6);
      else if (r.t >= end) { const f = (r.t - end) / OUT; x = Math.round(cx + (PF_X + PF_W - cx + 8) * f * f); }
    } else if (r.t >= end) return;
    this.card(g, ctx, m, r, x, CARD_Y);
  }

  /** the frozen cats go "aww": little hearts pop over a few of them, one after another */
  private aww(g: Game, ctx: Ctx, rt: number) {
    const cam = Math.round(g.mods.player?.camera?.x ?? 0);
    const cats: any[] = (g.mods.interaction?.cats ?? []).filter((c: any) => !c.dead && c.st !== 'wait' && c.y > 0);
    cats.forEach((c, i) => {
      if ((i * 5 + 2) % 3) return;
      const t0 = 6 + ((i * 7) % 11) * 3; const k = rt - t0; if (k < 0) return;
      const x = Math.round(PF_X - cam + c.x + ((i & 1) ? 7 : -8)), y = Math.round(c.y - 14 - Math.min(4, k >> 1));
      if (x < PF_X + 2 || x > PF_X + PF_W - 8) return;
      if (y > CARD_Y - 8 && y < CARD_Y + CARD_H + 4 && x > PF_X + 30 && x < PF_X + PF_W - 30) return;
      pixelHeart(ctx, x, y, k < 4 ? 'c' : 'd');
    });
  }

  private card(g: Game, ctx: Ctx, m: MemoryDef, r: Reveal, x: number, y: number) {
    const rect = (xx: number, yy: number, w: number, h: number, k: string) => { ctx.fillStyle = col(k); ctx.fillRect(xx, yy, w, h); };
    // frame: ink outline, gold rim, plum body, a darker inner bevel, corner studs
    rect(x + 1, y + CARD_H + 1, CARD_W + 1, 1, '0'); rect(x + CARD_W + 1, y + 1, 1, CARD_H + 1, '0');
    rect(x - 1, y - 1, CARD_W + 2, CARD_H + 2, '0');
    rect(x, y, CARD_W, CARD_H, 'f'); rect(x + 1, y + 1, CARD_W - 2, CARD_H - 2, 'h');
    rect(x + 2, y + 2, CARD_W - 4, CARD_H - 4, 'v'); rect(x + 2, y + CARD_H - 4, CARD_W - 4, 2, '1');
    for (const [cx, cy] of [[x + 3, y + 3], [x + CARD_W - 5, y + 3], [x + 3, y + CARD_H - 5], [x + CARD_W - 5, y + CARD_H - 5]]) rect(cx, cy, 2, 2, 'g');
    // the polaroid: develops (milky cream -> colour) over the first ~DEV ticks of the hold, sitting up out of the card a little;
    // once developed, the people in it blink now and then (the photo is alive for a moment)
    const dev = Math.min(1, Math.max(0, (r.t - IN + 6) / DEV));
    const blink = dev >= 1 && (r.t - IN) % 64 >= 56;
    polaroid(ctx, m.id, x + 8, y - 2, dev, 1, blink);
    // text column: small gold kicker + count, rule, the title in 2x type, two balanced body lines, a fixed footer
    const tx = x + 82, right = x + CARD_W - 8;
    const head = r.lost ? 'LOST MEMORY FOUND' : 'MEMORY FOUND';
    const hb = r.t - IN; const flash = hb >= 0 && hb < 48 && ((hb >> 3) & 1) === 1;   // three calm blinks
    text(ctx, head, tx, y + 6, col(flash ? '6' : 'f'), { shadow: col('0') });
    const count = `${r.n}/${g.content.memories.length}`;
    const cw = textWidth(count); const gx = right - cw - 10;   // a little photo glyph before the count
    rect(gx - 1, y + 5, 9, 9, '0'); rect(gx, y + 6, 7, 7, '6'); rect(gx + 1, y + 7, 5, 3, 'm'); rect(gx + 1, y + 10, 5, 1, 'j');
    text(ctx, count, right, y + 6, col('5'), { align: 'right' });
    rect(tx, y + 16, right - tx, 1, 'h'); for (let xx = tx; xx < right; xx += 2) rect(xx, y + 17, 1, 1, '1');
    const cols = Math.floor((right - tx + 1) / 6);
    const big = textWidth(m.title.toUpperCase(), 2) <= right - tx;
    if (big) text(ctx, m.title, tx, y + 21, col('6'), { scale: 2, shadow: col('0') });
    else text(ctx, wrap(m.title.toUpperCase(), cols)[0] ?? '', tx, y + 25, col('6'), { shadow: col('0') });
    bodyLines(firstSentence(m.text), cols).forEach((ln, i) => text(ctx, ln, tx, y + 40 + i * 9, col(i === 0 ? '7' : '5')));
    // footer: always there, so every card has the same layout
    rect(tx, y + 58, right - tx, 1, 'v');
    text(ctx, 'KEPT IN YOUR JOURNAL', right, y + 61, col(r.t > IN + 30 ? '4' : '3'), { align: 'right' });
    for (let i = 0; i < 3; i++) rect(tx + i * 4, y + 63, 2, 2, i === 0 ? 'd' : '3');
  }
}

/**
 * Two body lines at most, balanced: the narrowest width that still fits in as few lines as the greedy wrap,
 * so the last line is never a lone orphan word. Text that needs more than two lines ends on an ellipsis at a
 * word boundary (the journal has the whole memory).
 */
function bodyLines(s: string, cols: number): string[] {
  let lines = wrap(s, cols);
  if (lines.length > 2) {
    const words = s.split(/\s+/); let l2 = '';
    const rest = words.slice(lines[0].split(' ').length);
    for (const w of rest) { if ((l2 + ' ' + w).trim().length + 3 > cols) break; l2 = (l2 + ' ' + w).trim(); }
    return [lines[0], l2.replace(/[,;:]$/, '') + '...'];
  }
  const n = lines.length; if (n < 2) return lines;
  for (let w = Math.ceil(s.length / n); w < cols; w++) { const t = wrap(s, w); if (t.length <= n) { lines = t; break; } }
  return lines;
}

/** first sentence of a memory, for the reveal card (the journal has the whole text) */
function firstSentence(s: string) { const m = s.match(/^.*?[.!?](\s|$)/); return (m ? m[0] : s).trim(); }

function pixelHeart(ctx: Ctx, x: number, y: number, k: string) {
  ctx.fillStyle = col('0'); ctx.fillRect(x - 1, y - 1, 7, 4); ctx.fillRect(x, y + 3, 5, 1); ctx.fillRect(x + 1, y + 4, 3, 1); ctx.fillRect(x + 2, y + 5, 1, 1);
  ctx.fillStyle = col(k); ctx.fillRect(x, y, 2, 1); ctx.fillRect(x + 3, y, 2, 1); ctx.fillRect(x, y + 1, 5, 1); ctx.fillRect(x + 1, y + 2, 3, 1); ctx.fillRect(x + 2, y + 3, 1, 1);
  ctx.fillStyle = col('6'); ctx.fillRect(x, y, 1, 1);
}

/**
 * Dim the playfield exactly one step: every palette colour drops to the next darker colour of its own ramp
 * (greens to dark green, golds to orange, whites to lavender...), palette-exact and hue-preserving, so the
 * scene stays legible behind the card. Off-palette pixels snap to their nearest palette colour first.
 */
const STEP: Record<string, string> = {
  '0': '0', '1': '0', '2': '1', '3': '2', '4': '3', '5': '4', '6': '5', '7': '8', '8': '9', '9': 'a', a: 'b', b: 'v',
  c: 'd', d: 'e', e: 'v', f: 'g', g: 'h', h: 'a', i: 'j', j: 'k', k: 'v', l: 'm', m: 'n', n: '2',
  o: 'p', p: 'q', q: 'v', r: 'h', s: 'm', t: 'u', u: '2', v: '1',
};
const KEYS = '0123456789abcdefghijklmnopqrstuv';
const RGB = PALETTE.map(h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
const packed = (i: number) => { const [r, g, b] = RGB[i]; return (255 << 24 | b << 16 | g << 8 | r) >>> 0; };
/** at night the bottom of each ramp stays put (the field is already dark) */
const NIGHT_KEEP = new Set(['0', '1', '2', 'v', 'b', 'e', 'k', 'q']);
const maps: Record<string, Map<number, number>> = {};
function dimTarget(i: number, night: boolean) { const k = KEYS[i]; return packed(night && NIGHT_KEEP.has(k) ? i : KEYS.indexOf(STEP[k])); }
/**
 * lvl 1 = 25% of pixels (one per 2x2), 2 = 50% checker, 3 = every pixel: the ordered-dither ease of the dim.
 */
function dimPlayfield(ctx: Ctx, lvl = 3, night = false) {
  const x = PF_X + 1, w = PF_W - 2;
  let img: ImageData; try { img = ctx.getImageData(x, 0, w, H); } catch { return; }
  const mk = night ? 'n' : 'd';
  let map = maps[mk];
  if (!map) { map = maps[mk] = new Map(); for (let i = 0; i < 32; i++) map.set(packed(i), dimTarget(i, night)); }
  const d = new Uint32Array(img.data.buffer);
  for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < w; xx++) {
    const X = x + xx;
    if (lvl === 1 ? ((X & 1) | (yy & 1)) !== 0 : lvl === 2 ? ((X + yy) & 1) !== 0 : false) continue;
    const i = yy * w + xx; const v = d[i]; let o = map.get(v);
    if (o === undefined) {
      const r = v & 255, g = (v >> 8) & 255, b = (v >> 16) & 255;
      let best = 0, bd = 1e9;
      RGB.forEach(([pr, pg, pb], k) => { const dd = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2; if (dd < bd) { bd = dd; best = k; } });
      o = dimTarget(best, night);
      if (map.size < 8192) map.set(v, o);
    }
    d[i] = o;
  }
  ctx.putImageData(img, x, 0);
}

export const makeMemories = (): Module => new Memories();
