import type { Game, Module } from '../core/game';
import { W, H } from '../core/game';
import type { EnemyDef, QuestDef, MemoryDef } from '../core/types';
import { text, textWidth, wrap } from '../art/font';
import { spriteCanvas } from '../art/sprite';
import { C, frame, scanlines, rect, chamferFill, chamferLine, ticks, icon, arrow, segBar, bar, keycap, capWidth, dimRect, keys, darkOf, disc, type Device } from '../ui/draw';
import { headline, num } from '../ui/numerals';
import { photo, lockedPhoto, PHOTO_W, PHOTO_H, THUMB } from './photos';

// Pom's Journal: a holo-scrapbook with QUESTS / MEMORIES / BESTIARY / STATS tabs.
// Everything is pixel exact: integer fillRects and cached sprite canvases, palette colours only.
// Navigation: arrows move inside a tab (and flip to the neighbouring tab at the edges), up from the top row
// focuses the tab bar, Q/E, Tab or the gamepad shoulders jump tabs, SPACE/A opens a memory, ESC/B closes.
// Touch/mouse: tap a tab or an item (tap a selected memory to view it), tap the X to close.

const TABS = [
  { id: 'quests', label: 'QUESTS', icon: 'flag', accent: C.gold },
  { id: 'memories', label: 'MEMORIES', icon: 'photo', accent: C.pink },
  { id: 'bestiary', label: 'BESTIARY', icon: 'cat', accent: C.line },
  { id: 'stats', label: 'STATS', icon: 'star', accent: C.violet },
] as const;
type TabId = typeof TABS[number]['id'];
interface Box { x: number; y: number; w: number; h: number }
interface Hit extends Box { kind: 'tab' | 'item' | 'close' | 'viewer'; i: number }
interface Layout { panel: Box; grid: Box; detail: Box; hints: boolean; touch: boolean }

const BEHAVIOR: Record<string, string> = {
  basic: 'GRUNT', diver: 'DIVER', shooter: 'SPITTER', splitter: 'SPLITTER', tank: 'TANK', capturer: 'CAPTURER',
  zigzag: 'ZIGZAG', boss: 'BIG CAT',
};
const START_HINT: Record<string, string> = {
  'memory:get': 'This page is still blank. It fills in with your first polaroid.',
  'bonus:start': 'This page is still blank. Reach a Treat Bonanza to start it.',
  'wave:clear': 'This page is still blank. Clear any wave of cats to start it.',
  'boss:start': 'This page is still blank. Face your first big cat to start it.',
};
const SILHOUETTE: Record<string, string> = {}; for (const k of '0123456789abcdefghijklmnopqrstuv') SILHOUETTE[k] = '2';
// 7x7 icons the ui kit does not have
const MINI: Record<string, string[]> = {
  check: ['......#', '.....##', '#...##.', '##.##..', '.###...', '..#....', '.......'],
  close: ['##...##', '.##.##.', '..###..', '..###..', '.##.##.', '##...##', '.......'],
  crown: ['#..#..#', '##.#.##', '#######', '#######', '.#####.', '.......', '.......'],
};
function mini(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, c: string) {
  const g = MINI[name]; ctx.fillStyle = c;
  g.forEach((r, yy) => { for (let xx = 0; xx < 7; xx++) if (r[xx] === '#') ctx.fillRect(Math.round(x) + xx, Math.round(y) + yy, 1, 1); });
}
/** Draw a cached canvas at an integer scale, top-left at (x, y). */
function blit(ctx: CanvasRenderingContext2D, c: HTMLCanvasElement | null, x: number, y: number, s = 1) {
  if (c) ctx.drawImage(c, Math.round(x), Math.round(y), c.width * s, c.height * s);
}
function spriteAt(ctx: CanvasRenderingContext2D, name: string, cx: number, cy: number, s = 1, seen = true) {
  const c = spriteCanvas(name, 0, false, seen ? undefined : SILHOUETTE); if (!c) return;
  blit(ctx, c, Math.round(cx - c.width * s / 2), Math.round(cy - c.height * s / 2), s);
}
const pad2 = (n: number) => String(n).padStart(2, '0');
const fmtTime = (t: number) => { const s = Math.floor(t / 60), m = Math.floor(s / 60), h = Math.floor(m / 60); return (h > 0 ? `${h}:${pad2(m % 60)}` : `${m}`) + `:${pad2(s % 60)}`; };
/** Two-key glyphs in hint rows. */
const DUO: Record<string, [string, string]> = { 'Q E': ['Q', 'E'], '(LB)(RB)': ['(LB)', '(RB)'] };
const capW = (k: string) => DUO[k] ? capWidth(DUO[k][0]) + 2 + capWidth(DUO[k][1]) : capWidth(k);

class Journal implements Module {
  id = 'journal';
  api = this;
  g!: Game;
  tab = 0; sel = 0; t = 0;
  focus: 'tabs' | 'items' = 'items';
  scroll = 0;
  viewer = -1;                      // memory index shown full size, -1 = closed
  private sels = [0, 0, 0, 0];      // remembered selection per tab
  private seen = new Set<string>(); // breeds / bosses met this session (derived ones are added on top)
  private hits: Hit[] = [];
  private taps: [number, number][] = [];
  private jump = 0;                 // pending tab jump from Q/E/Tab
  private pad = [false, false];     // previous shoulder button state

