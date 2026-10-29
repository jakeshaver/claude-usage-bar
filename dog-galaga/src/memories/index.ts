import type { Game, Module, Renderer } from '../core/game';
import { PF_X, PF_W, H } from '../core/game';
import type { MemoryDef } from '../core/types';
import { col, PALETTE } from '../core/palette';
import { pxSpark } from '../core/pixel';
import { spriteRows } from '../art/sprite';
import { text, textWidth, wrap } from '../art/font';
import { polaroid, carriedPolaroid, fallingPolaroid, dropHalo, dropWidth, DROP_W, carrierRim, carrierCrown, heartPin, groundShadow, spriteChin, spriteHeadTop, whiteSilhouette, recoveredStamp } from './art';
import { memdrop, memfound } from './sound';

type Ctx = CanvasRenderingContext2D;

/** A polaroid let loose by its cat, drifting down to Pom. */
interface Drop { id: string; x: number; y: number; vx: number; vy: number; t: number; lost: boolean; swoop: boolean; more: string[] }
/** The reveal card queued after a pickup. */
interface Reveal { id: string; t: number; lost: boolean; n: number; hold: number; ids: string[] }
/** the carrier's boop moment: a white silhouette flash + star burst */
interface Burst { x: number; y: number; t: number; rows: string[] | null; ck: string; up: boolean; stopped: boolean }
interface Mote { x: number; y: number; t: number; life: number; k: string }
interface Carry { id: string; lost: boolean }
/** What this wave's glowing cat carries: one photo, plus (in the final sector) any lost ones bundled with it. */
export interface Pending extends Carry { more: Carry[] }

/**
 * Reveal timing (ticks). The reveal is a cozy beat: the playfield freezes and dims one step while the card
 * slides in, the photo develops and the cats go "aww"; then the card slides away and play resumes. No bullet
 * ever moves under the card. A fresh FIRE / confirm press after the photo has developed skips ahead.
 * The card docks to the top edge of the playfield (never over Pom's lower field) and only goes up at a calm
 * moment: see calm().
 */
const IN = 14, HOLD = 112, HOLD_QUEUED = 80, OUT = 12;
/** a bundle card (3+ photos at once) stays up ~3 s in all, and says how to skip */
const HOLD_BUNDLE = 156;
/** hit-stop on the carrier boop (ticks) and the white flash inside it */
const STOP = 4;
/** a fresh FIRE can skip once the photo is mostly developed */
const SKIP_AT = IN + 20;
/** the photo develops over this many ticks */
const DEV = 34;
/** the polaroid pops up out of the cat, hangs for a beat, then drifts */
const POP = 40;
const CARD_W = 340, CARD_H = 48;
/**
 * A slim band docked to the top edge of the playfield (y 6..54, plus a 2px ink-dither shadow; only the polaroid
 * overhangs it, to y 69), so the lower 4/5 where Pom fights stays in plain view during the beat. Toasts are held
 * while the card is up and the ones already on screen are hidden until it leaves (see hookToasts), so nothing
 * draws over it; in a boss fight it sits just under the boss armor bar (y 3..19).
 */
const CARD_Y = 6, CARD_Y_BOSS = 22;
/**
 * The card waits (the photo is already safe in the album) instead of going up at an unfair moment: during a
 * sector title card, in the first WAVE_GRACE ticks of a wave (cats are still flying in), or while a boss is
 * entering, winding up a telegraphed attack, attacking or changing phase.
 */
