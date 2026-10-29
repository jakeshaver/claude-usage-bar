// Save codec: envelope, checksum, version migrations and the portable export string.
// Pure functions only (no game, no storage) so they can be unit-tested in isolation.
import { STATE_VERSION } from '../core/state';

/** djb2 over UTF-16 code units, base36. Detects truncation and bit rot, not tampering. */
export function checksum(s: string): string { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }

/** On-disk envelope. `v` is the state version the data was written with; `t` is wall-clock ms (informational). */
export interface Envelope { v: number; data: string; sum: string; at: number; t?: number }

export type Migration = (d: Record<string, any>) => Record<string, any>;
/**
 * MIGRATIONS[n] upgrades data written at version n to version n + 1. To ship a new state shape:
 * bump STATE_VERSION in core/state.ts and add MIGRATIONS[old] here. Never edit an old step.
 */
export const MIGRATIONS: Record<number, Migration> = {
  // v0: pre-envelope builds stored the raw state object. Same field names, no version field.
  0: d => ({ ...d, version: 1 }),
};

export interface Migrated { data: Record<string, any>; from: number; future: boolean }
/** Walk `data` from version `from` up to `to`. Missing steps are skipped (sanitizeState fills gaps). */
export function migrate(data: Record<string, any>, from: number, to = STATE_VERSION, table = MIGRATIONS): Migrated {
  const start = Number.isInteger(from) && from >= 0 ? from : 0;
  if (start > to) return { data: { ...data, version: to }, from: start, future: true };
  let d = data;
  for (let v = start; v < to; v++) { const step = table[v]; if (step) d = step(d) ?? d; }
  return { data: { ...d, version: to }, from: start, future: false };
}

export function encodeEnvelope(state: object, at: number, v = STATE_VERSION): string {
  const data = JSON.stringify({ ...state, scene: undefined });
  const env: Envelope = { v, data, sum: checksum(data), at, t: Date.now() };
  return JSON.stringify(env);
}

const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);
const looksLikeState = (x: unknown): x is Record<string, any> => isObj(x) && typeof x.areaId === 'string';

export interface Decoded extends Migrated { at: number }
/**
 * Verify and migrate a stored string. Returns null for anything that is not a trustworthy save.
 * `salvage` skips the checksum (last resort on the recovery screen) but still needs a parseable state.
 */
export function decodeEnvelope(raw: string | null | undefined, salvage = false): Decoded | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const o = JSON.parse(raw);
    if (isObj(o) && typeof o.data === 'string') {
      if (!salvage && checksum(o.data) !== o.sum) return null;
      const d = JSON.parse(o.data);
      if (!isObj(d) || (salvage && !looksLikeState(d))) return null;
      const v = typeof o.v === 'number' ? o.v : typeof d.version === 'number' ? d.version : 0;
      return { ...migrate(d, v), at: typeof o.at === 'number' ? o.at : 0 };
    }
    // legacy v0: a bare state object with no envelope
    if (looksLikeState(o) && !('data' in o)) return { ...migrate(o, typeof o.version === 'number' ? o.version : 0), at: 0 };
    return null;
  } catch { return null; }
}

// ---- portable export string: "POODLE1:" + base64url(utf8(envelope)) ----
export const EXPORT_PREFIX = 'POODLE1:';
function b64encode(s: string): string {
  const bytes = new TextEncoder().encode(s); let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64decode(s: string): string {
  let t = s.replace(/-/g, '+').replace(/_/g, '/'); while (t.length % 4) t += '=';
  const bin = atob(t); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
export function toExportString(envelope: string): string { return EXPORT_PREFIX + b64encode(envelope); }
/** Accepts the current format, a bare base64 envelope (older builds) or a raw envelope JSON. Whitespace is ignored. */
export function fromExportString(str: unknown): string | null {
  if (typeof str !== 'string') return null;
  const s = str.replace(/\s+/g, '');
  if (!s) return null;
  try {
    if (s.startsWith(EXPORT_PREFIX)) return b64decode(s.slice(EXPORT_PREFIX.length));
    if (s.startsWith('{')) return str.trim();
    return b64decode(s);
  } catch { return null; }
}
