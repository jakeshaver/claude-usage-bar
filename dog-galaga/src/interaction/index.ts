import type { Game, Module } from '../core/game';
import { WORLD_W, H } from '../core/game';
import type { EnemyDef, WaveDef, BonusDef } from '../core/types';
import { drawSprite } from '../art/sprite';
import { entryPath, bonusPath, sample, pathLen, type Pt } from './paths';
import { Boss } from './boss';

export interface Cat {
  id: number; def: EnemyDef; hp: number; x: number; y: number;
  st: 'wait' | 'enter' | 'form' | 'dive' | 'return' | 'leave' | 'flyby' | 'kdive';
  slot: Pt; path: Pt[]; u: number; du: number; delay: number; t: number; flash: number;
  pup?: boolean; glow?: boolean; side: number; diveSeed: number;
}
export interface Shot { x: number; y: number; vx: number; vy: number; kind: 'turd' | 'hairball' | 'yarn'; t: number }
export interface Pickup { kind: string; x: number; y: number; vy: number; t: number }

const WAVE_LIMIT = 75 * 60;  // cats lose interest after 75s, so waves can never stall
const MAX_TURDS = 4, MAX_SPIT = 10;

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

  init(g: Game) { this.g = g; }
  enemy(id: string) { return this.g.content.enemies.find(e => e.id === id) ?? this.g.content.enemies[0]; }

  clearAll() { this.cats = []; this.turds = []; this.spits = []; this.pickups = []; this.boss = null; this.active = false; this.mode = 'none'; this.bonus = null; }
  /** Pom napped: clear the air. Waves restart; a boss keeps its damage (cozy, never a full reset). */
  napReset() { this.turds = []; this.spits = []; this.pickups = []; if (this.boss) { this.boss.y = -60; this.boss.entering = true; } else this.clearAll(); }
  liveCats() { return this.cats.length + (this.boss ? 1 : 0); }

  startWave(areaId: string, i: number) {
    const g = this.g; const area = g.mods.world.area(areaId);
    const wid = area?.waves[i]; const w = g.content.waves.find(x => x.id === wid);
    this.clearAll();
    if (!w) { g.reportError('interaction', `missing wave ${wid}`); g.bus.emit('wave:clear', { areaId, waveIndex: i }); return; }
    g.reseed(areaId, i);
    this.wave = w; this.waveT = 0; this.active = true; this.mode = 'wave';
    const sp = w.formation.spacing ?? 36; const cols = w.formation.cols;
    const x0 = WORLD_W / 2 - ((cols - 1) * sp) / 2;
    let n = 0;
    for (const grp of w.cats) {
      const def = this.enemy(grp.breed);
      const colsList = grp.cols ?? Array.from({ length: cols }, (_, k) => k);
      for (const c of colsList) {
        const slot: Pt = [x0 + c * sp, 44 + grp.row * 30];
        const side = (n % 2) ? -1 : 1;
        const kind = w.entry === 'swirl-left' || w.entry === 'swirl-right' ? (Math.floor(n / 8) % 2 ? (w.entry === 'swirl-left' ? 'swirl-right' : 'swirl-left') : w.entry) : w.entry;
        const path = entryPath(kind, side, slot);
        this.cats.push({ id: this.nextId++, def, hp: def.hp, x: path[0][0], y: path[0][1], st: 'wait', slot, path, u: 0, du: 2.6 / pathLen(path),
          delay: Math.floor(n / 8) * 100 + (n % 8) * 9, t: 0, flash: 0, side, diveSeed: g.rng.next() });
        n++;
      }
    }
    // a capturer may carry a lost pup (once per area)
    const holder = this.cats.find(c => c.def.behavior === 'capturer');
    if (holder && !g.state.flags['pup_' + areaId]) holder.pup = true;
    g.bus.emit('wave:start', { areaId, waveIndex: i, count: this.cats.length });
  }

  startBoss(id: string) {
    this.clearAll(); this.g.reseed('boss', id);
    const def = this.enemy(id);
    this.boss = new Boss(this.g, this, def); this.active = true; this.mode = 'boss';
    this.g.bus.emit('boss:start', { bossId: id });
  }

  startBonus(def: BonusDef, total = def.groups * 8) {
    this.clearAll(); this.g.reseed('bonus', def.id);
    this.mode = 'bonus'; this.active = true; this.bonus = { def, hits: 0, total };
    const ed = this.enemy(def.breed);
    for (let gi = 0; gi < def.groups; gi++) for (let k = 0; k < 8; k++) {
      const path = bonusPath(def.pattern, gi);
      this.cats.push({ id: this.nextId++, def: { ...ed, hp: 1 }, hp: 1, x: path[0][0], y: path[0][1], st: 'wait', slot: [0, 0], path, u: 0, du: 2.4 / pathLen(path),
        delay: gi * 150 + k * 10, t: 0, flash: 0, side: 1, diveSeed: 0 });
    }
  }

  markGlow() { const c = this.cats.find(c => !c.pup && !c.glow && c.def.behavior !== 'capturer'); if (c) c.glow = true; }

  spawnPickup(kind: string, x: number, y: number) { this.pickups.push({ kind, x, y, vy: 0.7, t: 0 }); }

  fireTurds(x: number, y: number, pattern: { dx: number; vx: number }[]) {
    if (this.turds.length + pattern.length > MAX_TURDS + 4 || this.turds.length >= MAX_TURDS + (pattern.length - 1) * 2) return false;
    for (const p of pattern) this.turds.push({ x: x + p.dx, y, vx: p.vx, vy: -6.2, kind: 'turd', t: 0 });
    return true;
  }

  threats() { return [...this.spits, ...this.cats.filter(c => c.st === 'dive' || c.st === 'kdive')]; }
  target(px: number) {
    const live = this.cats.filter(c => c.st !== 'wait' && c.y > 0 && c.y < 260);
    if (this.boss) return { x: this.boss.x };
    let best: Cat | null = null, bd = 1e9;
    for (const c of live) { const d = Math.abs(c.x - px) - c.y * 0.3; if (d < bd) { bd = d; best = c; } }
    return best;
  }

  private boop(c: Cat, viaTurd = true) {
    const g = this.g; const diving = c.st === 'dive' || c.st === 'kdive';
    const pts = this.mode === 'bonus' ? 100 : diving ? (c.def.divePoints ?? c.def.points * 2) : c.def.points;
    g.ops.addScore(pts); g.state.stats.catsBooped++;
    if (viaTurd) g.state.stats.hits++;
    g.mods.effects?.burst(c.x, c.y, 'boop'); g.mods.effects?.floatText(c.x, c.y - 10, String(pts));
    g.mods.audio?.sfx('meow');
    if (c.pup) this.spawnPickup('pup', c.x, c.y);
    if (this.wave?.pickup && g.rng.chance(0.06)) this.spawnPickup(this.wave.pickup, c.x, c.y);
    if (c.def.behavior === 'splitter') for (const s of [-1, 1]) {
      const kd = this.enemy('kitten');
      this.cats.push({ id: this.nextId++, def: kd, hp: 1, x: c.x + s * 6, y: c.y, st: 'kdive', slot: c.slot, path: [], u: 0, du: 0, delay: 0, t: 0, flash: 0, side: s, diveSeed: g.rng.next() });
    }
    if (this.bonus) this.bonus.hits++;
    g.bus.emit('cat:boop', { breed: c.def.id, x: c.x, y: c.y, points: pts, glow: !!c.glow, bonus: this.mode === 'bonus' });
  }

  update(g: Game) {
    const sc = g.state.scene;
    if ((sc !== 'play' && sc !== 'bonus') || g.paused) return;
    this.sway++;
    const P = g.mods.player; const pb = P?.hitbox();
    // turds
    for (const s of this.turds) { s.x += s.vx; s.y += s.vy; s.t++; }
    this.turds = this.turds.filter(s => s.y > -16 && s.x > -10 && s.x < WORLD_W + 10);
    // spits
    for (const s of this.spits) { s.x += s.vx; s.y += s.vy; s.t++; }
    this.spits = this.spits.filter(s => s.y < H + 10 && s.x > -10 && s.x < WORLD_W + 10);
    if (this.active) this.waveT++;

    const sw = Math.sin(this.sway / 70) * 14;
    const breathe = 1 + Math.sin(this.sway / 45) * 0.04;
    const w = this.wave;
    const formCount = this.cats.filter(c => c.st === 'form').length;
    for (const c of this.cats) {
      c.t++; if (c.flash > 0) c.flash--;
      const sx = WORLD_W / 2 + (c.slot[0] - WORLD_W / 2) * breathe + sw, sy = c.slot[1];
      switch (c.st) {
        case 'wait': if (--c.delay <= 0) c.st = this.mode === 'bonus' ? 'flyby' : 'enter'; break;
        case 'enter': case 'flyby': {
          c.u += c.du;
          const path = c.st === 'enter' ? [...c.path.slice(0, -1), [sx, sy] as Pt] : c.path;
          const [nx, ny] = sample(path, Math.min(1, c.u)); c.x = nx; c.y = ny;
          if (c.u >= 1) { if (c.st === 'enter') c.st = 'form'; else c.st = 'leave'; }
          if (c.st === 'enter' && w && g.rng.chance(w.fireRate * 0.5)) this.spit(c, P);
          break;
        }
        case 'form': {
          c.x += (sx - c.x) * 0.2; c.y += (sy - c.y) * 0.2;
          if (this.waveT > WAVE_LIMIT) { c.st = 'leave'; break; }
          if (!w) break;
          const isDiver = c.def.behavior === 'diver' || c.def.behavior === 'zigzag' || c.def.behavior === 'capturer';
          const rate = w.diveRate * (isDiver ? 1.8 : 1) * (1 + (1 - formCount / Math.max(1, this.cats.length)) * 1.5);
          const enteringDone = !this.cats.some(o => o.st === 'wait' || o.st === 'enter');
          if (enteringDone && this.diving() < 3 + Math.floor(this.g.state.areasCleared.length / 3) && g.rng.chance(rate)) this.startDive(c);
          else if (g.rng.chance(w.fireRate * (c.def.behavior === 'shooter' ? 3 : 1) * 0.3)) this.spit(c, P);
          break;
        }
        case 'dive': {
          c.u += c.du;
          const z = c.def.behavior === 'zigzag' ? Math.sin(c.t / 9) * 3 : 0;
          const [nx, ny] = sample(c.path, Math.min(1, c.u)); c.x = nx + z; c.y = ny;
          if (w && c.y < 260 && g.rng.chance(w.fireRate * (c.def.behavior === 'shooter' ? 6 : 3))) this.spit(c, P);
          if (c.u >= 1) { c.st = 'return'; c.x = sx; c.y = -30; }
          break;
        }
        case 'kdive': { c.y += 2.6; c.x += Math.sin(c.t / 8 + c.side) * 1.6; if (c.y > H + 20) c.st = 'leave'; break; }
        case 'return': {
          c.x += (sx - c.x) * 0.08; c.y += Math.min(3, (sy - c.y) * 0.08 + 1);
          if (Math.abs(c.y - sy) < 2) c.st = 'form';
          if (this.waveT > WAVE_LIMIT) c.st = 'leave';
          break;
        }
        case 'leave': c.y -= 3; break;
      }
      // turd collisions
      if (c.st !== 'wait' && c.st !== 'leave') {
        const r = (c.def.size ?? 32) / 2 - 4;
        for (const s of this.turds) {
          if (Math.abs(s.x - c.x) < r && Math.abs(s.y - c.y) < r) {
            s.y = -999; c.hp--; c.flash = 6; g.mods.audio?.sfx('thud');
            if (c.hp <= 0) { this.boop(c); c.st = 'leave'; c.y = -9999; }
            break;
          }
        }
        // body collision with player
        if (pb && c.y > 0 && (c.st === 'dive' || c.st === 'kdive') && Math.abs(c.x - (pb.x + 5)) < 13 && Math.abs(c.y - (pb.y + 5)) < 13) {
          if (P.hit()) { this.boop(c, false); c.st = 'leave'; c.y = -9999; }
        }
      }
    }
    this.cats = this.cats.filter(c => !(c.st === 'leave' && (c.y < -40 || c.y > H + 30 || c.y === -9999)));

    // boss
    if (this.boss) {
      this.boss.update();
      const b = this.boss;
      for (const s of this.turds) if (Math.abs(s.x - b.x) < b.r && Math.abs(s.y - b.y) < b.r) {
        s.y = -999; b.damage(1); g.state.stats.hits++; g.mods.audio?.sfx('thud');
      }
      if (b.dead) {
        g.ops.addScore(b.def.points); g.mods.effects?.burst(b.x, b.y, 'bigboop'); g.mods.effects?.shake(6, 30);
        g.mods.audio?.sfx('bossdown'); this.spawnPickup('pk_heart', b.x, b.y);
        g.bus.emit('boss:defeat', { bossId: b.def.id, napped: b.napped });
        this.boss = null; this.active = false; this.mode = 'none';
      }
    }

    // spit vs player
    if (pb) for (const s of this.spits) {
      if (s.x > pb.x - 2 && s.x < pb.x + pb.w + 2 && s.y > pb.y - 2 && s.y < pb.y + pb.h + 2) { if (P.hit()) s.y = 9999; else s.y = 9999; }
    }

    // pickups
    for (const k of this.pickups) {
      k.t++; k.y += k.vy; k.x += Math.sin(k.t / 15) * 0.4;
      if (P) { const dx = P.x - k.x, dy = P.y - k.y; const d = Math.hypot(dx, dy);
        if (d < 48 && (k.kind === 'pup' || k.kind.startsWith('memory'))) { k.x += dx * 0.05; k.y += dy * 0.05; }
        if (d < 18) { this.collect(k); k.y = 9999; } }
    }
    this.pickups = this.pickups.filter(k => k.y < H + 20);

    // completion
    if (this.mode === 'wave' && this.active && !this.cats.length && this.waveT > 30) {
      this.active = false; this.mode = 'none';
      g.bus.emit('wave:clear', { areaId: g.state.areaId, waveIndex: g.state.waveIndex, timedOut: this.waveT > WAVE_LIMIT });
    }
    if (this.mode === 'bonus' && this.active && !this.cats.length && this.waveT > 30) {
      this.active = false; this.mode = 'none';
      const b = this.bonus!; g.bus.emit('bonus:result', { id: b.def.id, hits: b.hits, total: b.total });
    }
  }

  private diving() { return this.cats.filter(c => c.st === 'dive').length; }

  private startDive(c: Cat) {
    const g = this.g; const P = g.mods.player; const px = P?.x ?? WORLD_W / 2;
    const s = c.x < WORLD_W / 2 ? -1 : 1; const r = g.rng;
    const aim = c.def.behavior === 'diver' ? px : px + r.range(-60, 60);
    c.path = [[c.x, c.y], [c.x + 30 * s, c.y - 24], [c.x + 50 * s, c.y + 10], [aim + r.range(-40, 40), 200], [aim, 300], [aim - 40 * s, H + 40]];
    c.u = 0; c.du = (c.def.behavior === 'diver' ? 3.4 : 2.7) / pathLen(c.path); c.st = 'dive';
    g.mods.audio?.sfx('dive');
  }

  private spit(c: Cat, P: any) {
    if (this.spits.length >= MAX_SPIT || !P || this.mode === 'bonus') return;
    const dx = P.x - c.x, dy = P.y - c.y; const d = Math.hypot(dx, dy) || 1; const sp = 2.1;
    const kind = c.def.behavior === 'capturer' ? 'yarn' : 'hairball';
    this.spits.push({ x: c.x, y: c.y + 8, vx: (dx / d) * sp * 0.6, vy: Math.max(1.2, (dy / d) * sp), kind, t: 0 });
  }

  bossSpit(x: number, y: number, vx: number, vy: number) { if (this.spits.length < MAX_SPIT + 14) this.spits.push({ x, y, vx, vy, kind: 'hairball', t: 0 }); }

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
      if (c.st === 'wait' || c.y < -30) continue;
      const frame = Math.floor((c.t + c.id * 7) / 12) % 2;
      const sz = c.def.size ?? 32;
      r.push(1, c.y, (ctx: CanvasRenderingContext2D) => { ctx.fillStyle = 'rgba(11,10,20,0.28)'; ctx.fillRect(Math.round(c.x - sz / 4), Math.round(c.y + sz / 2 + 10), Math.round(sz / 2), 2); });
      r.push(2, c.y, (ctx: CanvasRenderingContext2D) => {
        if (c.glow) { ctx.fillStyle = (c.t >> 3) % 2 ? 'rgba(255,209,102,0.35)' : 'rgba(255,209,102,0.2)'; ctx.beginPath(); ctx.arc(Math.round(c.x), Math.round(c.y), 18, 0, 7); ctx.fill(); }
        const flip = c.st === 'dive' && c.path.length ? false : false;
        drawSprite(ctx, c.def.sprite, c.x, c.y, { frame, flash: c.flash > 0, flipX: flip });
        if (c.pup) drawSprite(ctx, 'pup', c.x, c.y + 18);
      });
    }
    if (this.boss) this.boss.render(r);
    for (const s of this.turds) r.push(3, s.y, (ctx: CanvasRenderingContext2D) => drawSprite(ctx, 'turd', s.x, s.y, { frame: 0 }));
    for (const s of this.spits) r.push(3, s.y, (ctx: CanvasRenderingContext2D) => drawSprite(ctx, s.kind === 'yarn' ? 'yarn' : 'hairball', s.x, s.y));
    for (const k of this.pickups) r.push(3, k.y, (ctx: CanvasRenderingContext2D) => {
      const name = k.kind === 'pup' ? 'pup' : k.kind.startsWith('memory:') ? 'pk_memory' : (g.content.items.find(i => i.id === k.kind)?.sprite ?? k.kind);
      if ((k.t >> 3) % 2) { ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.arc(Math.round(k.x), Math.round(k.y), 11, 0, 7); ctx.fill(); }
      drawSprite(ctx, name, k.x, k.y + Math.round(Math.sin(k.t / 10)));
    });
  }
}
export const makeInteraction = (): Module => new Interaction();
