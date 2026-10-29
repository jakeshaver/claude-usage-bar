import { describe, it, expect } from 'vitest';
import { createGame } from '../core/boot';
import { shapeFor, entryFor, latticeFor, laneOf, layout, plan, LATTICE_FAMILY, COL_SP, ROW_SP, WALL_GAP, signatureFor } from './formation';

const entriesOf = (g: any, a: any) => a.waves.map((id: string) => g.content.waves.find((w: any) => w.id === id)?.entry ?? 'swirl-left');

describe('interaction waves', () => {
  it('consecutive waves of a sector never repeat a formation shape or an entry', () => {
    const g = createGame({ headless: true });
    g.content.areas.forEach((a, ai) => {
      const es = entriesOf(g, a); const M = latticeFor(a.id).cols;
      for (let i = 1; i < a.waves.length; i++) {
        expect(shapeFor(ai, i, M), `${a.id} wave ${i} shape`).not.toBe(shapeFor(ai, i - 1, M));
        // galaga / block / barrel / arrow all read as the same rectangle: never two of them back to back
        expect(LATTICE_FAMILY.has(shapeFor(ai, i, M)) && LATTICE_FAMILY.has(shapeFor(ai, i - 1, M)), `${a.id} wave ${i} lattice twice`).toBe(false);
        expect(entryFor(ai, i, es, a.id, M), `${a.id} wave ${i} entry`).not.toBe(entryFor(ai, i - 1, es, a.id, M));
      }
    });
  });

  it('every wave lays out one cat per cell, inside the lane lattice', () => {
    const g = createGame({ headless: true });
    g.content.areas.forEach((a, ai) => a.waves.forEach((wid: string, i: number) => {
      const w = g.content.waves.find((x: any) => x.id === wid)!; const M = latticeFor(a.id).cols;
      const hs = layout(w, shapeFor(ai, i, M), i, (id: string) => g.content.enemies.find((e: any) => e.id === id)!, 30, M);
      expect(new Set(hs.map(h => h.row + ':' + h.u)).size, `${a.id}/${i}`).toBe(hs.length);
      for (const h of hs) expect(Math.abs(h.u), `${a.id}/${i}`).toBeLessThanOrEqual((M - 1) / 2);
      // air: any two cats are a full cell apart in one direction (>= 40px across or >= 34px down: 6px+ between sprites)
      for (const p of hs) for (const q of hs) if (p !== q) {
        const dx = Math.abs(p.u - q.u) * COL_SP, dy = Math.abs(p.row - q.row) * ROW_SP;
        expect(dx >= 40 || dy >= 34, `${a.id}/${i} cramped`).toBe(true);
      }
      // mirrored gapped shapes: the rack is symmetric about its centre column
      const sh = shapeFor(ai, i, M);
      if (sh === 'flanks' || sh === 'wings' || sh === 'pillars' || sh === 'squads') {
        const key = new Set(hs.map(h => h.row + ':' + h.u));
        for (const h of hs) expect(key.has(h.row + ':' + -h.u), `${a.id}/${i} ${sh} lopsided`).toBe(true);
      }
    }));
  });

  it('the full lattice keeps WALL_GAP px of air to the lane walls at the far end of its sway', () => {
    const g = createGame({ headless: true });
    for (const a of g.content.areas) {
      const [l, r] = laneOf(a.id); const { cx, cols, amp } = latticeFor(a.id);
      const half = ((cols - 1) * COL_SP) / 2 + 14 + amp;
      expect(cx - half, a.id).toBeGreaterThanOrEqual(l + WALL_GAP);
      expect(cx + half, a.id).toBeLessThanOrEqual(r + 1 - WALL_GAP);
    }
  });

  it('entry streams stay a sprite apart and never fly across parked cats', () => {
    const g = createGame({ headless: true });
    g.mods.world.newGame();
    const I = g.mods.interaction;
    let bad = 0; const where: string[] = [];
    for (const a of g.content.areas) {
      a.waves.forEach((_: string, i: number) => {
        g.state.areaId = a.id; g.state.waveIndex = i; g.state.scene = 'play';
        I.startWave(a.id, i);
        for (let t = 0; t < 600; t++) {
          I.update(g);
          const fl = I.cats.filter((c: any) => c.st === 'enter');
          if (!fl.length && t > 60) break;
          for (const c of fl) {
            if (c.y < 0 || c.x < 32 || c.x > 416) continue;
            for (const o of I.cats) if (o !== c && (o.st === 'form' || (o.st === 'enter' && o.id < c.id)) && Math.abs(o.x - c.x) < 16 && Math.abs(o.y - c.y) < 16) { bad++; where.push(`${a.id}/${i}`); }
          }
        }
      });
    }
    expect(bad, [...new Set(where)].join(' ')).toBe(0);
  });

  it('every sector but the backyard has a signature wave; narrow lanes walk narrow shapes', () => {
    const g = createGame({ headless: true });
    g.content.areas.forEach((a: any) => {
      if (a.id === 'backyard') return;
      expect(a.waves.some((_: string, i: number) => signatureFor(a.id, i)), a.id).toBe(true);
      if (latticeFor(a.id).cols <= 5) a.waves.forEach((_: string, i: number) => expect(['flanks', 'pillars', 'block', 'barrel'], a.id).not.toContain(shapeFor(0, i, latticeFor(a.id).cols)));
    });
  });

  it('reinforcements: the rack never holds more than its cells; the spill flies in later', () => {
    const g = createGame({ headless: true });
    g.content.areas.forEach((a: any, ai: number) => a.waves.forEach((wid: string, i: number) => {
      const w = g.content.waves.find((x: any) => x.id === wid)!; const M = latticeFor(a.id).cols;
      const p = plan(w, shapeFor(ai, i, M), i, (id: string) => g.content.enemies.find((e: any) => e.id === id)!, 34, M);
      expect(p.homes.length, `${a.id}/${i}`).toBeLessThanOrEqual(p.cells.length);
      expect(Math.max(...p.homes.map(h => h.row)), `${a.id}/${i}`).toBeLessThan(4);
    }));
  });

  it('Big Cat escorts keep a cat of air from the boss hitbox and from each other, inside the lane', () => {
    const g = createGame({ headless: true });
    g.mods.world.newGame();
    const I = g.mods.interaction;
    for (const a of g.content.areas) {
      g.state.areaId = a.id; g.state.scene = 'play';
      I.startBoss(a.boss ?? 'boss_whiskers');
      const b = I.boss; b.entering = false; b.x = (I.bossRange()[0] + I.bossRange()[1]) / 2; b.y = 76; b.phase = 1;
      I.escAx = b.x; I.escAy = b.y;
      const n = I.escGeo().slots.length; const [l, r] = laneOf(a.id);
      const ps = Array.from({ length: n }, (_, k) => I.escSlot(k));
      for (const [lo, hi] of [I.bossRange()]) for (const bx of [lo, hi]) {
        I.escAx = bx;
        const qs = Array.from({ length: n }, (_, k) => I.escSlot(k));
        for (const q of qs) {
          expect(q[0] - 14, `${a.id} wall`).toBeGreaterThanOrEqual(l + WALL_GAP);
          expect(q[0] + 14, `${a.id} wall`).toBeLessThanOrEqual(r - WALL_GAP);
          const cheb = Math.max(Math.abs(q[0] - bx) - b.r, Math.abs(q[1] - b.y) - b.r) - 14;
          expect(cheb, `${a.id} escort vs boss`).toBeGreaterThanOrEqual(a.id === 'mothership' ? 16 : 28);
        }
        for (const p of qs) for (const q of qs) if (p !== q) expect(Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1])), `${a.id} escorts`).toBeGreaterThanOrEqual(56);
      }
      expect(ps.length, a.id).toBeGreaterThanOrEqual(4);
    }
  });
});
