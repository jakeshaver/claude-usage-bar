import type { Game } from './game';
import { sanitizeState } from './state';
import type { Tod } from './types';
import type { Action } from './input';

/** window.__game: the public API used by tools, tests and the playthrough bot. */
export function makeApi(g: Game, extra: { fps: () => number } = { fps: () => 60 }) {
  return {
    ready: false,
    game: g,
    getState: () => JSON.parse(JSON.stringify(g.state)),
    setState: (partial: any) => { g.replaceState(sanitizeState({ ...g.state, ...partial }, g.state.seed)); g.bus.emit('state:set', {}); },
    goto: (scene: any, opts: any = {}) => g.mods.world?.goto?.(scene, opts),
    enterArea: (id: string, wave = 0) => g.mods.world?.enterArea(id, wave),
    setTod: (tod: Tod) => g.mods.world?.setTod(tod),
    step: (n = 1) => { for (let i = 0; i < n; i++) g.step(); },
    input: (keys: Action[]) => { g.input.synthetic = new Set(keys); },
    autopilot: (on = true) => { g.autopilot = on; },
    questGraph: () => g.mods.world?.graph?.(),
    errors: () => g.errors.slice(),
    contentIssues: () => g.contentIssues.slice(),
    fps: extra.fps,
    save: () => g.mods.save?.save(),
    load: () => g.mods.save?.load(),
    events: () => g.bus.log.slice(-100),
  };
}
