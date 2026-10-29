import type { Game, Module, Renderer } from '../core/game';
import { PF_X, PF_W, W, H, WORLD_W } from '../core/game';
import type { MemoryDef } from '../core/types';
import { col } from '../core/palette';
import { pxSpark } from '../core/pixel';
import { spriteRows } from '../art/sprite';
import { text, textWidth, wrap } from '../art/font';
import { polaroid, halfPolaroid, tinyPolaroid, carriedPolaroid, fallingPolaroid, dropHalo, dropWidth, DROP_W, carrierRim, carrierCrown, heartPin, groundShadow, spriteChin, spriteHeadTop, whiteSilhouette, recoveredStamp } from './art';
import { memdrop, memfound } from './sound';

type Ctx = CanvasRenderingContext2D;

/** A polaroid let loose by its cat, drifting down to Pom. */
interface Drop { id: string; x: number; y: number; vx: number; vy: number; t: number; lost: boolean; swoop: boolean; more: string[] }
/** The reveal card queued after a pickup. */
interface Reveal { id: string; t: number; lost: boolean; n: number; hold: number; ids: string[]; base: number }
/** one bundle page (or the single card): photo index, start tick, develop 0..1, and whether it is the '+N MORE' page */
interface Page { i: number; at: number; dev: number; summary: boolean; pages: number; cur: number }
/** the '+1 MEMORY' cue left at the pickup point (world coords) */
interface Cue { x: number; y: number; t: number; label: string; lost: boolean }
/** the carrier's boop moment: a white silhouette flash + star burst */
interface Burst { x: number; y: number; t: number; rows: string[] | null; ck: string; up: boolean; stopped: boolean }
interface Mote { x: number; y: number; t: number; life: number; k: string }
interface Carry { id: string; lost: boolean }
/** What this wave's glowing cat carries: one photo, plus (in the final sector) any lost ones bundled with it. */
export interface Pending extends Carry { more: Carry[] }

/**
 * The reveal card lives OUTSIDE the playfield: it slides in over the right HUD panel (below the RESCUED row, so
 * the album counter it files into stays in view), holds while the photo develops, then the polaroid lifts out and
 * flies, shrinking in exact steps (full, half, thumbnail), into the album counter, and the card slides away.
 * Play never stops for it: nothing on the field is covered. On the field itself the catch only leaves a small
 * sparkle and a rising '+1 MEMORY'. Timing in ticks:
 */
const IN = 14, HOLD = 176, HOLD_QUEUED = 120, FILE = 26, OUT = 12;
/**
 * A bundle (2+ photos on one card) pages through its photos by itself, slowly enough to read: the first page, then
 * each further one. Past four photos it shows the first three and then one '+N MORE PHOTOS' page (the journal has
 * them all), so even the 17-photo final-sector backlog stays on the panel for under 8 s.
 */
const PAGE0 = 120, PAGE = 110, SUMMARY = 84, SHOW_ALL = 4, SHOW_MAX = 3;
/** after the card leaves, the newly lit MEMORIES boxes in SECTOR GOALS pulse for this long */
const GOAL_PULSE = 40;
/** hit-stop on the carrier boop (ticks) and the white flash inside it */
const STOP = 4;
/** the photo develops over this many ticks (a bundle page develops faster) */
const DEV = 34, DEV_PAGE = 16;
/** the polaroid pops up out of the cat, hangs for a beat, then drifts */
const POP = 40;
/** right HUD panel: the card is 120 wide at x RX+4; tall layout y 119..289, compact (touch deck below) y 119..230 */
const RX = PF_X + PF_W;
const CARD_X = RX + 4, CARD_W = 120, CARD_Y = 119, CARD_H = 170, CARD_H_TOUCH = 111;
/** polaroid slot inside the card (64x62) */
const SLOT_DX = 28, SLOT_DY = 19;
/** where the album counter's polaroid icon sits in the panel (the RESCUED row): the photo files into it */
const ALBUM_X = RX + 75, ALBUM_Y = 107;
/** ui's album counter text (RESCUED row) and the clear box behind it, which memories repaints with the shown count */
const ALBUM_TX = RX + 86, ALBUM_TY = 103;
/** ui's SECTOR GOALS block (x1, y 230, w 108): its MEMORIES row of polaroid boxes */
const GOALS_X = RX + 10, GOALS_W = 108, GOALS_ROW = 246;
/** the playfield cue at the catch point */
const CUE_LIFE = 48;
/** kept for the calm() API (other modules may still ask whether this is a fair moment for an interruption) */
const WAVE_GRACE = 90;
const BOSS_BUSY = new Set(['enter', 'tell', 'attack', 'phase']);

