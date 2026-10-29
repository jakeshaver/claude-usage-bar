import type { Game, Module } from '../core/game';
import { WORLD_W, H } from '../core/game';
import type { EnemyDef, WaveDef, BonusDef } from '../core/types';
import { drawSprite } from '../art/sprite';
import { col } from '../core/palette';
import { entryPath, divePath, bonusPath, Track, type Pt, type TrackPos } from './paths';
import { tuning, type Tuning } from './tuning';
import { pxRing, pxDither, pxSpark, pxDisc } from '../core/pixel';
import { ditherShadow, captureBeam, bubble, drawBullet, drawCombat, plaster, tractor, pickupBadge } from './art';
import { Boss } from './boss';
import { COL_SP, ROW_SP, WALL_GAP, layout, shapeFor, entryFor, latticeFor, laneOf, cellsUnique, closeRows, type Shape, type Entry } from './formation';

export type CatState = 'wait' | 'enter' | 'home' | 'form' | 'dive' | 'return' | 'leave' | 'flyby' | 'kdive';
export interface Cat {
  id: number; def: EnemyDef; hp: number; x: number; y: number; vx: number; vy: number;
  st: CatState;
  slot: Pt; track: Track | null; s: number; speed: number; lat: number; weave: number;
  delay: number; t: number; flash: number; tell: number; shots: number; group: number;
  pup?: boolean; glow?: boolean; side: number; diveSeed: number; dead?: boolean; up?: boolean;
  beam?: number; beamUsed?: boolean;
  /** captive pup position: -1 riding above the holder (in formation), +1 hanging below it (in flight). */
  pupK?: number;
  /** bonus stage: squadron index (sent as `group` in the bonus cat:boop payload) */
  bgroup?: number;
  /** lattice cell (row index, column offset u in COL_SP units) and the home the cat glides on toward `slot` */
  row: number; u: number; home: Pt;
  /** stable row id and original column from the layout (close ranks keeps an untouched row's cells) */
  rid: number; u0: number;
  /** close-ranks glide: where the home started and ticks into the glide */
  gFrom: Pt; gT: number;
  /** two-step regroup: the sideways stop before the vertical slide (null: one straight glide) */
  gMid: Pt | null;
  /** entry: arc length where a cat flying abreast has closed up into single file */
  latEnd?: number;
  /** ticks parked in the cell since the last landing (a cat rests between dives) */
  rest: number;
  /** Big Cat escort: its slot index in the squad around the boss (undefined: a wave cat) */
  eslot?: number;
  /** dive wingmate: the leader's id and the arc offset its position is locked to (a full cell beside or ahead) */
  lead?: number; sOff?: number;
  /** dive: arc length of the exit down the empty column (it rides the rack's sway until then) and the sway at launch */
  exitLen?: number; sw0?: number;
}
/** `art` names the bullet sprite (cats: blt_fur / blt_yarn, bosses: one per bossPattern). */
export interface Shot { x: number; y: number; vx: number; vy: number; kind: 'turd' | 'hairball' | 'yarn'; t: number; art?: string }
export interface Pickup { kind: string; x: number; y: number; vy: number; t: number; vx?: number }

const WAVE_LIMIT = 75 * 60;  // cats lose interest after 75s, so waves can never stall
const MAX_TURDS = 4;
const WAVE_TURDS = 2;       // Galaga's two-shot limit against the formation (spread shots add their extra lanes)
// Formation grid (Galaga-like readability): at most 10 columns x 4 rows of flat rows, with clear lanes between cats.
// The top row sits under the HUD toast lane (a single toast spans y 8..22), the bottom row stays above y ~160.
const FORM_TOP = 50;
const STREAM_STEP = 11;     // ticks between cats in one entry lane (11 x 4.0 >= 44px along the path: 32px sprites never overlap)
const LANE_BREAK = 6;       // extra ticks between groups of 8 in one lane (Galaga's streams come in bursts)
const HURRY_DIVERS = 2;     // last stand: at most this many stragglers out of the grid at once (one leader + a wingmate)
const GLIDE_T = 32;         // ticks a home takes to slide when the grid closes ranks: every cat moves at once and lands
                            // together (the block morphs as one, so neighbours never slide through each other)
const REGROUP_LULL = 30;    // quiet ticks (no boop) before the rows below an emptied row move up: a burst of boops ends in one calm glide
const ENTRY_EDGE = 214;     // entry streams start just outside the visible playfield (half view 192 + a cat)
const BEAM_TICKS = 84;      // capturer's tractor-beam moment
const tp: TrackPos = { x: 0, y: 0, hx: 0, hy: 1 };
const hp: TrackPos = { x: 0, y: 0, hx: 0, hy: 1 };
const PUP_LIFT = 14;        // the formation sits this much lower when a captive pup rides above its holder: the bubble
                            // gets its own slot one row pitch above the top row, clear of the HUD toast lane (y <= 22)
const REST_TICKS = 24;      // a cat parks at least this long before it may dive again
const REST_LAST = 72;       // ...and much longer in the last stand: the stragglers visibly return between dives
const ESC_GAP = 60;         // ticks after the squad drops to one escort before the Big Cat whistles up the rest
/** How far each Big Cat tier's body and craft reach below its centre (cat, jets, saucer, the Empress's throne). */
const BOSS_BOTTOM = [34, 32, 38, 44];
/**
 * Escort squad around a Big Cat, slot i (pairs mirrored left/right) relative to the boss centre: a wedge cradling the
 * boss (Galaga's boss with its escorts in tow). Pair 0 rides under its shoulders, pair 1 up on the wings (a V-wedge),
 * pair 2 trails below the wings. Every escort is >= 30px from its neighbours and clear of every tier's craft, and the centre
 * strip under the boss stays open so Pom can always reach it.
 */
function escOffset(i: number, tier: number): Pt {
  const sg = i & 1 ? 1 : -1; const bot = BOSS_BOTTOM[tier] ?? 34;
  switch (i >> 1) {
    case 0: return [sg * 34, bot + 2];    // shoulders, low and close
    case 1: return [sg * 66, bot - 24];   // wings, up beside the boss: a V-wedge with the boss riding in its notch
    default: return [sg * 66, bot + 30];  // rear guard, trailing under the wings
  }
}
const ESC_EXT = 66 + 14;    // the squad's half width from the boss centre (outermost escort's far edge)
const HURRY_LEAVE = 6 * 60; // once only ~30% of a wave is left, stragglers dive from their slots, then fly off after 6s
/** Stages with no ground below the action (sky and space): nothing to cast a shadow on. */
const AIRBORNE = new Set(['sky', 'moon', 'nebula', 'station', 'mothership']);
/** Time-of-day tint for the combat layer (subtle: highlights cool at night, warm at dusk and dawn). */
const TOD_TINT: Record<string, Record<string, string> | undefined> = { night: { '6': 's' }, dusk: { '6': '7' }, dawn: { '6': '7' } };
/** Light rim around every cat on dark stages, so black / navy cats never melt into night floors. */
const TOD_RIM: Record<string, string | undefined> = { night: '5', dusk: '7' };
/** Floors light enough that cats read without the rim (fewer stacked outlines on a busy screen). */
const BRIGHT_FLOOR = new Set(['moon']);

/** Interaction: turds, cats, formations, dives, damage, bosses, pickups. */
class Interaction implements Module {
  id = 'interaction';
  api = this;
  g!: Game;
  cats: Cat[] = []; turds: Shot[] = []; spits: Shot[] = []; pickups: Pickup[] = [];
  boss: Boss | null = null;
  wave: WaveDef | null = null; waveT = 0; active = false; mode: 'none' | 'wave' | 'boss' | 'bonus' = 'none';
  bonus: { def: BonusDef; hits: number; total: number } | null = null;
  sway = 0; nextId = 1; pupHolder = -1; rowSp = ROW_SP; colSp = COL_SP; shape: Shape = 'galaga';
  T: Tuning = { d: 0, spitSpeed: 1.5, spitCap: 3, bossSpitCap: 14, fireEvery: 90, diveEvery: 180, diveGroups: 1, maxDivers: 3, diveSpeed: 2.7, entrySpeed: 2.7, diveShots: 1, tell: 22, aimSlop: 50 };
  fireT = 0; diveT = 0; breathMix = 0; entryDone = false; clearHold = 0; total = 0; formTop = FORM_TOP; hurry = 0;
  /** formation members at the last close-ranks pass (re-pack when one is booped) */
  ranks = -1; rankKey = -1; rankT = 0;
  /** cats per stable row id at the start of the wave */
  rowN = new Map<number, number>();
  /** formation centre (world x): rides with the panning camera, so the convoy stays centred and whole on screen */
  cx = WORLD_W / 2;
  /** lattice columns and sway amplitude (px) for this area's lane */
  cols = 8; amp = 6;
  /** this wave's entry choreography (content entry, or convoy / drop / flank / escort picked per wave) */
  entry: Entry = 'swirl-left';
  /** Big Cat escorts: countdown to the next squad, the squad's anchor x, the side the next squad streams in from */
  escT = 0; escAx = WORLD_W / 2; escAy = 76; escSide = 1;
  /** phase-change shockwaves around the Big Cat */
  shocks: { x: number; y: number; t: number }[] = [];

  // showcase staging (?showcase=interaction&stage=lineup|capturer|rescue|splitter|tank|dive|tell|boss|bullets|play)
  stageReq: string | null = null; staged = false; stageT = 0; stageAt = 0; stagePhase = 0; frozen = false;