  init(g: Game) {
    this.g = g;
    g.bus.on('cat:boop', (p: any) => { if (p?.breed) this.seen.add(p.breed); });
    g.bus.on('boss:start', (p: any) => { if (p?.bossId) this.seen.add(p.bossId); });
    if (typeof window === 'undefined' || typeof document === 'undefined' || g.headless) return;
    const pt = (cx: number, cy: number) => {
      const c = document.getElementById('game') as HTMLCanvasElement | null; if (!c || !this.isOpen()) return;
      const r = c.getBoundingClientRect(); if (!r.width || !r.height) return;
      this.taps.push([Math.floor((cx - r.left) / r.width * W), Math.floor((cy - r.top) / r.height * H)]);
    };
    addEventListener('touchstart', e => { for (const t of Array.from(e.changedTouches)) pt(t.clientX, t.clientY); }, { passive: true });
    addEventListener('mousedown', e => pt(e.clientX, e.clientY));
    addEventListener('keydown', e => {
      if (!this.isOpen() || e.repeat) return;
      if (e.code === 'KeyQ' || e.code === 'PageUp' || (e.code === 'Tab' && e.shiftKey)) { this.jump = -1; e.preventDefault(); }
      else if (e.code === 'KeyE' || e.code === 'PageDown' || e.code === 'Tab') { this.jump = 1; e.preventDefault(); }
    });
  }
  isOpen() { return this.g?.mods.ui?.menuOpen === 'journal'; }
  open() { this.sel = Math.min(this.sels[this.tab] ?? 0, Math.max(0, this.count(this.g) - 1)); this.focus = 'items'; this.viewer = -1; this.taps = []; this.jump = 0; this.scroll = 0; this.scan(); }
  /** Pull boops still in the bus log (e.g. from before the journal was listening). */
  private scan() { for (const e of this.g?.bus.log ?? []) { if (e.evt === 'cat:boop' && e.p?.breed) this.seen.add(e.p.breed); if (e.evt === 'boss:start' && e.p?.bossId) this.seen.add(e.p.bossId); } }
  /** Every breed met so far. */
  seenBreeds(g: Game) { return new Set(g.content.enemies.filter(e => this.isSeen(g, e)).map(e => e.id)); }

  // ---------------- data ----------------
  tabId(): TabId { return TABS[this.tab].id; }
  count(g: Game | undefined, tab = this.tab): number {
    if (!g) return 0; const id = TABS[tab].id;
    return id === 'quests' ? g.content.quests.length : id === 'memories' ? g.content.memories.length : id === 'bestiary' ? g.content.enemies.length : 0;
  }
  areaName(g: Game, id?: string) { return g.content.areas.find(a => a.id === id)?.name ?? 'the sky'; }
  private fields(g: Game, waveId: string, breed: string) { return !!g.content.waves.find(w => w.id === waveId)?.cats.some(c => c.breed === breed); }
  /** Area whose waves first field this breed (or whose boss it is). */
  homeArea(g: Game, e: EnemyDef): string | undefined {
    if (e.behavior === 'boss') return g.content.areas.find(a => a.boss === e.id)?.id;
    return g.content.areas.find(a => a.waves.some(w => this.fields(g, w, e.id)))?.id;
  }
  /** Seen = booped/fought this session, or fielded by a sector already cleared or a wave already passed. */
  isSeen(g: Game, e: EnemyDef): boolean {
    if (this.seen.has(e.id)) return true;
    const s = g.state;
    for (const aid of s.areasCleared) {
      const a = g.content.areas.find(a => a.id === aid); if (!a) continue;
      if (a.boss === e.id || a.waves.some(w => this.fields(g, w, e.id))) return true;
    }
    const cur = g.content.areas.find(a => a.id === s.areaId);
    if (cur && !s.areasCleared.includes(cur.id)) for (let i = 0; i < Math.min(s.waveIndex, cur.waves.length); i++) if (this.fields(g, cur.waves[i], e.id)) return true;
    return false;
  }
  questState(g: Game, q: QuestDef) { return g.state.quests[q.id] ?? 'locked'; }
  progress(g: Game, q: QuestDef) {
    const p = g.mods.quest?.progress?.(q) ?? { have: 0, need: q.complete.count ?? 1 };
    return this.questState(g, q) === 'done' ? { have: p.need, need: p.need } : p;
  }

  // ---------------- input ----------------
  update2(g: Game, close: () => void) {
    this.g = g; const I = g.input; this.t++;
    const n = this.count(g);
    const confirm = I.pressed('confirm') || I.pressed('fire');
    const blip = () => g.mods.audio?.sfx('blip');
    const shut = () => { this.taps = []; this.sels[this.tab] = this.sel; g.mods.audio?.sfx('select'); close(); };
    // the photo viewer is modal: confirm/back/tap closes it, left/right flips through found memories
    if (this.viewer >= 0) {
      const tapped = this.taps.length > 0; this.taps = []; this.jump = 0;
      if (confirm || I.pressed('back') || I.pressed('pause') || tapped) { this.viewer = -1; blip(); }
      else if (I.pressed('left') || I.pressed('right')) {
        const mem = g.content.memories; const d = I.pressed('left') ? -1 : 1;
        for (let k = 1; k <= mem.length; k++) { const j = (((this.viewer + d * k) % mem.length) + mem.length) % mem.length; if (g.state.memories.includes(mem[j].id)) { this.viewer = j; this.sel = j; break; } }
        blip();
      }
      return;
    }
    if (I.pressed('back') || I.pressed('pause')) { shut(); return; }
    // shoulder buttons (gamepad) and Q/E/Tab (keyboard) jump pages from anywhere
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    let lb = false, rb = false; for (const p of pads) if (p) { lb ||= !!p.buttons[4]?.pressed; rb ||= !!p.buttons[5]?.pressed; }
    if (lb && !this.pad[0]) this.jump = -1; if (rb && !this.pad[1]) this.jump = 1; this.pad = [lb, rb];
    if (this.jump) { this.switchTab(this.tab + this.jump); this.jump = 0; }
    // taps (hit rects come from the last drawn frame)
    for (const [x, y] of this.taps) {
      const h = [...this.hits].reverse().find(h => x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h); if (!h) continue;
      if (h.kind === 'close') { shut(); return; }
      if (h.kind === 'tab') { if (h.i !== this.tab) this.switchTab(h.i); this.focus = 'items'; }
      if (h.kind === 'item') {
        if (h.i === this.sel && this.focus === 'items') this.activate(g);
        else { this.sel = h.i; this.focus = 'items'; blip(); }
      }
    }
    this.taps = [];
    const cols = this.cols(this.layout(g));
    if (this.focus === 'tabs') {
      if (I.pressed('left')) this.switchTab(this.tab - 1);
      if (I.pressed('right')) this.switchTab(this.tab + 1);
      if ((I.pressed('down') || confirm) && n > 0) { this.focus = 'items'; blip(); }
      return;
    }
    if (n === 0) { // stats: no items, arrows flip pages
      if (I.pressed('left')) this.switchTab(this.tab - 1);
      if (I.pressed('right')) this.switchTab(this.tab + 1);
      if (I.pressed('up')) { this.focus = 'tabs'; blip(); }
      return;
    }
    if (I.pressed('up')) { if (this.sel - cols < 0) this.focus = 'tabs'; else this.sel -= cols; blip(); }
    if (I.pressed('down')) { const nx = this.sel + cols; if (nx < n) { this.sel = nx; blip(); } else if (Math.floor(this.sel / cols) < Math.floor((n - 1) / cols)) { this.sel = n - 1; blip(); } }
    if (I.pressed('left')) { if (cols === 1 || this.sel % cols === 0) this.switchTab(this.tab - 1); else { this.sel--; blip(); } }
    if (I.pressed('right')) { if (cols === 1 || this.sel % cols === cols - 1 || this.sel === n - 1) this.switchTab(this.tab + 1); else { this.sel++; blip(); } }
    if (confirm) this.activate(g);
  }
  /** Confirm on an item: a found memory opens the photo viewer. */
  activate(g: Game) {
    const m = this.tabId() === 'memories' ? g.content.memories[this.sel] : undefined;
    if (m && g.state.memories.includes(m.id)) { this.viewer = this.sel; g.mods.audio?.sfx('select'); return; }
    g.mods.audio?.sfx('blip');
  }
  switchTab(i: number) {
    this.sels[this.tab] = this.sel;
    this.tab = (i + TABS.length) % TABS.length; this.sel = Math.min(this.sels[this.tab] ?? 0, Math.max(0, this.count(this.g) - 1));
    this.scroll = 0;
    this.g?.mods.audio?.sfx('blip');
  }

