import { Bus } from './bus';
import { Rng, hash } from './rng';
import { freshState, StateOps } from './state';
import { loadContent } from './content';
import type { Content, GameState, Scene } from './types';
import type { Issue } from './schema';
import { Input } from './input';

export const W = 640, H = 360;
export const PF_X = 128, PF_W = 384;          // playfield viewport on screen
export const WORLD_W = 448;                    // playfield world width (camera pans 64px)
export const TICK_HZ = 60;
/** modules that keep updating during an effects hit-stop */
const HITSTOP_LIVE = new Set(['effects', 'ui', 'audio']);

export interface Renderer {
  ctx: CanvasRenderingContext2D;
  /** queue a y-sorted playfield draw */
  push(layer: number, y: number, fn: (ctx: CanvasRenderingContext2D) => void): void;
}

export interface Module {
  id: string;
  init?(g: Game): void;
  update?(g: Game): void;
  /** playfield render (world coords translated by camera); called inside y-sort batch */
  render?(g: Game, r: Renderer): void;
  /** screen-space overlay render (HUD/menus), after playfield */
  overlay?(g: Game, ctx: CanvasRenderingContext2D): void;
  api?: any;
}

export interface ErrorRec { module: string; message: string; tick: number }

export class Game {
  bus = new Bus();
  state: GameState;
  ops: StateOps;
  content: Content;
  contentIssues: Issue[];
  input = new Input();
  rng: Rng;
  tick = 0;
  paused = false;
  headless: boolean;
  mods: Record<string, any> = {};
  modules: Module[] = [];
  errors: ErrorRec[] = [];
  failCount: Record<string, number> = {};
  disabled = new Set<string>();
  autopilot = false;
  /** set by the playthrough bot so it, not the UI autopilot, picks map exits */
  botDrivesMap = false;
  toastFn: (t: string) => void = () => {};

  constructor(opts: { headless?: boolean; seed?: number; content?: Record<string, unknown> } = {}) {
    this.headless = !!opts.headless;
    const { content, issues } = loadContent(opts.content as any);
    this.content = content; this.contentIssues = issues;
    this.state = freshState(opts.seed ?? 1337);
    this.ops = new StateOps(this.state, this.bus);
    this.rng = new Rng(this.state.seed);
    this.bus.onError = (m, e) => this.reportError(m, e);
  }

  /** Swap in a whole new state object (load / setState) keeping ops in sync. */
  replaceState(s: GameState) { this.state = s; this.ops.s = s; }

  reseed(...parts: (string | number)[]) { this.rng = new Rng(hash(this.state.seed, ...parts)); }

  register(m: Module) {
    this.modules.push(m); this.mods[m.id] = m.api ?? m;
  }

  init() { for (const m of this.modules) if (m.init) this.safe(m.id, () => m.init!(this)); }

  setScene(to: Scene) {
    const from = this.state.scene; if (from === to) return;
    this.state.scene = to; this.bus.emit('scene:change', { from, to });
  }

  reportError(module: string, e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    this.errors.push({ module, message, tick: this.tick });
    if (this.errors.length > 200) this.errors.shift();
    if (!this.headless) console.warn(`[${module}]`, e);
    this.bus.emit('error', { module, message });
    this.toastFn(`A cat knocked over ${module}. Still flying!`);
  }

  /** Isolation boundary: a throwing module never takes the game down. */
  safe(module: string, fn: () => void) {
    if (this.disabled.has(module)) return;
    try { fn(); this.failCount[module] = 0; }
    catch (e) {
      this.failCount[module] = (this.failCount[module] ?? 0) + 1;
      if (this.failCount[module] === 1 || this.failCount[module] % 60 === 0) this.reportError(module, e);
      if (this.failCount[module] >= 30) this.disabled.add(module);
    }
  }

  step() {
    this.input.poll(this);
    // Presentational hit-stop: effects may hold the simulation for a few ticks (never headless, so the
    // bot and tests stay deterministic). Only effects, ui and audio keep updating while frozen.
    const frozen = !this.headless && !this.paused && !!this.mods.effects?.frozen?.();
    if (!this.paused && !frozen) {
      this.tick++; this.bus.tick = this.tick;
      if (this.state.scene === 'play' || this.state.scene === 'bonus') this.state.stats.playTicks++;
    }
    for (const m of this.modules) {
      if (frozen && !HITSTOP_LIVE.has(m.id)) continue;
      if (m.update) this.safe(m.id, () => m.update!(this));
    }
    this.input.endFrame();
  }
}
