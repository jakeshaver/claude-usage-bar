import type { Game, Module } from '../core/game';
import { H, PF_X, PF_W } from '../core/game';
import { PALETTE, KEY } from '../core/palette';
import { text } from '../art/font';
import { spriteRows, spriteCanvas } from '../art/sprite';
import { Rng } from '../core/rng';
import {
  SEQ, SEQS, MERGED_FLAG, BOOP_FRAMES, BOOP_DUR, shapeCanvas, circleCanvas, paintText, ditherCanvas,
  CIRCLE_RING, CIRCLE_DASH, CIRCLE_FILL, bannerCanvas, BANNER_W, BANNER_H, silhouette, checkerSilhouette,
} from './shapes';

/**
 * Effects: particles, screen shake, flashes, floating text, boss explosions.
 * Purely visual: owns its own RNG stream and never touches simulation state.
 * Everything is pixel-exact and palette-legal: shapes are palette-indexed bitmaps cached as tiny canvases,
 * rings are midpoint circles, fades are done by shrinking + blinking, flashes are ordered dithers
 * (no alpha blending anywhere). All pools are preallocated: no per-frame allocation in update/render.
 */

const P = (k: string) => KEY.indexOf(k);
const MAX_PARTS = 580, MAX_RINGS = 32, MAX_TEXT = 24, MAX_SCHED = 32, MAX_ANIM = 32, MAX_GHOST = 16;

// particle flags
const F_BLINK = 1, F_CONFETTI = 2, F_RAMP = 4, F_SWAY = 8, F_CYCLE = 16;
/** pastel fireball ramp for explosion puffs: white -> yellow -> orange -> pink -> lavender */
const RAMP = [P('6'), P('6'), P('f'), P('f'), P('g'), P('c'), P('7'), P('5')];
const PASTEL = [P('c'), P('f'), P('l'), P('i'), P('t'), P('6'), P('s')];
const STARC = [P('f'), P('6'), P('c'), P('s')];
const BOOPC = [P('f'), P('f'), P('t'), P('s'), P('l')];
const HEARTC = [P('c'), P('d'), P('c')];
const TURD = [P('9'), P('a'), P('9')];
const STINK = [P('i'), P('o'), P('i')];
const CONFETTI = [P('c'), P('f'), P('l'), P('i'), P('t'), P('6'), P('g'), P('d')];
const FUR_DEFAULT = [P('7'), P('6'), P('5')];
const LIFT = 18; // labels spawn this much above the caller's y, so they clear the 49px kill pop
/** top edge the finale banner may reach (the HUD toast row lives above it) */
const BANNER_TOP = 26;
/** the 8 showcase kinds and the age (ticks) at which each one reads best */
const STAGE_KINDS = ['boop', 'splat', 'sparkle', 'shield', 'poof', 'hearts', 'confetti', 'boom'];
const STAGE_PEAK = [9, 4, 6, 7, 8, 16, 34, 9];
/** strip rows (top to bottom): confetti last, in a double-height row, so its fountain never climbs into hearts */
const STRIP_ORDER = [0, 1, 2, 3, 4, 5, 7, 6];
/** combo labels: a numeric label merges into a live one within this many px horizontally / vertically,
 *  while that one is still in its first MERGE_AGE ticks */
const MERGE_DX = 24, MERGE_DY = 28, MERGE_AGE = 30;
/** confetti cannons fire this long after the finale flash (a second beat) */
const CONFETTI_DELAY = 10;
/** hit-stop on the finale tick (Galaga-style weight) */
const FINALE_STOP = 3;
const STRIP_T = [3, 9, 18, 32];
const BOOP_TOTAL = BOOP_DUR.reduce((a, b) => a + b, 0);

interface Part { x: number; y: number; vx: number; vy: number; g: number; drag: number; life: number; max: number; c: number; seq: number; f: number; ph: number }
interface Ring { x: number; y: number; r0: number; r1: number; life: number; max: number; delay: number; c: number; mode: number }
interface Txt {
  x: number; xl: number; y: number; y0: number; vy: number; life: number; max: number; val: number; combo: number; popT: number;
  /** reusable per-label canvases (1x tier color, 1x white entry frame, 2x merge pop) and their used sizes */
  cv: HTMLCanvasElement | null; pop: HTMLCanvasElement | null; big: HTMLCanvasElement | null; w: number; h: number; bw: number; bh: number;
}
interface Ghost { sprite: string; x: number; y: number; t: number }
interface Sched { t: number; x: number; y: number; kind: number; sz: number }
interface Anim { x: number; y: number; t: number; c: number }

