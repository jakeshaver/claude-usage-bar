import type { Game } from '../core/game';
import { WORLD_W, PF_W } from '../core/game';
import type { EnemyDef } from '../core/types';
import { frameCount } from '../art/sprite';
import { col } from '../core/palette';
import { pxDash, pxRing, pxSpark } from '../core/pixel';
import { text } from '../art/font';
import { BOSS_BULLET, bossRig, bossBruises, ditherShadow, ditherRect, bossGlow, drawCombat } from './art';

/** Phase-change palette cycle: flushed red, white-hot gold, flushed red, its own colours (a 16-tick loop). */
const HOT: Record<string, string> = { '6': 'c', '7': 'c', '8': 'c', '9': 'd', 'a': 'e', 'b': 'e', 'o': 'c', 'p': 'd', 'q': 'e', '5': 'c', '4': 'd', '3': 'e', 'g': 'r', 'f': 'c' };
const GOLD: Record<string, string> = { '6': '6', '7': 'f', '8': 'f', '9': 'g', 'a': 'h', 'b': 'h', 'o': 'f', 'p': 'g', 'q': 'h', '5': 'f', '4': 'g', '3': 'h', 'c': 'f', 'd': 'g' };
const FLASH: Record<string, string> = Object.fromEntries([...'123456789abcdefghijklmnopqrstuv'].map(k => [k, '12bvqkenu3ahpjm'.includes(k) ? '5' : '6']));
const PHASE_CYCLE: ({ map: Record<string, string>; key: string } | undefined)[] = [{ map: HOT, key: 'ph-hot' }, { map: GOLD, key: 'ph-gold' }, { map: HOT, key: 'ph-hot' }, undefined];
const BOSS_LIMIT = 150 * 60; // a boss that isn't beaten in 150s dozes off (counts as cleared): no softlocks
const HOME_Y = 76;
/** Entrance: the WARNING bands sweep across first, then the Big Cat descends with its escort wings forming up around
 *  it. A re-entrance after a nap is a short swoop without the bands. */
const ENTER_T = 176, DESCEND_AT = 56, REENTER_T = 110, WARN_T = 104;
/** Phase change: the bands sweep across again (shorter), labelled with the new phase. */
const PHASE_T = 60;
/** Knock-out beat before the finale: the Big Cat staggers, palette-cycling, little booms popping on it. */
const KO_T = 44;
const WARN_Y0 = 108, WARN_Y1 = 160;
/** Curtain emitters sit between the escort wing's two rows (never on top of an escort). */
const CURTAIN_DY = 54;
const TAU = Math.PI * 2;

type BState = 'enter' | 'idle' | 'tell' | 'attack' | 'recover' | 'phase' | 'ko';
type Atk = 'fan' | 'charge' | 'spiral' | 'summon' | 'volley' | 'ring' | 'curtain';

/**
 * Big Cat boss. Every attack follows the same readable rhythm:
 *   idle drift -> wind-up TELL (shake + flash + a pixel telegraph showing where it will hit) -> attack -> short recover.
 * bossPattern picks the signature attack (sweep, charge, summon, spiral). HP thresholds at 2/3 and 1/3 trigger a
 * phase change: the boss shakes off all hairballs, gets grumpier (faster tells, more bullets) and mixes in a second attack.
 */