/**
 * Memories: polaroids of Pom's human Maya. In the wave content/memories.json names, one cat glows gold and
 * carries a little polaroid in its mouth; booping it pops the photo free (shutter click + music box) and it
 * drifts, flipping like a leaf, down to Pom (it homes in gently and can never be lost). Catching it develops
 * the photo on a memory card that slides over the right HUD panel while play goes on.
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
  /** '+1 MEMORY' cues at pickup points (world coords) */
  cues: Cue[] = [];
  t = 0;
  /** draw the card after ui's HUD (ui is 0) and under save's indicator (100) */
  overlayZ = 50;
  /** Always false now: memories never holds g.paused (the old cozy freeze is gone). Kept for old readers. */
  holding = false;
  /** SECTOR GOALS pulse on the MEMORIES boxes this card just filled (drawn once the card has slid away) */
  goalPulse: { t: number; ids: string[] } | null = null;
  /** a showcase stage froze the scene on its key frame */
  private stageFrozen = false;
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
   * two cards queue normally; past that the waiting cards collapse into one bundle card that pages through
   * its photos by itself, so a backlog never keeps the panel busy for long.
   */
  collectMany(ids: string[], at?: { x: number; y: number }) {
    const g = this.g;
    for (const d of this.drops) d.more = (d.more ?? []).filter(x => !ids.includes(x));
    this.drops = this.drops.filter(d => !ids.includes(d.id));
    const fresh = ids.filter((id, i) => ids.indexOf(id) === i && g.content.memories.some(m => m.id === id) && !g.state.memories.includes(id));
    if (!fresh.length) return;
    const base = g.state.memories.length; const anyLost = fresh.some(id => this.lostIds.has(id));
    fresh.forEach((id, i) => this.reveals.push({ id, t: 0, lost: this.lostIds.has(id), n: base + i + 1, hold: HOLD, ids: [id], base: base + i }));
    if (this.reveals.length > 2) {
      const from = this.reveals[0].t > 0 ? 1 : 0;
      const rest = this.reveals.splice(from); const all = rest.flatMap(r => r.ids);
      this.reveals.push({ id: all[all.length - 1], t: 0, lost: rest.some(r => r.lost), n: base + fresh.length, hold: bundleHold(all.length), ids: all, base: base + fresh.length - all.length });
    }
    for (const r of this.reveals.slice(0, -1)) if (r.ids.length === 1) r.hold = Math.min(r.hold, HOLD_QUEUED);   // a queue of cards moves along faster
    for (const id of fresh) g.ops.addMemory(id);
    // a recovered photo gets its own warmer chime; a fresh one the usual memory sting
    if (!(anyLost && memfound(g, fresh.length))) g.mods.audio?.sfx('memory');
    // the only thing the catch leaves on the field: a sparkle and a little rising '+1 MEMORY' at the pickup point
    if (at && (g.state.scene === 'play' || g.state.scene === 'bonus')) {
      g.mods.effects?.burst(at.x, at.y, 'sparkle');
      this.cues.push({ x: at.x, y: at.y, t: 0, label: fresh.length > 1 ? `+${fresh.length} MEMORIES` : '+1 MEMORY', lost: anyLost });
    }
  }
  /**
   * Was: true while a card covered the playfield (ui holds toasts for it). The card now lives on the side panel and
   * covers nothing, so there is never anything to wait for. Kept for the API; see panelCard().
   */
  revealing() { return false; }
  /** Was: a card is on the playfield. Never any more (see panelCard()). */
  showing() { return false; }
  /** True while the memory card is on the right HUD panel (or waiting to slide in after a menu / dialogue). */
  panelCard() { return this.reveals.length > 0; }
  /** The cozy freeze is gone: memories never holds the game. Kept so no caller ever sees a stale freeze. */
  frozen() { return false; }
  /**
   * The album count as it should read right now: photos still on their way into the album (developing on the card,
   * or mid-flight) are not counted until their thumbnail lands, so the RESCUED counter ticks up with the flash.
   * ui can draw this instead of `state.memories.length`; until it does, memories repaints the counter itself.
   */
  albumShown(g: Game = this.g): number {
    const reduce = !!g.state.settings.reduceMotion;
    let away = 0;
    for (const r of this.reveals) if (r.t < IN + r.hold + (reduce ? 0 : FILE)) away += r.ids.length;
    return Math.max(0, g.state.memories.length - away);
  }
  /**
   * Is this a fair moment for an interruption? Not over a sector title card, while a wave is still flying in, or
   * during a boss entrance / telegraph / attack / phase change. (The side-panel card no longer needs to wait.)
   */
  calm(g: Game = this.g): boolean {
    if (g.state.scene !== 'play') return true;
    if ((g.mods.world?.titleCard ?? 0) > 0) return false;
    if (g.tick - this.waveAt < WAVE_GRACE) return false;
    const b = g.mods.interaction?.boss;
    return !(b && BOSS_BUSY.has(b.st));
  }
  /**
   * Stage a moment for screenshots and freeze it there: carrier | drop | boop | reveal | lost | bundle | file, for
   * memory #index, `at` ticks into the moment (defaults: carrier 40, drop 88, reveal/lost 80 = photo developed,
   * bundle 80 = first page developed, file = the polaroid mid-flight into the album).
   */
  stage(kind: string, index = 0, at = -1) {
    const g = this.g; const m = g.content.memories[index] ?? g.content.memories[0]; if (!m) return;
    g.mods.ui?.muteToasts?.(true);
    this.removeMemoryPickups();
    this.drops = []; this.reveals = []; this.motes = []; this.rings = []; this.cues = []; this.goalPulse = null;
    const run = (n: number) => { for (let i = 0; i < n; i++) { this.sim(g); this.stepReveal(g, true); } };
    if (kind === 'drop') {
      this.pending = null; this.clearGlow();
      this.spawnDrop(m.id, 224, 120, false, 0, false); run(at >= 0 ? at : 88);
    } else if (kind === 'reveal' || kind === 'lost' || kind === 'file') {
      this.pending = null; this.clearGlow();
      g.state.memories = g.state.memories.filter(x => x !== m.id);
      if (kind === 'lost') this.lostIds.add(m.id); else this.lostIds.delete(m.id);
      const P = g.mods.player;
      this.collectMany([m.id], P ? { x: P.x, y: P.y - 4 } : undefined);
      const r0 = this.reveals[0]; if (r0) r0.n = Math.max(r0.n, index + 1);   // a plausible album count for memory #N
      run(at >= 0 ? at : kind === 'file' ? IN + HOLD + 14 : 80);
    } else if (kind === 'bundle') {     // the final-sector backlog: 5 lost photos caught at once
      this.pending = null; this.clearGlow();
      const ids = g.content.memories.slice(index, index + 5).map(x => x.id);
      g.state.memories = g.state.memories.filter(x => !ids.includes(x));
      for (const id of ids) this.lostIds.add(id);
      const P = g.mods.player;
      this.collectMany(ids, P ? { x: P.x, y: P.y - 4 } : undefined); run(at >= 0 ? at : 80);
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
    this.stageFrozen = true; g.paused = true;
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

  update(g: Game) {
    if (this.stageFrozen) return;
    this.stepReveal(g, false);
    if (!g.paused) this.sim(g);
  }

  /**
   * Advance the front card. Play goes on underneath (the card is on the HUD panel). It parks while a menu is open
   * or outside play / bonus (dialogue, map...), and is hidden then; it resumes where it was afterwards.
   */
  private stepReveal(g: Game, staged: boolean) {
    const sc = g.state.scene; const r = this.reveals[0];
    if ((!r && !this.goalPulse) || (sc !== 'play' && sc !== 'bonus')) return;
    if (!staged && (g.paused || (g.mods.ui?.menuOpen ?? 'none') !== 'none')) return;
    if (this.goalPulse && ++this.goalPulse.t >= GOAL_PULSE) this.goalPulse = null;
    if (!r) return;
    if (++r.t >= IN + r.hold + FILE + OUT) {
      this.reveals.shift();
      // the sector checklist was under the card the whole time: light its new MEMORIES boxes up now
      const here = new Set(this.placed(g.state.areaId).map(m => m.id));
      const ids = r.ids.filter(id => here.has(id));
      if (ids.length) this.goalPulse = { t: 0, ids };
    }
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
    for (const c of this.cues) c.t++;
    this.cues = this.cues.filter(c => c.t < CUE_LIFE);
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
        if (dist < 16) { this.collectMany([d.id, ...(d.more ?? [])], { x: d.x, y: d.y }); continue; }
      } else d.y += 0.4;
      // a short sparkle trail: one mote every 4 ticks, alternating sides
      if (d.t % 4 === 0) { const s = (d.t >> 2) & 1 ? 1 : -1; this.motes.push({ x: d.x + s * (3 + ((d.t >> 3) % 3)), y: d.y - 6, t: 0, life: 18, k: s > 0 ? '6' : 'f' }); }
    }
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
      // Right after the cat (still y-sorted with its row): the 2px gold silhouette rim with white shimmer. Its inner
      // row lands exactly on the light dusk/night readability rim, replacing it with gold instead of stacking outside.
      r.push(2, y + 0.01, (ctx: Ctx) => { if (!c.flash) carrierRim(ctx, rows, ck, up, x, y, t, night); });
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
    // the catch cue: '+1 MEMORY' rises 1px every 3 ticks over the pickup point and twinkles out (no fades, no boxes)
    for (const c of this.cues) r.push(5, 2e6 + c.y, (ctx: Ctx) => {
      if (c.t > CUE_LIFE - 10 && (c.t & 2)) return;
      const w = textWidth(c.label); const x = Math.round(Math.max(2, Math.min(WORLD_W - w - 2, c.x - w / 2)));
      const y = Math.round(c.y - 22 - Math.min(10, c.t / 3));
      // a full 1px ink outline (8 neighbours), so it reads on bright day floors as well as dark grass
      for (const [ox, oy] of OUTLINE) text(ctx, c.label, x + ox, y + oy, col('0'));
      text(ctx, c.label, x, y, col(c.t < 6 ? '6' : c.lost ? 'l' : 'f'));
      if (c.t < 14) { pxSpark(ctx, x - 5, y + 2, '6', c.t < 7 ? 2 : 1); pxSpark(ctx, x + w + 5, y + 2, c.lost ? 'l' : 'f', c.t < 7 ? 1 : 2); }
    });
    for (const d of this.drops) r.push(5, 1e6 + d.y, (ctx: Ctx) => {
      const bob = d.t < POP ? 0 : Math.round(Math.sin(d.t / 11) * 1.5);
      const cy = d.y + bob; const flip = d.t >= POP / 2; const extra = d.more?.length ?? 0;
      // a crisp gold outline + sparse dither glint (teal for a recovered photo), then the card itself
      dropHalo(ctx, d.x, cy, extra ? DROP_W : dropWidth(d.t, flip), t, d.lost ? 'l' : 'f');
      fallingPolaroid(ctx, d.id, d.x, cy, d.t, flip && !extra, extra, d.lost);
      heartPin(ctx, d.x, cy - 9);
    });
  }

  // ------------------------------------------------------------------ memory card (screen space, on the right HUD panel)
  /**
   * Drawn after ui's HUD (overlayZ above ui, below save's indicator) and redrawn every frame, so the panel
   * underneath simply reappears the moment the card is gone. Hidden while any menu is open or outside play / bonus;
   * the card parks there and resumes afterwards.
   */
  overlay(g: Game, ctx: Ctx) {
    const r = this.reveals[0]; const sc = g.state.scene;
    if (sc !== 'play' && sc !== 'bonus') return;
    if ((g.mods.ui?.menuOpen ?? 'none') !== 'none') return;
    if (!r && !this.goalPulse) return;
    ctx.save(); ctx.beginPath(); ctx.rect(RX, 0, W - RX, H); ctx.clip();   // never draws into the playfield
    try {
      // the RESCUED counter reads the count that has landed so far (photos still on the card are not in yet)
      const shown = this.albumShown(g);
      if (shown !== g.state.memories.length) this.albumCount(g, ctx, shown, col('6'));
      if (r && r.t > 0) this.panelIn(g, ctx, r);
      if (this.goalPulse && !g.mods.ui?.touch?.visible?.(g)) this.goalsPulse(g, ctx, this.goalPulse);
    } finally { ctx.restore(); }
  }

  /** Repaint ui's album counter text (the box behind it is plain deep night) with `n`. */
  private albumCount(g: Game, ctx: Ctx, n: number, k: string) {
    ctx.fillStyle = col('1'); ctx.fillRect(ALBUM_TX - 1, ALBUM_TY - 1, 32, 10);
    text(ctx, `${n}/${g.content.memories.length}`, ALBUM_TX, ALBUM_TY, k);
  }

  private panelIn(g: Game, ctx: Ctx, r: Reveal) {
    const reduce = !!g.state.settings.reduceMotion;
    const end = IN + r.hold, fileEnd = end + FILE;
    const compact = !!g.mods.ui?.touch?.visible?.(g);
    const h = compact ? CARD_H_TOUCH : CARD_H;
    // slide in from the panel's outer edge with a 3px overshoot, settle, file the photo, slide back out
    let x = CARD_X;
    if (!reduce) {
      if (r.t < IN) { const e = 1 - Math.pow(1 - r.t / IN, 3); x = Math.round(W + 2 - (W + 2 - CARD_X + 3) * e); }
      else if (r.t < IN + 5) x = CARD_X - 3 + Math.round((r.t - IN) * 0.6);
      else if (r.t >= fileEnd) { const f = (r.t - fileEnd) / OUT; x = Math.round(CARD_X + (W + 2 - CARD_X) * f * f); }
    } else if (r.t >= fileEnd) x = W;   // gone (the album flash below still plays)
    const page = this.page(r);
    const m = g.content.memories.find(q => q.id === r.ids[page.i]) ?? g.content.memories.find(q => q.id === r.id);
    if (!m) return;
    const filing = r.t >= end;
    if (x < W) this.card(g, ctx, r, m, page, x, CARD_Y, h, compact, filing);
    if (filing) this.fileFlight(g, ctx, r, m.id, reduce);
  }

  /**
   * Which page is up. A single card is one page. A bundle shows up to four photos one by one; past that the first
   * three, then a '+N MORE PHOTOS' page (i = the first photo not shown, summary = true).
   */
  private page(r: Reveal): Page {
    const n = r.ids.length;
    if (n <= 1) return { i: 0, at: IN, dev: clamp01((r.t - IN + 6) / DEV), summary: false, pages: 1, cur: 0 };
    const { shown, pages } = bundlePages(n);
    const k = r.t - IN;
    const cur = k < PAGE0 ? 0 : Math.min(pages - 1, 1 + Math.floor((k - PAGE0) / PAGE));
    const at = cur === 0 ? IN : IN + PAGE0 + (cur - 1) * PAGE;
    const summary = cur >= shown;
    return { i: Math.min(n - 1, cur), at, dev: cur === 0 ? clamp01((k + 6) / DEV) : clamp01((r.t - at + 2) / DEV_PAGE), summary, pages, cur };
  }

  private card(g: Game, ctx: Ctx, r: Reveal, m: MemoryDef, page: Page, x: number, y: number, h: number, compact: boolean, filing: boolean) {
    const rect = (xx: number, yy: number, w: number, hh: number, k: string) => { ctx.fillStyle = col(k); ctx.fillRect(xx, yy, w, hh); };
    const n = r.ids.length, bundle = n > 1, w = CARD_W;
    // this page's photo: a bundle may mix fresh and recovered ones, each keeps its own trim
    const lost = bundle ? (page.summary ? r.lost : this.lostIds.has(m.id) || r.lost) : r.lost;
    const rimK = lost ? 'l' : 'f', rimK2 = lost ? 'm' : 'h', studK = lost ? 'm' : 'g';
    // frame: ink outline, two-tone rim, plum body with a darker foot bevel, corner studs
    rect(x - 1, y - 1, w + 2, h + 2, '0');
    rect(x, y, w, h, rimK); rect(x + 1, y + 1, w - 2, h - 2, rimK2);
    rect(x + 2, y + 2, w - 4, h - 4, 'v'); rect(x + 2, y + h - 4, w - 4, 2, '1');
    for (const [cx, cy] of [[x + 3, y + 3], [x + w - 5, y + 3], [x + 3, y + h - 5], [x + w - 5, y + h - 5]]) rect(cx, cy, 2, 2, studK);
    // header: kicker (three calm blinks); a bundle's pager dots sit right of it on the same row when they fit.
    // No N/18 number here: the RESCUED counter right above is the one album count.
    const head = bundle ? 'FOUND AT LAST' : lost ? 'FOUND AGAIN' : 'MEMORY FOUND';
    const hb = r.t - IN; const flash = hb >= 0 && hb < 48 && ((hb >> 3) & 1) === 1;
    text(ctx, head, x + 6, y + 5, col(flash ? '6' : rimK), { shadow: col('0') });
    if (bundle) {
      const plus = page.pages > bundlePages(n).shown; const dw = pagerWidth(page.pages, plus); const dx0 = x + w - 6 - dw;
      if (dx0 >= x + 6 + textWidth(head) + 4) {
        for (let i = 0; i < page.pages; i++) {
          const k = i === page.cur ? '6' : i < page.cur ? rimK : '3';
          if (plus && i === page.pages - 1) { rect(dx0 + i * 5, y + 7, 3, 1, k); rect(dx0 + i * 5 + 1, y + 6, 1, 3, k); }   // '+' for the MORE page
          else rect(dx0 + i * 5, y + 7, 2, 2, k);
        }
      }
    }
    rect(x + 6, y + 14, w - 12, 1, rimK2); for (let xx = x + 6; xx < x + w - 6; xx += 2) rect(xx, y + 15, 1, 1, '1');
    // the polaroid (64x62, taped on). A bundle shows the rest of the stack peeking out behind it.
    const px = x + SLOT_DX, py = y + SLOT_DY;
    const left = bundle && !page.summary ? n - 1 - page.i : 0;
    // a long memory gets the half polaroid (32x31) so its whole body fits (never on the compact card or a summary page)
    const tight = !compact && !page.summary && tightCard(m, h);
    const photoH = tight ? 31 : 62;
    for (const [ox, oy, k, need] of [[6, -1, '4', 2], [3, 1, '5', 1]] as [number, number, string, number][]) {
      if (left < need || filing) continue;
      if (tight) { rect(px + 16 + ox - 1, py + oy - 1, 34, photoH + 2, '0'); rect(px + 16 + ox, py + oy, 32, photoH, k); rect(px + 16 + ox + 31, py + oy, 1, photoH, '3'); continue; }
      rect(px + ox - 1, py + oy - 1, 66, 64, '0'); rect(px + ox, py + oy, 64, 62, k); rect(px + ox + 63, py + oy, 1, 62, '3');
    }
    if (filing) {
      // the photo has lifted out: four photo corners mark the empty slot, and it says where the photo went
      const sx0 = tight ? px + 16 : px, sw = tight ? 32 : 64;
      for (const [cx, cy, dx, dy] of [[sx0, py, 1, 1], [sx0 + sw - 1, py, -1, 1], [sx0, py + photoH - 1, 1, -1], [sx0 + sw - 1, py + photoH - 1, -1, -1]]) {
        rect(dx > 0 ? cx : cx - 3, cy, 4, 1, '4'); rect(cx, dy > 0 ? cy : cy - 3, 1, 4, '4');
      }
      const ly0 = tight ? py + 6 : py + 22;
      text(ctx, 'INTO THE', px + 32, ly0, col('4'), { align: 'center' });
      text(ctx, 'ALBUM!', px + 32, ly0 + 10, col(lost ? 'l' : 'f'), { align: 'center', shadow: col('0') });
    } else if (page.summary) {
      // the rest of the backlog: a fanned little stack of half-size polaroids dropping onto the slot
      const rest = r.ids.slice(page.i, page.i + 3); const k0 = r.t - page.at;
      const x0 = px + 32 - Math.round((32 + (rest.length - 1) * 24) / 2);
      rest.forEach((id, j) => {
        const fx = x0 + j * 24, fy = py + [16, 9, 18][j] - Math.max(0, 4 - (k0 - j * 4));
        if (k0 >= j * 4) halfPolaroid(ctx, id, fx, fy, this.lostIds.has(id));
      });
    } else {
      const drop = bundle && page.cur > 0 ? Math.max(0, 3 - (r.t - page.at)) : 0;   // each new page drops into place
      const blink = page.dev >= 1 && (r.t - IN) % 64 >= 56;
      if (tight) halfPolaroid(ctx, m.id, px + 16, py - drop, lost);
      else polaroid(ctx, m.id, px, py - drop, page.dev, 1, blink, lost);
      if (lost && !tight && page.dev >= 0.5) recoveredStamp(ctx, px + 5, py - drop + 50, (c, str, sx, sy) => text(c, str, sx, sy, col('n')));
    }
    // title: always the 1x font (one size on every card and page), up to two lines (compact: two, no body)
    const more = n - page.i;
    const title = page.summary ? `+${more} MORE PHOTOS` : m.title.toUpperCase();
    const body = page.summary ? `ALL ${n} ARE SAFE IN THE ALBUM. READ EVERY ONE IN THE JOURNAL.` : m.text.toUpperCase();
    const ty = y + SLOT_DY + photoH + 5;
    const tl = clampLines(wrap(title, 18), 2);
    tl.forEach((ln, i) => text(ctx, ln, x + w / 2, ty + i * 9, col('6'), { shadow: col('0'), align: 'center' }));
    if (compact) return;
    // body: the whole memory in a window down to the foot bevel. When it runs one or two lines long, the window
    // scrolls up 1px at a time once the photo has had its moment, so the last line (the payoff) is always read.
    const by = ty + tl.length * 9 + 4, bottom = y + h - 6;   // bottom: the last pixel row a glyph may use
    const room = Math.floor((bottom - by - 6) / 9) + 1;
    const lines = wrap(body, 18); const over = Math.max(0, lines.length - room) * 9;
    const sc = over ? Math.min(over, Math.max(0, Math.floor((r.t - page.at - (bundle ? 46 : 76)) / (bundle ? 2 : 3)))) : 0;
    ctx.save(); ctx.beginPath(); ctx.rect(x + 3, by - 1, w - 6, bottom - by + 2); ctx.clip();
    try { lines.forEach((ln, i) => { const ly = by + i * 9 - sc; if (ly > by - 9 && (sc ? ly <= bottom : ly + 6 <= bottom)) text(ctx, ln, x + 6, ly, col('7')); }); }
    finally { ctx.restore(); }
  }

  /**
   * The flourish: the polaroid lifts out of the card and hops into the album counter above it, stepping down in
   * exact sizes (64x62 polaroid, 32x31, then the 9x10 thumbnail) along a little arc; when it lands the counter
   * ticks up (it held the old count until now), its number flashes and the box sparkles.
   */
  private fileFlight(g: Game, ctx: Ctx, r: Reveal, id: string, reduce: boolean) {
    const end = IN + r.hold; const k = r.t - end; const f = k / FILE;
    const lost = r.lost;
    if (!reduce && f < 1) {
      const sx = CARD_X + SLOT_DX + 32, sy = CARD_Y + SLOT_DY + 31;
      const u = clamp01((f - 0.18) / 0.82); const e = u * u * (3 - 2 * u);
      const cx = Math.round(sx + (ALBUM_X - sx) * e), cy = Math.round(sy + (ALBUM_Y - sy) * e - Math.sin(Math.PI * e) * 16);
      // the lift never rises past the header's dashed rule row (CARD_Y + 16), so the kicker stays readable
      const lift = Math.min(SLOT_DY - 16, Math.round(f * 16));
      const m = g.content.memories.find(q => q.id === id); const compact = !!g.mods.ui?.touch?.visible?.(g);
      const tight = !!m && !compact && tightCard(m, CARD_H);
      if (f < 0.25) { if (tight) halfPolaroid(ctx, id, sx - 16, CARD_Y + SLOT_DY - lift, lost); else polaroid(ctx, id, sx - 32, sy - 31 - lift, 1, 1, false, lost); }
      else if (f < 0.55) halfPolaroid(ctx, id, cx - 16, cy - 15, lost);
      else tinyPolaroid(ctx, id, cx, cy);
      if (f >= 0.25 && (k & 1)) pxSpark(ctx, cx + (k & 2 ? 7 : -7), cy + 4, lost ? 'l' : 'f', 1);
      return;
    }
    // landed: the count ticks up now, the number flashes white then gold, the box outline flashes, four sparks pop
    const a = reduce ? k : k - FILE; if (a < 0 || a > 16) return;
    if (a < 12) this.albumCount(g, ctx, this.albumShown(g), col(a < 4 ? '6' : lost ? 'l' : 'f'));
    const bx = RX + 65, byy = 97, bw = 54, bh = 20;
    ctx.fillStyle = col(a < 4 ? '6' : a < 10 ? (lost ? 'l' : 'f') : (lost ? 'm' : 'g'));
    if (a < 14 || (a & 1)) { ctx.fillRect(bx, byy, bw, 1); ctx.fillRect(bx, byy + bh - 1, bw, 1); ctx.fillRect(bx, byy, 1, bh); ctx.fillRect(bx + bw - 1, byy, 1, bh); }
    const d = 7 + (a >> 1);
    if (a < 12) for (const [ox, oy] of [[-d, -3], [d, -3], [-d + 2, 5], [d - 2, 5]]) pxSpark(ctx, ALBUM_X + ox, ALBUM_Y + oy, a < 6 ? '6' : lost ? 'l' : 'f', a < 6 ? 2 : 1);
  }

  /**
   * After the card has gone, the SECTOR GOALS row it was hiding gets its moment: the MEMORIES label blinks gold and
   * each box this card just lit gets a blinking 1px frame and a spark (ui's layout: box x = right edge - 5 - (n - i) * 9 + 1).
   */
  private goalsPulse(g: Game, ctx: Ctx, p: { t: number; ids: string[] }) {
    const mems = this.placed(g.state.areaId); const n = mems.length; if (!n) return;
    const on = p.t < GOAL_PULSE - 8 || (p.t & 2) === 0; if (!on) return;
    const k = (p.t >> 3) & 1 ? 'f' : '6';
    text(ctx, 'MEMORIES', GOALS_X + 15, GOALS_ROW, col(k));
    mems.forEach((m, i) => {
      if (!p.ids.includes(m.id)) return;
      const bx = GOALS_X + GOALS_W - 5 - (n - i) * 9 + 1, by = GOALS_ROW - 1;
      ctx.fillStyle = col(k);
      ctx.fillRect(bx - 1, by - 1, 10, 1); ctx.fillRect(bx - 1, by + 9, 10, 1); ctx.fillRect(bx - 1, by - 1, 1, 11); ctx.fillRect(bx + 8, by - 1, 1, 11);   // hugs the box (its neighbour is 1px away)
      if (p.t < 16) pxSpark(ctx, bx + 4, by - 5 - (p.t >> 2), p.t < 8 ? '6' : 'f', p.t < 8 ? 2 : 1);
    });
  }
}

