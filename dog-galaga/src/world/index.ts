import type { Game, Module } from '../core/game';
import { W, H, PF_X, PF_W } from '../core/game';
import type { AreaDef, Scene, Tod } from '../core/types';
import { evalCond } from '../core/conditions';
import { Background } from './bg';
import { text, textWidth } from '../art/font';
import { headline } from '../ui/numerals';
import { C } from '../ui/draw';

type Phase = 'intro' | 'wave' | 'between' | 'bonus' | 'boss' | 'outro' | 'nap' | 'done';

/** World: areas, the quest-graph director, scrolling backgrounds, time of day, transitions. */
class World implements Module {
  id = 'world';
  api = this;
  g!: Game;
  phase: Phase = 'done';
  timer = 0;
  bonusDone = false;
  bg = new Background();
  trans: { t: number; dur: number; kind: 'fade' | 'iris'; mid?: () => void; done?: boolean } | null = null;
  titleCard = 0;

  init(g: Game) {
    this.g = g;
    g.bus.on('wave:clear', () => this.onWaveClear());
    // hold ~2.3 s after a boss defeat so the multi-stage explosion and the victory stinger play out before the outro dialogue
    g.bus.on('boss:defeat', () => { if (this.phase === 'boss') { this.phase = 'outro'; this.timer = 140; } });
    g.bus.on('bonus:end', () => { if (this.phase === 'bonus') { this.phase = 'between'; this.timer = 60; } });
    g.bus.on('player:nap', () => { if (this.phase !== 'wave' && this.phase !== 'boss') return; this.napFromBoss = this.phase === 'boss'; this.phase = 'nap'; this.timer = 150; });
  }
  napFromBoss = false;

  area(id = this.g.state.areaId): AreaDef | undefined { return this.g.content.areas.find(a => a.id === id); }
  currentArea() { return this.area(); }

  /** Exits available from an area given current state. Always includes unconditional exits. */
  exitsFrom(id: string) { return (this.area(id)?.exits ?? []).filter(e => evalCond(e.when, this.g.state) && this.area(e.to)); }

  graph() {
    return {
      start: this.g.content.start,
      nodes: this.g.content.areas.map(a => ({ id: a.id, ending: a.ending ?? null })),
      edges: this.g.content.areas.flatMap(a => a.exits.map(e => ({ from: a.id, to: e.to, when: e.when ?? null }))),
    };
  }

  setTod(tod: Tod) { this.g.state.tod = tod; }

  transition(kind: 'fade' | 'iris', mid: () => void) {
    if (this.g.headless) { mid(); return; }
    this.trans = { t: 0, dur: 50, kind, mid };
  }

  newGame() {
    const s = this.g.state;
    Object.assign(s, { areaId: this.g.content.start, waveIndex: 0, score: 0, hearts: s.maxHearts, flags: {}, quests: {}, inventory: {}, memories: [], areasCleared: [], ending: null,
      stats: { shots: 0, hits: 0, naps: 0, playTicks: 0, catsBooped: 0 } });
    this.g.bus.emit('game:new', {});
    this.enterArea(this.g.content.start, 0);
  }

  enterArea(id: string, wave = 0) {
    const a = this.area(id); if (!a) { this.g.reportError('world', `unknown area ${id}`); return; }
    const s = this.g.state;
    s.areaId = id; s.waveIndex = Math.max(0, Math.min(wave, a.waves.length)); s.tod = a.tod;
    this.bonusDone = s.waveIndex > this.bonusAt(a);
    this.g.mods.interaction?.clearAll();
    this.bg.setArea(a, this.g);
    this.g.setScene('play');
    this.phase = 'intro'; this.timer = 150; this.titleCard = 150;
    this.g.mods.player?.respawn();
    this.g.bus.emit('area:enter', { areaId: id, waveIndex: s.waveIndex });
    if (s.waveIndex === 0 && a.intro) this.g.mods.quest?.dialogue(a.intro);
    this.g.mods.save?.save();
  }

  bonusAt(a: AreaDef) { return a.bonus ? Math.ceil(a.waves.length / 2) : 999; }

