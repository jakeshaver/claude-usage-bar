import type { Game } from '../core/game';
import { WORLD_W } from '../core/game';
import type { EnemyDef } from '../core/types';
import { drawSprite } from '../art/sprite';
import { col } from '../core/palette';
import { pxShadow, pxDash, pxRing, pxSpark } from '../core/pixel';

const BOSS_LIMIT = 150 * 60; // a boss that isn't beaten in 150s dozes off (counts as cleared): no softlocks
const HOME_Y = 76;

type BState = 'enter' | 'idle' | 'tell' | 'attack' | 'recover' | 'phase';
type Atk = 'fan' | 'charge' | 'spiral' | 'summon' | 'volley';

/**
 * Big Cat boss. Every attack follows the same readable rhythm:
 *   idle drift -> wind-up TELL (shake + flash + a pixel telegraph showing where it will hit) -> attack -> short recover.
 * bossPattern picks the signature attack (sweep, charge, summon, spiral). HP thresholds at 2/3 and 1/3 trigger a
 * phase change: the boss shakes off all hairballs, gets grumpier (faster tells, more bullets) and mixes in a second attack.
 */
export class Boss {
  x = WORLD_W / 2; y = -60; t = 0; hp: number; maxHp: number; r = 26; flash = 0;
  dead = false; napped = false; entering = true;
  st: BState = 'enter'; stT = 0; phase = 0; atk: Atk = 'fan'; seq = 0;
  tx = WORLD_W / 2; ty = HOME_Y; ox = 0; oy = 0; aim = 0; jit = 0; enterFrom = -1;
  pattern: string;
  constructor(public g: Game, public ix: any, public def: EnemyDef) {
    this.hp = this.maxHp = def.hp; this.pattern = def.bossPattern ?? 'sweep';
    this.enterFrom = g.rng.chance(0.5) ? -1 : 1;
  }

  damage(n: number) {
    this.hp -= n; this.flash = 4; if (this.hp <= 0) this.dead = true;
    this.g.bus.emit('boss:hp', { hp: this.hp, max: this.maxHp });
  }
  vulnerable() { return this.st !== 'enter' && this.st !== 'phase'; }
  /** Pom napped mid-fight: the boss swoops back in (it keeps its damage). */
  reenter() { this.y = -60; this.st = 'enter'; this.stT = 0; this.entering = true; this.ox = this.oy = 0; }
  touches(pb: { x: number; y: number; w: number; h: number }) {
    if (this.st !== 'attack' || this.atk !== 'charge') return false;
    return Math.abs(this.x - (pb.x + pb.w / 2)) < 18 + pb.w / 2 && Math.abs(this.y - (pb.y + pb.h / 2)) < 18 + pb.h / 2;
  }
  threats() {
    if (this.st === 'attack' && this.atk === 'charge') { const vy = this.oy; return [-18, 0, 18].map(dx => ({ x: this.x + dx, y: this.y + 16, vx: 0, vy: Math.max(2, vy), st: 'charge' })); }
    if (this.st === 'tell' && this.atk === 'charge') return [-16, 0, 16].map(dx => ({ x: this.tx + dx, y: 250, vx: 0, vy: 2, st: 'lane' }));
    return [];
  }

  private speed() { return this.ix.T.spitSpeed * (0.95 + this.phase * 0.08); }
  private tellLen() { return [48, 40, 34][this.phase]; }
  private go(st: BState) { this.st = st; this.stT = 0; }

  private nextAttack(): Atk {
    const prim: Atk = this.pattern === 'charge' ? 'charge' : this.pattern === 'summon' ? 'summon' : this.pattern === 'spiral' ? 'spiral' : 'fan';
    const sec: Atk = prim === 'fan' ? 'volley' : prim === 'charge' ? 'fan' : prim === 'summon' ? 'volley' : 'fan';
    const s = this.seq++;
    if (this.phase === 0) return prim;
    if (this.phase === 1) return s % 3 === 2 ? sec : prim;
    return s % 2 ? sec : prim;
  }

