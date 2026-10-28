import type { GameState } from './types';
import type { Bus } from './bus';

export const STATE_VERSION = 1;

export function freshState(seed = 1337): GameState {
  return {
    version: STATE_VERSION, seed, scene: 'title', areaId: 'backyard', waveIndex: 0, tod: 'day',
    score: 0, hiScore: 0, hearts: 3, maxHearts: 3,
    flags: {}, quests: {}, inventory: {}, memories: [], areasCleared: [], ending: null,
    stats: { shots: 0, hits: 0, naps: 0, playTicks: 0, catsBooped: 0 },
    settings: { music: 0.6, sfx: 0.8, shake: true, touch: 'auto' },
  };
}

/** Mutation helpers. They emit events so quests/ui can react. */
export class StateOps {
  constructor(public s: GameState, private bus: Bus) {}
  setFlag(flag: string, value = true) {
    if (this.s.flags[flag] === value) return;
    this.s.flags[flag] = value; this.bus.emit('flag:set', { flag, value });
  }
  addItem(itemId: string, count = 1) {
    this.s.inventory[itemId] = (this.s.inventory[itemId] ?? 0) + count;
    this.bus.emit('item:get', { itemId, count });
  }
  addScore(n: number) {
    this.s.score += n; if (this.s.score > this.s.hiScore) this.s.hiScore = this.s.score;
  }
  addMemory(id: string) {
    if (this.s.memories.includes(id)) return;
    this.s.memories.push(id); this.bus.emit('memory:get', { memoryId: id });
  }
  setQuest(id: string, st: GameState['quests'][string]) {
    if (this.s.quests[id] === st) return;
    this.s.quests[id] = st; this.bus.emit('quest:update', { questId: id, state: st });
  }
}

/** Repairs a loaded/partial state so missing or wrong-typed fields never crash. */
export function sanitizeState(raw: any, seed = 1337): GameState {
  const base = freshState(seed);
  if (!raw || typeof raw !== 'object') return base;
  const out: any = { ...base };
  for (const k of Object.keys(base) as (keyof GameState)[]) {
    const bv: any = (base as any)[k]; const rv = raw[k];
    if (rv === undefined || rv === null) continue;
    if (Array.isArray(bv)) out[k] = Array.isArray(rv) ? rv.filter((x: any) => typeof x === 'string') : bv;
    else if (typeof bv === 'object' && bv !== null) out[k] = typeof rv === 'object' && !Array.isArray(rv) ? { ...bv, ...rv } : bv;
    else if (k === 'ending') out[k] = typeof rv === 'string' ? rv : null;
    else out[k] = typeof rv === typeof bv ? rv : bv;
  }
  if (out.hearts < 1) out.hearts = out.maxHearts;
  return out as GameState;
}
