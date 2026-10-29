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
import { COL_SP, ROW_SP, layout, shapeFor, type Shape } from './formation';

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
}
/** `art` names the bullet sprite (cats: blt_fur / blt_yarn, bosses: one per bossPattern). */
export interface Shot { x: number; y: number; vx: number; vy: number; kind: 'turd' | 'hairball' | 'yarn'; t: number; art?: string }
export interface Pickup { kind: string; x: number; y: number; vy: number; t: number; vx?: number }

const WAVE_LIMIT = 75 * 60;  // cats lose interest after 75s, so waves can never stall
const MAX_TURDS = 4;
// Formation grid (Galaga-like readability): at most 8 columns x 5 rows, with clear lanes between cats.
const FORM_TOP = 40;
const STREAM_STEP = 16;     // ticks between cats in one entry stream (>= 40px along the path: 32px sprites never overlap)
const BEAM_TICKS = 84;      // capturer's tractor-beam moment
const tp: TrackPos = { x: 0, y: 0, hx: 0, hy: 1 };
const PUP_LIFT = 22;        // the formation sits this much lower when a captive pup rides above its holder
const HURRY_LEAVE = 9 * 60; // once only ~20% of a wave is left, stragglers dive hard, then fly off after 9s
/** Stages with no ground below the action (sky and space): nothing to cast a shadow on. */
const AIRBORNE = new Set(['sky', 'moon', 'nebula', 'station', 'mothership']);
/** Time-of-day tint for the combat layer (subtle: highlights cool at night, warm at dusk and dawn). */
const TOD_TINT: Record<string, Record<string, string> | undefined> = { night: { '6': 's' }, dusk: { '6': '7' }, dawn: { '6': '7' } };
/** Light rim around every cat on dark stages, so black / navy cats never melt into night floors. */
const TOD_RIM: Record<string, string | undefined> = { night: '5', dusk: '7' };

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
  T: Tuning = { d: 0, spitSpeed: 1.5, spitCap: 3, bossSpitCap: 14, fireEvery: 90, diveEvery: 180, diveGroups: 1, diveSpeed: 2.7, entrySpeed: 2.7, diveShots: 1, tell: 22, aimSlop: 50 };
  fireT = 0; diveT = 0; breathMix = 0; entryDone = false; clearHold = 0; total = 0; formTop = FORM_TOP; hurry = 0;

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

  clearAll() { this.cats = []; this.turds = []; this.spits = []; this.pickups = []; this.boss = null; this.active = false; this.mode = 'none'; this.bonus = null; }
  /** Pom napped: clear the air. Waves restart; a boss keeps its damage (cozy, never a full reset). */
  napReset() { this.turds = []; this.spits = []; this.pickups = []; if (this.boss) { this.boss.reenter(); this.cats = []; } else this.clearAll(); }
  liveCats() { return this.cats.length + (this.boss ? 1 : 0); }
  /** True when the stage has a floor to cast shadows on. */
  grounded() { return !AIRBORNE.has(this.g.state.areaId); }
  /** Rim colour for combat sprites at this time of day (undefined: no rim needed in daylight). */
  rimKey() { return TOD_RIM[this.g.state.tod]; }
  tint() { return TOD_TINT[this.g.state.tod]; }

  private mkCat(def: EnemyDef, x: number, y: number, st: CatState, extra: Partial<Cat> = {}): Cat {
    return { id: this.nextId++, def, hp: def.hp, x, y, vx: 0, vy: 0, st, slot: [x, y], track: null, s: 0, speed: 0, lat: 0, weave: 0,
      delay: 0, t: 0, flash: 0, tell: 0, shots: 0, group: 0, side: 1, diveSeed: 0, ...extra };
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
    const top = this.formTop = FORM_TOP + (holderWave ? PUP_LIFT : 0);
    this.rowSp = ROW_SP; this.colSp = COL_SP;
    this.shape = shapeFor(areaIdx, i);
    let n = 0; const first = this.cats.length;
    const slots = layout(w, this.shape, i, id => this.enemy(id)).map(h => ({ def: h.def, slot: [WORLD_W / 2 + h.u * COL_SP, top + h.row * ROW_SP + h.dy] as Pt }));
    // streams of 8: single file for 'loop' (two mirrored groups at once), pairs for the others
    const single = w.entry === 'loop' || !['split', 'swirl-left', 'swirl-right', 'rain'].includes(w.entry);
    const groupLen = (single ? 8 : 4) * STREAM_STEP;
    // mirrored groups from alternating sides may overlap in time (they never share airspace): a lively, ~6-8s entry
    const gap = Math.round(groupLen * (single ? 1 : 0.7)) + Math.round(24 - 12 * T.d);
    for (const { def, slot } of slots) {
      const gi = Math.floor(n / 8), k = n % 8;
      let kind: string = w.entry, side = 1, lat = 0, delay = gi * gap;
      switch (w.entry) {
        case 'split': side = k % 2 ? -1 : 1; delay += Math.floor(k / 2) * STREAM_STEP; break;           // two crossing streams
        case 'swirl-left': case 'swirl-right':                                                          // pairs abreast, groups alternate sides
          side = gi % 2 ? -1 : 1; lat = k % 2 ? -19 : 19; delay += Math.floor(k / 2) * STREAM_STEP; break;
        case 'loop': side = gi % 2 ? -1 : 1; delay = Math.floor(gi / 2) * gap + k * STREAM_STEP; break; // single file, both sides at once
        case 'rain': side = k % 2 ? -1 : 1; delay += Math.floor(k / 2) * STREAM_STEP; break;          // two mirrored pours
        default: delay += k * STREAM_STEP;
      }
      const track = new Track(entryPath(kind, side, slot));
      const p0 = track.at(0, tp);
      this.cats.push(this.mkCat(def, p0.x, p0.y, 'wait', { slot, track, speed: T.entrySpeed, lat, delay, side, diveSeed: g.rng.next() }));
      n++;
    }
    // no two cats may share an entry lane at the same moment (same side + lane offset start at the same
    // off-screen point and would fly stacked on top of each other): queue a late-comer one stream step behind
    const lanes = new Map<string, number>();
    for (const c of this.cats.slice(first).sort((a, b) => a.delay - b.delay)) {
      const key = c.side + ':' + c.lat; const last = lanes.get(key);
      if (last !== undefined && c.delay < last + STREAM_STEP) c.delay = last + STREAM_STEP;
      lanes.set(key, c.delay);
    }
    this.total = this.cats.length;
    // a capturer may carry a lost pup (once per area)
    // the lost pup rides with a different capturer each wave, so its column moves around
    const caps = this.cats.filter(c => c.def.behavior === 'capturer');
    const holder = caps.length ? caps[i % caps.length] : undefined;
    if (holder && !g.state.flags['pup_' + areaId]) holder.pup = true;
    g.bus.emit('wave:start', { areaId, waveIndex: i, count: this.cats.length });
  }

  startBoss(id: string) {
    this.clearAll(); this.g.reseed('boss', id);
    this.T = tuning(this.g);
    const def = this.enemy(id);
    this.boss = new Boss(this.g, this, def); this.active = true; this.mode = 'boss';
    this.g.bus.emit('boss:start', { bossId: id });
  }

  startBonus(def: BonusDef, total = def.groups * 8) {
    this.clearAll(); this.g.reseed('bonus', def.id);
    this.T = tuning(this.g); this.waveT = 0;
    this.mode = 'bonus'; this.active = true; this.bonus = { def, hits: 0, total };
    const ed = this.enemy(def.breed);
    for (let gi = 0; gi < def.groups; gi++) {
      const track = new Track(bonusPath(def.pattern, gi)); const p0 = track.at(0, tp);
      for (let k = 0; k < 8; k++)
        this.cats.push(this.mkCat({ ...ed, hp: 1 }, p0.x, p0.y, 'wait', { track, speed: 2.5, lat: k % 2 ? -8 : 8, delay: gi * 140 + Math.floor(k / 2) * 16 }));
    }
  }

  markGlow() { const c = this.cats.find(c => !c.pup && !c.glow && c.def.behavior !== 'capturer'); if (c) c.glow = true; }

  spawnPickup(kind: string, x: number, y: number) {
    const pup = kind === 'pup';
    this.pickups.push({ kind, x, y, vy: pup ? -0.9 : 0.7, t: 0, vx: 0 });
  }

  fireTurds(x: number, y: number, pattern: { dx: number; vx: number }[]) {
    if (this.turds.length + pattern.length > MAX_TURDS + 4 || this.turds.length >= MAX_TURDS + (pattern.length - 1) * 2) return false;
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

  /** Formation home of a slot right now: sways side to side while cats arrive, then breathes in and out. */
  private liveSlot(c: Cat): Pt {
    const bm = this.breathMix;
    const sw = Math.sin(this.sway / 80) * 14 * (1 - bm);
    const br = (1 - Math.cos(this.sway / 40)) * 0.5 * bm;   // 0..1
    const top = this.formTop;
    return [WORLD_W / 2 + (c.slot[0] - WORLD_W / 2) * (1 + br * 0.12) + sw, top - 4 + (c.slot[1] - top + 4) * (1 + br * 0.16)];
  }

  private boop(c: Cat, viaTurd = true) {
    const g = this.g; const diving = c.st === 'dive' || c.st === 'kdive';
    const pts = this.mode === 'bonus' ? 100 : diving ? (c.def.divePoints ?? c.def.points * 2) : c.def.points;
    g.ops.addScore(pts); g.state.stats.catsBooped++;
    if (viaTurd) g.state.stats.hits++;
    g.mods.effects?.burst(c.x, c.y, 'boop'); g.mods.effects?.floatText(c.x, c.y - 10, String(pts));
    g.mods.audio?.sfx('meow');
    if (c.pup) { const [px, py] = this.pupPos(c); this.spawnPickup('pup', px, py); g.mods.effects?.burst(px, py, 'sparkle'); }
    if (this.wave?.pickup && g.rng.chance(0.06)) this.spawnPickup(this.wave.pickup, c.x, c.y);
    if (c.def.behavior === 'splitter') for (const s of [-1, 1]) this.spawnKitten(c.x + s * 6, c.y, s * 1.5, -1.6, c.slot);
    if (this.bonus) this.bonus.hits++;
    c.dead = true;
    g.bus.emit('cat:boop', { breed: c.def.id, x: c.x, y: c.y, points: pts, glow: !!c.glow, bonus: this.mode === 'bonus' });
  }

  /** Where the captive pup floats: above its holder in formation (as Galaga parks the captured fighter), 12px below its
   *  feet in flight, swinging around the side in between so the bubble never covers a face. */
  pupPos(c: Cat): [number, number] {
    const k = c.pupK ?? -1; const d = (c.def.size ?? 32) / 2 + 12 + 10;
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
    const timedOut = this.waveT > WAVE_LIMIT && this.mode === 'wave';
    if (!this.entryDone && this.mode === 'wave' && !this.cats.some(o => o.st === 'wait' || o.st === 'enter' || o.st === 'home')) this.entryDone = true;
    if (this.entryDone && this.breathMix < 1) this.breathMix = Math.min(1, this.breathMix + 1 / 90);

    // schedulers: dives and formation fire (Galaga style: a steady drumbeat, not random noise)
    // last stand: once only ~20% of the wave is left, the stragglers dive back to back, then give up and fly off
    if (this.mode === 'wave' && this.entryDone && !this.hurry) {
      const alive = this.cats.filter(c => c.st !== 'leave' && c.st !== 'kdive').length;
      if (alive <= Math.max(2, Math.ceil(this.total * 0.2))) { this.hurry = 1; this.diveT = Math.min(this.diveT, 20); }
    }
    if (this.hurry) this.hurry++;
    const hurryOut = this.hurry > HURRY_LEAVE;
    const special = (c: Cat) => !!c.pup || !!c.glow;   // a lost pup or a memory never flies away undelivered
    if (this.mode === 'wave' && w && !timedOut) {
      const inForm = this.cats.filter(c => c.st === 'form');
      if (this.entryDone && --this.diveT <= 0) {
        const groups = new Set(this.cats.filter(c => c.st === 'dive').map(c => c.group)).size;
        if ((this.hurry || groups < T.diveGroups) && inForm.length) this.launchDive(inForm);
        const left = inForm.length / Math.max(1, this.total);
        this.diveT = this.hurry ? Math.round(g.rng.range(34, 52)) : Math.round(T.diveEvery * g.rng.range(0.7, 1.3) * (0.45 + 0.55 * left));
      }
      if (--this.fireT <= 0) {
        this.fireT = Math.round(T.fireEvery * g.rng.range(0.6, 1.4));
        if (inForm.length && this.spits.length < T.spitCap) {
          const px = P?.x ?? WORLD_W / 2; let tot = 0;
          const wt = inForm.map(c => { const v = (c.def.behavior === 'shooter' ? 4 : 1) * (Math.abs(c.x - px) < 90 ? 2 : 1) * (c.tell ? 0 : 1); tot += v; return v; });
          let r = g.rng.next() * tot;
          for (let k = 0; k < inForm.length; k++) { r -= wt[k]; if (r <= 0 && wt[k]) { inForm[k].tell = T.tell; break; } }
        }
      }
    }

    const arr = this.cats;
    for (const c of arr) {
      if (c.dead) continue;
      c.t++; if (c.flash > 0) c.flash--;
      const ox = c.x, oy = c.y;
      switch (c.st) {
        case 'wait': if (--c.delay <= 0) c.st = bonus ? 'flyby' : 'enter'; break;
        case 'enter': case 'flyby': case 'dive': {
          // capturer's tractor-beam moment: the whole group hovers low while the beam unrolls, then flies on
          if (c.st === 'dive' && c.def.behavior === 'capturer' && c.id === c.group && !c.beamUsed && c.y > 186 && c.vy > 0) {
            c.beamUsed = true; for (const o of arr) if (o.group === c.group && o.st === 'dive') o.beam = BEAM_TICKS;
            g.mods.audio?.sfx('blip');
          }
          if (c.beam) { c.beam--; break; }
          const tr = c.track!; c.s += c.speed; tr.at(c.s, tp);
          // lateral offset: pairs flying abreast, zigzag weave; fades in after the peel and out near the end
          const fade = Math.min(1, c.s / 40, (tr.len - c.s) / 50);
          const off = c.lat * Math.max(0, fade) + (c.weave ? Math.sin(c.t / 8) * c.weave * Math.max(0, Math.min(1, (c.s - 60) / 40)) : 0);
          c.x = tp.x - tp.hy * off; c.y = tp.y + tp.hx * off;
          if (c.s >= tr.len) {
            if (c.st === 'enter') c.st = 'home';
            else if (c.st === 'flyby') { c.st = 'leave'; c.dead = true; }
            else { // dive done: wrap to the top if it flew off the bottom, then glide home
              if (c.y > H) { c.x = this.liveSlot(c)[0]; c.y = -28; }
              c.st = timedOut || (hurryOut && !special(c)) ? 'leave' : 'return'; c.speed = 2.4;
            }
          }
          if (c.st === 'dive' && c.shots > 0 && c.tell === 0 && c.y > 110 && c.y < 220 && P && Math.abs(c.x - P.x) < 120 && this.spits.length < T.spitCap && g.rng.chance(0.05)) { c.shots--; c.tell = T.tell; }
          break;
        }
        case 'home': case 'return': {
          const [sx, sy] = this.liveSlot(c); const dx = sx - c.x, dy = sy - c.y; const d = Math.hypot(dx, dy);
          const sp = c.st === 'home' ? c.speed : Math.min(c.speed, 1 + d * 0.05);
          if (d <= sp + 0.5) { c.x = sx; c.y = sy; c.st = 'form'; }
          else { c.x += dx / d * sp; c.y += dy / d * sp; }
          if (timedOut || (hurryOut && !special(c))) c.st = 'leave';
          break;
        }
        case 'form': {
          const [sx, sy] = this.liveSlot(c); c.x = sx; c.y = sy;
          if (timedOut || (hurryOut && !special(c))) c.st = 'leave';
          break;
        }
        case 'kdive': {
          c.vy = Math.min(2.4, c.vy + 0.07); c.vx *= 0.985;
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
        if (b.vulnerable()) { g.mods.effects?.burst(sx, sy, 'splat'); b.damage(1); g.state.stats.hits++; g.mods.audio?.sfx('thud'); }
        else g.mods.effects?.burst(s.x, b.y + 20, 'sparkle');
      }
      if (b.dead) {
        g.ops.addScore(b.def.points); g.mods.effects?.burst(b.x, b.y, 'bigboop'); g.mods.effects?.shake(6, 30);
        g.mods.audio?.sfx('bossdown'); this.spawnPickup('pk_heart', b.x, b.y);
        for (const s of this.spits) g.mods.effects?.burst(s.x, s.y, 'sparkle');
        this.spits = []; for (const c of this.cats) if (c.st === 'kdive') { c.st = 'leave'; }
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
  private launchDive(inForm: Cat[], forced?: Cat) {
    const g = this.g; const r = g.rng; const T = this.T; const P = g.mods.player; const px = P?.x ?? WORLD_W / 2;
    let tot = 0;
    const wt = inForm.map(c => { const b = c.def.behavior; const v = b === 'diver' || b === 'zigzag' ? 2 : b === 'capturer' ? 1.6 : 1; tot += v; return v; });
    let pick = r.next() * tot, leader = inForm[0];
    for (let k = 0; k < inForm.length; k++) { pick -= wt[k]; if (pick <= 0) { leader = inForm[k]; break; } }
    if (forced) leader = forced;
    const b = leader.def.behavior;
    const maxEsc = b === 'capturer' || b === 'tank' ? 2 : (b === 'basic' || b === 'splitter') && r.chance(0.4) ? 1 : 0;
    const sp = this.colSp;
    const esc = inForm.filter(o => o !== leader && o.slot[1] > leader.slot[1] && o.slot[1] - leader.slot[1] < this.rowSp + 4 && Math.abs(o.slot[0] - leader.slot[0]) < sp * 1.2)
      .sort((a, c) => Math.abs(a.slot[0] - leader.slot[0]) - Math.abs(c.slot[0] - leader.slot[0])).slice(0, maxEsc);
    const path = divePath(leader.x, leader.y, px + r.range(-T.aimSlop, T.aimSlop), b === 'splitter' ? 'basic' : b, r.range(-1, 1), H);
    const speed = T.diveSpeed * (b === 'diver' ? 1.15 : b === 'tank' ? 0.8 : b === 'capturer' ? 0.9 : 1);
    for (const c of [leader, ...esc]) {
      const ox = c.x - leader.x, oy = c.y - leader.y;
      c.track = new Track(path.map(p => [p[0] + ox, p[1] + oy] as Pt)); c.s = 0; c.speed = speed; c.lat = 0;
      c.weave = c.def.behavior === 'zigzag' ? 14 : 0;
      c.st = 'dive'; c.group = leader.id; c.beam = 0; c.beamUsed = false;
      c.shots = r.int(0, T.diveShots) + (c.def.behavior === 'shooter' ? 1 : 0);
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
    if (P) { P.x = WORLD_W / 2; P.y = 316; P.vx = 0; P.vy = 0; }
    if (name === 'tell' || name === 'boss') {
      const bossId = g.mods.world?.area?.(g.state.areaId)?.boss ?? 'boss_whiskers';
      this.startBoss(bossId); this.boss!.stageTell(this.stagePhase);
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
    rows.forEach(([breed, cs, row], ri) => { const def = this.enemy(breed); for (const c of cs) { const slot: Pt = [x0 + c * COL_SP, top + (row ?? ri) * 36]; this.cats.push(this.mkCat(def, slot[0], slot[1], 'form', { slot })); } });
    this.total = this.cats.length; this.sway = 40 * Math.PI * 2; // breathing at rest
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
        if (t === 2) { const c = find('diver', 2); if (c) this.launchDive(this.cats.filter(o => o.st === 'form'), c); }
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
      r.push(2, y, (ctx: CanvasRenderingContext2D) => {
        if (c.glow) { // memory cat: a warm, dithered pixel halo with orbiting sparkles
          pxDither(ctx, x, y, 17, 'f', (c.t >> 3) & 1);
          pxRing(ctx, x, y, 18, (c.t >> 3) & 1 ? 'f' : '7', 3, c.t / 20);
        }
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