// scheduled sub-event kinds (boss explosion sequence)
const S_BOOM = 1, S_FINALE = 2, S_CANNON = 3;

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
  ghosts: Ghost[] = []; nGhosts = 0;
  /** hit-stop: while > 0 the effects timeline holds its frame (core may also pause the sim via frozen()) */
  stopT = 0;

  shakeAmt = 0; shakeT = 0; shakeMax = 1; shakeSign = 1;
  private off = { x: 0, y: 0 };
  flashC = 6; flashT = 0; flashMax = 1;
  /** showcase staging: '' = live game; grid / strip / boss = a frozen, labeled stage on a plain backdrop */
  stageMode = ''; stageWorld = false; private pendingStage: { mode: string; t: number } | null = null;
  tick = 0;

  // boss death: the defeated boss lingers as a wobbling, white-flashing sprite until the finale
  dying = { sprite: '', x: 0, y: 0, t: 0, until: 0, tint: FUR_DEFAULT };
  /** the 'BOOPED!' finale banner */
  banner = { t: -1, x: 0, y: 0 };
  private furCache = new Map<string, number[]>();

  constructor() {
    for (let i = 0; i < MAX_PARTS; i++) this.parts.push({ x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 1, life: 0, max: 1, c: 0, seq: 0, f: 0, ph: 0 });
    for (let i = 0; i < MAX_RINGS; i++) this.rings.push({ x: 0, y: 0, r0: 0, r1: 0, life: 0, max: 1, delay: 0, c: 0, mode: 0 });
    for (let i = 0; i < MAX_TEXT; i++) this.texts.push({ x: 0, xl: 0, y: 0, y0: 0, vy: 0, life: 0, max: 1, val: 0, combo: 0, popT: 0, cv: null, pop: null, big: null, w: 0, h: 0, bw: 0, bh: 0 });
    for (let i = 0; i < MAX_GHOST; i++) this.ghosts.push({ sprite: '', x: 0, y: 0, t: 0 });
    for (let i = 0; i < MAX_SCHED; i++) this.sched.push({ t: 0, x: 0, y: 0, kind: 0, sz: 1 });
    for (let i = 0; i < MAX_ANIM; i++) this.anims.push({ x: 0, y: 0, t: 0, c: 0 });
  }

  init(g: Game) {
    this.g = g;
    // ?showcase=effects stages itself on a plain backdrop the first time it renders (after the showcase setup):
    // ?fx=grid (default) | strip | boss | live, ?fxt=N age in ticks (default: each kind's peak frame)
    try {
      const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
      if (q && q.get('showcase') === 'effects' && !g.headless) {
        const t = q.get('fxt') ?? q.get('advance');
        this.pendingStage = { mode: q.get('fx') ?? 'grid', t: t === null ? -1 : +t };
      }
    } catch { /* no location: tests */ }
    // fur puffs in the booped cat's own coat colors (garnish around the designed pop)
    g.bus.on('cat:boop', (p: any) => {
      if (!p || g.headless) return;
      this.fur(p.x, p.y, this.furOf(p.breed), 4);
      // physical impact: a white silhouette of the cat on the hit tick (over the pop), plus a tiny 1px snap
      const spr = this.enemyDef(p.breed)?.sprite; if (spr) this.ghost(spr, p.x, p.y);
      this.shake(1, 3);
    });
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
          this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, 0.02, 0.9, r.int(30, 36), r.pick(STARC), i & 1 ? SEQ.spark : SEQ.star, F_BLINK);
        }
        // directional garnish: the turd flies up, so the hit carries on upward
        for (let i = 0; i < 3; i++) this.spawn(x + (i - 1) * 4, y - 4, (i - 1) * 0.7 + r.range(-0.2, 0.2), -r.range(2.4, 3.4), 0.05, 0.92, r.int(16, 22), r.pick(STARC), SEQ.spark, F_BLINK);
        // small turd-splat on the cat's butt-facing (lower) side: impact star + 2 crumbs
        this.spawn(x, y + 7, 0, 0, 0, 1, 9, P('7'), SEQ.impact, 0);
        for (let i = 0; i < 2; i++) this.spawn(x + (i ? 2 : -2), y + 7, (i ? 1 : -1) * r.range(0.8, 1.4), r.range(0.2, 0.8), 0.12, 0.95, r.int(16, 22), r.pick(TURD), SEQ.chunk, 0);
        break;
      }
      case 'splat': { // turd hits something that doesn't pop (yet): the signature 'cute gross' beat
        this.spawn(x, y, 0, 0, 0, 1, 34, P('a'), SEQ.splat, F_BLINK);           // 15x9 squash -> 17x9 splat -> dry smear
        this.spawn(x, y - 1, 0, 0, 0, 1, 9, P('7'), SEQ.impact, 0);              // 3-frame cream impact star
        for (let i = 0; i < 4; i++) { const a = r.range(-Math.PI * 0.95, -Math.PI * 0.05); const s = r.range(1, 2.4); this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, 0.14, 0.95, r.int(18, 26), r.pick(TURD), SEQ.chunk, 0); }
        for (let i = 0; i < 3; i++) this.spawn(x + (i - 1) * 6 + r.range(-1, 1), y - 6 - r.range(0, 3), r.range(-0.1, 0.1), -0.45 - r.range(0, 0.2), 0, 0.99, r.int(30, 40), STINK[i], SEQ.stink, F_CYCLE | F_SWAY | F_BLINK);
        break;
      }
      case 'hearts': {
        // one big 9x8 heart rising in the middle, two 7x6 flanking it, four 5x5 sprinkled around
        this.ring(x, y, 3, 16, 12, P('c'), CIRCLE_RING, 0);
        this.spawn(x, y - 2, r.range(-0.15, 0.15), -1.5, 0.01, 0.97, 50, P('d'), SEQ.heartBig, F_BLINK | F_SWAY);
        for (let i = 0; i < 2; i++) this.spawn(x + (i ? 12 : -12), y + 2, (i ? 0.7 : -0.7), -1.3 - r.range(0, 0.3), 0.01, 0.97, r.int(42, 50), P('c'), SEQ.heartMid, F_BLINK | F_SWAY);
        for (let i = 0; i < 4; i++) this.spawn(x + r.range(-18, 18), y + r.range(-6, 8), r.range(-1, 1), r.range(-1.8, -0.8), 0.005, 0.97, r.int(34, 46), r.pick(HEARTC), SEQ.heartHold5, F_BLINK | F_SWAY);
        break;
      }
      case 'confetti': this.confetti(x, y, 40, 0.9, 6); break;
      case 'fur': this.fur(x, y, tint && P(tint) >= 0 ? [P(tint)] : FUR_DEFAULT, 10); break;
      case 'boom': this.boom(x, y, 1); break;
      case 'bigboop': this.bossExplode(x, y); break;
      case 'poof': { // buddy knocked away: soft fur puffs and a couple of tiny stars
        // a cloud bursting: a quick ring + a big central puff that deflates, outer puffs drifting upward
        this.ring(x, y, 6, 22, 10, P('7'), CIRCLE_RING, 0);
        this.spawn(x, y, 0, -0.3, 0, 0.95, 14, P('7'), SEQ.puffBig, 0);
        const cols = [P('7'), P('6'), P('8'), P('5')];
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * 6.283 + r.range(-0.2, 0.2), s = r.range(1.1, 1.9);
          this.spawn(x + Math.cos(a) * 3, y + Math.sin(a) * 3, Math.cos(a) * s, Math.sin(a) * s * 0.7 - 0.5, -0.03, 0.9, r.int(28, 36), cols[i & 3], SEQ.furUp, F_BLINK | F_SWAY);
        }
        for (let i = 0; i < 4; i++) this.radial(x, y, 1.2, 2.2, SEQ.spark, r.pick(STARC), 24, 0.93, -0.02, F_BLINK);
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

  /** Floating score text. Labels spawn ${LIFT}px above y. A numeric label that lands within MERGE_DX px (x) of a
   *  live numeric label still in its first MERGE_AGE ticks merges into it as a running combo total (2x scale-pop,
   *  hotter tier colour and an 'xN' tag from 3 kills); otherwise it stacks above. Outline: palette 0 + 1px drop. */
  floatText(x: number, y: number, label: string) {
    if (this.g.headless) return;
    x = Math.round(x); y = Math.round(y) - LIFT;
    const n = Number(label), numeric = label !== '' && Number.isFinite(n);
    if (numeric) {
      let best: Txt | null = null, bd = 1e9;
      for (let i = 0; i < this.nTexts; i++) {
        const t = this.texts[i];
        if (t.val < 0 || t.max - t.life >= MERGE_AGE) continue;
        const dx = Math.min(Math.abs(t.x - x), Math.abs(t.xl - x)), dy = Math.abs(t.y0 - y);
        if (dx <= MERGE_DX && dy <= MERGE_DY && dx + dy < bd) { best = t; bd = dx + dy; }
      }
      if (best) { // chain kill: merge into a running total that pops
        best.val += n; best.combo++; best.life = best.max; best.popT = 3; best.vy = Math.min(best.vy, -1.2);
        best.xl = x; best.y0 = y;
        this.paint(best); return;
      }
    }
    for (let pass = 0; pass < 6; pass++) {
      let hit: Txt | null = null;
      for (let i = 0; i < this.nTexts; i++) { const t = this.texts[i]; if (Math.abs(t.x - x) <= 10 && Math.abs(t.y - y) <= 8) { hit = t; break; } }
      if (!hit) break;
      y = Math.round(hit.y) - 10; // stack above it
    }
    let t: Txt;
    if (this.nTexts < MAX_TEXT) t = this.texts[this.nTexts++];
    else { let o = 0; for (let i = 1; i < MAX_TEXT; i++) if (this.texts[i].life < this.texts[o].life) o = i; t = this.texts[o]; }
    t.x = t.xl = x; t.y = t.y0 = y; t.vy = -1.6; t.life = t.max = 50; t.val = numeric ? n : -1; t.combo = 1; t.popT = 0;
    this.paint(t, label);
  }
  /** repaint a label's reusable canvases (no allocation once they are big enough) */
  private paint(t: Txt, label?: string) {
    const v = t.val, cb = t.combo;
    const key = v < 0 ? '6' : cb >= 5 ? 'i' : cb >= 3 ? 'c' : cb >= 2 ? 'l' : v >= 1000 ? 'c' : v >= 300 ? 'l' : 'f';
    const s = label ?? (cb >= 3 ? v + ' X' + cb : String(v));
    if (!t.cv) { t.cv = document.createElement('canvas'); t.pop = document.createElement('canvas'); t.big = document.createElement('canvas'); }
    [t.w, t.h] = paintText(t.cv, text, s, PALETTE[P(key)]);
    paintText(t.pop!, text, s, PALETTE[6]);
    [t.bw, t.bh] = cb >= 2 ? paintText(t.big!, text, s, PALETTE[P(key)], 2) : [0, 0];
  }

  shake(px: number, ticks: number) {
    const st: any = this.g.state.settings;
    if (!st.shake || st.reduceMotion) return;
    px = Math.round(px);
    if (this.shakeT <= 0 || px >= this.shakeAmt * (this.shakeT / this.shakeMax)) { this.shakeAmt = px; this.shakeT = this.shakeMax = Math.max(1, ticks); }
    else this.shakeT = Math.max(this.shakeT, ticks);
  }

  /** Screen flash in a palette color. `c` is a palette key ('6', 'f', 'r'); a hex string is accepted only when it
   *  is exactly one of the 32 palette entries (anything else is refused and reported). Honors settings.flash === false
   *  and settings.reduceMotion. */
  flash(c: string, ticks: number) {
    const s: any = this.g.state.settings;
    if (s && (s.flash === false || s.reduceMotion)) return;
    let idx = c.length === 1 ? KEY.indexOf(c) : -1;
    if (idx < 0 && c[0] === '#') { const lc = c.toLowerCase(); idx = PALETTE.findIndex(h => h.toLowerCase() === lc); }
    if (idx < 0) { this.g.reportError('effects', new Error(`flash color '${c}' is not in the palette`)); return; }
    if (this.flashT > 0 && ticks < this.flashT && this.flashT / this.flashMax > 0.5) return; // don't stomp a stronger flash
    this.flashC = idx; this.flashT = this.flashMax = Math.max(1, Math.min(10, ticks));
  }

  /** Integer pixel offset for the playfield camera. Zero when shake is disabled or the game is paused. */
  shakeOffset() {
    if (this.shakeT <= 0 || !this.g.state.settings.shake || this.g.paused) { this.off.x = 0; this.off.y = 0; }
    return this.off;
  }

  /** Hit-stop: hold the effects frame for n ticks. Core may also hold the simulation while frozen() is true
   *  (purely presentational: always false headless, so the bot and tests stay deterministic). */
  hitStop(n: number) { if (!this.g.headless) this.stopT = Math.max(this.stopT, Math.min(6, Math.round(n))); }
  frozen() { return this.stopT > 0 && !this.g.headless && !this.stageMode; }

  /** Advance the effects timeline n ticks even while the game is paused (showcase / tests / critics). */
  step(n = 1) { for (let i = 0; i < n; i++) this.advance(); }

  /** Stage a frozen, labeled showcase on a plain backdrop. mode: grid (8 kinds at their peak, or all at age t),
   *  strip (each kind at 4 ages side by side), boss (boss explosion at age t). Effects stay frozen until clear(). */
  stage(mode: string, t = -1) {
    this.clear();
    if (mode === 'live') return;
    // '<mode>-world' keeps the area's own backdrop (e.g. boss-world on the moon) instead of the plain strip
    this.stageWorld = mode.endsWith('-world'); mode = mode.replace('-world', '');
    this.stageMode = mode === 'strip' || mode === 'boss' ? mode : 'grid';
    const camX = Math.round(this.g.mods.player?.camera?.x ?? 0);
    if (this.stageMode === 'boss') {
      const def = this.enemyDef('boss_whiskers');
      const x = camX + (PF_W >> 1), y = 150;
      this.bossExplode(x, y);
      this.dying.sprite = def?.sprite ?? ''; this.dying.tint = this.furOf('boss_whiskers');
      this.step(t < 0 ? 30 : t);
    } else if (this.stageMode === 'grid') {
      const peak = t < 0;
      const maxT = peak ? Math.max(...STAGE_PEAK) : t;
      for (let k = 0; k <= maxT; k++) {
        for (let i = 0; i < 8; i++) {
          if ((peak ? maxT - STAGE_PEAK[i] : 0) !== k) continue;
          const [x, y] = this.gridCell(camX, i);
          this.burst(x, y, STAGE_KINDS[i]);
          if (i === 0) { // a chain of three kills across a formation row merges into one running total
            this.fur(x, y, this.furOf('calico'), 4);
            this.floatText(x - 20, y, '100'); this.floatText(x, y, '100'); this.floatText(x + 20, y, '200');
          }
        }
        if (k < maxT) this.step(1);
      }
    } else { // strip: rows = kinds, columns = ages STRIP_T
      const maxT = STRIP_T[STRIP_T.length - 1];
      for (let k = 0; k <= maxT; k++) {
        for (let i = 0; i < 8; i++) for (let j = 0; j < STRIP_T.length; j++) {
          if (maxT - STRIP_T[j] !== k) continue;
          const [x, y] = this.stripCell(camX, i, j);
          if (STAGE_KINDS[i] === 'confetti') this.confetti(x, y, 30, 0.72, 4); // capped apex: stays in its own row
          else this.burst(x, y, STAGE_KINDS[i]);
        }
        if (k < maxT) this.step(1);
      }
    }
    this.shakeT = 0; this.off.x = 0; this.off.y = 0; this.flashT = 0;
  }
  private gridCell(camX: number, i: number): [number, number] {
    return [camX + 48 + (i % 4) * 96, i < 4 ? 112 : (i === 6 ? 318 : 288)];
  }
  /** strip: header row of ages at the top, then 7 single rows (36px) and confetti in a double-height row last */
  private stripCell(camX: number, i: number, j: number): [number, number] {
    const row = STRIP_ORDER.indexOf(i);
    return [camX + 112 + j * 74, row < 7 ? 42 + row * 36 : 344];
  }

  clear() { this.stageMode = ''; this.nParts = 0; this.nRings = 0; this.nTexts = 0; this.nSched = 0; this.nAnims = 0; this.nGhosts = 0; this.stopT = 0; this.dying.until = 0; this.banner.t = -1; this.shakeT = 0; this.flashT = 0; }

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
  private ghost(sprite: string, x: number, y: number) {
    if (this.nGhosts >= MAX_GHOST) return;
    const h = this.ghosts[this.nGhosts++]; h.sprite = sprite; h.x = Math.round(x); h.y = Math.round(y); h.t = 0;
  }
  private fur(x: number, y: number, cols: number[], n: number) {
    for (let i = 0; i < n; i++) this.radial(x, y, 0.4, 1.5, SEQ.fur, cols[i % cols.length], 30, 0.93, -0.015, F_BLINK | F_SWAY);
  }
  /** festive paper fountain: 3x3 squares and 2x4 strips (ink-outlined, flipping front/shade/edge-on) plus
   *  9px streamers. Launches up hard (vy -3.6..-5.2 at power 1: a 50-80px apex), then flutters down slowly
   *  while drifting out to ~ +-80px. power scales the launch. */
  private confetti(x: number, y: number, n: number, power: number, streamers: number) {
    const r = this.rng;
    for (let i = 0; i < n + streamers; i++) {
      const vy = -r.range(3.6, 5.2) * power, vx = r.range(-1, 1) * (0.5 + (5.2 + vy / power) * 1.5) * power;
      const seq = i >= n ? SEQ.streamer : i & 1 ? SEQ.confRect : SEQ.confSq;
      this.spawn(x + r.range(-8, 8), y + r.range(-4, 4), vx, vy, 0.12, 0.985, r.int(140, 190), r.pick(CONFETTI), seq, F_CONFETTI | F_BLINK);
    }
  }
  /** confetti cannon at a playfield edge: dir +1 fires up and to the right, -1 up and to the left */
  private cannon(x: number, y: number, dir: number, n: number, streamers: number) {
    const r = this.rng;
    this.ring(x, y, 3, 14, 10, P('f'), CIRCLE_RING, 0);
    this.spawn(x, y, 0, 0, 0, 1, 9, P('6'), SEQ.impact, 0);
    for (let i = 0; i < n + streamers; i++) {
      const a = -Math.PI / 2 + dir * r.range(0.3, 0.75), s = r.range(5.5, 8.5);
      const seq = i >= n ? SEQ.streamer : i & 1 ? SEQ.confRect : SEQ.confSq;
      this.spawn(x, y + r.range(-3, 3), Math.cos(a) * s, Math.sin(a) * s, 0.12, 0.975, r.int(130, 180), r.pick(CONFETTI), seq, F_CONFETTI | F_BLINK);
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
    this.flash('6', 4);
    // a crescendo of pops all over (and past) the boss, getting faster and bigger, then the finale
    // positions walk a jittered golden-angle spiral out to +-60px x / +-45px y, so no two pops pile up
    const T = [6, 14, 21, 27, 32, 37, 41, 45, 49, 52, 55, 58, 61];
    const a0 = r.next() * 6.283;
    for (let i = 0; i < T.length; i++) {
      const a = a0 + i * 2.39996, k = 0.45 + 0.55 * ((i + 1) / T.length) * r.range(0.8, 1.05);
      this.schedule(T[i], x + Math.round(Math.cos(a) * 60 * k), y + Math.round(Math.sin(a) * 45 * k), S_BOOM, i < 4 ? 1 : i < 9 ? 1.5 : 2);
    }
    this.schedule(64, x, y, S_FINALE, 1);
  }
  private schedule(dt: number, x: number, y: number, kind: number, sz: number) {
    if (this.nSched >= MAX_SCHED) return;
    const s = this.sched[this.nSched++]; s.t = this.tick + dt; s.x = x; s.y = y; s.kind = kind; s.sz = sz;
  }
  private runSched(s: Sched) {
    const r = this.rng;
    if (s.kind === S_BOOM) {
      this.boom(s.x, s.y, s.sz); this.fur(s.x, s.y, this.dying.tint, 3);
      this.shake(Math.round(1 + s.sz) + (r.next() < 0.5 ? 1 : 0), 8); return;
    }
    if (s.kind === S_CANNON) { // second beat: confetti cannons from both playfield edges + a heart shower
      const camX = Math.round(this.g.mods.player?.camera?.x ?? 0);
      const cy = Math.min(H - 30, Math.round(s.y) + 70);
      this.cannon(camX + 6, cy, 1, 34, 6); this.cannon(camX + PF_W - 6, cy, -1, 34, 6);
      for (let i = 0; i < 6; i++) this.spawn(s.x + (i - 2.5) * 22 + r.range(-5, 5), s.y + 30 + ((i * 7) % 3 - 1) * 10 + r.range(-4, 4), r.range(-0.4, 0.4), -r.range(1.1, 1.7), 0.004, 0.975, r.int(54, 70), r.pick(HEARTC), i % 3 ? SEQ.heartMid : SEQ.heartBig, F_BLINK | F_SWAY);
      return;
    }
    // finale: the big one
    const x = s.x, y = s.y;
    this.flash('6', 8); this.shake(8, 40);
    this.hitStop(FINALE_STOP);
    this.anim(x, y, P('f'));
    // white shockwave disc held for 8 frames (ink-rimmed), then three big rings that stay solid to 70% of their life
    this.ring(x, y, 22, 30, 8, P('6'), CIRCLE_FILL, 0);
    this.ring(x, y, 12, 52, 22, P('6'), CIRCLE_RING, 2);
    this.ring(x, y, 10, 76, 28, P('f'), CIRCLE_RING, 5);
    this.ring(x, y, 8, 100, 34, P('c'), CIRCLE_DASH, 8);
    // fire puffs fling out wide (no clump in the middle)
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * 6.283 + r.range(-0.15, 0.15), sp = r.range(2.2, 3.6);
      this.spawn(x + Math.cos(a) * 10, y + Math.sin(a) * 8, Math.cos(a) * sp, Math.sin(a) * sp * 0.8, -0.02, 0.92, r.int(26, 38), 0, SEQ.boom, F_RAMP);
    }
    for (let i = 0; i < 10; i++) this.radial(x, y, 2, 4, SEQ.star, r.pick(STARC), 44, 0.95, 0.02, F_BLINK);
    this.fur(x, y, this.dying.tint, 10);
    this.schedule(CONFETTI_DELAY, x, y, S_CANNON, 1);
    this.banner.t = 0; this.banner.x = Math.round(x); this.banner.y = Math.max(BANNER_TOP + (BANNER_H >> 1), Math.round(y) - 60);
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
    if (g.paused || this.stageMode) return; // frozen with the game (or staged); step(n) advances regardless
    this.advance();
  }
  private advance() {
    if (this.stopT > 0) { this.stopT--; return; } // hit-stop: hold the frame
    this.tick++;
    for (let i = 0; i < this.nGhosts;) {
      const h = this.ghosts[i];
      if (++h.t >= 2) { const last = this.ghosts[--this.nGhosts]; this.ghosts[this.nGhosts] = h; this.ghosts[i] = last; continue; }
      i++;
    }
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
        this.spawn(b.x + side * this.rng.range(40, 50), b.y + this.rng.range(-8, 10), side * 0.3, -0.3, 0, 0.97, 20, this.rng.pick(STARC), SEQ.spark, F_BLINK);
      }
    }
    // particles (swap-remove)
    const tick = this.tick;
    for (let i = 0; i < this.nParts;) {
      const p = this.parts[i];
      if (--p.life <= 0) { const last = this.parts[--this.nParts]; this.parts[this.nParts] = p; this.parts[i] = last; continue; }
      p.vy += p.g; p.vx *= p.drag; p.vy *= p.drag;
      if (p.f & F_CONFETTI) { // fountain up, then a slow sideways flutter down
        if (p.vy > 0.5) p.vy = 0.5; else p.vx *= 0.99;
        p.x += p.vx + (p.vy > 0 ? Math.sin(tick * 0.08 + p.ph) * 0.45 : 0);
      }
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
      if (t.popT > 0) t.popT--;
      t.y += t.vy; t.vy *= 0.84; if (t.vy > -0.25) t.vy = -0.25;
      i++;
    }
    // keep live labels from overlapping while they drift: the upper one yields upward
    for (let i = 0; i < this.nTexts; i++) for (let j = i + 1; j < this.nTexts; j++) {
      const a = this.texts[i], c = this.texts[j];
      if (Math.abs(a.x - c.x) * 2 >= a.w + c.w || Math.abs(a.y - c.y) >= 10) continue;
      if (a.y <= c.y) a.y = c.y - 10; else c.y = a.y - 10;
    }
  }

  // ---------------------------------------------------------------- drawing (pixel-exact)
  private drawFn = (ctx: CanvasRenderingContext2D) => this.draw(ctx);
  render(_g: Game, r: any) {
    if (this.pendingStage) { const s = this.pendingStage; this.pendingStage = null; this.stage(s.mode, s.t); }
    if (this.stageMode) {
      if (!this.stageWorld) r.push(4, -1e9, this.stageFn);
      r.push(4, 1e9, this.labelFn); // labels after the effects, so a burst never hides its own label
      const ui = this.g.mods.ui; if (ui && Array.isArray(ui.toasts)) ui.toasts.length = 0; // no HUD toast over a staged showcase
    }
    if (this.nParts || this.nRings || this.nTexts || this.nAnims || this.nGhosts || this.banner.t >= 0 || this.dying.until > this.tick) r.push(4, 0, this.drawFn);
  }
  /** plain high-contrast showcase backdrop (night sky navy with a few stars) + cell labels */
  private stageFn = (ctx: CanvasRenderingContext2D) => {
    const camX = Math.round(this.g.mods.player?.camera?.x ?? 0);
    ctx.fillStyle = PALETTE[P('1')]; ctx.fillRect(camX, 0, PF_W, H);
    ctx.fillStyle = PALETTE[P('2')];
    for (let i = 0; i < 40; i++) ctx.fillRect(camX + ((i * 97) % PF_W), (i * 53) % H, 1, 1);
    if (this.stageMode === 'grid') {
      ctx.fillStyle = PALETTE[P('3')]; ctx.fillRect(camX, 179, PF_W, 1);
      for (let c = 1; c < 4; c++) ctx.fillRect(camX + c * 96, 0, 1, H);
    } else if (this.stageMode === 'strip') {
      ctx.fillStyle = PALETTE[P('2')]; ctx.fillRect(camX, 14, PF_W, 1);
      for (let i = 1; i < 7; i++) ctx.fillRect(camX, 24 + i * 36, PF_W, 1);
      ctx.fillRect(camX, 276, PF_W, 1);
    }
  };
  /** staged labels, drawn after the effects: outlined so a burst behind them can't swallow them */
  private labelFn = (ctx: CanvasRenderingContext2D) => {
    const camX = Math.round(this.g.mods.player?.camera?.x ?? 0);
    const lab = PALETTE[P('5')], dim = PALETTE[P('4')], sh = { shadow: PALETTE[0] };
    if (this.stageMode === 'grid') {
      for (let i = 0; i < 8; i++) { const [x] = this.gridCell(camX, i); const s = STAGE_KINDS[i].toUpperCase(); text(ctx, s, x - s.length * 3, i < 4 ? 30 : 186, lab, sh); }
    } else if (this.stageMode === 'strip') {
      for (let i = 0; i < 8; i++) { const [, y] = this.stripCell(camX, i, 0); text(ctx, STAGE_KINDS[i].toUpperCase(), camX + 4, (i === 6 ? 300 : y) - 3, lab, sh); }
      for (let j = 0; j < STRIP_T.length; j++) { const [x] = this.stripCell(camX, 0, j); const s = 'T' + STRIP_T[j]; text(ctx, s, x - s.length * 3, 4, dim, sh); }
    } else {
      text(ctx, 'BOSS DEFEAT T' + (this.tick - this.dying.t), camX + 4, H - 10, dim, sh);
    }
  };
  private draw(ctx: CanvasRenderingContext2D) {
    const tick = this.tick;
    // dying boss: wobbles and strobes white until the finale
    const d = this.dying;
    if (d.until > tick && d.sprite) {
      // the cat stays readable: normal sprite with a solid ink outline, flashing white only 2 frames in 8 (7.5Hz,
      // sprite-sized). settings.flash === false / reduceMotion: no white flash and no wobble at all.
      const st: any = this.g.state.settings, calm = st && (st.flash === false || st.reduceMotion);
      const k = tick - d.t, on = !calm && (k & 7) < 2;
      const x = calm ? d.x : d.x + ((k >> 1) % 2 ? 1 : -1) * (1 + (k >> 4)), y = calm ? d.y : d.y + ((k >> 2) % 2);
      const base = spriteCanvas(d.sprite, 0, false);
      if (base) {
        const sil = silhouette(base, PALETTE[0]);
        const sx = Math.round(x - base.width / 2), sy = Math.round(y - base.height / 2);
        ctx.drawImage(sil, sx - 1, sy); ctx.drawImage(sil, sx + 1, sy); ctx.drawImage(sil, sx, sy - 1); ctx.drawImage(sil, sx, sy + 1);
        ctx.drawImage(base, sx, sy);
        // flash frames: a 50% white checker over the sprite, so the face and markings still read through it
        if (on) ctx.drawImage(checkerSilhouette(base, PALETTE[6]), sx, sy);
      }
    }
    // rings + pop discs
    for (let i = 0; i < this.nRings; i++) {
      const q = this.rings[i]; if (q.delay > 0) continue;
      const u = 1 - q.life / q.max, e = 1 - (1 - u) * (1 - u); // ease-out
      const rad = Math.round(q.r0 + (q.r1 - q.r0) * e);
      // fade by an ordered-dither erase along the arc (solid -> 75% -> 50% -> 25%), never by alpha or blinking
      // solid until 70% of the life (so big rings read at full size), then 75% -> 50% -> 25%
      const erase = q.mode === CIRCLE_FILL ? 0 : u < 0.7 ? 0 : u < 0.8 ? 1 : u < 0.9 ? 2 : 3;
      const qx = Math.round(q.x), qy = Math.round(q.y);
      // ink under-ring (+1y) / ink rim on discs: rings keep their contrast on pale moon regolith and snow too
      if (q.mode === CIRCLE_FILL) { const k = circleCanvas(rad + 1, 0, CIRCLE_RING, 0); ctx.drawImage(k, qx - rad - 1, qy - rad - 1); ctx.drawImage(k, qx - rad - 1, qy - rad); }
      else ctx.drawImage(circleCanvas(rad, 0, q.mode, erase), qx - rad, qy - rad + 1);
      const c = circleCanvas(rad, q.c, q.mode, erase);
      ctx.drawImage(c, qx - rad, qy - rad);
    }
    // particles. Pass 1: ink silhouettes of merged puffs; pass 2: puff fills (one outlined cloud);
    // pass 3: everything else (individually outlined stars, hearts, crumbs, confetti)
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < this.nParts; i++) {
        const p = this.parts[i];
        if ((p.f & F_BLINK) && p.life < p.max * 0.25 && ((p.life >> 1) & 1)) continue;
        const seq = SEQS[p.seq], u = (p.max - p.life) / p.max;
        const shape = (p.f & (F_CONFETTI | F_CYCLE)) ? seq[(((tick + ((p.ph * 40) | 0)) / 5) | 0) % seq.length] : seq[Math.min(seq.length - 1, (u * seq.length) | 0)];
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
    // hit-tick white silhouettes of booped cats (ink-outlined), over the first frames of their pop
    for (let i = 0; i < this.nGhosts; i++) {
      const h = this.ghosts[i], base = spriteCanvas(h.sprite, 0, false), wht = spriteCanvas(h.sprite, 0, true);
      if (!base || !wht) continue;
      const sx = h.x - (base.width >> 1), sy = h.y - (base.height >> 1), ink = silhouette(base, PALETTE[0]);
      ctx.drawImage(ink, sx - 1, sy); ctx.drawImage(ink, sx + 1, sy); ctx.drawImage(ink, sx, sy - 1); ctx.drawImage(ink, sx, sy + 1);
      ctx.drawImage(wht, sx, sy);
    }
    // floating score text: pops in white, settles to its tier color, blinks out
    const camX = Math.round(this.g.mods.player?.camera?.x ?? 0);
    for (let i = 0; i < this.nTexts; i++) {
      const t = this.texts[i];
      if (t.life < 12 && ((t.life >> 1) & 1)) continue;
      const big = t.popT > 0 && t.bw > 0;
      const cv = big ? t.big : t.max - t.life < 4 ? t.pop : t.cv; if (!cv) continue;
      const w = big ? t.bw : t.w, h = big ? t.bh : t.h, half = w >> 1;
      const x = Math.max(camX + 2 + half, Math.min(camX + PF_W - 2 - half, t.x));
      ctx.drawImage(cv, 0, 0, w, h, x - half, Math.round(t.y) - (h >> 1), w, h);
    }
    // 'BOOPED!' banner: integer-scale bounce in over 6 frames, hold, blink out
    const b = this.banner;
    if (b.t >= 0 && !(b.t > 84 && (b.t & 2))) {
      // hand-drawn 1x ribbon banner: drops in, flashes white for 2 frames, bounces, then bobs by 1px
      const BY = [-18, -11, -4, 3, 1, 0];
      const oy = b.t < 6 ? BY[b.t] : ((b.t >> 4) & 1);
      const cv = bannerCanvas(b.t < 2);
      const half = BANNER_W >> 1;
      const x = Math.max(camX + 2 + half, Math.min(camX + PF_W - 2 - half, b.x));
      const y = Math.max(BANNER_TOP, b.y - (BANNER_H >> 1) + oy);
      ctx.drawImage(cv, x - half, y);
    }
  }

  overlay(g: Game, ctx: CanvasRenderingContext2D) {
    if (this.flashT <= 0 || g.paused) return;
    // palette-legal stepped flash: 50% checker -> 25% grid -> 12% sprinkle of the flash color, playfield only
    // gentle by design: never denser than a 25% grid, stepping down to 12.5% (photosensitivity-friendly)
    const u = this.flashT / this.flashMax;
    ctx.drawImage(ditherCanvas(PALETTE[this.flashC] ?? PALETTE[6], PF_W, H, u > 0.5 ? 4 : 8), PF_X, 0);
  }

  /** count of live particles (for tests/budget checks) */
  liveCount() { return this.nParts; }
}
export const makeEffects = (): Module => new Effects();
