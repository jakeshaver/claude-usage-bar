import type { Game, Module } from '../core/game';
import { PF_X, PF_W } from '../core/game';
import type { BonusDef } from '../core/types';
import { text, textWidth } from '../art/font';
import { drawSprite } from '../art/sprite';
import { C, rect, frame, dither, scanlines, ringArcs, ring, disc, chamferFill, chamferLine, darkOf, lighter, segBar } from '../ui/draw';

/**
 * Treat Bonanza: Galaga-style challenging stages. Cats fly scripted patterns (run by interaction.startBonus)
 * and never attack. This module owns the orchestration around them:
 *
 *   intro    banner sweeps open, title types in, 3-2-1 countdown (cats launch on GO)
 *   fly      live hit counter docked at the top of the playfield; GO! burst
 *   results  Galaga results board: NUMBER OF HITS, BONUS, or PERFECT! + SPECIAL BONUS with fanfare and confetti
 *
 * It always ends and hands control back (bonus:end), even if interaction misbehaves: a fly watchdog, a hard
 * overall cap, and a guard for the scene being changed underneath it.
 */

type St = 'idle' | 'intro' | 'fly' | 'results';

const INTRO = 168;            // ticks: banner + countdown; cats launch when it ends
const COUNT_AT = 66;          // countdown "3" appears
const BEAT = 30;              // ticks per countdown number
const GO_T = 34;              // GO! burst lingers into the fly phase
const PERFECT_BONUS = 10000;
const PER_HIT = 100;
const HARD_CAP = 60 * 90;     // nothing in a bonus stage may take longer than 90 s (pause excluded)

/** Results board timeline, computed once when the results open. */
interface Board { hits: number; total: number; bonus: number; perfect: boolean; hitsAt: number; roll: number; bonusAt: number; bonusRoll: number; end: number }

