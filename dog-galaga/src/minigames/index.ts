import type { Game, Module } from '../core/game';
import { PF_X, PF_W } from '../core/game';
import type { BonusDef } from '../core/types';
import { PALETTE } from '../core/palette';
import { Rng } from '../core/rng';
import { text, textWidth } from '../art/font';
import { drawSprite } from '../art/sprite';
import { C, rect, frame, dither, scanlines, chamferFill, chamferLine, darkOf, lighter, hintRow, keys, type Device } from '../ui/draw';
import { display, displayWidth, displayCovers, star, DISPLAY_H, type Scheme } from './display';

/**
 * Treat Bonanza: Galaga-style challenging stages. Cats fly scripted patterns (run by interaction.startBonus)
 * and never attack. This module owns the orchestration around them:
 *
 *   intro    banner sweeps open with the stage's own name + flight-plan hint, 3-2-1 reticle countdown
 *   fly      live hit counter docked at the top of the playfield (HUD toasts are held: the HUD belongs to
 *            the bonus while it runs); GO! burst
 *   results  Galaga results board: NUMBER OF HITS, BONUS (the score follows the count), or PERFECT! +
 *            SPECIAL BONUS with fanfare and pixel confetti drawn above the board. Fire / A / tap skips the tail.
 *
 * It always ends and hands control back (bonus:end), even if interaction misbehaves: a fast path when no
 * flight is running, a fly watchdog for a stalled one, a hard overall cap, and a guard for the scene being
 * changed underneath it.
 */

type St = 'idle' | 'intro' | 'fly' | 'results';

const INTRO = 168;            // ticks: banner + countdown on the first visit; cats launch when it ends
const COUNT_AT = 66;          // countdown "3" appears (first visit)
const COUNT_AT_REPEAT = 34;   // repeat visits: no typed title, no rules line, straight to the count
const SKIP_AT = 40;           // fire / confirm after this jumps the briefing straight to the countdown
const BEAT = 30;              // ticks per countdown number
const GO_T = 20;              // GO! burst lingers into the fly phase (short: the cats are entering)
const GO_R = 60;              // GO! rings stop growing here, well clear of the entry lanes
const PERFECT_BONUS = 10000;
const PER_HIT = 100;
const HARD_CAP = 60 * 90;     // nothing in a bonus stage may take longer than 90 s (pause excluded)
const NO_FLIGHT = 90;         // fly ticks without a running interaction flight before the results open anyway
const CCY = 226;              // countdown reticle / GO! centre (screen y)
/** Timing contract, exported for the watchdog tests. */
export const BONUS_TIMING = { INTRO, NO_FLIGHT, HARD_CAP, RESULTS_MAX: 26 + 60 + 26 + 40 + 240 };    // dark green: the GO! outline

/** Results board timeline, computed once when the results open. */
interface Board { hits: number; total: number; bonus: number; perfect: boolean; hitsAt: number; roll: number; bonusAt: number; bonusRoll: number; doneAt: number; end: number; H: number }
/** Overlay confetti: pixel bits that tumble above the results board. */
interface Bit { x: number; y: number; vx: number; vy: number; c: string; k: number; life: number; tint: string }
const RAINBOW = [C.hot, C.orange, C.gold, C.lime, C.line, C.violet];

const plural = (s: string, n: number) => n === 1 ? s : s.endsWith('Y') ? s.slice(0, -1) + 'IES' : s + 'S';

/** Flight-plan hints per bonus pattern: label + a tiny path used for the briefing glyph. */
type Path = (u: number) => [number, number];
const PLANS: Record<string, { hint: string; path: Path }> = {
  figure8: { hint: 'FIGURE-EIGHT LOOPS', path: u => [Math.sin(u * Math.PI * 2), Math.sin(u * Math.PI * 4) * 0.8] },
  spiral: { hint: 'SPIRAL DIVE', path: u => { const r = 0.15 + u * 0.85; const a = u * Math.PI * 5; return [Math.cos(a) * r, Math.sin(a) * r]; } },
  cross: { hint: 'CRISS-CROSS RUNS', path: u => u < 0.5 ? [-1 + u * 4, -1 + u * 4] : [1 - (u - 0.5) * 4, -1 + (u - 0.5) * 4] },
};
const plan = (p: string | undefined) => PLANS[p ?? ''] ?? { hint: 'SCRIPTED FLYBY', path: ((u: number) => [Math.cos(u * Math.PI * 2), Math.sin(u * Math.PI * 2) * 0.6]) as Path };

class Minigames implements Module {
  id = 'minigames';
  api = this;
  g!: Game;
  st: St = 'idle';
  t = 0;                  // ticks in the current state
  countAt = COUNT_AT;     // this stage's countdown start (shorter on repeat visits)
  intro = INTRO;          // this stage's intro length
  repeat = false;         // the player has seen a bonus stage before (flag bonus_seen)
  all = 0;                // ticks since the bonus started (hard cap)
  def: BonusDef | null = null;
  hits = 0;               // own count from cat:boop (fallback if interaction loses its tally)
  pop = 0;                // hit counter pop animation
  flyLimit = 0;
  noFlight = 0;           // consecutive fly ticks with no interaction flight running
  board: Board | null = null;
  shown = { hits: 0, bonus: 0 };
  added = 0;              // bonus points already handed to the score
  revealed = false;       // perfect flag set + held toasts released
  mutedToasts = false;    // we muted the HUD toasts (and so must unmute them)
  resultFromBus = false;
  bits: Bit[] = [];
  gHits: number[] = [];   // per-squadron hits when cat:boop carries a group index (else strips fill in order)
  byGroup = false;
  gFlash: number[] = [];  // per-squadron completion flash countdown (strip white + "+8")
  rng = new Rng(0xb0a7);  // cosmetic only: never touches the game's seeded stream
  /** showcase pinning: ?showcase=bonus&phase=intro|fly|results|perfect&at=<tick>[&hits=N (fly: tally set 3 ticks before the pin)] */
  demo: { phase: string; at: number; repeat: boolean; hits: number } | null = null;

