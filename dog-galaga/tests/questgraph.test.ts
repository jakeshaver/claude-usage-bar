import { describe, it, expect } from 'vitest';
import { exploreAll } from '../tools/bot-core';
import { loadContent } from '../src/core/content';

describe('quest graph', () => {
  it('every path through the sector graph reaches an ending with no softlock', () => {
    const results = exploreAll(1337);
    const { content } = loadContent();
    expect(results.length).toBeGreaterThanOrEqual(4);
    for (const r of results) {
      expect(r.softlock, r.route.join('>')).toBeNull();
      expect(r.ending, r.route.join('>')).toBeTruthy();
      expect(r.errors, r.route.join('>')).toEqual([]);
    }
    const visited = new Set(results.flatMap(r => r.route).concat(content.start));
    for (const a of content.areas) expect(visited.has(a.id), `area ${a.id} visited`).toBe(true);
  });
});