  init(g: Game) {
    this.g = g;
    try {
      if (typeof location !== 'undefined' && location.search) {
        const p = new URLSearchParams(location.search);
        if (p.get('showcase') === 'interaction') { this.stageReq = p.get('stage') ?? 'play'; this.stageAt = +(p.get('at') ?? 0); this.stagePhase = +(p.get('phase') ?? 0); }
      }
    } catch { /* no URL (tests, headless bot) */ }
  }
  enemy(id: string) { return this.g.content.enemies.find(e => e.id === id) ?? this.g.content.enemies[0]; }

  clearAll() { this.cats = []; this.turds = []; this.spits = []; this.pickups = []; this.boss = null; this.active = false; this.mode = 'none'; this.bonus = null; this.shocks = []; }
  /** Pom napped: clear the air. Waves restart; a boss keeps its damage (cozy, never a full reset). */
  napReset() { this.turds = []; this.spits = []; this.pickups = []; if (this.boss) { this.boss.reenter(); this.cats = []; this.escT = 40; } else this.clearAll(); }
  liveCats() { return this.cats.length + (this.boss ? 1 : 0); }
  /** True when the stage has a floor to cast shadows on. */
  grounded() { return !AIRBORNE.has(this.g.state.areaId); }
  /** Rim colour for combat sprites at this time of day (undefined: no rim needed in daylight). */
  rimKey() { return BRIGHT_FLOOR.has(this.g.state.areaId) ? undefined : TOD_RIM[this.g.state.tod]; }
  tint() { return TOD_TINT[this.g.state.tod]; }

  private mkCat(def: EnemyDef, x: number, y: number, st: CatState, extra: Partial<Cat> = {}): Cat {
    const c: Cat = { id: this.nextId++, def, hp: def.hp, x, y, vx: 0, vy: 0, st, slot: [x, y], track: null, s: 0, speed: 0, lat: 0, weave: 0,
      delay: 0, t: 0, flash: 0, tell: 0, shots: 0, group: 0, side: 1, diveSeed: 0, row: 0, u: 0, home: [x, y], rid: 0, u0: 0, gFrom: [x, y], gT: GLIDE_T, gMid: null, rest: 0, ...extra };
    c.home = [c.slot[0], c.slot[1]];
    if (!extra.rid) c.rid = c.row;
    if (extra.u0 === undefined) c.u0 = c.u;
    return c;
  }
  /** World position of a lattice cell (before sway / breathing / the camera ride). */
  private cell(row: number, u: number): Pt { return [Math.round(this.cx + u * this.colSp), this.formTop + row * this.rowSp]; }

  /** Galaga grid: every cat keeps its own cell for the whole wave (holes stay holes, columns never shift). Only when a
   *  whole row has been booped do the rows below it move up one row, in one calm glide after a short lull. */
  private closeRanks() {
    const mem = this.cats.filter(c => !c.dead && c.st !== 'leave' && c.st !== 'kdive' && c.st !== 'flyby');
    const key = mem.length;
    if (key === this.ranks) { this.rankKey = key; this.rankT = 0; return; }
    if (key !== this.rankKey) { this.rankKey = key; this.rankT = 0; }
    if (++this.rankT < REGROUP_LULL) return;
    if (mem.some(c => c.gT < GLIDE_T)) return;
    this.ranks = key;
    if (!mem.length) return;
    const rows = closeRows(mem.map(c => c.row));
    mem.forEach((c, i) => {
      if (rows[i] === c.row) return;
      c.row = rows[i]; const s = this.cell(c.row, c.u);
      c.slot = s; c.gFrom = [c.home[0], c.home[1]]; c.gT = 0; c.gMid = null;
    });
    this.checkCells(mem);
  }
  /** The lattice invariant: one cat per cell. */
  private checkCells(mem: Cat[]) {
    if (!cellsUnique(mem.map(c => ({ row: c.row, u: c.u })))) this.g.reportError('interaction', 'two cats share a formation cell');
  }

  /** Pure: per-breed head counts of the formation startWave(areaId, i) would spawn (no RNG draws, no state change). */
  wavePreview(areaId: string, i: number): { breed: string; n: number }[] {
    const g = this.g; const area = g.mods.world.area(areaId);
    const w = g.content.waves.find(x => x.id === area?.waves[i]); if (!w) return [];
    const T = tuning(g, w.fireRate, w.diveRate);
    const areaIdx = g.content.areas.findIndex(a => a.id === areaId);
    const by = new Map<string, number>();
    for (const h of layout(w, shapeFor(areaIdx, i), i, id => this.enemy(id), Math.round(22 + 12 * T.d), latticeFor(areaId).cols)) by.set(h.def.id, (by.get(h.def.id) ?? 0) + 1);
    return [...by].map(([breed, n]) => ({ breed, n }));
  }

  startWave(areaId: string, i: number) {
    const g = this.g; const area = g.mods.world.area(areaId);
    const wid = area?.waves[i]; const w = g.content.waves.find(x => x.id === wid);
    this.clearAll();
    if (!w) { g.reportError('interaction', `missing wave ${wid}`); g.bus.emit('wave:clear', { areaId, waveIndex: i }); return; }
    g.reseed(areaId, i);
    this.wave = w; this.waveT = 0; this.active = true; this.mode = 'wave';
    const T = this.T = tuning(g, w.fireRate, w.diveRate);
    this.fireT = 120; this.diveT = 60; this.breathMix = 0; this.entryDone = false; this.clearHold = 0; this.hurry = 0;
    // the sector picks the formation's silhouette; every home sits on a COL_SP x ROW_SP lattice (no two overlap)
    const areaIdx = g.content.areas.findIndex(a => a.id === areaId);
    const holderWave = w.cats.some(c => this.enemy(c.breed).behavior === 'capturer') && !g.state.flags['pup_' + areaId];
    this.formTop = FORM_TOP + (holderWave ? PUP_LIFT : 0);
    this.rowSp = ROW_SP; this.colSp = COL_SP;
    this.shape = shapeFor(areaIdx, i);
    // the lattice is fixed on the area's lane (never rides the camera) and is never wider than the lane
    const lat = latticeFor(areaId); this.cx = lat.cx; this.cols = lat.cols; this.amp = lat.amp;
    let n = 0; const first = this.cats.length;
    this.ranks = -1; this.rankKey = -1; this.rankT = 0;
    const slots = layout(w, this.shape, i, id => this.enemy(id), Math.round(22 + 12 * T.d), this.cols).map(h => ({ def: h.def, row: h.row, u: h.u, slot: this.cell(h.row, h.u) }));
    // entry lanes run in parallel and back to back (Galaga: the convoy assembles in ~4s, not over half the wave).
    // The entry is picked per wave (formation.entryFor), so consecutive waves fly in differently:
    //   swirl / loop / split / rain: streams of pairs abreast;  convoy: two single-file snakes, one per half;
    //   flank: two squadrons sweep in from both sides at once (pairs in echelon); escort: tight trios;
    //   drop: columns fall straight into place, bottom row first (each cat only ever passes empty cells).
    // Each lane fills its cells top row first, so a cat climbing into its cell only ever passes empty cells.
    const entry = this.entry = entryFor(areaIdx, i, (area?.waves ?? []).map(id => g.content.waves.find(x => x.id === id)?.entry ?? w.entry));
    const maxRow = slots.reduce((m, s) => Math.max(m, s.row), 0);
    const below = slots.reduce((m, s) => Math.max(m, s.slot[1]), 0) + 40;   // the open field just under the rack
    const rackL = Math.min(...slots.map(s => s.slot[0])), rackR = Math.max(...slots.map(s => s.slot[0]));
    const laneN = new Map<string, number>(); const laneOfCat = new Map<Cat, string>(); const sideN = new Map<number, number>();
    for (const { def, slot, row, u } of slots) {
      let side = 1, lat = 0, key = '', delay = -1;
      // each stream feeds its own half of the rack, so streams never cross under it
      const half = u < 0 || (u === 0 && n % 2 === 1) ? 1 : -1;
      side = half;
      const hn = sideN.get(side) ?? 0; sideN.set(side, hn + 1);
      switch (entry) {
        case 'escort': { // tight trios: a leader with two wingmen close on its tail, a clear gap to the next trio
          const m3 = hn % 3; lat = 0; key = side + ':e' + m3; delay = Math.floor(hn / 3) * 40 + m3 * 12;
          break;
        }
        case 'flank': { // pairs in echelon, the second a cat-length behind and beside the first
          const m2 = hn % 2; lat = m2 ? -18 : 18; key = side + ':f' + m2; delay = Math.floor(hn / 2) * 19 + m2 * 8;
          break;
        }
        case 'drop': { // a ripple across the columns, deepest row first; a column's cats fall 16 ticks (64px) apart
          const ci = Math.round(u + (this.cols - 1) / 2);
          side = half; key = 'col' + ci; delay = (maxRow - row) * 16 + (i % 2 ? this.cols - 1 - ci : ci) * 4;
          break;
        }
        default: lat = 0;   // single file: the gutter turns are too tight for a cat flying abreast
      }
      key = key || side + ':' + lat; const li = laneN.get(key) ?? 0; laneN.set(key, li + 1);
      if (delay < 0) delay = li * STREAM_STEP + Math.floor(li / 8) * LANE_BREAK;
      // the choreography is drawn around the world centre: ride it over to the formation centre, and start the far
      // ends just outside the visible playfield, so cats are on screen within a few ticks of their cue
      const pts = entryPath(entry, side, [slot[0], slot[1]], below + (entry === 'escort' ? 24 : 0), side > 0 ? rackL - 40 : WORLD_W - rackR - 40).map(([x, y]) => [WORLD_W / 2 + Math.max(-ENTRY_EDGE, Math.min(ENTRY_EDGE, x - WORLD_W / 2)), y] as Pt);
      const track = new Track(pts);
      const p0 = track.at(0, tp);
      // formations abreast close up into single file before the shared approach line (where cats peel off one by one)
      const latEnd = lat && pts.length > 4 ? new Track(pts.slice(0, -3)).len : 0;
      if (latEnd < 90) lat = 0;   // too short a glide to fly abreast (a lane hard against one side): single file
      const c = this.mkCat(def, p0.x, p0.y, 'wait', { slot, track, speed: T.entrySpeed, lat, delay, side, diveSeed: g.rng.next(), row, u, latEnd });
      this.cats.push(c); laneOfCat.set(c, key);
      n++;
    }
    // no two cats may share an entry lane at the same moment (same lane start at the same off-screen point and would
    // fly stacked on top of each other): queue a late-comer one stream step behind
    // ...and every column fills top cell first: a cat rising into its cell only ever climbs past empty cells (it
    // lands at least 12 ticks, ~1.5 cells, after the cat above it)
    const mine = this.cats.slice(first);
    const arrive = (c: Cat) => c.delay + (c.track ? c.track.len / c.speed : 0);
    for (let pass = 0; pass < 4; pass++) {
      const lanes = new Map<string, number>();
      for (const c of [...mine].sort((a, b) => a.delay - b.delay)) {
        const key = laneOfCat.get(c)!; const last = lanes.get(key);
        if (last !== undefined && c.delay < last + STREAM_STEP) c.delay = last + STREAM_STEP;
        lanes.set(key, c.delay);
      }
      if (entry === 'drop') break;
      const colT = new Map<number, number>(); let moved = false;
      for (const c of [...mine].sort((a, b) => a.row - b.row || a.delay - b.delay)) {
        const prev = colT.get(c.u); const t = arrive(c);
        if (prev !== undefined && t < prev + 12) { c.delay += Math.ceil(prev + 12 - t); moved = true; }
        colT.set(c.u, arrive(c));
      }
      if (!moved) break;
    }
    this.total = this.cats.length; this.checkCells(this.cats);
    this.rowN = new Map(); for (const c of this.cats) this.rowN.set(c.rid, (this.rowN.get(c.rid) ?? 0) + 1);
    // a capturer may carry a lost pup (once per area)
    // the lost pup rides with a different capturer each wave, so its column moves around
    // the holder always rides in the top row, so its bubble has the free slot above it (never over another cat)
    const caps = this.cats.filter(c => c.def.behavior === 'capturer' && c.row === 0);
    const holder = caps.length ? caps[i % caps.length] : undefined;
    if (holder && !g.state.flags['pup_' + areaId]) holder.pup = true;
    g.bus.emit('wave:start', { areaId, waveIndex: i, count: this.cats.length });
  }

