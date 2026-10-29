// Storage backends. `SafeStore` wraps localStorage and silently moves to an in-memory map the moment the
// browser refuses (blocked storage, private mode, quota exceeded), telling the game once so it can toast.

export interface Storage { get(k: string): string | null; set(k: string, v: string): void; del(k: string): void }

export const memStorage = (): Storage => {
  const m = new Map<string, string>();
  return { get: k => m.get(k) ?? null, set: (k, v) => void m.set(k, v), del: k => void m.delete(k) };
};

/** Raw localStorage. Throws on failure on purpose: SafeStore decides what to do. */
export function browserStorage(): Storage | null {
  let ls: globalThis.Storage;
  try { ls = globalThis.localStorage; if (!ls) return null; } catch { return null; }
  return { get: k => ls.getItem(k), set: (k, v) => ls.setItem(k, v), del: k => ls.removeItem(k) };
}

export type FallbackReason = 'blocked' | 'full';
export function isQuotaError(e: unknown): boolean {
  const x = e as { name?: string; code?: number } | null;
  return !!x && (x.name === 'QuotaExceededError' || x.name === 'NS_ERROR_DOM_QUOTA_REACHED' || x.code === 22 || x.code === 1014);
}

export class SafeStore implements Storage {
  mode: 'persistent' | 'memory' = 'persistent';
  reason: FallbackReason | null = null;
  private mem = memStorage();
  /**
   * @param inner   persistent backend (null = unavailable: start in memory)
   * @param keys    keys to carry over into memory when falling back
   * @param spare   keys that may be deleted (in order) to make room when the quota is hit
   * @param onFallback called once when the store switches to memory
   */
  constructor(private inner: Storage | null, private keys: string[], private spare: string[], private onFallback: (r: FallbackReason) => void) {
    if (!inner) { this.fallback('blocked'); return; }
    try { const probe = '__pp_probe__'; inner.set(probe, '1'); inner.del(probe); }
    catch (e) { this.fallback(isQuotaError(e) ? 'full' : 'blocked'); }
  }
  get persistent() { return this.mode === 'persistent'; }

  private fallback(r: FallbackReason) {
    if (this.mode === 'memory' && this.reason) return;
    // carry over whatever can still be read so the session keeps its progress
    if (this.inner) for (const k of this.keys) { try { const v = this.inner.get(k); if (v != null && this.mem.get(k) == null) this.mem.set(k, v); } catch { /* unreadable */ } }
    this.mode = 'memory'; this.reason = r;
    try { this.onFallback(r); } catch { /* notification must never break storage */ }
  }

  get(k: string): string | null {
    if (this.mode === 'memory' || !this.inner) return this.mem.get(k);
    try { return this.inner.get(k); } catch { this.fallback('blocked'); return this.mem.get(k); }
  }
  set(k: string, v: string) {
    if (this.mode === 'memory' || !this.inner) { this.mem.set(k, v); return; }
    try { this.inner.set(k, v); return; }
    catch (e) {
      if (isQuotaError(e)) {
        // make room: drop expendable copies one at a time and retry
        for (const s of this.spare) {
          if (s === k) continue;
          try { this.inner.del(s); this.inner.set(k, v); return; } catch { /* still full */ }
        }
      }
      this.fallback(isQuotaError(e) ? 'full' : 'blocked');
      this.mem.set(k, v);
    }
  }
  /**
   * For expendable copies (the backup): on quota, frees spare keys and retries, but if there is still no
   * room returns false instead of abandoning persistent storage. Other failures fall back as in set().
   */
  trySet(k: string, v: string): boolean {
    if (this.mode === 'memory' || !this.inner) { this.mem.set(k, v); return true; }
    try { this.inner.set(k, v); return true; }
    catch (e) {
      if (!isQuotaError(e)) { this.fallback('blocked'); this.mem.set(k, v); return true; }
      for (const s of this.spare) {
        if (s === k) continue;
        try { this.inner.del(s); this.inner.set(k, v); return true; } catch { /* still full */ }
      }
      return false;
    }
  }
  del(k: string) {
    this.mem.del(k);
    if (this.mode === 'memory' || !this.inner) return;
    try { this.inner.del(k); } catch { this.fallback('blocked'); }
  }
}
