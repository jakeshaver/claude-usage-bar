// Difficulty curve: one place for every knob, so the 13 sectors ramp gently (cozy, but engaging).
import type { Game } from '../core/game';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export interface Tuning {
  d: number;            // 0 (backyard) .. 1 (mothership)
  spitSpeed: number;    // px/tick for hairballs
  spitCap: number;      // max cat hairballs on screen
  bossSpitCap: number;  // max boss hairballs on screen
  fireEvery: number;    // ticks between formation shots (scaled by the wave's fireRate)
  diveEvery: number;    // ticks between dive launches (scaled by the wave's diveRate)
  diveGroups: number;   // max dive groups in the air at once
  diveSpeed: number;    // px/tick along a dive
  entrySpeed: number;   // px/tick along an entry path
  diveShots: number;    // hairballs a diving cat may cough on the way down
  tell: number;         // wind-up ticks before a cat fires (mouth glints)
}

/** Sector progress 0..1: the deeper of (sectors cleared) and (this area's place in the sector list). */
export function sectorT(g: Game): number {
  const idx = Math.max(0, g.content.areas.findIndex(a => a.id === g.state.areaId));
  const n = Math.max(1, g.content.areas.length - 1);
  return Math.min(1, Math.max(g.state.areasCleared.length, idx) / n);
}

export function tuning(g: Game, fireRate = 0.0016, diveRate = 0.0022): Tuning {
  const wi = Math.min(9, g.state.waveIndex ?? 0);
  const d = Math.min(1, sectorT(g) + wi * 0.006);
  const fr = Math.sqrt(Math.max(0.0004, fireRate) / 0.0016), dr = Math.sqrt(Math.max(0.0004, diveRate) / 0.0022);
  return {
    d,
    spitSpeed: lerp(1.45, 2.25, d),
    spitCap: Math.round(lerp(3, 9, d)),
    bossSpitCap: Math.round(lerp(14, 26, d)),
    fireEvery: Math.round(lerp(90, 58, d) / fr),
    diveEvery: Math.round(lerp(150, 100, d) / dr),
    diveGroups: d < 0.2 ? 1 : d < 0.5 ? 2 : 3,
    diveSpeed: lerp(2.7, 3.5, d),
    entrySpeed: lerp(2.7, 3.3, d),
    diveShots: d < 0.15 ? 1 : 2,
    tell: Math.round(lerp(22, 14, d)),
  };
}
