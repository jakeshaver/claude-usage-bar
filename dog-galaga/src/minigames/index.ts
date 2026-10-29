import type { Game, Module } from '../core/game';
import { PF_X, PF_W } from '../core/game';
import type { BonusDef } from '../core/types';
import { PALETTE } from '../core/palette';
import { Rng } from '../core/rng';
import { text, textWidth } from '../art/font';
import { drawSprite } from '../art/sprite';
import { C, rect, frame, dither, scanlines, chamferFill, chamferLine, darkOf, lighter, hintRow, keys } from '../ui/draw';

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

const INTRO = 168;            // ticks: banner + countdown; cats launch when it ends
const COUNT_AT = 66;          // countdown "3" appears
const BEAT = 30;              // ticks per countdown number
const GO_T = 34;              // GO! burst lingers into the fly phase
const PERFECT_BONUS = 10000;
const PER_HIT = 100;
const HARD_CAP = 60 * 90;     // nothing in a bonus stage may take longer than 90 s (pause excluded)
const NO_FLIGHT = 90;         // fly ticks without a running interaction flight before the results open anyway
const CCY = 226;              // countdown reticle / GO! centre (screen y)
const GREEN = PALETTE[20];    // dark green: the GO! outline

/** Results board timeline, computed once when the results open. */
interface Board { hits: number; total: number; bonus: number; perfect: boolean; hitsAt: number; roll: number; bonusAt: number; bonusRoll: number; doneAt: number; end: number; H: number }
/** Overlay confetti: pixel bits that tumble above the results board. */
interface Bit { x: number; y: number; vx: number; vy: number; c: string; k: number; life: number }

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
  rng = new Rng(0xb0a7);  // cosmetic only: never touches the game's seeded stream
  /** showcase pinning: ?showcase=bonus&phase=intro|fly|results|perfect&at=<tick> */
  demo: { phase: string; at: number } | null = null;

  init(g: Game) {
    this.g = g;
    if (!g.headless && typeof location !== 'undefined') {
      const p = new URLSearchParams(location.search); const sc = p.get('showcase');
      if ((sc === 'bonus' || sc === 'minigames') && p.get('phase')) this.demo = { phase: p.get('phase')!, at: +(p.get('at') ?? -1) };
    }
    g.bus.on('cat:boop', (p: any) => {
      if (this.st !== 'fly' || !p?.bonus) return;
      this.hits++; this.pop = 10;
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
    this.flyLimit = def.groups * 140 + 60 * 30;
    g.setScene('bonus');
    this.muteToasts(true);
    g.bus.emit('bonus:start', { id });
    try { g.mods.interaction?.clearAll(); } catch (e) { g.reportError('minigames', e); }
    this.go('intro');
    if (this.demo && (this.demo.phase === 'results' || this.demo.phase === 'perfect')) {
      const tot = def.groups * 8; this.go('fly'); this.openResults(this.demo.phase === 'perfect' ? tot : Math.round(tot * 0.7), tot);
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
    const hitsAt = 26, roll = Math.min(60, hits * 2), bonusAt = hitsAt + roll + 26, bonusRoll = perfect ? 0 : (bonus > 0 ? 40 : 0);
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
    if (this.pop > 0) this.pop--;
    if (!pinned) this.stepBits();

    if (this.st === 'intro') {
      for (let k = 0; k < 3; k++) if (this.t === COUNT_AT + k * BEAT) this.sfx('blip');
      if (this.t === COUNT_AT + 3 * BEAT) this.sfx('select');
      if (this.t >= INTRO) this.launch();
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
          if (t === b.bonusAt) { this.pay(b.bonus); this.reveal(); this.sfx('quest'); this.fx(e => { e.flash('f', 6); e.shake(2, 8); }); this.cannon(80); }
          if (!pinned && t > b.bonusAt && t < b.bonusAt + 120 && t % 3 === 0) this.cannon(3);
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
    const cols = [C.gold, C.hot, C.line, C.lime, C.cream, C.violet, C.pink];
    for (let i = 0; i < n; i++) {
      const c = cols[Math.floor(r() * cols.length)]; const k = Math.floor(r() * 4);
      if (i % 2 === 0) this.bits.push({ x: bx + 8 + r() * 288, y: by, vx: (r() - 0.5) * 2.2, vy: -1.2 - r() * 2.4, c, k, life: 150 + Math.floor(r() * 60) });
      else {
        const x = i % 4 === 1 ? PF_X + 4 + r() * 34 : PF_X + PF_W - 38 + r() * 34;
        this.bits.push({ x, y: -4 - r() * 20, vx: (r() - 0.5) * 0.6, vy: 0.6 + r() * 1.2, c, k, life: 260 });
      }
    }
    if (this.bits.length > 260) this.bits.splice(0, this.bits.length - 260);
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
  private drawBits(ctx: CanvasRenderingContext2D, T: number) {
    for (const p of this.bits) {
      const x = Math.round(p.x), y = Math.round(p.y); if (x < PF_X + 1 || x > PF_X + PF_W - 4) continue;
      if (p.life < 20 && (T & 2)) continue;              // fade = blink out
      const ph = ((T >> 2) + p.k) & 3;
      if (p.k === 3) {                                    // tiny star, glinting white
        rect(ctx, x - 1, y, 3, 1, p.c); rect(ctx, x, y - 1, 1, 3, p.c); if (ph === 0) rect(ctx, x, y, 1, 1, C.text);
      } else if (ph === 0) rect(ctx, x, y, 3, 1, p.c);    // tumbling ribbon: wide, diagonal, tall, diagonal
      else if (ph === 2) rect(ctx, x + 1, y - 1, 1, 3, p.c);
      else { rect(ctx, x, y, 2, 1, p.c); rect(ctx, x + 1, y + 1, 2, 1, p.c); }
    }
  }

  // ------------------------------------------------------------------ presentation (pixel exact)

  overlay(g: Game, ctx: CanvasRenderingContext2D) {
    if (this.st === 'idle' || g.state.scene !== 'bonus') return;
    const T = g.tick;
    if (this.st === 'intro') this.drawIntro(ctx, T);
    if (this.st === 'fly' || (this.st === 'intro' && this.t > INTRO - 24)) this.drawCounter(ctx, T);
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
    const open = t < 14 ? t / 14 : t > INTRO - 14 ? Math.max(0, (INTRO - t) / 14) : 1;
    const CY = 124, BH = 108;
    this.band(ctx, CY, BH, open, C.gold, T);
    if (open < 1) return;
    const top = CY - BH / 2;
    // tag line: stage number in a chamfered chip
    const n = this.g.content.bonus.indexOf(def) + 1;
    const tag = `BONUS STAGE ${String(Math.max(1, n)).padStart(2, '0')}`;
    const tw = textWidth(tag) + 12;
    chamferFill(ctx, cx - tw / 2, top + 9, tw, 11, C.deep, 3); chamferLine(ctx, cx - tw / 2, top + 9, tw, 11, C.line, 3);
    text(ctx, tag, cx, top + 11, C.ice, { align: 'center' });
    // the stage's own name types in letter by letter, the newest letter flashing white
    const title = (def.name || 'Treat Bonanza').toUpperCase() + '!';
    const sc = textWidth(title, 3) <= PF_W - 24 ? 3 : 2;
    const shown = Math.min(title.length, Math.max(0, Math.floor((t - 10) / 2)));
    if (shown > 0) {
      const full = textWidth(title, sc); const left = Math.round(cx - full / 2);
      for (let i = 0; i < shown; i++) {
        const fresh = i === shown - 1 && shown < title.length;
        const c = fresh ? C.text : ((T >> 3) + i) % 14 === 0 ? C.cream : C.gold;
        this.outlined(ctx, title[i], left + i * 6 * sc + Math.floor(5 * sc / 2), top + 27, c, C.burnt, sc, C.ink);
      }
    }
    // briefing lines
    if (t > 40) {
      const tot = def.groups * 8; const ed = this.g.content.enemies.find(e => e.id === def.breed);
      const nm = (ed?.name ?? def.breed).toUpperCase();
      text(ctx, `${tot} ${plural(nm, tot)} INBOUND`, cx, top + 56, C.pink, { align: 'center', shadow: C.ink });
      if (t > 48) text(ctx, 'THEY WON\'T FIGHT BACK. BOOP THEM ALL!', cx, top + 70, C.text, { align: 'center', shadow: C.ink });
      if (t > 56) {   // flight plan: tiny path glyph + hint, centred as one unit
        const hint = `FLIGHT PLAN: ${plan(def.pattern).hint}`; const gw = 30, uw = gw + 6 + textWidth(hint);
        const ux = Math.round(cx - uw / 2);
        this.planGlyph(ctx, ux, top + 83, gw, 15, T);
        text(ctx, hint, ux + gw + 6, top + 87, C.ice, { shadow: C.ink });
      }
      if (ed?.sprite) {   // breed mugshots flanking the briefing
        const bob = (T >> 4) & 1;
        drawSprite(ctx, ed.sprite, PF_X + 30, top + 64 + bob);
        drawSprite(ctx, ed.sprite, PF_X + PF_W - 30, top + 64 + (bob ^ 1), { flipX: true });
      }
    }
    // countdown: 3, 2, 1 inside a spinning targeting reticle
    const ct = t - COUNT_AT;
    if (ct >= 0 && ct < 3 * BEAT) {
      const k = Math.floor(ct / BEAT); const lt = ct % BEAT; const num = String(3 - k);
      const ccx = cx, ccy = CCY;
      const acc = [C.line, C.violet, C.hot][k];
      this.annulus(ctx, ccx, ccy, 0, 26, C.night);
      this.annulus(ctx, ccx, ccy, 25, 26, darkOf(acc));
      this.annulus(ctx, ccx, ccy, 29, 30, acc, 6, 0.55, T * 0.04);
      this.annulus(ctx, ccx, ccy, 33, 34, darkOf(acc), 4, 0.3, -T * 0.03);
      if (lt < 8 && !(lt & 1)) { const r = 27 + lt * 2; this.annulus(ctx, ccx, ccy, r, r + 1, lighter(acc)); }   // beat shockwave
      const s = lt < 3 ? 5 : 4;
      this.outlined(ctx, num, ccx + 1, ccy - Math.round(7 * s / 2) - 2, lt < 3 ? C.text : lighter(acc), darkOf(acc), s, null);
      for (let i = 0; i < 3; i++) rect(ctx, ccx - 10 + i * 8, ccy + 17, 5, 2, i <= k ? acc : C.indigo);   // beat pips, inside the disc
    }
  }

  /** GO! burst in the first ticks of the flight: big outlined word and expanding 2px arc rings. */
  private drawGo(ctx: CanvasRenderingContext2D, t: number) {
    const cx = PF_X + PF_W / 2, cy = CCY;
    if (t > GO_T - 10 && (t & 2)) return;            // blinks out
    for (let i = 0; i < 2; i++) { const r = 20 + t * 3 - i * 14; if (r > 8) this.annulus(ctx, cx, cy, r, r + 1, i ? C.lime : C.cream, 12, 0.6, t * 0.05); }
    this.outlined(ctx, 'GO!', cx + 2, cy - 14, t < 4 ? C.text : C.lime, GREEN, 4);
  }

  /** Live hit counter docked at the top of the playfield: HITS nn/NN plus one cell per cat, grouped by squadron. */
  private drawCounter(ctx: CanvasRenderingContext2D, T: number) {
    const total = this.total(); const hits = this.liveHits(); const groups = Math.max(1, Math.ceil(total / 8));
    const cw = 4, ch = 5, gap = 5, gw = 8 * (cw + 1) - 1; const cellsW = groups * gw + (groups - 1) * gap;
    const w = Math.max(132, cellsW + 20), h = 30; const x = Math.round(PF_X + PF_W / 2 - w / 2), y = 6;
    const hot = this.pop > 6; const cx = PF_X + PF_W / 2;
    frame(ctx, x, y, w, h, hot ? C.text : C.gold, C.night, 4);
    // one readout, one format: HITS 07/40 (label ice, number gold), with a blinking live LED to its left
    const num = `${String(hits).padStart(2, '0')}/${total}`; const lw = textWidth('HITS '), nw = textWidth(num);
    const tx = Math.round(cx - (lw + nw) / 2);
    rect(ctx, tx - 8, y + 7, 3, 3, (T >> 4) & 1 ? C.lime : darkOf(C.lime));
    text(ctx, 'HITS', tx, y + 6, C.ice, { shadow: C.ink });
    text(ctx, num, tx + lw, y + 6 - (this.pop > 7 ? 1 : 0), hot ? C.text : C.gold, { shadow: C.burnt });
    const cx0 = Math.round(cx - cellsW / 2);
    for (let gi = 0; gi < groups; gi++) {
      const have = Math.max(0, Math.min(8, hits - gi * 8)); const full = have === 8;
      for (let i = 0; i < 8; i++) {
        const px = cx0 + gi * (gw + gap) + i * (cw + 1), py = y + 18;
        if (i < have) { const c = full ? C.lime : C.gold; rect(ctx, px, py, cw, ch, c); rect(ctx, px, py, cw, 1, lighter(c)); rect(ctx, px, py + ch - 1, cw, 1, darkOf(c)); }
        else { rect(ctx, px, py, cw, ch, C.deep); rect(ctx, px, py, cw, 1, C.line2); }
      }
    }
    if (this.pop > 0 && hits > 0) {   // the newest cell sparkles
      const i = hits - 1; const px = cx0 + Math.floor(i / 8) * (gw + gap) + (i % 8) * (cw + 1);
      rect(ctx, px - 2, y + 20, 1, 1, C.text); rect(ctx, px + cw + 1, y + 20, 1, 1, C.text); rect(ctx, px + 1, y + 16, 2, 1, C.text);
    }
  }

  /** Pom, drawn clean above the results dim so the player stays the hero. Mirrors the player's own pose. */
  private drawPom(ctx: CanvasRenderingContext2D, top: number, bottom: number) {
    try {
      const P: any = this.g.mods.player; if (!P || this.g.mods.world?.phase === 'nap') return;
      const camX = Math.round(P.camera?.x ?? 0); const bob = Math.round(Math.sin((P.anim ?? 0) / 10));
      const sx = PF_X - camX + P.x, sy = P.y + bob; if (sy + 16 > top && sy - 16 < bottom) return;   // never over the board
      if (P.invuln > 0 && Math.floor(P.invuln / 4) % 2 === 0) return;
      const name = P.vx < -0.8 ? 'poodle_left' : P.vx > 0.8 ? 'poodle_right' : 'poodle';
      ctx.save(); ctx.beginPath(); ctx.rect(PF_X, 0, PF_W, 360); ctx.clip();
      drawSprite(ctx, name, sx, sy, { frame: Math.floor((P.anim ?? 0) / 6) % 2 });
      ctx.restore();
    } catch { /* cosmetic */ }
  }

  private drawResults(ctx: CanvasRenderingContext2D, T: number) {
    const b = this.board; if (!b) return;
    const t = this.t; const cx = PF_X + PF_W / 2;
    const closing = b.end - t < 14 && !this.demo;
    const open = closing ? Math.max(0, (b.end - t) / 14) : Math.min(1, t / 12);
    const W0 = 304, H0 = b.H;
    const h = Math.max(4, Math.round(H0 * open) & ~1); const x = cx - W0 / 2, y = 64 + (H0 - h) / 2;
    const acc = b.perfect ? [C.gold, C.hot, C.line, C.lime][(T >> 3) & 3] : C.line;
    // a light 25% dim on a normal clear (none on a perfect: the reward moment stays loud and clean), then a
    // solid ink apron hugging the board so it lifts off any scenery; Pom is redrawn clean on top of the dim
    if (!b.perfect) dither(ctx, PF_X, 0, PF_W, 360, C.ink, 'sparse');
    rect(ctx, x - 3, y - 3, W0 + 6, h + 6, C.ink);
    dither(ctx, x - 7, y - 7, W0 + 14, 4, C.ink, 'check'); dither(ctx, x - 7, y + h + 3, W0 + 14, 4, C.ink, 'check');
    dither(ctx, x - 7, y - 3, 4, h + 6, C.ink, 'check'); dither(ctx, x + W0 + 3, y - 3, 4, h + 6, C.ink, 'check');
    if (!b.perfect) this.drawPom(ctx, y - 8, y + h + 8);
    frame(ctx, x, y, W0, h, acc, C.night, 6);
    if (open < 1) { this.drawBits(ctx, T); return; }
    scanlines(ctx, x + 2, y + 2, W0 - 4, h - 4);
    // header strip: the stage's name, a marching chevron run centred between the labels, RESULTS
    chamferFill(ctx, x + 10, y + 8, W0 - 20, 15, C.deep, 4);
    const nm = (this.def?.name ?? 'Treat Bonanza').toUpperCase();
    text(ctx, nm, x + 18, y + 12, C.ice);
    text(ctx, 'RESULTS', x + W0 - 18, y + 12, C.text, { align: 'right' });
    const a0 = x + 18 + textWidth(nm) + 10, a1 = x + W0 - 18 - textWidth('RESULTS') - 10;
    const nC = Math.max(0, Math.floor((a1 - a0 + 3) / 6)); const c0 = Math.round((a0 + a1) / 2 - (nC * 6 - 3) / 2);
    for (let i = 0; i < nC; i++) {
      const xx = c0 + i * 6; const lit = ((i - (T >> 2)) % 10 + 10) % 10 < 2; const cc = lit ? C.ice : C.line2;
      rect(ctx, xx, y + 12, 1, 1, cc); rect(ctx, xx + 1, y + 13, 1, 1, cc); rect(ctx, xx + 2, y + 14, 1, 1, cc); rect(ctx, xx + 1, y + 15, 1, 1, cc); rect(ctx, xx, y + 16, 1, 1, cc);
    }
    // breed mugshot at 2x in a framed chip, lined up with the HITS row (and the BONUS row on a normal clear)
    const ed = this.def ? this.g.content.enemies.find(e => e.id === this.def!.breed) : null;
    const chipH = b.perfect ? 22 : 42, chipY = y + 29, chipW = b.perfect ? 30 : 42;
    frame(ctx, x + 14, chipY, chipW, chipH, b.perfect ? C.gold : C.line, C.ink, 3);
    if (ed?.sprite) {
      ctx.save(); ctx.beginPath(); ctx.rect(x + 15, chipY + 1, chipW - 2, chipH - 2); ctx.clip();
      const scl = b.perfect ? 1 : 2; ctx.translate(x + 14 + chipW / 2, chipY + chipH / 2 + ((T >> 4) & 1)); ctx.scale(scl, scl);
      drawSprite(ctx, ed.sprite, 0, 0); ctx.restore();
    }
    const LX = x + 66, RX = x + W0 - 18;
    const row = (lbl: string, val: string, yy: number, c: string, live: boolean) => {
      text(ctx, lbl, LX, yy, C.text, { shadow: C.ink });
      for (let px = LX + textWidth(lbl) + 6; px < RX - textWidth(val) - 6; px += 4) rect(ctx, px, yy + 5, 2, 1, C.peri);   // leader dots
      text(ctx, val, RX, yy, live ? C.text : c, { align: 'right', shadow: C.ink });
    };
    if (t >= b.hitsAt) {
      row('NUMBER OF HITS', `${this.shown.hits}/${b.total}`, y + 32, C.gold, t <= b.hitsAt + b.roll);
      const total = Math.max(1, b.total); const cw = Math.max(2, Math.min(4, Math.floor((RX - LX) / total) - 1));   // one pip per cat
      const sw = total * (cw + 1) - 1; const sx = RX - sw;
      for (let i = 0; i < total; i++) {
        const on = i < this.shown.hits; const c = on ? (b.perfect ? C.lime : C.gold) : C.deep;
        rect(ctx, sx + i * (cw + 1), y + 44, cw, 3, c); rect(ctx, sx + i * (cw + 1), y + 44, cw, 1, on ? lighter(c) : C.line2);
      }
    }
    const prompt = (yy: number) => {
      if (t <= b.doneAt || (T >> 4) % 4 === 3) return;
      hintRow(ctx, [[keys(this.g.input.lastDevice ?? 'keyboard').fire, 'CONTINUE']], cx, yy, b.perfect ? C.gold : C.line);
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
      // PERFECT! drops in with a bounce: solid gold, a single white sweep running across the letters
      const word = 'PERFECT!'; const sc = 4; const full = textWidth(word, sc);
      const dy = pt < 8 ? -(8 - pt) * 4 : pt < 12 ? (12 - pt) - 2 : 0;
      const left = Math.round(cx - full / 2); const sweep = ((pt >> 1) % 30) - 8;
      for (let i = 0; i < word.length; i++) {
        const dd = Math.abs(i - sweep); const c = pt < 3 || dd === 0 ? C.text : dd === 1 ? C.cream : C.gold;
        this.outlined(ctx, word[i], left + i * 6 * sc + 10, y + 58 + dy, c, C.burnt, sc, C.ink);
      }
      for (let i = 0; i < 6; i++) {   // sparkles orbiting the word
        const a = (T / 20) + i * Math.PI / 3; const sx = Math.round(cx + Math.cos(a) * 112), sy = Math.round(y + 72 + Math.sin(a) * 18);
        const s = ((T >> 2) + i) & 1 ? 2 : 1; const c = i & 1 ? C.gold : C.text;
        rect(ctx, sx - s, sy, s * 2 + 1, 1, c); rect(ctx, sx, sy - s, 1, s * 2 + 1, c);
      }
      if (pt > 20) {
        const sw = 220; chamferFill(ctx, cx - sw / 2, y + 98, sw, 15, C.burnt, 4); chamferLine(ctx, cx - sw / 2, y + 98, sw, 15, C.gold, 4);
        text(ctx, `SPECIAL BONUS ${b.bonus} PTS`, cx, y + 102, C.cream, { align: 'center' });
      }
      if (pt > 40) text(ctx, 'EVERY SINGLE CAT BOOPED!', cx, y + 120, C.pink, { align: 'center', shadow: C.ink });
      if (pt > 52) text(ctx, 'GOOD GIRL, POM. TAIL WAGS ALL ROUND.', cx, y + 134, C.dim, { align: 'center' });
      prompt(y + 150);
    }
    this.drawBits(ctx, T);
  }
}

export const makeMinigames = (): Module => new Minigames();