  update() {
    const g = this.g; this.t++; this.stT++; if (this.flash > 0) this.flash--;
    if (this.t > BOSS_LIMIT && this.st !== 'enter') { this.dead = true; this.napped = true; return; }
    const P = g.mods.player; const px = P?.x ?? WORLD_W / 2, py = P?.y ?? 316;
    const lastX = this.x, lastY = this.y;
    this.jit = 0;

    // phase change at 2/3 and 1/3 hp
    const want = this.hp > this.maxHp * 0.66 ? 0 : this.hp > this.maxHp * 0.33 ? 1 : 2;
    if (want > this.phase && this.st !== 'enter') {
      this.phase = want; this.go('phase');
      for (const s of this.ix.spits) g.mods.effects?.burst(s.x, s.y, 'sparkle');
      this.ix.spits = [];
      g.mods.effects?.shake(5, 24); g.mods.effects?.flash('#ffd166', 6); g.mods.audio?.sfx('bark');
      g.mods.ui?.toast(`${this.def.name.toUpperCase()} GETS GRUMPY!`);
      g.bus.emit('boss:phase', { bossId: this.def.id, phase: this.phase });
    }

    switch (this.st) {
      case 'enter': { // dramatic swoop in from above, invulnerable
        const k = Math.min(1, this.stT / 130); const e = 1 - (1 - k) * (1 - k) * (1 - k);
        this.x = WORLD_W / 2 + this.enterFrom * Math.sin((1 - e) * Math.PI) * 120;
        this.y = -60 + (HOME_Y + 60) * e;
        if (k >= 1) { this.entering = false; this.go('idle'); }
        break;
      }
      case 'phase': // shakes it off: brief invulnerable flurry
        this.jit = (this.stT >> 1) & 1 ? 2 : -2; if (this.stT % 6 === 0) this.flash = 3;
        if (this.stT > 60) this.go('idle');
        break;
      case 'idle': {
        const amp = 96 + this.phase * 12;
        const hx = WORLD_W / 2 + Math.sin(this.t / (95 - this.phase * 15)) * amp;
        this.x += (hx - this.x) * 0.05; this.y += (HOME_Y + Math.sin(this.t / 37) * 10 - this.y) * 0.08;
        if (this.stT > [96, 74, 56][this.phase] * (1 - this.ix.T.d * 0.25)) { this.atk = this.nextAttack(); this.beginTell(px); }
        break;
      }
      case 'tell': {
        // wind-up: shake, flash, and (for a charge) lock onto a lane and crouch back
        this.jit = (this.stT >> 1) & 1 ? 1 : -1;
        if (this.stT > this.tellLen() * 0.6 && this.stT % 6 === 0) this.flash = 2; // flashes just before it strikes
        if (this.atk === 'charge') this.y += (HOME_Y - 14 - this.y) * 0.15;
        else this.y += (HOME_Y - this.y) * 0.1;
        if (this.atk === 'volley' || this.atk === 'fan') this.aim = Math.atan2(py - this.y, px - this.x);
        if (this.stT >= this.tellLen()) { this.go('attack'); this.ty = this.y; }
        break;
      }
      case 'attack': this.attack(px, py); break;
      case 'recover':
        this.x += (this.tx - this.x) * 0.06; this.y += (HOME_Y - this.y) * 0.08;
        if (this.stT > 40) this.go('idle');
        break;
    }
    this.ox = this.x - lastX; this.oy = this.y - lastY;
  }

  private beginTell(px: number) {
    this.go('tell');
    this.tx = Math.max(60, Math.min(WORLD_W - 60, px));
    this.g.mods.audio?.sfx('blip');
  }

  private attack(px: number, py: number) {
    const ix = this.ix; const sp = this.speed(); const T = this.stT; const ph = this.phase;
    switch (this.atk) {
      case 'fan': { // a fan of hairballs sweeping across, with clear gaps between them
        const n = 7 + ph * 2, every = 5;
        if (T % every === 0 && T / every < n) {
          const i = T / every; const spread = 1.5; const dir = (this.seq & 1) ? 1 : -1;
          const a = Math.PI / 2 + dir * (-spread / 2 + spread * (i / (n - 1)));
          ix.bossSpit(this.x, this.y + 18, Math.cos(a) * sp, Math.sin(a) * sp);
        }
        this.x += Math.sin(this.t / 30) * 0.6;
        if (T > n * every + 10) this.go('recover');
        break;
      }
      case 'volley': { // three aimed bursts of three
        if (T % 22 === 1 && T < 66) {
          const a0 = Math.atan2(py - this.y, px - this.x);
          for (let i = -1; i <= 1; i++) { const a = a0 + i * 0.24; ix.bossSpit(this.x, this.y + 18, Math.cos(a) * sp, Math.max(0.8, Math.sin(a) * sp)); }
        }
        if (T > 80) this.go('recover');
        break;
      }
      case 'charge': { // pounce straight down the telegraphed lane, then climb back
        const down = 34, hold = 14, back = 50;
        if (T <= down) { const k = T / down; this.x += (this.tx - this.x) * 0.25; this.y = this.ty + (300 - this.ty) * k * k; }
        else if (T <= down + hold) {
          this.y = 300;
          if (T === down + 1) {
            this.g.mods.effects?.shake(4, 14);
            if (ph >= 1) for (const s of [-1, 1]) for (let k = 0; k < ph; k++) ix.bossSpit(this.x + s * 20, this.y - 10, s * (1.1 + k * 0.5) * sp * 0.6, -0.7 - k * 0.3);
          }
        } else if (T <= down + hold + back) { const k = (T - down - hold) / back; this.y = 300 + (HOME_Y - 300) * (1 - (1 - k) * (1 - k)); }
        else if (ph === 2 && this.seq % 2 === 1 && T < 200) { this.seq++; this.beginTell(px); } // double pounce when grumpiest
        else this.go('recover');
        break;
      }
      case 'spiral': { // rotating arms of hairballs, only the downward half, slow enough to weave through
        const arms = ph === 0 ? 2 : 3; const dur = 96 + ph * 20; const rot = (this.seq & 1 ? 1 : -1) * 0.07;
        if (T % (ph === 2 ? 7 : 8) === 0 && T < dur) {
          for (let k = 0; k < arms; k++) {
            const a = T * rot + (k / arms) * Math.PI * 2;
            const s = Math.sin(a); if (s < -0.15) continue;
            ix.bossSpit(this.x + Math.cos(a) * 16, this.y + 10 + s * 10, Math.cos(a) * sp * 0.8, Math.max(0.5, s * sp * 0.8 + 0.3));
          }
        }
        if (T > dur + 10) this.go('recover');
        break;
      }
      case 'summon': { // kittens pop from the boss's sides in a little arc
        const pairs = 1 + ph;
        if (T % 16 === 1 && T < pairs * 16 && ix.cats.length < 8) for (const s of [-1, 1]) ix.spawnKitten(this.x + s * 38, this.y + 6, s * (1.1 + (T >> 4) * 0.4), -1.4);
        if (T > pairs * 16 + 30) this.go('recover');
        break;
      }
    }
  }