const WAVE_GRACE = 90;
const BOSS_BUSY = new Set(['enter', 'tell', 'attack', 'phase']);

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
  rings: Burst[] = [];
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
  /** g.tick when the current wave (or boss) started */
  private waveAt = -1e9;

  init(g: Game) {
    this.g = g;
    g.bus.on('boss:start', () => { this.waveAt = g.tick; });
    g.bus.on('wave:start', (p: any) => {
      this.waveAt = g.tick;
      this.pending = this.offer(p.areaId, p.waveIndex);
      this.clearGlow();
      if (this.pending) g.mods.interaction?.markGlow?.();
    });
    g.bus.on('cat:boop', (p: any) => {
      if (!p.glow || p.bonus || !this.pending) return;
      const all = [this.pending, ...this.pending.more];
      const cat = (g.mods.interaction?.cats ?? []).find((c: any) => c.glow && c.dead && Math.abs(c.x - p.x) < 1 && Math.abs(c.y - p.y) < 1);
      this.boopMoment(p.x, p.y, cat);
      // three or more photos travel as one bundle (one catch, one card), one or two fan out
      if (all.length > 2) this.spawnDrop(all[0].id, p.x, p.y, true, 0, true, all.slice(1).map(m => m.id));
      else all.forEach((m, i) => this.spawnDrop(m.id, p.x, p.y, m.lost, (i - (all.length - 1) / 2) * 1.3, i === 0));
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
    const s = this.g.state; const flying = new Set(this.drops.flatMap(d => [d.id, ...(d.more ?? [])]));
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
  collect(id: string) { this.collectMany([id]); }
  /**
   * Collect several photos at once (a caught bundle, or everything still in the air on a scene change). Up to
   * two cards queue normally; past that the waiting cards collapse into one "N LOST MEMORIES FOUND" card with a
   * fanned stack of polaroids, so a backlog never freezes play for long.
   */
  collectMany(ids: string[]) {
    const g = this.g;
    for (const d of this.drops) d.more = (d.more ?? []).filter(x => !ids.includes(x));
    this.drops = this.drops.filter(d => !ids.includes(d.id));
    const fresh = ids.filter((id, i) => ids.indexOf(id) === i && g.content.memories.some(m => m.id === id) && !g.state.memories.includes(id));
    if (!fresh.length) return;
    const base = g.state.memories.length; const anyLost = fresh.some(id => this.lostIds.has(id));
    // the cards go up before the state changes, so anything reacting to memory:get (quest toasts) sees revealing()
    fresh.forEach((id, i) => this.reveals.push({ id, t: 0, lost: this.lostIds.has(id), n: base + i + 1, hold: HOLD, ids: [id] }));
    if (this.reveals.length > 2) {
      const from = this.reveals[0].t > 0 ? 1 : 0;
      const rest = this.reveals.splice(from); const all = rest.flatMap(r => r.ids);
      this.reveals.push({ id: all[all.length - 1], t: 0, lost: rest.some(r => r.lost), n: base + fresh.length, hold: HOLD_BUNDLE, ids: all });
    }
    for (const r of this.reveals.slice(0, -1)) if (r.ids.length === 1) r.hold = Math.min(r.hold, HOLD_QUEUED);   // a queue of cards moves along faster
    this.hookToasts(g);
    for (const id of fresh) g.ops.addMemory(id);
    // a recovered photo gets its own warmer chime; a fresh one the usual memory sting
    if (!(anyLost && memfound(g, fresh.length))) g.mods.audio?.sfx('memory');
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
    const ui: any = g.mods.ui; if (!ui) return;
    // Toasts already on screen when the card goes up are kept off screen by ui itself while showing() is true.
    if (this.toastOut || typeof ui.toast !== 'function') return;
    if (typeof ui.holdToasts === 'function') return;
    const orig = ui.toast.bind(ui); this.toastOut = orig;
    ui.toast = (s: string) => { if (this.holdingToasts(g)) { if (this.heldToasts.length < 4) this.heldToasts.push(s); } else orig(s); };
  }
  private holdingToasts(g: Game) { const sc = g.state.scene; return this.reveals.length > 0 && (sc === 'play' || sc === 'bonus'); }
  private flushToasts(g: Game) {
    if (!this.heldToasts.length || this.holdingToasts(g) || !this.toastOut) return;
    const q = this.heldToasts; this.heldToasts = []; for (const s of q) this.toastOut(s);
  }
  /** True while a reveal card is up or waiting for a calm moment (other modules may keep toasts out of its way). */
  revealing() { return this.reveals.length > 0; }
  /** True while a reveal card is actually on screen (the game is held for it). */
  showing() { const r = this.reveals[0]; return !!r && r.t > 0; }
  /**
   * May a waiting card go up now? Never over a sector title card, while a wave is still flying in, or during a
   * boss entrance / telegraph / attack / phase change. The bonus scene has no hazards, so it is always calm.
   */
  calm(g: Game = this.g): boolean {
    if (g.state.scene !== 'play') return true;
    if ((g.mods.world?.titleCard ?? 0) > 0) return false;
    if (g.tick - this.waveAt < WAVE_GRACE) return false;
    const b = g.mods.interaction?.boss;
    return !(b && BOSS_BUSY.has(b.st));
  }
  /**
   * Stage a moment for screenshots and freeze it there: carrier | drop | boop | reveal | lost | bundle, for memory #index,
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
      this.collect(m.id);
      const r0 = this.reveals[0]; if (r0) r0.n = Math.max(r0.n, index + 1);   // a plausible album count for memory #N
      run(at >= 0 ? at : 80);
    } else if (kind === 'bundle') {     // the final-sector backlog: 5 lost photos caught at once
      this.pending = null; this.clearGlow();
      const ids = g.content.memories.slice(index, index + 5).map(x => x.id);
      g.state.memories = g.state.memories.filter(x => !ids.includes(x));
      for (const id of ids) this.lostIds.add(id);
      this.collectMany(ids); run(at >= 0 ? at : 80);
    } else if (kind === 'boop') {       // the carrier boop moment, a few ticks in
      this.pending = null; this.clearGlow();
      const c = (g.mods.interaction?.cats ?? []).find((c: any) => !c.dead && c.y > 40) ?? { x: 224, y: 120 };
      this.boopMoment(c.x, c.y, c, false);
      this.spawnDrop(m.id, c.x, c.y, false, 0, false); run(at >= 0 ? at : 1);
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
  private spawnDrop(id: string, x: number, y: number, lost: boolean, vx = 0, loud = true, more: string[] = []) {
    const g = this.g; if (this.drops.some(d => d.id === id || (d.more ?? []).includes(id)) || g.state.memories.includes(id)) return;
    if (lost) { this.lostIds.add(id); for (const m of more) this.lostIds.add(m); }
    this.drops.push({ id, x, y, vx, vy: -1.7, t: 0, lost, swoop: false, more: more.filter(m => !g.state.memories.includes(m)) });
    if (!loud) return;
    g.mods.effects?.burst(x, y, 'sparkle');
    memdrop(g);
  }
  /**
   * The carrier boop is the special beat: a short hit-stop (effects holds the sim), the carrier's silhouette
   * flashes white for the first two frozen frames, then a 2px-thick 8-ray gold star bursts out of it.
   */
  private boopMoment(x: number, y: number, cat: any, stop = true) {
    let rows: string[] | null = null, ck = '', up = false;
    if (cat?.def?.sprite) { const f = Math.floor((cat.t + cat.id * 7) / 12) % 2; rows = spriteRows(cat.def.sprite, f); ck = `${cat.def.sprite}|${f}`; up = !!cat.up; }
    if (stop) this.g.mods.effects?.hitStop?.(STOP);
    this.rings.push({ x, y, t: 0, rows, ck, up, stopped: stop && !!this.g.mods.effects?.frozen?.() });
  }
  private flush() { this.collectMany(this.drops.flatMap(d => [d.id, ...(d.more ?? [])])); this.pending = null; this.clearGlow(); }
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
      if (r.t === 0 && !this.calm(g)) { this.release(); return; }   // wait for a fair moment (play goes on)
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
        if (dist < 16) { this.collectMany([d.id, ...(d.more ?? [])]); continue; }
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
    const night = g.state.tod === 'night';
    for (const c of g.mods.interaction?.cats ?? []) {
      if (!c.glow || c.dead || !pend) continue;
      if (c.st === 'wait' || c.y < -30) continue;
      const x = c.x, y = c.y, up = !!c.up;
      const frame = Math.floor((c.t + c.id * 7) / 12) % 2;   // same walk frame interaction draws
      const rows = spriteRows(c.def.sprite, frame); const ck = `${c.def.sprite}|${frame}`;
      // interaction still paints a legacy checker disc for c.glow; the halo is memories' job now (core request), so
      // the flag is lowered just for that cat's own draw call and raised again right after it (render-time only).
      r.push(2, y - 0.01, () => { c.glow = false; });
      // Right after the cat (still y-sorted with its row): the 2px gold silhouette rim with white shimmer. Its inner
      // row lands exactly on the light dusk/night readability rim, replacing it with gold instead of stacking outside.
      r.push(2, y + 0.01, (ctx: Ctx) => { c.glow = true; if (!c.flash) carrierRim(ctx, rows, ck, up, x, y, t, night); });
      // The carrier's markers (polaroid in its mouth, crown, twinkle) draw over every cat, so a diving carrier's crown
      // is never hidden behind the neighbour it passes.
      r.push(2, 1e3 + y, (ctx: Ctx) => {
        const { h, chin } = spriteChin(rows, ck);
        const chinY = up ? y + h / 2 - 1 - chin : y - h / 2 + chin;
        carriedPolaroid(ctx, pend.id, x, chinY, up ? -1 : 1, t, pend.more.length);
        const head = spriteHeadTop(rows, ck) + 3;   // sits on the head between the ears
        const top = up ? y + h / 2 - head : y - h / 2 + head;
        carrierCrown(ctx, x, top, up, t);
        const hop = (t >> 4) % 3; const sx = x + [-9, 9, 0][hop], sy = up ? top + 9 : top - 9 - (hop === 2 ? 3 : 0);
        if (((t >> 2) & 3) !== 3) pxSpark(ctx, sx, sy, (t >> 3) & 1 ? '6' : 'f', hop === 2 ? 2 : 1);
      });
    }
    // drop moment: the carrier flashes white (2 frames, inside the hit-stop), then an 8-ray pixel star bursts out:
    // 2px rays for the first 6 ticks, thinning to 1px (no rings: rings are the power-up language)
    const fx: any = g.mods.effects; const frozen = !!fx?.frozen?.(); const stopT = +(fx?.stopT ?? 0);
    for (const ring of this.rings) r.push(5, ring.y, (ctx: Ctx) => {
      const k = ring.t;
      const flash = ring.stopped ? frozen && k === 0 && stopT >= STOP - 2 : k < 2;
      if (flash) { whiteSilhouette(ctx, ring.rows, ring.ck, ring.up, ring.x, ring.y); if (!ring.rows) pxSpark(ctx, ring.x, ring.y, '6', 3); }
      if (k > 22 || (ring.stopped && frozen && k === 0 && stopT >= STOP - 2)) return;
      const thick = k < 6 ? 2 : 1;
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4 + Math.PI / 8; const ca = Math.cos(a), sa = Math.sin(a);
        const r0 = 10 + k * 1.4, len = Math.max(2, 7 - (k >> 2));
        for (let s2 = 0; s2 < len; s2++) {
          const px = Math.round(ring.x + ca * (r0 + s2)) - (thick >> 1), py = Math.round(ring.y + sa * (r0 + s2)) - (thick >> 1);
          ctx.fillStyle = col(s2 === 0 ? (k < 8 ? '6' : 'f') : k < 12 ? 'f' : 'g'); ctx.fillRect(px, py, thick, thick);
        }
      }
    });
    // collectibles win: the drop, its halo and motes sit above projectiles (layer 5), under only the HUD
    for (const m of this.motes) r.push(5, m.y, (ctx: Ctx) => {
      if (m.t > m.life - 6 && (m.t & 1)) return;           // the last few frames twinkle out instead of fading
      if (m.t < 5) pxSpark(ctx, m.x, m.y, m.k, 1); else { ctx.fillStyle = col(m.k); ctx.fillRect(Math.round(m.x), Math.round(m.y), 1, 1); }
    });
    const ground = g.mods.interaction?.grounded?.() ?? true;
    for (const d of this.drops) {
      // a soft dithered shadow on the ground below it (it hovers, floating down to Pom)
      const bob = d.t < POP ? 0 : Math.round(Math.sin(d.t / 11) * 1.5);
      if (ground) r.push(1, d.y, (ctx: Ctx) => groundShadow(ctx, d.x + 4, d.y + 18, Math.max(6, dropWidth(d.t, d.t >= POP / 2)) - Math.abs(bob) * 2, 4));
    }
    for (const d of this.drops) r.push(5, 1e6 + d.y, (ctx: Ctx) => {
      const bob = d.t < POP ? 0 : Math.round(Math.sin(d.t / 11) * 1.5);
      const cy = d.y + bob; const flip = d.t >= POP / 2; const extra = d.more?.length ?? 0;
      // a crisp gold outline + sparse dither glint (teal for a recovered photo), then the card itself
      dropHalo(ctx, d.x, cy, extra ? DROP_W : dropWidth(d.t, flip), t, d.lost ? 'l' : 'f');
      fallingPolaroid(ctx, d.id, d.x, cy, d.t, flip && !extra, extra, d.lost);
      heartPin(ctx, d.x, cy - 9);
    });
  }

  // ------------------------------------------------------------------ reveal card (screen space, over the playfield)
  overlay(g: Game, ctx: Ctx) {
    const r = this.reveals[0]; const sc = g.state.scene;
    if (!r || r.t <= 0 || (sc !== 'play' && sc !== 'bonus')) return;   // parked during dialogue (or waiting), resumes after
    const m = g.content.memories.find(x => x.id === r.id); if (!m) return;
    ctx.save(); ctx.beginPath(); ctx.rect(PF_X, 0, PF_W, H); ctx.clip();   // the slide never crosses the HUD panels
    try { this.overlayIn(g, ctx, r, m, sc); } finally { ctx.restore(); }
  }
  private overlayIn(g: Game, ctx: Ctx, r: Reveal, m: MemoryDef, sc: string) {
    const reduce = !!g.state.settings.reduceMotion;
    const end = IN + r.hold;
    // the cozy beat: the playfield dims one step while the card is up, eased in and out through two ordered-dither
    // frames (25%, 50%) each way. At night the scene is already dark: it stops at the 50% checker and leaves the
    // bottom of each ramp alone, so the field stays readable instead of crushing to black.
    const k = Math.min(r.t - 1, end + OUT - 1 - r.t);
    const night = g.state.tod === 'night';
    // by day and dusk it goes one dither step further (every pixel one step, half of them two), so the hold reads
    // as a deliberate cozy moment instead of a hitch
    const lvl = Math.max(0, Math.min(night ? 2 : 4, k));
    if (sc === 'play' && lvl > 0) { dimPlayfield(ctx, lvl, night); if (lvl >= 2) this.aww(g, ctx, r.t); }
    // slide in from the left with a 3px overshoot, settle, then slide out to the right
    const cx = PF_X + Math.round((PF_W - CARD_W) / 2);
    let x = cx;
    if (!reduce) {
      if (r.t < IN) { const f = r.t / IN; const e = 1 - Math.pow(1 - f, 3); x = Math.round(PF_X - CARD_W - 8 + (cx - PF_X + CARD_W + 8 + 3) * e); }
      else if (r.t < IN + 5) x = cx + 3 - Math.round((r.t - IN) * 0.6);
      else if (r.t >= end) { const f = (r.t - end) / OUT; x = Math.round(cx + (PF_X + PF_W - cx + 8) * f * f); }
    } else if (r.t >= end) return;
    this.card(g, ctx, m, r, x, this.cardY(g));
  }

  private cardY(g: Game) { return g.mods.ui?.bossBarOn || g.mods.interaction?.boss ? CARD_Y_BOSS : CARD_Y; }

  /** the frozen cats go "aww": little hearts pop over a few of them, one after another */
  private aww(g: Game, ctx: Ctx, rt: number) {
    const cam = Math.round(g.mods.player?.camera?.x ?? 0);
    const cats: any[] = (g.mods.interaction?.cats ?? []).filter((c: any) => !c.dead && c.st !== 'wait' && c.y > 0);
    cats.forEach((c, i) => {
      if ((i * 5 + 2) % 3) return;
      const t0 = 6 + ((i * 7) % 11) * 3; const k = rt - t0; if (k < 0) return;
      const x = Math.round(PF_X - cam + c.x + ((i & 1) ? 7 : -8)), y = Math.round(c.y - 14 - Math.min(4, k >> 1));
      if (x < PF_X + 2 || x > PF_X + PF_W - 8) return;
      const cy = this.cardY(g);
      if (y > cy - 8 && y < cy + CARD_H + 4 && x > PF_X + 30 && x < PF_X + PF_W - 30) return;
      pixelHeart(ctx, x, y, k < 4 ? 'c' : 'd');
    });
  }

  private card(g: Game, ctx: Ctx, m: MemoryDef, r: Reveal, x: number, y: number) {
    const rect = (xx: number, yy: number, w: number, h: number, k: string) => { ctx.fillStyle = col(k); ctx.fillRect(xx, yy, w, h); };
    const bundle = r.ids.length > 1;
    // a recovered photo wears teal instead of gold, everywhere on the card: rim, studs, kicker, rule
    const rimK = r.lost ? 'l' : 'f', rimK2 = r.lost ? 'm' : 'h', studK = r.lost ? 'm' : 'g';
    // frame: ink outline, rim, plum body, a darker inner bevel, corner studs; under it a 1px ink line and a 2px
    // ink dither strip, so the field it crosses reads as layered beneath it (not cut off)
    rect(x - 1, y - 1, CARD_W + 2, CARD_H + 2, '0');
    ctx.fillStyle = col('0');
    for (let yy = 0; yy < 2; yy++) for (let xx = (yy & 1); xx < CARD_W + 2; xx += 2) ctx.fillRect(x - 1 + xx, y + CARD_H + 1 + yy, 1, 1);
    rect(x, y, CARD_W, CARD_H, rimK); rect(x + 1, y + 1, CARD_W - 2, CARD_H - 2, rimK2);
    rect(x + 2, y + 2, CARD_W - 4, CARD_H - 4, 'v'); rect(x + 2, y + CARD_H - 4, CARD_W - 4, 2, '1');
    for (const [cx, cy] of [[x + 3, y + 3], [x + CARD_W - 5, y + 3], [x + 3, y + CARD_H - 5], [x + CARD_W - 5, y + CARD_H - 5]]) rect(cx, cy, 2, 2, studK);
    // the polaroid: develops (milky cream -> colour) over the first ~DEV ticks of the hold, taped over the band and
    // hanging out of its bottom edge; once developed, the people in it blink now and then (the photo is alive)
    const dev = Math.min(1, Math.max(0, (r.t - IN + 6) / DEV));
    const blink = dev >= 1 && (r.t - IN) % 64 >= 56;
    if (bundle) {
      // a fanned stack: two more frames peek out behind, offset and staggered (pixel-exact, no rotation);
      // the topmost ink row stays at y >= 2 at the screen edge
      for (const [ox, oy, k] of [[15, -2, '4'], [10, 0, '5']] as [number, number, string][]) {
        const fy = Math.max(2, y + oy - 1);
        rect(x + ox - 1, fy, 66, 64, '0'); rect(x + ox, fy + 1, 64, 62, k); rect(x + ox + 63, fy + 1, 1, 62, '3');
        rect(x + ox + 4, fy + 5, 56, 44, '1'); rect(x + ox + 5, fy + 6, 54, 2, '2');
      }
      polaroid(ctx, m.id, x + 5, y + 2, dev, 1, blink, r.lost);
      // a little count tag pinned to the stack
      const tag = `x${r.ids.length}`; const tw = textWidth(tag) + 4;
      rect(x + 66 - tw, y + 50, tw + 2, 11, '0'); rect(x + 67 - tw, y + 51, tw, 9, rimK); text(ctx, tag, x + 69 - tw, y + 53, col('0'));
    } else {
      polaroid(ctx, m.id, x + 8, y + 1, dev, 1, blink, r.lost);
      if (r.lost && dev >= 0.5) recoveredStamp(ctx, x + 8, y + 36, (c, str, sx, sy) => text(c, str, sx, sy, col('0')));
    }
    // text column: small kicker + count, rule, the title in 2x type, one body line (or the skip hint)
    const tx = x + 82, right = x + CARD_W - 8;
    const n = r.ids.length;
    const head = bundle ? (r.lost ? 'FOUND AT LAST' : 'A HANDFUL OF PHOTOS') : r.lost ? 'LOST MEMORY FOUND' : 'MEMORY FOUND';
    const hb = r.t - IN; const flash = hb >= 0 && hb < 48 && ((hb >> 3) & 1) === 1;   // three calm blinks
    text(ctx, head, tx, y + 4, col(flash ? '6' : rimK), { shadow: col('0') });
    const count = `${r.n}/${g.content.memories.length}`;
    const cw = textWidth(count); const gx = right - cw - 10;   // a little photo glyph before the count
    rect(gx - 1, y + 3, 9, 9, '0'); rect(gx, y + 4, 7, 7, '6'); rect(gx + 1, y + 5, 5, 3, 'm'); rect(gx + 1, y + 8, 5, 1, 'j');
    text(ctx, count, right, y + 4, col('5'), { align: 'right' });
    rect(tx, y + 13, right - tx, 1, rimK2); for (let xx = tx; xx < right; xx += 2) rect(xx, y + 14, 1, 1, '1');
    const cols = Math.floor((right - tx + 1) / 6);
    const title = bundle ? `${n} ${r.lost ? 'LOST ' : ''}MEMORIES` : m.title;
    const big = textWidth(title.toUpperCase(), 2) <= right - tx;
    if (big) text(ctx, title, tx, y + 17, col('6'), { scale: 2, shadow: col('0') });
    else text(ctx, wrap(title.toUpperCase(), cols)[0] ?? '', tx, y + 21, col('6'), { shadow: col('0') });
    // one body line; while more cards wait (or on a bundle) its right end teaches the skip
    const canSkip = r.t >= SKIP_AT && r.t < IN + r.hold;
    const skipHint = bundle || (this.reveals.length > 1 && canSkip);
    const hint = 'TOOT: NEXT';
    const bodyCols = skipHint ? cols - hint.length - 2 : cols - 2;   // clear of the 3 trim dots
    const body = bundle ? bundleLine(r.ids.map(id => g.content.memories.find(x => x.id === id)?.title ?? '').filter(Boolean), bodyCols) : oneLine(firstSentence(m.text), bodyCols);
    text(ctx, body, tx, y + 34, col('7'));
    if (skipHint) text(ctx, hint, right, y + 34, col(canSkip && ((r.t >> 4) & 1) ? '6' : '4'), { align: 'right' });
    for (let i = 0; i < 3; i++) rect(right - 10 + i * 4, y + CARD_H - 9, 2, 2, i === 0 ? (r.lost ? 'l' : 'd') : '3');
  }
}

