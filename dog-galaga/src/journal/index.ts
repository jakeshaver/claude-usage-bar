import type { Game, Module } from '../core/game';
import { W, H } from '../core/game';
import type { EnemyDef, QuestDef, MemoryDef } from '../core/types';
import { text, textWidth, wrap } from '../art/font';
import { spriteCanvas } from '../art/sprite';
import { C, frame, scanlines, rect, chamferFill, chamferLine, ticks, icon, keycap, capWidth, dimRect, keys, darkOf, disc, arrow, type Device } from '../ui/draw';
import { headline, num } from '../ui/numerals';
import { photo, lockedPhoto, PHOTO_W, PHOTO_H, THUMB } from './photos';
import { seedJournalDemo, wantsDemo } from './demo';

// Pom's Journal: a holo-scrapbook with QUESTS / MEMORIES / BESTIARY / STATS tabs.
// Everything is pixel exact: integer fillRects and cached canvases, palette colours only.
// Navigation: arrows move inside a tab (never across tabs), Up from the top row focuses the tab bar,
// Q/E, Tab/Shift+Tab, PageUp/PageDown or the gamepad shoulders switch tabs, SPACE/A opens a memory, ESC/B closes.
// Touch/mouse: tap a tab or an item (tap a selected memory to view it), tap the X to close.
// One focus language everywhere: a 1px outline ring 2px outside the selected item (inside its gutter), which
// flashes cream for a few frames whenever the selection moves.

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
const START_TAG: Record<string, string> = { 'memory:get': 'ANY POLAROID', 'bonus:start': 'BONUS STAGE', 'wave:clear': 'ANY WAVE', 'boss:start': 'ANY BIG CAT' };
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
/**
 * Cached chamfer shapes: the ui kit draws them row by row (one fillRect per row and per edge pixel), which adds
 * up to thousands of calls per journal frame. Each distinct shape is rendered once and blitted after that.
 */
const shapes = new Map<string, HTMLCanvasElement | null>();
function shape(key: string, w: number, h: number, paint: (c: CanvasRenderingContext2D) => void): HTMLCanvasElement | null {
  let c = shapes.get(key);
  if (c === undefined) {
    if (typeof document === 'undefined' || w <= 0 || h <= 0) c = null;
    else { c = document.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d')!); }
    if (shapes.size > 400) shapes.clear();
    shapes.set(key, c);
  }
  return c;
}
function cFill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string, cut = 4) {
  const c = shape(`f${w},${h},${col},${cut}`, w, h, k => chamferFill(k, 0, 0, w, h, col, cut)); if (c) ctx.drawImage(c, Math.round(x), Math.round(y));
}
function cLine(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string, cut = 4) {
  const c = shape(`l${w},${h},${col},${cut}`, w, h, k => chamferLine(k, 0, 0, w, h, col, cut)); if (c) ctx.drawImage(c, Math.round(x), Math.round(y));
}
function cFrame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, acc: string, fill: string, cut = 5) {
  const c = shape(`F${w},${h},${acc},${fill},${cut}`, w, h, k => frame(k, 0, 0, w, h, acc, fill, cut)); if (c) ctx.drawImage(c, Math.round(x), Math.round(y));
}
/** Draw a cached canvas at an integer scale, top-left at (x, y). */
function blit(ctx: CanvasRenderingContext2D, c: HTMLCanvasElement | null, x: number, y: number, s = 1) {
  if (c) ctx.drawImage(c, Math.round(x), Math.round(y), c.width * s, c.height * s);
}
/** Opaque bounding box of a sprite canvas (cached): used to stand every specimen on the same baseline. */
const bboxes = new Map<HTMLCanvasElement, Box>();
function bbox(c: HTMLCanvasElement): Box {
  const hit = bboxes.get(c); if (hit) return hit;
  let b: Box = { x: 0, y: 0, w: c.width, h: c.height };
  try {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 >= 0) b = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  } catch { /* keep the full canvas */ }
  bboxes.set(c, b); return b;
}
/** Specimen size: every cat, kitten and boss is shown in the same 64px frame (32px cats 2x, kitten 4x, bosses 1x). */
const SPEC = 64;
/** Draw a specimen centred on cx with its feet on baseline by. */
function specimen(ctx: CanvasRenderingContext2D, e: EnemyDef, cx: number, by: number, seen: boolean) {
  const c = spriteCanvas(e.sprite, 0, false, seen ? undefined : SILHOUETTE); if (!c) return;
  const s = Math.max(1, Math.floor(SPEC / Math.max(c.width, c.height))); const b = bbox(c);
  blit(ctx, c, Math.round(cx - (b.x + b.w / 2) * s), by - (b.y + b.h) * s, s);
}
/** 0-4 threat pips: grunts by hit points, every big cat is a full 4. */
const threat = (e: EnemyDef) => e.behavior === 'boss' ? 4 : Math.max(1, Math.min(3, e.hp));
function pips(ctx: CanvasRenderingContext2D, x: number, y: number, n: number, on: string, off: string, w = 4) {
  for (let i = 0; i < 4; i++) { rect(ctx, x + i * (w + 1), y, w, 3, i < n ? on : off); if (i < n) rect(ctx, x + i * (w + 1), y, w, 1, i < n && on === C.hot ? C.pink : on); }
}
const pad2 = (n: number) => String(n).padStart(2, '0');
const fmtTime = (t: number) => { const s = Math.floor(t / 60), m = Math.floor(s / 60), h = Math.floor(m / 60); return (h > 0 ? `${h}:${pad2(m % 60)}` : `${m}`) + `:${pad2(s % 60)}`; };
/** Two-key glyphs in hint rows. */
const DUO: Record<string, [string, string]> = { 'Q E': ['Q', 'E'], '(LB)(RB)': ['(LB)', '(RB)'] };
const capW = (k: string) => DUO[k] ? capWidth(DUO[k][0]) + 2 + capWidth(DUO[k][1]) : capWidth(k);
/**
 * The one progress bar of the journal: solid fill, dark notches at fixed tick positions (one per step for
 * small goals, tenths for big ones), always the same width in a list column.
 */
