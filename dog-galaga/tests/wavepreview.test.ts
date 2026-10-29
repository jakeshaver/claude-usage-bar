import { describe, it, expect } from 'vitest';
import { createGame } from '../src/core/boot';

describe('interaction.wavePreview', () => {
  it('matches the formation startWave really spawns, with no state change', () => {
    const g = createGame({ headless: true });
    g.mods.world.newGame();
    const I = g.mods.interaction;
    for (const a of g.content.areas) {
      (a.waves ?? []).forEach((_: string, i: number) => {
        g.state.areaId = a.id; g.state.waveIndex = i;
        const tick = g.tick;
        const prev: { breed: string; n: number }[] = I.wavePreview(a.id, i);
        expect(g.tick).toBe(tick);
        I.startWave(a.id, i);
        const real: Record<string, number> = {};
        for (const c of I.cats) real[c.def.id] = (real[c.def.id] ?? 0) + 1;
        const want: Record<string, number> = {};
        for (const p of prev) want[p.breed] = p.n;
        expect(real, `${a.id} wave ${i}`).toEqual(want);
      });
    }
  });
});
