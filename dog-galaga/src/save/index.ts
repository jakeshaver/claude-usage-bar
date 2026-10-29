import type { Game, Module } from '../core/game';
import { W, H, PF_X, PF_W } from '../core/game';
import { sanitizeState, STATE_VERSION } from '../core/state';
import { decodeEnvelope, encodeEnvelope, fromExportString, toExportString, type Decoded } from './codec';
import { SafeStore, browserStorage, memStorage, type FallbackReason, type Storage } from './storage';
import { drawIndicator, indicatorVisible, IND_FRAMES, IND_W, IND_H } from './indicator';
import { text, textWidth } from '../art/font';
import { col } from '../core/palette';
import { drawRecoveryCard } from './recovery';

export { drawFloppy, FLOPPY, FLOPPY7, FLOPPY_W, FLOPPY_H } from './indicator';
export type { FloppyOpts } from './indicator';
export { drawRecoveryCard, drawChewMedallion } from './recovery';

export { checksum, migrate, MIGRATIONS } from './codec';
export { memStorage, SafeStore } from './storage';
export type { Storage } from './storage';

export const KEYS = {
  MAIN: 'poodle-patrol:save',
  BACKUP: 'poodle-patrol:backup',
  /** settings saved before any game exists (title screen) */
  SETTINGS: 'poodle-patrol:settings',
  /** raw copy of an unreadable save, kept so "start fresh" never destroys the only copy */
  QUARANTINE: 'poodle-patrol:quarantine',
  /** original of a save written by a newer build, kept before we overwrite it */
  FUTURE: 'poodle-patrol:future',
  /** keepsakes that outlive any save: high score and settings (a corrupt save or START FRESH never resets them) */
  KEEP: 'poodle-patrol:keep',
} as const;
const { MAIN, BACKUP, SETTINGS, QUARANTINE, FUTURE, KEEP } = KEYS;
const CARRY = [MAIN, BACKUP, SETTINGS, KEEP], SPARE = [QUARANTINE, FUTURE, BACKUP];

/** Write throttle: a burst of up to BURST writes is immediate, then one per REFILL frames (~1 s). */
export const BURST = 4, REFILL = 60;

export type LoadStatus = 'ok' | 'recovered' | 'corrupt' | 'none';
/** the two save slots load() can start from (ARCHITECTURE.md: `load(slot)`) */
export type Slot = 'main' | 'backup';
const NO_WRITE_SCENES = new Set(['boot', 'recovery']);
/** short enough for one toast line (<= 26 chars, ~155px) */
export const FALLBACK_TOAST: Record<FallbackReason, string> = {
  blocked: 'SAVING FOR THIS VISIT ONLY',
  full: 'NO ROOM: SAVING THIS VISIT',
};
export const CODE_TOAST = {
  copied: 'SAVE CODE COPIED', none: 'NO SAVE TO COPY YET', loaded: 'SAVE CODE LOADED', bad: 'THAT CODE LOOKS CHEWED',
} as const;
/** frames between two save notices, so they never stack with each other */
const NOTICE_GAP = 120;
/** scenes where a save notice may appear (never over dialogue, the recovery screen or boot) */
const NOTICE_SCENES = new Set(['play', 'bonus', 'title', 'map']);

/**
 * Where the autosave floppy sits, on the HUD's inner grid. In play the right panel's text column runs
 * x = PF_X+PF_W+10 .. +118; the floppy is right-aligned to that column's edge.
 * - keyboard / gamepad: right of the HUD footer row (DAY + flight clock end at x RX+98), bottom 6px above the panel's inner frame
 * - touch deck visible: docked on the ACTION header's rule, at its right end (where the rule's end tick is),
 *   with a tiny SAVED / IN RAM caption on the rule, so it reads as part of that panel and not a stray icon
 *   (the clock block is hidden there, and the bottom-right corner belongs to the TOOT button)
 * - full-screen scenes (title, map): bottom-right, 8px in from the screen edge
 */
const PLAY_SCENES = new Set(['play', 'bonus', 'dialogue']);
export function indicatorPos(scene: string, touch: boolean): { x: number; y: number } {
  const colRight = PF_X + PF_W + 118;
  if (PLAY_SCENES.has(scene)) {
    // touch: centred on the ACTION header rule (TOUCH_TOP 236 + 2 + 3 = y 241), below the deck divider (y 232)
    return touch ? { x: colRight - IND_W, y: 234 } : { x: colRight - IND_W, y: H - 10 - IND_H };
  }
  return { x: W - 8 - IND_W, y: H - 8 - IND_H };
}
export const FUTURE_TOAST = 'SAVE FROM A NEWER BUILD: LOADED IT';

