import type { Game, Module, Renderer } from '../core/game';
import { PF_X, PF_W, W, H, WORLD_W } from '../core/game';
import type { MemoryDef } from '../core/types';
import { col } from '../core/palette';
import { pxSpark } from '../core/pixel';
import { spriteRows } from '../art/sprite';
import { text, textWidth, wrap } from '../art/font';
import { halfPolaroid, midPolaroid, MID_W, MID_H, tinyPolaroid, carriedPolaroid, fallingPolaroid, dropHalo, dropWidth, DROP_W, carrierRim, carrierCrown, heartPin, groundShadow, spriteChin, spriteHeadTop, whiteSilhouette } from './art';
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
 * The reveal card lives OUTSIDE the playfield: it unrolls down ui's card slot on the right HUD panel (below the
 * RESCUED row, so the album counter it files into stays in view), holds while the photo develops, then the polaroid
 * lifts out and flies, shrinking in exact steps (mid, half, thumbnail), into the album counter, and the card rolls up.
 * Play never stops for it: nothing on the field is covered. On the field itself the catch only leaves a small
 * sparkle and a rising '+1 MEMORY'. Timing in ticks:
 */
const IN = 14, HOLD = 176, HOLD_QUEUED = 120, FILE = 26, READ = 12, OUT = 12;
/** the panel's inner columns (its 1px frame sits at PANEL_L - 1 and PANEL_R): the card never draws outside them */
const PANEL_L = 515, PANEL_R = 637;
/**
 * A bundle (2+ photos on one card) pages through its photos by itself, slowly enough to read: the first page, then
 * each further one. Past four photos it shows the first three and then one '+N MORE PHOTOS' page (the journal has
 * them all), so even the 17-photo final-sector backlog stays on the panel for under 8 s.
 */
const PAGE0 = 120, PAGE = 110, SUMMARY = 76, SHOW_ALL = 4, SHOW_MAX = 3;
/** after the card leaves, the newly lit boxes on the memory strip (y 239..256) pulse for this long */
const GOAL_PULSE = 40;
/** hit-stop on the carrier boop (ticks) and the white flash inside it */
const STOP = 4;
/** the photo develops over this many ticks (a bundle page develops faster) */
const DEV = 34, DEV_PAGE = 16;
/** the polaroid pops up out of the cat, hangs for a beat, then drifts */
const POP = 40;
/**
 * right HUD panel: the card sits at ui's card x / w (RX+5, 118 wide) and lives strictly inside ui's card slot (ui.hudSlots().card, the
 * panel foot under RESCUED) so QUEST, the threat slot, the album chip and the memory strip above it stay in view. It
 * takes whatever height ui gives that slot. Keyboard layout: kicker row, then the title (left column, top-aligned to
 * the photo, up to three lines) beside the 40x38 polaroid (a 1:1 crop of the photo, right column, so its filing route
 * rises past the kicker's right end), then the memory's text in whole-line pages that break at sentence ends.
 * Touch: the deck owns the panel foot, so the card takes ui's touch slot (hudSlots().cardTouch) or, without one, the
 * band between the threat slot (it ends by y 194 in touch) and the ACTION deck header (y 236): a 38px strip with the
 * half polaroid, the kicker and the title (the text lives in the journal). It never covers HOSTILES / CATS LEFT.
 */