  // ---------------- layout ----------------
  dev(g: Game): Device { return (g.mods.ui?.dev?.() ?? g.input.lastDevice ?? 'keyboard') as Device; }
  /** Desktop: list/grid left, detail right. Touch: the on-screen pad owns the lower side corners, so the
   * grid spans the top and the detail card sits bottom-centre between the pad and the OK button. */
  layout(g: Game): Layout {
    const touch = !!g.mods.ui?.touch?.visible?.(g);
    const panel = { x: 12, y: 18, w: W - 24, h: H - 22 };
    if (touch) return { panel, grid: { x: 24, y: 64, w: 592, h: 164 }, detail: { x: 132, y: 234, w: 376, h: 112 }, hints: false, touch };
    return { panel, grid: { x: 24, y: 64, w: 376, h: 254 }, detail: { x: 408, y: 64, w: 208, h: 254 }, hints: true, touch };
  }
  cell(L: Layout): { cw: number; ch: number } {
    const id = this.tabId();
    if (id === 'quests') return { cw: L.grid.w, ch: 23 };
    if (id === 'memories') return L.touch ? { cw: 64, ch: 82 } : { cw: 62, ch: 84 };
    if (id === 'bestiary') return L.touch ? { cw: 49, ch: 82 } : { cw: 62, ch: 63 };
    return { cw: L.grid.w, ch: L.grid.h };
  }
  cols(L: Layout) { return Math.max(1, Math.floor(L.grid.w / this.cell(L).cw)); }

  // ---------------- drawing ----------------
  draw(g: Game, ctx: CanvasRenderingContext2D) {
    this.g = g; this.hits = [];
    const L = this.layout(g); const P = L.panel; const acc = TABS[this.tab].accent;
    dimRect(ctx, 0, 0, W, H);
    // holo panel: chamfered frame, dot grid, scanlines, corner ticks
    frame(ctx, P.x, P.y, P.w, P.h, C.line, C.night, 8);
    ctx.fillStyle = C.indigo;
    for (let y = P.y + 8; y < P.y + P.h - 4; y += 8) for (let x = P.x + 8 + ((y >> 3) & 1) * 4; x < P.x + P.w - 4; x += 8) ctx.fillRect(x, y, 1, 1);
    scanlines(ctx, P.x + 2, P.y + 2, P.w - 4, P.h - 4);
    ticks(ctx, P.x, P.y, P.w, P.h, C.deep, 10, 3);
    if (!g.state.settings.reduceMotion) rect(ctx, P.x + 3, P.y + 4 + ((this.t >> 1) % (P.h - 8)), P.w - 6, 1, C.deep); // projector sweep
    // title plate
    const tw = 196; const tx = Math.round(W / 2 - tw / 2);
    chamferFill(ctx, tx, P.y - 12, tw, 26, C.ink, 5); chamferLine(ctx, tx, P.y - 12, tw, 26, C.mag, 5);
    headline(ctx, "POM'S JOURNAL", W / 2, P.y - 5, C.pink, C.text, C.mag);
    text(ctx, 'HOLO-SCRAPBOOK', P.x + 14, P.y + 7, C.peri);
    // close button (also a tap target)
    const bx = P.x + P.w - 27, by = P.y + 3;
    chamferFill(ctx, bx, by, 17, 15, C.ink, 3); chamferLine(ctx, bx, by, 17, 15, darkOf(C.hot), 3);
    mini(ctx, 'close', bx + 5, by + 4, C.hot);
    this.hits.push({ x: bx - 6, y: by - 6, w: 29, h: 25, kind: 'close', i: 0 });
    this.tabs(g, ctx, L);
    const id = this.tabId();
    if (id === 'quests') this.questTab(g, ctx, L);
    else if (id === 'memories') this.memoryTab(g, ctx, L);
    else if (id === 'bestiary') this.bestiaryTab(g, ctx, L);
    else this.statsTab(g, ctx, L);
    if (L.hints) this.hintBar(g, ctx, L, acc);
    if (this.viewer >= 0) this.viewerDraw(g, ctx);
  }

