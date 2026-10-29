import { describe, it, expect } from 'vitest';
import { runPath } from '../tools/bot-core';
import { loadContent } from '../src/core/content';

describe('endings', () => {
  it('ending_good is reachable when no pup is ever rescued', () => {
    // Hook: every tick, un-pup every capturer and drop any falling pup pickup before Pom can catch it, so lost_pups never completes.
    const res = runPath([], 1337, {
      onTick: (api: any) => {
        const ia = api.game.mods.interaction;
        for (const c of ia.cats) if (c.pup) c.pup = false;   // capturers lose their pup before they can drop it
        if (ia.pickups.some((k: any) => k.kind === 'pup')) ia.pickups = ia.pickups.filter((k: any) => k.kind !== 'pup');
      },
    });
    expect(res.softlock, res.route.join('>')).toBeNull();
    expect(res.errors).toEqual([]);
    expect(res.pups).toBe(0);
    expect(res.quests.lost_pups).not.toBe('done');
    expect(res.ending).toBe('ending_good');
  });

  it('ending_true is reached when all pups are rescued (bot default)', () => {
    const res = runPath([], 1337);
    expect(res.softlock).toBeNull();
    expect(res.ending).toBe('ending_true');
  });

  it('the area graph has no path that misses an ending (all exits, ignoring gates)', () => {
    const { content } = loadContent();
    const byId = new Map(content.areas.map(a => [a.id, a]));
    const endingIds = new Set(content.endings.map(e => e.id));
    expect(byId.has(content.start)).toBe(true);
    let paths = 0;
    const walk = (id: string, trail: string[]) => {
      const a = byId.get(id);
      expect(a, `area ${id} exists (from ${trail.join('>')})`).toBeTruthy();
      expect(trail.includes(id), `cycle at ${[...trail, id].join('>')}`).toBe(false);
      const next = [...trail, id];
      if (a!.ending) { expect(endingIds.has(a!.ending), `ending ${a!.ending} defined`).toBe(true); expect(a!.exits.length).toBe(0); paths++; return; }
      expect(a!.exits.length, `dead end at ${next.join('>')}`).toBeGreaterThan(0);
      expect(a!.exits.some(e => !e.when), `${id} has an unconditional exit`).toBe(true);
      for (const e of a!.exits) walk(e.to, next);
    };
    walk(content.start, []);
    expect(paths).toBeGreaterThanOrEqual(8);
    // every ending in content is wired to some area or is condition-selected
    for (const e of content.endings) expect(content.areas.some(a => a.ending === e.id) || !!e.when, `ending ${e.id} reachable`).toBe(true);
  });
});