/** a bundle of n photos: how many get their own page, and how many pages in all (the last may be '+N MORE') */
function bundlePages(n: number) { const shown = n <= SHOW_ALL ? n : SHOW_MAX; return { shown, pages: shown + (n > shown ? 1 : 0) }; }
/** how long a bundle card holds (all its pages) */
function bundleHold(n: number) { const { shown, pages } = bundlePages(n); return PAGE0 + (shown - 1) * PAGE + (pages > shown ? SUMMARY : 0); }
/** the pager dots' width (2px dots on a 5px step; the '+' for a MORE page is 3px wide) */
function pagerWidth(pages: number, plus: boolean) { return pages * 5 - 3 + (plus ? 1 : 0); }

const OUTLINE = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1], [1, 2]];

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }

/** One line: the text if it fits, else cut at a word boundary with an ellipsis (the journal has it all). */
function oneLine(s: string, cols: number): string {
  s = s.toUpperCase(); if (s.length <= cols) return s;
  let out = '';
  for (const w of s.split(/\s+/)) { if ((out + ' ' + w).trim().length + 3 > cols) break; out = (out + ' ' + w).trim(); }
  return (out || s.slice(0, Math.max(0, cols - 3))).replace(/[,;:.]$/, '') + '...';
}

/** At most `max` wrapped lines; a cut last line ends in an ellipsis. */
/**
 * True when a single memory's body would not fit under the full 64x62 polaroid on the tall card: the card then shows
 * the 32x31 half polaroid instead, so the last body line is on screen without waiting for the scroll.
 */
function tightCard(m: MemoryDef, h: number): boolean {
  const tl = clampLines(wrap(m.title.toUpperCase(), 18), 2).length;
  const by = CARD_Y + SLOT_DY + 67 + tl * 9 + 4, bottom = CARD_Y + h - 6;
  return wrap(m.text.toUpperCase(), 18).length > Math.floor((bottom - by - 6) / 9) + 1;
}

function clampLines(lines: string[], max: number): string[] {
  if (max <= 0) return [];
  if (lines.length <= max) return lines;
  const out = lines.slice(0, max); const cols = Math.max(...lines.map(l => l.length));
  out[max - 1] = oneLine(lines.slice(max - 1).join(' '), cols);
  return out;
}


export const makeMemories = (): Module => new Memories();