  tabs(g: Game, ctx: CanvasRenderingContext2D, L: Layout) {
    const w = 134, gap = 6, total = TABS.length * w + (TABS.length - 1) * gap;
    let x = Math.round(W / 2 - total / 2); const y = 38;
    rect(ctx, L.panel.x + 6, y + 18, L.panel.w - 12, 1, C.indigo);
    TABS.forEach((t, i) => {
      const on = i === this.tab; const foc = on && this.focus === 'tabs';
      const n = this.count(g, i);
      const have = t.id === 'quests' ? g.content.quests.filter(q => this.questState(g, q) === 'done').length
        : t.id === 'memories' ? g.content.memories.filter(m => g.state.memories.includes(m.id)).length
          : t.id === 'bestiary' ? g.content.enemies.filter(e => this.isSeen(g, e)).length : -1;
      if (on) {
        chamferFill(ctx, x, y, w, 19, C.plum, 4); chamferLine(ctx, x, y, w, 19, foc ? t.accent : C.mag, 4);
        rect(ctx, x + 4, y + 18, w - 8, 1, C.plum); // open bottom edge: the tab joins the page
        rect(ctx, x + 6, y + 1, w - 12, 1, darkOf(t.accent));
      } else { chamferFill(ctx, x, y + 2, w, 15, C.ink, 3); chamferLine(ctx, x, y + 2, w, 15, C.indigo, 3); }
      const cnt = have >= 0 ? `${have}/${n}` : '';
      const lw = 11 + textWidth(t.label) + (cnt ? 5 + textWidth(cnt) : 0);
      const lx = Math.round(x + w / 2 - lw / 2);
      icon(ctx, t.icon, lx, y + 6, on ? t.accent : C.peri, on ? C.ink : undefined);
      text(ctx, t.label, lx + 11, y + 6, on ? C.gold : C.dim, { shadow: on ? C.ink : undefined });
      if (cnt) text(ctx, cnt, lx + 16 + textWidth(t.label), y + 6, on ? t.accent : C.peri);
      if (foc) { const o = g.state.settings.reduceMotion ? 0 : (this.t >> 3) % 2; arrow(ctx, x - 4 - o, y + 9, 'l', 4, C.gold); arrow(ctx, x + w + 3 + o, y + 9, 'r', 4, C.gold); }
      this.hits.push({ x, y: y - 2, w, h: 22, kind: 'tab', i });
      x += w + gap;
    });
  }