  init(g: Game) {
    this.g = g;
    if (!g.headless && typeof location !== 'undefined') {
      const p = new URLSearchParams(location.search); const sc = p.get('showcase');
      if ((sc === 'bonus' || sc === 'minigames') && p.get('phase')) this.demo = { phase: p.get('phase')!, at: +(p.get('at') ?? -1), repeat: p.get('repeat') === '1', hits: +(p.get('hits') ?? -1) };
    }
    g.bus.on('cat:boop', (p: any) => {
      if (this.st !== 'fly' || !p?.bonus) return;
      this.hits++; this.pop = 10;
      const gi = Number.isInteger(p.group) ? p.group : -1;
      if (gi >= 0 && gi < 32) { this.byGroup = true; this.gHits[gi] = (this.gHits[gi] ?? 0) + 1; }
    });
    g.bus.on('bonus:result', (p: any) => {
      if (this.st !== 'fly') return;          // stale, duplicate or our own echo: the watchdog/intro own the flow
      this.resultFromBus = true;
      this.openResults(+p?.hits, +p?.total);
    });
  }

  /** Total cats in this stage, from interaction if it knows, else from the content def. */
  total(): number { return this.g.mods.interaction?.bonus?.total ?? this.board?.total ?? (this.def ? this.def.groups * 8 : 0); }
  liveHits(): number { return Math.max(this.hits, this.g.mods.interaction?.bonus?.hits ?? 0); }
  /** True while a Treat Bonanza is running (intro, flight or results). */
  active() { return this.st !== 'idle'; }

  startBonus(id: string) {
    const g = this.g;
    if (this.st !== 'idle') return;          // one stage at a time: never restart or double-report a running one
    const def = g.content.bonus.find(b => b.id === id);
    if (!def) { g.bus.emit('bonus:end', { id, hits: 0, total: 0 }); return; }
    this.def = def; this.hits = 0; this.pop = 0; this.board = null; this.all = 0; this.noFlight = 0;
    this.added = 0; this.revealed = false; this.bits = []; this.resultFromBus = false;
    this.gHits = []; this.byGroup = false; this.gFlash = [];
    this.flyLimit = def.groups * 140 + 60 * 30;
    this.repeat = !!g.state.flags?.bonus_seen || !!this.demo?.repeat;
    this.countAt = this.repeat ? COUNT_AT_REPEAT : COUNT_AT; this.intro = this.countAt + 3 * BEAT + 12;
    g.setScene('bonus');
    this.muteToasts(true);
    g.bus.emit('bonus:start', { id });
    try { g.mods.interaction?.clearAll(); } catch (e) { g.reportError('minigames', e); }
    this.go('intro');
    if (this.demo && (this.demo.phase === 'results' || this.demo.phase === 'perfect')) {
      const tot = def.groups * 8; this.go('fly'); this.openResults(this.demo.phase === 'perfect' ? tot : this.demo.hits >= 0 ? this.demo.hits : Math.round(tot * 0.7), tot);
    }
  }

  private go(st: St) { this.st = st; this.t = 0; }

  /** The HUD belongs to the bonus while it runs: toasts are held from the start until the score is revealed. */
  private muteToasts(on: boolean) {
    try {
      const ui = this.g.mods.ui; if (!ui?.muteToasts) return;
      if (on) { if (ui.toastsMuted) return; ui.muteToasts(true); this.mutedToasts = true; }
      else if (this.mutedToasts) { ui.muteToasts(false); this.mutedToasts = false; }
    } catch { /* cosmetic */ }
  }

  private launch() {
    const g = this.g; this.go('fly'); this.noFlight = 0;
    try { g.mods.interaction.startBonus(this.def); }
    catch (e) { g.reportError('minigames', e); this.openResults(this.liveHits(), this.total()); }
  }

  private openResults(hits: number, total: number) {
    const g = this.g;
    try { if (g.mods.interaction?.mode === 'bonus') g.mods.interaction.clearAll(); } catch { /* never block the results */ }
    total = Number.isFinite(total) && total > 0 ? Math.floor(total) : this.total();
    hits = Math.max(0, Math.min(total, Number.isFinite(hits) ? Math.floor(hits) : this.liveHits()));
    const perfect = total > 0 && hits === total; const bonus = perfect ? PERFECT_BONUS : hits * PER_HIT;
    const hitsAt = 26, roll = Math.min(60, hits * 2), bonusAt = hits === 0 ? hitsAt + 8 : hitsAt + roll + 26, bonusRoll = perfect ? 0 : (bonus > 0 ? 40 : 0);
    const doneAt = bonusAt + bonusRoll + (perfect ? 60 : 14);
    this.board = { hits, total, bonus, perfect, hitsAt, roll, bonusAt, bonusRoll, doneAt, end: bonusAt + bonusRoll + (perfect ? 240 : 150), H: perfect ? 168 : 128 };
    this.shown = { hits: 0, bonus: 0 };
    this.go('results');
    // the results stinger is keyed off bonus:result: echo it when the watchdog / a throw opened the board
    if (!this.resultFromBus) { try { g.bus.emit('bonus:result', { id: this.def?.id, hits, total, synthetic: true }); } catch { /* cosmetic */ } }
    this.resultFromBus = false;
  }

  /** Hand the score its bonus points up to `upto` (the BONUS row counts, the score follows). */
  private pay(upto: number) {
    const d = Math.round(upto) - this.added; if (d <= 0) return;
    this.added += d; try { this.g.ops.addScore(d); } catch (e) { this.g.reportError('minigames', e); }
  }
  /** Reveal: the perfect flag (quest) and any held toasts arrive with the BONUS line, never before. */
  private reveal() {
    if (this.revealed) return; this.revealed = true;
    this.muteToasts(false);
    if (this.board?.perfect) { try { this.g.ops.setFlag('perfect_bonus'); } catch (e) { this.g.reportError('minigames', e); } }
  }