/**
 * Versioned saves with checksum, rolling backup, migrations, write throttling and a storage fallback.
 * Public API (g.mods.save): save(), load(), hasSave(), wipe(), flush(), info(), recoveryOptions(),
 * exportString(), importString(s), stage(name). Nothing here throws to the caller.
 */
class Save implements Module {
  id = 'save';
  api = this;
  /** draw above every other overlay (ui's HUD and menus). Requested as a core sort key in render.ts (R3-2). */
  overlayZ = 100;
  private staged = false;
  g!: Game;
  store: Storage & { persistent?: boolean; trySet?(k: string, v: string): boolean } = memStorage();
  lastStatus: LoadStatus = 'none';
  /** true once a real game is in progress (new game, area entered, or a save loaded) */
  live = false;
  /** user-facing notices raised by save (also forwarded to ui.toast) */
  notices: string[] = [];
  private outbox: string[] = [];
  private clock = 0;          // frames seen by update(); runs while paused, unlike g.tick
  private tokens = BURST;
  private refillAt = 0;
  pending = false;
  private lastRaw: string | null = null;
  private lastData: string | null = null;
  writes = 0;
  /** frames left on the autosave indicator */
  blink = 0;
  /** showcase: draw the indicator frozen at this many frames left (null = live) */
  holdBlink: number | null = null;
  private noticeAt = 0;
  private keptHi = 0;
  private keptRaw: string | null = null;

  init(g: Game) {
    this.g = g;
    if (g.headless) this.store = memStorage(); else this.useStorage(browserStorage());
    g.bus.on('game:new', () => { this.live = true; });
    g.bus.on('area:enter', () => { this.live = true; });
    // leaving play for the title / ending must never leave a coalesced write behind
    g.bus.on('scene:change', (p: { to: string }) => { if (p.to === 'title' || p.to === 'ending') this.flush(); });
    if (!g.headless && typeof addEventListener === 'function') {
      const hide = () => this.flush();
      addEventListener('pagehide', hide);
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') hide(); });
    }
    this.restoreSettings();
    // browser-only clipboard shortcuts (a microtask runs after main.ts has finished its synchronous setup)
    if (!g.headless && typeof queueMicrotask === 'function') queueMicrotask(() => g.safe('save', () => this.afterBoot()));
  }

  /** Ctrl/Cmd+C copies a save code, Ctrl/Cmd+V pastes one (title, pause menu, recovery screen) */
  private afterBoot() {
    if (typeof document !== 'undefined') {
      document.addEventListener('copy', e => this.onCopy(e));
      document.addEventListener('paste', e => this.onPaste(e));
    }
  }

  /** where the clipboard shortcuts work: never mid-flight, only on calm screens */
  private clipboardOk(paste: boolean): boolean {
    const sc = this.g.state.scene, menu = this.g.mods.ui?.menuOpen;
    if (sc === 'title' || sc === 'map' || (sc === 'recovery' && paste)) return !menu || menu === 'none';
    return menu === 'pause';
  }
  private onCopy(e: ClipboardEvent) {
    if (!this.clipboardOk(false) || !e.clipboardData) return;
    const code = this.exportString();
    e.preventDefault();
    if (code) e.clipboardData.setData('text/plain', code);
    this.g.mods.ui?.toast?.(code ? CODE_TOAST.copied : CODE_TOAST.none);
  }
  private onPaste(e: ClipboardEvent) {
    if (!this.clipboardOk(true) || !e.clipboardData) return;
    const code = e.clipboardData.getData('text/plain') ?? '';
    if (!/POODLE\d*:|^\s*[A-Za-z0-9+/_=-]{40,}\s*$/.test(code)) return;
    e.preventDefault();
    const ui = this.g.mods.ui;
    if (ui?.menuOpen === 'pause') ui.closeMenus?.(false);
    const r = this.importString(code);
    ui?.toast?.(r === 'ok' || r === 'recovered' ? CODE_TOAST.loaded : CODE_TOAST.bad);
  }

  /** Swap the backend (tests, or a host that provides its own), wrapped in a SafeStore with memory fallback. */
  useStorage(inner: Storage | null) {
    this.store = new SafeStore(inner, CARRY, SPARE, r => this.notify(FALLBACK_TOAST[r]));
    this.lastRaw = this.lastData = null;
  }