  private startNext() {
    const a = this.area()!; const s = this.g.state;
    if (a.bonus && !this.bonusDone && s.waveIndex === this.bonusAt(a)) {
      this.bonusDone = true; this.phase = 'bonus'; this.g.mods.minigames?.startBonus(a.bonus); return;
    }
    if (s.waveIndex < a.waves.length) { this.phase = 'wave'; this.g.mods.interaction?.startWave(a.id, s.waveIndex); return; }
    if (a.boss) { this.phase = 'boss'; this.g.mods.interaction?.startBoss(a.boss); return; }
    this.phase = 'outro'; this.timer = 30;
  }

  private onWaveClear() {
    if (this.phase !== 'wave') return;
    this.g.state.waveIndex++;
    this.phase = 'between'; this.timer = 75;
    this.g.mods.save?.save();
  }

  private finishArea() {
    const a = this.area()!; const s = this.g.state;
    if (!s.areasCleared.includes(a.id)) s.areasCleared.push(a.id);
    this.g.bus.emit('area:clear', { areaId: a.id });
    this.phase = 'done';
    if (a.ending) {
      const end = this.g.content.endings.find(e => e.when && evalCond(e.when, s)) ?? this.g.content.endings.find(e => e.id === a.ending) ?? this.g.content.endings[0];
      s.ending = end.id;
      this.g.mods.save?.save();
      this.transition('iris', () => { this.g.setScene('ending'); this.g.bus.emit('ending', { endingId: end.id }); });
      return;
    }
    this.g.mods.save?.save();
    this.transition('fade', () => this.g.setScene('map'));
  }

  /** Map choice (UI or bot). */
  chooseExit(to: string) {
    const ok = this.exitsFrom(this.g.state.areaId).find(e => e.to === to);
    if (!ok) return false;
    this.transition('iris', () => this.enterArea(to, 0));
    return true;
  }

  goto(scene: Scene, opts: any = {}) {
    if (scene === 'play') return this.enterArea(opts.area ?? this.g.state.areaId, opts.wave ?? 0);
    if (scene === 'map' && opts.area) this.g.state.areaId = opts.area;
    this.g.setScene(scene);
  }

  update(g: Game) {
    if (this.trans) {
      this.trans.t++;
      if (!this.trans.done && this.trans.t >= this.trans.dur / 2) { this.trans.done = true; this.trans.mid?.(); }
      if (this.trans.t >= this.trans.dur) this.trans = null;
    }
    if (g.paused) return;
    const sc = g.state.scene;
    // the world keeps drifting during dialogue (eased down to a gentle pace), so area entry never freezes
    if (sc === 'play' || sc === 'bonus' || sc === 'title' || sc === 'map' || sc === 'ending' || sc === 'dialogue') this.bg.update(g, sc === 'dialogue' ? 0.45 : 1);
    // the sector card plays over the intro dialogue too, so it is gone before the first wave arrives
    if ((sc === 'play' || sc === 'dialogue') && this.titleCard > 0) this.titleCard--;
    if (sc !== 'play' && sc !== 'bonus') return;
    switch (this.phase) {
      case 'intro': if (--this.timer <= 0) this.startNext(); break;
      case 'between': if (--this.timer <= 0) this.startNext(); break;
      case 'nap':
        if (--this.timer <= 0) {
          g.state.hearts = g.state.maxHearts; g.mods.player?.respawn();
          if (this.napFromBoss) { this.phase = 'boss'; if (!g.mods.interaction?.boss) g.mods.interaction?.startBoss(this.area()!.boss!); } else { this.phase = 'wave'; g.mods.interaction?.startWave(g.state.areaId, g.state.waveIndex); }
        }
        break;
      case 'outro':
        if (--this.timer <= 0) {
          const a = this.area()!; this.phase = 'done';
          if (a.outro) { g.mods.quest?.dialogue(a.outro, () => this.finishArea()); } else this.finishArea();
        }
        break;
    }
  }

  render(g: Game, r: any) {
    // No band or dim behind the formation rack: the stages keep a calm, low-contrast ground there instead.
    const sc = g.state.scene;
    if (sc === 'play' || sc === 'bonus' || sc === 'dialogue') this.bg.render(g, r);
  }