const plural = (s: string, n: number) => n === 1 ? s : s.endsWith('Y') ? s.slice(0, -1) + 'IES' : s + 'S';

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
  board: Board | null = null;
  shown = { hits: 0, bonus: 0 };
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
      if (this.st !== 'fly') return;          // stale or duplicate result: the watchdog/intro own the flow
      this.openResults(+p?.hits, +p?.total);
    });
  }

  /** Total cats in this stage, from interaction if it knows, else from the content def. */
  total(): number { return this.g.mods.interaction?.bonus?.total ?? (this.def ? this.def.groups * 8 : 0); }
  liveHits(): number { return Math.max(this.hits, this.g.mods.interaction?.bonus?.hits ?? 0); }
  /** True while a Treat Bonanza is running (intro, flight or results). */
  active() { return this.st !== 'idle'; }

  startBonus(id: string) {
    const g = this.g;
    const def = g.content.bonus.find(b => b.id === id);
    if (!def) { g.bus.emit('bonus:end', { id, hits: 0, total: 0 }); return; }
    this.def = def; this.hits = 0; this.pop = 0; this.board = null; this.all = 0;
    this.flyLimit = def.groups * 140 + 60 * 30;
    g.setScene('bonus');
    g.bus.emit('bonus:start', { id });
    try { g.mods.interaction?.clearAll(); } catch (e) { g.reportError('minigames', e); }
    this.go('intro');
    if (this.demo && (this.demo.phase === 'results' || this.demo.phase === 'perfect')) {
      const tot = def.groups * 8; this.go('fly'); this.openResults(this.demo.phase === 'perfect' ? tot : Math.round(tot * 0.7), tot);
    }
  }

  private go(st: St) { this.st = st; this.t = 0; }

  private launch() {
    const g = this.g; this.go('fly');
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
    this.board = { hits, total, bonus, perfect, hitsAt, roll, bonusAt, bonusRoll, end: bonusAt + bonusRoll + (perfect ? 210 : 120) };
    this.shown = { hits: 0, bonus: 0 };
    g.ops.addScore(bonus);
    if (perfect) g.ops.setFlag('perfect_bonus');
    this.go('results');
  }

  private finish() {
    const g = this.g; const b = this.board; const id = this.def?.id;
    const hits = b?.hits ?? this.liveHits(), total = b?.total ?? this.total();
    this.st = 'idle'; this.t = 0; this.board = null;
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
      this.st = 'idle'; this.board = null; return;       // title / map / ending / recovery: drop silently
    }
    // demo pinning freezes the presentation at a chosen tick (showcase screenshots only)
    const d = this.demo;
    const pinned = !!d && d.at >= 0 && this.t >= d.at && (d.phase === this.st || (d.phase === 'perfect' && this.st === 'results'));
    const holdResults = !!d && this.st === 'results' && !!this.board && this.t >= this.board.end - 20;
    if (!pinned && !holdResults) this.t++;
    this.all++;
    if (this.pop > 0) this.pop--;

    if (this.st === 'intro') {
      for (let k = 0; k < 3; k++) if (this.t === COUNT_AT + k * BEAT) this.sfx('blip');
      if (this.t === COUNT_AT + 3 * BEAT) this.sfx('select');
      if (this.t >= INTRO) this.launch();
    } else if (this.st === 'fly') {
      if (this.t > this.flyLimit || this.all > HARD_CAP) {   // watchdog: interaction never reported back
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
          if (t === b.bonusAt) { this.sfx('quest'); this.fx(e => e.flash('f', 6)); }
          for (const [dt, fx, fy] of [[0, 0.5, 300], [10, 0.12, 270], [20, 0.88, 270], [40, 0.3, 320], [54, 0.7, 320]] as const)
            if (t === b.bonusAt + dt) this.fx((e, cx) => { e.burst(cx + PF_W * fx, fy, 'confetti'); if (dt === 0) e.shake(2, 8); });
          if (t === b.bonusAt + 30) this.fx(e => { const P = g.mods.player?.pos?.(); if (P) e.burst(P.x, P.y - 8, 'hearts'); });
          this.shown.bonus = b.bonus;
        } else if (b.bonusRoll) {
          const v = Math.round(b.bonus * Math.min(1, (t - b.bonusAt) / b.bonusRoll));
          if (v !== this.shown.bonus && t % 3 === 0) this.sfx('blip');
          if (v === b.bonus && this.shown.bonus !== b.bonus) this.sfx('pickup');
          this.shown.bonus = v;
        }
      }
      if (t >= b.end) this.finish();
    }
    if ((this.st as St) !== 'idle' && !d && this.all > HARD_CAP + 600) this.finish();   // belt and braces
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

  /** Text with a 1px outline in a dark colour (8 neighbours) plus a drop shadow, so it reads over any backdrop. */
  private outlined(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, c: string, dark: string, scale = 1) {
    const o = { align: 'center' as const, scale };
    text(ctx, s, x, y + scale, dark, o);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) text(ctx, s, x + dx, y + dy, dark, o);
    text(ctx, s, x, y, c, o);
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

  private drawIntro(ctx: CanvasRenderingContext2D, T: number) {
    const t = this.t; const cx = PF_X + PF_W / 2; const def = this.def!;
    const open = t < 14 ? t / 14 : t > INTRO - 14 ? Math.max(0, (INTRO - t) / 14) : 1;
    const CY = 118, BH = 92;
    this.band(ctx, CY, BH, open, C.gold, T);
    if (open < 1) return;
    const top = CY - BH / 2;
    // tag line: stage number in a little chamfered chip
    const n = this.g.content.bonus.indexOf(def) + 1;
    const tag = `BONUS STAGE ${String(Math.max(1, n)).padStart(2, '0')}`;
    const tw = textWidth(tag) + 12;
    chamferFill(ctx, cx - tw / 2, top + 9, tw, 11, C.deep, 3); chamferLine(ctx, cx - tw / 2, top + 9, tw, 11, C.line, 3);
    text(ctx, tag, cx, top + 11, C.ice, { align: 'center' });
    // title types in letter by letter, the newest letter flashing white
    const title = 'TREAT BONANZA!';
    const shown = Math.min(title.length, Math.max(0, Math.floor((t - 10) / 2)));
    if (shown > 0) {
      const full = textWidth(title, 3); const left = Math.round(cx - full / 2);
      for (let i = 0; i < shown; i++) {
        const fresh = i === shown - 1 && shown < title.length;
        const c = fresh ? C.text : ((T >> 3) + i) % 14 === 0 ? C.cream : C.gold;
        this.outlined(ctx, title[i], left + i * 18 + 7, top + 27, c, C.burnt, 3);
      }
    }
    // briefing lines
    if (t > 40) {
      const tot = def.groups * 8; const ed = this.g.content.enemies.find(e => e.id === def.breed);
      const nm = (ed?.name ?? def.breed).toUpperCase();
      text(ctx, `${tot} ${plural(nm, tot)} INBOUND`, cx, top + 56, C.pink, { align: 'center', shadow: C.ink });
      if (t > 48) text(ctx, 'THEY WON\'T FIGHT BACK. BOOP THEM ALL!', cx, top + 70, C.text, { align: 'center', shadow: C.ink });
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
      const ccx = cx, ccy = 214;
      const acc = [C.line, C.violet, C.hot][k];
      disc(ctx, ccx, ccy, 25, C.night);
      ring(ctx, ccx, ccy, 26, darkOf(acc));
      ringArcs(ctx, ccx, ccy, 29, acc, 10, 4, T * 0.6);
      ringArcs(ctx, ccx, ccy, 33, darkOf(acc), 4, 8, -T * 0.4);
      if (lt < 6) ring(ctx, ccx, ccy, 26 + lt * 3, lighter(acc), [2, 2], T);   // shockwave on each beat
      const sc = lt < 3 ? 6 : 5;
      this.outlined(ctx, num, ccx + 1, ccy - Math.round(7 * sc / 2), lt < 3 ? C.text : lighter(acc), C.ink, sc);
      for (let i = 0; i < 3; i++) rect(ctx, ccx - 10 + i * 8, ccy + 40, 5, 3, i <= k ? acc : C.indigo);   // beat pips
    }
  }

  /** GO! burst in the first ticks of the flight: big outlined word and expanding dashed rings. */
  private drawGo(ctx: CanvasRenderingContext2D, t: number) {
    const cx = PF_X + PF_W / 2, cy = 214;
    if (t > GO_T - 10 && (t & 2)) return;            // blinks out
    for (let i = 0; i < 2; i++) { const r = 20 + t * 3 - i * 14; if (r > 8) ring(ctx, cx, cy, r, i ? C.lime : C.cream, [3, 3], t); }
    this.outlined(ctx, 'GO!', cx + 2, cy - 14, t < 4 ? C.text : C.lime, C.ink, 4);
  }

  /** Live hit counter docked at the top of the playfield: HITS nn/NN plus one cell per cat, grouped by squadron. */
  private drawCounter(ctx: CanvasRenderingContext2D, T: number) {
    const total = this.total(); const hits = this.liveHits(); const groups = Math.max(1, Math.ceil(total / 8));
    const cw = 3, gap = 4, gw = 8 * (cw + 1) - 1; const cellsW = groups * gw + (groups - 1) * gap;
    const w = Math.max(148, cellsW + 16), h = 30; const x = Math.round(PF_X + PF_W / 2 - w / 2), y = 6;
    const hot = this.pop > 6;
    frame(ctx, x, y, w, h, hot ? C.text : C.gold, C.night, 4);
    text(ctx, 'HITS', x + 8, y + 6, C.dim);
    rect(ctx, x + 35, y + 8, 3, 3, (T >> 4) & 1 ? C.lime : darkOf(C.lime));   // live LED
    text(ctx, 'LIVE', x + 41, y + 6, C.lime);
    text(ctx, `${String(hits).padStart(2, '0')}/${total}`, x + w - 8, y + 5 - (this.pop > 7 ? 1 : 0), hot ? C.text : C.gold, { align: 'right', shadow: C.burnt });
    const cx0 = Math.round(PF_X + PF_W / 2 - cellsW / 2);
    for (let gi = 0; gi < groups; gi++) {
      const have = Math.max(0, Math.min(8, hits - gi * 8));
      segBar(ctx, cx0 + gi * (gw + gap), y + 18, 8, cw, 5, have / 8, have === 8 ? C.lime : C.gold);
    }
    if (this.pop > 0 && hits > 0) {   // the newest cell sparkles
      const i = hits - 1; const px = cx0 + Math.floor(i / 8) * (gw + gap) + (i % 8) * (cw + 1) + 1;
      rect(ctx, px - 3, y + 20, 1, 1, C.text); rect(ctx, px + 3, y + 20, 1, 1, C.text); rect(ctx, px, y + 16, 1, 1, C.text);
    }
  }

  private drawResults(ctx: CanvasRenderingContext2D, T: number) {
    const b = this.board; if (!b) return;
    const t = this.t; const cx = PF_X + PF_W / 2;
    const closing = b.end - t < 14 && !this.demo;
    const open = closing ? Math.max(0, (b.end - t) / 14) : Math.min(1, t / 12);
    const W0 = 304, H0 = b.perfect ? 164 : 140;
    const h = Math.max(4, Math.round(H0 * open) & ~1); const x = cx - W0 / 2, y = 64 + (H0 - h) / 2;
    const acc = b.perfect ? [C.gold, C.hot, C.line, C.lime][(T >> 3) & 3] : C.line;
    dither(ctx, PF_X, 0, PF_W, 360, C.ink, b.perfect ? 'sparse' : 'check');   // dim the playfield behind the board
    frame(ctx, x, y, W0, h, acc, C.night, 6);
    if (open < 1) return;
    scanlines(ctx, x + 2, y + 2, W0 - 4, h - 4);
    // header strip
    chamferFill(ctx, x + 10, y + 8, W0 - 20, 15, C.deep, 4);
    text(ctx, 'TREAT BONANZA', x + 18, y + 12, C.ice);
    text(ctx, 'RESULTS', x + W0 - 18, y + 12, C.line, { align: 'right' });
    for (let i = 0; i < 4; i++) rect(ctx, x + 100 + i * 6, y + 14, 3, 3, ((T >> 3) & 3) === i ? C.line : darkOf(C.line));
    // breed mugshot
    const ed = this.def ? this.g.content.enemies.find(e => e.id === this.def!.breed) : null;
    if (ed?.sprite) drawSprite(ctx, ed.sprite, x + 34, y + 50 + ((T >> 4) & 1));
    const row = (lbl: string, val: string, yy: number, c: string, live: boolean) => {
      text(ctx, lbl, x + 62, yy, C.text, { shadow: C.ink });
      for (let px = x + 62 + textWidth(lbl) + 6; px < x + W0 - 22 - textWidth(val) - 6; px += 4) rect(ctx, px, yy + 5, 2, 1, C.peri);   // leader dots
      text(ctx, val, x + W0 - 22, yy, live ? C.text : c, { align: 'right', shadow: C.ink });
    };
    if (t >= b.hitsAt) {
      row('NUMBER OF HITS', String(this.shown.hits), y + 36, C.gold, t <= b.hitsAt + b.roll);
      const total = Math.max(1, b.total); const cw = Math.max(2, Math.min(4, Math.floor(200 / total) - 1));   // one pip per cat
      const sw = total * (cw + 1) - 1; const sx = x + W0 - 22 - sw;
      for (let i = 0; i < total; i++) rect(ctx, sx + i * (cw + 1), y + 48, cw, 3, i < this.shown.hits ? (b.perfect ? C.lime : C.gold) : C.indigo);
    }
    if (t >= b.bonusAt && !b.perfect) {
      row('BONUS', `${this.shown.bonus} PTS`, y + 64, C.pink, t < b.bonusAt + b.bonusRoll);
      if (t >= b.bonusAt + b.bonusRoll + 10) {
        const r = b.hits / Math.max(1, b.total);
        const msg = r >= 0.75 ? 'GREAT FLYING, CAPTAIN!' : r >= 0.4 ? 'NICE BOOPING!' : b.hits > 0 ? 'THE CATS GOT AWAY... NEXT TIME!' : 'NO TREATS THIS TIME!';
        text(ctx, msg, cx, y + 94, r >= 0.75 ? C.lime : C.violet, { align: 'center', shadow: C.ink });
        const miss = b.total - b.hits;
        text(ctx, `${miss} ${plural('CAT', miss)} SLIPPED THROUGH`, cx, y + 110, C.dim, { align: 'center' });
      }
    }
    if (t >= b.bonusAt && b.perfect) {
      const pt = t - b.bonusAt;
      // PERFECT! drops in with a bounce, letters cycle through the accent colours
      const word = 'PERFECT!'; const sc = 4; const full = textWidth(word, sc);
      const dy = pt < 8 ? -(8 - pt) * 4 : pt < 12 ? (12 - pt) - 2 : 0;
      const left = Math.round(cx - full / 2); const cols = [C.gold, C.cream, C.hot, C.line, C.lime];
      for (let i = 0; i < word.length; i++) {
        const wob = ((T >> 2) + i) % 8 === 0 ? -1 : 0;
        this.outlined(ctx, word[i], left + i * 6 * sc + 10, y + 62 + dy + wob, cols[((T >> 3) + i) % cols.length], C.ink, sc);
      }
      for (let i = 0; i < 6; i++) {   // sparkles orbiting the word
        const a = (T / 20) + i * Math.PI / 3; const sx = Math.round(cx + Math.cos(a) * 112), sy = Math.round(y + 76 + Math.sin(a) * 18);
        const s = ((T >> 2) + i) & 1 ? 2 : 1; const c = i & 1 ? C.gold : C.text;
        rect(ctx, sx - s, sy, s * 2 + 1, 1, c); rect(ctx, sx, sy - s, 1, s * 2 + 1, c);
      }
      if (pt > 20) {
        const sw = 220; chamferFill(ctx, cx - sw / 2, y + 102, sw, 15, C.burnt, 4); chamferLine(ctx, cx - sw / 2, y + 102, sw, 15, C.gold, 4);
        text(ctx, `SPECIAL BONUS ${b.bonus} PTS`, cx, y + 106, (T >> 3) & 1 ? C.text : C.cream, { align: 'center' });
      }
      if (pt > 40) text(ctx, 'EVERY SINGLE CAT BOOPED!', cx, y + 128, C.pink, { align: 'center', shadow: C.ink });
      if (pt > 52) text(ctx, 'GOOD GIRL, POM. TAIL WAGS ALL ROUND.', cx, y + 142, C.dim, { align: 'center' });
    }
  }
}

export const makeMinigames = (): Module => new Minigames();