export class Boss {
  x = WORLD_W / 2; y = -60; t = 0; hp: number; maxHp: number; r = 26; flash = 0;
  dead = false; napped = false; entering = true; intro = true; enterK = 0; puffT = 0;
  st: BState = 'enter'; stT = 0; phase = 0; atk: Atk = 'fan'; seq = 0;
  tx = WORLD_W / 2; ty = HOME_Y; ox = 0; oy = 0; aim = 0; jit = 0; enterFrom = -1;
  pattern: string; art: string;
  /** 0 none, 1 hover jets, 2 saucer, 3 the Empress's throne: later Big Cats are bigger, wider silhouettes. */
  tier: number; hitT = 0;
  constructor(public g: Game, public ix: any, public def: EnemyDef) {
    const areas = g.content.areas; const ai = areas.findIndex(a => a.boss === def.id);
    // early Big Cats get a floor under their hp (content gives 50-90): every fight lasts long enough to feel like a
    // boss fight (~40 s and up with the escort squad in the way), not a 15-second speed bump
    this.hp = this.maxHp = Math.max(def.hp, ai < 0 ? 0 : Math.max(230, 160 + 8 * ai)); this.pattern = def.bossPattern ?? 'sweep';
    this.art = BOSS_BULLET[this.pattern] ?? 'blt_paw';
    this.enterFrom = g.rng.chance(0.5) ? -1 : 1;
    this.tier = ai < 0 ? 0 : ai >= areas.length - 1 ? 3 : ai >= 8 ? 2 : ai >= 3 ? 1 : 0;
    this.r = [26, 28, 32, 36][this.tier];
  }
  /** Bullets are born at the sprite's edge, not on top of the boss: push the muzzle out along the shot to ~28px. */
  private spit(x: number, y: number, vx: number, vy: number) {
    const m = Math.hypot(vx, vy) || 1; const push = Math.max(0, 28 - Math.hypot(x - this.x, y - this.y));
    this.ix.bossSpit(x + (vx / m) * push, y + (vy / m) * push, vx, vy, this.art, this.capBoost());
  }
  /** Later phases fill the screen with readable choreography (rings, crossing curtains): the bullet cap grows with them. */
  private capBoost() { return this.phase * 9 + (this.atk === 'curtain' ? 6 : 0); }
  /** Telegraphs and presence scale up for the small early Big Cats (no craft to make them look big). */
  private big() { return this.tier <= 1 ? 1.35 : 1; }
  /** Curtain emitters: evenly spaced across the lane, inside its walls. */
  private curtainXs(): number[] {
    const [l, r] = this.ix.lane?.() ?? [64, 384]; const a = l + 30, b = r - 30;
    const n = Math.max(3, Math.floor((b - a) / 60) + 1); return Array.from({ length: n }, (_, i) => Math.round(a + ((b - a) * i) / (n - 1)));
  }
  /** 1 while the escorts are still forming up during the descent, easing to 0 as the Big Cat arrives. */
  formK() { return this.entering ? 1 - this.enterK : 0; }

  damage(n: number) {
    this.hp -= n; this.flash = 4; this.hitT = 6;
    if (this.hp <= 0 && this.st !== 'ko') { this.hp = 0; this.go('ko'); this.ix.bossKO?.(this.x, this.y); }
    this.g.bus.emit('boss:hp', { hp: Math.max(0, this.hp), max: this.maxHp });
  }
  vulnerable() { return this.st !== 'enter' && this.st !== 'phase' && this.st !== 'ko'; }
  /** Pom napped mid-fight: the boss swoops back in (it keeps its damage). */
  reenter() { if (this.st === 'ko') return; this.y = -60; this.st = 'enter'; this.stT = 0; this.entering = true; this.intro = false; this.enterK = 0; this.ox = this.oy = 0; }
  touches(pb: { x: number; y: number; w: number; h: number }) {
    if (this.st !== 'attack' || this.atk !== 'charge') return false;
    return Math.abs(this.x - (pb.x + pb.w / 2)) < 18 + pb.w / 2 && Math.abs(this.y - (pb.y + pb.h / 2)) < 18 + pb.h / 2;
  }
  threats() {
    if (this.st === 'attack' && this.atk === 'charge') { const vy = this.oy; return [-18, 0, 18].map(dx => ({ x: this.x + dx, y: this.y + 16, vx: 0, vy: Math.max(2, vy), st: 'charge' })); }
    if (this.st === 'tell' && this.atk === 'charge') return [-16, 0, 16].map(dx => ({ x: this.tx + dx, y: 250, vx: 0, vy: 2, st: 'lane' }));
    return [];
  }

