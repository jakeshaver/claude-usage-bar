import type { Game, Module } from '../core/game';
import { WORLD_W, H } from '../core/game';
import type { EnemyDef, WaveDef, BonusDef } from '../core/types';
import { drawSprite } from '../art/sprite';
import { col } from '../core/palette';
import { entryPath, divePath, bonusPath, Track, type Pt, type TrackPos } from './paths';
import { tuning, type Tuning } from './tuning';
import { pxRing, pxDither, pxShadow, pxSpark, pxDisc } from './pixel';
import { Boss } from './boss';

export type CatState = 'wait' | 'enter' | 'home' | 'form' | 'dive' | 'return' | 'leave' | 'flyby' | 'kdive';
export interface Cat {
  id: number; def: EnemyDef; hp: number; x: number; y: number; vx: number; vy: number;
  st: CatState;
  slot: Pt; track: Track | null; s: number; speed: number; lat: number; weave: number;
  delay: number; t: number; flash: number; tell: number; shots: number; group: number;
  pup?: boolean; glow?: boolean; side: number; diveSeed: number; dead?: boolean; up?: boolean;
}
export interface Shot { x: number; y: number; vx: number; vy: number; kind: 'turd' | 'hairball' | 'yarn'; t: number }
export interface Pickup { kind: string; x: number; y: number; vy: number; t: number; vx?: number }

const WAVE_LIMIT = 75 * 60;  // cats lose interest after 75s, so waves can never stall
const MAX_TURDS = 4;
const tp: TrackPos = { x: 0, y: 0, hx: 0, hy: 1 };

/** Interaction: turds, cats, formations, dives, damage, bosses, pickups. */
class Interaction implements Module {
  id = 'interaction';
  api = this;
  g!: Game;
  cats: Cat[] = []; turds: Shot[] = []; spits: Shot[] = []; pickups: Pickup[] = [];
  boss: Boss | null = null;
  wave: WaveDef | null = null; waveT = 0; active = false; mode: 'none' | 'wave' | 'boss' | 'bonus' = 'none';
  bonus: { def: BonusDef; hits: number; total: number } | null = null;
  sway = 0; nextId = 1; pupHolder = -1;
  T: Tuning = { d: 0, spitSpeed: 1.5, spitCap: 3, bossSpitCap: 14, fireEvery: 90, diveEvery: 180, diveGroups: 1, diveSpeed: 2.7, entrySpeed: 2.7, diveShots: 1, tell: 22 };
  fireT = 0; diveT = 0; breathMix = 0; entryDone = false; clearHold = 0; total = 0;

  init(g: Game) { this.g = g; }
  enemy(id: string) { return this.g.content.enemies.find(e => e.id === id) ?? this.g.content.enemies[0]; }

