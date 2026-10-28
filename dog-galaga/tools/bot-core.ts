// Playthrough bot core: drives the headless game through its public API, explores every quest-graph path.
import { createGame } from '../src/core/boot';
import { makeApi } from '../src/core/api';

export interface PathResult { route: string[]; ending: string | null; ticks: number; minutes: number; softlock: string | null; score: number; pups: number; memories: number; quests: Record<string, string>; naps: number; errors: string[]; branches: string[][] }

const STALL = 60 * 60 * 6;   // 6 minutes of game time with no progress = softlock
const LIMIT = 60 * 60 * 180;   // 3 hours hard cap per path

export function runPath(route: string[], seed = 1337, opts: { onTick?: (api: any) => void } = {}): PathResult {
  const g = createGame({ headless: true, seed });
  const api = makeApi(g); api.autopilot(true); g.botDrivesMap = true;
  let lastProgress = 0; const branches: string[][] = []; const taken: string[] = [];
  const mark = () => { lastProgress = g.tick; };
  for (const e of ['wave:clear', 'boss:defeat', 'area:clear', 'bonus:end', 'area:enter', 'dialogue:open']) g.bus.on(e, mark);
  g.mods.world.newGame();
  let softlock: string | null = null;
  while (g.state.scene !== 'ending') {
    if (g.state.scene === 'map') {
      const exits = g.mods.world.exitsFrom(g.state.areaId).map((x: any) => x.to);
      if (!exits.length) { softlock = `no exits from ${g.state.areaId}`; break; }
      const i = taken.length;
      const choice = route[i] && exits.includes(route[i]) ? route[i] : exits[0];
      if (!route[i]) for (const alt of exits.slice(1)) branches.push([...taken, alt]);
      taken.push(choice); g.mods.world.chooseExit(choice); mark();
    }
    if (g.state.scene === 'title') { softlock = 'fell back to title'; break; }
    if (g.state.scene === 'recovery') { softlock = 'recovery screen during play'; break; }
    api.step(1); opts.onTick?.(api);
    if (g.tick - lastProgress > STALL) { softlock = `stalled in ${g.state.areaId} wave ${g.state.waveIndex} phase ${g.mods.world.phase} scene ${g.state.scene}`; break; }
    if (g.tick > LIMIT) { softlock = 'time limit'; break; }
  }
  const s = g.state;
  return { route: taken, ending: s.ending, ticks: s.stats.playTicks, minutes: Math.round(s.stats.playTicks / 3600), softlock, score: s.score, pups: s.inventory.pups ?? 0,
    memories: s.memories.length, quests: { ...s.quests }, naps: s.stats.naps, errors: g.errors.map(e => `${e.module}: ${e.message}`), branches };
}

export function exploreAll(seed = 1337, log: (s: string) => void = () => {}) {
  const queue: string[][] = [[]]; const results: PathResult[] = []; const seen = new Set<string>();
  while (queue.length) {
    const r = queue.shift()!; const key = r.join('>'); if (seen.has(key)) continue; seen.add(key);
    const t0 = Date.now(); const res = runPath(r, seed);
    log(`path ${res.route.join(' > ')}: ending=${res.ending} ${res.minutes}min softlock=${res.softlock} pups=${res.pups} mem=${res.memories} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    results.push(res); queue.push(...res.branches);
  }
  return results;
}
