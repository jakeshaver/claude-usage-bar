import type { Game, Module } from '../core/game';
import { H, PF_X, PF_W } from '../core/game';
import { PALETTE, KEY } from '../core/palette';
import { text } from '../art/font';
import { drawSprite, spriteRows } from '../art/sprite';
import { Rng } from '../core/rng';
import {
  SEQ, SEQS, MERGED_FLAG, BOOP_FRAMES, BOOP_DUR, shapeCanvas, circleCanvas, outlinedText, ditherCanvas,
  CIRCLE_RING, CIRCLE_DASH, CIRCLE_FILL,
} from './shapes';

/**
 * Effects: particles, screen shake, flashes, floating text, boss explosions.
 * Purely visual: owns its own RNG stream and never touches simulation state.
 * Everything is pixel-exact and palette-legal: shapes are palette-indexed bitmaps cached as tiny canvases,
 * rings are midpoint circles, fades are done by shrinking + blinking, flashes are ordered dithers
 * (no alpha blending anywhere). All pools are preallocated: no per-frame allocation in update/render.
 */

const P = (k: string) => KEY.indexOf(k);
const MAX_PARTS = 560, MAX_RINGS = 24, MAX_TEXT = 24, MAX_SCHED = 32, MAX_ANIM = 32;

// particle flags
const F_BLINK = 1, F_CONFETTI = 2, F_RAMP = 4, F_SWAY = 8;
/** pastel fireball ramp for explosion puffs: white -> yellow -> orange -> pink -> lavender */
const RAMP = [P('6'), P('6'), P('f'), P('f'), P('g'), P('c'), P('7'), P('5')];
const PASTEL = [P('c'), P('f'), P('l'), P('i'), P('t'), P('6'), P('s')];
const STARC = [P('f'), P('6'), P('c'), P('s')];
const BOOPC = [P('f'), P('f'), P('t'), P('s'), P('l')];
const HEARTC = [P('c'), P('d'), P('c')];
const TURD = [P('9'), P('a'), P('9')];
const CONFETTI = [P('c'), P('f'), P('l'), P('i'), P('t'), P('6'), P('g'), P('d')];
const FUR_DEFAULT = [P('7'), P('6'), P('5')];
const LIFT = 6; // labels spawn this much above the caller's y, so they clear the kill pop
const BOOP_TOTAL = BOOP_DUR.reduce((a, b) => a + b, 0);

interface Part { x: number; y: number; vx: number; vy: number; g: number; drag: number; life: number; max: number; c: number; seq: number; f: number; ph: number }
interface Ring { x: number; y: number; r0: number; r1: number; life: number; max: number; delay: number; c: number; mode: number }
interface Txt { x: number; y: number; vy: number; life: number; max: number; val: number; combo: number; w: number; cv: HTMLCanvasElement | null; pop: HTMLCanvasElement | null }
interface Sched { t: number; x: number; y: number; kind: number }
interface Anim { x: number; y: number; t: number; c: number }

// scheduled sub-event kinds (boss explosion sequence)
const S_BOOM = 1, S_FINALE = 2;

class Effects implements Module {
  id = 'effects';
  api = this;
  g!: Game;
  rng = new Rng(4242); // visual-only stream: never affects sim determinism

  // pools (preallocated)
  parts: Part[] = []; nParts = 0;
  rings: Ring[] = []; nRings = 0;
  texts: Txt[] = []; nTexts = 0;
  sched: Sched[] = []; nSched = 0;
  anims: Anim[] = []; nAnims = 0;

  shakeAmt = 0; shakeT = 0; shakeMax = 1; shakeSign = 1;
  private off = { x: 0, y: 0 };
  flashC = ''; flashT = 0; flashMax = 1;
  tick = 0;

  // boss death: the defeated boss lingers as a wobbling, white-flashing sprite until the finale
  dying = { sprite: '', x: 0, y: 0, t: 0, until: 0, tint: FUR_DEFAULT };
  /** the 'BOOPED!' finale banner */
  banner = { t: -1, x: 0, y: 0 };
  private furCache = new Map<string, number[]>();