  clearAll() { this.cats = []; this.turds = []; this.spits = []; this.pickups = []; this.boss = null; this.active = false; this.mode = 'none'; this.bonus = null; }
  /** Pom napped: clear the air. Waves restart; a boss keeps its damage (cozy, never a full reset). */
  napReset() { this.turds = []; this.spits = []; this.pickups = []; if (this.boss) { this.boss.reenter(); this.cats = []; } else this.clearAll(); }
  liveCats() { return this.cats.length + (this.boss ? 1 : 0); }

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
    this.fireT = 120; this.diveT = 60; this.breathMix = 0; this.entryDone = false; this.clearHold = 0;
    const sp = w.formation.spacing ?? 36; const cols = w.formation.cols;
    const x0 = WORLD_W / 2 - ((cols - 1) * sp) / 2;
    const gap = Math.round(96 - 26 * T.d);
    let n = 0;
    for (const grp of w.cats) {
      const def = this.enemy(grp.breed);
      const colsList = grp.cols ?? Array.from({ length: cols }, (_, k) => k);
      for (const c of colsList) {
        const slot: Pt = [x0 + c * sp, 44 + grp.row * 30];
        const gi = Math.floor(n / 8), k = n % 8;
        let kind: string = w.entry, side = 1, lat = 0, delay = gi * gap;
        switch (w.entry) {
          case 'split': side = k % 2 ? -1 : 1; delay += Math.floor(k / 2) * 12; break;           // two crossing streams
          case 'swirl-left': case 'swirl-right':                                                  // pairs abreast, groups alternate sides
            side = gi % 2 ? -1 : 1; lat = k % 2 ? -15 : 15; delay += Math.floor(k / 2) * 14; break;
          case 'loop': side = gi % 2 ? -1 : 1; delay += k * 10; break;                             // single file, alternating sides
          case 'rain': side = k % 2 ? -1 : 1; delay += Math.floor(k / 2) * 11; break;          // two mirrored pours
          default: delay += k * 10;
        }
        const track = new Track(entryPath(kind, side, slot));
        const p0 = track.at(0, tp);
        this.cats.push(this.mkCat(def, p0.x, p0.y, 'wait', { slot, track, speed: T.entrySpeed, lat, delay, side, diveSeed: g.rng.next() }));
        n++;
      }
    }
    this.total = this.cats.length;
    // a capturer may carry a lost pup (once per area)
    const holder = this.cats.find(c => c.def.behavior === 'capturer');
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
    this.pickups.push({ kind, x, y, vy: pup ? -1.4 : 0.7, t: 0, vx: 0 });
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
    return [WORLD_W / 2 + (c.slot[0] - WORLD_W / 2) * (1 + br * 0.14) + sw, 36 + (c.slot[1] - 36) * (1 + br * 0.22)];
  }

  private boop(c: Cat, viaTurd = true) {
    const g = this.g; const diving = c.st === 'dive' || c.st === 'kdive';
    const pts = this.mode === 'bonus' ? 100 : diving ? (c.def.divePoints ?? c.def.points * 2) : c.def.points;
    g.ops.addScore(pts); g.state.stats.catsBooped++;
    if (viaTurd) g.state.stats.hits++;
    g.mods.effects?.burst(c.x, c.y, 'boop'); g.mods.effects?.floatText(c.x, c.y - 10, String(pts));
    g.mods.audio?.sfx('meow');
    if (c.pup) { this.spawnPickup('pup', c.x, c.y + 14); g.mods.effects?.burst(c.x, c.y + 14, 'sparkle'); }
    if (this.wave?.pickup && g.rng.chance(0.06)) this.spawnPickup(this.wave.pickup, c.x, c.y);
    if (c.def.behavior === 'splitter') for (const s of [-1, 1]) this.spawnKitten(c.x + s * 6, c.y, s * 1.5, -1.6, c.slot);
    if (this.bonus) this.bonus.hits++;
    c.dead = true;
    g.bus.emit('cat:boop', { breed: c.def.id, x: c.x, y: c.y, points: pts, glow: !!c.glow, bonus: this.mode === 'bonus' });
  }

  /** Kittens pop out in a little arc, then tumble down toward Pom. */
  spawnKitten(x: number, y: number, vx: number, vy: number, slot: Pt = [x, y]) {
    const kd = this.enemy('kitten');
    this.cats.push(this.mkCat(kd, x, y, 'kdive', { vx, vy, slot, side: Math.sign(vx) || 1, diveSeed: this.g.rng.next() }));
  }

  update(g: Game) {
    const sc = g.state.scene;
    if ((sc !== 'play' && sc !== 'bonus') || g.paused) return;
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
    if (this.mode === 'wave' && w && !timedOut) {
      const inForm = this.cats.filter(c => c.st === 'form');
      if (this.entryDone && --this.diveT <= 0) {
        const groups = new Set(this.cats.filter(c => c.st === 'dive').map(c => c.group)).size;
        if (groups < T.diveGroups && inForm.length) this.launchDive(inForm);
        const left = inForm.length / Math.max(1, this.total);
        this.diveT = Math.round(T.diveEvery * g.rng.range(0.7, 1.3) * (0.45 + 0.55 * left));
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
              c.st = timedOut ? 'leave' : 'return'; c.speed = 2.4;
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
          if (timedOut) c.st = 'leave';
          break;
        }
        case 'form': {
          const [sx, sy] = this.liveSlot(c); c.x = sx; c.y = sy;
          if (timedOut) c.st = 'leave';
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
      // wind-up, then cough a hairball
      if (c.tell > 0 && --c.tell === 0 && !c.dead && c.st !== 'leave' && c.st !== 'wait') this.spit(c, P);

      // turd collisions: generous cat boxes
      if (c.st !== 'wait' && c.st !== 'leave' && !c.dead && c.y > -10) {
        const r = (c.def.size ?? 32) / 2 - 3;
        for (const s of this.turds) {
          if (Math.abs(s.x - c.x) < r + 2 && Math.abs(s.y - c.y) < r + 3) {
            s.y = -999; c.hp--; g.mods.audio?.sfx('thud');
            if (c.hp <= 0) this.boop(c);
            else { c.flash = 14; c.y -= 3; g.mods.effects?.burst(c.x, c.y - 6, 'poof'); }   // tanks shrug it off, flashing
            break;
          }
        }
        // body collision with Pom (small player box)
        if (!c.dead && pb && c.y > 150 && (c.st === 'dive' || c.st === 'kdive' || c.st === 'return') &&
          Math.abs(c.x - (pb.x + pb.w / 2)) < 8 + pb.w / 2 && Math.abs(c.y - (pb.y + pb.h / 2)) < 8 + pb.h / 2) {
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
        s.y = -999;
        if (b.vulnerable()) { b.damage(1); g.state.stats.hits++; g.mods.audio?.sfx('thud'); }
        else g.mods.effects?.burst(s.x, b.y + 20, 'sparkle');
      }
      if (b.dead) {
        g.ops.addScore(b.def.points); g.mods.effects?.burst(b.x, b.y, 'bigboop'); g.mods.effects?.shake(6, 30);
        g.mods.audio?.sfx('bossdown'); this.spawnPickup('pk_heart', b.x, b.y);
        for (const s of this.spits) g.mods.effects?.burst(s.x, s.y, 'sparkle');
        this.spits = []; for (const c of this.cats) if (c.st === 'kdive') { c.st = 'leave'; }
        g.bus.emit('boss:defeat', { bossId: b.def.id, napped: b.napped });
        this.boss = null; this.active = false; this.mode = 'none';
      } else if (pb && b.touches(pb)) {
        P.hit();
        if (!this.boss) return;
      }
    }

    // spit vs Pom: the hairball's fuzzy edge never counts, only its core
    if (pb) for (const s of this.spits) {
      const rr = s.kind === 'yarn' ? 3 : 2;
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
  private launchDive(inForm: Cat[]) {
    const g = this.g; const r = g.rng; const T = this.T; const P = g.mods.player; const px = P?.x ?? WORLD_W / 2;
    let tot = 0;
    const wt = inForm.map(c => { const b = c.def.behavior; const v = b === 'diver' || b === 'zigzag' ? 2 : b === 'capturer' ? 1.6 : 1; tot += v; return v; });
    let pick = r.next() * tot, leader = inForm[0];
    for (let k = 0; k < inForm.length; k++) { pick -= wt[k]; if (pick <= 0) { leader = inForm[k]; break; } }
    const b = leader.def.behavior;
    const maxEsc = b === 'capturer' || b === 'tank' ? 2 : (b === 'basic' || b === 'splitter') && r.chance(0.4) ? 1 : 0;
    const sp = this.wave?.formation.spacing ?? 36;
    const esc = inForm.filter(o => o !== leader && o.slot[1] > leader.slot[1] && o.slot[1] - leader.slot[1] < 34 && Math.abs(o.slot[0] - leader.slot[0]) < sp * 1.2)
      .sort((a, c) => Math.abs(a.slot[0] - leader.slot[0]) - Math.abs(c.slot[0] - leader.slot[0])).slice(0, maxEsc);
    const path = divePath(leader.x, leader.y, px + r.range(-30, 30), b === 'splitter' ? 'basic' : b, r.range(-1, 1), H);
    const speed = T.diveSpeed * (b === 'diver' ? 1.15 : b === 'tank' ? 0.8 : b === 'capturer' ? 0.9 : 1);
    for (const c of [leader, ...esc]) {
      const ox = c.x - leader.x, oy = c.y - leader.y;
      c.track = new Track(path.map(p => [p[0] + ox, p[1] + oy] as Pt)); c.s = 0; c.speed = speed; c.lat = 0;
      c.weave = c.def.behavior === 'zigzag' ? 14 : 0;
      c.st = 'dive'; c.group = leader.id;
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
    this.spits.push({ x: c.x, y: c.y + 10, vx, vy, kind: yarn ? 'yarn' : 'hairball', t: 0 });
    this.g.mods.audio?.sfx('hack');
  }

  bossSpit(x: number, y: number, vx: number, vy: number) { if (this.spits.length < this.T.bossSpitCap) this.spits.push({ x, y, vx, vy, kind: 'hairball', t: 0 }); }

  private collect(k: Pickup) {
    const g = this.g; const P = g.mods.player;
    g.mods.audio?.sfx('pickup'); g.mods.effects?.burst(k.x, k.y, 'sparkle');
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
    g.mods.ui?.toast(item.name.toUpperCase());
  }

  render(g: Game, r: any) {
    const sc = g.state.scene;
    if (sc !== 'play' && sc !== 'bonus' && sc !== 'dialogue') return;
    for (const c of this.cats) {
      if (c.st === 'wait' || c.y < -30 || c.dead) continue;
      const frame = Math.floor((c.t + c.id * 7) / 12) % 2;
      const sz = c.def.size ?? 32;
      const x = c.x, y = c.y;
      r.push(1, y, (ctx: CanvasRenderingContext2D) => pxShadow(ctx, x + 3, y + sz / 2 + 8, sz * 0.55, 0.26));
      r.push(2, y, (ctx: CanvasRenderingContext2D) => {
        if (c.glow) { // memory cat: a warm, dithered pixel halo with orbiting sparkles
          pxDither(ctx, x, y, 17, 'f', (c.t >> 3) & 1);
          pxRing(ctx, x, y, 18, (c.t >> 3) & 1 ? 'f' : '7', 3, c.t / 20);
        }
        if (c.pup) { // the lost pup dangles from a strand of yarn, swinging
          const sw = Math.round(Math.sin(c.t / 12) * 2);
          ctx.fillStyle = col('d'); ctx.fillRect(Math.round(x), Math.round(y + 8), 1, 8 + (sw ? 1 : 0));
          drawSprite(ctx, 'pup', x + sw, y + 22);
        }
        const flash = c.flash > 0 && ((c.flash >> 1) & 1) === 1;
        drawSprite(ctx, c.def.sprite, x, y, { frame, flash, flipY: c.up });
        if (c.tell > 0) { // wind-up tell: a hairball glints at the mouth, growing before the cough
          const my = Math.round(y + (c.up ? -12 : 12)); const big = c.tell < this.T.tell / 2;
          pxDisc(ctx, x, my, big ? 2 : 1, 't'); ctx.fillStyle = col('6'); ctx.fillRect(Math.round(x) - 1, my - 1, 1, 1);
          if ((c.tell >> 2) & 1) pxSpark(ctx, x + 5, my - 4, '6');
        }
      });
    }
    if (this.boss) this.boss.render(r);
    for (const s of this.turds) r.push(3, s.y, (ctx: CanvasRenderingContext2D) => drawSprite(ctx, 'turd', s.x, s.y, { frame: 0 }));
    for (const s of this.spits) r.push(3, s.y, (ctx: CanvasRenderingContext2D) => {
      const yarn = s.kind === 'yarn';
      // a hard 1px contrast ring makes hairballs pop on any background
      pxRing(ctx, s.x, s.y, yarn ? 7 : 5, ((s.t >> 2) & 1) ? '6' : (yarn ? 'c' : 't'));
      drawSprite(ctx, yarn ? 'yarn' : 'hairball', s.x, s.y);
    });
    for (const k of this.pickups) r.push(3, k.y, (ctx: CanvasRenderingContext2D) => {
      const pup = k.kind === 'pup';
      const name = pup ? 'pup' : k.kind.startsWith('memory:') ? 'pk_memory' : (g.content.items.find(i => i.id === k.kind)?.sprite ?? k.kind);
      const bob = Math.round(Math.sin(k.t / 10));
      if (pup) { // floating in a bubble, so it reads as "catch me"
        pxDither(ctx, k.x, k.y + bob, 11, 's', (k.t >> 4) & 1);
        pxRing(ctx, k.x, k.y + bob, 12, 's'); ctx.fillStyle = col('6'); ctx.fillRect(Math.round(k.x) - 6, Math.round(k.y + bob) - 8, 2, 2);
      } else pxRing(ctx, k.x, k.y + bob, 10, (k.t >> 3) & 1 ? '6' : 'f', 4, k.t / 15);
      drawSprite(ctx, name, k.x, k.y + bob);
    });
  }
}
export const makeInteraction = (): Module => new Interaction();
