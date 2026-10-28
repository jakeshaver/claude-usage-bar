import { describe, it, expect } from 'vitest';
import { runPath } from '../tools/bot-core';
import { createGame } from '../src/core/boot';
import { loadContent } from '../src/core/content';

describe('determinism + isolation', () => {
  it('same seed and inputs produce the same playthrough', () => {
    const a = runPath(['street', 'alley']), b = runPath(['street', 'alley']);
    expect(a.score).toBe(b.score); expect(a.ticks).toBe(b.ticks); expect(a.route).toEqual(b.route);
  });
  it('malformed content files fall back to defaults instead of crashing', () => {
    const { content, issues } = loadContent({ areas: 'not an array', waves: [{ id: 3 }], enemies: null } as any);
    expect(issues.length).toBeGreaterThan(0);
    expect(content.areas.length).toBeGreaterThan(0);
    const g = createGame({ headless: true, content: { areas: [{ id: 'x' }] } as any });
    g.mods.world.newGame();
    for (let i = 0; i < 2000; i++) g.step();
    expect(g.state.scene).not.toBe('boot');
  });
  it('a throwing module is isolated and the game keeps ticking', () => {
    const g = createGame({ headless: true });
    g.register({ id: 'broken', update: () => { throw new Error('boom'); } });
    g.mods.world.newGame();
    for (let i = 0; i < 100; i++) g.step();
    expect(g.errors.some(e => e.module === 'broken')).toBe(true);
    expect(g.disabled.has('broken')).toBe(true);
    expect(g.tick).toBe(100);
  });
});