  update(g: Game) {
    this.clock++;
    if (this.tokens < BURST && this.clock >= this.refillAt) { this.tokens++; this.refillAt = this.clock + REFILL; }
    if (this.pending && this.tokens > 0) this.write();
    if (this.blink > 0 && this.holdBlink === null) this.blink--;
    if (this.outbox.length && this.clock >= this.noticeAt && this.noticeReady(g)) {
      g.mods.ui.toast(this.outbox.shift()!); this.noticeAt = this.clock + NOTICE_GAP;
    }
  }

  /** Save notices wait for a calm moment: not during the sector title card, dialogue or the recovery screen. */
  private noticeReady(g: Game): boolean {
    if (!g.mods.ui?.toast || !NOTICE_SCENES.has(g.state.scene)) return false;
    if (g.mods.ui.menuOpen && g.mods.ui.menuOpen !== 'none') return false;
    return !((g.mods.world?.titleCard ?? 0) > 0);
  }

  /** true when the on-screen touch deck is showing (the bottom-right corner is the TOOT button) */
  private touchDeck(g: Game): boolean {
    const st = g.state.settings.touch;
    if (st === 'on') return true;
    if (st === 'off') return false;
    return g.mods.ui?.touch?.visible?.(g) ?? g.input.lastDevice === 'touch';
  }

  /** drawn above ui's HUD and menus (overlayZ = 100, sorted by core/render.ts) */
  overlay(g: Game, ctx: CanvasRenderingContext2D) { this.drawOverlay(g, ctx); }

  private drawOverlay(g: Game, ctx: CanvasRenderingContext2D) {
    const left = this.holdBlink ?? this.blink;
    // never a "saved" floppy over the recovery screen (it would contradict "a cat chewed your save")
    if (left <= 0 || NO_WRITE_SCENES.has(g.state.scene)) return;
    const touch = this.touchDeck(g), memory = this.store.persistent === false;
    const p = indicatorPos(g.state.scene, touch);
    if (touch && PLAY_SCENES.has(g.state.scene) && indicatorVisible(left)) {
      // caption on the ACTION rule: clear the rule under it so the letters stay crisp
      const cap = memory ? 'IN RAM' : 'SAVED', cx = p.x - 4 - textWidth(cap);
      ctx.fillStyle = col('1'); ctx.fillRect(cx - 3, 241, p.x - cx + 2, 1);
      text(ctx, cap, cx, 238, col(memory ? 'f' : 'i'), { shadow: col('0') });
    }
    drawIndicator(ctx, p.x, p.y, left, memory);
  }

  /**
   * Showcase stages (for critics and the integrator; wired from src/showcase as ?showcase=save&stage=...):
   * - 'indicator': a live play scene, frozen, with the floppy held solid and the storage-fallback toast up
   * - 'indicator-touch': the same with the touch deck on
   * - 'indicator-memory': the memory-only (storage blocked) floppy
   * - 'recovery' (default): the recovery screen with whatever this browser has (usually both slots gone)
   * - 'recovery-backup' / 'recovery-nibbled': the card with a safe backup / a patchable main (in-memory store)
   */
  stage(name = 'recovery'): void {
    const g = this.g; this.staged = true;
    if (name === 'indicator-memory') { this.useStorage(null); name = 'indicator'; }
    if (name === 'recovery-backup' || name === 'recovery-nibbled') {
      // a throwaway in-memory store, so the showcase never touches the visitor's real save
      this.store = memStorage(); this.lastRaw = this.lastData = null;
      const raw = encodeEnvelope({ ...g.state, scene: undefined }, g.tick);
      if (name === 'recovery-backup') { this.store.set(MAIN, 'chewed'); this.store.set(BACKUP, raw); }
      else { const env = JSON.parse(raw); env.sum = 'nibbled'; this.store.set(MAIN, JSON.stringify(env)); }
      g.setScene('recovery'); return;
    }
    if (name !== 'indicator' && name !== 'indicator-touch') { g.setScene('recovery'); return; }
    if (name === 'indicator-touch') g.state.settings.touch = 'on';
    const W_ = g.mods.world, Q = g.mods.quest;
    if (g.state.scene === 'title' || g.state.scene === 'boot' || g.state.scene === 'recovery') W_?.newGame?.();
    for (let n = 0; n < 60 && Q?.dlg; n++) Q.advance();
    if (W_) W_.titleCard = 0;
    for (let i = 0; i < 240; i++) g.step();
    g.mods.ui?.muteToasts?.(false);
    g.mods.ui?.toast?.(this.store.persistent === false ? FALLBACK_TOAST.blocked : 'PROGRESS SAVED');
    this.outbox.length = 0;
    for (let i = 0; i < 40; i++) g.step();
    this.holdBlink = IND_FRAMES - 4;
    g.paused = true;
  }