  private finish() {
    const g = this.g; const b = this.board; const id = this.def?.id;
    const hits = b?.hits ?? this.liveHits(), total = b?.total ?? this.total();
    if (b) { this.pay(b.bonus); this.reveal(); }
    this.muteToasts(false);
    this.st = 'idle'; this.t = 0; this.board = null; this.bits = [];
    try { g.ops.setFlag('bonus_seen'); } catch { /* cosmetic: only shortens the next intro */ }
    if (g.state.scene === 'bonus') g.setScene('play');
    g.bus.emit('bonus:end', { id, hits, total });
  }

  /** Throw-safe sfx/effects helpers: a missing module must never stall the stage. */
  private sfx(id: string) { try { this.g.mods.audio?.sfx(id); } catch { /* cosmetic */ } }
  private fx(fn: (e: any, camX: number) => void) {
    try { const e = this.g.mods.effects; if (e) fn(e, this.g.mods.player?.camera?.x ?? 32); } catch { /* cosmetic */ }
  }

  update(g: Game) {
    if (g.paused || this.st === 'idle') return;
    const sc = g.state.scene;
    if (sc !== 'bonus') {
      if (sc === 'dialogue') return;                    // parked; resumes when the conversation closes
      if (sc === 'play') { this.finish(); return; }      // someone else ended the stage: still report back
      this.st = 'idle'; this.board = null; this.bits = []; this.muteToasts(false); return;   // title / map / ending: drop
    }
    // demo pinning freezes the presentation at a chosen tick (showcase screenshots only)
    const d = this.demo;
    const pinned = !!d && d.at >= 0 && this.t >= d.at && (d.phase === this.st || (d.phase === 'perfect' && this.st === 'results'));
    const holdResults = !!d && this.st === 'results' && !!this.board && this.t >= this.board.end - 20;
    if (!pinned && !holdResults) this.t++;
    this.all++;
    if (!pinned) { if (this.pop > 0) this.pop--; for (let i = 0; i < this.gFlash.length; i++) if (this.gFlash[i] > 0) this.gFlash[i]--; }
    if (d && d.hits >= 0 && this.st === 'fly' && this.t === Math.max(1, d.at - 3)) { this.hits = d.hits; this.pop = 10; }   // showcase: pin a tally
    if (this.st === 'fly') {
      const have = this.groupHave(); 
      for (let i = 0; i < have.length; i++) if (have[i] >= 8 && this.gFlash[i] === undefined) { this.gFlash[i] = 36; this.sfx('pickup'); }
    }
    if (!pinned) this.stepBits();

    if (this.st === 'intro') {
      // the briefing is skippable: fire / confirm jumps straight to the 3-2-1 (never past it)
      if (!d && this.t > SKIP_AT && this.t < this.countAt && (g.input.pressed('fire') || g.input.pressed('confirm'))) this.t = this.countAt;
      for (let k = 0; k < 3; k++) if (this.t === this.countAt + k * BEAT) this.sfx('blip');
      if (this.t === this.countAt + 3 * BEAT) this.sfx('select');
      if (this.t >= this.intro) this.launch();
    } else if (this.st === 'fly') {
      this.noFlight = g.mods.interaction?.mode === 'bonus' ? 0 : this.noFlight + 1;
      if (this.noFlight > NO_FLIGHT || this.t > this.flyLimit || this.all > HARD_CAP) {   // watchdog: no report back
        if (!g.headless) console.warn('[minigames] bonus watchdog fired');
        this.openResults(this.liveHits(), this.total());
      }
    } else if (this.st === 'results' && this.board) {
      const b = this.board; const t = this.t;
      if (t === 1) this.sfx('toast');
      if (t >= b.hitsAt && t <= b.hitsAt + b.roll) {
        const v = b.roll ? Math.round(b.hits * (t - b.hitsAt) / b.roll) : b.hits;
        if (v !== this.shown.hits && t % 2 === 0) this.sfx('blip');
        this.shown.hits = v;
      }
      if (t >= b.bonusAt) {
        if (b.perfect) {
          if (t === b.bonusAt) { this.pay(b.bonus); this.reveal(); this.sfx('quest'); this.fx(e => { e.flash('f', 6); e.shake(2, 8); }); this.cannon(28); }
          if (!pinned && (t === b.bonusAt + 40 || t === b.bonusAt + 80 || t === b.bonusAt + 120)) { this.cannon(18); this.sfx('pickup'); }
          // confetti cannons from the bottom of the clear side columns (never under the board) and hearts on Pom
          for (const [dt, sx, fy] of [[8, 20, 330], [16, PF_W - 20, 330]] as const)
            if (t === b.bonusAt + dt) this.fx((e, camX) => e.burst(camX + sx, fy, 'confetti'));
          if (t === b.bonusAt + 24) this.fx(e => { const P = g.mods.player?.pos?.(); if (P) e.burst(P.x, P.y - 8, 'hearts'); });
          this.shown.bonus = b.bonus;
        } else {
          if (t === b.bonusAt) this.reveal();
          if (b.bonusRoll) {
            const v = Math.round(b.bonus * Math.min(1, (t - b.bonusAt) / b.bonusRoll) / 10) * 10;
            if (v !== this.shown.bonus && t % 3 === 0) this.sfx('blip');
            if (v === b.bonus && this.shown.bonus !== b.bonus) this.sfx('pickup');
            this.shown.bonus = v; this.pay(v);
          }
        }
      }
      // once everything is counted, fire / A / a tap skips the tail
      if (!d && t > b.doneAt && t < b.end - 14 && (g.input.pressed('fire') || g.input.pressed('confirm'))) { this.sfx('select'); this.t = b.end - 14; }
      if (this.t >= b.end) this.finish();
    }
    if ((this.st as St) !== 'idle' && !d && this.all > HARD_CAP + 600) this.finish();   // belt and braces
  }