/** One body line: the text if it fits, else cut at a word boundary with an ellipsis (the journal has it all). */
function oneLine(s: string, cols: number): string {
  s = s.toUpperCase(); if (s.length <= cols) return s;
  // a whole clause reads better than a sentence chopped mid-phrase
  const clause = s.split(',')[0].trim();
  if (clause.length + 3 <= cols && clause.length >= cols * 0.55) return clause + '...';
  let out = '';
  for (const w of s.split(/\s+/)) { if ((out + ' ' + w).trim().length + 3 > cols) break; out = (out + ' ' + w).trim(); }
  return (out || s.slice(0, Math.max(0, cols - 3))).replace(/[,;:.]$/, '') + '...';
}

/**
 * A bundle's body line: the two newest titles and a count of the rest ("GOOD GIRL, NIGHT LIGHT +16 MORE"),
 * never a long list of names. Falls back to one title, then to the count alone.
 */
function bundleLine(titles: string[], cols: number): string {
  const t = titles.map(x => x.toUpperCase()).reverse(); const n = t.length;
  const tries = [
    n <= 2 ? t.join(', ') : `${t[0]}, ${t[1]} +${n - 2} MORE`,
    `${t[0]} +${n - 1} MORE`,
    `${n} NEW IN YOUR JOURNAL`,
  ];
  return tries.find(x => x.length <= cols) ?? oneLine(tries[tries.length - 1], cols);
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
 * Dark green 'k' (the main grass) is the bottom of its ramp: it is only stepped on a 50% checker (k/deep-night
 * dither), so a dimmed daytime lawn still reads as green instead of turning into a plum night scene.
 */
const STEP: Record<string, string> = {
  '0': '0', '1': '0', '2': '1', '3': '2', '4': '3', '5': '4', '6': '5', '7': '8', '8': '9', '9': 'a', a: 'b', b: 'v',
  c: 'd', d: 'e', e: 'v', f: 'g', g: 'h', h: 'a', i: 'j', j: 'k', k: '1', l: 'm', m: 'n', n: '2',
  o: 'p', p: 'q', q: 'v', r: 'h', s: 'm', t: 'u', u: '2', v: '1',
};
const KEYS = '0123456789abcdefghijklmnopqrstuv';
const RGB = PALETTE.map(h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
const packed = (i: number) => { const [r, g, b] = RGB[i]; return (255 << 24 | b << 16 | g << 8 | r) >>> 0; };
/** at night the bottom of each ramp stays put (the field is already dark) */
const NIGHT_KEEP = new Set(['0', '1', '2', 'v', 'b', 'e', 'k', 'q']);
/** ramp bottoms that only step on half the pixels (keep their hue) */
const HALF = new Set(['k']);
const halfSrc = new Set<number>();
const maps: Record<string, Map<number, number>> = {};
function dimTarget(i: number, night: boolean) { const k = KEYS[i]; return packed(night && NIGHT_KEEP.has(k) ? i : KEYS.indexOf(STEP[k])); }
/**
 * lvl 1 = 25% of pixels (one per 2x2), 2 = 50% checker, 3 = every pixel: the ordered-dither ease of the dim.
 * lvl 4 (day / dusk only) = every pixel one step and a 50% checker of them a second step.
 */
function dimPlayfield(ctx: Ctx, lvl = 3, night = false) {
  const x = PF_X + 1, w = PF_W - 2;
  let img: ImageData; try { img = ctx.getImageData(x, 0, w, H); } catch { return; }
  const mk = night ? 'n' : 'd';
  let map = maps[mk];
  if (!map) { map = maps[mk] = new Map(); for (let i = 0; i < 32; i++) { map.set(packed(i), dimTarget(i, night)); if (HALF.has(KEYS[i])) halfSrc.add(packed(i)); } }
  const d = new Uint32Array(img.data.buffer);
  for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < w; xx++) {
    const X = x + xx;
    if (lvl === 4 && !((X + yy) & 1)) {      // the extra step: these pixels drop two steps (grass keeps one)
      const v0 = d[yy * w + xx]; const o1 = map.get(v0);
      if (o1 !== undefined && !halfSrc.has(v0)) { const o2 = map.get(o1); d[yy * w + xx] = o2 ?? o1; continue; }
    }
    if (lvl === 1 ? ((X & 1) | (yy & 1)) !== 0 : lvl === 2 ? ((X + yy) & 1) !== 0 : false) continue;
    const i = yy * w + xx; const v = d[i];
    if (((X + yy) & 1) && halfSrc.has(v)) continue;
    let o = map.get(v);
    if (o === undefined) {
      const r = v & 255, g = (v >> 8) & 255, b = (v >> 16) & 255;
      let best = 0, bd = 1e9;
      RGB.forEach(([pr, pg, pb], k) => { const dd = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2; if (dd < bd) { bd = dd; best = k; } });
      o = dimTarget(best, night);
      if (map.size < 8192) { map.set(v, o); if (HALF.has(KEYS[best])) halfSrc.add(v); }
      if (HALF.has(KEYS[best]) && ((X + yy) & 1)) continue;
    }
    d[i] = o;
  }
  ctx.putImageData(img, x, 0);
}

export const makeMemories = (): Module => new Memories();
