import type { Game, Module } from '../core/game';
import { W, H } from '../core/game';
import type { EnemyDef, QuestDef, MemoryDef } from '../core/types';
import { text, textWidth, wrap } from '../art/font';
import { spriteCanvas } from '../art/sprite';
import { C, frame, scanlines, rect, chamferFill, chamferLine, ticks, icon, keycap, capWidth, keys, darkOf, lighter, disc, arrow, type Device } from '../ui/draw';
import { headline, num } from '../ui/numerals';
import { photo, lockedPhoto, thumbAt, NOTES, PHOTO_W, PHOTO_H, THUMB_W, THUMB_H } from './photos';
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
/** Tab index for an id, a label or an index (number or numeric string); -1 when it names no tab. */
function tabIndex(v: unknown): number {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v < TABS.length ? v : -1;
  if (typeof v !== 'string') return -1; const s = v.trim().toLowerCase(); if (!s) return -1;
  if (/^\d+$/.test(s)) return tabIndex(+s);
  return TABS.findIndex(t => t.id === s || t.label.toLowerCase() === s);
}
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
  mail: ['#######', '##...##', '#.#.#.#', '#..#..#', '#.....#', '#######', '.......'],
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
function specimen(ctx: CanvasRenderingContext2D, e: EnemyDef, cx: number, by: number, seen: boolean): Box | null {
  const c = spriteCanvas(e.sprite, 0, false, seen ? undefined : SILHOUETTE); if (!c) return null;
  const s = Math.max(1, Math.floor(SPEC / Math.max(c.width, c.height))); const b = bbox(c);
  const x = Math.round(cx - (b.x + b.w / 2) * s), y = by - (b.y + b.h) * s;
  blit(ctx, c, x, y, s);
  return { x: x + b.x * s, y: y + b.y * s, w: b.w * s, h: b.h * s };
}
/** The unknown-specimen mark: a 2x '?' in peri with a 1px ink outline, centred on the silhouette's box. */
function mystery(ctx: CanvasRenderingContext2D, b: Box | null) {
  if (!b) return; const x = Math.round(b.x + b.w / 2 - 5), y = Math.round(b.y + b.h / 2 - 7);
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1], [2, 2]]) text(ctx, '?', x + dx, y + dy, C.ink, { scale: 2 });
  text(ctx, '?', x, y, C.peri, { scale: 2 });
}
/** Short sector names for tight footers ('S05 ROOFTOPS'). */
const SHORT: Record<string, string> = { mothership: 'MEOWTHERSHIP' };
/**
 * Draw text that never overflows maxW: whole words are dropped from the end and a 3-dot pixel ellipsis is drawn
 * instead (no mid-word cuts). Returns the width drawn.
 */
