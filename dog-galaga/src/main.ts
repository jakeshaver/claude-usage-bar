import { createGame } from './core/boot';
import { CanvasRenderer } from './core/render';
import { makeApi } from './core/api';
import { runShowcase } from './showcase/index';

const params = new URLSearchParams(location.search);
const seed = params.has('seed') ? +params.get('seed')! : 1337;
const g = createGame({ seed });
const root = document.getElementById('app')!;
const r = new CanvasRenderer(root);
g.input.attach(window);
const api = makeApi(g, { fps: () => r.fpsValue });
(window as any).__game = api;

// Global safety net: nothing escapes as an uncaught crash.
addEventListener('error', e => { g.reportError('window', e.error ?? e.message); e.preventDefault(); });
addEventListener('unhandledrejection', e => { g.reportError('promise', e.reason); e.preventDefault(); });

// Boot: resume save if present, else title. URL params stage a scene for tools.
try {
  g.setScene('title');
  if (params.get('state')) api.setState(JSON.parse(atob(params.get('state')!)));
  if (params.get('autopilot')) g.autopilot = true;
  const sc = params.get('showcase');
  if (sc) runShowcase(g, sc, params);
  else if (params.get('area')) g.mods.world.enterArea(params.get('area')!, +(params.get('wave') ?? 0));
  else if (params.get('scene')) g.mods.world.goto(params.get('scene') as any, {});
  if (params.get('tod')) g.state.tod = params.get('tod') as any;
  if (params.get('advance')) api.step(+params.get('advance')!);
  if (params.get('tod')) g.state.tod = params.get('tod') as any;
  if (params.get('freeze')) g.paused = true;
} catch (e) { g.reportError('boot', e); }

// Fixed 60 Hz timestep with render interpolation-free integer drawing.
let last = performance.now(), acc = 0;
const STEP = 1000 / 60;
function frame(now: number) {
  acc += Math.min(250, now - last); last = now;
  let n = 0;
  while (acc >= STEP && n < 5) { g.step(); acc -= STEP; n++; }
  if (n === 5) acc = 0;
  r.frame(g, now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
api.ready = true;
document.body.dataset.ready = '1';