  /** Visible window of a scrolled grid; keeps the selection in view. */
  window(L: Layout, n: number) {
    const { cw, ch } = this.cell(L); const cols = this.cols(L); const vis = Math.max(1, Math.floor(L.grid.h / ch));
    const row = Math.floor(this.sel / cols); const rows = Math.ceil(n / cols);
    if (row < this.scroll) this.scroll = row; if (row >= this.scroll + vis) this.scroll = row - vis + 1;
    this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, rows - vis)));
    const ox = L.grid.x + Math.floor((L.grid.w - cols * cw) / 2);
    return { cw, ch, cols, vis, rows, ox, first: this.scroll * cols, last: Math.min(n, (this.scroll + vis) * cols) };
  }
  scrollMarks(ctx: CanvasRenderingContext2D, L: Layout, wv: { vis: number; rows: number }) {
    if (wv.rows <= wv.vis) return;
    const x = L.grid.x + L.grid.w - 3, y = L.grid.y, h = L.grid.h;
    rect(ctx, x, y, 2, h, C.ink);
    const th = Math.max(8, Math.round(h * wv.vis / wv.rows)); const ty = y + Math.round((h - th) * this.scroll / Math.max(1, wv.rows - wv.vis));
    rect(ctx, x, ty, 2, th, C.line);
  }
  selMark(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c = C.gold) {
    const o = this.g.state.settings.reduceMotion ? 0 : ((this.t >> 4) % 2);
    ticks(ctx, x, y, w, h, this.focus === 'items' ? c : C.peri, 5, 2 + o);
  }

  // ---- QUESTS
  questTab(g: Game, ctx: CanvasRenderingContext2D, L: Layout) {
    const qs = g.content.quests; const wv = this.window(L, qs.length);
    for (let i = wv.first; i < wv.last; i++) {
      const q = qs[i]; const st = this.questState(g, q); const on = i === this.sel;
      const y = L.grid.y + (i - wv.first) * wv.ch; const x = L.grid.x + 4, w = L.grid.w - 12, h = wv.ch - 4;
      this.hits.push({ x, y, w, h: wv.ch, kind: 'item', i });
      chamferFill(ctx, x, y, w, h, on ? C.plum : st === 'locked' ? C.ink : C.panel, 3);
      chamferLine(ctx, x, y, w, h, on ? C.mag : st === 'done' ? darkOf(C.lime) : st === 'active' ? C.burnt : C.indigo, 3);
      if (on) { rect(ctx, x + 1, y + 4, 1, h - 8, C.hot); this.selMark(ctx, x, y, w, h); }
      const ic = st === 'done' ? C.lime : st === 'active' ? C.gold : C.peri;
      if (st === 'done') mini(ctx, 'check', x + 7, y + 6, ic); else icon(ctx, st === 'active' ? 'flag' : 'lock', x + 7, y + 6, ic);
      text(ctx, st === 'locked' ? '? ? ?' : q.name, x + 20, y + 6, st === 'locked' ? C.peri : on ? C.gold : C.text, { shadow: C.ink });
      if (st === 'locked') { text(ctx, 'LOCKED', x + w - 8, y + 6, C.peri, { align: 'right' }); continue; }
      const p = this.progress(g, q); const bx = x + w - 120; const c = st === 'done' ? C.lime : C.gold;
      if (p.need <= 10) segBar(ctx, bx, y + 7, p.need, Math.floor((60 - (p.need - 1)) / p.need), 5, p.have / p.need, c, C.ink);
      else bar(ctx, bx, y + 7, 60, 5, p.have / p.need, c, C.ink);
      if (st === 'done') { chamferFill(ctx, x + w - 48, y + 4, 40, 11, darkOf(C.lime), 2); text(ctx, 'DONE', x + w - 28, y + 6, C.cream, { align: 'center' }); }
      else text(ctx, `${p.have}/${p.need}`, x + w - 8, y + 6, C.gold, { align: 'right' });
    }
    this.scrollMarks(ctx, L, wv);
    const q = qs[this.sel]; if (q) this.questDetail(g, ctx, L.detail, q);
  }
  questDetail(g: Game, ctx: CanvasRenderingContext2D, D: Box, q: QuestDef) {
    const st = this.questState(g, q); const p = this.progress(g, q); const wide = D.w > D.h * 2;
    const acc = st === 'done' ? C.lime : st === 'active' ? C.gold : C.peri; const lock = st === 'locked';
    this.detailFrame(ctx, D, acc);
    // medal sticker on a ribbon
    const mx = wide ? D.x + 36 : Math.round(D.x + D.w / 2), my = wide ? D.y + 46 : D.y + 40;
    rect(ctx, mx - 8, my - 26, 6, 14, lock ? C.indigo : C.hot); rect(ctx, mx + 2, my - 26, 6, 14, lock ? C.indigo : C.line);
    rect(ctx, mx - 8, my - 26, 6, 1, lock ? C.peri : C.pink); rect(ctx, mx + 2, my - 26, 6, 1, lock ? C.peri : C.ice);
    disc(ctx, mx, my, 13, lock ? C.ink : darkOf(acc)); disc(ctx, mx, my - 1, 12, lock ? C.panel2 : acc); disc(ctx, mx, my - 1, 8, lock ? C.indigo : darkOf(acc));
    if (st === 'done') mini(ctx, 'check', mx - 3, my - 4, C.cream); else icon(ctx, st === 'active' ? 'flag' : 'lock', mx - 3, my - 4, lock ? C.peri : C.cream);
    const tx = wide ? D.x + 72 : D.x + 12; let y = wide ? D.y + 10 : D.y + 64; const cw = Math.floor((D.x + D.w - 10 - tx) / 6);
    text(ctx, lock ? 'UNKNOWN QUEST' : q.name, wide ? tx : D.x + D.w / 2, y, lock ? C.dim : C.gold, { align: wide ? 'left' : 'center', shadow: C.ink }); y += 12;
    const tag = st === 'done' ? 'COMPLETE' : st === 'active' ? 'IN PROGRESS' : 'LOCKED';
    const tgw = textWidth(tag) + 8; const tgx = wide ? tx : Math.round(D.x + D.w / 2 - tgw / 2);
    chamferFill(ctx, tgx, y - 2, tgw, 11, lock ? C.night : darkOf(acc), 2); text(ctx, tag, tgx + 4, y, lock ? C.peri : C.cream); y += 15;
    if (!lock) { bar(ctx, tx, y, D.x + D.w - 12 - tx - 40, 6, p.have / p.need, acc, C.night); text(ctx, `${p.have}/${p.need}`, D.x + D.w - 12, y, acc, { align: 'right' }); y += 14; }
    for (const l of wrap(lock ? this.startHint(g, q) : q.desc, cw).slice(0, wide ? 4 : 8)) { text(ctx, l, tx, y, lock ? C.dim : C.text); y += 10; }
    const rw = this.rewardText(q); y = D.y + D.h - 16;
    if (rw) { icon(ctx, 'gift', tx, y, lock ? C.peri : C.pink); text(ctx, 'REWARD ' + rw, tx + 11, y, st === 'done' ? C.dim : lock ? C.peri : C.pink); }
  }
  startHint(g: Game, q: QuestDef): string {
    const a = q.start.match?.areaId as string | undefined;
    if (q.start.on === 'area:enter' && a) return `This page is still blank. It fills in when you reach ${this.areaName(g, a)}.`;
    return START_HINT[q.start.on] ?? 'This page is still blank. Keep flying!';
  }
  rewardText(q: QuestDef) {
    const r = q.reward; const out: string[] = [];
    if (r.score) out.push(`+${r.score} PTS`);
    for (const [k, v] of Object.entries(r.items ?? {})) out.push(`${v}x ${k.replace(/_/g, ' ')}`);
    return out.join('  ');
  }

  // ---- MEMORIES
  memoryTab(g: Game, ctx: CanvasRenderingContext2D, L: Layout) {
    const ms = g.content.memories; const wv = this.window(L, ms.length);
    for (let i = wv.first; i < wv.last; i++) {
      const k = i - wv.first; const col = k % wv.cols, row = Math.floor(k / wv.cols);
      const cx = wv.ox + col * wv.cw, cy = L.grid.y + row * wv.ch;
      this.hits.push({ x: cx, y: cy, w: wv.cw, h: wv.ch, kind: 'item', i });
      const lift = i === this.sel && !g.state.settings.reduceMotion ? 2 : 0;
      this.polaroid(g, ctx, ms[i], i, cx + Math.floor((wv.cw - 52) / 2), cy + 6 + (i % 2 ? 2 : 0) - lift, i === this.sel);
    }
    this.scrollMarks(ctx, L, wv);
    const m = ms[this.sel]; if (m) this.memoryDetail(g, ctx, L.detail, m, this.sel);
  }
  /** 52x64 polaroid: 44x40 photo crop, number on the caption strip, a strip of tape. */
  polaroid(g: Game, ctx: CanvasRenderingContext2D, m: MemoryDef, i: number, x: number, y: number, on: boolean) {
    const got = g.state.memories.includes(m.id);
    const w = 52, h = 64;
    rect(ctx, x + 2, y + 2, w, h, C.deep); // holo drop shadow
    rect(ctx, x, y, w, h, got ? C.cream : C.indigo); rect(ctx, x, y, w, 1, got ? C.text : C.peri); rect(ctx, x, y + h - 1, w, 1, got ? C.pale : C.night);
    const ph = got ? photo(m.id, m.area) : lockedPhoto();
    if (ph) ctx.drawImage(ph, THUMB.x, THUMB.y, THUMB.w, THUMB.h, x + 4, y + 4, THUMB.w, THUMB.h);
    if (!got) text(ctx, '?', x + 24, y + 14, C.dim);
    text(ctx, `#${pad2(i + 1)}`, x + w / 2, y + 50, got ? C.indigo : C.peri, { align: 'center' });
    const tx = x + 16 + (i % 3) * 3; // tape, nudged per photo so the grid feels hand-stuck
    rect(ctx, tx, y - 3, 14, 6, got ? C.pale : C.peri); rect(ctx, tx, y - 3, 14, 1, got ? C.text : C.dim);
    ctx.fillStyle = got ? C.dim : C.indigo; ctx.fillRect(tx, y + 2, 1, 1); ctx.fillRect(tx + 13, y - 3, 1, 1);
    if (on) this.selMark(ctx, x, y - 3, w + 2, h + 5, C.gold);
  }
  memoryDetail(g: Game, ctx: CanvasRenderingContext2D, D: Box, m: MemoryDef, i: number) {
    const got = g.state.memories.includes(m.id); const wide = D.w > D.h * 2;
    this.detailFrame(ctx, D, got ? C.pink : C.peri);
    const pw = PHOTO_W + 8, ph = PHOTO_H + 20; // big polaroid (photo 88x64)
    const px = wide ? D.x + 12 : Math.round(D.x + D.w / 2 - pw / 2), py = wide ? D.y + 13 : D.y + 14;
    rect(ctx, px + 2, py + 2, pw, ph, C.deep); rect(ctx, px, py, pw, ph, got ? C.cream : C.indigo); rect(ctx, px, py, pw, 1, got ? C.text : C.peri);
    blit(ctx, got ? photo(m.id, m.area) : lockedPhoto(), px + 4, py + 4);
    if (!got) text(ctx, '?', px + pw / 2 + 1, py + 22, C.dim, { align: 'center' });
    text(ctx, got ? m.title.slice(0, 15) : '? ? ?', px + pw / 2, py + PHOTO_H + 8, got ? C.indigo : C.peri, { align: 'center' });
    rect(ctx, px + pw / 2 - 9, py - 4, 18, 7, got ? C.pale : C.peri); rect(ctx, px + pw / 2 - 9, py - 4, 18, 1, got ? C.text : C.dim);
    const tx = wide ? px + pw + 14 : D.x + 12; let y = wide ? D.y + 10 : py + ph + 9; const cw = Math.floor((D.x + D.w - 10 - tx) / 6);
    if (got) {
      text(ctx, `MEMORY #${pad2(i + 1)}`, tx, y, C.pink); y += 12;
      for (const l of wrap(m.text, cw).slice(0, wide ? 7 : 10)) { text(ctx, l, tx, y, C.text); y += 10; }
    } else {
      text(ctx, 'NOT FOUND YET', tx, y, C.dim); y += 12;
      const hint = `Somewhere in ${this.areaName(g, m.area)}, wave ${m.wave + 1}. Watch for a glowing cat carrying a polaroid and boop it gently.`;
      for (const l of wrap(hint, cw).slice(0, 6)) { text(ctx, l, tx, y, C.peri); y += 10; }
    }
    const yy = D.y + D.h - 14; icon(ctx, 'flag', tx, yy, got ? C.pink : C.peri);
    text(ctx, `${this.areaName(g, m.area)} W${m.wave + 1}`.slice(0, cw - 2), tx + 10, yy, C.dim);
  }
  viewerDraw(g: Game, ctx: CanvasRenderingContext2D) {
    const m = g.content.memories[this.viewer]; if (!m) return;
    dimRect(ctx, 0, 0, W, H);
    const pw = PHOTO_W * 2 + 16, ph = PHOTO_H * 2 + 32; const tw = 264;
    const total = pw + 18 + tw; const x = Math.round(W / 2 - total / 2), y = Math.round(H / 2 - ph / 2);
    rect(ctx, x + 3, y + 3, pw, ph, C.deep); rect(ctx, x, y, pw, ph, C.cream); rect(ctx, x, y, pw, 1, C.text); rect(ctx, x, y + ph - 1, pw, 1, C.pale);
    blit(ctx, photo(m.id, m.area), x + 8, y + 8, 2);
    text(ctx, m.title, x + pw / 2, y + PHOTO_H * 2 + 15, C.indigo, { align: 'center' });
    rect(ctx, x + pw / 2 - 16, y - 5, 32, 9, C.pale); rect(ctx, x + pw / 2 - 16, y - 5, 32, 1, C.text);
    const bx = x + pw + 18, by = y + 6, bh = ph - 12; frame(ctx, bx, by, tw, bh, C.pink, C.night, 6);
    text(ctx, `MEMORY #${pad2(this.viewer + 1)}`, bx + 12, by + 12, C.pink);
    wrap(m.text, 40).slice(0, 8).forEach((l, k) => text(ctx, l, bx + 12, by + 28 + k * 11, C.text));
    icon(ctx, 'flag', bx + 12, by + bh - 34, C.peri); text(ctx, this.areaName(g, m.area), bx + 22, by + bh - 34, C.dim);
    const dev = this.dev(g); const k = keys(dev);
    if (dev === 'touch') text(ctx, 'TAP TO CLOSE', bx + 12, by + bh - 18, C.dim);
    else { let hx = bx + 12; hx += keycap(ctx, '< >', hx, by + bh - 18, C.pink) + 4; text(ctx, 'FLIP', hx, by + bh - 18, C.dim); hx += textWidth('FLIP') + 12; hx += keycap(ctx, k.back, hx, by + bh - 18, C.pink) + 4; text(ctx, 'BACK', hx, by + bh - 18, C.dim); }
    this.hits.push({ x: 0, y: 0, w: W, h: H, kind: 'viewer', i: 0 });
  }

  // ---- BESTIARY
  bestiaryTab(g: Game, ctx: CanvasRenderingContext2D, L: Layout) {
    const es = g.content.enemies; const wv = this.window(L, es.length);
    for (let i = wv.first; i < wv.last; i++) {
      const k = i - wv.first; const col = k % wv.cols, row = Math.floor(k / wv.cols);
      const x = wv.ox + col * wv.cw + 2, y = L.grid.y + row * wv.ch + 2, w = wv.cw - 4, h = wv.ch - 4;
      const e = es[i]; const seen = this.isSeen(g, e); const on = i === this.sel; const boss = e.behavior === 'boss';
      this.hits.push({ x: x - 2, y: y - 2, w: wv.cw, h: wv.ch, kind: 'item', i });
      chamferFill(ctx, x, y, w, h, on ? C.plum : seen ? C.panel : C.ink, 4);
      chamferLine(ctx, x, y, w, h, on ? C.mag : boss ? (seen ? C.burnt : C.indigo) : seen ? C.deep : C.indigo, 4);
      const cx = x + Math.floor(w / 2), cy = y + Math.floor(h / 2) - 4;
      rect(ctx, cx - 14, y + h - 13, 28, 1, seen ? (boss ? C.burnt : C.deep) : C.indigo); // holo pad
      if (boss) {
        const port = 'portrait_' + e.sprite.replace(/^boss_/, '');
        spriteAt(ctx, spriteCanvas(port) ? port : e.sprite, cx, cy, 1, seen);
        mini(ctx, 'crown', x + 4, y + 4, seen ? C.gold : C.indigo);
      } else spriteAt(ctx, e.sprite, cx, cy, 1, seen);
      if (!seen) text(ctx, '?', cx - 2, cy - 3, C.dim);
      text(ctx, pad2(i + 1), x + w - 4, y + h - 10, on ? C.gold : seen ? C.dim : C.peri, { align: 'right' });
      if (on) this.selMark(ctx, x, y, w, h, boss ? C.gold : C.line);
    }
    this.scrollMarks(ctx, L, wv);
    const e = es[this.sel]; if (e) this.bestiaryDetail(g, ctx, L.detail, e, this.sel);
  }
  bestiaryDetail(g: Game, ctx: CanvasRenderingContext2D, D: Box, e: EnemyDef, i: number) {
    const seen = this.isSeen(g, e); const boss = e.behavior === 'boss'; const wide = D.w > D.h * 2;
    const acc = !seen ? C.peri : boss ? C.gold : C.line;
    this.detailFrame(ctx, D, acc);
    // specimen bay: scanline floor + sprite (cats at 2x, kittens 3x, bosses 1x: all ~64px)
    const bw = 84, bh = wide ? 92 : 84; const bx = wide ? D.x + 10 : Math.round(D.x + D.w / 2 - bw / 2), by = D.y + 10;
    chamferFill(ctx, bx, by, bw, bh, C.night, 5); chamferLine(ctx, bx, by, bw, bh, darkOf(acc), 5);
    for (let yy = by + 4; yy < by + bh - 4; yy += 4) rect(ctx, bx + 4, yy, bw - 8, 1, C.ink);
    rect(ctx, bx + 12, by + bh - 9, bw - 24, 1, seen ? acc : C.indigo); rect(ctx, bx + 18, by + bh - 7, bw - 36, 1, darkOf(acc));
    const bob = !seen || g.state.settings.reduceMotion ? 0 : ((this.t >> 5) % 2);
    const sc = spriteCanvas(e.sprite); const s = sc && sc.width <= 32 ? (sc.width <= 16 ? 3 : 2) : 1;
    spriteAt(ctx, e.sprite, bx + bw / 2, by + bh / 2 - 4 - bob, s, seen);
    if (!seen) text(ctx, '?', bx + bw / 2, by + bh / 2 - 8, C.dim, { align: 'center' });
    const tx = wide ? bx + bw + 12 : D.x + 12; let y = wide ? D.y + 10 : by + bh + 8; const cw = Math.floor((D.x + D.w - 10 - tx) / 6);
    text(ctx, `NO.${pad2(i + 1)}`, tx, y, C.peri);
    const tag = seen ? BEHAVIOR[e.behavior] ?? e.behavior.toUpperCase() : 'UNKNOWN'; const tgw = textWidth(tag) + 8;
    chamferFill(ctx, D.x + D.w - 10 - tgw, y - 2, tgw, 11, seen ? darkOf(acc) : C.night, 2); text(ctx, tag, D.x + D.w - 6 - tgw, y, seen ? C.cream : C.peri);
    y += 13;
    text(ctx, seen ? e.name : '? ? ?', tx, y, seen ? (boss ? C.gold : C.text) : C.dim, { shadow: C.ink }); y += 13;
    if (seen) {
      icon(ctx, 'star', tx, y, C.gold); text(ctx, `${e.points} PTS`, tx + 10, y, C.gold);
      const hx = tx + 10 + textWidth(`${e.points} PTS`) + 10;
      icon(ctx, 'heart', hx, y, C.hot); text(ctx, `HP ${e.hp}`, hx + 10, y, C.pink);
      y += 10;
      if (boss) bar(ctx, tx, y, Math.min(120, D.x + D.w - 12 - tx), 3, e.hp / 300, C.hot, C.night);
      else segBar(ctx, tx, y, 3, 9, 3, e.hp / 3, C.hot, C.night);
      y += 9;
      for (const l of wrap(e.bestiary, cw).slice(0, wide ? 4 : 7)) { text(ctx, l, tx, y, C.text); y += 10; }
    } else {
      for (const l of wrap('Not booped yet. Scanner data is fuzzy: one gentle boop and this page fills in.', cw).slice(0, 4)) { text(ctx, l, tx, y, C.peri); y += 10; }
    }
    const home = this.homeArea(g, e);
    if (home) { const yy = D.y + D.h - 14; icon(ctx, 'flag', tx, yy, C.peri); text(ctx, ((boss ? 'BOSS OF ' : 'SEEN IN ') + this.areaName(g, home)).slice(0, cw - 2), tx + 10, yy, C.dim); }
  }

  // ---- STATS
  statsTab(g: Game, ctx: CanvasRenderingContext2D, L: Layout) {
    const s = g.state; const st = s.stats; const ct = g.content;
    const aim = st.shots ? Math.round(100 * st.hits / st.shots) : 0;
    const pups = ct.quests.find(q => q.id === 'lost_pups'); const pp = pups ? this.progress(g, pups) : null;
    const qDone = ct.quests.filter(q => this.questState(g, q) === 'done').length;
    const seen = ct.enemies.filter(e => this.isSeen(g, e)).length;
    const frac = (a: number, b: number) => a / Math.max(1, b);
    const tiles: [string, string, string, string, number, string][] = [
      ['star', 'SCORE', String(s.score), C.gold, -1, 'THIS FLIGHT'],
      ['star', 'HI SCORE', String(Math.max(s.hiScore, s.score)), C.gold, -1, 'PERSONAL BEST'],
      ['cat', 'CATS BOOPED', String(st.catsBooped), C.line, -1, 'GENTLY, ALWAYS'],
      ['bolt', 'TURDS TOOTED', String(st.shots), C.orange, -1, `${st.hits} DIRECT HITS`],
      ['wave', 'AIM', aim + '%', C.lime, aim / 100, aim >= 60 ? 'SHARP NOSE' : 'KEEP SNIFFING'],
      ['moon', 'NAPS TAKEN', String(st.naps), C.violet, -1, st.naps ? 'WELL RESTED' : 'NO NAPS YET'],
      ['clock', 'FLIGHT TIME', fmtTime(st.playTicks), C.line, -1, 'TIME ALOFT'],
      ['pup', 'PUPS SAVED', pp ? `${pp.have}/${pp.need}` : '0', C.pink, pp ? frac(pp.have, pp.need) : -1, 'WINGMEN FOUND'],
      ['photo', 'MEMORIES', `${s.memories.length}/${ct.memories.length}`, C.pink, frac(s.memories.length, ct.memories.length), 'POLAROIDS'],
      ['flag', 'QUESTS', `${qDone}/${ct.quests.length}`, C.gold, frac(qDone, ct.quests.length), 'PAGES FILLED'],
      ['paw', 'SECTORS', `${s.areasCleared.length}/${ct.areas.length}`, C.lime, frac(s.areasCleared.length, ct.areas.length), 'CLEARED'],
      ['cat', 'BESTIARY', `${seen}/${ct.enemies.length}`, C.line, frac(seen, ct.enemies.length), 'BREEDS LOGGED'],
    ];
    const B = L.touch ? L.grid : { x: L.grid.x, y: L.grid.y, w: L.detail.x + L.detail.w - L.grid.x, h: L.grid.h };
    const cols = 4, rows = 3, gap = 6; const tw = Math.floor((B.w - gap * (cols - 1)) / cols), th = Math.floor((B.h - gap * (rows - 1)) / rows);
    tiles.forEach(([ic, lbl, val, c, p, sub], i) => {
      const x = B.x + (i % cols) * (tw + gap), y = B.y + Math.floor(i / cols) * (th + gap);
      frame(ctx, x, y, tw, th, c, C.panel, 5);
      icon(ctx, ic, x + 9, y + 9, c, C.ink); text(ctx, lbl, x + 20, y + 9, C.dim);
      if (th >= 60) {
        const pct = val.endsWith('%'); // the big face's % is cramped: draw it in the small face
        const nw = num(ctx, pct ? val.slice(0, -1) : val, x + 10, y + 26, C.text, { hi: C.cream, shadow: darkOf(c) });
        if (pct) text(ctx, '%', x + 12 + nw, y + 30, C.cream, { shadow: darkOf(c) });
        text(ctx, sub, x + 10, y + 44, C.peri);
        if (p >= 0) bar(ctx, x + 10, y + th - 14, tw - 20, 3, p, c, C.ink); else rect(ctx, x + 10, y + th - 13, tw - 20, 1, C.indigo);
      } else {
        text(ctx, val, x + tw - 9, y + 24, C.text, { align: 'right' });
        if (p >= 0) bar(ctx, x + 9, y + th - 10, tw - 18, 2, p, c, C.ink);
      }
    });
  }

  // ---- shared bits
  detailFrame(ctx: CanvasRenderingContext2D, D: Box, acc: string) {
    frame(ctx, D.x, D.y, D.w, D.h, acc, C.ink, 6);
    rect(ctx, D.x + 6, D.y + 2, D.w - 12, 1, C.night);
  }
  hintBar(g: Game, ctx: CanvasRenderingContext2D, L: Layout, acc: string) {
    const dev = this.dev(g); const k = keys(dev);
    const pairs: [string, string][] = [[dev === 'gamepad' ? 'D-PAD' : 'ARROWS', 'BROWSE'], [dev === 'gamepad' ? '(LB)(RB)' : 'Q E', 'PAGE']];
    if (this.tabId() === 'memories') pairs.push([k.ok, 'VIEW']);
    pairs.push([k.back, 'CLOSE']);
    const gap = 14; const widths = pairs.map(([kk, c]) => capW(kk) + 4 + textWidth(c));
    let x = Math.round(W / 2 - (widths.reduce((a, b) => a + b, 0) + gap * (pairs.length - 1)) / 2); const y = L.panel.y + L.panel.h - 17;
    pairs.forEach(([kk, c], i) => {
      const duo = DUO[kk];
      if (duo) { const a = keycap(ctx, duo[0], x, y, acc); keycap(ctx, duo[1], x + a + 2, y, acc); }
      else keycap(ctx, kk, x, y, acc);
      text(ctx, c, x + capW(kk) + 4, y, C.dim); x += widths[i] + gap;
    });
  }
}
export const makeJournal = (): Module => new Journal();