function textFit(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, maxW: number, c: string, opts: { align?: 'left' | 'right' | 'center' } = {}) {
  let t = s.toUpperCase(); let cut = false;
  while (textWidth(t) > maxW && t.length) { const i = t.lastIndexOf(' '); t = (i > 0 ? t.slice(0, i) : t.slice(0, -1)).replace(/[ ,.:-]+$/, ''); cut = true; }
  const w = textWidth(t) + (cut ? 7 : 0);
  const x0 = opts.align === 'right' ? x - w : opts.align === 'center' ? Math.round(x - w / 2) : x;
  text(ctx, t, x0, y, c);
  if (cut) for (let i = 0; i < 3; i++) rect(ctx, x0 + textWidth(t) + 2 + i * 2, y + 6, 1, 1, c);
  return w;
}
/** Hand-lettered line: the pixel font with a per-letter baseline wobble, like a pen note on the page. */
function scrawl(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, c: string) {
  let cx = x; [...s.toUpperCase()].forEach((ch, i) => { text(ctx, ch, cx, y + [0, -1, 0, 1, 0, 0, -1, 1][(i * 5 + s.length) % 8], c); cx += ch === ' ' ? 5 : 6; });
  return cx - x;
}
/** 0-4 threat pips: grunts by hit points, every big cat is a full 4. */
const threat = (e: EnemyDef) => e.behavior === 'boss' ? 4 : Math.max(1, Math.min(3, e.hp));
function pips(ctx: CanvasRenderingContext2D, x: number, y: number, n: number, on: string, off: string, w = 4) {
  for (let i = 0; i < 4; i++) { rect(ctx, x + i * (w + 1), y, w, 3, i < n ? on : off); if (i < n) rect(ctx, x + i * (w + 1), y, w, 1, lighter(on)); }
}
/** 1px dashed rectangle (dash 3, gap 2): the outline of a sealed, not-yet-written page. */
function dashed(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) {
  ctx.fillStyle = c;
  for (let i = 2; i < w - 2; i += 5) { const l = Math.min(3, w - 2 - i); ctx.fillRect(x + i, y, l, 1); ctx.fillRect(x + i, y + h - 1, l, 1); }
  for (let j = 2; j < h - 2; j += 5) { const l = Math.min(3, h - 2 - j); ctx.fillRect(x, y + j, 1, l); ctx.fillRect(x + w - 1, y + j, 1, l); }
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
  sel = 0; t = 0;
  private tabI = 0;
  /** Current tab index. Accepts a tab id ('memories') or index; bad values (NaN, out of range) keep the current tab. */
  get tab(): number { return this.tabI; }
  set tab(v: number | string) { const i = tabIndex(v); if (i >= 0) this.tabI = i; }
  focus: 'tabs' | 'items' = 'items';
  scroll = 0;
  viewer = -1;                      // memory index shown full size, -1 = closed
  private sels = [0, 0, 0, 0];      // remembered selection per tab
  private seen = new Set<string>(); // breeds / bosses met this session (derived ones are added on top)
  private hits: Hit[] = [];
  private taps: [number, number][] = [];
  private jump = 0;                 // pending tab jump from Q/E/Tab
  private selT = -99;               // tick of the last selection change (focus ring flash)
  private lastKey = '';
  private bg: { key: string; c: HTMLCanvasElement } | null = null; // cached static backdrop + panel
  private demoBackup: string | null = null;                        // real save, restored when a showcase demo closes
  private boops = new Map<string, number>();                       // boops per breed this session (favourite target)
  private bossesDown = new Set<string>();                          // bosses defeated this session

  init(g: Game) {
    this.g = g;
    g.bus.on('cat:boop', (p: any) => this.note('cat:boop', p));
    g.bus.on('boss:start', (p: any) => this.note('boss:start', p));
    g.bus.on('boss:defeat', (p: any) => this.note('boss:defeat', p));
    // a wave's breeds count as seen the moment it spawns (they are on screen and listed in the HUD)
    g.bus.on('wave:start', (p: any) => this.note('wave:start', p));
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
      // Q/E, PageUp/PageDown and LB/RB arrive as core actions 'pageL'/'pageR'; Tab stays journal-local
      if (e.code === 'Tab') { this.jump = e.shiftKey ? -1 : 1; e.preventDefault(); }
    });
  }
  isOpen() { return this.g?.mods.ui?.menuOpen === 'journal'; }
  open() {
    if (wantsDemo()) this.seedDemo();
    // showcase deep link by name (?tab=memories): the showcase passes +tab, which is NaN for a name
    if (typeof location !== 'undefined') { const tp = new URLSearchParams(location.search).get('tab'); if (tp !== null && isNaN(+tp)) this.tab = tp; }
    this.sel = Math.min(this.sels[this.tab] ?? 0, Math.max(0, this.count(this.g) - 1)); this.focus = 'items'; this.viewer = -1;
    this.taps = []; this.jump = 0; this.scroll = 0; this.scan();
  }
  /**
   * Same as the showcase's staged save; exposed so core can stage it explicitly. The real save is kept and put
   * back when the journal closes, so the demo numbers never reach the title screen or the save slot.
   */
  seedDemo() {
    if (this.demoBackup === null) { this.demoBackup = JSON.stringify(this.g.state); this.boopsBackup = new Map(this.boops); }
    seedJournalDemo(this.g);
    for (const [b, n] of [['tabby', 141], ['tuxedo', 96], ['siamese', 52]] as [string, number][]) this.boops.set(b, (this.boops.get(b) ?? 0) + n);
  }
  private boopsBackup: Map<string, number> | null = null;
  private restoreDemo() {
    if (this.demoBackup === null) return; const saved = JSON.parse(this.demoBackup); this.demoBackup = null;
    if (this.boopsBackup) { this.boops = this.boopsBackup; this.boopsBackup = null; }
    const st = this.g.state as unknown as Record<string, unknown>;
    for (const k of Object.keys(saved)) if (k !== 'scene' && k !== 'settings') st[k] = saved[k];
  }
  /** One bus event: what it tells the bestiary and the stats page. */
  private note(evt: string, p: any) {
    if (evt === 'cat:boop' && p?.breed) { this.seen.add(p.breed); this.boops.set(p.breed, (this.boops.get(p.breed) ?? 0) + 1); }
    else if (evt === 'boss:start' && p?.bossId) this.seen.add(p.bossId);
    else if (evt === 'boss:defeat' && p?.bossId) { this.seen.add(p.bossId); this.bossesDown.add(p.bossId); }
    else if (evt === 'wave:start' && this.g) {
      const wid = this.g.content.areas.find(a => a.id === p?.areaId)?.waves[p?.waveIndex];
      for (const c of this.g.content.waves.find(w => w.id === wid)?.cats ?? []) this.seen.add(c.breed);
    }
  }
  /** Pull events still in the bus log (e.g. from before the journal was listening). Runs once per open. */
  private scanned = -1;
  private scan() {
    const log = this.g?.bus.log ?? []; if (this.scanned === log.length) return; this.scanned = log.length;
    if (this.boops.size === 0) for (const e of log) this.note(e.evt, e.p);
    else for (const e of log) if (e.evt !== 'cat:boop') this.note(e.evt, e.p);
  }
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
  /**
   * Seen = on screen at some point. Uses the same notion of progress as passed(): every sector the player has
   * flown past (cleared, or earlier on the chart than the current one) fielded its breeds and boss; in the
   * current sector the waves already flown count, and so does every wave that has spawned (wave:start) and
   * every cat booped or big cat met this session.
   */
  isSeen(g: Game, e: EnemyDef): boolean {
    if (this.seen.has(e.id)) return true;
    const s = g.state;
    for (const a of g.content.areas) {
      if (!this.passed(g, a.id)) continue;
      if (a.boss === e.id || a.waves.some(w => this.fields(g, w, e.id))) return true;
    }
    const cur = g.content.areas.find(a => a.id === s.areaId);
    if (cur && !this.passed(g, cur.id)) for (let i = 0; i < Math.min(s.waveIndex, cur.waves.length); i++) if (this.fields(g, cur.waves[i], e.id)) return true;
    return false;
  }
  /** Stored state, upgraded by quest.status() (a pre-polish 'active' quest with a missed marker reads 'missed'). */
  questState(g: Game, q: QuestDef): 'locked' | 'active' | 'done' | 'missed' {
    const raw = g.state.quests[q.id]; const st = (g.mods.quest?.status?.(q.id) ?? raw ?? 'locked') as string;
    return st === 'active' || st === 'done' || st === 'missed' ? st : raw === 'missed' ? 'missed' : 'locked';
  }
  /** True for a quest whose window passed (route forfeit or the flight ended first). */
  isClosed(g: Game, q: QuestDef) { const t = this.look(g, q).tone; return this.questState(g, q) === 'missed' || t === 'missed' || t === 'expired'; }
  /** Short reason for a closed quest's row: which branch closed it, or that the flight ended. */
  closedTag(g: Game, q: QuestDef): string {
    if (this.closedHow(g, q) === 'run') return 'FLIGHT ENDED';
    const a = this.expireArea(q); return a ? `VIA ${SHORT[a] ?? a.toUpperCase()}` : 'ROUTE CLOSED';
  }
  closedHow(g: Game, q: QuestDef): 'route' | 'run' {
    const by = g.mods.quest?.closedBy?.(q.id); if (by === 'run' || by === 'route') return by;
    return this.look(g, q).tone === 'expired' ? 'run' : 'route';
  }
  /** The area whose entry closes a quest (first area:enter expire trigger), if any. */
  expireArea(q: QuestDef): string | undefined {
    const ex = (q as QuestDef & { expire?: unknown }).expire; const list = (Array.isArray(ex) ? ex : ex ? [ex] : []) as { on?: string; match?: { areaId?: unknown } }[];
    const t = list.find(t => t?.on === 'area:enter' && typeof t.match?.areaId === 'string'); return t?.match?.areaId as string | undefined;
  }
  /** Detail-card explanation of what closed a quest, worded around the actual route. */
  closedNote(g: Game, q: QuestDef): string {
    if (this.closedHow(g, q) === 'run') return this.look(g, q).note || 'The flight ended before this page was finished. It opens again on your next flight.';
    const a = this.expireArea(q);
    if (!a) return this.look(g, q).note || 'Pom took the other route. Try it on your next flight.';
    const from = g.content.areas.find(x => (x.exits ?? []).some(e => e.to === a));
    const other = from?.exits?.find(e => e.to !== a) as { to: string; label?: string } | undefined;
    const fork = from ? ` at sector ${pad2(this.sector(g, from.id))}` : '';
    const alt = other ? (other.label ? `the ${other.label.toLowerCase()}` : `the hop to ${this.areaName(g, other.to)}`) : 'the other hop';
    return `Pom took the hop to ${this.areaName(g, a)}, which closed this page. Next flight, take ${alt}${fork}.`;
  }
  /** quest's presentation (pill / tag / note / tone); 'missed' and 'expired' are closed quests */
  look(g: Game, q: QuestDef): { state: string; tone: string; pill: string; tag: string; note: string; dimReward: boolean } {
    const st = this.questState(g, q);
    return g.mods.quest?.look?.(q.id) ?? { state: st, tone: st, pill: st === 'missed' ? 'MISSED' : '', tag: '', note: '', dimReward: st === 'missed' };
  }
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
      this.restoreDemo();
      close();
    };
    // the photo viewer is modal: confirm/back/tap closes it, left/right flips through found memories
    if (this.viewer >= 0) {
      let flip = I.pressed('left') ? -1 : I.pressed('right') ? 1 : 0; let tapClose = false;
      for (const [x, y] of this.taps) { const h = [...this.hits].reverse().find(h => x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h); if (h?.kind === 'viewer' && h.i) flip = h.i; else tapClose = true; }
      this.taps = []; this.jump = 0;
      if (confirm || I.pressed('back') || I.pressed('pause') || (tapClose && !flip)) { this.viewer = -1; blip(); }
      else if (flip) {
        const mem = g.content.memories; const d = flip;
        for (let k = 1; k <= mem.length; k++) { const j = (((this.viewer + d * k) % mem.length) + mem.length) % mem.length; if (g.state.memories.includes(mem[j].id)) { this.viewer = j; this.sel = j; break; } }
        blip();
      }
      return;
    }
    if (I.pressed('back') || I.pressed('pause')) { shut(); return; }
    // page actions from core/input (Q/E, PageUp/PageDown, gamepad LB/RB) switch pages from anywhere; Tab in keydown
    if (I.pressed('pageL')) this.jump = -1; else if (I.pressed('pageR')) this.jump = 1;
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
    // touch: the panel ends at y=228, 4px above the pad decks (TOUCH_TOP - 4 = 232); the detail card floats
    // below it in the gap between the MOVE and ACTION decks (x 132-508)
    if (touch) return { panel: { x: 12, y: 24, w: W - 24, h: 204 }, grid: { x: 24, y: 64, w: 592, h: 160 }, detail: { x: 132, y: 234, w: 376, h: 122 }, hints: false, touch };
    return { panel: { x: 12, y: 24, w: W - 24, h: H - 28 }, grid: { x: 24, y: 68, w: 384, h: 256 }, detail: { x: 414, y: 68, w: 202, h: 256 }, hints: true, touch };
  }
  cell(L: Layout): { cw: number; ch: number } {
    const id = this.tabId();
    if (id === 'quests') return { cw: L.grid.w, ch: L.touch ? 26 : 23 };
    if (id === 'memories') return L.touch ? { cw: 64, ch: 80 } : { cw: 62, ch: 84 };
    if (id === 'bestiary') return L.touch ? { cw: 73, ch: 80 } : { cw: 76, ch: 84 };
    return { cw: L.grid.w, ch: L.grid.h };
  }
  cols(L: Layout) { return Math.max(1, Math.floor(L.grid.w / this.cell(L).cw)); }

  // ---------------- drawing ----------------
  draw(g: Game, ctx: CanvasRenderingContext2D) {
    this.g = g; this.hits = [];
    const L = this.layout(g); const P = L.panel; const acc = TABS[this.tab].accent;
    const key = `${this.tab}|${this.sel}|${this.focus}`; if (key !== this.lastKey) { this.lastKey = key; this.selT = this.t; }
    // full-bleed backdrop + panel in one cached canvas: no chopped HUD or frozen game ever shows in the margins
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
    const P = L.panel; const key = `${P.x},${P.y},${P.w},${P.h},${L.touch}`;
    if (this.bg?.key === key) return this.bg.c;
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d')!;
    // backdrop: the panel's own night, two steps darker (ink) with a sparse dot lattice
    rect(ctx, 0, 0, W, H, C.ink); ctx.fillStyle = C.night;
    for (let y = 4; y < H; y += 8) for (let x = 4 + ((y >> 3) & 1) * 4; x < W; x += 8) ctx.fillRect(x, y, 1, 1);
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
        rect(ctx, x + 6, y + 1, w - 12, 1, t.accent);
        if (foc) this.ring(ctx, x, y, w, 19, 4);
      } else { cFill(ctx, x, y + 2, w, 15, C.ink, 3); cLine(ctx, x, y + 2, w, 15, C.indigo, 3); }
      const cnt = have < 0 ? '' : t.id === 'quests' ? `${have}/${Math.max(have, g.mods.quest?.flightMax?.() ?? n)}` : `${have}/${n}`;
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
    const cntW = Math.max(40, textWidth('NEXT TIME') + 8, ...qs.map(q => Math.max(textWidth(`${q.complete.count ?? 1}/${q.complete.count ?? 1}`), textWidth(this.lockTag(g, q)))));
    const barW = 84; const next = this.nextQuest(g);
    for (let i = wv.first; i < wv.last; i++) {
      const q = qs[i]; const st = this.questState(g, q); const on = i === this.sel; const lock = st === 'locked';
      const y = L.grid.y + (i - wv.first) * wv.ch; const x = L.grid.x + 4, w = L.grid.w - 12, h = wv.ch - 4;
      const ty = y + Math.floor((h - 7) / 2);
      this.hits.push({ x, y, w, h: wv.ch, kind: 'item', i });
      const cx = x + w - 8; const barX = cx - cntW - 8 - barW;
      if (lock) {
        // a sealed page: dashed outline, envelope, an empty meter keeping the row rhythm, and where to look
        const isNext = q === next;
        cFill(ctx, x, y, w, h, isNext ? C.night : C.ink, 3);
        if (isNext) cLine(ctx, x, y, w, h, C.burnt, 3); else dashed(ctx, x, y, w, h, C.indigo);
        if (on) this.itemRing(ctx, x, y, w, h, 3);
        mini(ctx, 'mail', x + 7, ty, isNext ? C.gold : C.peri);
        text(ctx, '? ? ?', x + 20, ty, isNext ? C.dim : C.peri, { shadow: C.ink });
        if (isNext) { const nw = textWidth('NEXT') + 8; cFill(ctx, x + 60, ty - 2, nw, 11, C.burnt, 2); text(ctx, 'NEXT', x + 64, ty, C.cream); }
        meter(ctx, barX, ty + 1, barW, 5, 0, q.complete.count ?? 1, C.peri);
        const a = q.start.match?.areaId as string | undefined;
        textFit(ctx, this.lockTag(g, q), cx, ty, cntW + 4, isNext ? C.gold : a && this.passed(g, a) ? C.pink : C.peri, { align: 'right' });
        continue;
      }
      const lk = this.look(g, q); const closed = this.isClosed(g, q);
      if (closed) {
        // a closed page: muted ink card with a dashed rim, a struck flag, the reason in the meter column, the pill
        cFill(ctx, x, y, w, h, C.ink, 3); dashed(ctx, x, y, w, h, C.indigo);
        if (on) this.itemRing(ctx, x, y, w, h, 3);
        icon(ctx, 'flag', x + 7, ty, C.indigo); rect(ctx, x + 6, ty + 3, 9, 1, C.peri);
        text(ctx, q.name, x + 20, ty, on ? C.peri : C.dim, { shadow: C.ink });
        textFit(ctx, this.closedTag(g, q), barX + barW, ty, barW + 4, C.peri, { align: 'right' });
        const pill = lk.pill && lk.pill !== 'DONE' ? lk.pill : this.closedHow(g, q) === 'run' ? 'NEXT TIME' : 'MISSED';
        const mw = Math.max(40, textWidth(pill) + 8); cFill(ctx, cx - mw, ty - 2, mw, 11, C.night, 2); cLine(ctx, cx - mw, ty - 2, mw, 11, C.indigo, 2);
        text(ctx, pill, cx - mw / 2, ty, C.peri, { align: 'center' });
        continue;
      }
      cFill(ctx, x, y, w, h, C.panel, 3);
      cLine(ctx, x, y, w, h, st === 'done' ? darkOf(C.lime) : C.burnt, 3);
      if (on) this.itemRing(ctx, x, y, w, h, 3);
      const ic = st === 'done' ? C.lime : C.gold;
      if (st === 'done') mini(ctx, 'check', x + 7, ty, ic); else icon(ctx, 'flag', x + 7, ty, ic);
      text(ctx, q.name, x + 20, ty, on ? C.gold : C.text, { shadow: C.ink });
      const p = this.progress(g, q); const c = st === 'done' ? C.lime : C.gold;
      meter(ctx, barX, ty + 1, barW, 5, p.have, p.need, c);
      if (st === 'done') { cFill(ctx, cx - 40, ty - 2, 40, 11, darkOf(C.lime), 2); text(ctx, 'DONE', cx - 20, ty, C.cream, { align: 'center' }); }
      else text(ctx, `${p.have}/${p.need}`, cx, ty, C.gold, { align: 'right' });
    }
    this.scrollMarks(ctx, L, wv);
    const q = qs[this.sel]; if (q) this.questDetail(g, ctx, L.detail, q);
  }
  /** Dim where-to-look tag on a locked quest row: the sector that starts it, or the kind of event. */
  lockTag(g: Game, q: QuestDef) {
    const a = q.start.match?.areaId as string | undefined;
    if (q.start.on === 'area:enter' && a) return this.sectorTag(g, a);
    return START_TAG[q.start.on] ?? 'KEEP FLYING';
  }
  /** 'S05 ROOFTOPS': sector number plus a short area name, for footers and tags. */
  sectorTag(g: Game, a: string) { return `S${pad2(this.sector(g, a))} ${SHORT[a] ?? a.toUpperCase()}`; }
  /** The first sealed quest the player can still reach on the way forward (gets the NEXT highlight). */
  nextQuest(g: Game): QuestDef | undefined {
    return g.content.quests.find(q => {
      if (this.questState(g, q) !== 'locked') return false;
      const a = q.start.match?.areaId as string | undefined;
      return !(q.start.on === 'area:enter' && a && this.passed(g, a));
    });
  }
  questDetail(g: Game, ctx: CanvasRenderingContext2D, D: Box, q: QuestDef) {
    const st = this.questState(g, q); const p = this.progress(g, q); const wide = D.w > D.h * 2;
    const lk = this.look(g, q); const closed = this.isClosed(g, q); const lock = st === 'locked' && !closed;
    const acc = closed ? C.peri : st === 'done' ? C.lime : st === 'active' ? C.gold : C.peri;
    this.detailFrame(ctx, D, acc);
    // medal sticker on a ribbon (closed: a muted medal with a struck flag; locked: a padlock)
    const mx = wide ? D.x + 36 : Math.round(D.x + D.w / 2), my = wide ? D.y + 46 : D.y + 40;
    const mute = lock || closed;
    rect(ctx, mx - 8, my - 26, 6, 14, mute ? C.indigo : acc); rect(ctx, mx + 2, my - 26, 6, 14, mute ? C.indigo : darkOf(acc));
    rect(ctx, mx - 8, my - 26, 6, 1, mute ? C.peri : lighter(acc)); rect(ctx, mx + 2, my - 26, 6, 1, mute ? C.peri : acc);
    disc(ctx, mx, my, 13, mute ? C.ink : darkOf(acc)); disc(ctx, mx, my - 1, 12, mute ? C.panel2 : acc); disc(ctx, mx, my - 1, 8, mute ? (closed ? C.night : C.indigo) : darkOf(acc));
    if (st === 'done') mini(ctx, 'check', mx - 3, my - 4, C.cream);
    else if (closed) { icon(ctx, 'flag', mx - 3, my - 4, C.peri); rect(ctx, mx - 5, my - 1, 11, 1, C.dim); }
    else icon(ctx, lock ? 'lock' : 'flag', mx - 3, my - 4, lock ? C.peri : C.cream);
    const tx = wide ? D.x + 72 : D.x + 12; let y = wide ? D.y + 10 : D.y + 64; const cw = Math.floor((D.x + D.w - 10 - tx) / 6);
    text(ctx, lock ? 'UNKNOWN QUEST' : q.name, wide ? tx : D.x + D.w / 2, y, lock ? C.dim : closed ? C.dim : C.gold, { align: wide ? 'left' : 'center', shadow: C.ink }); y += 12;
    const tag = closed ? (lk.tag && lk.tag !== 'LOCKED' && lk.tag !== 'IN PROGRESS' ? lk.tag : this.closedHow(g, q) === 'run' ? 'NOT THIS FLIGHT' : 'MISSED: NEXT FLIGHT')
      : st === 'done' ? 'COMPLETE' : st === 'active' ? 'IN PROGRESS' : 'LOCKED';
    const tgw = textWidth(tag) + 8; const tgx = wide ? tx : Math.round(D.x + D.w / 2 - tgw / 2);
    cFill(ctx, tgx, y - 2, tgw, 11, mute ? C.night : darkOf(acc), 2); if (closed) cLine(ctx, tgx, y - 2, tgw, 11, C.indigo, 2);
    text(ctx, tag, tgx + 4, y, mute ? C.peri : C.cream); y += 15;
    if (!lock && !closed) {
      const cnt = `${p.have}/${p.need}`; const cx = D.x + D.w - 12;
      meter(ctx, tx, y + 1, cx - textWidth(cnt) - 8 - tx, 5, p.have, p.need, acc); text(ctx, cnt, cx, y, acc, { align: 'right' }); y += 14;
    }
    if (closed) {
      // why it closed comes first (the route that was taken), then the quest's own line, dimmed
      const why = wrap(this.closedNote(g, q), cw).slice(0, wide ? 3 : 6);
      for (const l of why) { text(ctx, l, tx, y, C.text); y += 10; } y += 4;
      for (const l of wrap(q.desc, cw).slice(0, wide ? Math.max(0, 4 - why.length) : 4)) { text(ctx, l, tx, y, C.dim); y += 10; }
    } else for (const l of wrap(lock ? this.startHint(g, q) : q.desc, cw).slice(0, wide ? 4 : 8)) { text(ctx, l, tx, y, lock ? C.dim : C.text); y += 10; }
    const rw = this.rewardText(q); y = D.y + D.h - 16;
    if (rw) { icon(ctx, 'gift', tx, y, lock || closed ? C.peri : C.pink); textFit(ctx, (closed ? 'REWARD WAITS: ' : 'REWARD ') + rw, tx + 11, y, D.x + D.w - 10 - (tx + 11), closed || lk.dimReward || st === 'done' ? C.dim : lock ? C.peri : C.pink); }
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
      this.polaroid(g, ctx, ms[i], i, cx + Math.floor((wv.cw - 52) / 2), cy + 6, i === this.sel); // one shared caption baseline per row (tape nudge keeps it hand-stuck)
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
    const ph = got ? photo(m.id) : lockedPhoto(m.id); const [sx, sy] = thumbAt(m.id);
    if (ph) ctx.drawImage(ph, sx, sy, THUMB_W, THUMB_H, x + 4, y + 4, THUMB_W, THUMB_H);
    if (got) text(ctx, `#${pad2(i + 1)}`, x + w / 2, y + 50, C.indigo, { align: 'center' });
    else {
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
    // big polaroid (photo 88x64) with a caption strip that holds up to two lines of title
    const pw = PHOTO_W + 8, ph = wide ? PHOTO_H + 20 : PHOTO_H + 26;
    const px = wide ? D.x + 12 : Math.round(D.x + D.w / 2 - pw / 2), py = wide ? D.y + 13 : D.y + 14;
    rect(ctx, px + 2, py + 2, pw, ph, C.deep); rect(ctx, px, py, pw, ph, got ? C.cream : C.indigo); rect(ctx, px, py, pw, 1, got ? C.text : C.peri);
    blit(ctx, got ? photo(m.id) : lockedPhoto(m.id), px + 4, py + 4);
    const cap = got ? wrap(m.title, 15) : [`SECTOR ${pad2(this.sector(g, m.area))}`];
    const lines = wide ? cap.slice(0, 1) : cap.slice(0, 2);
    if (wide && cap.length > 1) textFit(ctx, m.title, px + pw / 2, py + PHOTO_H + 8, pw - 6, C.indigo, { align: 'center' });
    else lines.forEach((l, k) => text(ctx, l, px + pw / 2, py + PHOTO_H + (lines.length > 1 ? 6 + k * 9 : 11), got ? C.indigo : C.line, { align: 'center' }));
    rect(ctx, px + pw / 2 - 9, py - 4, 18, 7, got ? C.pale : C.peri); rect(ctx, px + pw / 2 - 9, py - 4, 18, 1, got ? C.text : C.dim);
    const tx = wide ? px + pw + 14 : D.x + 12; let y = wide ? D.y + 10 : py + ph + 9; const cw = Math.floor((D.x + D.w - 10 - tx) / 6);
    const maxL = Math.floor((D.y + D.h - 20 - (y + 12)) / 10);
    if (got) {
      text(ctx, `MEMORY #${pad2(i + 1)}`, tx, y, C.pink); y += 12;
      for (const l of wrap(m.text, cw).slice(0, maxL)) { text(ctx, l, tx, y, C.text); y += 10; }
    } else {
      text(ctx, 'NOT FOUND YET', tx, y, C.dim); y += 12;
      const where = `${this.areaName(g, m.area)}, wave ${m.wave + 1}`;
      const hint = this.passed(g, m.area)
        ? `Missed in ${where}. Replay sector ${pad2(this.sector(g, m.area))} and watch for a glowing cat carrying a polaroid.`
        : `Somewhere in ${where}. Watch for a glowing cat carrying a polaroid and boop it gently.`;
      for (const l of wrap(hint, cw).slice(0, maxL)) { text(ctx, l, tx, y, C.peri); y += 10; }
    }
    const yy = D.y + D.h - 14; icon(ctx, 'flag', tx, yy, got ? C.pink : C.peri);
    textFit(ctx, `${this.sectorTag(g, m.area)} W${m.wave + 1}`, tx + 10, yy, D.x + D.w - 10 - (tx + 10), C.dim);
  }
  /** Full-size photo with its story, notes and page strip. It replaces the page body. */
  viewerDraw(g: Game, ctx: CanvasRenderingContext2D, L: Layout) {
    const m = g.content.memories[this.viewer]; if (!m) return;
    const pw = PHOTO_W * 2 + 16, ph = PHOTO_H * 2 + 32; const tw = 272; const cap = 18, gap = 6;
    const top = L.touch ? L.grid.y + 1 : L.grid.y - 2, bottom = L.panel.y + L.panel.h - (L.hints ? 24 : 8);
    const total = cap + gap + pw + 14 + tw + gap + cap; const x0 = Math.round(W / 2 - total / 2);
    const x = x0 + cap + gap, y = Math.max(top, Math.round((top + bottom) / 2 - ph / 2));
    // polaroid
    rect(ctx, x + 3, y + 3, pw, ph, C.deep); rect(ctx, x, y, pw, ph, C.cream); rect(ctx, x, y, pw, 1, C.text); rect(ctx, x, y + ph - 1, pw, 1, C.pale);
    blit(ctx, photo(m.id), x + 8, y + 8, 2);
    textFit(ctx, m.title, x + pw / 2, y + PHOTO_H * 2 + 15, pw - 12, C.indigo, { align: 'center' });
    rect(ctx, x + pw / 2 - 16, y - 5, 32, 9, C.pale); rect(ctx, x + pw / 2 - 16, y - 5, 32, 1, C.text);
    // story card
    const bx = x + pw + 14, by = y, bh = ph; cFrame(ctx, bx, by, tw, bh, C.pink, C.ink, 6);
    const found = g.content.memories.map((mm, k) => g.state.memories.includes(mm.id) ? k : -1).filter(k => k >= 0);
    const page = found.indexOf(this.viewer) + 1;
    text(ctx, `MEMORY #${pad2(this.viewer + 1)}`, bx + 12, by + 10, C.pink);
    textFit(ctx, m.title, bx + tw - 12, by + 10, tw - 24 - textWidth('MEMORY #00') - 10, C.gold, { align: 'right' });
    rect(ctx, bx + 12, by + 21, tw - 24, 1, C.plum);
    let ly = by + 27; for (const l of wrap(m.text, Math.floor((tw - 24) / 6)).slice(0, 5)) { text(ctx, l, bx + 12, ly, C.text); ly += 10; }
    // hand-written note with a doodled heart, then the postmark stamp (date + place)
    const [date, note] = NOTES[m.id] ?? ['', ''];
    const ny = Math.max(ly + 6, by + 76);
    if (note) { const nw = scrawl(ctx, note, bx + 16, ny, C.cream); for (let k = 0; k < nw; k += 4) rect(ctx, bx + 16 + k, ny + 9 + (k % 8 ? 1 : 0), 3, 1, C.mag); this.doodle(ctx, bx + 22 + nw, ny); }
    const sy = ny + 18, sw = tw - 24;
    dashed(ctx, bx + 12, sy, sw, 17, darkOf(C.pink));
    icon(ctx, 'flag', bx + 17, sy + 5, C.pink); textFit(ctx, `${this.sectorTag(g, m.area)} W${m.wave + 1}`, bx + 27, sy + 5, sw - 22 - textWidth(date) - 8, C.dim);
    if (date) text(ctx, date, bx + 12 + sw - 5, sy + 5, C.pink, { align: 'right' });
    // page strip: one dot per found polaroid, the open one wide and bright
    const dy = by + bh - 30; const dw = found.length * 6 - 2;
    text(ctx, `PAGE ${page} OF ${found.length}`, bx + 12, dy - 2, C.dim);
    let dx = bx + tw - 12 - dw - 4; for (const k of found) { const on = k === this.viewer; rect(ctx, dx, dy - (on ? 1 : 0), on ? 6 : 4, on ? 5 : 3, on ? C.pink : C.indigo); dx += on ? 8 : 6; }
    const dev = this.dev(g); const k = keys(dev); const hy = by + bh - 16;
    if (dev === 'touch') text(ctx, 'TAP THE PHOTO TO CLOSE', bx + 12, hy, C.dim);
    else { let hx = bx + 12; if (found.length > 1) { hx += keycap(ctx, '< >', hx, hy, C.pink) + 4; text(ctx, 'FLIP', hx, hy, C.dim); hx += textWidth('FLIP') + 12; } hx += keycap(ctx, k.back, hx, hy, C.pink) + 4; text(ctx, 'BACK', hx, hy, C.dim); }
    // flip caps next to the photo and the card (also tap targets)
    this.hits.push({ x: 0, y: 0, w: W, h: H, kind: 'viewer', i: 0 });
    if (found.length > 1) {
      const o = g.state.settings.reduceMotion ? 0 : (this.t >> 4) % 2; const cy = y + Math.round(ph / 2), chh = 34;
      for (const [cx, d] of [[x0, -1], [bx + tw + gap, 1]] as [number, number][]) {
        cFill(ctx, cx, cy - chh / 2, cap, chh, C.ink, 4); cLine(ctx, cx, cy - chh / 2, cap, chh, C.mag, 4);
        rect(ctx, cx + 4, cy - chh / 2 + 1, cap - 8, 1, C.plum);
        arrow(ctx, d < 0 ? cx + 7 - o : cx + cap - 8 + o, cy, d < 0 ? 'l' : 'r', 5, C.pink);
        this.hits.push({ x: cx - 4, y: cy - chh / 2 - 6, w: cap + 8, h: chh + 12, kind: 'viewer', i: d });
      }
    }
  }
  /** Tiny pen heart next to the hand-written note. */
  doodle(ctx: CanvasRenderingContext2D, x: number, y: number) {
    const c = C.hot; rect(ctx, x, y + 1, 2, 1, c); rect(ctx, x + 3, y + 1, 2, 1, c); rect(ctx, x - 1, y + 2, 1, 2, c); rect(ctx, x + 5, y + 2, 1, 2, c);
    rect(ctx, x + 2, y + 2, 1, 1, c); rect(ctx, x, y + 4, 1, 1, c); rect(ctx, x + 4, y + 4, 1, 1, c); rect(ctx, x + 1, y + 5, 1, 1, c); rect(ctx, x + 3, y + 5, 1, 1, c); rect(ctx, x + 2, y + 6, 1, 1, c);
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
      const sb = specimen(ctx, e, x + Math.floor(w / 2), base, seen);
      if (!seen) mystery(ctx, sb);
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
    const sb = specimen(ctx, e, bx + bw / 2, base, seen);
    if (!seen) mystery(ctx, sb);
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
      y += 12;
      // the same 4 pips as the grid card, with their legend
      text(ctx, 'THREAT', tx, y, C.dim); pips(ctx, tx + textWidth('THREAT') + 6, y + 2, threat(e), boss ? C.gold : C.hot, C.indigo, 5);
      y += 13;
      for (const l of wrap(e.bestiary, cw).slice(0, Math.floor((D.y + D.h - 18 - y) / 10))) { text(ctx, l, tx, y, C.text); y += 10; }
    } else {
      for (const l of wrap('Not met yet. Scanner data is fuzzy: this page fills in once it shows up in a wave.', cw).slice(0, Math.floor((D.y + D.h - 18 - y) / 10))) { text(ctx, l, tx, y, C.peri); y += 10; }
    }
    const home = this.homeArea(g, e);
    if (home) {
      const yy = D.y + D.h - 14; icon(ctx, 'flag', tx, yy, seen ? C.line : C.peri);
      const verb = boss ? (seen ? 'BOSS OF ' : 'RULES ') : seen ? 'SEEN IN ' : 'LURKS IN ';
      textFit(ctx, verb + this.sectorTag(g, home), tx + 10, yy, D.x + D.w - 10 - (tx + 10), C.dim);
    }
  }

  // ---- STATS
  statsTab(g: Game, ctx: CanvasRenderingContext2D, L: Layout) {
    const s = g.state; const st = s.stats; const ct = g.content;
    const aim = st.shots ? Math.round(100 * st.hits / st.shots) : 0;
    const frac = (a: number, b: number) => a / Math.max(1, b);
    const hi = Math.max(s.hiScore, s.score);
    const chain = g.mods.ui?.bestChain ?? 0;
    // big cats: every cleared sector's boss, plus the ones napped this session
    const bosses = new Set([...this.bossesDown, ...ct.areas.filter(a => s.areasCleared.includes(a.id) && a.boss).map(a => a.boss!)]);
    const nBoss = ct.areas.filter(a => a.boss).length;
    // pups: one lost pup rides with a capturer per sector (flag pup_<area> once rescued)
    const pupAreas = ct.areas.filter(a => a.waves.some(w => ct.waves.find(x => x.id === w)?.cats.some(c => ct.enemies.find(e => e.id === c.breed)?.behavior === 'capturer')));
    const pupsGot = pupAreas.filter(a => s.flags['pup_' + a.id]).length;
    let fav = ''; let favN = 0; for (const [b, n] of this.boops) if (n > favN) { fav = b; favN = n; }
    const favE = ct.enemies.find(e => e.id === fav);
    // [icon, label, value, icon colour, meter 0..1 or -1, caption, custom footer]
    type Tile = [string, string, string, string, number, string, ((x: number, y: number, w: number) => void)?];
    const tiles: Tile[] = [
      ['star', 'SCORE', String(s.score), C.gold, frac(s.score, hi), 'OF YOUR BEST'],
      ['star', 'HI SCORE', String(hi), C.gold, -1, 'PERSONAL BEST'],
      ['cat', 'CATS BOOPED', String(st.catsBooped), C.line, -1, 'GENTLY, ALWAYS'],
      ['wave', 'BEST CHAIN', String(chain), C.pink, -1, chain >= 20 ? 'BOOP COMBO. WOW' : 'BOOP COMBO'],
      ['bolt', 'TURDS TOOTED', String(st.shots), C.orange, frac(st.hits, st.shots), `${st.hits} DIRECT HITS`],
      ['paw', 'AIM', String(aim), C.lime, aim / 100, aim >= 60 ? 'PERCENT. SHARP NOSE' : 'PERCENT. KEEP SNIFFING'],
      ['moon', 'NAPS TAKEN', String(st.naps), C.violet, -1, st.naps ? 'WELL RESTED' : 'NO NAPS YET'],
      ['clock', 'FLIGHT TIME', fmtTime(st.playTicks), C.line, -1, 'TIME ALOFT'],
      ['pup', 'PUPS RESCUED', `${pupsGot}/${pupAreas.length}`, C.pink, -1, 'BY SECTOR', (x, y, w) => {
        const n = pupAreas.length; const pw = Math.max(3, Math.min(24, Math.floor((w + 1) / Math.max(1, n)) - 1));
        pupAreas.forEach((a, k) => { const on = !!s.flags['pup_' + a.id]; rect(ctx, x + k * (pw + 1) - 1, y - 1, pw + 2, 6, C.ink); rect(ctx, x + k * (pw + 1), y, pw, 4, on ? C.pink : C.night); rect(ctx, x + k * (pw + 1), y, pw, 1, on ? C.text : C.indigo); });
      }],
      ['crown', 'BIG CATS NAPPED', `${bosses.size}/${nBoss}`, C.gold, frac(bosses.size, nBoss), 'BOSSES DEFEATED'],
      ['flag', 'SECTORS', `${s.areasCleared.length}/${ct.areas.length}`, C.lime, frac(s.areasCleared.length, ct.areas.length), 'CLEARED'],
      ['cat', 'FAVOURITE TARGET', favE ? favE.name : 'NONE YET', C.line, -1, favE ? `${favN} BOOPS` : 'BOOP SOME CATS'],
    ];
    const B = L.touch ? L.grid : { x: L.grid.x, y: L.grid.y, w: L.detail.x + L.detail.w - L.grid.x, h: L.grid.h };
    const cols = 4, rows = 3, gap = 6; const tw = Math.floor((B.w - gap * (cols - 1)) / cols), th = Math.floor((B.h - gap * (rows - 1)) / rows);
    tiles.forEach(([ic, lbl, val, c, p, sub, foot], i) => {
      const x = B.x + (i % cols) * (tw + gap), y = B.y + Math.floor(i / cols) * (th + gap);
      // one violet frame for every card: colour lives in the icons and meters only
      cFrame(ctx, x, y, tw, th, C.violet, C.panel, 5);
      if (ic === 'crown') mini(ctx, 'crown', x + 9, y + 9, c); else icon(ctx, ic, x + 9, y + 9, c, C.ink);
      textFit(ctx, lbl, x + 20, y + 9, tw - 28, C.dim);
      const isName = ic === 'cat' && i === tiles.length - 1;
      if (th >= 60) {
        if (isName) { textFit(ctx, val, x + 10, y + 28, tw - 20 - (favE ? 34 : 0), favE ? C.text : C.peri); if (favE) this.favSprite(ctx, favE, x + tw - 26, y + th - 12); }
        else num(ctx, val, x + 10, y + 26, C.text, { hi: C.cream, shadow: C.purple });
        if (foot) { text(ctx, sub, x + 10, y + 46, C.peri); foot(x + 10, y + th - 15, tw - 20); }
        else if (p >= 0) { text(ctx, sub, x + 10, y + 46, C.peri); meter(ctx, x + 10, y + th - 15, tw - 20, 4, Math.round(p * 100), 100, c); }
        else { textFit(ctx, sub, x + 10, y + th - 18, tw - 20 - (isName && favE ? 34 : 24), C.peri); if (!isName) this.badge(ctx, ic, x + tw - 22, y + th - 22, c); }
      } else {
        textFit(ctx, val, x + tw - 9, y + 24, tw - 18, C.text, { align: 'right' });
        if (foot) foot(x + 9, y + th - 10, tw - 18);
        else if (p >= 0) meter(ctx, x + 9, y + th - 10, tw - 18, 2, Math.round(p * 100), 100, c);
      }
    });
  }
  /** The favourite target's sprite, small, standing on the card's footer line. */
  favSprite(ctx: CanvasRenderingContext2D, e: EnemyDef, cx: number, by: number) {
    const c = spriteCanvas(e.sprite, 0, false); if (!c) return; const b = bbox(c); if (b.h > 34) return;
    const s = Math.max(1, Math.floor(32 / Math.max(b.w, b.h)));
    blit(ctx, c, Math.round(cx - (b.x + b.w / 2) * s), by - (b.y + b.h) * s, s);
  }
  /** Icon on a little chamfered plate: the illustration on stat cards that have no meter. */
  badge(ctx: CanvasRenderingContext2D, ic: string, x: number, y: number, c: string) {
    cFill(ctx, x - 4, y - 4, 18, 18, C.night, 3); cLine(ctx, x - 4, y - 4, 18, 18, C.purple, 3);
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
