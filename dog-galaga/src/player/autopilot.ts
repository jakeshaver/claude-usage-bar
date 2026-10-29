import type { Game } from '../core/game';
import type { Action } from '../core/input';
/** Deterministic autopilot used by the playthrough bot and attract mode: projects threats, picks the safest lane near its target. */
export function autopilotInput(g: Game, p: { x: number; y: number }): Set<Action> {
  const out = new Set<Action>();
  const ix = g.mods.interaction; if (!ix) return out;
  let tx = p.x;
  const pk = ix.pickups?.find((k: any) => k.y > 120);
  if (pk) tx = pk.x; else { const t = ix.target(p.x); if (t) tx = t.x; }
  const threats = ix.threats();
  const danger = (x: number, y: number) => {
    let d = 0;
    for (const s of threats) {
      const vx = s.vx ?? 0, vy = s.vy ?? 3;
      for (let k = 0; k <= 36; k += 4) {
        const sx = s.x + vx * k, sy = s.y + vy * k;
        const dx = Math.abs(sx - x), dy = Math.abs(sy - y);
        if (dx < 16 && dy < 16) d += (40 - k) * (s.st ? 2 : 1);
      }
    }
    if (x < 20 || x > 428) d += 50;
    return d;
  };
  const targetY = 308;    // a little above the player module's MAX_Y (316)
  let best = 0, bestScore = Infinity;
  for (let dir = -1; dir <= 1; dir++) {
    const nx = p.x + dir * 14;
    const sc = danger(nx, p.y) * 10 + Math.abs(nx - tx) * 0.5 + (dir === 0 ? -0.1 : 0);
    if (sc < bestScore) { bestScore = sc; best = dir; }
  }
  if (best < 0) out.add('left'); else if (best > 0) out.add('right');
  else if (Math.abs(tx - p.x) > 3 && danger(p.x + Math.sign(tx - p.x) * 6, p.y) === 0) out.add(tx < p.x ? 'left' : 'right');
  if (p.y < targetY - 4) out.add('down'); else if (p.y > targetY + 4) out.add('up');
  out.add('fire');
  return out;
}
