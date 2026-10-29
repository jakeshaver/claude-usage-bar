import { describe, it, expect } from 'vitest';
import { createGame } from '../core/boot';
import { shapeFor, entryFor, latticeFor, laneOf, COL_SP, WALL_GAP } from './formation';

const entriesOf = (g: any, a: any) => a.waves.map((id: string) => g.content.waves.find((w: any) => w.id === id)?.entry ?? 'swirl-left');

describe('interaction waves', () => {
  it('consecutive waves of a sector never repeat a formation shape or an entry', () => {
    const g = createGame({ headless: true });
    g.content.areas.forEach((a, ai) => {
      const es = entriesOf(g, a);
      for (let i = 1; i < a.waves.length; i++) {
        expect(shapeFor(ai, i), `${a.id} wave ${i} shape`).not.toBe(shapeFor(ai, i - 1));
        expect(entryFor(ai, i, es), `${a.id} wave ${i} entry`).not.toBe(entryFor(ai, i - 1, es));
      }
    });
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
});
