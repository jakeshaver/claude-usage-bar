// Memories: lost-memory recovery (missed / offer) across branch skips, the final-sector bundle, and the cozy
// reveal freeze never leaving the game paused. Lives next to the module; see docs/core-requests/memories.md
// (the vitest include needs 'src/**/*.test.ts' for `npm test` to pick it up).
import { describe, it, expect } from 'vitest';
import { createGame } from '../core/boot';
import { runPath } from '../../tools/bot-core';

/** straight into a wave, the way the showcases do it (no intro dialogue) */
function playing(g: any) {
  g.mods.world.enterArea('street', 1); g.mods.quest.dlg = null; g.setScene('play'); g.mods.world.titleCard = 0;
  for (let i = 0; i < 60; i++) g.step();
}
const ids = (xs: { id: string }[]) => xs.map(x => x.id);

function fresh() {
  const g = createGame({ headless: true, seed: 7 });
  const M = g.mods.memories;
  return { g, M };
}

describe('memories: lost-memory recovery', () => {
  it('a memory on the route not taken becomes missed once Pom is past that sector', () => {
    const { g, M } = fresh();
    const s = g.state;
    // took street > park; alley (mem_06) was skipped
    s.areasCleared = ['backyard', 'street', 'park'];
    s.memories = ['mem_01', 'mem_02', 'mem_03', 'mem_04', 'mem_05'];
    expect(ids(M.missed('park', 9))).toEqual([]);                 // alley is not "behind" park in sector order
    expect(ids(M.missed('rooftops', 0))).toEqual(['mem_06']);     // but it is behind rooftops
    const o = M.offer('rooftops', 0);
    expect(o).toMatchObject({ id: 'mem_06', lost: true, more: [] });
    // rooftops' own memory waves keep their own photo first
    expect(M.offer('rooftops', 2)).toMatchObject({ id: 'mem_07', lost: false });
  });

  it('earlier waves of the same sector count as missed, later ones do not', () => {
    const { g, M } = fresh();
    g.state.areasCleared = []; g.state.memories = [];
    expect(ids(M.missed('backyard', 3))).toEqual(['mem_01']);
    expect(ids(M.missed('backyard', 5))).toEqual(['mem_01', 'mem_02']);
    expect(M.offer('backyard', 3)).toMatchObject({ id: 'mem_01', lost: true });
  });

  it('skipping every branch queues the lost memories oldest first, one per memory-less wave', () => {
    const { g, M } = fresh();
    const s = g.state;
    s.areasCleared = ['backyard', 'street', 'park', 'rooftops', 'cafe', 'factory', 'sky', 'moon'];
    s.memories = ['mem_01', 'mem_02', 'mem_03', 'mem_04', 'mem_05', 'mem_07', 'mem_08', 'mem_09', 'mem_11', 'mem_12', 'mem_13', 'mem_14'];
    expect(ids(M.missed('station', 0))).toEqual(['mem_06', 'mem_10', 'mem_15']);
    const seen: string[] = [];
    for (let w = 0; w < 11; w++) {
      const o = M.offer('station', w); if (!o) continue;
      expect(o.more).toEqual([]);                                   // not the final sector: one photo per carrier
      if (!o.lost) { expect(o.id).toBe('mem_16'); expect(w).toBe(4); }
      else seen.push(o.id);
      s.memories.push(o.id);                                        // Pom catches it
    }
    expect(seen).toEqual(['mem_06', 'mem_10', 'mem_15']);
    expect(s.memories).toContain('mem_16');
  });

  it('in the final sector the first carrier brings the whole backlog, so 18/18 stays reachable', () => {
    const { g, M } = fresh();
    const s = g.state;
    s.areasCleared = ['backyard', 'street', 'alley', 'rooftops', 'docks', 'factory', 'sky', 'nebula', 'station'];
    // a worst case: several memories never caught (e.g. dropped by save edits or a skipped sector)
    s.memories = ['mem_01', 'mem_02', 'mem_03', 'mem_06', 'mem_07', 'mem_10', 'mem_11', 'mem_12', 'mem_15'];
    const o = M.offer('mothership', 0)!;
    expect(o.lost).toBe(true);
    const all = [o.id, ...ids(o.more)].sort();
    expect(all).toEqual(['mem_04', 'mem_05', 'mem_08', 'mem_09', 'mem_13', 'mem_14', 'mem_16']);
    // the mothership's own memories still come with their own carriers
    expect(M.offer('mothership', 2)!.id).toBe('mem_17');
  });

  it('nothing is offered twice while its photo is still in the air', () => {
    const { g, M } = fresh();
    g.state.memories = [];
    M.drops.push({ id: 'mem_01', x: 0, y: 0, vx: 0, vy: 0, t: 0, lost: false, swoop: false, more: [] });
    expect(M.offer('backyard', 1)).toBeNull();
    expect(M.offer('backyard', 3)).toBeNull();                      // mem_01 is the only missed one, and it is flying
  });
});