  startBoss(id: string) {
    this.clearAll(); this.g.reseed('boss', id);
    this.T = tuning(this.g);
    const def = this.enemy(id);
    this.boss = new Boss(this.g, this, def); this.active = true; this.mode = 'boss';
    this.escT = ESC_GAP; this.diveT = 200; this.escAx = WORLD_W / 2; this.escSide = this.g.rng.chance(0.5) ? 1 : -1;
    this.spawnEscorts();   // the squad streams in alongside the Big Cat's entrance swoop: it is never alone on stage
    this.g.bus.emit('boss:start', { bossId: id });
  }

  startBonus(def: BonusDef, total = def.groups * 8) {
    this.clearAll(); this.g.reseed('bonus', def.id);
    this.T = tuning(this.g); this.waveT = 0;
    this.mode = 'bonus'; this.active = true; this.bonus = { def, hits: 0, total };
    const ed = this.enemy(def.breed);
    for (let gi = 0; gi < def.groups; gi++) {
      const track = new Track(bonusPath(def.pattern, gi)); const p0 = track.at(0, tp);
      // one single-file train per squadron: 9 ticks x 2.5 px = 22 px of arc between cats, squadrons 150 ticks apart
      for (let k = 0; k < 8; k++) {
        const c = this.mkCat({ ...ed, hp: 1 }, p0.x, p0.y, 'wait', { track, speed: 2.5, lat: 0, delay: gi * 150 + k * 9 });
        c.bgroup = gi; this.cats.push(c);
      }
    }
  }

  markGlow() { const c = this.cats.find(c => !c.pup && !c.glow && c.def.behavior !== 'capturer'); if (c) c.glow = true; }

  spawnPickup(kind: string, x: number, y: number) {
    const pup = kind === 'pup';
    // never stack or crowd two pickups (framed badges side by side read as clutter): a repeat of a plain pickup that is
    // already falling nearby merges into it, anything else steps well aside (a clear badge's width of air between them)
    const near = (k: Pickup) => Math.abs(k.x - x) < 44 && Math.abs(k.y - y) < 40;
    if (!pup && !kind.startsWith('memory') && this.pickups.some(k => k.kind === kind && near(k))) return;
    for (let n = 0; n < 4 && this.pickups.some(near); n++) x += x < WORLD_W / 2 ? 46 : -46;
    this.pickups.push({ kind, x, y, vy: pup ? -0.9 : 0.7, t: 0, vx: 0 });
  }

  fireTurds(x: number, y: number, pattern: { dx: number; vx: number }[]) {
    const cap = this.mode === 'wave' ? WAVE_TURDS : MAX_TURDS;
    if (this.turds.length + pattern.length > cap + 4 || this.turds.length >= cap + (pattern.length - 1) * 2) return false;
    for (const p of pattern) this.turds.push({ x: x + p.dx, y, vx: p.vx, vy: -6.2, kind: 'turd', t: 0 });
    return true;
  }

