import { describe, it, expect } from 'vitest';
import { createGame } from '../src/core/boot';
import { makeApi } from '../src/core/api';

function playUntil(g: any, pred: () => boolean, max = 60 * 60 * 60) { for (let i = 0; i < max && !pred(); i++) { if (g.state.scene === 'map') { const ex = g.mods.world.exitsFrom(g.state.areaId); g.mods.world.chooseExit(ex[0].to); } g.step(); } }

describe('save / quit / resume', () => {
  it('resumes mid-quest at the same area, wave, score and quest state', () => {
    const g = createGame({ headless: true }); makeApi(g).autopilot(true);
    g.mods.world.newGame();
    playUntil(g, () => g.state.areaId === 'street' && g.state.waveIndex >= 3);
    expect(g.state.quests.lost_pups).toBe('active');
    g.mods.save.save();
    const raw = g.mods.save.store.get('poodle-patrol:save');
    const snap = JSON.parse(JSON.stringify(g.state));
    // "quit": brand new game process with the same storage contents
    const g2 = createGame({ headless: true });
    g2.mods.save.store.set('poodle-patrol:save', raw);
    expect(g2.mods.save.load()).toBe('ok');
    expect(g2.state.areaId).toBe(snap.areaId);
    expect(g2.state.waveIndex).toBe(snap.waveIndex);
    expect(g2.state.score).toBe(snap.score);
    expect(g2.state.quests).toEqual(snap.quests);
    expect(g2.state.memories).toEqual(snap.memories);
    expect(g2.state.scene).toBe('play');
    // and it can keep playing to the end of the area
    makeApi(g2).autopilot(true);
    playUntil(g2, () => g2.state.areasCleared.includes('street'));
    expect(g2.state.areasCleared).toContain('street');
    expect(g2.errors).toEqual([]);
  });

  it('corrupt main save falls back to backup; both corrupt shows recovery, never throws', () => {
    const g = createGame({ headless: true });
    g.mods.world.newGame(); g.state.score = 1234; g.mods.save.save(); g.state.score = 5678; g.mods.save.save();
    g.mods.save.store.set('poodle-patrol:save', '{"v":1,"data":"{bad json","sum":"x"}');
    expect(g.mods.save.load()).toBe('recovered');
    expect(g.state.score).toBe(1234);
    g.mods.save.store.set('poodle-patrol:save', 'garbage'); g.mods.save.store.set('poodle-patrol:backup', 'garbage too');
    expect(g.mods.save.load()).toBe('corrupt');
    expect(g.state.scene).toBe('recovery');
  });

  it('a save with wrong-typed / missing fields is sanitized', () => {
    const g = createGame({ headless: true });
    const data = JSON.stringify({ areaId: 'nowhere', score: 'lots', hearts: -5, memories: [1, 'mem_01'] });
    let h = 5381; for (let i = 0; i < data.length; i++) h = ((h << 5) + h + data.charCodeAt(i)) >>> 0;
    g.mods.save.store.set('poodle-patrol:save', JSON.stringify({ v: 1, data, sum: h.toString(36) }));
    expect(g.mods.save.load()).toBe('ok');
    expect(g.state.areaId).toBe('backyard'); expect(g.state.score).toBe(0); expect(g.state.hearts).toBeGreaterThan(0); expect(g.state.memories).toEqual(['mem_01']);
  });
});
