import type { Game } from '../core/game';
import { WORLD_W, PF_W } from '../core/game';
import type { EnemyDef } from '../core/types';
import { frameCount } from '../art/sprite';
import { col } from '../core/palette';
import { pxDash, pxSpark } from '../core/pixel';
import { text } from '../art/font';
import { BOSS_BULLET, bossRig, bossBruises, ditherShadow, ditherRect, bossGlow, drawCombat, ringC, annulus } from './art';

/** Phase-change palette cycle: flushed red, white-hot gold, flushed red, its own colours (a 16-tick loop). */
const HOT: Record<string, string> = { '6': 'c', '7': 'c', '8': 'c', '9': 'd', 'a': 'e', 'b': 'e', 'o': 'c', 'p': 'd', 'q': 'e', '5': 'c', '4': 'd', '3': 'e', 'g': 'r', 'f': 'c' };
const GOLD: Record<string, string> = { '6': '6', '7': 'f', '8': 'f', '9': 'g', 'a': 'h', 'b': 'h', 'o': 'f', 'p': 'g', 'q': 'h', '5': 'f', '4': 'g', '3': 'h', 'c': 'f', 'd': 'g' };
const FLASH: Record<string, string> = Object.fromEntries([...'123456789abcdefghijklmnopqrstuv'].map(k => [k, '12bvqkenu3ahpjm'.includes(k) ? '5' : '6']));
/** Per-Big-Cat coat swap (cached per key) for a Big Cat drawn on another's sheet. Empty now: the Catnip Kingpin
 *  (violet tabby, grey fedora) and the Admiral (blue-grey persian) have their own generated sheets, so the HUD
 *  portrait and the journal match the fight. */
const SKIN: Record<string, Record<string, string> | undefined> = {
  // (Kingpin / Admiral now ship their own sheets, boss_kingpin / boss_admiral from tools/art/gen-cats.mjs)
};
/** A palette swap on top of a skin (flash / phase cycle over the coat). */
function over(skin: Record<string, string> | undefined, top: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!skin) return top; if (!top) return skin;
  const out: Record<string, string> = {};
  for (const k of '0123456789abcdefghijklmnopqrstuv') { const a = skin[k] ?? k; const b = top[a] ?? a; if (b !== k) out[k] = b; }
  return out;
}
const PHASE_CYCLE: ({ map: Record<string, string>; key: string } | undefined)[] = [{ map: HOT, key: 'ph-hot' }, { map: GOLD, key: 'ph-gold' }, { map: HOT, key: 'ph-hot' }, undefined];
const BOSS_LIMIT = 150 * 60; // a boss that isn't beaten in 150s dozes off (counts as cleared): no softlocks
const HOME_Y = 76;
/** Entrance: the WARNING bands sweep across first, then the Big Cat descends with its escort wings forming up around
 *  it. A re-entrance after a nap is a short swoop without the bands. */
const ENTER_T = 176, DESCEND_AT = 8, REENTER_T = 110, WARN_T = 168;
/** Phase change: the bands sweep across again (shorter), labelled with the new phase. */
const PHASE_T = 60;
/** Knock-out beat before the finale: the Big Cat staggers, palette-cycling, little booms popping on it. */
const KO_T = 44;
const WARN_Y0 = 108, WARN_Y1 = 160;
/** Curtain row: shed below the escort wings (bullets that would cross an escort are left out). */
const CURTAIN_DY = 54;
/** Curtain bullets: 14px apart across the whole lane (a solid-looking wall), with 2-3 marked gaps (38px doors). */
const CURTAIN_STEP = 14, GAP_HW = 19;
const TAU = Math.PI * 2;

