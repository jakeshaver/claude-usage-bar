import type { Game } from '../core/game';

/**
 * A "fair" Treat Bonanza pilot for the headless quest check: it plays through the real input path (synthetic
 * left/right/up/down/fire, so the player's own acceleration, top speed, fire cooldown and turd cap apply) and
 * only knows what a player can see: where each cat is and where its flight path goes next. If it can boop every
 * cat of a layout, a perfect bonus is humanly possible on that layout.
 */
const TURD_VY = 6.2;          // turd speed (interaction.fireTurds)
const MUZZLE = 14;            // turds spawn this far above Pom's centre

type Pos = { x: number; y: number; hx: number; hy: number };
const tp: Pos = { x: 0, y: 0, hx: 1, hy: 0 };

/** Where a flying bonus cat will be `k` ticks from now (same track + lateral offset math as interaction). */
export function predict(c: any, k: number): { x: number; y: number } | null {
  if (c.dead || c.st === 'leave') return null;
  const tr = c.track; if (!tr) return { x: c.x, y: c.y };
  let s = c.s;
  if (c.st === 'wait') { const fly = k - c.delay; if (fly < 0) return null; s = c.s + fly * c.speed; }
  else s = c.s + k * c.speed;
  if (s >= tr.len) return null;
  tr.at(s, tp);
  const fade = Math.min(1, s / 40, (tr.len - s) / 50);
  const off = c.lat * Math.max(0, fade);
  return { x: tp.x - tp.hy * off, y: tp.y + tp.hx * off };
}

export interface PilotStats { minWindow: number; unhittable: number }

/** One tick of input for the bonus pilot. Returns the actions to hold. */
export function bonusPilot(g: Game): Set<string> {
  const out = new Set<string>();
  const P = g.mods.player; const ix = g.mods.interaction; if (!P || !ix) return out;
  const px = P.x, py = P.y, my = py - MUZZLE;
  // turds already in flight: cats they will hit are "spoken for"
  const turds: any[] = ix.turds ?? [];
  const claimed = new Set<any>();
  for (const s of turds) {
    if (s.y < -50) continue;
    for (const c of ix.cats) {
      if (claimed.has(c) || c.dead) continue;
      const k = Math.max(0, Math.round((s.y - c.y) / (TURD_VY + Math.max(0, -c.vy || 0))));
      const f = predict(c, k); if (!f) continue;
      if (Math.abs(f.x - (s.x + s.vx * k)) < 13 && Math.abs(f.y - (s.y - TURD_VY * k)) < 18) { claimed.add(c); break; }
    }
  }
  // plan per cat: the earliest tick k at which Pom can be under the cat's intercept point and fire,
  // then chase the cat whose window closes first (earliest-deadline-first)
  let best: any = null; let bestDead = Infinity; let aim = px; let bestK = 0; let shootNow = false;
  const reach = (k: number) => 2.6 * Math.max(0, k - 3) + 2;
  for (const c of ix.cats) {
    if (c.dead || c.st === 'leave' || claimed.has(c)) continue;
    let planK = -1, planX = 0, dead = -1;
    { // a shot fired right now would hit this cat: take it, whichever cat we are chasing
      let T = 8; let f = predict(c, T);
      for (let i = 0; i < 5 && f; i++) { T = Math.max(0, Math.round((my - f.y) / TURD_VY)); f = predict(c, T); }
      if (f && f.y > -6 && f.y < my - 8 && Math.abs(f.x - px) < 9) shootNow = true;
    }
    for (let k = 0; k < 360; k += 2) {
      // turd fired at tick k meets the cat after T ticks of flight
      let T = 8; let f = predict(c, k + T);
      for (let i = 0; i < 5 && f; i++) { T = Math.max(0, Math.round((my - f.y) / TURD_VY)); f = predict(c, k + T); }
      if (!f) { if (k > (c.st === 'wait' ? c.delay : 0) + 4) break; continue; }
      if (f.y < -6 || f.y > my - 8 || f.x < 4 || f.x > 444) continue;
      dead = k;
      if (planK < 0 && Math.abs(f.x - px) <= reach(k)) { planK = k; planX = f.x; }
    }
    if (planK < 0) continue;
    if (dead < bestDead) { bestDead = dead; best = c; aim = planX; bestK = planK; }
  }
  const dx = aim - px;
  const vx = P.vx ?? 0;
  // brake early enough: friction 0.72 per tick when no key is held
  if (Math.abs(dx) > 2) {
    const stop = Math.abs(vx) * 2.6;
    if (Math.sign(dx) === Math.sign(vx) && Math.abs(dx) <= stop) { /* coast */ }
    else out.add(dx < 0 ? 'left' : 'right');
  }
  // stay low: the widest view of the cats above, and the most time to line up
  if (py < 316) out.add('down');
  if (shootNow || (best && bestK <= 2 && Math.abs(dx) < 9)) out.add('fire');
  return out;
}