const RX = PF_X + PF_W;
/** card box: ui's hudSlots().card x / w (falls back to RX+5, 118) */
let CARD_X = RX + 5, CARD_W = 118;
/** touch fallback slot (no hudSlots().cardTouch): between the threat block and the ACTION deck */
const TOUCH_Y = 197, TOUCH_H = 38;
let CARD_Y = 231, CARD_H = 125;
/** a slot lower than this gets the strip layout (half polaroid, kicker, title) */
const STRIP_BELOW = 80;
let STRIP = false;
/** the mid polaroid (40x38) in the card's right column, its top-left offset */
let POL_DX = CARD_W - 6 - MID_W;
const POL_DY = 19;
/** strip layout: the half polaroid (32x31) at the left, the words column right of it */
const SPOL_DX = 4, SPOL_DY = 3, STRIP_TX = 40;
/** title column (left of the polaroid): 11 glyphs, up to three lines; body: 18 glyphs a line from BODY_DY */
const TITLE_COLS = 11, BODY_COLS = 18, BODY_DY = POL_DY + MID_H + 4;
/** where the album counter's polaroid icon sits in the panel (the RESCUED row, just above the card): the photo files into it */
let ALBUM_X = RX + 75, ALBUM_Y = 232;
/** ui's album chip (RESCUED row): the counter text, and the chip box the landing flash may repaint (never outside it) */
let ALBUM_TX = RX + 86, ALBUM_TY = 228;
/** ui's memory strip (y 239..256, ui.hudSlots().strip): label at x+15, polaroid boxes right-aligned at row-1 */
let GOALS_X = RX + 10, GOALS_W = 108, GOALS_ROW = 259;
/** ui's strip has a 'MEMORIES' label to pulse (hudSlots().strip.label !== false) */
let GOALS_LABEL = true;
/** the filing route's top row and waypoints (rebuilt by useSlots) */
let FLY_TOP = CARD_Y - 2;
let ROUTE: [number, number, number][] = [];
let TOUCH = false;
interface Lay { touch: boolean; h: number; strip: boolean }
/** Read ui's right-panel anchors (falls back to the constants above) and lay the card out for keyboard or touch. */
function useSlots(g: Game): Lay {
  const touch = !!g.mods.ui?.touch?.visible?.(g);
  let sl: any = null; try { sl = g.mods.ui?.hudSlots?.() ?? null; } catch { sl = null; }
  const card = touch ? sl?.cardTouch : sl?.card, album = sl?.album, strip = sl?.strip;
  const fy = touch ? TOUCH_Y : 231, fh = touch ? TOUCH_H : 125;
  CARD_Y = typeof card?.y === 'number' ? card.y : fy;
  CARD_H = typeof card?.h === 'number' ? Math.max(TOUCH_H, Math.min(H - 2 - CARD_Y, card.h)) : fh;
  STRIP = CARD_H < STRIP_BELOW;
  if (album) { ALBUM_X = album.x; ALBUM_Y = album.y; ALBUM_TX = album.tx; ALBUM_TY = album.ty; }
  else { ALBUM_X = RX + 75; ALBUM_Y = 232; ALBUM_TX = RX + 86; ALBUM_TY = 228; }
  if (strip) { GOALS_X = strip.x; GOALS_W = strip.w; GOALS_ROW = strip.row; GOALS_LABEL = strip.label !== false; }
  const box = card ?? sl?.card;
  CARD_X = typeof box?.x === 'number' ? box.x : RX + 5; CARD_W = typeof box?.w === 'number' ? Math.min(124, Math.max(100, box.w)) : 118;
  POL_DX = CARD_W - 6 - MID_W; FLY_X = CARD_X + POL_DX + (MID_W >> 1);
  TOUCH = touch;
  buildRoute();
  return { touch, h: CARD_H, strip: STRIP };
}
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
  /** memory strip pulse on the boxes this card just filled (drawn once the card has slid away) */
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
    const g = this.g;
    // the showcase's --area picks that sector's memories (index counts within the sector), so per-sector checks of
    // the card are reproducible; the scene re-enters that sector at the memory's wave first
    const want = showcaseArea();
    const inArea = want ? g.content.memories.filter(q => q.area === want) : [];
    if (inArea.length) {
      const pick = inArea[Math.min(inArea.length - 1, Math.max(0, index))];
      index = g.content.memories.indexOf(pick);
      if (g.state.areaId !== want) {
        const Wd = g.mods.world;
        Wd.enterArea(want, pick.wave); if (g.mods.quest) g.mods.quest.dlg = null; g.setScene('play'); Wd.titleCard = 0;
        for (let i = 0; i < 400; i++) g.step();
      }
    }
    const m = g.content.memories[index] ?? g.content.memories[0]; if (!m) return;
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
    if (++r.t >= IN + r.hold + FILE + READ + OUT) {
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
      if (c.t < 14) { pxSpark(ctx, x - 9, y + 3, '6', c.t < 7 ? 2 : 1); pxSpark(ctx, x + w + 8, y + 3, c.lost ? 'l' : 'f', c.t < 7 ? 1 : 2); }
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
    const lay = useSlots(g);
    ctx.save(); ctx.beginPath(); ctx.rect(RX, 0, W - RX, H); ctx.clip();   // never draws into the playfield
    try {
      // ui's RESCUED chip already reads albumShown() (photos still on the card are not counted until they land), so
      // the chip is only touched by the landing flash below, inside its own box
      if (r && r.t > 0) this.panelIn(g, ctx, r, lay);
      if (this.goalPulse && !lay.touch) this.goalsPulse(g, ctx, this.goalPulse);
    } finally { ctx.restore(); }
  }

  /** Recolour ui's album counter text for the landing flash: its plain night box only, clipped to the chip's inner box. */
  private albumCount(g: Game, ctx: Ctx, n: number, k: string) {
    const s = `${n}/${g.content.memories.length}`; const w = textWidth(s) + 2;
    ctx.save(); ctx.beginPath(); ctx.rect(ALBUM_TX - 1, ALBUM_TY - 2, Math.min(w, PANEL_R - 4 - ALBUM_TX), 11); ctx.clip();
    try { ctx.fillStyle = col('1'); ctx.fillRect(ALBUM_TX - 1, ALBUM_TY - 1, w, 9); text(ctx, s, ALBUM_TX, ALBUM_TY, k); } finally { ctx.restore(); }
  }

  private panelIn(g: Game, ctx: Ctx, r: Reveal, lay: Lay) {
    const reduce = !!g.state.settings.reduceMotion;
    const end = IN + r.hold, fileEnd = end + FILE + READ;   // READ: 'INTO THE ALBUM!' gets its moment before the card goes
    const { h } = lay;
    // the card unrolls down its slot (rows revealed from the top, a rim-and-ink roller edge on the cut), holds, files
    // the photo, then rolls back up. It never moves sideways, so the panel frame stays whole and nothing peeks out.
    const full = h + 2; let vis = full;
    if (!reduce) {
      if (r.t < IN) { const e = 1 - Math.pow(1 - r.t / IN, 3); vis = Math.round(full * e); }
      else if (r.t >= fileEnd) { const f = (r.t - fileEnd) / OUT; vis = Math.round(full * (1 - f * f)); }
    } else if (r.t >= fileEnd) vis = 0;   // gone (the album flash below still plays)
    const page = this.page(r);
    const m = g.content.memories.find(q => q.id === r.ids[page.i]) ?? g.content.memories.find(q => q.id === r.id);
    if (!m) return;
    const filing = r.t >= end;
    if (vis > 0) {
      // clipped to the panel's inner columns AND the card slot's rows (its 1px ink outline included): nothing above
      // or below the slot is ever drawn over
      ctx.save(); ctx.beginPath(); ctx.rect(PANEL_L, CARD_Y - 1, PANEL_R - PANEL_L, vis); ctx.clip();
      try {
        this.card(g, ctx, r, m, page, CARD_X, CARD_Y, h, filing, lay.strip);
        if (vis < full) {
          const lost = r.lost || (r.ids.length > 1 && !page.summary && this.lostIds.has(m.id));
          ctx.fillStyle = col('0'); ctx.fillRect(CARD_X - 1, CARD_Y - 2 + vis, CARD_W + 2, 1);
          if (vis >= 2) { ctx.fillStyle = col(lost ? 'l' : 'f'); ctx.fillRect(CARD_X - 1, CARD_Y - 3 + vis, CARD_W + 2, 1); }
        }
      } finally { ctx.restore(); }
    }
    if (filing) this.fileFlight(g, ctx, r, m.id, reduce, lay.touch);
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

  private card(g: Game, ctx: Ctx, r: Reveal, m: MemoryDef, page: Page, x: number, y: number, h: number, filing: boolean, strip: boolean) {
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
    // header: kicker (three calm blinks). No N/18 number here: the RESCUED counter is the one album count.
    const head = bundle && !strip ? 'FOUND AT LAST' : lost ? 'FOUND AGAIN' : 'MEMORY FOUND';
    const hb = r.t - IN; const flash = hb >= 0 && hb < 48 && ((hb >> 3) & 1) === 1;
    const tx = strip ? x + STRIP_TX : x + 6;
    text(ctx, head, tx, y + 5, col(flash ? '6' : rimK), { shadow: col('0') });
    // pager dots (3x3, ink-rimmed) on the header row, right-aligned: a bundle's photos, or a single card's text pages
    const dots = (count: number, cur: number, plus: boolean) => {
      const dx0 = x + w - 6 - pagerWidth(count);
      if (filing || count < 2 || dx0 < tx + textWidth(head) + 3) return;   // they step aside while the photo files
      for (let i = 0; i < count; i++) {
        const k = i === cur ? '6' : i < cur ? rimK : '4'; const dx = dx0 + i * 5;
        if (plus && i === count - 1) { rect(dx - 1, y + 7, 5, 3, '0'); rect(dx + 1, y + 6, 1, 5, '0'); rect(dx, y + 8, 3, 1, k); rect(dx + 1, y + 7, 1, 3, k); }   // '+' for the MORE page
        else { rect(dx - 1, y + 6, 5, 5, '0'); rect(dx, y + 7, 3, 3, k); }
      }
    };
    if (bundle && !strip) dots(page.pages, page.cur, page.pages > bundlePages(n).shown);
    if (strip) { rect(tx, y + 13, x + w - 6 - tx, 1, rimK2); }
    else { rect(x + 6, y + 14, w - 12, 1, rimK2); for (let xx = x + 6; xx < x + w - 6; xx += 2) rect(xx, y + 15, 1, 1, '1'); }
    // the polaroid: the mid one (40x38, a 1:1 crop of the photo) in the right column, or the half one at the strip's
    // left. A bundle shows the rest of the stack peeking out behind it.
    const pw = strip ? 32 : MID_W, ph = strip ? 31 : MID_H;
    const px = x + (strip ? SPOL_DX : POL_DX), py = y + (strip ? SPOL_DY : POL_DY);
    const left = bundle && !page.summary ? n - 1 - page.i : 0;
    for (const [ox, oy, k, need] of [[-4, -2, '4', 2], [-2, 0, '5', 1]] as [number, number, string, number][]) {
      if (left < need || filing || strip) continue;
      rect(px + ox - 1, py + oy - 1, pw + 2, ph + 2, '0'); rect(px + ox, py + oy, pw, ph, k); rect(px + ox, py + oy + ph - 1, pw, 1, '3');
    }
    const pol = (id: string, xx: number, yy: number, lo: boolean, dev = 1) => strip ? halfPolaroid(ctx, id, xx, yy, lo, dev, true) : midPolaroid(ctx, id, xx, yy, lo, dev);
    if (filing) {
      // the photo has lifted out: four photo corners mark the empty slot
      for (const [cx, cy, dx, dy] of [[px, py, 1, 1], [px + pw - 1, py, -1, 1], [px, py + ph - 1, 1, -1], [px + pw - 1, py + ph - 1, -1, -1]]) {
        rect(dx > 0 ? cx : cx - 3, cy, 4, 1, '4'); rect(cx, dy > 0 ? cy : cy - 3, 1, 4, '4');
      }
    } else if (page.summary) {
      // the rest of the backlog: a fanned little stack of polaroids dropping onto the slot, one after another
      const rest = r.ids.slice(page.i, page.i + 3); const k0 = r.t - page.at;
      rest.forEach((id, j) => {
        const fx = px - 4 + j * 2, fy = py - 2 + j * 2 - Math.max(0, 4 - (k0 - j * 4));
        if (k0 >= j * 4) pol(id, fx, fy, this.lostIds.has(id));
      });
    } else {
      const drop = bundle && page.cur > 0 ? Math.max(0, 3 - (r.t - page.at)) : 0;   // each new page drops into place
      pol(m.id, px, py - drop, lost, page.dev);
    }
    const more = n - page.i;
    const title = page.summary ? `+${more} MORE PHOTOS` : m.title.toUpperCase();
    if (strip) {
      // strip: the title under the kicker (two lines), or the album line while the photo files
      if (filing) {
        const s = r.t - (IN + r.hold);
        if (s >= 0) text(ctx, 'INTO THE', tx, y + 16, col(['2', '3', '4'][Math.min(2, s >> 1)]));
        if (s >= 2) { const st = Math.min(2, (s - 2) >> 1); text(ctx, 'ALBUM!', tx, y + 25, col((lost ? ['n', 'm', 'l'] : ['a', 'h', 'f'])[st]), st >= 2 ? { shadow: col('0') } : {}); }
        return;
      }
      clampLines(wrap(title, Math.floor((x + w - 6 - tx + 1) / 6)), 2).forEach((ln, i) => text(ctx, ln, tx, y + 16 + i * 9, col('6'), { shadow: col('0') }));
      return;
    }
    // title: the 1x font in the left column, top-aligned with the photo (up to three lines)
    const tl = clampLines(wrap(title, TITLE_COLS), 3);
    tl.forEach((ln, i) => text(ctx, ln, x + 6, py + 2 + i * 9, col('6'), { shadow: col('0') }));
    // body window: whole lines from BODY_DY down to the foot bevel
    const by = y + BODY_DY, bottom = y + h - 7;   // bottom: the last pixel row a glyph may use
    const room = Math.max(1, Math.floor((bottom - by - 6) / 9) + 1);
    if (filing) {
      // where the photo went: both lines come up together through a 3-step palette ramp (dark, mid, full), the
      // second a beat behind the first. The flight stays in the right column above, so it never crosses them.
      const a = 'INTO THE', b = 'ALBUM!';
      const s = r.t - (IN + r.hold);
      const ramp = (step: number, full: string[]) => full[Math.min(full.length - 1, step)];
      const ly0 = by + Math.max(0, ((room - 2) * 9) >> 1);
      if (s >= 0) text(ctx, a, x + w / 2, ly0, col(ramp(s >> 1, ['2', '3', '4'])), { align: 'center' });
      if (s >= 2) {
        const st = (s - 2) >> 1, gold = lost ? ['n', 'm', 'l'] : ['a', 'h', 'f'];
        text(ctx, b, x + w / 2, ly0 + 10, col(ramp(st, gold)), st >= 2 ? { shadow: col('0'), align: 'center' } : { align: 'center' });
      }
      return;
    }
    const body = page.summary ? `ALL ${n} ARE SAFE IN THE ALBUM. READ EVERY ONE IN THE JOURNAL.` : m.text.toUpperCase();
    // a body longer than the window pages by whole lines (never a half-cut glyph), breaking at sentence ends where it
    // can; its pages share the time this card (or bundle page) is up, each in proportion to its lines
    const pages = bodyPages(body, BODY_COLS, room);
    const total = pages.reduce((a, p) => a + p.length, 0);
    const dur = bundle ? (page.summary ? SUMMARY : page.cur === 0 ? PAGE0 : PAGE) : r.hold;
    let bp = 0;
    if (pages.length > 1) {
      const el = (r.t - page.at) / Math.max(1, dur) * total;
      let acc = pages[0].length; while (bp < pages.length - 1 && el >= acc) { bp++; acc += pages[bp].length; }
    }
    pages[bp].forEach((ln, i) => text(ctx, ln, x + 6, by + i * 9, col('7')));
    if (!bundle) dots(pages.length, bp, false);
    if (bp < pages.length - 1) {
      // 'more follows': a steady gold chevron in a notch on the card's foot (below the last text row), bobbing 1px
      const cx = x + w / 2, cy = y + h - 4 + ((r.t >> 4) & 1);
      rect(cx - 4, y + h - 5, 9, 5, '0');
      rect(cx - 3, cy - 1, 7, 1, rimK); rect(cx - 2, cy, 5, 1, rimK); rect(cx - 1, cy + 1, 3, 1, rimK); rect(cx, cy + 2, 1, 1, rimK);
    }
  }

  /**
   * The flourish: the polaroid lifts out of the card and hops into the album counter above it, stepping down in
   * exact sizes (64x62 polaroid, 32x31, then the 9x10 thumbnail) along a little arc; when it lands the counter
   * ticks up (it held the old count until now), its number flashes and the box sparkles.
   */
  private fileFlight(g: Game, ctx: Ctx, r: Reveal, id: string, reduce: boolean, touch: boolean) {
    const end = IN + r.hold; const k = r.t - end; const f = k / FILE;
    const lost = r.lost;
    if (!reduce && f < 1) {
      const sp = flightSprite(f);
      if (sp.kind === 'mid') midPolaroid(ctx, id, sp.x, sp.y, lost);
      else if (sp.kind === 'half') halfPolaroid(ctx, id, sp.x, sp.y, lost, 1, STRIP);
      else tinyPolaroid(ctx, id, sp.x, sp.y);
      // a little sparkle trail once it is on its way (on the plum card or the panel, never over a word: the sparks
      // sit beside the sprite on the side it came from)
      if (f >= HALF_F && (k & 1)) { const { cx, cy } = flightAt(f); pxSpark(ctx, cx + (k & 2 ? 7 : -7), cy + 4, lost ? 'l' : 'f', 1); }
      return;
    }
    // landed: the count ticks up now, the number flashes white then gold, the box outline flashes, four sparks pop
    const a = reduce ? k : k - FILE; if (a < 0 || a > 16 || touch) return;
    if (a < 12) this.albumCount(g, ctx, this.albumShown(g), col(a < 4 ? '6' : lost ? 'l' : 'f'));
    const bx = ALBUM_X - 10, byy = ALBUM_Y - 10, bw = 54, bh = 20;
    ctx.fillStyle = col(a < 4 ? '6' : a < 10 ? (lost ? 'l' : 'f') : (lost ? 'm' : 'g'));
    if (a < 14 || (a & 1)) { ctx.fillRect(bx, byy, bw, 1); ctx.fillRect(bx, byy + bh - 1, bw, 1); ctx.fillRect(bx, byy, 1, bh); ctx.fillRect(bx + bw - 1, byy, 1, bh); }
    const d = 7 + (a >> 1);
    if (a < 12) for (const [ox, oy] of [[-d, -3], [d, -3], [-d + 2, 5], [d - 2, 5]]) pxSpark(ctx, ALBUM_X + ox, ALBUM_Y + oy, a < 6 ? '6' : lost ? 'l' : 'f', a < 6 ? 2 : 1);
  }

  /**
   * After the card has gone, the memory strip row (y 239..256) it was hiding gets its moment: the MEMORIES label blinks gold and
   * each box this card just lit gets a blinking 1px frame and a spark (ui's layout: box x = right edge - 5 - (n - i) * 9 + 1).
   */
  private goalsPulse(g: Game, ctx: Ctx, p: { t: number; ids: string[] }) {
    const mems = this.placed(g.state.areaId); const n = mems.length; if (!n) return;
    const on = p.t < GOAL_PULSE - 8 || (p.t & 2) === 0; if (!on) return;
    const k = (p.t >> 3) & 1 ? 'f' : '6';
    if (GOALS_LABEL) text(ctx, 'MEMORIES', GOALS_X + 15, GOALS_ROW, col(k));
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
/**
 * The filing route (screen coords, sprite centres). It never crosses a word: the polaroid lifts in its slot (right
 * column), steps down to the half one and then the thumbnail there, rises past the header to the RIGHT of the kicker,
 * tucks along the gap between the card top and the counter row, and pops up into the album icon. In touch there is no
 * album chip: a tall touch card rises to its own top-right corner, the strip card shrinks the photo away in its slot.
 * Waypoints after the slot centre, with the eased fraction each one is reached.
 */
let FLY_X = CARD_X + POL_DX + (MID_W >> 1);
/** the photo's slot centre and how far it may lift before it travels (never past the header rule) */
function slot() {
  return STRIP ? { sx: CARD_X + SPOL_DX + 16, sy: CARD_Y + SPOL_DY + 15, lift: 0 }
    : { sx: FLY_X, sy: CARD_Y + POL_DY + (MID_H >> 1), lift: POL_DY - 17 };
}
function buildRoute() {
  if (STRIP) { const { sx, sy } = slot(); FLY_TOP = sy; ROUTE = [[sx, sy, 1]]; return; }
  if (TOUCH) { FLY_TOP = CARD_Y + 8; ROUTE = [[FLY_X, CARD_Y + 22, 0.4], [FLY_X + 4, FLY_TOP, 1]]; return; }
  FLY_TOP = CARD_Y - 2;
  ROUTE = [[FLY_X, CARD_Y + 22, 0.36], [FLY_X, FLY_TOP, 0.62], [ALBUM_X + 7, FLY_TOP, 0.8], [ALBUM_X, ALBUM_Y, 1]];
}
buildRoute();
/** the photo stays its slot size and only lifts while f < LIFT_F; half until HALF_F; then the thumbnail */
const LIFT_F = 0.2, HALF_F = 0.42;
/** where the filing photo is at flight fraction f (its centre) */
function flightAt(f: number) {
  const { sx, sy, lift: lmax } = slot();
  const lift = Math.min(lmax, Math.round(f * 10));
  const u = clamp01((f - LIFT_F) / (1 - LIFT_F)); const e = u * u * (3 - 2 * u);
  let px = sx, py = sy - lmax, pe = 0, cx = px, cy = py;
  for (const [wx, wy, we] of ROUTE) {
    if (e <= we) { const t = (e - pe) / (we - pe || 1); cx = px + (wx - px) * t; cy = py + (wy - py) * t; break; }
    px = wx; py = wy; pe = we; cx = wx; cy = wy;
  }
  if (f < LIFT_F) { cx = sx; cy = sy - lift; }
  return { cx: Math.round(cx), cy: Math.round(cy) };
}
/** the flying sprite at flight fraction f: which size, and its top-left */
function flightSprite(f: number): { kind: 'mid' | 'half' | 'tiny'; x: number; y: number } {
  const { cx, cy } = flightAt(f);
  if (f < LIFT_F && !STRIP) return { kind: 'mid', x: cx - (MID_W >> 1), y: cy - (MID_H >> 1) };
  if (f < HALF_F) return { kind: 'half', x: cx - 16, y: cy - 15 };
  return { kind: 'tiny', x: cx, y: cy };
}
/**
 * Page a memory's text for a window of `room` lines: whole sentences per page where they fit (a page never ends on
 * half a sentence when the next sentence would start a fresh page anyway); a sentence longer than a page is cut by
 * whole lines, and its tail starts the next page.
 */
export function bodyPages(body: string, cols: number, room: number): string[][] {
  const sents = body.match(/[^.!?]+[.!?]+["')]*\s*|[^.!?]+$/g)?.map(x => x.trim()).filter(Boolean) ?? [body];
  const pages: string[][] = []; let cur = '';
  for (const sn of sents) {
    const join = cur ? `${cur} ${sn}` : sn;
    if (wrap(join, cols).length <= room) { cur = join; continue; }
    if (cur) { pages.push(wrap(cur, cols)); cur = ''; }
    let ls = wrap(sn, cols);
    while (ls.length > room) { pages.push(ls.slice(0, room)); ls = wrap(ls.slice(room).join(' '), cols); }
    cur = ls.join(' ');
  }
  if (cur) pages.push(wrap(cur, cols));
  return pages.length ? pages : [[]];
}
/** the pager dots' width (3px dots, and the 3px '+' for a MORE page, on a 5px step) */
function pagerWidth(pages: number) { return pages * 5 - 2; }

const OUTLINE = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1], [1, 2]];

/** ?showcase=memories&area=<id>: the sector the memories showcase was asked for (null anywhere else) */
function showcaseArea(): string | null {
  try {
    if (typeof location === 'undefined') return null;
    const q = new URLSearchParams(location.search);
    return q.get('showcase') === 'memories' ? q.get('area') : null;
  } catch { return null; }
}

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }

/** One line: the text if it fits, else cut at a word boundary with an ellipsis (the journal has it all). */
function oneLine(s: string, cols: number): string {
  s = s.toUpperCase(); if (s.length <= cols) return s;
  let out = '';
  for (const w of s.split(/\s+/)) { if ((out + ' ' + w).trim().length + 3 > cols) break; out = (out + ' ' + w).trim(); }
  return (out || s.slice(0, Math.max(0, cols - 3))).replace(/[,;:.]$/, '') + '...';
}

/** At most `max` wrapped lines; a cut last line ends in an ellipsis. */
function clampLines(lines: string[], max: number): string[] {
  if (max <= 0) return [];
  if (lines.length <= max) return lines;
  const out = lines.slice(0, max); const cols = Math.max(...lines.map(l => l.length));
  out[max - 1] = oneLine(lines.slice(max - 1).join(' '), cols);
  return out;
}


export const makeMemories = (): Module => new Memories();