  private notify(text: string) {
    if (this.notices.includes(text)) return;
    this.notices.push(text); this.outbox.push(text);
  }

  // ---------------- writing ----------------
  encode(): string { return encodeEnvelope(this.g.state, this.g.tick); }
  /** Verified, migrated state data from a stored string (null if untrustworthy). */
  decode(raw: string | null): any | null { return decodeEnvelope(raw)?.data ?? null; }

  /**
   * Request a save. Returns true when the save was written or queued. Writes are throttled (burst of
   * BURST, then one per REFILL frames); a queued write lands on a later frame, on leaving for the
   * title/ending, or when the page is hidden. Before any game exists only settings are stored, so the
   * title screen's settings menu can never overwrite real progress with an empty game.
   */
  save(): boolean {
    try {
      if (!this.g || NO_WRITE_SCENES.has(this.g.state.scene)) return false;
      if (!this.live) return this.saveSettings();
      this.pending = true;
      if (this.tokens > 0) this.write();
      return true;
    } catch (e) { this.g.reportError('save', e); return false; }
  }

  /** Write any queued save now, ignoring the throttle. */
  flush(): boolean {
    if (!this.pending) return true;
    try { return this.write(true); } catch (e) { this.g.reportError('save', e); return false; }
  }

  private write(force = false): boolean {
    this.pending = false;
    const data = JSON.stringify({ ...this.g.state, scene: undefined });
    const cur = this.store.get(MAIN);
    // unchanged since our last write and nobody touched storage: nothing to do
    if (data === this.lastData && cur === this.lastRaw) return true;
    if (!force) { if (this.tokens === BURST) this.refillAt = this.clock + REFILL; this.tokens--; }
    const raw = this.encode();
    if (cur && decodeEnvelope(cur)) {
      // the backup is expendable: when space is tight, drop it rather than lose the main save
      if (this.store.trySet) { if (!this.store.trySet(BACKUP, cur)) this.store.del(BACKUP); }
      else this.store.set(BACKUP, cur);
    }
    this.store.set(MAIN, raw);
    this.lastRaw = raw; this.lastData = data; this.writes++;
    this.keep();
    this.blink = IND_FRAMES;
    this.g.bus.emit('save:written', { slot: 'main' });
    return true;
  }

  /** Title-screen settings change: patch settings into the stored save (if any) without touching progress. */
  private saveSettings(): boolean {
    const settings = this.g.state.settings;
    const d = decodeEnvelope(this.store.get(MAIN));
    if (d) {
      const raw = encodeEnvelope({ ...d.data, settings }, d.at);
      this.store.set(MAIN, raw); this.lastRaw = raw; this.lastData = null;
    } else this.store.set(SETTINGS, JSON.stringify(settings));
    this.keep();
    // no floppy here: settings and keepsakes are not progress, and the title may read CONTINUE [NO SAVE]
    return true;
  }

  /**
   * Store the high score and settings on their own (a few dozen bytes), so no corrupt save or START FRESH
   * can ever reset them. Written only when they change; best effort (never triggers the memory fallback).
   */
  private keep() {
    try {
      const hi = Math.max(this.keptHi, this.g.state.hiScore | 0);
      const v = JSON.stringify({ hi, settings: this.g.state.settings });
      if (v === this.keptRaw && this.store.get(KEEP) === v) return;
      if (this.store.trySet) this.store.trySet(KEEP, v); else this.store.set(KEEP, v);
      this.keptHi = hi; this.keptRaw = v;
    } catch { /* a keepsake must never break saving */ }
  }