  constructor() {
    for (let i = 0; i < MAX_PARTS; i++) this.parts.push({ x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 1, life: 0, max: 1, c: 0, seq: 0, f: 0, ph: 0 });
    for (let i = 0; i < MAX_RINGS; i++) this.rings.push({ x: 0, y: 0, r0: 0, r1: 0, life: 0, max: 1, delay: 0, c: 0, mode: 0 });
    for (let i = 0; i < MAX_TEXT; i++) this.texts.push({ x: 0, y: 0, vy: 0, life: 0, max: 1, val: 0, combo: 0, w: 0, cv: null, pop: null });
    for (let i = 0; i < MAX_SCHED; i++) this.sched.push({ t: 0, x: 0, y: 0, kind: 0 });
    for (let i = 0; i < MAX_ANIM; i++) this.anims.push({ x: 0, y: 0, t: 0, c: 0 });
  }

  init(g: Game) {
    this.g = g;
    // fur puffs in the booped cat's own coat colors (garnish around the designed pop)
    g.bus.on('cat:boop', (p: any) => { if (p && !g.headless) this.fur(p.x, p.y, this.furOf(p.breed), 4); });
    // the boss explosion (burst 'bigboop') fires in the same tick, just before boss:defeat
    g.bus.on('boss:defeat', (p: any) => {
      if (g.headless) return;
      const def = this.enemyDef(p?.bossId);
      if (def && this.dying.until > this.tick) { this.dying.sprite = def.sprite ?? ''; this.dying.tint = this.furOf(p.bossId); }
    });
    g.bus.on('scene:change', (p: any) => {
      switch (p?.to) { case 'play': case 'dialogue': case 'bonus': break; default: this.clear(); }
    });
  }