/** Dark drop plate behind a small Big Cat: a deep-night disc, dithered ink core, ink edge and a magenta rim (cached). */
const plateCache = new Map<number, HTMLCanvasElement | null>();
function plate(ctx: CanvasRenderingContext2D, x: number, y: number, R: number) {
  let cv = plateCache.get(R);
  if (cv === undefined) {
    cv = null;
    if (typeof document !== 'undefined') {
      cv = document.createElement('canvas'); cv.width = cv.height = R * 2 + 5; const c = cv.getContext('2d')!; const o = R + 2;
      annulus(c, o, o, 0, R + 2, '0'); annulus(c, o, o, 0, R + 1, 'e'); annulus(c, o, o, 0, R, '0'); annulus(c, o, o, 0, R - 1, '1');
      const ri = R - 6;   // a plum dither core inside the deep-night disc
      for (let dy = -ri; dy <= ri; dy++) { const w = Math.floor(Math.sqrt(ri * ri - dy * dy)); ditherRect(c, o - w, o + dy, w * 2 + 1, 1, 'v', 0); }
    }
    plateCache.set(R, cv);
  }
  if (cv) ctx.drawImage(cv, Math.round(x) - R - 2, Math.round(y) - R - 2);
}

/** Attack tell glyph: a ray of inked red/orange chevrons marching outward along the line the shots will fly (never a
 *  white dash or a '+': those read as sparkle fx). `len` px long, chevrons every 12px, scrolled by `t`. */