  /** Best high score we can still find: the keepsake, either slot, even a slot whose checksum fails. */
  private bestHi(): number {
    let hi = 0;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), 99999999) : 0);
    try { const k = this.store.get(KEEP); if (k) hi = Math.max(hi, num(JSON.parse(k)?.hi)); } catch { /* unreadable */ }
    for (const key of [MAIN, BACKUP]) {
      try { const r = this.store.get(key); const d = decodeEnvelope(r) ?? decodeEnvelope(r, true); hi = Math.max(hi, num(d?.data?.hiScore)); } catch { /* unreadable */ }
    }
    return hi;
  }

  /** Carry the best known high score into the live state (boot, START FRESH). */
  private restoreHi() {
    const hi = this.bestHi();
    if (hi > (this.g.state.hiScore | 0)) this.g.state.hiScore = hi;
    this.keptHi = Math.max(this.keptHi, hi);
  }

  /** On boot, apply stored settings (volumes, accessibility) and the high score before the player picks CONTINUE. */
  restoreSettings() {
    try {
      let s: any = decodeEnvelope(this.store.get(MAIN))?.data?.settings ?? decodeEnvelope(this.store.get(BACKUP))?.data?.settings;
      if (!s) { const r = this.store.get(SETTINGS); if (r) s = JSON.parse(r); }
      if (!s) { const r = this.store.get(KEEP); if (r) s = JSON.parse(r)?.settings; }
      if (s && typeof s === 'object') this.g.state.settings = sanitizeState({ settings: s }, this.g.state.seed).settings;
    } catch { /* defaults are fine */ }
    try { this.restoreHi(); } catch { /* 0 is fine */ }
  }

  // ---------------- reading ----------------
  hasSave() { return !!this.store.get(MAIN) || !!this.store.get(BACKUP); }

  /** Slot health for the recovery screen: 'ok' | 'damaged' (checksum fails, data parses) | 'corrupt' | 'missing'. */
  info() {
    const slot = (k: string) => { const r = this.store.get(k); return !r ? 'missing' : decodeEnvelope(r) ? 'ok' : decodeEnvelope(r, true) ? 'damaged' : 'corrupt'; };
    return {
      main: slot(MAIN), backup: slot(BACKUP), persistent: this.store.persistent !== false,
      pending: this.pending, writes: this.writes, lastStatus: this.lastStatus, version: STATE_VERSION,
    };
  }

  /**
   * `load(slot = 'main')`: returns 'ok' | 'recovered' | 'corrupt' | 'none'. On success, state is replaced and
   * play resumes. 'main' tries main, then backup; 'backup' tries the backup first, then main. Every failure
   * ends on the recovery screen. Called from the recovery screen it also salvages a save whose checksum fails
   * but whose data still parses. Legacy form `load(resume: boolean)` (false = load without resuming play).
   */
  load(slot: Slot | boolean = 'main', resume = true): LoadStatus {
    try {
      if (typeof slot === 'boolean') { resume = slot; slot = 'main'; }
      if (slot !== 'backup') slot = 'main';
      const main = this.store.get(MAIN), bak = this.store.get(BACKUP);
      if (!main && !bak) return (this.lastStatus = 'none');
      const salvaging = this.g.state.scene === 'recovery';
      const order = slot === 'backup' ? [bak, main] : [main, bak];
      let d: Decoded | null = null, src: string | null = null;
      for (const r of order) if (!d && (d = decodeEnvelope(r))) src = r;
      if (salvaging) for (const r of order) if (!d && (d = decodeEnvelope(r, true))) src = r;
      if (!d) {
        this.quarantine(main, bak);
        this.lastStatus = 'corrupt'; this.g.setScene('recovery'); return 'corrupt';
      }
      // 'ok' = exactly the main save; a deliberate load('backup') is 'recovered' too (it becomes main)
      const status: LoadStatus = src === main && decodeEnvelope(main) ? 'ok' : 'recovered';
      const s = sanitizeState(d.data, this.g.state.seed);
      if (!this.g.content.areas.find(a => a.id === s.areaId)) s.areaId = this.g.content.start;
      this.g.replaceState(s);
      this.live = true; this.pending = false;
      if (d.future) { if (src && !this.store.get(FUTURE)) this.store.set(FUTURE, src); this.notify(FUTURE_TOAST); }
      if (status === 'recovered') {
        if (main && main !== src) this.quarantine(main, null);
        // rewrite main as a fresh, valid envelope of what we just loaded
        const raw = encodeEnvelope(s, d.at); this.store.set(MAIN, raw); this.lastRaw = raw; this.lastData = null;
        this.g.bus.emit('save:recovered', { slot: src === bak ? 'backup' : 'salvage' });
      } else { this.lastRaw = main; this.lastData = null; }
      this.lastStatus = status;
      if (resume) this.resume();
      return status;
    } catch (e) {
      this.g.reportError('save', e);
      this.lastStatus = 'corrupt';
      try { this.g.setScene('recovery'); } catch { /* ignore */ }
      return 'corrupt';
    }
  }

  private quarantine(main: string | null, bak: string | null) {
    try {
      const q = JSON.stringify({ main, backup: bak, tick: this.g.tick });
      if (this.store.get(QUARANTINE) !== q) this.store.set(QUARANTINE, q);
    } catch { /* best effort */ }
  }

  resume() {
    const s = this.g.state; const W = this.g.mods.world;
    if (s.ending) { this.g.setScene('ending'); return; }
    const a = W.area(s.areaId);
    if (a && s.areasCleared.includes(a.id) && !a.ending) { this.g.setScene('map'); return; }
    W.enterArea(s.areaId, s.waveIndex);
  }

  /**
   * "Start fresh": removes main and backup. The quarantined copy (if any) is kept, and so are the high
   * score (keepsake) and the current settings, like an arcade cabinet keeps its HI-SCORE.
   */
  wipe() {
    try { this.restoreHi(); this.keep(); } catch { /* best effort */ }
    try { this.store.set(SETTINGS, JSON.stringify(this.g.state.settings)); } catch { /* best effort */ }
    this.store.del(MAIN); this.store.del(BACKUP);
    this.live = false; this.pending = false; this.lastRaw = this.lastData = null;
  }

  /**
   * Everything the recovery screen needs, worded for players (ui draws it via drawRecoveryCard).
   * - `rows`: the card's options. Something to fetch: [primary, 'START FRESH'] with primary
   *   'TRY BACKUP SAVE' (a slot verifies) or 'PATCH UP MY SAVE' (a slot's checksum fails but its data parses).
   *   Nothing to fetch (both slots gone or chewed beyond salvage): just ['START FRESH'] (no fake retry).
   * - `primary`: rows[0]; `status`: slot states, e.g. 'MAIN: CHEWED  BACKUP: SAFE'
   * - `doomed`: nothing can be loaded; ui's row 0 then simply starts fresh (load() answers 'none'/'corrupt')
   */
  recoveryOptions() {
    return this.options();
  }
  private options() {
    const i = this.info();
    const word = (s: string) => (s === 'ok' ? 'SAFE' : s === 'damaged' ? 'NIBBLED' : s === 'corrupt' ? 'CHEWED' : 'GONE');
    const anyOk = i.main === 'ok' || i.backup === 'ok', anyDamaged = i.main === 'damaged' || i.backup === 'damaged';
    const doomed = !anyOk && !anyDamaged;
    const primary = anyOk ? 'TRY BACKUP SAVE' : anyDamaged ? 'PATCH UP MY SAVE' : 'START FRESH';
    return {
      primary, rows: doomed ? ['START FRESH'] : [primary, 'START FRESH'],
      status: `MAIN: ${word(i.main)}  BACKUP: ${word(i.backup)}`,
      doomed,
      recoveredToast: (slot: string) => (slot === 'salvage' ? 'SAVE PATCHED UP. GOOD AS NEW' : 'SAVE PATCHED UP FROM BACKUP'),
      freshToast: 'STARTING FRESH. HI-SCORE KEPT!',
    };
  }

  // ---------------- export / import ----------------
  /** Portable save code ("POODLE1:..."): the live game if one is running, else the stored save. '' if none. */
  exportString(): string {
    try {
      if (this.live) return toExportString(this.encode());
      for (const k of [MAIN, BACKUP]) { const raw = this.store.get(k); if (raw && decodeEnvelope(raw)) return toExportString(raw); }
      return '';
    } catch { return ''; }
  }
  /**
   * Validates a save code before touching storage. Invalid codes return 'corrupt' and change nothing
   * (no recovery screen). A valid code becomes the main save (old main rotates to backup) and is loaded.
   */
  importString(str: string): LoadStatus {
    try {
      const raw = fromExportString(str);
      const d = decodeEnvelope(raw);
      if (!raw || !d) return 'corrupt';
      const cur = this.store.get(MAIN);
      if (cur && decodeEnvelope(cur)) this.store.set(BACKUP, cur);
      this.store.set(MAIN, d.future ? raw : encodeEnvelope(d.data, d.at));
      if (this.g.state.scene === 'recovery') this.g.setScene('title');
      return this.load();
    } catch { return 'corrupt'; }
  }
}
export const makeSave = (): Module => new Save();
export type SaveModule = Save;
