import { describe, it, expect } from 'vitest';
import { createGame } from '../core/boot';
import { BONUS_TIMING } from './index';

/**
 * Treat Bonanza watchdog contract: whatever interaction does (throws, never starts a flight, starts one and
 * never reports, or someone switches the scene underneath), bonus:end fires exactly once and the game is
 * handed back in 'play'.
 */
function setup(stub?: (inter: any) => void) {
  const g = createGame({ headless: true });
  const W: any = g.mods.world; const a = g.content.areas.find(x => x.bonus)!;
  W.enterArea(a.id, 0); W.phase = 'done'; W.titleCard = 0; g.mods.quest.dlg = null; g.setScene('play');
  const inter: any = g.mods.interaction; if (stub) stub(inter);
  const ends: any[] = []; g.bus.on('bonus:end', (p: any) => ends.push(p));
  return { g, id: a.bonus!, ends };
}
/** Step until the scene is back to 'play' (or `max` ticks), returning the ticks it took. */
function run(g: any, max: number) { let n = 0; while (n < max && g.state.scene !== 'play') { g.step(); n++; } for (let i = 0; i < 30; i++) g.step(); return n; }

const { INTRO, NO_FLIGHT, HARD_CAP, RESULTS_MAX } = BONUS_TIMING;
const FAST = INTRO + NO_FLIGHT + RESULTS_MAX + 10;

describe('minigames: Treat Bonanza always ends', () => {
  it('a throwing interaction.startBonus still opens the results and hands back control', () => {
    const { g, id, ends } = setup(i => { i.startBonus = () => { throw new Error('boom'); }; });
    g.mods.minigames.startBonus(id);
    expect(g.state.scene).toBe('bonus');
    const n = run(g, FAST + 600);
    expect(n).toBeLessThanOrEqual(INTRO + RESULTS_MAX + 10);
    expect(ends.length).toBe(1); expect(ends[0].id).toBe(id);
    expect(g.state.scene).toBe('play'); expect(g.mods.minigames.active()).toBe(false);
  });

  it('a no-op interaction.startBonus trips the no-flight watchdog', () => {
    const { g, id, ends } = setup(i => { i.startBonus = () => {}; });
    g.mods.minigames.startBonus(id);
    const n = run(g, FAST + 600);
    expect(n).toBeLessThanOrEqual(FAST);
    expect(ends.length).toBe(1); expect(g.state.scene).toBe('play');
  });

  it('a flight that never reports back is cut off by the fly limit', () => {
    const { g, id, ends } = setup(i => { i.startBonus = () => { i.mode = 'bonus'; }; i.update = () => {}; });
    g.mods.minigames.startBonus(id);
    const limit = g.mods.minigames.flyLimit as number;
    const n = run(g, HARD_CAP + 1200);
    expect(n).toBeLessThanOrEqual(INTRO + limit + RESULTS_MAX + 10);
    expect(ends.length).toBe(1); expect(g.state.scene).toBe('play');
  });

  it('the scene switched back to play underneath it still reports once', () => {
    const { g, id, ends } = setup();
    g.mods.minigames.startBonus(id);
    for (let i = 0; i < INTRO + 30; i++) g.step();
    g.setScene('play');
    for (let i = 0; i < 60; i++) g.step();
    expect(ends.length).toBe(1); expect(g.mods.minigames.active()).toBe(false);
  });

  it('the real flight ends, reports exactly once, and a second start mid-stage is ignored', () => {
    const { g, id, ends } = setup();
    const starts: any[] = []; g.bus.on('bonus:start', (p: any) => starts.push(p));
    g.mods.minigames.startBonus(id); g.mods.minigames.startBonus(id);
    for (let i = 0; i < 50; i++) g.step();
    g.mods.minigames.startBonus(id);
    run(g, HARD_CAP + 1200);
    expect(starts.length).toBe(1); expect(ends.length).toBe(1); expect(g.state.scene).toBe('play');
    expect(g.errors.filter((e: any) => e.module === 'minigames')).toEqual([]);
  });

  it('an unknown stage id ends immediately without touching the scene', () => {
    const { g, ends } = setup();
    g.mods.minigames.startBonus('no_such_bonus');
    expect(ends.length).toBe(1); expect(g.state.scene).toBe('play'); expect(g.mods.minigames.active()).toBe(false);
  });
});