function chevronRay(ctx: CanvasRenderingContext2D, x0: number, y0: number, a: number, len: number, t: number, hot: boolean) {
  const ux = Math.cos(a), uy = Math.sin(a), px = -uy, py = ux;
  const dot = (x: number, y: number, k: string, sz: number) => { ctx.fillStyle = col(k); ctx.fillRect(Math.round(x) - (sz >> 1), Math.round(y) - (sz >> 1), sz, sz); };
  for (let d = 14 + (t % 12); d < len; d += 12) {
    const cx = x0 + ux * d, cy = y0 + uy * d;
    for (const pass of [0, 1]) for (let s = 0; s <= 3; s++) for (const w of [-1, 1]) {
      const x = cx - ux * s * 1.2 + px * w * s, y = cy - uy * s * 1.2 + py * w * s;
      if (pass === 0) dot(x, y, '0', 4); else dot(x, y, s === 0 ? 'f' : hot ? 'r' : 'g', 2);
    }
  }
}
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
  tier: number; hitT = 0; flashCd = 0;
  /** home altitude (the Empress's throne rides higher, so her escort V has air under the saucer) */
  hy = HOME_Y;
  /** background emitters (phase 2+): their own clock, the paired-fan sweep, and the curtain's gap centres */
  bgT = 0; fanT = 0; curG: number[] = []; curA: number[] = []; curB: number[] = [];
  constructor(public g: Game, public ix: any, public def: EnemyDef) {
    const areas = g.content.areas; const ai = areas.findIndex(a => a.boss === def.id);
    // early Big Cats get a floor under their hp (content gives 50-90): every fight lasts long enough to feel like a
    // boss fight (~40 s and up with the escort squad in the way), not a 15-second speed bump
    this.hp = this.maxHp = Math.max(def.hp, ai < 0 ? 0 : Math.max(230, 160 + 8 * ai)); this.pattern = def.bossPattern ?? 'sweep';
    this.art = BOSS_BULLET[this.pattern] ?? 'blt_paw';
    // a purple orb melts into the navy of space: the dark arenas get the warm ember orb instead
    if (this.art === 'blt_paw' && (g.state.areaId === 'station' || g.state.areaId === 'nebula')) this.art = 'blt_ember';
    this.enterFrom = g.rng.chance(0.5) ? -1 : 1;
    this.tier = ai < 0 ? 0 : ai >= areas.length - 1 ? 3 : ai >= 8 ? 2 : ai >= 3 ? 1 : 0;
    this.r = [26, 28, 32, 36][this.tier];
    this.hy = this.tier === 3 ? 66 : HOME_Y; this.ty = this.hy;
  }
  /** Bullets are born at the sprite's edge, not on top of the boss: push the muzzle out along the shot to ~28px. */
  private spit(x: number, y: number, vx: number, vy: number) {
    const m = Math.hypot(vx, vy) || 1; const push = Math.max(0, 28 - Math.hypot(x - this.x, y - this.y));
    this.ix.bossSpit(x + (vx / m) * push, y + (vy / m) * push, vx, vy, this.art, this.capBoost());
  }
  /** Later phases fill the screen with readable choreography (rings, crossing curtains): the bullet cap grows with them. */
  private capBoost() { return this.phase * 14 + (this.tier >= 1 && this.phase === 0 ? 6 : 0) + (this.atk === 'curtain' && this.st === 'attack' ? 40 : 0); }
  /** Telegraphs and presence scale up for the small early Big Cats (no craft to make them look big). */
  private big() { return this.tier <= 1 ? 1.7 : 1; }
  /** True while a hit has just crossed a phase threshold (or knocked it out): the beat is about to play, so the hit
   *  that caused it pops no damage number over the Big Cat's face. */
  beatPending() { const want = this.hp > this.maxHp * 0.66 ? 0 : this.hp > this.maxHp * 0.33 ? 1 : 2; return this.hp <= 0 || want > this.phase; }
  /** Curtain row: every bullet slot across the lane (wall to wall), minus the marked gaps (and any slot an escort is
   *  parked on). `gaps` are the gap centres. */
  curtainRow(): { xs: number[]; gaps: number[] } {
    const [l, r] = this.ix.lane?.() ?? [64, 384]; const a = l + 10, b = r - 10;
    const n = Math.floor((b - a) / CURTAIN_STEP); const x0 = Math.round((a + b - n * CURTAIN_STEP) / 2);
    // (a bullet is never born on top of an escort parked across the row itself)
    const esc: number[] = this.ix.escortXs?.(this.y + this.curtainDY()) ?? [];
    const xs: number[] = [];
    for (let i = 0; i <= n; i++) {
      const x = x0 + i * CURTAIN_STEP;
      if (this.curG.some(g => Math.abs(x - g) < GAP_HW) || esc.some(e => Math.abs(x - e) < 16)) continue;
      xs.push(x);
    }
    return { xs, gaps: this.curG };
  }
  /** Curtain row height below the Big Cat: under its squad's tucked row (escorts close up above the curtain). */
  curtainDY(): number { return this.ix.escCurtainDY?.() ?? CURTAIN_DY; }
  /** Pick the curtain's doors: 2 in a narrow hall, 3 in an open lane, spread evenly with at least two bullets
   *  between a door and a wall (a door never melts into the wall), nudged a few px per fight; the in-between set
   *  (`curB`, the midpoints) opens on every other row, so the rows make Pom weave from door to door. */
  private pickGaps(_px: number) {
    const [l, r] = this.ix.lane?.() ?? [64, 384]; const w = r - l; const n = w > 250 ? 3 : 2;
    const lo = l + 10 + GAP_HW + CURTAIN_STEP * 2, hi = r - 10 - GAP_HW - CURTAIN_STEP * 2;
    const j = Math.round((this.g.rng.next() - 0.5) * 12);
    this.curA = Array.from({ length: n }, (_, k) => Math.round(lo + (k * (hi - lo)) / (n - 1)) + (k === 0 ? Math.max(0, j) : k === n - 1 ? Math.min(0, j) : j));
    this.curB = this.curA.slice(1).map((x, k) => Math.round((x + this.curA[k]) / 2));
    this.curG = this.curA;
  }
  /** 1 while the escorts are still forming up during the descent, easing to 0 as the Big Cat arrives. */
  formK() { return this.entering ? 1 - this.enterK : 0; }

  damage(n: number) {
    // a steady stream of turds flashes the Big Cat briefly once in a while (never a face washed white all fight)
    this.hp -= n; this.hitT = 6; if (this.flashCd <= 0) { this.flash = 3; this.flashCd = 16; }
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
    this.entering = false; this.intro = false; this.enterK = 1; this.x = WORLD_W / 2; this.y = this.hy; this.phase = Math.max(0, Math.min(2, phase));
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
    // the Empress's last stand: full-lane curtains and clean rings take turns (her spiral and fan in between), and
    // under 15% armor it is curtain / ring back to back with a spiral breather
    // (only curtains and rings: one readable pattern on screen at a time, no aimed scatter between them)
    if (this.tier >= 3) return (['curtain', 'ring'] as Atk[])[s % 2];
    return ([prim, 'curtain', sec, prim, 'ring'] as Atk[])[s % 5];
  }

  update() {
    const g = this.g; this.t++; this.stT++; if (this.flash > 0) this.flash--; if (this.flashCd > 0) this.flashCd--; if (this.hitT > 0) this.hitT--; if (this.puffT > 0) this.puffT--;
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
      // (the PHASE band says it: no toast repeating it, and no damage number left over the flashing face)
      this.ix.clearNumbers?.(this.x, this.y);
      this.bgT = 0; this.fanT = 0;
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
        this.y = -70 + (this.hy + 70) * e;
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
        this.x += (hx - this.x) * 0.05; this.y += (this.hy + Math.sin(this.t / 37) * 10 - this.y) * 0.08;
        if (this.stT > [96, 74, 56][this.phase] * (1 - this.ix.T.d * 0.25)) { this.atk = this.nextAttack(); this.beginTell(px); }
        break;
      }
      case 'tell': {
        // wind-up: shake, flash, and (for a charge) lock onto a lane and crouch back
        this.jit = (this.stT >> 1) & 1 ? 1 : -1;
        if (this.stT > this.tellLen() * 0.6 && this.stT % 6 === 0) this.flash = 2; // flashes just before it strikes
        if (this.atk === 'charge') this.y += (this.hy - 14 - this.y) * 0.15;
        else this.y += (this.hy - this.y) * 0.1;
        if (this.atk === 'volley' || this.atk === 'fan' || this.atk === 'ring') this.aim = Math.atan2(py - this.y, px - this.x);
        if (this.stT >= this.tellLen()) { this.go('attack'); this.ty = this.y; }
        break;
      }
      case 'attack': this.attack(px, py); break;
      case 'recover':
        this.x += (this.tx - this.x) * 0.06; this.y += (this.hy - this.y) * 0.08;
        if (this.stT > 40) this.go('idle');
        break;
    }
    this.layer(px, py);
    this.ox = this.x - lastX; this.oy = this.y - lastY;
  }

  /** Ticks between background volleys (0: none). Phase 1 and 2 ("PHASE 2" / "FINAL PHASE" on the band) run a second
   *  and third emitter under the main attack: a slow ring with a gap facing Pom, and paired fans from the Big Cat's
   *  flanks crossing down the middle. The small first Big Cats stay gentle; the mid sector cats get a light ring even
   *  before they are grumpy. */
  private bgEvery(): number {
    const ph = this.phase, tier = this.tier;
    if (ph === 0) return tier >= 1 ? 170 - tier * 10 : 0;
    // the Empress's final phase is pure choreography (curtain, ring, curtain...): no background scatter under it
    if (ph >= 2 && tier >= 3) return 0;
    return ph === 1 ? 128 - tier * 12 : 104 - tier * 10;
  }
  /** Where the paired fans come from: the Big Cat's flanks (its jets / saucer rim / throne wings). */
  fanXs(): number[] { const w = [30, 36, 46, 52][this.tier]; return [this.x - w, this.x + w]; }
  private layer(px: number, py: number) {
    const busy = this.st === 'enter' || this.st === 'phase' || this.st === 'ko' || (this.st === 'attack' && (this.atk === 'charge' || this.atk === 'curtain'));
    if (busy) { if (this.fanT > 0) this.fanT = 0; return; }
    const ev = this.bgEvery(); if (!ev) return;
    this.bgT++;
    const k = this.bgT % ev;
    if (k === (ev >> 1)) { this.slowRing(px, py, 0); this.g.mods.audio?.sfx('hack'); }
    if (this.phase >= 2 && this.tier >= 1 && k === (ev >> 1) + 22) this.slowRing(px, py, 0.5);   // final phase: a second ring, offset
    if (this.phase >= 1 && k === 0) this.fanT = 20;
    if (this.fanT > 0) { // paired fans: both flanks sweep a 5-shot fan inward at once, so the two fans cross mid-field
      this.fanT--;
      if (this.fanT % 4 === 0) {
        const i = 4 - this.fanT / 4; const sp = this.speed() * (this.tier === 0 ? 0.55 : 0.62);
        const [lx, rx] = this.fanXs();
        for (const [x, s] of [[lx, -1], [rx, 1]] as const) {
          const a = Math.PI / 2 + s * (0.55 - i * 0.22);   // left flank sweeps from down-right toward straight down...
          const esc: number[] = this.ix.escortAngles?.(x, this.y + 24) ?? [];   // ...and never through an escort
          if (esc.some(e => Math.abs(((a - e) % TAU + TAU + Math.PI) % TAU - Math.PI) < 0.3)) continue;
          this.ix.bossSpit(x, this.y + 24, Math.cos(a) * sp, Math.sin(a) * sp, this.art, this.capBoost());
        }
      }
    }
  }
  /** Slow ring with a gap facing Pom; never fired through the Big Cat's own escorts (the ring parts around them). */
  private slowRing(px: number, py: number, off: number) {
    const n = 12 + 2 * Math.min(2, this.tier) + (this.phase >= 2 ? 2 : 0) + (this.tier >= 3 ? 8 : 0); const v = this.speed() * (this.tier === 0 ? 0.42 : 0.48);
    const aim = Math.atan2(py - this.y, px - this.x); const step = TAU / n;
    const esc: number[] = this.ix.escortAngles?.(this.x, this.y + this.ringR()[2]) ?? [];
    const near = (a: number, b: number) => { const d = Math.abs(((a - b) % TAU + TAU + Math.PI) % TAU - Math.PI); return d; };
    for (let i = 0; i < n; i++) {
      const a = aim + step / 2 + off * step + i * step;
      if (Math.sin(a) < (this.tier >= 3 ? 0.12 : -0.3) || near(a, aim) < step * 0.9 || esc.some(e => near(a, e) < 0.26)) continue;
      const [rx, ry, oy] = this.ringR();
      this.spit(this.x + Math.cos(a) * rx, this.y + oy + Math.sin(a) * ry, Math.cos(a) * v, Math.sin(a) * v);
    }
  }
  /** Where a ring is born around the Big Cat: just past its art (the Empress's throne is wide: her rings open out of
   *  the saucer's rim, never on top of it). */
  private ringR(): [number, number, number] { return this.tier >= 3 ? [66, 26, 24] : [18, 14, 8]; }
  /** Ticks until the next background volley (for its telegraph), or -1. */
  bgTell(): { ring: number; fan: number } {
    const ev = this.bgEvery(); if (!ev || this.st === 'enter' || this.st === 'phase' || this.st === 'ko') return { ring: -1, fan: -1 };
    const k = this.bgT % ev; const r = (ev >> 1) - k, f = (ev - k) % ev;
    return { ring: r > 0 && r <= 18 ? r : -1, fan: this.phase >= 1 && f > 0 && f <= 18 ? f : -1 };
  }

  private beginTell(px: number) {
    this.go('tell');
    const [lo, hi] = this.range();   // charge lanes stay where the escorts can make room (the squad rides along)
    this.tx = Math.max(Math.max(60, lo), Math.min(Math.min(WORLD_W - 60, hi), px));
    if (this.atk === 'curtain') this.pickGaps(px);
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
        } else if (T <= down + hold + back) { const k = (T - down - hold) / back; this.y = 300 + (this.hy - 300) * (1 - (1 - k) * (1 - k)); }
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
        const n = 14 + 2 * ph + (this.tier >= 2 ? 4 : 0) + (this.tier >= 3 ? 8 : 0); const rings = ph >= 2 ? 2 : 1; const v = sp * (this.tier === 0 ? 0.55 : 0.62);
        // (rings part around parked escorts; the Empress's flanks hug the hall's walls, so her rings stay whole across
        // the middle of the hall)
        const esc: number[] = ix.escortAngles?.(this.x, this.y + this.ringR()[2]) ?? [];
        for (let w = 0; w < rings; w++) if (T === 1 + w * 28) {
          const a0 = this.aim + Math.PI / n + (w * Math.PI) / n;
          for (let i = 0; i < n; i++) {
            const a = a0 + (i * TAU) / n; const da = (x: number) => Math.abs(((a - x) % TAU + TAU + Math.PI) % TAU - Math.PI);
            if (Math.sin(a) < (this.tier >= 3 ? 0.12 : -0.2) || esc.some(e => da(e) < 0.26)) continue;
            // the Empress's dense rings open a wide door (three steps) where the tell's lime notch pointed
            if (this.tier >= 3 && da(this.aim) < (TAU / n) * 1.05) continue;
            const [rx, ry, oy] = this.ringR();
            this.spit(this.x + Math.cos(a) * rx, this.y + oy + Math.sin(a) * ry, Math.cos(a) * v, Math.sin(a) * v);
          }
          g8(this.g);
        }
        if (T > 1 + (rings - 1) * 28 + 34) this.go('recover');
        break;
      }
      case 'curtain': { // crossing curtains: walls of bullets spanning the whole lane, wall to wall, each with the 2-3
        // marked gaps, shed one after another and drifting alternately left and right, so the rows cross into a
        // lattice while every gap stays a clear 38px door a poodle can slip through
        const vol = this.tier === 0 ? 3 : this.tier === 1 ? 4 : 5, gap = 30;
        if ((T - 1) % gap === 0 && (T - 1) / gap < vol) {
          // straight walls (no drift: a wall-to-wall row never frays at the walls); the doors alternate between the
          // two sets row by row, so Pom weaves from door to door
          const v = (T - 1) / gap; const vy = sp * (this.tier === 0 ? 0.5 : 0.6), vx = 0;
          this.curG = v % 2 ? this.curB : this.curA;
          for (const x of this.curtainRow().xs) ix.bossSpit(x, this.y + this.curtainDY(), vx, vy, this.art, this.capBoost());
          this.puffT = 8; this.g.mods.audio?.sfx('hack');
        }
        if (T > vol * gap + 16) { this.curG = this.curA; this.go('recover'); }
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
    if (open < 0.6) return;
    // the headline stays up for as long as the bands are on screen (it pulses red / white, never blinks off)
    const cx = camX + PF_W / 2; const on = t < 18 || ((t >> 3) & 1) === 0;
    const lw = label.length * 12 + 10;
    ctx.fillStyle = col('0'); ctx.fillRect(Math.round(cx - lw / 2), WARN_Y0 + 16, lw, 34);
    text(ctx, label, cx, WARN_Y0 + 19, col(on ? 'r' : '6'), { align: 'center', scale: 2, shadow: col('e') });
    text(ctx, sub, cx, WARN_Y0 + 38, col('f'), { align: 'center' });
  }

  render(r: any) {
    const x = this.x + this.jit, y = this.y - (this.hitT > 3 ? 1 : 0);   // a 1px recoil on every hit
    const tier = this.tier, t = this.t, ph = this.phase;
    // one small drop shadow, offset down-right like every cat's, only where there is ground below
    if (this.ix.grounded()) r.push(1, y, (ctx: CanvasRenderingContext2D) => ditherShadow(ctx, x + 8, y + 30 + tier * 3, 44 + tier * 10, 10));
    // telegraphs (drawn under the boss)
    if (this.st === 'tell') {
      const k = this.stT / this.tellLen(); const blink = (this.stT >> 2) & 1; const c = blink ? 'r' : 'g'; const big = this.big();
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
          case 'fan': { // the edges of the coming fan: chevron rays growing out of the Big Cat
            const L = 110 * big + (ph >= 2 ? 30 : 0);
            for (const s of [-1, 1]) chevronRay(ctx, x, y + 20, Math.PI / 2 + s * 0.75, L * k, this.stT, !!blink);
            if (ph >= 2) chevronRay(ctx, x, y + 20, Math.PI / 2, L * k, this.stT, !!blink);   // two fans: they cross down the middle
            break;
          }
          case 'volley': // aim ray toward Pom
            chevronRay(ctx, x, y + 20, this.aim, 120 * big * k, this.stT, !!blink);
            break;
          case 'spiral': // a ring contracting onto the boss
            ringC(ctx, x, y + 6, Math.round((60 + tier * 4) * big - 26 * k), '0', 6, this.stT / 10);
            ringC(ctx, x, y + 6, Math.round((60 + tier * 4) * big - 1 - 26 * k), c, 6, this.stT / 10);
            break;
          case 'ring': { // a ring swelling out of the Big Cat, a bright notch marking the gap that will face Pom
            const rad = Math.round(22 + 70 * big * k);
            ringC(ctx, x, y + 8, rad + 1, '0', 10, -this.stT / 12); ringC(ctx, x, y + 8, rad, blink ? 'f' : 'd', 10, -this.stT / 12);
            if (rad > 30) ringC(ctx, x, y + 8, rad - 12, blink ? 'd' : 'f', 6, this.stT / 12);
            const gx = Math.round(x + Math.cos(this.aim) * (rad + 6)), gy = Math.round(y + 8 + Math.sin(this.aim) * (rad + 6));
            ctx.fillStyle = col('0'); ctx.fillRect(gx - 3, gy - 3, 7, 7); ctx.fillStyle = col('i'); ctx.fillRect(gx - 2, gy - 2, 5, 5); ctx.fillStyle = col('6'); ctx.fillRect(gx - 1, gy - 1, 2, 2);
            break;
          }
          case 'curtain': { // the whole row lights up wall to wall, slot by slot from the middle out, and each gap is
            // marked with lime door posts and a down arrow: the player sees exactly where the doors in the wall will be
            const row = this.curtainRow(); const ey = Math.round(y + this.curtainDY());
            const mid = (this.ix.lane?.() ?? [64, 384]).reduce((a: number, b: number) => a + b, 0) / 2; const reach = 30 + 200 * k;
            for (const ex of row.xs) {
              if (Math.abs(ex - mid) > reach) continue;
              ctx.fillStyle = col('0'); ctx.fillRect(ex - 3, ey - 3, 7, 7);
              ctx.fillStyle = col(blink ? 'd' : 'f'); ctx.fillRect(ex - 2, ey - 2, 5, 5); ctx.fillStyle = col('6'); ctx.fillRect(ex - 1, ey - 1, 2, 2);
            }
            for (const gx of row.gaps) {
              const g0 = Math.round(gx);
              for (const s of [-1, 1]) { // door posts at the gap's edges
                const px2 = g0 + s * (GAP_HW - 4);
                ctx.fillStyle = col('0'); ctx.fillRect(px2 - 2, ey - 9, 5, 19); ctx.fillStyle = col(blink ? 'i' : '6'); ctx.fillRect(px2 - 1, ey - 8, 3, 17);
              }
              const ay = ey + 6 + ((this.stT >> 2) & 3); // a little lime arrow marching down through the door
              ctx.fillStyle = col('0'); ctx.fillRect(g0 - 5, ay - 1, 11, 4); ctx.fillRect(g0 - 3, ay + 3, 7, 2); ctx.fillRect(g0 - 1, ay + 5, 3, 2);
              ctx.fillStyle = col('i'); ctx.fillRect(g0 - 4, ay, 9, 2); ctx.fillRect(g0 - 2, ay + 2, 5, 2); ctx.fillRect(g0, ay + 4, 1, 2);
            }
            break;
          }
          case 'summon': { // sparkles where the kittens will pop out
            const sx = 38 + tier * 6; const rr = Math.round(18 * big);
            // (a contracting dashed ring around a solid inked pip: no '+' sparkles, which read as hit fx)
            for (const s of [-1, 1]) {
              const qx = Math.round(x + s * sx), qy = Math.round(y + 6);
              ringC(ctx, qx, qy, Math.round(rr - 12 * k), blink ? 'd' : 'g', 4, this.stT / 8); ringC(ctx, qx, qy, Math.round(rr + 1 - 12 * k), '0', 4, this.stT / 8);
              ctx.fillStyle = col('0'); ctx.fillRect(qx - 3, qy - 3, 7, 7); ctx.fillStyle = col(blink ? 'r' : 'g'); ctx.fillRect(qx - 2, qy - 2, 5, 5); ctx.fillStyle = col('f'); ctx.fillRect(qx - 1, qy - 1, 2, 2);
            }
            break;
          }
        }
      });
    }
    // presence: the small early Big Cats (no craft under them) stand in a slowly turning double halo, a boss-sized
    // footprint on the field that reads from across the screen (thin dashed lines: never mistaken for a bullet)
    // presence for the small Big Cats: a dark drop plate (deep night disc with an ink edge and a magenta rim) backs the
    // sprite, so a cream cat never melts into cream roof tiles, and a slow dashed ring turns around it
    if (tier <= 1 && this.st !== 'ko' && y > -40) r.push(1, y - 2, (ctx: CanvasRenderingContext2D) => {
      const R = 46 + tier * 4, hot = this.st === 'tell' && ((this.stT >> 2) & 1) === 1;
      plate(ctx, x, y + 4, R - 8);
      ringC(ctx, x, y + 4, R + 1, '0', 12, t / 90); ringC(ctx, x, y + 4, R, hot ? 'f' : 'e', 12, t / 90);
    });
    // crossing curtains: each emitter flashes as its volley is shed
    if (this.puffT > 0) r.push(4, y + 30, (ctx: CanvasRenderingContext2D) => {
      const yy = Math.round(this.y + this.curtainDY() - (this.puffT > 4 ? 0 : 2));   // a bright seam flashes along the row as it is shed
      for (const ex of this.curtainRow().xs) { ctx.fillStyle = col('0'); ctx.fillRect(ex - 6, yy - 1, 13, 3); ctx.fillStyle = col(this.puffT > 4 ? '6' : 'f'); ctx.fillRect(ex - 5, yy, 11, 1); }
    });
    // background emitters' tells: a quick swelling ring before the slow ring, lit flank pips before the paired fans
    const bt = this.bgTell();
    if (bt.ring > 0 || bt.fan > 0) r.push(1, y + 2, (ctx: CanvasRenderingContext2D) => {
      if (bt.ring > 0) { const rad = Math.round(20 + (18 - bt.ring) * 2.2); ringC(ctx, x, y + 8, rad + 1, '0', 10, t / 14); ringC(ctx, x, y + 8, rad, (t >> 2) & 1 ? 'f' : 'd', 10, t / 14); }
      if (bt.fan > 0) for (const fx of this.fanXs()) {
        const fy = Math.round(y + 24), on = (bt.fan >> 2) & 1;
        ctx.fillStyle = col('0'); ctx.fillRect(Math.round(fx) - 4, fy - 4, 9, 9); ctx.fillStyle = col(on ? 'r' : 'f'); ctx.fillRect(Math.round(fx) - 3, fy - 3, 7, 7); ctx.fillStyle = col('6'); ctx.fillRect(Math.round(fx) - 1, fy - 1, 3, 3);
      }
    });
    // WARNING bands: across the whole playfield as the Big Cat arrives, and again (shorter) at each phase change
    const live = this.g.state.scene === 'play';   // (never frozen half-open behind the taunt dialogue)
    if (live && this.st === 'enter' && this.intro && this.stT < WARN_T) r.push(4, 9999, (ctx: CanvasRenderingContext2D) => this.warn(ctx, this.stT, WARN_T, 'WARNING', this.def.name));
    if (live && this.st === 'phase' && this.stT < PHASE_T) r.push(4, 9999, (ctx: CanvasRenderingContext2D) => this.warn(ctx, this.stT, PHASE_T, ph >= 2 ? 'FINAL PHASE' : 'PHASE 2', ph >= 2 ? 'MAXIMUM GRUMPY' : 'GETTING GRUMPY'));
    // knock-out: 3 frames of a solid radial wipe bursting off the Big Cat (white disc, then a white-and-gold band
    // racing out past the screen edges), palette-exact: a flash, never a screen-door dither
    if (this.st === 'ko' && this.stT <= 3 && this.g.state.settings?.flash !== false && !this.g.state.settings?.reduceMotion) {
      const k = this.stT; r.push(4, 9990, (ctx: CanvasRenderingContext2D) => this.ix.inLaneClip(ctx, () => {
        if (k <= 1) { annulus(ctx, x, y, 0, 84, '6'); annulus(ctx, x, y, 84, 88, 'f'); }
        else if (k === 2) { annulus(ctx, x, y, 44, 200, '6'); annulus(ctx, x, y, 44, 52, 'f'); annulus(ctx, x, y, 200, 206, 'f'); }
        else { annulus(ctx, x, y, 190, 340, '6'); annulus(ctx, x, y, 182, 190, 'f'); }
      }));
    }
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
      // small Big Cats wear a crisp 1px white outline outside their ink line (a sticker edge that reads on any floor)
      const skin = SKIN[this.def.id], top = flash ? FLASH : cyc?.map, tk = flash ? 'flash' : cyc?.key;
      drawCombat(ctx, this.def.sprite, x, y + bob, { frame, rim: flash ? '0' : tier <= 1 ? '6' : this.ix.rimKey(), recolor: over(skin, top), tintKey: skin ? `${this.def.id}:${tk ?? ''}` : tk });
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