  // ------------------------------------------------------------------ overlay confetti

  /** Fire `n` bits: half pop up from the board's top edge, half rain down the two clear side columns. */
  private cannon(n: number) {
    const r = () => this.rng.next(); const bx = PF_X + PF_W / 2 - 152, by = 64;
    const cols = [C.gold, C.hot, C.line, C.lime, C.violet, C.pink, C.orange]; const tints = ['f', 'l', 'c', 'i', 't'];
    for (let i = 0; i < n; i++) {
      const c = cols[Math.floor(r() * cols.length)]; const k = r() < 0.18 ? 3 : Math.floor(r() * 3); const tint = tints[Math.floor(r() * tints.length)];
      if (i % 2 === 0) this.bits.push({ x: bx + 8 + r() * 288, y: by, vx: (r() - 0.5) * 2.4, vy: -1.4 - r() * 2.4, c, k, life: 150 + Math.floor(r() * 60), tint });
      else {
        const x = i % 4 === 1 ? PF_X + 6 + r() * 30 : PF_X + PF_W - 36 + r() * 30;
        this.bits.push({ x, y: -6 - r() * 30, vx: (r() - 0.5) * 0.6, vy: 0.6 + r() * 1.0, c, k, life: 300, tint });
      }
    }
    if (this.bits.length > 120) this.bits.splice(0, this.bits.length - 120);
  }
  private stepBits() {
    if (!this.bits.length) return;
    const out: Bit[] = [];
    for (const p of this.bits) {
      p.vy = Math.min(1.6, p.vy + 0.05); p.vx *= 0.985; p.x += p.vx + Math.sin((p.life + p.k * 17) / 9) * 0.25; p.y += p.vy; p.life--;
      if (p.life > 0 && p.y < 370) out.push(p);
    }
    this.bits = out;
  }
  private drawBits(ctx: CanvasRenderingContext2D, T: number, keep: { x: number; y: number; w: number; h: number }) {
    for (const p of this.bits) {
      const x = Math.round(p.x), y = Math.round(p.y); if (x < PF_X + 1 || x > PF_X + PF_W - 4) continue;
      const R = p.k === 3 ? 5 : 3;
      if (x + R > keep.x && x - R < keep.x + keep.w && y + R > keep.y && y - R < keep.y + keep.h) continue;   // off the board
      if (p.life < 20 && (T & 2)) continue;              // fade = blink out
      const ph = ((T >> 2) + p.k + Math.floor(p.x)) & 3;
      if (p.k === 3) { if (x > PF_X + 5 && x < PF_X + PF_W - 6) star(ctx, x, y, ph >> 1, p.tint); continue; }
      // tumbling ribbon with a highlight pixel: 3x2 face-on, 2x3 side-on, 3x1 edge-on
      const hi = lighter(p.c);
      if (ph === 0 || ph === 2) { rect(ctx, x - 1, y, 3, 2, ph ? darkOf(p.c) : p.c); rect(ctx, x - 1, y, 1, 1, hi); }
      else if (ph === 1) { rect(ctx, x, y - 1, 2, 3, p.c); rect(ctx, x, y - 1, 1, 1, hi); }
      else rect(ctx, x - 1, y, 3, 1, hi);
    }
  }

  // ------------------------------------------------------------------ presentation (pixel exact)

  overlay(g: Game, ctx: CanvasRenderingContext2D) {
    if (this.st === 'idle' || g.state.scene !== 'bonus') return;
    const T = g.tick;
    if (this.st === 'intro') this.drawIntro(ctx, T);
    if (!g.paused && (this.st === 'fly' || (this.st === 'intro' && this.t > this.intro - 24))) this.drawCounter(ctx, T);
    if (this.st === 'fly' && this.t < GO_T) this.drawGo(ctx, this.t);
    if (this.st === 'results') this.drawResults(ctx, T);
  }