  // ---------------------------------------------------------------- public API
  /** kinds: boop bigboop poof sparkle shield splat hearts confetti fur boom. tint: palette key (fur, boop) */
  burst(x: number, y: number, kind: string, tint?: string) {
    if (this.g.headless) return;
    const r = this.rng;
    switch (kind) {
      case 'boop': { // cat booped: a designed 7-frame pastel pop (disc -> star -> 4 hearts) + a ring + a little garnish
        this.anim(x, y, tint && P(tint) >= 0 ? P(tint) : r.pick(BOOPC));
        this.ring(x, y, 8, 23, 16, P('6'), CIRCLE_RING, 6);
        for (let i = 0; i < 4; i++) {
          const a = (i + 0.5) * Math.PI / 2 + r.range(-0.3, 0.3), s = r.range(2.2, 2.8);
          this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, 0.02, 0.9, r.int(22, 28), r.pick(STARC), i & 1 ? SEQ.spark : SEQ.star, F_BLINK);
        }
        break;
      }
      case 'splat': { // turd hits something that doesn't pop (yet): squash, hold, crumbs with a cream rim
        this.spawn(x, y, 0, 0, 0, 1, 14, P('a'), SEQ.splat, 0);
        for (let i = 0; i < 5; i++) { const a = r.range(-Math.PI * 0.95, -Math.PI * 0.05); const s = r.range(0.8, 2.2); this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, 0.14, 0.95, r.int(16, 24), r.pick(TURD), SEQ.chunk, 0); }
        for (let i = 0; i < 2; i++) this.radial(x, y, 0.5, 1.4, SEQ.dot, P('7'), 12, 0.9, 0.05, F_BLINK);
        break;
      }
      case 'hearts': {
        for (let i = 0; i < 7; i++) this.spawn(x + r.range(-14, 14), y + r.range(-8, 8), r.range(-0.9, 0.9), r.range(-1.8, -0.6), -0.005, 0.975, r.int(36, 54), r.pick(HEARTC), i % 3 ? SEQ.heartSmall : SEQ.heart, F_BLINK | F_SWAY);
        break;
      }
      case 'confetti': this.confetti(x, y, 36, 3.2, 4); break;
      case 'fur': this.fur(x, y, tint && P(tint) >= 0 ? [P(tint)] : FUR_DEFAULT, 10); break;
      case 'boom': this.boom(x, y, 1); break;
      case 'bigboop': this.bossExplode(x, y); break;
      case 'poof': { // buddy knocked away: soft fur puffs and a couple of tiny stars
        this.fur(x, y, [P('7'), P('6'), P('8'), P('5')], 12);
        for (let i = 0; i < 4; i++) this.radial(x, y, 0.8, 1.8, SEQ.spark, r.pick(STARC), 24, 0.93, -0.01, F_BLINK);
        break;
      }
      case 'sparkle': { // pickup collected
        this.ring(x, y, 2, 14, 12, P('f'), CIRCLE_RING, 0);
        for (let i = 0; i < 4; i++) this.radial(x, y, 1, 1.8, SEQ.star, r.pick(STARC), 28, 0.92, -0.015, F_BLINK);
        for (let i = 0; i < 6; i++) this.radial(x, y, 0.8, 2.2, SEQ.spark, r.pick(STARC), 22, 0.92, -0.01, F_BLINK);
        break;
      }
      case 'shield': { // bubble shield pops
        this.ring(x, y, 8, 24, 14, P('l'), CIRCLE_RING, 0);
        this.ring(x, y, 8, 30, 18, P('s'), CIRCLE_DASH, 3);
        this.ring(x, y, 4, 14, 10, P('6'), CIRCLE_RING, 1);
        for (let i = 0; i < 12; i++) this.radial(x, y, 2, 3.4, i % 3 ? SEQ.spark : SEQ.dot, r.pick(PASTEL), 22, 0.9, 0, F_BLINK);
        break;
      }
      default: // surface typos instead of silently mapping them
        this.g.reportError('effects', new Error(`unknown burst kind '${kind}'`));
        this.burst(x, y, 'boop');
    }
  }

  /** Floating score text. Labels spawn ${LIFT}px above y, merge into a running total when they land on a
   *  fresh label, otherwise stack above it, and are drawn with a 1px ink outline on all 8 neighbours. */
  floatText(x: number, y: number, label: string) {
    if (this.g.headless) return;
    x = Math.round(x); y = Math.round(y) - LIFT;
    const n = Number(label), numeric = label !== '' && Number.isFinite(n);
    for (let pass = 0; pass < 6; pass++) {
      let hit: Txt | null = null;
      for (let i = 0; i < this.nTexts; i++) { const t = this.texts[i]; if (Math.abs(t.x - x) <= 10 && Math.abs(t.y - y) <= 8) { hit = t; break; } }
      if (!hit) break;
      if (numeric && hit.val >= 0 && hit.max - hit.life < 20) { // fresh neighbour: merge into a combo total
        hit.val += n; hit.combo++; hit.life = hit.max; hit.vy = Math.min(hit.vy, -1.2);
        this.paint(hit, String(hit.val)); return;
      }
      y = Math.round(hit.y) - 9; // stale neighbour: stack above it
    }
    let t: Txt;
    if (this.nTexts < MAX_TEXT) t = this.texts[this.nTexts++];
    else { let o = 0; for (let i = 1; i < MAX_TEXT; i++) if (this.texts[i].life < this.texts[o].life) o = i; t = this.texts[o]; }
    t.x = x; t.y = y; t.vy = -1.6; t.life = t.max = 50; t.val = numeric ? n : -1; t.combo = 1;
    this.paint(t, String(label));
  }
  private paint(t: Txt, label: string) {
    const v = t.val;
    const col = v < 0 ? PALETTE[P('6')] : v >= 1000 || t.combo >= 3 ? PALETTE[P('c')] : v >= 300 || t.combo >= 2 ? PALETTE[P('l')] : PALETTE[P('f')];
    t.cv = outlinedText(text, label, col); t.pop = outlinedText(text, label, PALETTE[6]); t.w = t.cv.width;
  }

  shake(px: number, ticks: number) {
    if (!this.g.state.settings.shake) return;
    px = Math.round(px);
    if (this.shakeT <= 0 || px >= this.shakeAmt * (this.shakeT / this.shakeMax)) { this.shakeAmt = px; this.shakeT = this.shakeMax = Math.max(1, ticks); }
    else this.shakeT = Math.max(this.shakeT, ticks);
  }

  flash(c: string, ticks: number) {
    if (this.flashT > 0 && ticks < this.flashT && this.flashT / this.flashMax > 0.5) return; // don't stomp a stronger flash
    this.flashC = c; this.flashT = this.flashMax = Math.max(1, ticks);
  }

  /** Integer pixel offset for the playfield camera. Zero when shake is disabled or the game is paused. */
  shakeOffset() {
    if (this.shakeT <= 0 || !this.g.state.settings.shake || this.g.paused) { this.off.x = 0; this.off.y = 0; }
    return this.off;
  }

  /** Advance the effects timeline n ticks even while the game is paused (showcase / tests / critics). */
  step(n = 1) { for (let i = 0; i < n; i++) this.advance(); }

  clear() { this.nParts = 0; this.nRings = 0; this.nTexts = 0; this.nSched = 0; this.nAnims = 0; this.dying.until = 0; this.banner.t = -1; this.shakeT = 0; this.flashT = 0; }

  // ---------------------------------------------------------------- spawning helpers
  private spawn(x: number, y: number, vx: number, vy: number, g: number, drag: number, life: number, c: number, seq: number, f: number) {
    if (this.nParts >= MAX_PARTS) return;
    const p = this.parts[this.nParts++];
    p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.g = g; p.drag = drag; p.life = p.max = life; p.c = c; p.seq = seq; p.f = f; p.ph = this.rng.next() * 6.283;
  }
  private radial(x: number, y: number, smin: number, smax: number, seq: number, c: number, life: number, drag: number, g: number, f: number) {
    const a = this.rng.next() * 6.283, s = this.rng.range(smin, smax);
    this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, g, drag, Math.round(life * this.rng.range(0.75, 1.15)), c, seq, f);
  }
  private ring(x: number, y: number, r0: number, r1: number, life: number, c: number, mode: number, delay: number) {
    if (this.nRings >= MAX_RINGS) return;
    const q = this.rings[this.nRings++];
    q.x = x; q.y = y; q.r0 = r0; q.r1 = r1; q.life = q.max = life; q.c = c; q.mode = mode; q.delay = delay;
  }
  private anim(x: number, y: number, c: number) {
    let a: Anim;
    if (this.nAnims < MAX_ANIM) a = this.anims[this.nAnims++];
    else { let o = 0; for (let i = 1; i < MAX_ANIM; i++) if (this.anims[i].t > this.anims[o].t) o = i; a = this.anims[o]; }
    a.x = Math.round(x); a.y = Math.round(y); a.t = 0; a.c = c;
  }
  private fur(x: number, y: number, cols: number[], n: number) {
    for (let i = 0; i < n; i++) this.radial(x, y, 0.4, 1.5, SEQ.fur, cols[i % cols.length], 30, 0.93, -0.015, F_BLINK | F_SWAY);
  }
  /** festive paper: 2x4 strips and 3x3 squares that flip front/shade/edge-on, plus a few wavy streamers */
  private confetti(x: number, y: number, n: number, power: number, streamers: number) {
    const r = this.rng;
    for (let i = 0; i < n + streamers; i++) {
      const a = r.range(-Math.PI * 0.92, -Math.PI * 0.08), s = r.range(0.45, 1) * power;
      const seq = i >= n ? SEQ.streamer : i & 1 ? SEQ.confRect : SEQ.confSq;
      this.spawn(x + r.range(-6, 6), y + r.range(-4, 4), Math.cos(a) * s * 1.2, Math.sin(a) * s, 0.05, 0.96, r.int(110, 160), r.pick(CONFETTI), seq, F_CONFETTI | F_BLINK);
    }
  }
  /** one cute pastel explosion: pop disc, fire puffs, sparks, ring */
  private boom(x: number, y: number, size: number) {
    const r = this.rng;
    this.ring(x, y, 4 * size, 7 * size, 4, P('6'), CIRCLE_FILL, 0);
    this.ring(x, y, 5 * size, 20 * size, 12, P('f'), CIRCLE_RING, 1);
    for (let i = 0; i < 7 * size; i++) this.radial(x + r.range(-3, 3), y + r.range(-3, 3), 0.3, 1.5 * size, SEQ.boom, 0, r.int(22, 34), 0.9, -0.02, F_RAMP);
    for (let i = 0; i < 4 * size; i++) this.radial(x, y, 1.5, 3.2 * size, SEQ.spark, r.pick(STARC), 18, 0.9, 0.03, F_BLINK);
    for (let i = 0; i < 2 * size; i++) this.radial(x, y, 1, 2.4, SEQ.star, r.pick(STARC), 30, 0.93, 0.02, F_BLINK);
  }
  private bossExplode(x: number, y: number) {
    const d = this.dying, r = this.rng;
    d.x = x; d.y = y; d.t = this.tick; d.until = this.tick + 64; d.sprite = ''; d.tint = FUR_DEFAULT;
    this.boom(x, y, 2);
    this.flash('#ffffff', 4);
    // a crescendo of pops all over the boss, getting faster, then the finale
    const T = [6, 14, 21, 27, 32, 37, 41, 45, 49, 52, 55, 58, 61];
    for (let i = 0; i < T.length; i++) this.schedule(T[i], x + r.int(-28, 28), y + r.int(-24, 24), S_BOOM);
    this.schedule(64, x, y, S_FINALE);
  }
  private schedule(dt: number, x: number, y: number, kind: number) {
    if (this.nSched >= MAX_SCHED) return;
    const s = this.sched[this.nSched++]; s.t = this.tick + dt; s.x = x; s.y = y; s.kind = kind;
  }
  private runSched(s: Sched) {
    const r = this.rng;
    if (s.kind === S_BOOM) { this.boom(s.x, s.y, 1); this.shake(2 + (r.next() < 0.5 ? 1 : 0), 8); return; }
    // finale: the big one
    const x = s.x, y = s.y;
    this.flash('#ffffff', 8); this.shake(8, 40);
    this.anim(x, y, P('f'));
    this.ring(x, y, 10, 22, 5, P('6'), CIRCLE_FILL, 0);
    this.ring(x, y, 10, 48, 20, P('6'), CIRCLE_RING, 0);
    this.ring(x, y, 8, 68, 26, P('f'), CIRCLE_RING, 4);
    this.ring(x, y, 6, 90, 32, P('c'), CIRCLE_DASH, 8);
    for (let i = 0; i < 18; i++) this.radial(x + r.range(-8, 8), y + r.range(-8, 8), 0.6, 2.6, SEQ.boom, 0, r.int(26, 40), 0.92, -0.02, F_RAMP);
    for (let i = 0; i < 8; i++) this.radial(x, y, 1.2, 3, SEQ.star, r.pick(STARC), 44, 0.95, 0.02, F_BLINK);
    for (let i = 0; i < 8; i++) this.radial(x, y, 0.8, 2.2, SEQ.heart, r.pick(HEARTC), 50, 0.95, -0.01, F_BLINK | F_SWAY);
    this.fur(x, y, this.dying.tint, 12);
    this.confetti(x, y, 56, 4.2, 8);
    this.banner.t = 0; this.banner.x = Math.round(x); this.banner.y = Math.max(14, Math.round(y) - 46);
    this.dying.until = 0;
  }

  // ---------------------------------------------------------------- content lookups (cached)
  private enemyDef(id: string): any {
    const list: any = (this.g.content as any)?.enemies;
    return Array.isArray(list) ? list.find((e: any) => e.id === id) : list?.[id];
  }
  /** two most common non-outline colors of a cat's sprite = its coat colors */
  private furOf(breed: string): number[] {
    const hit = this.furCache.get(breed); if (hit) return hit;
    let res = FUR_DEFAULT;
    try {
      const rows = spriteRows(this.enemyDef(breed)?.sprite ?? ''); const n = new Map<string, number>();
      if (rows) for (const row of rows) for (const ch of row) if (!'.01vq2 '.includes(ch)) n.set(ch, (n.get(ch) ?? 0) + 1);
      const top = [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(e => P(e[0])).filter(i => i >= 0);
      if (top.length) res = top;
    } catch { /* fall back to cream */ }
    this.furCache.set(breed, res); return res;
  }

  // ---------------------------------------------------------------- simulation (visual only)
  update(g: Game) {
    if (g.paused) return; // frozen with the game; step(n) advances regardless
    this.advance();
  }
  private advance() {
    this.tick++;
    // scheduled boss explosion stages
    for (let i = 0; i < this.nSched;) {
      const s = this.sched[i];
      if (s.t <= this.tick) {
        const t = this.sched[--this.nSched]; this.sched[this.nSched] = s; this.sched[i] = t;
        this.runSched(s);
      } else i++;
    }
    // shake: integer amplitude, decays linearly, alternates sign each tick for a punchy snap
    if (this.shakeT > 0) {
      this.shakeT--;
      const a = Math.ceil(this.shakeAmt * this.shakeT / this.shakeMax);
      this.shakeSign = -this.shakeSign;
      this.off.x = a ? this.shakeSign * this.rng.int(Math.ceil(a / 2), a) : 0;
      this.off.y = a ? this.rng.int(-a, a) >> 1 : 0;
    } else { this.shakeAmt = 0; this.off.x = 0; this.off.y = 0; }
    if (this.flashT > 0) this.flashT--;
    // designed pops
    for (let i = 0; i < this.nAnims;) {
      const a = this.anims[i];
      if (++a.t >= BOOP_TOTAL) { const last = this.anims[--this.nAnims]; this.anims[this.nAnims] = a; this.anims[i] = last; continue; }
      i++;
    }
    // banner: sparkle trail while it holds
    const b = this.banner;
    if (b.t >= 0) {
      b.t++;
      if (b.t > 96) b.t = -1;
      else if (b.t > 6 && b.t < 80 && b.t % 5 === 0) {
        const side = (b.t / 5) & 1 ? 1 : -1;
        this.spawn(b.x + side * this.rng.range(28, 40), b.y + this.rng.range(-6, 10), side * 0.3, -0.3, 0, 0.97, 20, this.rng.pick(STARC), SEQ.spark, F_BLINK);
      }
    }
    // particles (swap-remove)
    const tick = this.tick;
    for (let i = 0; i < this.nParts;) {
      const p = this.parts[i];
      if (--p.life <= 0) { const last = this.parts[--this.nParts]; this.parts[this.nParts] = p; this.parts[i] = last; continue; }
      p.vy += p.g; p.vx *= p.drag; p.vy *= p.drag;
      if (p.f & F_CONFETTI) { if (p.vy > 0.55) p.vy = 0.55; p.x += p.vx + Math.sin(tick * 0.07 + p.ph) * 0.5; }
      else if (p.f & F_SWAY) p.x += p.vx + Math.sin(tick * 0.15 + p.ph) * 0.25;
      else p.x += p.vx;
      p.y += p.vy;
      i++;
    }
    for (let i = 0; i < this.nRings;) {
      const q = this.rings[i];
      if (q.delay > 0) { q.delay--; i++; continue; }
      if (--q.life <= 0) { const last = this.rings[--this.nRings]; this.rings[this.nRings] = q; this.rings[i] = last; continue; }
      i++;
    }
    for (let i = 0; i < this.nTexts;) {
      const t = this.texts[i];
      if (--t.life <= 0) { const last = this.texts[--this.nTexts]; this.texts[this.nTexts] = t; this.texts[i] = last; continue; }
      t.y += t.vy; t.vy *= 0.84; if (t.vy > -0.25) t.vy = -0.25;
      i++;
    }
    // keep live labels from overlapping while they drift: the upper one yields upward
    for (let i = 0; i < this.nTexts; i++) for (let j = i + 1; j < this.nTexts; j++) {
      const a = this.texts[i], c = this.texts[j];
      if (Math.abs(a.x - c.x) * 2 >= a.w + c.w || Math.abs(a.y - c.y) >= 9) continue;
      if (a.y <= c.y) a.y = c.y - 9; else c.y = a.y - 9;
    }
  }

  // ---------------------------------------------------------------- drawing (pixel-exact)
  private drawFn = (ctx: CanvasRenderingContext2D) => this.draw(ctx);
  render(_g: Game, r: any) {
    if (this.nParts || this.nRings || this.nTexts || this.nAnims || this.banner.t >= 0 || this.dying.until > this.tick) r.push(4, 0, this.drawFn);
  }
  private draw(ctx: CanvasRenderingContext2D) {
    const tick = this.tick;
    // dying boss: wobbles and strobes white until the finale
    const d = this.dying;
    if (d.until > tick && d.sprite) {
      const k = tick - d.t;
      drawSprite(ctx, d.sprite, d.x + ((k >> 1) % 2 ? 1 : -1) * (1 + (k >> 4)), d.y + ((k >> 2) % 2), { flash: (k >> 2) % 2 === 0 });
    }
    // rings + pop discs
    for (let i = 0; i < this.nRings; i++) {
      const q = this.rings[i]; if (q.delay > 0) continue;
      const u = 1 - q.life / q.max, e = 1 - (1 - u) * (1 - u); // ease-out
      const rad = Math.round(q.r0 + (q.r1 - q.r0) * e);
      let mode = q.mode;
      if (mode === CIRCLE_RING && u > 0.6) mode = CIRCLE_DASH; // fade by breaking up, not by alpha
      if (mode === CIRCLE_DASH && u > 0.85 && (tick & 1)) continue;
      const c = circleCanvas(rad, q.c, mode);
      ctx.drawImage(c, Math.round(q.x) - rad, Math.round(q.y) - rad);
    }
    // particles. Pass 1: ink silhouettes of merged puffs; pass 2: puff fills (one outlined cloud);
    // pass 3: everything else (individually outlined stars, hearts, crumbs, confetti)
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < this.nParts; i++) {
        const p = this.parts[i];
        if ((p.f & F_BLINK) && p.life < p.max * 0.25 && ((p.life >> 1) & 1)) continue;
        const seq = SEQS[p.seq], u = (p.max - p.life) / p.max;
        const shape = (p.f & F_CONFETTI) ? seq[(((tick + ((p.ph * 40) | 0)) / 5) | 0) % seq.length] : seq[Math.min(seq.length - 1, (u * seq.length) | 0)];
        const merged = MERGED_FLAG[shape];
        if (pass === 2 ? merged : !merged) continue;
        const c = (p.f & F_RAMP) ? RAMP[Math.min(RAMP.length - 1, (u * RAMP.length) | 0)] : p.c;
        const cv = shapeCanvas(shape, c, pass === 0 ? 1 : 0);
        ctx.drawImage(cv, Math.round(p.x) - (cv.width >> 1), Math.round(p.y) - (cv.height >> 1));
      }
    }
    // designed kill pops (on top of their garnish)
    for (let i = 0; i < this.nAnims; i++) {
      const a = this.anims[i];
      let f = 0, acc = BOOP_DUR[0];
      while (a.t >= acc && f < BOOP_DUR.length - 1) acc += BOOP_DUR[++f];
      if (f === BOOP_DUR.length - 1 && (a.t & 2)) continue; // last frame twinkles out
      const cv = shapeCanvas(BOOP_FRAMES[f], a.c);
      ctx.drawImage(cv, a.x - (cv.width >> 1), a.y - (cv.height >> 1));
    }
    // floating score text: pops in white, settles to its tier color, blinks out
    const camX = Math.round(this.g.mods.player?.camera?.x ?? 0);
    for (let i = 0; i < this.nTexts; i++) {
      const t = this.texts[i];
      if (t.life < 12 && ((t.life >> 1) & 1)) continue;
      const cv = t.max - t.life < 4 ? t.pop : t.cv; if (!cv) continue;
      const half = cv.width >> 1;
      const x = Math.max(camX + 2 + half, Math.min(camX + PF_W - 2 - half, t.x));
      ctx.drawImage(cv, x - half, Math.round(t.y) - (cv.height >> 1));
    }
    // 'BOOPED!' banner: integer-scale bounce in over 6 frames, hold, blink out
    const b = this.banner;
    if (b.t >= 0 && !(b.t > 84 && (b.t & 2))) {
      const SC = [1, 1, 3, 3, 2, 2], BY = [-14, -10, -4, 3, 1, 0];
      const k = Math.min(b.t, 5), sc = b.t < 6 ? SC[k] : 2, oy = b.t < 6 ? BY[k] : Math.round(Math.sin(b.t * 0.12) * 1.5);
      const cv = outlinedText(text, 'BOOPED!', PALETTE[P('f')], sc, PALETTE[P('d')]);
      const half = cv.width >> 1;
      const x = Math.max(camX + 2 + half, Math.min(camX + PF_W - 2 - half, b.x));
      ctx.drawImage(cv, x - half, b.y + oy - (cv.height >> 1));
    }
  }

  overlay(g: Game, ctx: CanvasRenderingContext2D) {
    if (this.flashT <= 0 || g.paused) return;
    // palette-legal stepped flash: 50% checker -> 25% grid -> 12% sprinkle of the flash color, playfield only
    const u = this.flashT / this.flashMax;
    ctx.drawImage(ditherCanvas(this.flashC, PF_W, H, u > 0.6 ? 2 : u > 0.3 ? 4 : 8), PF_X, 0);
  }

  /** count of live particles (for tests/budget checks) */
  liveCount() { return this.nParts; }
}
export const makeEffects = (): Module => new Effects();