  /** Showcase staging: skip the entrance and start winding up the signature attack (optionally at a later phase). */
  stageTell(phase = 0, atk?: string) {
    this.entering = false; this.intro = false; this.enterK = 1; this.x = WORLD_W / 2; this.y = HOME_Y; this.phase = Math.max(0, Math.min(2, phase));
    if (this.phase) this.hp = Math.ceil(this.maxHp * (this.phase === 1 ? 0.5 : 0.2));
    this.atk = this.nextAttack(); if (atk) this.atk = atk as Atk; this.beginTell(WORLD_W / 2);
  }

  private range(): [number, number] { return this.ix.bossRange?.() ?? [60, WORLD_W - 60]; }
  private speed() { return this.ix.T.spitSpeed * (0.95 + this.phase * 0.08); }
  private tellLen() { return [48, 40, 34][this.phase]; }
  private go(st: BState) { this.st = st; this.stT = 0; }

  /** Phase 0 flies the signature attack only; phase 1 adds a ring and the second attack; phase 2 adds crossing
   *  curtains (Galaga '88 style choreography that fills the screen, always with lanes to weave through). */
  private nextAttack(): Atk {
    const prim: Atk = this.pattern === 'charge' ? 'charge' : this.pattern === 'summon' ? 'summon' : this.pattern === 'spiral' ? 'spiral' : 'fan';
    const sec: Atk = prim === 'fan' ? 'volley' : prim === 'charge' ? 'fan' : prim === 'summon' ? 'volley' : 'fan';
    const s = this.seq++;
    if (this.phase === 0) return prim;
    if (this.phase === 1) return ([prim, 'ring', prim, sec] as Atk[])[s % 4];
    return ([prim, 'curtain', sec, prim, 'ring'] as Atk[])[s % 5];
  }