  overlay(g: Game, ctx: CanvasRenderingContext2D) {
    const sc = g.state.scene;
    // banners and title cards stay hidden under the pause menu (they would bleed through its dither)
    const menu = !!g.mods.ui?.menuOpen && g.mods.ui.menuOpen !== 'none';
    if ((sc === 'play' || sc === 'dialogue') && this.titleCard > 0 && !menu) { const a = this.area(); if (a) titleCard(ctx, a.name, a.subtitle ?? '', g.content.areas.indexOf(a) + 1, g.content.areas.length, 150 - this.titleCard, this.titleCard); }
    if (sc === 'play' && this.phase === 'nap') {
      const cx = PF_X + PF_W / 2;
      dither(ctx, PF_X, 0, PF_W, H, 10, '#1d1b33');
      headline(ctx, 'POM IS TAKING A NAP', cx, 148, C.gold, C.cream, C.burnt);
      text(ctx, 'Z z z . . .  BACK IN A SEC!', cx, 176, '#b9c1f2', { align: 'center' });
    }
    if (sc === 'play' && this.phase === 'between' && this.g.state.waveIndex > 0 && !menu) {
      const a = this.area();
      if (a && this.timer > 20) {
        const left = a.waves.length - g.state.waveIndex;
        text(ctx, left > 0 ? `WAVE ${g.state.waveIndex + 1} / ${a.waves.length}` : (a.boss ? 'WARNING: BIG CAT INBOUND' : 'SECTOR CLEAR'), PF_X + PF_W / 2, 160, left > 0 ? '#4ef2e6' : '#ff5a4f', { align: 'center', scale: 2, shadow: '#0b0a14' });
      }
    }
    if (this.trans) {
      const p = this.trans.t / this.trans.dur; const k = p < 0.5 ? p * 2 : (1 - p) * 2; // 0 open .. 1 closed
      if (this.trans.kind === 'fade') dissolve(ctx, k, p < 0.5);
      else pawIris(ctx, k);
    }
  }
}

