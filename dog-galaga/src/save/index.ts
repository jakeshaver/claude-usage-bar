import type { Game, Module } from '../core/game';
import { sanitizeState, STATE_VERSION } from '../core/state';

export interface Storage { get(k: string): string | null; set(k: string, v: string): void; del(k: string): void }
export const memStorage = (): Storage => { const m = new Map<string, string>(); return { get: k => m.get(k) ?? null, set: (k, v) => void m.set(k, v), del: k => void m.delete(k) }; };
const browserStorage = (): Storage => ({
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage full or blocked: keep running */ } },
  del: k => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
});

const MAIN = 'poodle-patrol:save', BACKUP = 'poodle-patrol:backup';
export function checksum(s: string): string { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }

/** Versioned saves with checksum and rolling backup. Never throws to the caller. */
class Save implements Module {
  id = 'save';
  api = this;
  g!: Game;
  store: Storage = typeof localStorage !== 'undefined' ? browserStorage() : memStorage();
  lastStatus: 'ok' | 'recovered' | 'corrupt' | 'none' = 'none';
  init(g: Game) { this.g = g; if (g.headless) this.store = memStorage(); }

  encode(): string {
    const data = JSON.stringify({ ...this.g.state, scene: undefined });
    return JSON.stringify({ v: STATE_VERSION, data, sum: checksum(data), at: this.g.tick });
  }
  decode(raw: string | null): any | null {
    if (!raw) return null;
    try { const o = JSON.parse(raw); if (typeof o?.data !== 'string' || checksum(o.data) !== o.sum) return null; return JSON.parse(o.data); }
    catch { return null; }
  }
  save() {
    try {
      const cur = this.store.get(MAIN);
      if (cur && this.decode(cur)) this.store.set(BACKUP, cur);
      this.store.set(MAIN, this.encode());
      this.g.bus.emit('save:written', { slot: 'main' });
      return true;
    } catch (e) { this.g.reportError('save', e); return false; }
  }
  hasSave() { return !!this.store.get(MAIN) || !!this.store.get(BACKUP); }
  /** Returns 'ok' | 'recovered' | 'corrupt' | 'none'. On success, state is replaced and play resumes. */
  load(resume = true): 'ok' | 'recovered' | 'corrupt' | 'none' {
    const main = this.store.get(MAIN), bak = this.store.get(BACKUP);
    if (!main && !bak) return (this.lastStatus = 'none');
    let data = this.decode(main); let status: 'ok' | 'recovered' = 'ok';
    if (!data) { data = this.decode(bak); status = 'recovered'; }
    if (!data) { this.lastStatus = 'corrupt'; this.g.setScene('recovery'); return 'corrupt'; }
    const s = sanitizeState(data, this.g.state.seed);
    if (!this.g.content.areas.find(a => a.id === s.areaId)) s.areaId = this.g.content.start;
    this.g.replaceState(s);
    if (status === 'recovered') { this.g.bus.emit('save:recovered', { slot: 'backup' }); this.store.set(MAIN, bak!); }
    this.lastStatus = status;
    if (resume) this.resume();
    return status;
  }
  resume() {
    const s = this.g.state; const W = this.g.mods.world;
    if (s.ending) { this.g.setScene('ending'); return; }
    const a = W.area(s.areaId);
    if (a && s.areasCleared.includes(a.id) && !a.ending) { this.g.setScene('map'); return; }
    W.enterArea(s.areaId, s.waveIndex);
  }
  wipe() { this.store.del(MAIN); this.store.del(BACKUP); }
  exportString() { return btoa(this.encode()); }
  importString(str: string) { try { this.store.set(MAIN, atob(str)); return this.load(); } catch { return 'corrupt'; } }
}
export const makeSave = (): Module => new Save();