  render(r: any) {
    const x = this.x + this.jit, y = this.y;
    r.push(1, y, (ctx: CanvasRenderingContext2D) => pxShadow(ctx, x + 4, y + 40, 44, 0.3));
    // telegraphs (drawn under the boss)
    if (this.st === 'tell') {
      const k = this.stT / this.tellLen(); const blink = (this.stT >> 2) & 1; const c = blink ? 'r' : '6';
      const over = this.atk === 'summon' || this.atk === 'spiral';
      r.push(over ? 3 : 1, y + 1, (ctx: CanvasRenderingContext2D) => {
        switch (this.atk) {
          case 'charge': // the danger lane: two dashed rails marching down, plus warning chevrons
            ctx.globalAlpha = blink ? 0.22 : 0.14; ctx.fillStyle = col('r'); ctx.fillRect(Math.round(this.tx) - 19, Math.round(y + 30), 39, Math.round(330 - y - 30)); ctx.globalAlpha = 1;
            for (const dx of [-20, 20]) pxDash(ctx, this.tx + dx, y + 30, this.tx + dx, 330, c, 4, 4, -this.stT, 2);
            for (let i = 0; i < 3; i++) { // chevrons marching down the lane
              const cx = Math.round(this.tx), cy = 140 + i * 60 + ((this.stT * 2) % 60);
              ctx.fillStyle = col('0'); ctx.fillRect(cx - 6, cy - 1, 13, 4); ctx.fillRect(cx - 4, cy + 3, 9, 2); ctx.fillRect(cx - 2, cy + 5, 5, 2);
              ctx.fillStyle = col('r'); ctx.fillRect(cx - 5, cy, 11, 2); ctx.fillRect(cx - 3, cy + 2, 7, 2); ctx.fillRect(cx - 1, cy + 4, 3, 2);
            }
            break;
          case 'fan': { // the edges of the coming fan
            for (const s of [-1, 1]) { const a = Math.PI / 2 + s * 0.75; pxDash(ctx, x, y + 20, x + Math.cos(a) * 110 * k, y + 20 + Math.sin(a) * 110 * k, c, 4, 3, -this.stT, 2); }
            break;
          }
          case 'volley': // aim line toward Pom
            pxDash(ctx, x, y + 20, x + Math.cos(this.aim) * 120 * k, y + 20 + Math.sin(this.aim) * 120 * k, c, 4, 3, -this.stT, 2);
            break;
          case 'spiral': // a ring contracting onto the boss
            pxRing(ctx, x, y + 6, Math.round(52 - 22 * k), c, 6, this.stT / 10);
            break;
          case 'summon': // sparkles where the kittens will pop out
            for (const s of [-1, 1]) { pxRing(ctx, x + s * 38, y + 6, Math.round(18 - 12 * k), blink ? 'd' : '6', 4, this.stT / 8); pxRing(ctx, x + s * 38, y + 6, Math.round(19 - 12 * k), '0', 4, this.stT / 8); pxSpark(ctx, x + s * 38, y + 6, blink ? '6' : 'f', 2); pxSpark(ctx, x + s * (46 + 6 * k), y - 10, 'f', 1); }
            break;
        }
      });
    }
    r.push(2, y, (ctx: CanvasRenderingContext2D) => {
      const blinkIn = (this.st === 'enter' || this.st === 'phase') && ((this.t >> 2) & 1);
      drawSprite(ctx, this.def.sprite, x, y, { frame: Math.floor(this.t / (this.st === 'tell' ? 6 : 14)) % 2, flash: this.flash > 0 || !!blinkIn && this.st === 'phase' });
      if (this.st === 'tell') { // "!" over the head
        const bx = Math.round(x), by = Math.round(y - 42) + ((this.stT >> 3) & 1);
        ctx.fillStyle = col('0'); ctx.fillRect(bx - 2, by - 1, 5, 12);
        ctx.fillStyle = col((this.stT >> 2) & 1 ? 'r' : 'f'); ctx.fillRect(bx - 1, by, 3, 6); ctx.fillRect(bx - 1, by + 8, 3, 2);
      }
    });
  }
}