  /** Everything that can hurt Pom, with velocities, for the autopilot's danger projection. */
  threats() {
    const out: { x: number; y: number; vx: number; vy: number; st?: string }[] = [...this.spits];
    for (const c of this.cats) if ((c.st === 'dive' || c.st === 'kdive' || c.st === 'return') && c.y > 60) out.push({ x: c.x, y: c.y, vx: c.vx, vy: c.vy, st: c.st });
    if (this.boss) out.push(...this.boss.threats());
    return out;
  }
  target(px: number) {
    if (this.boss) return { x: this.boss.x };
    let best: Cat | null = null, bd = 1e9;
    for (const c of this.cats) {
      if (c.st === 'wait' || c.st === 'leave' || c.y < 0 || c.y > 260) continue;
      const d = Math.abs(c.x - px) - c.y * 0.3; if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  /** Formation home of a slot right now: the whole lattice sways side to side by a few whole pixels (never past the
   *  lane walls); every cell keeps the same integer pitch, so rows stay column-aligned at every instant. */
  private swayX() { return Math.round(Math.sin(this.sway / 90) * this.amp); }
  private liveSlot(c: Cat): Pt {
    if (c.eslot !== undefined) return this.escSlot(c.eslot);
    const sw = this.swayX();
    return [Math.round(c.home[0]) + sw, Math.round(c.home[1])];
  }

  /** Where escort slot i sits right now: around the squad's anchor, which rides with the Big Cat. */
  private escSlot(i: number): Pt {
    const [dx, dy] = escOffset(i, this.boss?.tier ?? 0);
    return [Math.round(this.escAx + dx), Math.round(this.escAy + dy)];
  }
  /** World x range the Big Cat (and its squad's anchor) keeps to, so every escort stays WALL_GAP px inside the lane. */
  bossRange(): [number, number] {
    const [l, rr] = laneOf(this.g.state.areaId); const ext = ESC_EXT;
    let lo = l + WALL_GAP + ext, hi = rr - WALL_GAP - ext; const mid = (l + rr) / 2;
    if (hi - lo < 112) { lo = Math.min(lo, mid - 56); hi = Math.max(hi, mid + 56); }
    return [Math.round(lo), Math.round(hi)];
  }
  /** Escort squad size: 4 (two pairs) through sector 10, 6 at the end, one more pair once the Big Cat gets grumpy. */
  private escortSize(): number {
    const g = this.g; const idx = Math.max(0, g.content.areas.findIndex(a => a.id === g.state.areaId));
    return Math.min(6, (idx < 10 ? 4 : 6) + (this.boss && this.boss.phase > 0 ? 2 : 0));
  }
  /** The sector's own breeds (from its waves), minus capturers: escorts are regular cats. */
  private escortBreeds(): EnemyDef[] {
    const g = this.g; const area = g.mods.world.area(g.state.areaId); const ids: string[] = [];
    for (const wid of area?.waves ?? []) for (const c of g.content.waves.find(w => w.id === wid)?.cats ?? []) if (!ids.includes(c.breed)) ids.push(c.breed);
    const defs = ids.map(id => this.enemy(id)).filter(d => d.behavior !== 'capturer' && d.behavior !== 'boss');
    return defs.length ? defs : [this.enemy('tabby')];
  }
  /** Whistle up escorts into every empty squad slot: one single-file stream, from alternating sides. */
  spawnEscorts() {
    const b = this.boss; if (!b) return;
    const n = this.escortSize(); const taken = new Set(this.cats.filter(c => c.eslot !== undefined && !c.dead).map(c => c.eslot!));
    const breeds = this.escortBreeds(); const side = this.escSide = -this.escSide; let j = 0;
    for (let i = 0; i < n; i++) {
      if (taken.has(i)) continue;
      const def = breeds[(i + (b.phase * 3)) % breeds.length]; const slot = this.escSlot(i);
      const pts = entryPath('swirl-left', side, slot, slot[1] + 36).map(([x, y]) => [WORLD_W / 2 + Math.max(-ENTRY_EDGE, Math.min(ENTRY_EDGE, x - WORLD_W / 2)), y] as Pt);
      const track = new Track(pts); const p0 = track.at(0, tp);
      this.cats.push(this.mkCat(def, p0.x, p0.y, 'wait', { slot, track, speed: this.T.entrySpeed, lat: 0, delay: 1 + j * STREAM_STEP, side, diveSeed: this.g.rng.next(), row: 0, u: i, eslot: i }));
      j++;
    }
    if (j) this.g.mods.audio?.sfx('blip');
  }
  /** Phase change: a shockwave rolls off the Big Cat and fresh escorts fill the squad. */
  bossPhase(x: number, y: number) {
    this.shocks.push({ x, y, t: 0 }, { x, y, t: -8 });
    this.spawnEscorts();
  }

  private boop(c: Cat, viaTurd = true) {
    const g = this.g; const diving = c.st === 'dive' || c.st === 'kdive';
    const pts = this.mode === 'bonus' ? 100 : diving ? (c.def.divePoints ?? c.def.points * 2) : c.def.points;
    g.ops.addScore(pts); g.state.stats.catsBooped++;
    if (viaTurd) g.state.stats.hits++;
    g.mods.effects?.burst(c.x, c.y, 'boop');
    // Galaga only pops a score over a kill in flight: a boop in the grid adds to the HUD score without a label, so
    // numbers never sit on top of the neighbouring cats (memory carriers get their own reveal, no label either)
    if ((diving || this.mode === 'bonus') && !c.glow) g.mods.effects?.floatText(c.x, c.y - 10, String(pts));
    g.mods.audio?.sfx('meow');
    if (c.pup) { const [px, py] = this.pupPos(c); this.spawnPickup('pup', px, py); g.mods.effects?.burst(px, py, 'sparkle'); }
    if (this.wave?.pickup && g.rng.chance(0.06)) this.spawnPickup(this.wave.pickup, c.x, c.y);
    if (c.def.behavior === 'splitter') { // a pair of kittens, but never a tumbling swarm: at most 2 in the air
      const room = 2 - this.cats.filter(o => o.st === 'kdive' && !o.dead).length;
      for (const s of room >= 2 ? [-1, 1] : room === 1 ? [c.x < WORLD_W / 2 ? 1 : -1] : []) this.spawnKitten(c.x + s * 6, c.y, s * 0.9, -1.6, c.slot);
    }
    if (this.bonus) this.bonus.hits++;
    c.dead = true;
    g.bus.emit('cat:boop', { breed: c.def.id, x: c.x, y: c.y, points: pts, glow: !!c.glow, bonus: this.mode === 'bonus', group: this.mode === 'bonus' ? c.bgroup : undefined });
  }

  /** Where the captive pup floats: above its holder in formation (as Galaga parks the captured fighter), 12px below its
   *  feet in flight, swinging around the side in between so the bubble never covers a face. */
  pupPos(c: Cat): [number, number] {
    const k = c.pupK ?? -1; const d = k < 0 ? ROW_SP - 2 : (c.def.size ?? 32) / 2 + 22;
    return [c.x + (1 - k * k) * 26 * (c.side || 1) + Math.round(Math.sin(c.t / 12) * 2), c.y + k * d];
  }

  /** Kittens pop out in a little arc, then tumble down toward Pom. */
  spawnKitten(x: number, y: number, vx: number, vy: number, slot: Pt = [x, y]) {
    const kd = this.enemy('kitten');
    this.cats.push(this.mkCat(kd, x, y, 'kdive', { vx, vy, slot, side: Math.sign(vx) || 1, diveSeed: this.g.rng.next() }));
  }

  update(g: Game) {
    const sc = g.state.scene;
    if ((sc !== 'play' && sc !== 'bonus') || g.paused) return;
    if (this.stageReq) {
      if (!this.staged && (this.mode === 'wave' || this.mode === 'boss')) this.stage(this.stageReq);
      if (this.staged && this.stageScript()) return;
    }
    this.sway++;
    const P = g.mods.player; const pb = P?.hitbox();
    const T = this.T;
    // turds
    for (const s of this.turds) { s.x += s.vx; s.y += s.vy; s.t++; }
    this.turds = this.turds.filter(s => s.y > -16 && s.x > -10 && s.x < WORLD_W + 10);
    // spits
    for (const s of this.spits) { s.x += s.vx; s.y += s.vy; s.t++; }
    this.spits = this.spits.filter(s => s.y < H + 10 && s.y > -20 && s.x > -10 && s.x < WORLD_W + 10);
    if (this.active) this.waveT++;

    const w = this.wave; const bonus = this.mode === 'bonus';
    // bonus stage: the HUD's BOOPS / AIM read the run stats, so they always include every bonus hit, also one tallied
    // by the stage itself (a pinned showcase tally): credit any hits the stage knows about that we have not counted
    if (bonus && this.bonus) {
      const mh = Math.min(this.bonus.total, Math.floor(+(g.mods.minigames?.hits ?? 0)) || 0);
      if (mh > this.bonus.hits) {
        const d = mh - this.bonus.hits, st = g.state.stats; this.bonus.hits = mh;
        st.catsBooped += d; st.hits += d; st.shots = Math.max(st.shots, st.hits);
      }
    }
    const timedOut = this.waveT > WAVE_LIMIT && this.mode === 'wave';
    if (!this.entryDone && this.mode === 'wave' && !this.cats.some(o => o.st === 'wait' || o.st === 'enter' || o.st === 'home')) this.entryDone = true;
    if (this.mode === 'wave' && !this.stageReq) this.closeRanks();
    if (this.boss) { // the escort squad's anchor rides with the Big Cat, inside its range
      const [lo, hi] = this.bossRange(); this.escAx = Math.max(lo, Math.min(hi, this.boss.x));
      this.escAy = Math.max(60, Math.min(88, this.boss.y));   // bobs with the boss, stays up when it pounces
    }
    for (const s of this.shocks) s.t++;
    this.shocks = this.shocks.filter(s => s.t < 28);
    for (const c of this.cats) { // homes glide toward their (possibly re-packed) cells
      if (c.eslot !== undefined) { const p = this.escSlot(c.eslot); c.slot = p; c.home = [p[0], p[1]]; continue; }
      const h = c.home;
      const span = c.gMid ? GLIDE_T * 2 : GLIDE_T;
      if (c.gT < span) {
        c.gT++; const seg = c.gMid && c.gT > GLIDE_T ? 1 : 0, k = (c.gT - seg * GLIDE_T) / GLIDE_T, e = k * k * (3 - 2 * k);
        const a = seg ? c.gMid! : c.gFrom, b = c.gMid && !seg ? c.gMid : c.slot;
        h[0] = a[0] + (b[0] - a[0]) * e; h[1] = a[1] + (b[1] - a[1]) * e;
      } else { h[0] = c.slot[0]; h[1] = c.slot[1]; }
    }

    // schedulers: dives and formation fire (Galaga style: a steady drumbeat, not random noise)
    // last stand: once only ~20% of the wave is left, the stragglers dive back to back, then give up and fly off
    if (this.mode === 'wave' && this.entryDone && !this.hurry) {
      const alive = this.cats.filter(c => c.st !== 'leave' && c.st !== 'kdive').length;
      if (alive <= Math.max(2, Math.ceil(this.total * 0.3))) { this.hurry = 1; this.diveT = Math.min(this.diveT, 20); }
    }
    if (this.hurry) this.hurry++;
    const hurryOut = this.hurry > HURRY_LEAVE;
    const special = (c: Cat) => !!c.pup || !!c.glow;   // a lost pup or a memory never flies away undelivered
    if (this.mode === 'wave' && w && !timedOut) {
      const inForm = this.cats.filter(c => c.st === 'form');
      if (this.entryDone && --this.diveT <= 0) {
        // Galaga rhythm: the grid stays put and only a few cats are ever out of it (divers plus cats still flying home)
        const out = this.cats.filter(c => c.st === 'dive' || c.st === 'return');
        const groups = new Set(out.filter(c => c.st === 'dive').map(c => c.group)).size;
        const room = (this.hurry ? HURRY_DIVERS : T.maxDivers) - out.length;
        // a cat rests in its cell between dives (in the last stand for a good while: it returns, it does not loop forever)
        const rested = inForm.filter(c => c.rest >= (this.hurry ? REST_LAST : REST_TICKS));
        if ((this.hurry ? groups < 1 : groups < T.diveGroups) && room > 0 && rested.length) this.launchDive(rested, undefined, room);
        const left = inForm.length / Math.max(1, this.total);
        // the last stand keeps a steady beat (one small group at a time), so the stragglers hold their cells between dives
        this.diveT = this.hurry ? Math.round(g.rng.range(56, 84)) : Math.round(T.diveEvery * g.rng.range(0.7, 1.3) * (0.45 + 0.55 * left));
      }
      if (--this.fireT <= 0) {
        this.fireT = Math.round(T.fireEvery * g.rng.range(0.6, 1.4) * (this.cats.length <= 2 ? 0.6 : 1));
        if (inForm.length && this.spits.length < T.spitCap) {
          const px = P?.x ?? WORLD_W / 2; let tot = 0;
          const wt = inForm.map(c => { const v = (c.def.behavior === 'shooter' ? 4 : 1) * (Math.abs(c.x - px) < 90 ? 2 : 1) * (c.tell ? 0 : 1); tot += v; return v; });
          let r = g.rng.next() * tot;
          for (let k = 0; k < inForm.length; k++) { r -= wt[k]; if (r <= 0 && wt[k]) { inForm[k].tell = T.tell; break; } }
        }
      }
    }

    // Big Cat escorts: a squad flanks the boss, peels off in Galaga dives, and is replaced a while after the last falls
    const b0 = this.boss;
    if (this.mode === 'boss' && b0 && !b0.dead) {
      // the squad is topped up as soon as it is down to one escort (never a lone Big Cat for long), also mid-entrance
      const esc = this.cats.filter(c => c.eslot !== undefined && !c.dead);
      if (esc.length > 1) this.escT = ESC_GAP - 20 * b0.phase;
      else if (--this.escT <= 0 && b0.st !== 'phase') { this.spawnEscorts(); this.escT = ESC_GAP; }
      if (esc.length && !b0.entering && --this.diveT <= 0) {
        const rested = esc.filter(c => c.st === 'form' && c.rest >= 40);
        const room = (b0.phase >= 2 ? 2 : 1) - esc.filter(c => c.st === 'dive' || c.st === 'return').length;
        if (room > 0 && rested.length) this.launchDive(rested, undefined, room);
        this.diveT = Math.round((210 - 40 * b0.phase) * g.rng.range(0.8, 1.2));
      }
    }

    const arr = this.cats; const byId = new Map(arr.map(c => [c.id, c]));
    const rackBottom = arr.reduce((m, c) => (c.st === 'form' && c.eslot === undefined ? Math.max(m, c.slot[1] + 16) : m), 0);
    for (const c of arr) {
      if (c.dead) continue;
      c.t++; if (c.flash > 0) c.flash--;
      const ox = c.x, oy = c.y;
      switch (c.st) {
        case 'wait': if (--c.delay <= 0) c.st = bonus ? 'flyby' : 'enter'; break;
        case 'enter': case 'flyby': case 'dive': {
          // capturer's tractor-beam moment: the whole group hovers low while the beam unrolls, then flies on
          if (c.st === 'dive' && c.def.behavior === 'capturer' && c.id === c.group && !c.beamUsed && c.y > Math.max(186, rackBottom + 40) && c.vy > 0) {
            c.beamUsed = true; for (const o of arr) if (o.group === c.group && o.st === 'dive') o.beam = BEAM_TICKS;
            g.mods.audio?.sfx('blip');
          }
          if (c.beam) { c.beam--; break; }
          // entry streams never bunch into a blob: a cat that comes within a sprite of an earlier entrant eases off
          let sp = c.speed;
          if (c.st === 'enter') for (const o of arr) {
            if (o === c || o.st !== 'enter' && o.st !== 'home') continue;
            const dx = o.x - c.x, dy = o.y - c.y;
            // the cat behind yields (the one clearly ahead along its heading never waits), and of two side by side the
            // later one drops back: streams space themselves out
            if (Math.abs(dx) >= 30 || Math.abs(dy) >= 30) continue;
            const dot = dx * c.vx + dy * c.vy, side = 0.3 * Math.hypot(dx, dy) * Math.hypot(c.vx, c.vy);
            if (dot > side || (dot > -side && o.id < c.id)) { sp *= 0.25; break; }
          }
          if (c.st === 'dive') {
            // two separate dive groups never fuse: the cat flying into the other eases off (or holds when close)
            let yieldK = 1;
            for (const o of arr) {
              if (o === c || o.st !== 'dive' || o.dead || o.group === c.group) continue;
              const dx = o.x - c.x, dy = o.y - c.y; if (Math.abs(dx) >= 34 || Math.abs(dy) >= 34) continue;
              c.track!.at(c.s, hp); const d = Math.hypot(dx, dy) || 1, me = (dx * hp.hx + dy * hp.hy) / d;
              o.track!.at(o.s, hp); const it = o.beam ? 0 : -(dx * hp.hx + dy * hp.hy) / d;
              // (crossing head-on, the later cat only slows: stopping dead in the other's path would not help)
              if (me > 0.2 && (it <= 0.2 || o.id < c.id)) { yieldK = d < 26 && it <= 0.2 ? 0 : 0.3; break; }
            }
            const L = c.lead !== undefined ? byId.get(c.lead) : undefined;
            if (L && L.st === 'dive' && !L.dead) { // a wingmate rides locked to its leader's arc position (catching up at most 1.8x)
              c.s = Math.max(c.s, Math.min(L.s + (c.sOff ?? 0), c.s + c.speed * 1.8 * yieldK)); sp = 0;
            } else sp *= yieldK;
          }
          const tr = c.track!; c.s += sp; tr.at(c.s, tp);
          // lateral offset: pairs flying abreast, zigzag weave; fades in after the peel and out near the end
          // (an entry starts off screen at full offset, so pairs never sit on top of each other while they come in)
          const fade = c.st === 'enter' ? Math.min(1, ((c.latEnd ?? tr.len) - c.s) / 40) : Math.min(1, c.s / 40, (tr.len - c.s) / 50);
          const off = c.lat * Math.max(0, fade) + (c.weave ? Math.sin(c.s / 22) * c.weave * Math.max(0, Math.min(1, (c.s - Math.max(60, (c.exitLen ?? 0) + 16)) / 40)) : 0);
          c.x = tp.x - tp.hy * off; c.y = tp.y + tp.hx * off;
          // a dive still in its exit column rides the rack's sway, so it stays centred between the parked columns
          if (c.st === 'dive' && c.exitLen) c.x += (this.swayX() - (c.sw0 ?? 0)) * Math.max(0, Math.min(1, (c.exitLen - c.s) / 24));
          if (c.s >= tr.len) {
            if (c.st === 'enter') c.st = 'home';
            else if (c.st === 'flyby') { c.st = 'leave'; c.dead = true; }
            else { // dive done: wrap to the top if it flew off the bottom, then glide home
              // every dive ends off screen: re-enter straight above the cat's own column and drop into the slot,
              // so a returning cat never cuts diagonally through the grid
              if (c.y > H || c.y < 0 || c.x < -16 || c.x > WORLD_W + 16) { c.x = this.liveSlot(c)[0]; c.y = -28; }
              c.st = timedOut || (hurryOut && !special(c)) ? 'leave' : 'return'; c.speed = 3;
            }
          }
          if (c.st === 'dive' && c.shots > 0 && c.tell === 0 && c.y > 110 && c.y < 220 && P && Math.abs(c.x - P.x) < 120 && this.spits.length < T.spitCap && g.rng.chance(0.05)) { c.shots--; c.tell = T.tell; }
          break;
        }
        case 'home': case 'return': {
          const [sx, sy] = this.liveSlot(c); const dx = sx - c.x, dy = sy - c.y; const d = Math.hypot(dx, dy);
          const sp = c.st === 'home' ? c.speed : Math.min(c.speed, 1 + d * 0.05);
          if (d <= sp + 0.5) { c.x = sx; c.y = sy; c.st = 'form'; c.rest = 0; }
          else { c.x += dx / d * sp; c.y += dy / d * sp; }
          // a straggler giving up first lands in its cell, then lifts off with the block (never peels off mid-glide)
          if (timedOut) c.st = 'leave';
          break;
        }
        case 'form': {
          const [sx, sy] = this.liveSlot(c); c.x = sx; c.y = sy; c.rest++;
          if (timedOut || (hurryOut && !special(c))) c.st = 'leave';
          break;
        }
        case 'kdive': {
          // tumble down toward Pom's lane, drifting gently in from the edges (never a straggler along the walls)
          c.vy = Math.min(2.4, c.vy + 0.07); c.vx = c.vx * 0.985 + Math.sign((P?.x ?? this.cx) - c.x) * 0.012;
          c.x += c.vx + Math.sin(c.t / 9 + c.side) * 0.5; c.y += c.vy;
          if (c.y > H + 20) c.dead = true;
          break;
        }
        case 'leave': c.y -= 3; if (c.y < -40) c.dead = true; break;
      }
      c.vx = c.st === 'kdive' ? c.vx : c.x - ox; if (c.st !== 'kdive') c.vy = c.y - oy;
      c.up = (c.st === 'enter' || c.st === 'dive' || c.st === 'flyby') && c.vy < -0.9 * Math.max(0.5, Math.abs(c.vx));
      if (c.pup) { const want = c.st === 'form' || c.st === 'home' ? -1 : 1; c.pupK = (c.pupK ?? want) + Math.max(-0.06, Math.min(0.06, want - (c.pupK ?? want))); }
      // wind-up, then cough a hairball
      if (c.tell > 0 && --c.tell === 0 && !c.dead && c.st !== 'leave' && c.st !== 'wait') this.spit(c, P);

      // turd collisions: generous cat boxes
      if (c.st !== 'wait' && c.st !== 'leave' && !c.dead && c.y > -10) {
        const r = (c.def.size ?? 32) / 2 - 3;
        for (const s of this.turds) {
          if (Math.abs(s.x - c.x) < r + 2 && Math.abs(s.y - c.y) < r + 3) {
            s.y = -999; c.hp--; g.mods.audio?.sfx('thud');
            if (c.hp <= 0) this.boop(c);
            else { c.flash = 14; g.mods.effects?.burst(s.x + (s.x < c.x ? -8 : 8), c.y - 8, 'splat'); c.y -= 3; }   // tanks shrug it off, flashing
            break;
          }
        }
        // body collision with Pom (small player box)
        if (!c.dead && pb && c.y > 150 && (c.st === 'dive' || c.st === 'kdive' || c.st === 'return') &&
          Math.abs(c.x - (pb.x + pb.w / 2)) < 5 + pb.w / 2 && Math.abs(c.y - (pb.y + pb.h / 2)) < 5 + pb.h / 2) {
          if (P.hit()) this.boop(c, false);
          if (this.cats !== arr) return; // Pom napped: the wave was reset
        }
      }
    }
    this.cats = this.cats.filter(c => !c.dead);

    // boss
    if (this.boss) {
      this.boss.update();
      const b = this.boss;
      for (const s of this.turds) if (Math.abs(s.x - b.x) < b.r && Math.abs(s.y - b.y) < b.r + 4) {
        const sx = s.x, sy = s.y; s.y = -999;
        if (b.vulnerable()) {
          g.mods.effects?.burst(sx, sy, 'splat'); b.damage(1); g.state.stats.hits++; g.mods.audio?.sfx('thud');
          // every hit on a Big Cat scores (more once it is grumpy, more for later bosses): the score climbs all fight
          const pts = 10 + 10 * b.phase + 5 * b.tier; g.ops.addScore(pts); g.mods.effects?.floatText(sx, sy - 8, String(pts));
        }
        else g.mods.effects?.burst(s.x, b.y + 20, 'sparkle');
      }
      if (b.dead) {
        g.ops.addScore(b.def.points); g.mods.effects?.burst(b.x, b.y, 'bigboop'); g.mods.effects?.shake(6, 30);
        g.mods.audio?.sfx('bossdown'); this.spawnPickup('pk_heart', b.x, b.y);
        for (const s of this.spits) g.mods.effects?.burst(s.x, s.y, 'sparkle');
        this.spits = []; for (const c of this.cats) { if (c.st === 'wait') c.dead = true; c.st = 'leave'; c.tell = 0; }   // kittens and escorts scatter
        // the defeat outranks any phase banner still on screen; the bounty floats up over the explosion
        const ui = g.mods.ui; if (ui && Array.isArray(ui.toasts)) ui.toasts = ui.toasts.filter((t: { text: string }) => !/GRUMPY/.test(t.text));
        g.mods.effects?.floatText(b.x, b.y - 30, String(b.def.points));
        g.bus.emit('boss:defeat', { bossId: b.def.id, napped: b.napped });
        this.boss = null; this.active = false; this.mode = 'none';
      } else if (pb && b.touches(pb)) {
        P.hit();
        if (!this.boss) return;
      }
    }

    // spit vs Pom: only the bullet's core counts (1px of slack), never its halo: small for the player
    if (pb) for (const s of this.spits) {
      const rr = 1;
      if (s.x > pb.x - rr && s.x < pb.x + pb.w + rr && s.y > pb.y - rr && s.y < pb.y + pb.h + rr) {
        s.y = 9999; P.hit();
        if (this.spits.length === 0) break; // napReset cleared the air
      }
    }

    // pickups
    const catsGone = this.cats.length === 0;
    for (const k of this.pickups) {
      k.t++;
      const important = k.kind === 'pup' || k.kind.startsWith('memory');
      if (k.kind === 'pup') {
        // pops free, then floats down gently and hovers at Pom's altitude until caught
        k.vy = Math.min(0.45, k.vy + 0.05); k.y += k.vy; k.x += Math.sin(k.t / 20) * 0.35;
        if (k.y > 318) k.y = 318;
      } else { k.y += k.vy; k.x += Math.sin(k.t / 15) * 0.4; }
      if (P) {
        const dx = P.x - k.x, dy = P.y - k.y; const d = Math.hypot(dx, dy) || 1;
        if (important && (catsGone || d < 56)) { const sp = catsGone && this.mode !== 'boss' ? 3 : 1.2; k.x += dx / d * Math.min(sp, d); k.y += dy / d * Math.min(sp, d); }
        if (d < 18) { this.collect(k); k.y = 9999; }
      }
    }
    this.pickups = this.pickups.filter(k => k.y < H + 20);

    // completion (lost pups and memories are always delivered first)
    const holding = this.pickups.some(k => k.kind === 'pup' || k.kind.startsWith('memory'));
    if (holding && catsGone) this.clearHold++; else this.clearHold = 0;
    if (this.mode === 'wave' && this.active && catsGone && this.waveT > 30 && (!holding || this.clearHold > 240)) {
      this.active = false; this.mode = 'none';
      g.bus.emit('wave:clear', { areaId: g.state.areaId, waveIndex: g.state.waveIndex, timedOut: this.waveT > WAVE_LIMIT });
    }
    if (this.mode === 'bonus' && this.active && catsGone && this.waveT > 30) {
      this.active = false; this.mode = 'none';
      const b = this.bonus!; g.bus.emit('bonus:result', { id: b.def.id, hits: b.hits, total: b.total });
    }
  }

  /** Peel a leader (plus escorts for capturers and tanks, sometimes a wingmate) out of the formation. */
  private launchDive(inForm: Cat[], forced?: Cat, room = 3) {
    const g = this.g; const r = g.rng; const T = this.T; const P = g.mods.player; const px = P?.x ?? WORLD_W / 2;
    const squad = inForm[0]?.eslot !== undefined;
    // never launch a cat mid-glide (its cell is still moving when the rows close up)
    if (!forced) { const settled = inForm.filter(c => c.gT >= (c.gMid ? GLIDE_T * 2 : GLIDE_T)); if (settled.length) inForm = settled; else return; }
    // Galaga peel: a diver leaves the rack through an EMPTY column beside it (that column empty from its own row down),
    // with a half loop up when the cells above are free (else a flat sidestep), then straight down that column into
    // the open field under the rack, and only there turns toward Pom: a dive never sweeps across parked cats
    // (cats flying home or still entering count too: they are about to sit in their cells)
    const parked = this.cats.filter(o => !o.dead && (o.st === 'form' || o.st === 'home' || (!squad && (o.st === 'return' || o.st === 'enter'))) && (o.eslot === undefined) === !squad);
    const skip = new Set<Cat>();
    const occ = (u: number, row: number) => parked.some(o => !skip.has(o) && o.u === u && o.row === row);
    const colFree = (u: number, row: number) => !parked.some(o => !skip.has(o) && o.u === u && o.row >= row);
    const openSide = (c: Cat): number => {
      if (c.eslot !== undefined) { const s = c.eslot & 1 ? 1 : -1; return parked.some(o => o !== c && Math.abs(o.x - (c.x + s * 32)) < 30 && o.y > c.y - 40) ? 0 : s; }
      // prefer a free column inside the lattice (an exit outside the outer column flies close to the lane wall)
      const out = c.slot[0] < this.cx ? -1 : 1; const edge = (this.cols - 1) / 2 + 0.01;
      const order = Math.abs(c.u + out) <= edge ? [out, -out] : [-out, out];
      for (const s of order) if (colFree(c.u + s, c.row)) return s;
      return 0;
    };
    const bottom = parked.reduce((m, o) => Math.max(m, o.slot[1]), 0) + 16;
    const exitOf = (c: Cat, s: number, canRise = true): Pt[] => {
      const x0 = c.x, y0 = c.y; const rise = canRise && !occ(c.u, c.row - 1) && !occ(c.u + s, c.row - 1);
      const pts: Pt[] = rise ? [[x0, y0], [x0 + 10 * s, y0 - 12], [x0 + 26 * s, y0 - 16], [x0 + 36 * s, y0 - 4], [x0 + 32 * s, y0 + 18]]
        : [[x0, y0], [x0 + 14 * s, y0 + 2], [x0 + 30 * s, y0 + 12]];
      // straight down the empty column (points every 20px keep the smoothed curve on the column line) to just under
      // the rack's bottom edge, where it is free to turn
      const yEnd = Math.max(y0 + 40, bottom + 30);
      for (let yy = pts[pts.length - 1][1] + 20; yy < yEnd - 10; yy += 20) pts.push([x0 + 32 * s, yy]);
      pts.push([x0 + 32 * s, yEnd]);
      return pts;
    };
    const sides = inForm.map(openSide);
    // only cats with an open column beside them peel off (the widest row's outer cats always have one)
    const pool = !squad && sides.some(v => v) ? inForm.filter((_, k) => sides[k]) : inForm;
    const pSides = pool === inForm ? sides : sides.filter(v => v);
    let tot = 0;
    const wt = pool.map((c, k) => { const b = c.def.behavior; const v = (b === 'diver' || b === 'zigzag' ? 2 : b === 'capturer' ? 1.6 : 1) * (pSides[k] ? 6 : 1); tot += v; return v; });
    let pick = r.next() * tot, leader = pool[0], side = pSides[0];
    for (let k = 0; k < pool.length; k++) { pick -= wt[k]; if (pick <= 0) { leader = pool[k]; side = pSides[k]; break; } }
    if (forced) { leader = forced; side = squad ? 0 : openSide(forced); }
    const b = leader.def.behavior;
    const maxEsc = squad ? 0 : b === 'capturer' ? 2 : b === 'tank' ? 1 : (b === 'basic' || b === 'splitter') && r.chance(0.4) ? 1 : 0;
    const exit = !squad && side ? exitOf(leader, side) : undefined;
    const path = divePath(leader.x, leader.y, px + r.range(-T.aimSlop, T.aimSlop), b === 'splitter' ? 'basic' : b, r.range(-1, 1), H, side, exit);
    // the last one or two cats of a wave dive faster: the end of a wave stays snappy instead of dragging on
    const last = this.mode === 'wave' && this.cats.filter(c => !c.dead && c.st !== 'leave' && c.st !== 'kdive').length <= 2;
    const speed = T.diveSpeed * (b === 'diver' ? 1.15 : b === 'tank' ? 0.8 : b === 'capturer' ? 0.9 : 1) * (last ? 1.3 : 1);
    const arm = (c: Cat, track: Track) => {
      c.track = track; c.s = 0; c.speed = speed; c.lat = 0; c.lead = undefined; c.sOff = 0; c.exitLen = 0; c.sw0 = this.swayX();
      c.weave = c.def.behavior === 'zigzag' ? 14 : 0;
      c.st = 'dive'; c.group = leader.id; c.beam = 0; c.beamUsed = false; c.rest = 0;
      c.shots = r.int(0, T.diveShots) + (c.def.behavior === 'shooter' ? 1 : 0);
    };
    const lt = new Track(path); arm(leader, lt);
    if (exit) leader.exitLen = new Track(exit).len;
    // wingmates: cats in the row just under the leader (its column or one over) that can leave by the same side. Each
    // flies its own exit, then the leader's attack shifted by its column offset; its arc position is locked to the
    // leader's, so the pair keeps a full cell (32px) apart all the way down (in file, 36px ahead, when it shares the
    // leader's column), never fused into one blob
    if (exit && maxEsc > 0 && room > 1) {
      skip.add(leader);
      const tail = path.slice(exit.length); const lEnd = exit[exit.length - 1];
      const cands = inForm.filter(o => o !== leader && o.row === leader.row + 1 && Math.abs(o.u - leader.u) < 1.01)
        .sort((p, q) => Math.abs(p.u - leader.u) - Math.abs(q.u - leader.u));
      let n = 0;
      for (const c of cands) {
        if (n >= Math.min(maxEsc, room - 1)) break;
        if (!colFree(c.u + side, c.row)) continue;
        const ex = exitOf(c, side, false);   // a wingmate sidesteps (never rises into the leader's peel)
        const e = ex[ex.length - 1]; const dx = e[0] - lEnd[0];
        const wt2 = new Track([...ex, ...tail.map(p => [p[0] + dx, p[1]] as Pt)]);
        // beside the leader (another column): locked level with it; in its column: trailing 44px behind in file
        arm(c, wt2); c.lead = leader.id; c.sOff = wt2.len - lt.len - (Math.abs(dx) < 8 ? 44 : 0); c.exitLen = new Track(ex).len;
        n++;   // (it stays in the occupancy check: a wingmate trailing in file still sits in its cell for a moment)
      }
    }
    g.mods.audio?.sfx('dive');
  }

  private spit(c: Cat, P: any) {
    if (!P || this.mode === 'bonus' || this.spits.length >= this.T.spitCap + (this.boss ? 4 : 0)) return;
    const yarn = c.def.behavior === 'capturer';
    const sp = this.T.spitSpeed * (yarn ? 0.85 : 1);
    const dx = P.x - c.x, dy = Math.max(40, P.y - c.y); const d = Math.hypot(dx, dy) || 1;
    const aim = c.def.behavior === 'shooter' ? 1 : 0.6; // shooters aim true, everyone else lobs mostly downward
    let vx = (dx / d) * sp * aim; vx = Math.max(-0.55 * sp, Math.min(0.55 * sp, vx));
    const vy = Math.sqrt(Math.max(0.5, sp * sp - vx * vx));
    this.spits.push({ x: c.x, y: c.y + 10, vx, vy, kind: yarn ? 'yarn' : 'hairball', t: 0, art: yarn ? 'blt_yarn' : 'blt_fur' });
    this.g.mods.audio?.sfx('hack');
  }

  bossSpit(x: number, y: number, vx: number, vy: number, art = 'blt_paw') { if (this.spits.length < this.T.bossSpitCap) this.spits.push({ x, y, vx, vy, kind: 'hairball', t: 0, art }); }

  private collect(k: Pickup) {
    const g = this.g; const P = g.mods.player;
    g.mods.audio?.sfx('pickup'); g.mods.effects?.burst(k.x, k.y, k.kind === 'pup' || k.kind === 'heart' || k.kind === 'pk_heart' ? 'hearts' : 'sparkle');
    if (k.kind === 'pup') {
      P.buddy = true; g.ops.setFlag('pup_' + g.state.areaId); g.ops.addItem('pups', 1);
      g.bus.emit('pup:rescue', { areaId: g.state.areaId }); g.mods.ui?.toast('PUPPY RESCUED! WINGMAN ONLINE'); return;
    }
    if (k.kind.startsWith('memory:')) { g.mods.memories?.collect(k.kind.slice(7)); return; }
    const item = g.content.items.find(i => i.id === k.kind || i.sprite === k.kind);
    if (!item) { g.ops.addScore(250); return; }
    const e = item.effect;
    if (e.kind === 'heart') g.state.hearts = Math.min(g.state.maxHearts, g.state.hearts + e.value);
    else if (e.kind === 'treat') g.ops.addScore(e.value);
    else if (e.kind === 'key') g.ops.addItem(item.id, 1);
    else P.power(e.kind, e.ticks ?? 600);
    g.ops.addItem(item.id, 0);
    g.bus.emit('item:get', { itemId: item.id, count: 1 });
    this.toast(item.name.toUpperCase());
  }

  /** Pickup toasts merge: a repeat of a banner still on screen bumps its counter ('SPICY CHILI X3') instead of stacking. */
  private toast(name: string) {
    const ui = this.g.mods.ui; const list = ui?.toasts as { text: string; t: number; n?: number }[] | undefined;
    const m = Array.isArray(list) ? list.find(o => o.text === name || o.text.startsWith(name + ' X')) : undefined;
    if (m) { m.n = (m.n ?? 1) + 1; m.text = `${name} X${m.n}`; m.t = Math.max(m.t, 150); return; }
    ui?.toast(name);
  }

  /**
   * Stage one combat moment for reviewers and the art pass, frozen on its key frame:
   * capturer (tractor beam), rescue (pup freed in its bubble), splitter (kittens pop), tank (hit flash),
   * dive (loop-de-loop), tell / boss (Big Cat wind-up / attack; &phase=1|2), bullets (every bullet sprite),
   * play (default: the autopilot flies and shoots). &at=<ticks> overrides the freeze tick.
   */
  stage(name: string) {
    const g = this.g; const P = g.mods.player;
    this.staged = true; this.stageReq = name; this.stageT = 0;
    if (name === 'play') { g.autopilot = true; this.stageReq = null; return; }
    g.autopilot = false;
    if (P) { P.x = WORLD_W / 2; P.y = 300; P.vx = 0; P.vy = 0; } // player START_Y
    if (name === 'tell' || name === 'boss') {
      const bossId = g.mods.world?.area?.(g.state.areaId)?.boss ?? 'boss_whiskers';
      this.startBoss(bossId); this.boss!.stageTell(this.stagePhase);
      // the escort squad is already parked around the boss
      this.escAx = this.boss!.x; this.escAy = this.boss!.y; this.spawnEscorts();
      for (const c of this.cats) { const p = this.escSlot(c.eslot ?? 0); c.st = 'form'; c.x = p[0]; c.y = p[1]; c.rest = 0; }
      return;
    }
    // [breed, columns, row?] (row defaults to the entry index, so a row can mix breeds)
    const F: Record<string, [string, number[], number?][]> = {
      lineup: [['tabby', [0, 4]], ['tuxedo', [1, 5], 0], ['siamese', [2, 6], 0], ['calico', [3, 7], 0],
        ['persian', [0, 4], 1], ['sphynx', [1, 5], 1], ['mainecoon', [2, 6], 1], ['russianblue', [3, 7], 1],
        ['bengal', [0, 2, 5, 7], 2], ['scottishfold', [3], 2]],
      capturer: [['tabby', [0, 1, 2, 3, 4, 5, 6, 7]], ['scottishfold', [1, 3, 5, 7]], ['tuxedo', [0, 1, 2, 3, 4, 5, 6, 7]]],
      rescue: [['tabby', [0, 1, 2, 3, 4, 5, 6, 7]], ['scottishfold', [1, 3, 5, 7]], ['tuxedo', [0, 1, 2, 3, 4, 5, 6, 7]]],
      splitter: [['siamese', [0, 1, 2, 3, 4, 5, 6, 7]], ['calico', [0, 1, 2, 3, 4, 5, 6, 7]], ['tabby', [0, 1, 2, 3, 4, 5, 6, 7]]],
      tank: [['scottishfold', [1, 3, 5, 7]], ['persian', [0, 1, 2, 3, 4, 5, 6, 7]], ['mainecoon', [0, 2, 4, 6]]],
      dive: [['siamese', [0, 1, 2, 3, 4, 5, 6, 7]], ['tuxedo', [0, 1, 2, 3, 4, 5, 6, 7]], ['bengal', [0, 1, 2, 3, 4, 5, 6, 7]], ['tabby', [0, 1, 2, 3, 4, 5, 6, 7]]],
      bullets: [['tabby', [0, 1, 2, 3, 4, 5, 6, 7]], ['siamese', [0, 1, 2, 3, 4, 5, 6, 7]]],
    };
    const rows = F[name] ?? F.capturer;
    this.cats = []; this.spits = []; this.turds = []; this.pickups = []; this.boss = null;
    this.mode = 'wave'; this.active = true; this.entryDone = true; this.breathMix = 1; this.waveT = 100; this.fireT = 1e9; this.diveT = 1e9;
    this.rowSp = 36; this.colSp = COL_SP; const x0 = WORLD_W / 2 - (7 * COL_SP) / 2; this.hurry = 0;
    const top = this.formTop = FORM_TOP + (rows.some(([b]) => this.enemy(b).behavior === 'capturer') ? PUP_LIFT : 0);
    rows.forEach(([breed, cs, row], ri) => { const def = this.enemy(breed); for (const c of cs) { const slot: Pt = [x0 + c * COL_SP, top + (row ?? ri) * 36]; this.cats.push(this.mkCat(def, slot[0], slot[1], 'form', { slot, row: row ?? ri, u: c - 3.5 })); } });
    this.total = this.cats.length; this.sway = 0; this.cx = WORLD_W / 2; this.amp = 6; // breathing at rest
    const holder = this.cats.find(c => c.def.behavior === 'capturer' && c.slot[0] > WORLD_W / 2 - COL_SP && c.slot[0] < WORLD_W / 2);
    if (holder) holder.pup = true;
  }

  /** Advance the staged moment; returns true once frozen (nothing else updates). */
  private stageScript(): boolean {
    const g = this.g; if (this.frozen) return true;
    const t = ++this.stageT; const name = this.stageReq ?? ''; const at = this.stageAt;
    const freeze = () => { this.frozen = true; g.paused = true; return true; };
    const find = (beh: string, col = 3) => this.cats.find(c => c.def.behavior === beh && Math.abs(c.slot[0] - (WORLD_W / 2 - (3.5 - col) * COL_SP)) < 2) ?? this.cats.find(c => c.def.behavior === beh);
    const shoot = (c: Cat | undefined) => { if (c) this.turds.push({ x: c.x, y: c.y + 26, vx: 0, vy: -6.2, kind: 'turd', t: 0 }); };
    switch (name) {
      case 'capturer': {
        const c = this.cats.find(c => c.pup);
        if (t === 2 && c) this.launchDive(this.cats.filter(o => o.st === 'form'), c);
        if (at ? t >= at : !!c && !!c.beam && BEAM_TICKS - c.beam >= 26) return freeze();
        break;
      }
      case 'rescue': { const c = this.cats.find(c => c.pup); if (t === 2 && c) { c.hp = 1; shoot(c); } if (t >= (at || 170)) return freeze(); break; }
      case 'splitter': { if (t === 2) shoot(find('splitter')); if (t >= (at || 22)) return freeze(); break; }
      case 'tank': {
        const c = find('tank');
        if (t === 2) shoot(c);
        if (at ? t >= at : !!c && c.flash === 10) return freeze();
        break;
      }
      case 'dive': {
        if (t === 2) { const c = find('diver', 0); if (c) this.launchDive(this.cats.filter(o => o.st === 'form'), c); }
        if (t >= (at || 96)) return freeze();
        break;
      }
      case 'tell': { const b = this.boss; if (!b || (at ? t >= at : b.st === 'tell' && b.stT >= 24 && b.flash === 0)) return freeze(); break; }
      case 'boss': { const b = this.boss; if (!b || (at ? t >= at : b.st === 'attack' && b.stT >= 36)) return freeze(); break; }
      case 'bullets': {
        const arts = ['blt_fur', 'blt_yarn', 'blt_paw', 'blt_bone', 'blt_yarnbig', 'blt_star'];
        arts.forEach((a, i) => { for (let k = 0; k < 3; k++) this.spits.push({ x: 104 + i * 48, y: 150 + k * 34, vx: 0, vy: 0, kind: 'hairball', t: k * 8, art: a }); });
        return freeze();
      }
      case 'lineup': if (t >= (at || 4)) return freeze(); break;
      default: this.stageReq = null;
    }
    return false;
  }

  render(g: Game, r: any) {
    const sc = g.state.scene;
    if (sc !== 'play' && sc !== 'bonus' && sc !== 'dialogue') return;
    const ground = this.grounded(), rim = this.rimKey(), tint = this.tint();
    for (const c of this.cats) {
      if (c.st === 'wait' || c.y < -30 || c.dead) continue;
      const frame = Math.floor((c.t + c.id * 7) / 12) % 2;
      const sz = c.def.size ?? 32;
      const x = c.x, y = c.y;
      // drop shadow: an ink-dither oval about as wide as the cat, offset a consistent 6px right and peeking 4-8px below it,
      // only on stages with a floor (no shadows in the sky or in space)
      if (ground) r.push(1, y, (ctx: CanvasRenderingContext2D) => ditherShadow(ctx, x + 6, y + sz * 0.5, sz * 0.72, Math.max(3, Math.round(sz * 0.22))));
      if (c.beam && c.id === c.group) { // the beam is drawn under the cats so the capturer reads as its source
        const k = Math.min(1, (BEAM_TICKS - c.beam) / 18, c.beam / 10);
        r.push(1, y + 1, (ctx: CanvasRenderingContext2D) => captureBeam(ctx, x, y + 12, Math.min(140, H - y), c.t, k));
      }
      if (c.st === 'kdive') { // a runaway kitten tumbling free leaves a short dotted streak, so it never reads as a lost grid cat
        const vx = c.vx, vy = c.vy, d = Math.hypot(vx, vy) || 1;
        r.push(1, y, (ctx: CanvasRenderingContext2D) => {
          for (let k = 1; k <= 3; k++) {
            const tx = Math.round(x - vx / d * (8 + k * 5)), ty = Math.round(y - vy / d * (8 + k * 5));
            ctx.fillStyle = col(k === 1 ? '6' : k === 2 ? '5' : 'f'); ctx.fillRect(tx, ty, k === 1 ? 2 : 1, k === 1 ? 2 : 1);
          }
        });
      }
      // cats dropping back into (or lifting off from) the grid are drawn under the parked cats, so the rack stays crisp
      // divers (and runaway kittens) fly above the rack, so a dive never slips under or tangles with parked neighbours
      r.push(2, c.st === 'return' || c.st === 'leave' ? -999 : c.st === 'dive' || c.st === 'kdive' ? y + 1000 : y, (ctx: CanvasRenderingContext2D) => {
        // memory carriers: the halo, gold rim, crown and held polaroid are drawn by the memories module
        // hit flash: the cat blinks to a solid white silhouette (on, off, on, off...) for the first 10 ticks: the main
        // "that hurt" signal. After that a red rim lingers for a moment so the breed stays readable while it recovers.
        const sil = c.flash > 3 && (c.flash & 2) !== 0, hurt = c.flash > 0 && c.flash <= 3;
        const rk = hurt ? 'r' : (c.glow ? undefined : rim);
        drawCombat(ctx, c.def.sprite, x, y, { frame, flipY: c.up, sil: sil ? '6' : undefined, rim: rk, recolor: tint, tintKey: g.state.tod });
        if (sil) { pxSpark(ctx, x - 10, y - 9, '6', 2); pxSpark(ctx, x + 11, y - 5, 'f', 1); }
        // a tank that has been hit wears a plaster (and sweats) so players learn it takes several turds
        if (!sil && c.hp < c.def.hp && c.def.hp > 1) {
          plaster(ctx, x + 8, y + (c.up ? 6 : -6));
          if (c.hp <= 1) { const d = (c.t >> 3) % 5; ctx.fillStyle = col('0'); ctx.fillRect(Math.round(x) - 12, Math.round(y) - 10 + d, 3, 5); ctx.fillStyle = col('s'); ctx.fillRect(Math.round(x) - 11, Math.round(y) - 9 + d, 1, 3); }
        }
        if (c.tell > 0) { // wind-up tell: a hairball glints at the mouth, growing before the cough
          const my = Math.round(y + (c.up ? -12 : 12)); const big = c.tell < this.T.tell / 2;
          pxDisc(ctx, x, my, big ? 3 : 2, '0'); pxDisc(ctx, x, my, big ? 2 : 1, 'd'); ctx.fillStyle = col('6'); ctx.fillRect(Math.round(x) - 1, my - 1, 1, 1);
          if ((c.tell >> 2) & 1) pxSpark(ctx, x + 6, my - 4, '6');
        }
      });
      if (c.pup) { // the captive pup in its throbbing bubble, held by a short stepped tractor beam from its carrier
        r.push(3, y + 40, (ctx: CanvasRenderingContext2D) => {
          const [px, py] = this.pupPos(c); const k = c.pupK ?? -1; const s = Math.sign(k || 1);
          const hy = Math.round(y + s * (sz / 2 - 3)), ey = Math.round(py - s * 9);
          if (Math.abs(ey - hy) > 2) tractor(ctx, x, hy, px, ey, 1, 5, c.t);
          bubble(ctx, px, py, 10, c.t, true);
          drawSprite(ctx, 'pup', px, py, { frame: (c.t >> 4) & 1 });
        });
      }
    }
    if (this.frozen && (this.stageReq === 'dive' || this.stageReq === 'capturer')) { // staged only: dotted flight path of the dive
      const c = this.cats.find(o => o.st === 'dive' && o.id === o.group);
      if (c?.track) { const tr = c.track; r.push(1, 0, (ctx: CanvasRenderingContext2D) => { for (let s = 0; s < tr.len; s += 6) { tr.at(s, tp); ctx.fillStyle = col(s < c.s ? '5' : 'f'); ctx.fillRect(Math.round(tp.x), Math.round(tp.y), 2, 2); } }); }
    }
    if (this.boss) this.boss.render(r);
    for (const s of this.shocks) if (s.t > 0) { // phase-change shockwave: a pixel ring rolling off the Big Cat, inked so it reads on any floor
      const rad = Math.round(14 + s.t * 5); const k = s.t < 10 ? '6' : s.t < 20 ? 'd' : 'r';
      r.push(4, -1, (ctx: CanvasRenderingContext2D) => { pxRing(ctx, s.x, s.y, rad + 1, '0'); pxRing(ctx, s.x, s.y, rad, k); if (s.t < 18) pxRing(ctx, s.x, s.y, rad - 1, k); });
    }
    for (const s of this.turds) r.push(3, s.y, (ctx: CanvasRenderingContext2D) => drawSprite(ctx, 'turd', s.x, s.y, { frame: 0 }));
    // enemy bullets sit above everything else in the air layer: fixed high-contrast art, never blinking
    for (const s of this.spits) r.push(4, s.y, (ctx: CanvasRenderingContext2D) => drawBullet(ctx, s.art ?? (s.kind === 'yarn' ? 'blt_yarn' : 'blt_fur'), s.x, s.y, s.t));
    for (const k of this.pickups) r.push(3, k.y, (ctx: CanvasRenderingContext2D) => {
      const pup = k.kind === 'pup';
      const name = pup ? 'pup' : k.kind.startsWith('memory:') ? 'pk_memory' : (g.content.items.find(i => i.id === k.kind)?.sprite ?? k.kind);
      const bob = Math.round(Math.sin(k.t / 10) * 2);
      if (pup) bubble(ctx, k.x, k.y + bob, 12, k.t, true);   // floating in a bubble, so it reads as "catch me"
      else pickupBadge(ctx, k.x, k.y + bob, k.t);          // framed treasure: never confused with a (round, purple) shot
      drawSprite(ctx, name, k.x, k.y + bob);
    });
  }
}
export const makeInteraction = (): Module => new Interaction();