  update() {
    const g = this.g; this.t++; this.stT++; if (this.flash > 0) this.flash--; if (this.hitT > 0) this.hitT--; if (this.puffT > 0) this.puffT--;
    if (this.t > BOSS_LIMIT && this.st !== 'enter' && this.st !== 'ko') { this.dead = true; this.napped = true; return; }
    const P = g.mods.player; const px = P?.x ?? WORLD_W / 2, py = P?.y ?? 300;
    const lastX = this.x, lastY = this.y;
    this.jit = 0;

    // phase change at 2/3 and 1/3 hp
    const want = this.hp > this.maxHp * 0.66 ? 0 : this.hp > this.maxHp * 0.33 ? 1 : 2;
    if (want > this.phase && this.st !== 'enter' && this.st !== 'ko') {
      this.phase = want; this.go('phase');
      for (const s of this.ix.spits) g.mods.effects?.burst(s.x, s.y, 'sparkle');
      this.ix.spits = [];
      // punchy: a beat of hit-stop, a boom and a shockwave rolling off the boss, a recoil, a phase bounty and
      // reinforcements for its escort squad
      const fx = g.mods.effects;
      // a beat of hit-stop, then a colour flash per phase (gold, then red) while the WARNING bands sweep across again
      fx?.hitStop(9); fx?.shake(6, 30); fx?.flash(this.phase >= 2 ? 'r' : 'f', 8); fx?.burst(this.x, this.y, 'boom'); fx?.burst(this.x, this.y - 8, 'fur');
      g.mods.audio?.sfx('bark'); g.mods.audio?.sfx('thud');
      const bounty = 250 * this.phase * (1 + this.tier); g.ops.addScore(bounty); fx?.floatText(this.x, this.y - 44, String(bounty));
      this.y -= 10; this.flash = 0;
      this.ix.bossPhase?.(this.x, this.y);
      g.mods.ui?.toast(`${this.def.name.toUpperCase()} GETS GRUMPY!`);
      g.bus.emit('boss:phase', { bossId: this.def.id, phase: this.phase });
    }

    switch (this.st) {
      case 'enter': { // WARNING bands, then a slow, heavy descent down the middle of the lane with the escorts forming up
        const len = this.intro ? ENTER_T : REENTER_T, t0 = this.intro ? DESCEND_AT : 0;
        if (this.intro && (this.stT === 1 || this.stT === 34)) g.mods.audio?.sfx('tell');
        const k = Math.max(0, Math.min(1, (this.stT - t0) / (len - t0))); const e = 1 - (1 - k) * (1 - k) * (1 - k);
        this.enterK = e;
        const [lo, hi] = this.range(); const mid = (lo + hi) / 2;
        this.x = this.intro ? mid + Math.round(Math.sin(this.stT / 20) * 6 * (1 - e)) : mid + this.enterFrom * Math.sin((1 - e) * Math.PI) * Math.min(90, (hi - lo) / 2 + 40);
        this.y = -70 + (HOME_Y + 70) * e;
        if (this.intro && k >= 1 && this.stT === len) { g.mods.effects?.shake(3, 12); g.mods.audio?.sfx('thud'); }
        if (this.stT >= len) { this.entering = false; this.intro = false; this.go('idle'); }
        break;
      }
      case 'phase': // shakes it off: brief invulnerable flurry (a 3-frame white flash, then it palette-cycles red-hot)
        this.jit = (this.stT >> 1) & 1 ? 2 : -2;
        if (this.stT > PHASE_T) this.go('idle');
        break;
      case 'ko': { // knocked out: it staggers and sags, palette-cycling, little booms popping on it, then the finale
        this.jit = (this.stT >> 1) & 1 ? 3 : -3; this.y += 0.25;
        if (this.stT % 11 === 4) {
          const a = this.stT * 2.4; g.mods.effects?.burst(this.x + Math.round(Math.cos(a) * 22), this.y + Math.round(Math.sin(a) * 16), 'boom');
          g.mods.audio?.sfx('thud');
        }
        if (this.stT >= KO_T) this.dead = true;
        break;
      }
      case 'idle': {
        // drift inside the range that keeps the escort squad inside the lane walls
        const [lo, hi] = this.range();
        const amp = Math.min(96 + this.phase * 12, (hi - lo) / 2);
        const hx = (lo + hi) / 2 + Math.sin(this.t / (95 - this.phase * 15)) * amp;
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
        if (this.atk === 'volley' || this.atk === 'fan' || this.atk === 'ring') this.aim = Math.atan2(py - this.y, px - this.x);
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
    const [lo, hi] = this.range();   // charge lanes stay where the escorts can make room (the squad rides along)
    this.tx = Math.max(Math.max(60, lo), Math.min(Math.min(WORLD_W - 60, hi), px));
    this.g.mods.audio?.sfx('tell');
  }

  private attack(px: number, py: number) {
    const ix = this.ix; const sp = this.speed(); const T = this.stT; const ph = this.phase;
    const g8 = (g: Game) => g.mods.audio?.sfx('hack');
    switch (this.atk) {
      case 'fan': { // a fan of hairballs sweeping across, with clear gaps between them (grumpiest: two fans crossing)
        const n = 7 + ph * 2, every = 5;
        if (T % every === 0 && T / every < n) {
          const i = T / every; const spread = 1.5; const dir = (this.seq & 1) ? 1 : -1;
          const a = Math.PI / 2 + dir * (-spread / 2 + spread * (i / (n - 1)));
          this.spit(this.x, this.y + 18, Math.cos(a) * sp, Math.sin(a) * sp);
          if (ph >= 2) { const b = Math.PI - a; this.spit(this.x, this.y + 18, Math.cos(b) * sp * 0.85, Math.sin(b) * sp * 0.85); }
        }
        this.x += Math.sin(this.t / 30) * 0.6;
        if (T > n * every + 10) this.go('recover');
        break;
      }
      case 'volley': { // three aimed bursts of three
        if (T % 22 === 1 && T < 66) {
          const a0 = Math.atan2(py - this.y, px - this.x);
          for (let i = -1; i <= 1; i++) { const a = a0 + i * 0.24; this.spit(this.x, this.y + 18, Math.cos(a) * sp, Math.max(0.8, Math.sin(a) * sp)); }
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
            if (ph >= 1) for (const s of [-1, 1]) for (let k = 0; k < ph; k++) this.spit(this.x + s * 20, this.y - 10, s * (1.1 + k * 0.5) * sp * 0.6, -0.7 - k * 0.3);
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
            this.spit(this.x + Math.cos(a) * 16, this.y + 10 + s * 10, Math.cos(a) * sp * 0.8, Math.max(0.5, s * sp * 0.8 + 0.3));
          }
        }
        if (T > dur + 10) this.go('recover');
        break;
      }
      case 'ring': { // a slow ring bursting out of the Big Cat, a gap facing Pom (grumpiest: a second ring, offset)
        const n = 12 + 2 * ph + (this.tier >= 2 ? 2 : 0); const rings = ph >= 2 ? 2 : 1; const v = sp * (this.tier === 0 ? 0.55 : 0.62);
        for (let w = 0; w < rings; w++) if (T === 1 + w * 28) {
          const a0 = this.aim + Math.PI / n + (w * Math.PI) / n;
          for (let i = 0; i < n; i++) {
            const a = a0 + (i * TAU) / n; if (Math.sin(a) < -0.2) continue;
            this.spit(this.x + Math.cos(a) * 18, this.y + 8 + Math.sin(a) * 14, Math.cos(a) * v, Math.sin(a) * v);
          }
          g8(this.g);
        }
        if (T > 1 + (rings - 1) * 28 + 34) this.go('recover');
        break;
      }
      case 'curtain': { // crossing curtains: volleys shed across the lane, drifting alternately left and right, so the
        // field fills with a diamond lattice that always has gaps a poodle can weave through
        const vol = this.tier === 0 ? 3 : 4, gap = 28;
        if ((T - 1) % gap === 0 && (T - 1) / gap < vol) {
          const v = (T - 1) / gap; const dir = v % 2 ? 1 : -1;
          for (const x of this.curtainXs()) ix.bossSpit(x, this.y + CURTAIN_DY, dir * sp * 0.32, sp * 0.7, this.art, this.capBoost());
          this.puffT = 8; this.g.mods.audio?.sfx('hack');
        }
        if (T > vol * gap + 16) this.go('recover');
        break;
      }
      case 'summon': { // kittens pop from the boss's sides in a little arc
        const pairs = 1 + ph;
        if (T % 16 === 1 && T < pairs * 16 && ix.cats.filter((c: { st: string }) => c.st === 'kdive').length < 6) for (const s of [-1, 1]) ix.spawnKitten(this.x + s * (38 + this.tier * 6), this.y + 6, s * (1.1 + (T >> 4) * 0.4), -1.4);
        if (T > pairs * 16 + 30) this.go('recover');
        break;
      }
    }
  }

  /** Galaga '88 style WARNING: two hazard-striped bands slide across the playfield from opposite sides (gold and ink
   *  stripes marching, red edges), a blinking label between them, then they slide away. Palette-exact fillRects. */
  private warn(ctx: CanvasRenderingContext2D, t: number, len: number, label: string, sub: string) {
    const camX = Math.round(this.g.mods.player?.camera?.x ?? (WORLD_W - PF_W) / 2);
    const open = Math.min(1, t / 10, (len - t) / 10); if (open <= 0) return;
    const bw = Math.round(PF_W * open);
    for (const [by, dir] of [[WARN_Y0, 1], [WARN_Y1, -1]] as const) {
      const bx = dir > 0 ? camX : camX + PF_W - bw;
      ctx.fillStyle = col('0'); ctx.fillRect(bx, by - 1, bw, 14);
      ctx.fillStyle = col('r'); ctx.fillRect(bx, by, bw, 1); ctx.fillRect(bx, by + 11, bw, 1);
      ctx.fillStyle = col('f');
      for (let j = 1; j <= 10; j++) {
        const o = (((j + t * dir) % 12) + 12) % 12;
        for (let sx = -o; sx < bw; sx += 12) { const a = Math.max(0, sx), b = Math.min(bw, sx + 6); if (b > a) ctx.fillRect(bx + a, by + j, b - a, 1); }
      }
    }
    if (open < 1) return;
    const cx = camX + PF_W / 2; const on = t < 18 || ((t >> 3) & 1) === 0;
    const lw = label.length * 12 + 10;
    ctx.fillStyle = col('0'); ctx.fillRect(Math.round(cx - lw / 2), WARN_Y0 + 16, lw, 34);
    if (on) text(ctx, label, cx, WARN_Y0 + 19, col('r'), { align: 'center', scale: 2, shadow: col('e') });
    text(ctx, sub, cx, WARN_Y0 + 38, col('f'), { align: 'center' });
  }

  render(r: any) {
    const x = this.x + this.jit, y = this.y - (this.hitT > 3 ? 1 : 0);   // a 1px recoil on every hit
    const tier = this.tier, t = this.t, ph = this.phase;
    // one small drop shadow, offset down-right like every cat's, only where there is ground below
    if (this.ix.grounded()) r.push(1, y, (ctx: CanvasRenderingContext2D) => ditherShadow(ctx, x + 8, y + 30 + tier * 3, 44 + tier * 10, 10));
    // telegraphs (drawn under the boss)
    if (this.st === 'tell') {
      const k = this.stT / this.tellLen(); const blink = (this.stT >> 2) & 1; const c = blink ? 'r' : '6'; const big = this.big();
      // every telegraph sits under the cats (escorts are never crossed by a ring or a dash line)
      r.push(1, y + 1, (ctx: CanvasRenderingContext2D) => {
        switch (this.atk) {
          case 'charge': { // the danger lane: a 50% red dither, two dashed rails marching down, plus warning chevrons
            const hw = Math.round(20 * big);
            ditherRect(ctx, this.tx - hw + 1, y + 30, hw * 2 - 1, Math.round(330 - y - 30), 'r', blink);
            for (const dx of [-hw, hw]) pxDash(ctx, this.tx + dx, y + 30, this.tx + dx, 330, c, 4, 4, -this.stT, 2);
            for (let i = 0; i < 3; i++) { // chevrons marching down the lane
              const cx = Math.round(this.tx), cy = 140 + i * 60 + ((this.stT * 2) % 60);
              ctx.fillStyle = col('0'); ctx.fillRect(cx - 6, cy - 1, 13, 4); ctx.fillRect(cx - 4, cy + 3, 9, 2); ctx.fillRect(cx - 2, cy + 5, 5, 2);
              ctx.fillStyle = col('r'); ctx.fillRect(cx - 5, cy, 11, 2); ctx.fillRect(cx - 3, cy + 2, 7, 2); ctx.fillRect(cx - 1, cy + 4, 3, 2);
            }
            break;
          }
          case 'fan': { // the edges of the coming fan
            const L = 110 * big + (ph >= 2 ? 30 : 0);
            for (const s of [-1, 1]) { const a = Math.PI / 2 + s * 0.75; pxDash(ctx, x, y + 20, x + Math.cos(a) * L * k, y + 20 + Math.sin(a) * L * k, c, 4, 3, -this.stT, 2); }
            if (ph >= 2) pxDash(ctx, x, y + 20, x, y + 20 + L * k, c, 4, 3, -this.stT, 2);   // two fans: they cross down the middle
            break;
          }
          case 'volley': // aim line toward Pom
            pxDash(ctx, x, y + 20, x + Math.cos(this.aim) * 120 * big * k, y + 20 + Math.sin(this.aim) * 120 * big * k, c, 4, 3, -this.stT, 2);
            break;
          case 'spiral': // a ring contracting onto the boss
            pxRing(ctx, x, y + 6, Math.round((60 + tier * 4) * big - 26 * k), '0', 6, this.stT / 10);
            pxRing(ctx, x, y + 6, Math.round((60 + tier * 4) * big - 1 - 26 * k), c, 6, this.stT / 10);
            break;
          case 'ring': { // a ring swelling out of the Big Cat, a bright notch marking the gap that will face Pom
            const rad = Math.round(22 + 70 * big * k);
            pxRing(ctx, x, y + 8, rad + 1, '0', 10, -this.stT / 12); pxRing(ctx, x, y + 8, rad, blink ? 'f' : 'd', 10, -this.stT / 12);
            if (rad > 30) pxRing(ctx, x, y + 8, rad - 12, blink ? 'd' : 'f', 6, this.stT / 12);
            const gx = Math.round(x + Math.cos(this.aim) * (rad + 6)), gy = Math.round(y + 8 + Math.sin(this.aim) * (rad + 6));
            ctx.fillStyle = col('0'); ctx.fillRect(gx - 3, gy - 3, 7, 7); ctx.fillStyle = col('i'); ctx.fillRect(gx - 2, gy - 2, 5, 5); ctx.fillStyle = col('6'); ctx.fillRect(gx - 1, gy - 1, 2, 2);
            break;
          }
          case 'curtain': { // every emitter across the lane lights up, its two drift lanes sketched as short dashes
            const L = Math.round(10 + 26 * k);
            for (const ex of this.curtainXs()) {
              for (const s of [-1, 1]) pxDash(ctx, ex, y + CURTAIN_DY, ex + s * L * 0.45, y + CURTAIN_DY + L, c, 3, 3, -this.stT, 1);
              const ey = y + CURTAIN_DY - 3;
              ctx.fillStyle = col('0'); ctx.fillRect(ex - 3, ey, 7, 7);
              ctx.fillStyle = col(blink ? 'd' : 'f'); ctx.fillRect(ex - 2, ey + 1, 5, 5); ctx.fillStyle = col('6'); ctx.fillRect(ex - 1, ey + 2, 2, 2);
            }
            break;
          }
          case 'summon': { // sparkles where the kittens will pop out
            const sx = 38 + tier * 6; const rr = Math.round(18 * big);
            for (const s of [-1, 1]) { pxRing(ctx, x + s * sx, y + 6, Math.round(rr - 12 * k), blink ? 'd' : '6', 4, this.stT / 8); pxRing(ctx, x + s * sx, y + 6, Math.round(rr + 1 - 12 * k), '0', 4, this.stT / 8); pxSpark(ctx, x + s * sx, y + 6, blink ? '6' : 'f', 2); pxSpark(ctx, x + s * (sx + 8 + 6 * k), y - 10, 'f', 1); }
            break;
          }
        }
      });
    }
    // presence: the small early Big Cats (no craft under them) stand in a slowly turning double halo, a boss-sized
    // footprint on the field that reads from across the screen (thin dashed lines: never mistaken for a bullet)
    if (tier <= 1 && this.st !== 'ko' && y > -40) r.push(1, y - 2, (ctx: CanvasRenderingContext2D) => {
      const R = 46 + tier * 4, hot = this.st === 'tell' && ((this.stT >> 2) & 1) === 1;
      pxRing(ctx, x, y + 4, R + 1, '0', 12, t / 90); pxRing(ctx, x, y + 4, R, hot ? 'f' : 'e', 12, t / 90);
      pxRing(ctx, x, y + 4, R - 5, '0', 18, -t / 70); pxRing(ctx, x, y + 4, R - 6, hot ? 'g' : 'u', 18, -t / 70);
    });
    // crossing curtains: each emitter flashes as its volley is shed
    if (this.puffT > 0) r.push(4, y + 30, (ctx: CanvasRenderingContext2D) => {
      for (const ex of this.curtainXs()) { pxSpark(ctx, ex, y + CURTAIN_DY, '0', 3); pxSpark(ctx, ex, y + CURTAIN_DY, this.puffT > 4 ? '6' : 'f', 2); }
    });
    // WARNING bands: across the whole playfield as the Big Cat arrives, and again (shorter) at each phase change
    const live = this.g.state.scene === 'play';   // (never frozen half-open behind the taunt dialogue)
    if (live && this.st === 'enter' && this.intro && this.stT < WARN_T) r.push(4, 9999, (ctx: CanvasRenderingContext2D) => this.warn(ctx, this.stT, WARN_T, 'WARNING', this.def.name));
    if (live && this.st === 'phase' && this.stT < PHASE_T) r.push(4, 9999, (ctx: CanvasRenderingContext2D) => this.warn(ctx, this.stT, PHASE_T, ph >= 2 ? 'FINAL PHASE' : 'PHASE 2', ph >= 2 ? 'MAXIMUM GRUMPY' : 'GETTING GRUMPY'));
    r.push(2, y, (ctx: CanvasRenderingContext2D) => {
      // phase change: 3 frames of white (inked outline kept), then the boss palette-cycles red-hot / gold while it
      // shakes it off; an ordinary hit flashes white for a few frames, also inside its dark outline (knocked out: the
      // same white flash and red-hot cycle while it staggers)
      const phaseFlash = (this.st === 'phase' || this.st === 'ko') && this.stT <= 3;
      const flash = this.flash > 0 || phaseFlash;
      const cyc = (this.st === 'phase' || this.st === 'ko') && !phaseFlash ? PHASE_CYCLE[(this.stT >> 2) % PHASE_CYCLE.length] : undefined;
      // idle: cycle every frame the sheet has (2-3), faster while winding up; bob a pixel on the slow beat
      const nf = frameCount(this.def.sprite); const frame = Math.floor(t / (this.st === 'tell' ? 6 : 12)) % nf;
      const bob = this.st === 'idle' ? (t >> 4) & 1 : 0;
      bossRig(ctx, tier, x, y, t, ph, true);
      // a warm orange rim glow hugs the Big Cat (white-hot yellow while it winds up: a second tell)
      if (!flash) bossGlow(ctx, this.def.sprite, frame, x, y + bob, (this.st === 'tell' && ((this.stT >> 2) & 1) === 1) || !!cyc);
      // the flash is a white-hot palette swap, not a flat silhouette: the sprite's own ink outline stays, the shadows
      // turn pale lavender and everything else white, so the Big Cat keeps its face and shape while it flashes
      drawCombat(ctx, this.def.sprite, x, y + bob, { frame, rim: flash ? '0' : this.ix.rimKey(), recolor: flash ? FLASH : cyc?.map, tintKey: flash ? 'flash' : cyc?.key });
      if (!flash) bossBruises(ctx, x, y + bob, t, ph);
      bossRig(ctx, tier, x, y, t, ph, false);
      if (this.st === 'ko') { // dizzy stars circling its head
        for (let i = 0; i < 3; i++) {
          const a = this.stT / 6 + (i * TAU) / 3; const sx = x + Math.cos(a) * 18, sy = y - 30 - (tier >= 3 ? 10 : 0) + Math.sin(a) * 5;
          pxSpark(ctx, sx, sy, '0', 3); pxSpark(ctx, sx, sy, i === 1 ? '6' : 'f', 2);
        }
      }
      if (this.st === 'tell') { // "!" over the head
        const bx = Math.round(x), by = Math.round(y - 42 - (tier >= 3 ? 10 : 0)) + ((this.stT >> 3) & 1);
        ctx.fillStyle = col('0'); ctx.fillRect(bx - 2, by - 1, 5, 12);
        ctx.fillStyle = col((this.stT >> 2) & 1 ? 'r' : 'f'); ctx.fillRect(bx - 1, by, 3, 6); ctx.fillRect(bx - 1, by + 8, 3, 2);
      }
    });
    // no on-field HP bar: the HUD's BIG CAT bar owns it (it stays clear of the body and the charge lane)
  }
}
