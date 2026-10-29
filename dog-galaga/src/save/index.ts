import type { Game, Module } from '../core/game';
import { W, H } from '../core/game';
import { sanitizeState, STATE_VERSION } from '../core/state';
import { decodeEnvelope, encodeEnvelope, fromExportString, toExportString, type Decoded } from './codec';
import { SafeStore, browserStorage, memStorage, type FallbackReason, type Storage } from './storage';
import { drawIndicator, IND_FRAMES, IND_W, IND_H } from './indicator';

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
} as const;
const { MAIN, BACKUP, SETTINGS, QUARANTINE, FUTURE } = KEYS;
const CARRY = [MAIN, BACKUP, SETTINGS], SPARE = [QUARANTINE, FUTURE, BACKUP];

/** Write throttle: a burst of up to BURST writes is immediate, then one per REFILL frames (~1 s). */
export const BURST = 4, REFILL = 60;

export type LoadStatus = 'ok' | 'recovered' | 'corrupt' | 'none';
const NO_WRITE_SCENES = new Set(['boot', 'recovery']);
export const FALLBACK_TOAST: Record<FallbackReason, string> = {
  blocked: 'STORAGE IS OFF. SAVING IN MEMORY',
  full: 'SAVE SPACE FULL. SAVING IN MEMORY',
};
export const FUTURE_TOAST = 'SAVE FROM A NEWER BUILD: LOADED IT';

/**
 * Versioned saves with checksum, rolling backup, migrations, write throttling and a storage fallback.
 * Public API (g.mods.save): save(), load(), hasSave(), wipe(), exportString(), importString(s), flush(), info().
 * Nothing here throws to the caller.
 */
class Save implements Module {
  id = 'save';
  api = this;
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
  }

  /** Swap the backend (tests, or a host that provides its own), wrapped in a SafeStore with memory fallback. */
  useStorage(inner: Storage | null) {
    this.store = new SafeStore(inner, CARRY, SPARE, r => this.notify(FALLBACK_TOAST[r]));
    this.lastRaw = this.lastData = null;
  }

  update(g: Game) {
    // Overlays draw in module order and ui's full-screen HUD comes after save in boot.ts, which would hide
    // the autosave icon. Until core registers save last (requested in docs/core-requests/save.md), move
    // this module to the end once, outside g.init()'s loop. No-op when already last.
    if (g.modules[g.modules.length - 1] !== this && g.modules.includes(this)) { g.modules.splice(g.modules.indexOf(this), 1); g.modules.push(this); }
    this.clock++;
    if (this.tokens < BURST && this.clock >= this.refillAt) { this.tokens++; this.refillAt = this.clock + REFILL; }
    if (this.pending && this.tokens > 0) this.write();
    if (this.blink > 0) this.blink--;
    if (this.outbox.length && g.mods.ui?.toast) { for (const t of this.outbox.splice(0)) g.mods.ui.toast(t); }
  }

  overlay(_g: Game, ctx: CanvasRenderingContext2D) {
    if (this.blink > 0) drawIndicator(ctx, W - IND_W - 10, H - IND_H - 10, this.blink);
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
    this.blink = IND_FRAMES;
    return true;
  }

  /** On boot, apply stored settings (volumes, accessibility) before the player picks CONTINUE. */
  restoreSettings() {
    try {
      let s: any = decodeEnvelope(this.store.get(MAIN))?.data?.settings ?? decodeEnvelope(this.store.get(BACKUP))?.data?.settings;
      if (!s) { const r = this.store.get(SETTINGS); if (r) s = JSON.parse(r); }
      if (s && typeof s === 'object') this.g.state.settings = sanitizeState({ settings: s }, this.g.state.seed).settings;
    } catch { /* defaults are fine */ }
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
   * Returns 'ok' | 'recovered' | 'corrupt' | 'none'. On success, state is replaced and play resumes.
   * Main -> backup -> recovery screen. Called again from the recovery screen ("try backup") it also
   * salvages a save whose checksum fails but whose data still parses.
   */
  load(resume = true): LoadStatus {
    try {
      const main = this.store.get(MAIN), bak = this.store.get(BACKUP);
      if (!main && !bak) return (this.lastStatus = 'none');
      const salvaging = this.g.state.scene === 'recovery';
      let d: Decoded | null = decodeEnvelope(main), src = main;
      if (!d) { d = decodeEnvelope(bak); src = bak; }
      if (!d && salvaging) { d = decodeEnvelope(main, true); src = main; if (!d) { d = decodeEnvelope(bak, true); src = bak; } }
      if (!d) {
        this.quarantine(main, bak);
        this.lastStatus = 'corrupt'; this.g.setScene('recovery'); return 'corrupt';
      }
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

  /** "Start fresh": removes main and backup. The quarantined copy (if any) is kept. */
  wipe() {
    this.store.del(MAIN); this.store.del(BACKUP);
    this.live = false; this.pending = false; this.lastRaw = this.lastData = null;
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