// ------------------------------------------------------------------ pixel-exact overlays
const INK = '#0b0a14', CYAN = '#4ef2e6', TEAL = '#26a6c9', PINK = '#e8578f', MAG = '#a3285f', VIOLET = '#c9a2ff', DEEP = '#1d1b33';
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const patterns = new Map<string, CanvasPattern | null>();
/** ordered-dither fill (level 0..16) in one palette colour: palette-exact "translucency" */
function dither(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, level: number, color = INK) {
  level = Math.max(0, Math.min(16, Math.round(level))); if (level === 0 || w <= 0 || h <= 0) return;
  if (level === 16) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); return; }
  const key = color + level; let pat = patterns.get(key);
  if (pat === undefined) {
    const c = document.createElement('canvas'); c.width = c.height = 4; const cx = c.getContext('2d')!; cx.fillStyle = color;
    for (let i = 0; i < 16; i++) if (BAYER[i] < level) cx.fillRect(i & 3, i >> 2, 1, 1);
    pat = ctx.createPattern(c, 'repeat'); patterns.set(key, pat);
  }
  if (!pat) return; ctx.fillStyle = pat; ctx.fillRect(x, y, w, h);
}
/** fade: an ordered-dither dissolve that sweeps down the screen with a teal scan edge */
function dissolve(ctx: CanvasRenderingContext2D, k: number, closing: boolean) {
  const band = 8; let edge = -1; let prevSolid: boolean | null = null;
  for (let y = 0; y < H; y += band) {
    const f = closing ? y / H : 1 - y / H;
    const lv = Math.round((k * 1.6 - 0.6 * f) * 16);
    dither(ctx, 0, y, W, band, lv);
    const solid = lv >= 16;
    if (edge < 0 && prevSolid !== null && solid !== prevSolid) edge = y;
    prevSolid = solid;
  }
  // scan edge: 2px teal line on the solid/dissolving boundary with a trailing dithered cyan row
  if (k > 0.02 && k < 0.98 && edge >= 0) {
    ctx.fillStyle = TEAL; ctx.fillRect(0, edge - 1, W, 2);
    if (closing) { dither(ctx, 0, edge + 1, W, 2, 8, CYAN); dither(ctx, 0, edge + 3, W, 2, 3, CYAN); }
    else { dither(ctx, 0, edge - 3, W, 2, 8, CYAN); dither(ctx, 0, edge - 5, W, 2, 3, CYAN); }
  }
}
type Span = [number, number];
/** union of ellipse row-spans for the paw iris at scale s (grow adds px to every radius) */
function pawRow(y: number, s: number, grow: number): Span[] {
  const cx = W / 2, cy = H / 2 + 6;
  const shapes: [number, number, number, number][] = [
    [cx, cy + 0.15 * s, 0.55 * s, 0.45 * s],
    [cx - 0.62 * s, cy - 0.3 * s, 0.19 * s, 0.23 * s], [cx + 0.62 * s, cy - 0.3 * s, 0.19 * s, 0.23 * s],
    [cx - 0.25 * s, cy - 0.68 * s, 0.2 * s, 0.25 * s], [cx + 0.25 * s, cy - 0.68 * s, 0.2 * s, 0.25 * s],
  ];
  const out: Span[] = [];
  for (const [ex, ey, rx0, ry0] of shapes) {
    const rx = rx0 + grow, ry = ry0 + grow; if (rx0 <= 0.5) continue;
    const dy = (y + 0.5 - ey) / ry; const t = 1 - dy * dy; if (t < 0) continue;
    const hw = rx * Math.sqrt(t); out.push([Math.round(ex - hw), Math.round(ex + hw)]);
  }
  out.sort((a, b) => a[0] - b[0]);
  const m: Span[] = [];
  for (const sp of out) { const l = m[m.length - 1]; if (l && sp[0] <= l[1]) l[1] = Math.max(l[1], sp[1]); else m.push([sp[0], sp[1]]); }
  return m;
}
function fillOutside(ctx: CanvasRenderingContext2D, y: number, spans: Span[], color: string) {
  ctx.fillStyle = color; let x = 0;
  for (const [a, b] of spans) { if (a > x) ctx.fillRect(x, y, Math.min(a, W) - x, 1); x = Math.max(x, b); }
  if (x < W) ctx.fillRect(x, y, W - x, 1);
}
function fillBetween(ctx: CanvasRenderingContext2D, y: number, outer: Span[], inner: Span[], color: string) {
  ctx.fillStyle = color;
  for (const [a, b] of outer) {
    let x = a;
    for (const [c, d] of inner) { if (d <= x || c >= b) continue; if (c > x) ctx.fillRect(x, y, c - x, 1); x = Math.max(x, d); }
    if (x < b) ctx.fillRect(x, y, b - x, 1);
  }
}
/** iris: a paw-print shaped hole, pixel-exact row spans, with cyan + pink rims */
function pawIris(ctx: CanvasRenderingContext2D, k: number) {
  if (k <= 0) return;
  if (k >= 1) { ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H); return; }
  const e = 1 - k; const s = e * e * 1000;
  for (let y = 0; y < H; y++) {
    const o = pawRow(y, s, 5), m = pawRow(y, s, 3), i = pawRow(y, s, 0);
    fillOutside(ctx, y, o, INK);
    fillBetween(ctx, y, o, m, CYAN);
    fillBetween(ctx, y, m, i, PINK);
  }
}
/** futuristic sector title card: scan line -> chamfered panel -> typed text -> collapse */
function titleCard(ctx: CanvasRenderingContext2D, name: string, sub: string, idx: number, total: number, e: number, left: number) {
  const cx = PF_X + PF_W / 2, cy = 162;
  const open = Math.min(1, e / 12) * Math.min(1, left / 10);          // horizontal line grow / final collapse
  const tall = Math.max(0, Math.min(1, (e - 10) / 12, (left - 10) / 12)); // vertical open
  const halfW = Math.round(((PF_W - 24) / 2) * open);
  if (halfW <= 0) return;
  const hh = Math.round(36 * tall);
  const x0 = cx - halfW, x1 = cx + halfW, y0 = cy - hh, y1 = cy + hh;
  if (hh > 0) {
    const ch = Math.min(10, hh); // chamfer top-left + bottom-right
    for (let y = y0; y < y1; y++) {
      const top = y - y0, bot = y1 - 1 - y;
      const l = x0 + Math.max(0, ch - top), r = x1 - Math.max(0, ch - bot);
      ctx.fillStyle = (y - y0) % 3 === 2 ? DEEP : INK; ctx.fillRect(l, y, r - l, 1); // solid panel with scanlines (no see-through ghosts)
      ctx.fillStyle = TEAL; ctx.fillRect(l, y, 1, 1); ctx.fillRect(r - 1, y, 1, 1);
    }
    ctx.fillStyle = CYAN;
    ctx.fillRect(x0 + ch, y0, x1 - x0 - ch, 1); ctx.fillRect(x0, y1 - 1, x1 - x0 - ch, 1);
    for (let i = 0; i < ch; i++) { ctx.fillRect(x0 + ch - 1 - i, y0 + i, 1, 1); ctx.fillRect(x1 - ch + i, y1 - 1 - i, 1, 1); }
    // corner brackets, registered exactly on the square corners of the panel
    ctx.fillStyle = PINK;
    ctx.fillRect(x1 - 14, y0, 14, 2); ctx.fillRect(x1 - 2, y0, 2, 8);
    ctx.fillRect(x0, y1 - 2, 14, 2); ctx.fillRect(x0, y1 - 8, 2, 8);
    ctx.fillStyle = TEAL; for (let x = x0 + ch + 6; x < x1 - 20; x += 8) ctx.fillRect(x, y0 + 2, 1, (x / 8) % 4 ? 1 : 3);
  } else if (e < 30) { ctx.fillStyle = CYAN; ctx.fillRect(x0, cy, x1 - x0, 1); ctx.fillStyle = INK; ctx.fillRect(x0, cy + 1, x1 - x0, 1); }
  // (closing: the panel folds shut and is simply gone; no stray 1px scan line lingers across the playfield)
  // closing: the words are clipped to the folding panel (never an empty plate outliving its text)
  if (hh < 3) return;
  ctx.save(); ctx.beginPath(); ctx.rect(x0, y0 + 1, x1 - x0, y1 - y0 - 2); ctx.clip();
  const typed = (str: string, start: number, speed = 1.5) => str.slice(0, Math.max(0, Math.floor((e - start) * speed)));
  const label = `SECTOR ${String(idx).padStart(2, '0')}`;
  const lx = x0 + 16;
  text(ctx, typed(label, 22), lx, y0 + 8, CYAN);
  const meta = `${String(idx).padStart(2, '0')}/${String(total).padStart(2, '0')}`;
  if (e > 30) { text(ctx, meta, x1 - 18, y0 + 8, VIOLET, { align: 'right' }); ctx.fillStyle = MAG; for (let i = 0; i < 3; i++) chevron(ctx, lx + 60 + i * 6, y0 + 8, (Math.floor(e / 4) % 3) === i ? PINK : MAG); }
  const nm = typed(name, 28, 1.2); const nw = textWidth(name, 2);
  text(ctx, nm, cx - nw / 2, cy - 7, '#ffffff', { scale: 2, shadow: MAG });
  if (Math.floor(e / 6) % 2 === 0 && nm.length < name.length) { ctx.fillStyle = CYAN; ctx.fillRect(cx - nw / 2 + textWidth(nm, 2) + 2, cy - 7, 8, 14); }
  if (sub && e > 46) { // whole subtitle revealed by a left-to-right wipe over 12 ticks (never a truncated line)
    const sw = textWidth(sub), sx = cx - sw / 2, k = Math.min(1, (e - 46) / 12);
    ctx.save(); ctx.beginPath(); ctx.rect(sx - 1, cy + 11, Math.ceil((sw + 2) * k), 12); ctx.clip();
    text(ctx, sub, sx, cy + 13, VIOLET); ctx.restore();
    if (k < 1) { ctx.fillStyle = CYAN; ctx.fillRect(sx - 1 + Math.ceil((sw + 2) * k), cy + 11, 1, 9); }
  }
  // progress bar
  const bw = Math.round((x1 - x0 - 40) * Math.min(1, Math.max(0, (e - 30) / 80)));
  ctx.fillStyle = DEEP; ctx.fillRect(x0 + 20, y1 - 6, x1 - x0 - 40, 2); ctx.fillStyle = CYAN; ctx.fillRect(x0 + 20, y1 - 6, bw, 2);
  ctx.restore();
}
function chevron(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.fillStyle = color; for (let i = 0; i < 4; i++) { ctx.fillRect(x + i, y + i, 2, 1); ctx.fillRect(x + i, y + 6 - i, 2, 1); }
}
export const makeWorld = (): Module => new World();