  /** Text with a 1px outline (8 neighbours) plus a drop shadow, so it reads over any backdrop. */
  private outlined(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, c: string, dark: string, scale = 1, shadow: string | null = dark) {
    const o = { align: 'center' as const, scale };
    if (shadow) text(ctx, s, x, y + scale + 1, shadow, o);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) text(ctx, s, x + dx, y + dy, dark, o);
    text(ctx, s, x, y, c, o);
  }

  /**
   * Pixel annulus r0..r1 (inclusive). One shared rasterizer, so fills and rims never leave gaps. Optionally cut
   * into `n` arcs covering `frac` of their slot, rotated by `phase` radians. Drawn as horizontal runs.
   */
  private annulus(ctx: CanvasRenderingContext2D, cx: number, cy: number, r0: number, r1: number, c: string, n = 0, frac = 1, phase = 0) {
    ctx.fillStyle = c; cx = Math.round(cx); cy = Math.round(cy);
    const o2 = (r1 + 0.5) ** 2, i2 = r0 > 0 ? (r0 - 0.5) ** 2 : -1; const slot = n ? Math.PI * 2 / n : 0;
    for (let dy = -r1; dy <= r1; dy++) {
      let run = NaN;
      for (let dx = -r1; dx <= r1 + 1; dx++) {
        const d2 = dx * dx + dy * dy; let on = dx <= r1 && d2 <= o2 && d2 >= i2;
        if (on && n) { let a = Math.atan2(dy, dx) - phase; a = ((a % slot) + slot) % slot; on = a < slot * frac; }
        if (on && Number.isNaN(run)) run = dx;
        else if (!on && !Number.isNaN(run)) { ctx.fillRect(cx + run, cy + dy, dx - run, 1); run = NaN; }
      }
    }
  }

  /** Full-width neon band: grows open from its centre line, closes at the end. */
  private band(ctx: CanvasRenderingContext2D, cy: number, hFull: number, open: number, accent: string, T: number) {
    const h = Math.max(2, Math.round(hFull * open) & ~1); const y = cy - h / 2; const x0 = PF_X, w = PF_W;
    dither(ctx, x0, y - 6, w, 6, C.ink, 'sparse');                     // soft dithered falloff above/below
    dither(ctx, x0, y + h, w, 6, C.ink, 'sparse');
    rect(ctx, x0, y, w, h, C.night);
    dither(ctx, x0, y + 2, w, h - 4, C.indigo, 'sparse');
    scanlines(ctx, x0, y + 2, w, h - 4);
    rect(ctx, x0, y, w, 1, darkOf(accent)); rect(ctx, x0, y + 1, w, 1, accent);
    rect(ctx, x0, y + h - 2, w, 1, accent); rect(ctx, x0, y + h - 1, w, 1, darkOf(accent));
    if (h < 14) return;
    // marching chevrons along both rails
    for (let i = -1; i < w / 12 + 1; i++) {
      const xx = x0 + i * 12 + ((T >> 1) % 12);
      if (xx < x0 + 10 || xx > x0 + w - 16) continue;
      for (let k = 0; k < 3; k++) { rect(ctx, xx + k, y + 3 + k, 2, 1, darkOf(accent)); rect(ctx, xx + k, y + h - 4 - k, 2, 1, darkOf(accent)); }
    }
    // end caps: bright brackets hugging the playfield edges
    rect(ctx, x0 + 4, y + 6, 1, h - 12, accent); rect(ctx, x0 + 4, y + 6, 4, 1, accent); rect(ctx, x0 + 4, y + h - 7, 4, 1, accent);
    rect(ctx, x0 + w - 5, y + 6, 1, h - 12, accent); rect(ctx, x0 + w - 8, y + 6, 4, 1, accent); rect(ctx, x0 + w - 8, y + h - 7, 4, 1, accent);
  }

  /** Flight-plan glyph: the stage's path as a dotted trace in a small chip, with a gold "cat" running along it. */
  private planGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, T: number) {
    const p = plan(this.def?.pattern);
    chamferFill(ctx, x, y, w, h, C.ink, 2); chamferLine(ctx, x, y, w, h, C.deep, 2);
    const ax = x + w / 2, ay = y + h / 2, sx = (w - 8) / 2, sy = (h - 6) / 2; const N = 64;
    for (let i = 0; i < N; i += 2) { const [u, v] = p.path(i / N); rect(ctx, Math.round(ax + u * sx), Math.round(ay + v * sy), 1, 1, C.peri); }
    for (let k = 2; k >= 0; k--) {   // the runner with a short trail
      const [u, v] = p.path((((T - k * 3) / 140) % 1 + 1) % 1);
      if (k) rect(ctx, Math.round(ax + u * sx), Math.round(ay + v * sy), 1, 1, C.burnt);
      else rect(ctx, Math.round(ax + u * sx) - 1, Math.round(ay + v * sy) - 1, 2, 2, C.gold);
    }
  }

  private drawIntro(ctx: CanvasRenderingContext2D, T: number) {
    const t = this.t; const cx = PF_X + PF_W / 2; const def = this.def!;
    const I = this.intro; const open = t < 14 ? t / 14 : t > I - 14 ? Math.max(0, (I - t) / 14) : 1;
    const CY = 124, BH = 108;
    this.band(ctx, CY, BH, open, C.gold, T);
    if (open < 1) return;
    const top = CY - BH / 2;
    // tag line: stage number in a chamfered chip
    const n = this.g.content.bonus.indexOf(def) + 1;
    const tag = `BONUS STAGE ${String(Math.max(1, n)).padStart(2, '0')}`;
    const tw = textWidth(tag) + 12;
    chamferFill(ctx, cx - tw / 2, top + 7, tw, 11, C.deep, 3); chamferLine(ctx, cx - tw / 2, top + 7, tw, 11, C.line, 3);
    text(ctx, tag, cx, top + 9, C.ice, { align: 'center' });
    // the stage's own name types in letter by letter, the newest letter flashing white
    // the stage's own name in the display face, revealed by a masked wipe left to right (its final position
    // never moves) with a bright scan bar riding the wipe edge
    this.title(ctx, (def.name || 'Treat Bonanza').toUpperCase() + '!', cx, top + 24, this.repeat ? 1 : Math.max(0, Math.min(1, (t - 10) / 26)));
    // briefing lines
    const L = this.repeat ? 14 : 40;   // briefing reveal (repeat visits: at once, and without the rules line)
    if (t > L) {
      const tot = def.groups * 8; const ed = this.g.content.enemies.find(e => e.id === def.breed);
      const nm = (ed?.name ?? def.breed).toUpperCase();
      text(ctx, `${tot} ${plural(nm, tot)} INBOUND`, cx, top + 56, C.pink, { align: 'center', shadow: C.ink });
      if (!this.repeat && t > 48) text(ctx, 'THEY WON\'T FIGHT BACK. BOOP THEM ALL!', cx, top + 70, C.text, { align: 'center', shadow: C.ink });
      if (t > L + 16) {   // flight plan: tiny path glyph + hint, centred as one unit
        const hint = `FLIGHT PLAN: ${plan(def.pattern).hint}`; const gw = 30, uw = gw + 6 + textWidth(hint);
        const ux = Math.round(cx - uw / 2);
        const py = this.repeat ? top + 72 : top + 83;
        this.planGlyph(ctx, ux, py, gw, 15, T);
        text(ctx, hint, ux + gw + 6, py + 4, C.ice, { shadow: C.ink });
      }
      if (ed?.sprite) {   // breed mugshots flanking the briefing
        const bob = (T >> 4) & 1;
        drawSprite(ctx, ed.sprite, PF_X + 30, top + 64 + bob);
        drawSprite(ctx, ed.sprite, PF_X + PF_W - 30, top + 64 + (bob ^ 1), { flipX: true });
      }
    }
    // skip hint under the band while the briefing reads (first visit only: repeat visits are already short)
    if (!this.repeat && t > SKIP_AT && t < this.countAt && (T >> 4) % 4 !== 3)
      hintRow(ctx, [[keys(this.dev()).fire, 'SKIP']], cx, CY + BH / 2 + 12, C.gold);
    // countdown: 3, 2, 1 inside a spinning targeting reticle
    const ct = t - this.countAt;
    if (ct >= 0 && ct < 3 * BEAT) {
      const k = Math.floor(ct / BEAT); const lt = ct % BEAT; const num = String(3 - k);
      const ccx = cx, ccy = CCY;
      const acc = [C.line, C.violet, C.hot][k];
      this.annulus(ctx, ccx, ccy, 0, 26, C.night);
      this.annulus(ctx, ccx, ccy, 25, 26, darkOf(acc));
      this.annulus(ctx, ccx, ccy, 29, 30, acc, 6, 0.55, T * 0.04);
      this.annulus(ctx, ccx, ccy, 33, 34, darkOf(acc), 4, 0.3, -T * 0.03);
      if (lt < 8 && !(lt & 1)) { const r = 27 + lt * 2; this.annulus(ctx, ccx, ccy, r, r + 1, lighter(acc)); }   // beat shockwave
      const sch: Scheme = lt < 2 ? 'flash' : (['ice', 'violet', 'hot'] as const)[k];
      display(ctx, num, ccx, ccy - DISPLAY_H - 3 + (lt < 2 ? -1 : 0), sch, { scale: 2, align: 'center' });
      for (let i = 0; i < 3; i++) rect(ctx, ccx - 10 + i * 8, ccy + 17, 5, 2, i <= k ? acc : C.indigo);   // beat pips, inside the disc
    }
  }

  /** GO! burst in the first ticks of the flight: big outlined word and expanding 2px arc rings. */
  private drawGo(ctx: CanvasRenderingContext2D, t: number) {
    const cx = PF_X + PF_W / 2, cy = CCY;
    if (t > GO_T - 10 && (t & 2)) return;            // blinks out
    for (let i = 0; i < 2; i++) { const r = Math.min(GO_R - i * 12, 24 + t * 3 - i * 12); if (r > 8) this.annulus(ctx, cx, cy, r, r + 1, i ? C.lime : C.cream, 12, 0.6, t * 0.05); }
    display(ctx, 'GO!', cx, cy - DISPLAY_H - (t < 3 ? 1 : 0), t < 3 ? 'flash' : 'lime', { scale: 2, align: 'center' });
  }

  /** Hits per squadron strip: real squadrons when cat:boop carries `group`, else strips fill in order. */
  private groupHave(): number[] {
    const groups = Math.max(1, Math.ceil(this.total() / 8)); const hits = this.liveHits(); const out: number[] = [];
    for (let gi = 0; gi < groups; gi++) out.push(this.byGroup ? Math.min(8, this.gHits[gi] ?? 0) : Math.max(0, Math.min(8, hits - gi * 8)));
    return out;
  }

  /**
   * Live hit counter docked at the top of the playfield on a slim chamfered ink plate: the count in the display
   * face (07), a small HITS / of-40 stack, then one pip per cat grouped by squadron. A squadron completed flashes
   * its whole strip white and drops a +8 tick under the plate.
   */
  private drawCounter(ctx: CanvasRenderingContext2D, T: number) {
    const total = this.total(); const hits = this.liveHits(); const have = this.groupHave(); const groups = have.length;
    const cw = 4, ch = 4, gap = 6, gw = 8 * (cw + 1) - 1; const cellsW = groups * gw + (groups - 1) * gap;
    const num = String(hits).padStart(2, '0'); const nw = displayWidth(num); const lw = Math.max(textWidth('HITS'), textWidth(`/${total}`));
    const inner = nw + 5 + lw + 9 + cellsW; const W = inner + 16, H = 21;
    const cx = PF_X + PF_W / 2; const x = Math.round(cx - W / 2), y = 2;
    chamferFill(ctx, x, y, W, H, C.ink, 4); chamferLine(ctx, x, y, W, H, C.indigo, 4);
    rect(ctx, x + 4, y, 8, 1, C.line2); rect(ctx, x + W - 12, y, 8, 1, C.line2);     // accent ticks on the top rail
    let ux = x + 8;
    display(ctx, num, ux, y + 4, this.pop > 6 ? 'flash' : 'gold');
    ux += nw + 5;
    text(ctx, 'HITS', ux, y + 3, C.ice); text(ctx, `/${total}`, ux, y + 11, C.peri);
    ux += lw + 9;
    rect(ctx, ux - 5, y + 4, 1, H - 8, C.indigo);                                    // divider
    const py = y + Math.round((H - ch) / 2);
    for (let gi = 0; gi < groups; gi++) {
      const gx = ux + gi * (gw + gap); const n = have[gi]; const full = n >= 8; const fl = this.gFlash[gi] ?? 0;
      const white = fl > 30 || (fl > 24 && (T & 2) === 0);
      rect(ctx, gx - 1, py - 1, gw + 2, ch + 2, white ? C.text : full ? darkOf(C.lime) : C.night);
      for (let i = 0; i < 8; i++) {
        const px = gx + i * (cw + 1);
        if (white) { rect(ctx, px, py, cw, ch, C.text); continue; }
        if (i < n) { const c = full ? C.lime : C.gold; rect(ctx, px, py, cw, ch, c); rect(ctx, px, py, cw, 1, lighter(c)); rect(ctx, px, py + ch - 1, cw, 1, darkOf(c)); }
        else { rect(ctx, px, py, cw, ch, C.indigo); rect(ctx, px, py, cw, 1, C.peri); }
      }
      if (fl > 0) {   // +8 tick drifting down under the plate
        const ty = y + H + 2 + Math.floor((36 - fl) / 6); const tx = gx + Math.floor(gw / 2);
        if (fl > 6 || (T & 2)) { for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) text(ctx, '+8', tx + dx, ty + dy, C.ink, { align: 'center' }); text(ctx, '+8', tx, ty, C.lime, { align: 'center' }); }
      }
    }
    if (this.pop > 0 && hits > 0 && !this.byGroup) {   // the newest pip sparkles
      const i = hits - 1; const px = ux + Math.floor(i / 8) * (gw + gap) + (i % 8) * (cw + 1);
      rect(ctx, px + 1, py - 3, 2, 1, C.text); rect(ctx, px + 1, py + ch + 2, 2, 1, C.text);
    }
  }

  /** Stage title in the display face (2x when it fits, shaded at native res), revealed by a masked wipe. */
  private title(ctx: CanvasRenderingContext2D, s: string, cx: number, y: number, reveal: number) {
    if (!displayCovers(s)) { this.outlined(ctx, s, cx, y + 4, C.gold, C.burnt, 2, C.ink); return; }
    const sc = displayWidth(s, 2) <= PF_W - 48 ? 2 : 1; const w = displayWidth(s, sc); const left = Math.round(cx - w / 2);
    const yy = sc === 2 ? y : y + 6;
    if (reveal >= 1) { display(ctx, s, left, yy, 'gold', { scale: sc }); return; }
    const edge = left - 2 + Math.round((w + 4) * reveal);
    display(ctx, s, left, yy, 'gold', { scale: sc, clip: edge });
    if (reveal > 0) { const hh = DISPLAY_H * sc + 6; rect(ctx, edge, yy - 3, 2, hh, C.text); rect(ctx, edge + 2, yy - 3, 1, hh, C.line); rect(ctx, edge - 1, yy - 3, 1, hh, C.cream); }
  }

  /** Device for prompts: ui's own resolver (the visible touch deck wins), else the last input device. */
  private dev(): Device {
    try { const d = this.g.mods.ui?.dev?.(); if (d) return d; } catch { /* fall through */ }
    if (this.g.state.settings?.touch === 'on') return 'touch';
    return (this.g.input.lastDevice ?? 'keyboard') as Device;
  }

  /** Chase-light marquee on the board rim: 2x2 lamps every 6px, palette-cycled rainbow running clockwise. */
  private marquee(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, T: number) {
    const pts: [number, number][] = [];
    for (let xx = x + 9; xx <= x + w - 11; xx += 6) pts.push([xx, y + 2]);
    for (let yy = y + 9; yy <= y + h - 11; yy += 6) pts.push([x + w - 4, yy]);
    for (let xx = x + w - 11; xx >= x + 9; xx -= 6) pts.push([xx, y + h - 4]);
    for (let yy = y + h - 11; yy >= y + 9; yy -= 6) pts.push([x + 2, yy]);
    const ph = T >> 2;
    pts.forEach(([px, py], i) => { const c = RAINBOW[((i - ph) % 6 + 6) % 6]; rect(ctx, px, py, 2, 2, c); if ((i - ph) % 6 === 0) rect(ctx, px, py, 1, 1, C.text); });
  }

  /** Mugshot: the breed at 1x (same pixel density as everything else) in a 36x36 chip, bobbing inside it. */
  private mugshot(ctx: CanvasRenderingContext2D, x: number, y: number, acc: string, T: number) {
    const ed = this.def ? this.g.content.enemies.find(e => e.id === this.def!.breed) : null;
    frame(ctx, x, y, 36, 36, acc, C.ink, 3);
    if (!ed?.sprite) return;
    ctx.save(); ctx.beginPath(); ctx.rect(x + 1, y + 1, 34, 34); ctx.clip();
    drawSprite(ctx, ed.sprite, x + 18, y + 18 + ((T >> 4) & 1)); ctx.restore();
  }

  private drawResults(ctx: CanvasRenderingContext2D, T: number) {
    const b = this.board; if (!b) return;
    const t = this.t; const cx = PF_X + PF_W / 2;
    const closing = b.end - t < 14 && !this.demo;
    const open = closing ? Math.max(0, (b.end - t) / 14) : Math.min(1, t / 12);
    const W0 = 304, H0 = b.H;
    const h = Math.max(4, Math.round(H0 * open) & ~1); const x = cx - W0 / 2, y = 64 + (H0 - h) / 2;
    const acc = b.perfect ? [C.gold, C.hot, C.line, C.lime][(T >> 3) & 3] : C.line;
    // one solid 2px ink drop shadow lifts the board off the scenery (no dim ring, no dither fringe)
    chamferFill(ctx, x + 2, y + 2, W0, h, C.ink, 6);
    const keep = { x: x - 2, y: y - 2, w: W0 + 6, h: h + 6 };   // confetti never lands on the board
    frame(ctx, x, y, W0, h, acc, C.night, 6);
    if (open < 1) { this.drawBits(ctx, T, keep); return; }
    scanlines(ctx, x + 2, y + 2, W0 - 4, h - 4);
    if (b.perfect && t >= b.bonusAt) this.marquee(ctx, x, y, W0, h, T);
    // header strip: the stage's name, a marching chevron run centred between the labels, RESULTS
    chamferFill(ctx, x + 10, y + 8, W0 - 20, 15, C.deep, 4);
    const nm = (this.def?.name ?? 'Treat Bonanza').toUpperCase();
    text(ctx, nm, x + 18, y + 12, C.ice);
    text(ctx, 'RESULTS', x + W0 - 18, y + 12, C.text, { align: 'right' });
    const a0 = x + 18 + textWidth(nm) + 10, a1 = x + W0 - 18 - textWidth('RESULTS') - 10;
    // thin scan rule between the labels: a dim 1px line with a bright segment sweeping along it
    if (a1 - a0 > 12) {
      const L = a1 - a0; rect(ctx, a0, y + 15, L, 1, C.line2); rect(ctx, a0, y + 14, 1, 3, C.line); rect(ctx, a1 - 1, y + 14, 1, 3, C.line);
      const sp = (T % (L + 24)) - 12; const s0 = Math.max(0, sp), s1 = Math.min(L, sp + 12);
      if (s1 > s0) { rect(ctx, a0 + s0, y + 15, s1 - s0, 1, C.ice); }
    }
    this.mugshot(ctx, x + 14, y + 29, b.perfect ? C.gold : C.line, T);
    const LX = x + 60, RX = x + W0 - 18;
    const row = (lbl: string, val: string, yy: number, c: string, live: boolean) => {
      text(ctx, lbl, LX, yy, C.text, { shadow: C.ink });
      for (let px = LX + textWidth(lbl) + 6; px < RX - textWidth(val) - 6; px += 4) rect(ctx, px, yy + 5, 2, 1, C.peri);   // leader dots
      text(ctx, val, RX, yy, live ? C.text : c, { align: 'right', shadow: C.ink });
    };
    if (t >= b.hitsAt) {
      row('NUMBER OF HITS', `${this.shown.hits}/${b.total}`, y + 32, C.gold, t <= b.hitsAt + b.roll);
      // one pip per cat; on a perfect the full bar turns lime and pulses (a highlight wave runs along it)
      {
        const total = Math.max(1, b.total); const cw = Math.max(2, Math.min(4, Math.floor((RX - LX) / total) - 1));
        const sw = total * (cw + 1) - 1; const sx = RX - sw; const lit = b.perfect && t >= b.bonusAt;
        rect(ctx, sx - 1, y + 43, sw + 2, 5, C.ink);
        for (let i = 0; i < total; i++) {
          const on = i < this.shown.hits; const wave = lit && Math.abs(i - ((T >> 1) % (total + 12) - 6)) < 3;
          const c = on ? (lit ? (wave ? C.cream : C.lime) : C.gold) : C.indigo;
          rect(ctx, sx + i * (cw + 1), y + 44, cw, 3, c); rect(ctx, sx + i * (cw + 1), y + 44, cw, 1, on ? lighter(c) : C.peri);
        }
      }
    }
    const prompt = (yy: number) => {
      if (t <= b.doneAt || (T >> 4) % 4 === 3) return;
      hintRow(ctx, [[keys(this.dev()).fire, 'CONTINUE']], cx, yy, b.perfect ? C.gold : C.line);
    };
    if (t >= b.bonusAt && !b.perfect) {
      row('BONUS', `${this.shown.bonus} PTS`, y + 58, C.pink, t < b.bonusAt + b.bonusRoll);
      if (t >= b.bonusAt + b.bonusRoll + 6) {
        const r = b.hits / Math.max(1, b.total);
        const msg = r >= 0.75 ? 'GREAT FLYING, CAPTAIN!' : r >= 0.4 ? 'NICE BOOPING!' : b.hits > 0 ? 'THE CATS GOT AWAY... NEXT TIME!' : 'NO TREATS THIS TIME!';
        text(ctx, msg, cx, y + 80, r >= 0.75 ? C.lime : C.violet, { align: 'center', shadow: C.ink });
        const miss = b.total - b.hits;
        text(ctx, `${miss} ${plural('CAT', miss)} SLIPPED THROUGH`, cx, y + 93, C.dim, { align: 'center' });
      }
      prompt(y + 108);
    }
    if (t >= b.bonusAt && b.perfect) {
      const pt = t - b.bonusAt;
      // PERFECT! in the display face: a 2-frame white impact at 3x, then it settles at 2x with a bounce;
      // a 2-tick white glint every 90 ticks keeps it alive
      const sc = pt < 2 ? 3 : 2; const wy = y + 56 - (pt < 2 ? 7 : 0) + (pt >= 2 && pt < 6 ? -(6 - pt) : 0);
      const sch: Scheme = pt < 4 || (pt > 30 && pt % 90 < 2) ? 'flash' : 'gold';
      display(ctx, 'PERFECT!', cx, wy, sch, { scale: sc, align: 'center' });
      if (pt >= 2) {   // twinkling stars flanking the word (clear of every text box)
        const half = displayWidth('PERFECT!', 2) / 2;
        const sp: [number, number, string][] = [[-half - 16, 6, 'f'], [-half - 28, 20, 'l'], [half + 16, 8, 'c'], [half + 28, 22, 'f']];
        sp.forEach(([dx, dy, tint], i) => { if (((T >> 3) + i) % 4 !== 3) star(ctx, cx + dx, wy + dy, ((T >> 2) + i) & 1, tint); });
      }
      if (pt > 20) {
        const sw = 220; chamferFill(ctx, cx - sw / 2, y + 98, sw, 15, C.burnt, 4); chamferLine(ctx, cx - sw / 2, y + 98, sw, 15, C.gold, 4);
        text(ctx, `SPECIAL BONUS ${b.bonus} PTS`, cx, y + 102, C.cream, { align: 'center' });
      }
      if (pt > 40) text(ctx, 'EVERY SINGLE CAT BOOPED!', cx, y + 120, C.pink, { align: 'center', shadow: C.ink });
      if (pt > 52) text(ctx, 'GOOD GIRL, POM. TAIL WAGS ALL ROUND.', cx, y + 134, C.dim, { align: 'center' });
      prompt(y + 150);
    }
    this.drawBits(ctx, T, keep);
  }
}

export const makeMinigames = (): Module => new Minigames();