describe('memories: reveal freeze', () => {
  it('collect() holds the game for the card and always hands the pause back', () => {
    const { g, M } = fresh();
    playing(g);
    expect(g.state.scene).toBe('play');
    M.collect('mem_03');
    g.step();
    expect(g.paused).toBe(true);
    expect(M.revealing()).toBe(true);
    for (let i = 0; i < 400; i++) g.step();
    expect(M.revealing()).toBe(false);
    expect(g.paused).toBe(false);
    expect(g.state.memories).toContain('mem_03');
  });

  it('toasts wait for the card, and Pom\'s hearts burst only after it leaves', () => {
    const { g, M } = fresh();
    playing(g);
    const ui = g.mods.ui; const bursts: string[] = [];
    const fx = g.mods.effects; const orig = fx.burst.bind(fx);
    fx.burst = (x: number, y: number, k: string) => { bursts.push(k); return orig(x, y, k); };
    ui.toasts = [];
    M.collect('mem_03');
    ui.toast('NEW QUEST: TEST');
    g.step();
    expect(ui.toasts.map((t: any) => t.text)).not.toContain('NEW QUEST: TEST');
    expect(bursts).not.toContain('hearts');
    for (let i = 0; i < 400 && M.revealing(); i++) g.step();
    g.step();
    expect(ui.toasts.map((t: any) => t.text)).toContain('NEW QUEST: TEST');
    expect(bursts).toContain('hearts');
  });

  it('the card never goes up right as a wave starts: it waits (play goes on), then holds the game', () => {
    const { g, M } = fresh();
    playing(g);
    g.bus.emit('wave:start', { areaId: 'street', waveIndex: 1, count: 0 });
    M.collect('mem_03');
    expect(g.state.memories).toContain('mem_03');                 // safe in the album straight away
    g.step();
    expect(g.paused).toBe(false);
    expect(M.showing()).toBe(false);
    for (let i = 0; i < 400 && !M.showing(); i++) g.step();   // (the director starts the real wave meanwhile)
    expect(M.showing()).toBe(true);
    expect(g.paused).toBe(true);
  });

  it('the card waits out a boss telegraph or attack', () => {
    const { g, M } = fresh();
    playing(g);
    const boss: any = { st: 'tell' };
    g.mods.interaction.boss = boss;
    M.collect('mem_04');
    for (let i = 0; i < 10; i++) g.step();
    expect(M.showing()).toBe(false);
    expect(g.paused).toBe(false);
    g.mods.interaction.boss = null;
    g.step();
    expect(M.showing()).toBe(true);
  });

  it('a scene change mid-reveal (dialogue) releases the pause instead of softlocking', () => {
    const { g, M } = fresh();
    playing(g);
    M.collect('mem_04'); g.step();
    expect(g.paused).toBe(true);
    g.setScene('dialogue');
    expect(g.paused).toBe(false);
  });

  it('the bot still finds all 18 memories on a route that skips park, cafe and moon', () => {
    const r = runPath(['street', 'alley', 'rooftops', 'docks', 'factory', 'sky', 'nebula', 'station', 'mothership']);
    expect(r.softlock).toBeNull();
    expect(r.memories).toBe(18);
  });
});

describe('memories: bundle collapse', () => {
  it('three or more photos caught at once make one bundle card, not a long queue of freezes', () => {
    const { g, M } = fresh();
    playing(g);
    g.state.memories = [];
    const six = g.content.memories.slice(0, 6).map((m: any) => m.id);
    M.collectMany(six);
    expect(g.state.memories.length).toBe(6);
    expect(M.reveals.length).toBe(1);
    expect(M.reveals[0].ids).toEqual(six);
    // ~3 s in all, then play resumes on its own
    for (let i = 0; i < 200; i++) g.step();
    expect(M.revealing()).toBe(false);
    expect(g.paused).toBe(false);
  });
  it('a third single card joining a queue of two collapses the waiting ones', () => {
    const { g, M } = fresh();
    playing(g);
    g.state.memories = [];
    const [a, b, c] = g.content.memories.slice(0, 3).map((m: any) => m.id);
    M.collect(a); g.step(); M.collect(b); M.collect(c);
    expect(M.reveals.length).toBe(2);
    expect(M.reveals[1].ids).toEqual([b, c]);
  });
});