function meter(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, have: number, need: number, c: string) {
  const p = Math.max(0, Math.min(1, have / Math.max(1, need))); const f = Math.round(w * p);
  rect(ctx, x - 1, y - 1, w + 2, h + 2, C.ink); rect(ctx, x, y, w, h, C.night); rect(ctx, x, y, f, h, c);
  if (f > 0 && h > 2) rect(ctx, x, y, f, 1, c === C.lime ? C.cream : c === C.gold ? C.cream : C.text);
  const n = need <= 10 ? need : 10;
  for (let i = 1; i < n; i++) { const tx = x + Math.round(w * i / n); rect(ctx, tx, y, 1, h, tx < x + f ? darkOf(c) : C.indigo); }
}

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
  private selT = -99;               // tick of the last selection change (focus ring flash)
  private lastKey = '';
  private bg: { key: string; c: HTMLCanvasElement } | null = null; // cached static panel
  private snap: HTMLCanvasElement | null = null;                   // dimmed, frozen copy of the scene behind

  init(g: Game) {
    this.g = g;
    g.bus.on('cat:boop', (p: any) => { if (p?.breed) this.seen.add(p.breed); });
    g.bus.on('boss:start', (p: any) => { if (p?.bossId) this.seen.add(p.bossId); });
    if (typeof window === 'undefined' || typeof document === 'undefined' || g.headless) return;
    // one pointer stream (mouse, pen and touch alike): no duplicate compatibility mousedown after a touch
    addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const c = document.getElementById('game') as HTMLCanvasElement | null; if (!c || !this.isOpen()) return;
      const r = c.getBoundingClientRect(); if (!r.width || !r.height) return;
      this.taps.push([Math.floor((e.clientX - r.left) / r.width * W), Math.floor((e.clientY - r.top) / r.height * H)]);
    });
    addEventListener('keydown', e => {
      if (!this.isOpen() || e.repeat) return;
      if (e.code === 'KeyQ' || e.code === 'PageUp' || (e.code === 'Tab' && e.shiftKey)) { this.jump = -1; e.preventDefault(); }
      else if (e.code === 'KeyE' || e.code === 'PageDown' || e.code === 'Tab') { this.jump = 1; e.preventDefault(); }
    });
  }
  isOpen() { return this.g?.mods.ui?.menuOpen === 'journal'; }
  open() {
    if (wantsDemo()) seedJournalDemo(this.g);
    this.sel = Math.min(this.sels[this.tab] ?? 0, Math.max(0, this.count(this.g) - 1)); this.focus = 'items'; this.viewer = -1;
    this.taps = []; this.jump = 0; this.scroll = 0; this.snap = null; this.scan();
  }
  /** Same as the showcase's staged save; exposed so core can stage it explicitly. */
  seedDemo() { seedJournalDemo(this.g); }
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
  /** 1-based sector number of an area (its order on the star chart). */
  sector(g: Game, id?: string) { return g.content.areas.findIndex(a => a.id === id) + 1; }
  /** The player has flown past this area already (cleared it, or is further along the chart). */
  passed(g: Game, id?: string) {
    if (!id) return false; const s = g.state;
    return s.areasCleared.includes(id) || (this.sector(g, id) > 0 && this.sector(g, id) < this.sector(g, s.areaId));
  }
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
  memoryFound(g: Game, i: number) { const m = g.content.memories[i]; return !!m && g.state.memories.includes(m.id); }

  // ---------------- input ----------------
  update2(g: Game, close: () => void) {
    this.g = g; const I = g.input; this.t++;
    const n = this.count(g);
    const confirm = I.pressed('confirm') || I.pressed('fire');
    const blip = () => g.mods.audio?.sfx('blip');
    const shut = () => {
      this.taps = []; this.sels[this.tab] = this.sel; g.mods.audio?.sfx('select');
      // outside a flight there is no pause menu to fall back to: return to the title instead
      const sc = g.state.scene; if (g.mods.ui && sc !== 'play' && sc !== 'bonus' && sc !== 'dialogue') g.mods.ui.settingsFrom = 'title';
      close();
    };
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
    // shoulder buttons (gamepad) and Q/E/Tab (keyboard) switch pages from anywhere
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
    if (n === 0) { if (I.pressed('up')) { this.focus = 'tabs'; blip(); } return; } // stats: no items
    // arrows stay inside the page: the edges stop (no surprise tab change)
    if (I.pressed('up')) { if (this.sel - cols < 0) this.focus = 'tabs'; else this.sel -= cols; blip(); }
    if (I.pressed('down')) { const nx = this.sel + cols; if (nx < n) { this.sel = nx; blip(); } else if (Math.floor(this.sel / cols) < Math.floor((n - 1) / cols)) { this.sel = n - 1; blip(); } }
    if (I.pressed('left') && cols > 1 && this.sel % cols > 0) { this.sel--; blip(); }
    if (I.pressed('right') && cols > 1 && this.sel % cols < cols - 1 && this.sel < n - 1) { this.sel++; blip(); }
    if (confirm) this.activate(g);
  }
  /** Confirm on an item: a found memory opens the photo viewer. */
  activate(g: Game) {
    if (this.tabId() === 'memories' && this.memoryFound(g, this.sel)) { this.viewer = this.sel; g.mods.audio?.sfx('select'); return; }
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
   * grid spans the top and the detail card sits bottom-centre between the pad and the OK button.
   * The panel starts at y=24 so the screen-corner sound badge (y 5-21) never overlaps its frame. */
  layout(g: Game): Layout {
    const touch = !!g.mods.ui?.touch?.visible?.(g);
    const panel = { x: 12, y: 24, w: W - 24, h: H - 28 };
    if (touch) return { panel, grid: { x: 24, y: 68, w: 592, h: 164 }, detail: { x: 132, y: 236, w: 376, h: 112 }, hints: false, touch };
    return { panel, grid: { x: 24, y: 68, w: 384, h: 256 }, detail: { x: 414, y: 68, w: 202, h: 256 }, hints: true, touch };
  }
  cell(L: Layout): { cw: number; ch: number } {
    const id = this.tabId();
    if (id === 'quests') return { cw: L.grid.w, ch: 23 };
    if (id === 'memories') return L.touch ? { cw: 64, ch: 82 } : { cw: 62, ch: 84 };
    if (id === 'bestiary') return L.touch ? { cw: 73, ch: 82 } : { cw: 76, ch: 84 };
    return { cw: L.grid.w, ch: L.grid.h };
  }
  cols(L: Layout) { return Math.max(1, Math.floor(L.grid.w / this.cell(L).cw)); }

  // ---------------- drawing ----------------
  draw(g: Game, ctx: CanvasRenderingContext2D) {
    this.g = g; this.hits = [];
    const L = this.layout(g); const P = L.panel; const acc = TABS[this.tab].accent;
    const key = `${this.tab}|${this.sel}|${this.focus}`; if (key !== this.lastKey) { this.lastKey = key; this.selT = this.t; }
    // the scene behind is dimmed once when the journal opens and frozen (a per-frame palette remap reads the
    // canvas back every frame, which costs ~10 fps); only the margins around the opaque panel ever show
    if (!this.snap && typeof document !== 'undefined') {
      dimRect(ctx, 0, 0, W, H);
      const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d')!.drawImage(ctx.canvas, 0, 0, W, H, 0, 0, W, H); this.snap = c;
    } else blit(ctx, this.snap, 0, 0);
    blit(ctx, this.panelBg(L), 0, 0);
    // close button (also a tap target)
    const bx = P.x + P.w - 27, by = P.y + 4;
    cFill(ctx, bx, by, 17, 15, C.ink, 3); cLine(ctx, bx, by, 17, 15, darkOf(C.hot), 3);
    mini(ctx, 'close', bx + 5, by + 4, C.hot);
    this.hits.push({ x: bx - 6, y: by - 6, w: 29, h: 25, kind: 'close', i: 0 });
    this.tabs(g, ctx, L);
    if (this.viewer >= 0) { this.viewerDraw(g, ctx, L); return; } // the viewer replaces the page body
    const id = this.tabId();
    if (id === 'quests') this.questTab(g, ctx, L);
    else if (id === 'memories') this.memoryTab(g, ctx, L);
    else if (id === 'bestiary') this.bestiaryTab(g, ctx, L);
    else this.statsTab(g, ctx, L);
    if (L.hints) this.hintBar(g, ctx, L, acc);
  }
  /** Static panel art (frame, dot grid, scanlines, corner ticks, title plate, label) rendered once per layout. */
  panelBg(L: Layout): HTMLCanvasElement | null {
    const P = L.panel; const key = `${P.x},${P.y},${P.w},${P.h}`;
    if (this.bg?.key === key) return this.bg.c;
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d')!;
    cFrame(ctx, P.x, P.y, P.w, P.h, C.line, C.night, 8);
    ctx.fillStyle = C.indigo;
    for (let y = P.y + 8; y < P.y + P.h - 4; y += 8) for (let x = P.x + 8 + ((y >> 3) & 1) * 4; x < P.x + P.w - 4; x += 8) ctx.fillRect(x, y, 1, 1);
    scanlines(ctx, P.x + 2, P.y + 2, P.w - 4, P.h - 4);
    ticks(ctx, P.x, P.y, P.w, P.h, C.deep, 10, 3);
    // title plate sits in a notch: the frame line is cut 3px either side of it, with end caps
    const tw = 196; const tx = Math.round(W / 2 - tw / 2), ty = P.y - 12;
    rect(ctx, tx - 3, P.y, tw + 6, 2, C.night); rect(ctx, tx - 4, P.y - 2, 1, 5, darkOf(C.line)); rect(ctx, tx + tw + 3, P.y - 2, 1, 5, darkOf(C.line));
    rect(ctx, tx - 4, P.y - 2, 1, 2, C.line); rect(ctx, tx + tw + 3, P.y - 2, 1, 2, C.line);
    cFill(ctx, tx, ty, tw, 26, C.ink, 5); cLine(ctx, tx, ty, tw, 26, C.mag, 5);
    rect(ctx, tx + 6, ty + 1, tw - 12, 1, C.plum);
    headline(ctx, "POM'S JOURNAL", W / 2, ty + 7, C.pink, C.text, C.mag);
    // module label in its own little bracketed tag (readable cyan on ink)
    const lbl = 'HOLO-SCRAPBOOK'; const lw = textWidth(lbl) + 18; const lx = P.x + 12, ly = P.y + 4;
    cFill(ctx, lx, ly, lw, 11, C.ink, 3); cLine(ctx, lx, ly, lw, 11, C.deep, 3);
    rect(ctx, lx + 4, ly + 3, 3, 5, C.line); rect(ctx, lx + 4, ly + 3, 3, 1, C.ice);
    text(ctx, lbl, lx + 11, ly + 2, C.line);
    this.bg = { key, c }; return c;
  }

  tabs(g: Game, ctx: CanvasRenderingContext2D, L: Layout) {
    const w = 134, gap = 6, total = TABS.length * w + (TABS.length - 1) * gap;
    let x = Math.round(W / 2 - total / 2); const y = 42;
    rect(ctx, L.panel.x + 6, y + 18, L.panel.w - 12, 1, C.indigo);
    TABS.forEach((t, i) => {
      const on = i === this.tab; const foc = on && this.focus === 'tabs' && this.viewer < 0;
      const n = this.count(g, i);
      const have = t.id === 'quests' ? g.content.quests.filter(q => this.questState(g, q) === 'done').length
        : t.id === 'memories' ? g.content.memories.filter(m => g.state.memories.includes(m.id)).length
          : t.id === 'bestiary' ? g.content.enemies.filter(e => this.isSeen(g, e)).length : -1;
      if (on) {
        cFill(ctx, x, y, w, 19, C.plum, 4); cLine(ctx, x, y, w, 19, C.mag, 4);
        rect(ctx, x + 4, y + 18, w - 8, 1, C.plum); // open bottom edge: the tab joins the page
        rect(ctx, x + 6, y + 1, w - 12, 1, darkOf(t.accent));
        if (foc) this.ring(ctx, x, y, w, 19, 4);
      } else { cFill(ctx, x, y + 2, w, 15, C.ink, 3); cLine(ctx, x, y + 2, w, 15, C.indigo, 3); }
      const cnt = have >= 0 ? `${have}/${n}` : '';
      const lw = 11 + textWidth(t.label) + (cnt ? 5 + textWidth(cnt) : 0);
      const lx = Math.round(x + w / 2 - lw / 2);
      icon(ctx, t.icon, lx, y + 6, on ? t.accent : C.peri, on ? C.ink : undefined);
      text(ctx, t.label, lx + 11, y + 6, on ? C.gold : C.dim, { shadow: on ? C.ink : undefined });
      if (cnt) text(ctx, cnt, lx + 16 + textWidth(t.label), y + 6, on ? t.accent : C.peri);
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
  scrollMarks(ctx: CanvasRenderingContext2D, L: Layout, wv: { vis: number; rows: number; cols: number; cw: number; ox: number }) {
    if (wv.rows <= wv.vis) return;
    const x = Math.min(L.grid.x + L.grid.w - 2, wv.ox + wv.cols * wv.cw + 1), y = L.grid.y, h = wv.vis * this.cell(L).ch - 4;
    rect(ctx, x, y, 2, h, C.ink);
    const th = Math.max(8, Math.round(h * wv.vis / wv.rows)); const ty = y + Math.round((h - th) * this.scroll / Math.max(1, wv.rows - wv.vis));
    rect(ctx, x, ty, 2, th, C.line);
  }
  /** The focus ring: 1px outline 2px outside the item (inside its gutter); cream for 6 ticks after a move. */
  ring(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, cut = 0) {
    const fresh = this.t - this.selT < 6 && !this.g.state.settings.reduceMotion;
    const c = this.focus === 'items' || this.tabId() === 'stats' || cut === 4 ? (fresh ? C.cream : C.gold) : C.peri;
    if (cut) cLine(ctx, x - 2, y - 2, w + 4, h + 4, c, cut + 1);
    else { rect(ctx, x - 2, y - 2, w + 4, 1, c); rect(ctx, x - 2, y + h + 1, w + 4, 1, c); rect(ctx, x - 2, y - 1, 1, h + 2, c); rect(ctx, x + w + 1, y - 1, 1, h + 2, c); }
  }
  /** Ring for the selected item only when the item list owns focus (dim peri when the tab bar has it). */
  itemRing(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, cut = 0) {
    if (this.focus === 'items') this.ring(ctx, x, y, w, h, cut);
    else { const c = C.indigo; if (cut) cLine(ctx, x - 2, y - 2, w + 4, h + 4, c, cut + 1); else ticks(ctx, x, y, w, h, c, 3, 2); }
  }

  // ---- QUESTS
  questTab(g: Game, ctx: CanvasRenderingContext2D, L: Layout) {
    const qs = g.content.quests; const wv = this.window(L, qs.length);
    // fixed columns: counter column (right aligned, widest "need/need" or the DONE badge), 8px gutter, bar column
    const cntW = Math.max(40, ...qs.map(q => textWidth(`${q.complete.count ?? 1}/${q.complete.count ?? 1}`)));
    const barW = 84;
    for (let i = wv.first; i < wv.last; i++) {
      const q = qs[i]; const st = this.questState(g, q); const on = i === this.sel; const lock = st === 'locked';
      const y = L.grid.y + (i - wv.first) * wv.ch; const x = L.grid.x + 4, w = L.grid.w - 12, h = wv.ch - 4;
      this.hits.push({ x, y, w, h: wv.ch, kind: 'item', i });
      cFill(ctx, x, y, w, h, lock ? C.ink : C.panel, 3);
      cLine(ctx, x, y, w, h, st === 'done' ? darkOf(C.lime) : st === 'active' ? C.burnt : C.indigo, 3);
      if (on) this.itemRing(ctx, x, y, w, h, 3);
      const ic = st === 'done' ? C.lime : st === 'active' ? C.gold : C.peri;
      if (st === 'done') mini(ctx, 'check', x + 7, y + 6, ic); else icon(ctx, st === 'active' ? 'flag' : 'lock', x + 7, y + 6, ic);
      text(ctx, lock ? '? ? ?' : q.name, x + 20, y + 6, lock ? C.peri : on ? C.gold : C.text, { shadow: C.ink });
      const cx = x + w - 8; const barX = cx - cntW - 8 - barW;
      if (lock) {
        const a = q.start.match?.areaId as string | undefined; const tag = this.lockTag(g, q);
        text(ctx, tag, cx, y + 6, a && this.passed(g, a) ? C.dim : C.peri, { align: 'right' });
        continue;
      }
      const p = this.progress(g, q); const c = st === 'done' ? C.lime : C.gold;
      meter(ctx, barX, y + 7, barW, 5, p.have, p.need, c);
      if (st === 'done') { cFill(ctx, cx - 40, y + 4, 40, 11, darkOf(C.lime), 2); text(ctx, 'DONE', cx - 20, y + 6, C.cream, { align: 'center' }); }
      else text(ctx, `${p.have}/${p.need}`, cx, y + 6, C.gold, { align: 'right' });
    }
    this.scrollMarks(ctx, L, wv);
    const q = qs[this.sel]; if (q) this.questDetail(g, ctx, L.detail, q);
  }
  /** Dim where-to-look tag on a locked quest row: the sector that starts it, or the kind of event. */
  lockTag(g: Game, q: QuestDef) {
    const a = q.start.match?.areaId as string | undefined;
    if (q.start.on === 'area:enter' && a) return `S${pad2(this.sector(g, a))} ${this.areaName(g, a)}`.toUpperCase();
    return START_TAG[q.start.on] ?? 'KEEP FLYING';
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
    cFill(ctx, tgx, y - 2, tgw, 11, lock ? C.night : darkOf(acc), 2); text(ctx, tag, tgx + 4, y, lock ? C.peri : C.cream); y += 15;
    if (!lock) {
      const cnt = `${p.have}/${p.need}`; const cx = D.x + D.w - 12;
      meter(ctx, tx, y + 1, cx - textWidth(cnt) - 8 - tx, 5, p.have, p.need, acc); text(ctx, cnt, cx, y, acc, { align: 'right' }); y += 14;
    }
    for (const l of wrap(lock ? this.startHint(g, q) : q.desc, cw).slice(0, wide ? 4 : 8)) { text(ctx, l, tx, y, lock ? C.dim : C.text); y += 10; }
    const rw = this.rewardText(q); y = D.y + D.h - 16;
    if (rw) { icon(ctx, 'gift', tx, y, lock ? C.peri : C.pink); text(ctx, ('REWARD ' + rw).slice(0, cw - 2), tx + 11, y, st === 'done' ? C.dim : lock ? C.peri : C.pink); }
  }
  /** Where a locked quest starts, worded for the player's progress (a passed sector means a replay). */
  startHint(g: Game, q: QuestDef): string {
    const a = q.start.match?.areaId as string | undefined;
    if (q.start.on === 'area:enter' && a) {
      const n = pad2(this.sector(g, a));
      if (this.passed(g, a)) return `Missed in ${this.areaName(g, a)}. Replay sector ${n} from the star chart to start this page.`;
      return `This page is still blank. It fills in when you reach ${this.areaName(g, a)} (sector ${n}).`;
    }
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
      this.polaroid(g, ctx, ms[i], i, cx + Math.floor((wv.cw - 52) / 2), cy + 6 + (i % 2 ? 2 : 0), i === this.sel);
    }
    this.scrollMarks(ctx, L, wv);
    const m = ms[this.sel]; if (m) this.memoryDetail(g, ctx, L.detail, m, this.sel);
  }
  /** 52x64 polaroid: 44x40 photo crop, number (and the sector to search, when locked) on the caption strip, tape. */
  polaroid(g: Game, ctx: CanvasRenderingContext2D, m: MemoryDef, i: number, x: number, y: number, on: boolean) {
    const got = g.state.memories.includes(m.id);
    const w = 52, h = 64;
    rect(ctx, x + 2, y + 2, w, h, C.deep); // holo drop shadow
    rect(ctx, x, y, w, h, got ? C.cream : C.indigo); rect(ctx, x, y, w, 1, got ? C.text : C.peri); rect(ctx, x, y + h - 1, w, 1, got ? C.pale : C.night);
    const ph = got ? photo(m.id, m.area) : lockedPhoto(m.id);
    if (ph) ctx.drawImage(ph, THUMB.x, THUMB.y, THUMB.w, THUMB.h, x + 4, y + 4, THUMB.w, THUMB.h);
    if (got) text(ctx, `#${pad2(i + 1)}`, x + w / 2, y + 50, C.indigo, { align: 'center' });
    else {
      text(ctx, '?', x + 13, y + 10, C.dim);
      text(ctx, pad2(i + 1), x + 5, y + 50, C.peri);
      const s = `S${pad2(this.sector(g, m.area))}`; const sw = textWidth(s) + 4;
      cFill(ctx, x + w - 5 - sw, y + 48, sw, 9, C.night, 2); text(ctx, s, x + w - 3 - sw, y + 50, this.passed(g, m.area) ? C.pink : C.line);
    }
    const tx = x + 16 + (i % 3) * 3; // tape, nudged per photo so the grid feels hand-stuck
    rect(ctx, tx, y - 3, 14, 6, got ? C.pale : C.peri); rect(ctx, tx, y - 3, 14, 1, got ? C.text : C.dim);
    ctx.fillStyle = got ? C.dim : C.indigo; ctx.fillRect(tx, y + 2, 1, 1); ctx.fillRect(tx + 13, y - 3, 1, 1);
    if (on) this.itemRing(ctx, x - 1, y - 3, w + 3, h + 5);
  }
  memoryDetail(g: Game, ctx: CanvasRenderingContext2D, D: Box, m: MemoryDef, i: number) {
    const got = g.state.memories.includes(m.id); const wide = D.w > D.h * 2;
    this.detailFrame(ctx, D, got ? C.pink : C.peri);
    const pw = PHOTO_W + 8, ph = PHOTO_H + 20; // big polaroid (photo 88x64)
    const px = wide ? D.x + 12 : Math.round(D.x + D.w / 2 - pw / 2), py = wide ? D.y + 13 : D.y + 14;
    rect(ctx, px + 2, py + 2, pw, ph, C.deep); rect(ctx, px, py, pw, ph, got ? C.cream : C.indigo); rect(ctx, px, py, pw, 1, got ? C.text : C.peri);
    blit(ctx, got ? photo(m.id, m.area) : lockedPhoto(m.id), px + 4, py + 4);
    if (!got) text(ctx, '?', px + 22, py + 12, C.dim);
    text(ctx, got ? m.title.slice(0, 15) : `SECTOR ${pad2(this.sector(g, m.area))}`, px + pw / 2, py + PHOTO_H + 8, got ? C.indigo : C.line, { align: 'center' });
    rect(ctx, px + pw / 2 - 9, py - 4, 18, 7, got ? C.pale : C.peri); rect(ctx, px + pw / 2 - 9, py - 4, 18, 1, got ? C.text : C.dim);
    const tx = wide ? px + pw + 14 : D.x + 12; let y = wide ? D.y + 10 : py + ph + 9; const cw = Math.floor((D.x + D.w - 10 - tx) / 6);
    if (got) {
      text(ctx, `MEMORY #${pad2(i + 1)}`, tx, y, C.pink); y += 12;
      for (const l of wrap(m.text, cw).slice(0, wide ? 7 : 10)) { text(ctx, l, tx, y, C.text); y += 10; }
    } else {
      text(ctx, 'NOT FOUND YET', tx, y, C.dim); y += 12;
      const where = `${this.areaName(g, m.area)}, wave ${m.wave + 1}`;
      const hint = this.passed(g, m.area)
        ? `Missed in ${where}. Replay sector ${pad2(this.sector(g, m.area))} and watch for a glowing cat carrying a polaroid.`
        : `Somewhere in ${where}. Watch for a glowing cat carrying a polaroid and boop it gently.`;
      for (const l of wrap(hint, cw).slice(0, 6)) { text(ctx, l, tx, y, C.peri); y += 10; }
    }
    const yy = D.y + D.h - 14; icon(ctx, 'flag', tx, yy, got ? C.pink : C.peri);
    text(ctx, `S${pad2(this.sector(g, m.area))} ${this.areaName(g, m.area)} W${m.wave + 1}`.slice(0, cw - 2), tx + 10, yy, C.dim);
  }
  /** Full-size photo with its story. It replaces the page body, so nothing from the page shows behind it. */
  viewerDraw(g: Game, ctx: CanvasRenderingContext2D, L: Layout) {
    const m = g.content.memories[this.viewer]; if (!m) return;
    const pw = PHOTO_W * 2 + 16, ph = PHOTO_H * 2 + 32; const tw = 288;
    const top = L.grid.y, bottom = L.panel.y + L.panel.h - 8;
    const total = pw + 18 + tw; const x = Math.round(W / 2 - total / 2), y = Math.round((top + bottom) / 2 - ph / 2);
    rect(ctx, x + 3, y + 3, pw, ph, C.deep); rect(ctx, x, y, pw, ph, C.cream); rect(ctx, x, y, pw, 1, C.text); rect(ctx, x, y + ph - 1, pw, 1, C.pale);
    blit(ctx, photo(m.id, m.area), x + 8, y + 8, 2);
    text(ctx, m.title, x + pw / 2, y + PHOTO_H * 2 + 15, C.indigo, { align: 'center' });
    rect(ctx, x + pw / 2 - 16, y - 5, 32, 9, C.pale); rect(ctx, x + pw / 2 - 16, y - 5, 32, 1, C.text);
    const bx = x + pw + 18, by = y, bh = ph; cFrame(ctx, bx, by, tw, bh, C.pink, C.ink, 6);
    text(ctx, `MEMORY #${pad2(this.viewer + 1)}`, bx + 12, by + 12, C.pink);
    const found = g.content.memories.filter(mm => g.state.memories.includes(mm.id)).length;
    text(ctx, `${found}/${g.content.memories.length}`, bx + tw - 12, by + 12, C.dim, { align: 'right' });
    wrap(m.text, 44).slice(0, 8).forEach((l, k) => text(ctx, l, bx + 12, by + 28 + k * 11, C.text));
    icon(ctx, 'flag', bx + 12, by + bh - 34, C.peri); text(ctx, `S${pad2(this.sector(g, m.area))} ${this.areaName(g, m.area)}`, bx + 22, by + bh - 34, C.dim);
    const dev = this.dev(g); const k = keys(dev);
    if (dev === 'touch') text(ctx, 'TAP TO CLOSE', bx + 12, by + bh - 18, C.dim);
    else { let hx = bx + 12; hx += keycap(ctx, '< >', hx, by + bh - 18, C.pink) + 4; text(ctx, 'FLIP', hx, by + bh - 18, C.dim); hx += textWidth('FLIP') + 12; hx += keycap(ctx, k.back, hx, by + bh - 18, C.pink) + 4; text(ctx, 'BACK', hx, by + bh - 18, C.dim); }
    if (found > 1 && !g.state.settings.reduceMotion) { const o = (this.t >> 4) % 2; arrow(ctx, x - 8 - o, y + ph / 2, 'l', 4, C.pink); arrow(ctx, bx + tw + 7 + o, y + ph / 2, 'r', 4, C.pink); }
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
      cFill(ctx, x, y, w, h, seen ? C.panel : C.ink, 4);
      cLine(ctx, x, y, w, h, boss ? (seen ? C.burnt : C.indigo) : seen ? C.deep : C.indigo, 4);
      // every entry: the same top-down specimen, 64px frame, feet on a shared baseline
      const base = y + h - 13;
      specimen(ctx, e, x + Math.floor(w / 2), base, seen);
      if (!seen) text(ctx, '?', x + Math.floor(w / 2) - 2, base - 30, C.dim);
      if (boss) mini(ctx, 'crown', x + 4, y + 4, seen ? C.gold : C.indigo);
      // footer: threat meter (4 pips) and the entry number
      pips(ctx, x + 6, y + h - 8, seen ? threat(e) : 0, boss ? C.gold : C.hot, seen ? C.indigo : C.night);
      text(ctx, pad2(i + 1), x + w - 5, y + h - 10, on ? C.gold : seen ? C.dim : C.peri, { align: 'right' });
      if (on) this.itemRing(ctx, x, y, w, h, 4);
    }
    this.scrollMarks(ctx, L, wv);
    const e = es[this.sel]; if (e) this.bestiaryDetail(g, ctx, L.detail, e, this.sel);
  }
  bestiaryDetail(g: Game, ctx: CanvasRenderingContext2D, D: Box, e: EnemyDef, i: number) {
    const seen = this.isSeen(g, e); const boss = e.behavior === 'boss'; const wide = D.w > D.h * 2;
    const acc = !seen ? C.peri : boss ? C.gold : C.line;
    this.detailFrame(ctx, D, acc);
    // specimen bay: the same 64px specimen as the grid cell, on the same kind of baseline, with a live scan line
    const bw = 84, bh = wide ? 92 : 84; const bx = wide ? D.x + 10 : Math.round(D.x + D.w / 2 - bw / 2), by = D.y + 10;
    cFill(ctx, bx, by, bw, bh, C.night, 5); cLine(ctx, bx, by, bw, bh, darkOf(acc), 5);
    for (let yy = by + 4; yy < by + bh - 4; yy += 4) rect(ctx, bx + 4, yy, bw - 8, 1, C.ink);
    const base = by + bh - 12;
    rect(ctx, bx + 8, base + 1, bw - 16, 1, seen ? darkOf(acc) : C.indigo);
    if (!g.state.settings.reduceMotion) rect(ctx, bx + 6, by + 6 + ((this.t >> 1) % (bh - 20)), bw - 12, 1, darkOf(acc)); // scan line, behind the specimen
    specimen(ctx, e, bx + bw / 2, base, seen);
    if (!seen) text(ctx, '?', bx + bw / 2 - 2, base - 30, C.dim);
    pips(ctx, bx + bw / 2 - 12, by + bh - 7, seen ? threat(e) : 0, boss ? C.gold : C.hot, C.ink, 5);
    const tx = wide ? bx + bw + 12 : D.x + 12; let y = wide ? D.y + 10 : by + bh + 8; const cw = Math.floor((D.x + D.w - 10 - tx) / 6);
    text(ctx, `NO.${pad2(i + 1)}`, tx, y, C.peri);
    const tag = seen ? BEHAVIOR[e.behavior] ?? e.behavior.toUpperCase() : 'UNKNOWN'; const tgw = textWidth(tag) + 8;
    cFill(ctx, D.x + D.w - 10 - tgw, y - 2, tgw, 11, seen ? darkOf(acc) : C.night, 2); text(ctx, tag, D.x + D.w - 6 - tgw, y, seen ? C.cream : C.peri);
    y += 13;
    text(ctx, seen ? e.name : '? ? ?', tx, y, seen ? (boss ? C.gold : C.text) : C.dim, { shadow: C.ink }); y += 13;
    if (seen) {
      icon(ctx, 'star', tx, y, C.gold); text(ctx, `${e.points} PTS`, tx + 10, y, C.gold);
      const hx = tx + 10 + textWidth(`${e.points} PTS`) + 10;
      icon(ctx, 'heart', hx, y, C.hot); text(ctx, `HP ${e.hp}`, hx + 10, y, C.pink);
      y += 13;
      for (const l of wrap(e.bestiary, cw).slice(0, wide ? 4 : 7)) { text(ctx, l, tx, y, C.text); y += 10; }
    } else {
      for (const l of wrap('Not booped yet. Scanner data is fuzzy: one gentle boop and this page fills in.', cw).slice(0, 4)) { text(ctx, l, tx, y, C.peri); y += 10; }
    }
    const home = this.homeArea(g, e);
    if (home) { const yy = D.y + D.h - 14; icon(ctx, 'flag', tx, yy, C.peri); text(ctx, ((boss ? 'BOSS OF ' : 'SEEN IN ') + `S${pad2(this.sector(g, home))} ` + this.areaName(g, home)).slice(0, cw - 2), tx + 10, yy, C.dim); }
  }

  // ---- STATS
  statsTab(g: Game, ctx: CanvasRenderingContext2D, L: Layout) {
    const s = g.state; const st = s.stats; const ct = g.content;
    const aim = st.shots ? Math.round(100 * st.hits / st.shots) : 0;
    const pups = ct.quests.find(q => q.id === 'lost_pups'); const pp = pups ? this.progress(g, pups) : null;
    const qDone = ct.quests.filter(q => this.questState(g, q) === 'done').length;
    const seen = ct.enemies.filter(e => this.isSeen(g, e)).length;
    const frac = (a: number, b: number) => a / Math.max(1, b);
    const hi = Math.max(s.hiScore, s.score);
    // [icon, label, value, colour, meter 0..1 or -1, caption]: every card gets a meter that means something
    const tiles: [string, string, string, string, number, string][] = [
      ['star', 'SCORE', String(s.score), C.gold, frac(s.score, hi), 'OF YOUR BEST'],
      ['star', 'HI SCORE', String(hi), C.gold, -1, 'PERSONAL BEST'],
      ['cat', 'CATS BOOPED', String(st.catsBooped), C.line, -1, 'GENTLY, ALWAYS'],
      ['bolt', 'TURDS TOOTED', String(st.shots), C.orange, frac(st.hits, st.shots), `${st.hits} DIRECT HITS`],
      ['wave', 'AIM', String(aim), C.lime, aim / 100, aim >= 60 ? 'PERCENT. SHARP NOSE' : 'PERCENT. KEEP SNIFFING'],
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
      cFrame(ctx, x, y, tw, th, c, C.panel, 5);
      icon(ctx, ic, x + 9, y + 9, c, C.ink); text(ctx, lbl, x + 20, y + 9, C.dim);
      if (th >= 60) {
        num(ctx, val, x + 10, y + 26, C.text, { hi: C.cream, shadow: darkOf(c) });
        if (p >= 0) { text(ctx, sub, x + 10, y + 46, C.peri); meter(ctx, x + 10, y + th - 15, tw - 20, 4, Math.round(p * 100), 100, c); }
        else { text(ctx, sub, x + 10, y + th - 18, C.peri); this.badge(ctx, ic, x + tw - 22, y + th - 22, c); }
      } else {
        text(ctx, val, x + tw - 9, y + 24, C.text, { align: 'right' });
        if (p >= 0) meter(ctx, x + 9, y + th - 10, tw - 18, 2, Math.round(p * 100), 100, c);
      }
    });
  }
  /** Icon on a little chamfered plate: the illustration on stat cards that have no meter. */
  badge(ctx: CanvasRenderingContext2D, ic: string, x: number, y: number, c: string) {
    cFill(ctx, x - 4, y - 4, 18, 18, C.night, 3); cLine(ctx, x - 4, y - 4, 18, 18, darkOf(c), 3);
    icon(ctx, ic, x + 1, y + 1, c, C.ink);
  }

  // ---- shared bits
  detailFrame(ctx: CanvasRenderingContext2D, D: Box, acc: string) {
    cFrame(ctx, D.x, D.y, D.w, D.h, acc, C.ink, 6);
    rect(ctx, D.x + 6, D.y + 2, D.w - 12, 1, C.night);
  }
  hintBar(g: Game, ctx: CanvasRenderingContext2D, L: Layout, acc: string) {
    const dev = this.dev(g); const k = keys(dev);
    const pairs: [string, string][] = [];
    if (this.tabId() !== 'stats') pairs.push([dev === 'gamepad' ? 'D-PAD' : 'ARROWS', 'BROWSE']);
    pairs.push([dev === 'gamepad' ? '(LB)(RB)' : 'Q E', 'PAGE']);
    // SPACE VIEW only when the selected polaroid can actually be opened
    if (this.tabId() === 'memories' && this.focus === 'items' && this.memoryFound(g, this.sel)) pairs.push([k.ok, 'VIEW']);
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
