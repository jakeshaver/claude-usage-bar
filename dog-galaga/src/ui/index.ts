import type { Game, Module } from '../core/game';
import { drawRecoveryCard } from '../save/index';
import { flame } from '../player/draw';
import { POM_NOZZLES } from '../player/pom-art';
import { W, H, PF_X, PF_W } from '../core/game';
import { text, wrap, textWidth } from '../art/font';
import { drawSprite, spriteCanvas, frameCount, SHEETS } from '../art/sprite';
import { KEY, col } from '../core/palette';
import { C, frame, bar, segBar, menu, scanlines, header, icon, rect, line, ring, disc, dither, arrow, keycap, hintRow, hintWidth, chamferFill, chamferLine, darkOf, lighter, keys, ticks, dimRect, type Device, type Row } from './draw';
import { logoWord, drawLogo, PINK, CYAN, GOLD } from './logo';
import { glyph } from './glyphs';
import { Touch } from './touch';
import { num, numWidth, headline } from './numerals';
import { tiny, tinyWidth, wrapPx, balancePx } from './tiny';
import { ENDING_ART } from './ending-art';
import { defineSprites } from '../art/sprite';
defineSprites(ENDING_ART);

type Menu = 'none' | 'pause' | 'settings' | 'journal' | 'confirmQuit';
const RX = PF_X + PF_W;               // right panel x
const P20 = col(20);                  // dark green (lime's frame partner)
const PW = W - RX;                    // panel width (128)
const TITLE_CATS = ['cat_tabby', 'cat_siamese', 'cat_calico', 'cat_sphynx'];
const MAP_LIST_X = W - 180;          // sector log column on the star chart
const DLG_H = 62;                     // dialogue box height (docked to the bottom of the playfield)
const SILHOUETTE: Record<string, string> = Object.fromEntries([...KEY].map(k => [k, '2']));
/** Power slots: [power kind, sprite, slot name, accent, what it does (first-pickup toast)]. */
const POWERS: [string, string, string, string, string][] = [['double', 'pk_bone', 'TWIN', C.gold, 'TWIN TOOTS'], ['spread', 'pk_chili', 'WIDE', C.orange, 'WIDE SPREAD'], ['shield', 'pk_bandana', 'SAFE', C.line, 'SAFE SHIELD'], ['speed', 'pk_sneaker', 'FAST', C.lime, 'FAST FLYING']];

/** Panel accents per time of day: [left panel, right panel, scanner glow]. */
function todAccent(tod: string): [string, string, string] {
  if (tod === 'dawn') return [C.orange, C.gold, C.orange];
  if (tod === 'dusk') return [C.hot, C.violet, C.hot];
  if (tod === 'night') return [C.violet, C.line2, C.line2];
  return [C.pink, C.line, C.lime];
}
/** Dominant body color of a sprite (for tinting 7px breed icons), cached. */
const breedColors = new Map<string, string>();
function breedColor(sprite: string): string {
  let c = breedColors.get(sprite); if (c) return c;
  const rows = SHEETS[sprite]?.rows ?? []; const n: Record<string, number> = {};
  for (const r of rows) for (const ch of r) if (!'.0167v12'.includes(ch)) n[ch] = (n[ch] ?? 0) + 1;
  const best = Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0];
  c = best ? col(best) : C.hot;
  breedColors.set(sprite, c); return c;
}

/** 4x4 Bayer thresholds for ordered dither (0..15). */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
let nebCache: HTMLCanvasElement | null | undefined;
/** Star-chart nebulae: noisy ellipses split into 3 solid tone bands; only band borders use ordered dither. */
function nebulaCanvas(): HTMLCanvasElement | null {
  if (nebCache !== undefined) return nebCache;
  if (typeof document === 'undefined') return (nebCache = null);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const x2 = cv.getContext('2d'); if (!x2) return (nebCache = null);
  // [cx, cy, rx, ry, outer, mid, core, seed]
  const blobs: [number, number, number, number, string, string, string, number][] = [
    [160, 120, 128, 58, C.night, C.plum, C.indigo, 1], [470, 210, 160, 62, C.night, C.plum, C.indigo, 2], [330, 96, 96, 38, C.night, C.indigo, C.deep, 3],
    [86, 232, 96, 44, C.night, C.indigo, C.deep, 4], [566, 104, 84, 42, C.night, C.plum, C.peri, 5]];
  const img = x2.createImageData(W, H); const d = img.data;
  const rgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const level = new Uint8Array(W * H); const colorOf: string[][] = [];
  blobs.forEach(([cx, cy, rx, ry, c1, c2, c3, sd], bi) => {
    colorOf[bi] = [c1, c2, c3];
    for (let y = Math.max(0, cy - ry - 8); y < Math.min(H, cy + ry + 8); y++) for (let x = Math.max(0, cx - rx - 12); x < Math.min(W, cx + rx + 12); x++) {
      const nx = (x - cx) / rx, ny = (y - cy) / ry; const a = Math.atan2(ny, nx);
      const r = Math.hypot(nx, ny) / (1 + 0.13 * Math.sin(a * 3 + sd) + 0.07 * Math.sin(a * 5 + sd * 2.3) + 0.04 * Math.sin(a * 9 + sd));
      // band value 0..3 (3 = core); the fractional part near each border feeds the Bayer threshold
      const v = r < 0.24 ? 3 : r < 0.34 ? 2 + (0.34 - r) / 0.1 : r < 0.6 ? 2 : r < 0.7 ? 1 + (0.7 - r) / 0.1 : r < 0.86 ? 1 : r < 1 ? (1 - r) / 0.14 : 0;
      const b = Math.floor(v), f = v - b; const th = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
      const lv = Math.min(3, b + (f > th ? 1 : 0));
      const i = y * W + x; if (lv > (level[i] & 3)) level[i] = lv | (bi << 2);
    }
  });
  for (let i = 0; i < level.length; i++) {
    const lv = level[i] & 3; if (!lv) continue;
    const [r, g, b] = rgb(colorOf[level[i] >> 2][lv - 1]); d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
  }
  x2.putImageData(img, 0, 0); return (nebCache = cv);
}
/** 7x7 lime check mark (cleared sector badge). */
function checkMark(ctx: CanvasRenderingContext2D, x: number, y: number) {
  for (const [dx, dy] of [[0, 3], [1, 4], [2, 5], [3, 4], [4, 3], [5, 2], [6, 1], [1, 3], [2, 4], [3, 3], [4, 2], [5, 1]]) rect(ctx, x + dx, y + dy, 1, 1, C.lime);
}

/** 9x7 sound chip glyphs: '#' speaker, 'w' sound waves, 'x' the red cross. */
const SND_ON = ['...#...w.', '..##.w..w', '####..w.w', '####..w.w', '####..w.w', '..##.w..w', '...#...w.'];
/** Sound chip rect origin (17x11): one widget, one place, on every scene. */
const SND_X = 613, SND_Y = 7;
const SND_OFF = ['...#.....', '..##.....', '####.x.x.', '####..x..', '####.x.x.', '..##.....', '...#.....'];
/** Ending timeline: Pom's flight takes END_FLY ticks, each pup trails END_LAG ticks behind the previous one. */
const END_FLY = 360, END_LAG = 26, END_MAX_PUPS = 16, END_WIN = 204, END_WIN_TOP = 4, END_LINE = 24, END_FADE = 12;
/** Ending diorama: Pom's spot on the lawn (2x sitting pose centre). */
const END_POM_X = 320, END_POM_Y = 292;
/** Closing card beats: the story holds END_HOLD ticks after its last line, dithers out over END_OUT, then the stats
 *  come in (staggered chips, quest rewards, the epitaph) on a clean sky: never both at once. */
const END_HOLD = 210, END_OUT = 32;
/** Coats for the rescued pups (recolours of the apricot end_pup_sit / end_pup_fly sheets), collars included. */
const PUP_COATS: Record<string, string>[] = [
  {}, { '8': '6', '9': '7', 'a': '8', 'b': '9', '7': '6', 'r': 'm' }, { '8': 'g', '9': 'h', 'a': 'b', 'b': 'b', 'r': 'l' },
  { '8': 'o', '9': 'p', 'a': 'q', 'b': 'q', 'r': 'c' }, { '8': '9', '9': 'a', 'a': 'b', 'b': 'v', '7': '8', 'r': 'i' },
  { '8': 'f', '9': 'g', 'a': 'h', 'b': 'h', 'r': 'm' }, { '8': '6', '9': '6', 'a': '5', 'b': 'q', '7': '6', 'r': 'd' },
  { '8': 'p', '9': 'q', 'a': '1', 'b': '0', '7': 'o', 'r': 'f' },
];
/** Toasts: at most TOAST_CAP on screen, wrapped to TOAST_COLS glyphs so a pill never outgrows the playfield. */
type ToastKind = 'good' | 'warn';
type ToastOpts = { kind?: ToastKind };
type Toast = { text: string; t: number; age: number; y: number; kind?: ToastKind };
const TOAST_CAP = 2, TOAST_COLS = Math.floor((PF_W - 8 - 30 + 1) / 6);
/** News that costs the player something: drawn with a peri frame and a pink cross, never the gold star. */
const BAD_NEWS = /MISSED|EXPIRED|CLOSED|CLOSES|FORFEIT|SEALED|LOCKED|BLOCKED|CONTENT ISSUE|CHEWED/;
/** Settings rows: label, icon, settings key ('' = BACK). */
const SETTINGS_ROWS: [string, string, 'music' | 'sfx' | 'amb' | 'shake' | 'flash' | 'reduceMotion' | 'touch' | ''][] = [
  ['MUSIC', 'note', 'music'], ['SFX', 'speaker', 'sfx'], ['AMBIENCE', 'speaker', 'amb'], ['SCREEN SHAKE', 'shake', 'shake'],
  ['FLASHES', 'bolt', 'flash'], ['REDUCE MOTION', 'wave', 'reduceMotion'], ['TOUCH CONTROLS', 'hand', 'touch'], ['BACK', 'back', ''],
];

/** A sprite at an exact integer 2x (nearest neighbour), centred on (cx, cy): the hero shots and the ending diorama. */
function draw2x(ctx: CanvasRenderingContext2D, name: string, cx: number, cy: number, o: { frame?: number; flipX?: boolean; recolor?: Record<string, string> } = {}) {
  const c = spriteCanvas(name, o.frame ?? 0, false, o.recolor); if (!c) return;
  const w = c.width * 2, h = c.height * 2; const x = Math.round(cx - w / 2), y = Math.round(cy - h / 2);
  ctx.imageSmoothingEnabled = false;
  if (o.flipX) { ctx.save(); ctx.translate(x + w, y); ctx.scale(-1, 1); ctx.drawImage(c, 0, 0, w, h); ctx.restore(); }
  else ctx.drawImage(c, x, y, w, h);
}
/** Centred credits text with a full 1px ink outline (reads over any sky band). */
function inked(ctx: CanvasRenderingContext2D, s: string, cx: number, y: number, c: string) {
  // a subtle 50% ink scrim under the line (bunting, skyline and clouds never cut through it), then a full 8-way outline
  const w = textWidth(s); dither(ctx, Math.round(cx - w / 2) - 4, y - 3, w + 8, 13, C.ink, 'check');
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) text(ctx, s, cx + dx, y + dy, C.ink, { align: 'center' });
  text(ctx, s, cx, y, c, { align: 'center' });
}
const smooth = (v: number) => { const e = v < 0 ? 0 : v > 1 ? 1 : v; return e * e * (3 - 2 * e); };

/** HUD roster short names (one 9px line each in the 108px HOSTILES slot); the journal keeps the full names. */
/** Ticks after a Big Cat's entrance that toasts keep waiting (covers its taunt and the first telegraphed tell). */
const BOSS_INTRO_GRACE = 150;
/** Sector short names: one display name for the HUD sector header and the map's sector log whenever the full name
 *  would not fit one line of the regular face (NEXT HOP still shows the full name). */
const LOG_SHORT: Record<string, string> = { station: 'SCRATCH STATION', cafe: 'PURRFECT CUP CAFE', rooftops: 'MANHATTAN ROOFS' };
const HUD_BREED: Record<string, string> = {
  tabby: 'TABBY GRUNT', tuxedo: 'TUXEDO DIVER', siamese: 'SIAMESE', calico: 'CALICO', persian: 'PUFFBALL',
  scottishfold: 'YARNWITCH', bengal: 'BENGAL BOLT', sphynx: 'ZIGZAGGER', mainecoon: 'MAINE COON',
  russianblue: 'BLUE SNIPER', kitten: 'KITTEN',
};
/** UI shell: HUD panels, title, sector map, pause, settings, dialogue box, ending, recovery, toasts. */
class UI implements Module {
  id = 'ui';
  api = this;
  g!: Game;
  t = 0; sel = 0; menuOpen: Menu = 'none'; settingsFrom: Menu | 'title' = 'pause';
  /** Toast stack: the first TOAST_CAP (one in a live wave / boss) are on screen and ageing; the rest wait in line. */
  toasts: Toast[] = [];
  mapSel = 0; endingT = 0; shownScore = 0; lastHearts = -1; heartFlash = 0;
  chain = 0; bestChain = 0; lastBoop = -999; chainPop = 0;
  powMax: Record<string, number> = {}; waveCats = 0; bossBarOn = false;
  /** Conversation parked while the pause menu is open during dialogue (quest.update idles without it). */
  heldDlg: any = null;
  /** Ticks the game stays paused after a menu closes while fire/confirm is still held (no stray turd on resume). */
  resumeHold = 0;
  /** Hit rects of the menu rows drawn this frame (touch tap-to-select). */
  rows: Row[] = [];
  touch = new Touch();

  init(g: Game) {
    this.g = g;
    g.toastFn = (s, o) => this.toast(s, o);
    g.bus.on('scene:change', (p: any) => {
      this.sel = p.to === 'title' && !this.g.mods.save?.hasSave() ? 1 : 0; this.mapSel = 0;
      // the ending owns the screen: quest / reward news still in flight is flushed, not stamped on the title card
      if (p.to === 'ending') { this.endingT = 0; this.plan = null; this.toasts = []; this.toastPend = []; }
      if (p.to !== 'play' && p.to !== 'bonus') this.menuOpen = this.menuOpen === 'journal' ? 'journal' : 'none';
    });
    g.bus.on('save:recovered', (p: any) => this.toast(this.g.mods.save?.recoveryOptions?.().recoveredToast(p?.slot) ?? 'SAVE PATCHED UP FROM BACKUP'));
    g.bus.on('cat:boop', () => {
      this.chain = g.tick - this.lastBoop <= 100 ? this.chain + 1 : 1; this.lastBoop = g.tick;
      this.bestChain = Math.max(this.bestChain, this.chain); this.chainPop = 8;
    });
    g.bus.on('wave:start', () => { this.waveCats = 0; });
    g.bus.on('player:nap', () => { this.chain = 0; });
    if (g.contentIssues.length) setTimeout(() => this.toast(`${g.contentIssues.length} CONTENT ISSUE(S): USING SAFE DEFAULTS`), 0);
    if (!g.headless) this.touch.attach(g);
  }
  /** Staged showcases mute HUD toasts (presentational only). */
  toastsMuted = false;
  muteToasts(on: boolean) { this.toastsMuted = on; if (on) this.toasts = []; }
  /** extra toast hold (on top of the automatic hold while memories' reveal card is up) */
  private toastHold = false; private toastPend: { s: string; o?: ToastOpts }[] = [];
  holdToasts(on: boolean) { this.toastHold = on; }
  /** In a live wave or boss fight toasts play one at a time (a stack would cover the formation's top rows). */
  private toastsSingle() { const g = this.g; const m = g?.mods.interaction?.mode; return g?.state.scene === 'play' && (m === 'wave' || m === 'boss'); }
  private toastsHeld() { const sc = this.g?.state.scene; return this.toastHold || this.bossIntro() || (!!this.g?.mods.memories?.revealing?.() && (sc === 'play' || sc === 'bonus')); }
  /** Ticks since the current Big Cat finished its entrance (-1: no boss up). */
  private bossCalm = -1;
  /**
   * Boss intro window: from the Big Cat's swoop-in (and its taunt) through its first wind-up tell, news waits in the
   * queue (NEW QUEST: BIG CAT TAMER and friends play once the fight has settled, not over the entrance).
   */
  private bossIntro() {
    const g = this.g; const B = g?.mods.interaction?.boss;
    if (!B || B.dead || (g.state.scene !== 'play' && g.state.scene !== 'dialogue')) return false;
    return !!B.entering || this.bossCalm < BOSS_INTRO_GRACE;
  }
  /** opts.kind: 'warn' = bad news (peri frame, pink cross), 'good' = lime text; omitted = matched from the text. */
  toast(s: string, opts?: ToastOpts) {
    if (this.toastsMuted) return;
    if (this.g?.state.scene === 'ending') return; // the ending is a set piece: no quest / reward pills over it
    if (this.toastsHeld()) { if (this.toastPend.length < 4) this.toastPend.push({ s, o: opts }); return; }
    // power pickups: name the HUD slot the item lights up, so the bay labels and pickups tie together
    const it = this.g?.content?.items?.find(i => i.name.toUpperCase() === s);
    const pw = it && POWERS.find(p => p[0] === it.effect.kind);
    if (pw) s = `${s}: ${pw[4]}`;
    this.toasts.push({ text: s.toUpperCase(), t: 170, age: 0, y: -1, kind: opts?.kind });
    if (this.toasts.length > 8) this.toasts.splice(this.toastCap(), 1); // a long backlog drops its oldest waiting news
  }
  /** How many toasts are on screen at once: two, or one at a time in a live wave / boss fight. */
  private toastCap() { return this.toastsSingle() ? 1 : TOAST_CAP; }
  openPause() {
    if (this.menuOpen !== 'none') return;
    const Q = this.g.mods.quest;
    if (this.g.state.scene === 'dialogue' && Q?.dlg) { this.heldDlg = Q.dlg; Q.dlg = null; }
    this.menuOpen = 'pause'; this.sel = 0; this.g.paused = true; this.resumeHold = 0; this.g.mods.audio?.sfx('select');
  }
  /** Close every menu. hold = keep the game paused until fire/confirm is released (resume via A / SPACE). */
  closeMenus(hold = true) {
    this.menuOpen = 'none';
    const Q = this.g.mods.quest; if (this.heldDlg && Q) { Q.dlg = this.heldDlg; } this.heldDlg = null;
    const I = this.g.input;
    if (hold && (I.held('fire') || I.held('confirm'))) { this.resumeHold = 1; this.g.paused = true; } else { this.resumeHold = 0; this.g.paused = false; }
  }
  openMap() { this.g.setScene('map'); }
  showDialogue(id: string) { this.g.mods.quest?.dialogue(id); }
  /** Device for button prompts: the visible touch deck wins (unless a gamepad is in use under 'auto'). */
  dev(): Device {
    const g = this.g; const last = g.input.lastDevice;
    if (this.touch.visible(g) && (last !== 'gamepad' || g.state.settings.touch === 'on')) return 'touch';
    return last;
  }
  /** Fast-forward the whole open conversation (dedicated skip key, or SKIP BRIEFING in the pause menu). */
  skipDialogue(g: Game) {
    const Q = g.mods.quest; if (!Q) return;
    Q.skipAll?.(); // bounded inside the engine; also handles a briefing staged behind the title card
    for (let i = 0; i < 80 && Q.dlg && g.state.scene === 'dialogue'; i++) { Q.dlg.chars = 1e9; Q.advance(); }
    g.mods.audio?.sfx('blip');
  }
  /** Touch: index of the menu row under (x, y), or -1. */
  rowAt(x: number, y: number) { return this.rows.findIndex(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h); }
  /** Touch: tap on a menu row selects it (the touch layer then sends confirm). */
  tapRow(x: number, y: number) {
    const i = this.rowAt(x, y); if (i < 0) return false;
    if (this.g.state.scene === 'title' && this.menuOpen === 'none' && this.titleDisabled()[i]) return false;
    this.sel = i; return true;
  }

  update(g: Game) {
    this.t++;
    // boss intro clock: 0 while the Big Cat swoops in, then counts up (a boss staged mid-fight starts settled)
    const B1 = g.mods.interaction?.boss;
    this.bossCalm = !B1 ? -1 : B1.entering ? 0 : this.bossCalm < 0 ? BOSS_INTRO_GRACE : this.bossCalm + (g.paused || this.bossCalm >= BOSS_INTRO_GRACE ? 0 : 1);
    // toasts hold while a menu is open (they sit under the dim layer and resume afterwards)
    // ...and while a memory reveal card is up (held toasts play the tick it leaves)
    const held = this.toastsHeld();
    if (!held && this.toastPend.length) { const q = this.toastPend; this.toastPend = []; for (const p of q) this.toast(p.s, p.o); }
    // the boss intro only queues new news: pills already up keep ageing out so the entrance is clean
    if (this.menuOpen === 'none' && (!held || (this.bossIntro() && !this.toastHold && !this.g.mods.memories?.revealing?.()))) {
      // at most TOAST_CAP on screen (one at a time in combat); the rest queue. A waiting queue shortens the front
      // toast so the news stays fresh.
      const cap = this.toastCap();
      if (this.toasts.length > cap) { const f = this.toasts[0]; f.t = Math.min(f.t, 110); }
      for (const x of this.toasts.slice(0, cap)) { x.t--; x.age++; }
      this.toasts = this.toasts.filter(x => x.t > 0);
    }
    if (this.resumeHold > 0) {
      const I0 = g.input;
      if ((I0.held('fire') || I0.held('confirm')) && this.resumeHold < 30 && this.menuOpen === 'none') { this.resumeHold++; g.paused = true; }
      else { this.resumeHold = 0; if (this.menuOpen === 'none') g.paused = false; }
    }
    // rolling score counter + heart-loss flash
    const s = g.state; const diff = s.score - this.shownScore;
    this.shownScore = diff <= 0 ? s.score : this.shownScore + Math.max(1, Math.ceil(diff / 6));
    if (this.lastHearts >= 0 && s.hearts < this.lastHearts) this.heartFlash = 40;
    this.lastHearts = s.hearts; if (this.heartFlash > 0) this.heartFlash--;
    if (this.chainPop > 0) this.chainPop--;
    if (this.chain && g.tick - this.lastBoop > 100) this.chain = 0;
    const P = g.mods.player;
    for (const [k] of POWERS) { const v = P?.powers?.[k] ?? 0; this.powMax[k] = v > 0 ? Math.max(this.powMax[k] ?? 0, v) : 0; }
    const live = (g.mods.interaction?.cats ?? []).length; this.waveCats = Math.max(this.waveCats, live);
    const I = g.input; const sc = g.state.scene;
    // autopilot drives menus itself, but a real pause press still opens the pause menu (and its nav then runs)
    const pauseable = sc === 'play' || sc === 'bonus' || sc === 'map' || sc === 'dialogue';
    if (g.autopilot && this.menuOpen === 'none' && !(pauseable && I.pressed('pause'))) {
      if (sc === 'ending') this.endingT++; // the ending timeline plays under autopilot too (it never leaves on its own)
      this.autopilotNav(g); return;
    }
    if (this.menuOpen === 'journal') { if (g.mods.journal?.update2) g.mods.journal.update2(g, () => { this.menuOpen = this.settingsFrom === 'title' ? 'none' : 'pause'; }); return; }
    if (this.menuOpen === 'settings') return this.settingsNav(g);
    if (this.menuOpen === 'pause') {
      const items = this.pauseItems();
      if (I.pressed('up')) { this.sel = (this.sel + items.length - 1) % items.length; g.mods.audio?.sfx('blip'); }
      if (I.pressed('down')) { this.sel = (this.sel + 1) % items.length; g.mods.audio?.sfx('blip'); }
      if (I.pressed('pause') || I.pressed('back')) this.closeMenus();
      else if (I.pressed('confirm')) {
        g.mods.audio?.sfx('select');
        const it = items[this.sel];
        if (it === 'RESUME') this.closeMenus();
        else if (it === 'SKIP BRIEFING') { this.closeMenus(); this.skipDialogue(g); }
        else if (it === 'JOURNAL') { this.menuOpen = 'journal'; this.settingsFrom = 'pause'; g.mods.journal?.open(); }
        else if (it === 'SETTINGS') { this.menuOpen = 'settings'; this.settingsFrom = 'pause'; this.sel = 0; }
        else if (it === 'COPY SAVE CODE') this.copySaveCode(g);
        else if (it === 'SAVE & QUIT') { const inDlg = !!this.heldDlg; this.closeMenus(false); if (inDlg) this.skipDialogue(g); g.mods.save?.save(); g.mods.interaction?.clearAll(); g.setScene('title'); }
      }
      return;
    }
    if (sc === 'dialogue' && I.pressed('back')) { this.skipDialogue(g); return; }
    if (pauseable && I.pressed('pause')) { this.openPause(); return; }
    if (sc === 'title') this.titleNav(g);
    else if (sc === 'map') this.mapNav(g);
    else if (sc === 'ending') {
      // confirm during the flight or the credits skips to the fully typed card; on the card it returns to the title
      // the next press on the story fades it out and brings the stats; the press after that (once they are up) leaves
      this.endingT++; const P = this.endPlan(g); const ct = this.endingT - P.card;
      if (I.pressed('confirm')) {
        if (ct < P.reveal) this.endingT = P.card + P.reveal;
        else if (ct < P.reveal + END_HOLD) { if (ct >= P.reveal + 20) this.endingT = P.card + P.reveal + END_HOLD; }
        else if (ct >= P.reveal + END_HOLD + END_OUT + 24) g.setScene('title');
      }
    }
    else if (sc === 'recovery') this.recoveryNav(g);
  }

  autopilotNav(g: Game) {
    const sc = g.state.scene;
    if (sc === 'map' && !g.botDrivesMap && this.t % 30 === 0) { const ex = g.mods.world.exitsFrom(g.state.areaId); if (ex.length) {
      // take the hop that finishes a quest (the open catnip gate) like a player would; otherwise the seed's pick
      const fin = ex.findIndex((e: { to: string }) => (g.mods.quest?.completes?.(e.to)?.length ?? 0) > 0);
      g.mods.world.chooseExit(ex[fin >= 0 ? fin : (g.state.seed + g.state.areasCleared.length) % ex.length].to);
    } }
  }

  titleItems() { return ['CONTINUE', 'NEW GAME', 'JOURNAL', 'SETTINGS']; }
  titleDisabled() { return [!this.g.mods.save?.hasSave(), false, false, false]; }
  pauseItems() { return this.heldDlg ? ['RESUME', 'SKIP BRIEFING', 'JOURNAL', 'SETTINGS', 'COPY SAVE CODE', 'SAVE & QUIT'] : ['RESUME', 'JOURNAL', 'SETTINGS', 'COPY SAVE CODE', 'SAVE & QUIT']; }
  /** COPY SAVE CODE: clipboard API when allowed, else a hint for the Ctrl+C shortcut save listens for */
  copySaveCode(g: Game) {
    const code: string = g.mods.save?.exportString?.() ?? '';
    if (!code) { this.toast('NO SAVE TO COPY YET'); return; }
    const clip = (globalThis as any).navigator?.clipboard;
    if (clip?.writeText) clip.writeText(code).then(() => this.toast('SAVE CODE COPIED'), () => this.toast('PRESS CTRL+C TO COPY'));
    else this.toast('PRESS CTRL+C TO COPY');
  }

  titleNav(g: Game) {
    const I = g.input; const items = this.titleItems(); const off = this.titleDisabled();
    const step = (d: number) => { let k = this.sel; for (let i = 0; i < items.length; i++) { k = (k + d + items.length) % items.length; if (!off[k]) break; } this.sel = k; g.mods.audio?.sfx('blip'); };
    if (off[this.sel]) this.sel = off.findIndex(x => !x);
    if (I.pressed('up')) step(-1);
    if (I.pressed('down')) step(1);
    if (I.pressed('confirm') && !off[this.sel]) {
      g.mods.audio?.sfx('bark');
      const it = items[this.sel];
      if (it === 'CONTINUE') g.mods.save.load();
      else if (it === 'NEW GAME') g.mods.world.transition('iris', () => g.mods.world.newGame());
      else if (it === 'JOURNAL') { this.menuOpen = 'journal'; this.settingsFrom = 'title'; g.mods.journal?.open(); }
      else if (it === 'SETTINGS') { this.menuOpen = 'settings'; this.settingsFrom = 'title'; this.sel = 0; }
    }
  }
  settingsNav(g: Game) {
    const I = g.input; const s = g.state.settings; const n = SETTINGS_ROWS.length; const back = n - 1;
    if (I.pressed('up')) { this.sel = (this.sel + n - 1) % n; g.mods.audio?.sfx('blip'); }
    if (I.pressed('down')) { this.sel = (this.sel + 1) % n; g.mods.audio?.sfx('blip'); }
    // left/right adjust; confirm also cycles toggles so a single button works on gamepad/touch
    const key = SETTINGS_ROWS[this.sel][2];
    let d = I.pressed('left') ? -1 : I.pressed('right') ? 1 : 0;
    if (!d && I.pressed('confirm') && this.sel !== back && key !== 'music' && key !== 'sfx' && key !== 'amb') d = 1;
    if (d) {
      const vol = (v: number) => Math.max(0, Math.min(1, Math.round((v + d * 0.1) * 10) / 10));
      if (key === 'music') s.music = vol(s.music);
      else if (key === 'sfx') s.sfx = vol(s.sfx);
      else if (key === 'amb') s.amb = vol(s.amb);
      else if (key === 'shake') s.shake = !s.shake;
      else if (key === 'flash') s.flash = !s.flash;
      else if (key === 'reduceMotion') s.reduceMotion = !s.reduceMotion;
      else if (key === 'touch') s.touch = (['auto', 'on', 'off'] as const)[((['auto', 'on', 'off'].indexOf(s.touch) + d) + 3) % 3];
      g.mods.audio?.setVolumes(); g.mods.audio?.sfx('blip');
    }
    if (I.pressed('back') || I.pressed('pause') || (I.pressed('confirm') && this.sel === back)) {
      g.mods.save?.save(); this.menuOpen = this.settingsFrom === 'title' ? 'none' : 'pause'; this.sel = this.settingsFrom === 'title' ? 3 : this.pauseItems().indexOf('SETTINGS');
    }
  }
  mapNav(g: Game) {
    const I = g.input; const ex = g.mods.world.exitsFrom(g.state.areaId);
    if (!ex.length) return;
    if (I.pressed('left') || I.pressed('up')) { this.mapSel = (this.mapSel + ex.length - 1) % ex.length; g.mods.audio?.sfx('blip'); }
    if (I.pressed('right') || I.pressed('down')) { this.mapSel = (this.mapSel + 1) % ex.length; g.mods.audio?.sfx('blip'); }
    if (I.pressed('confirm')) { g.mods.audio?.sfx('bark'); g.mods.world.chooseExit(ex[Math.min(this.mapSel, ex.length - 1)].to); }
  }
  recoveryNav(g: Game) {
    const I = g.input;
    const o = g.mods.save.recoveryOptions?.();
    // nothing left to fetch: the card shows a single START FRESH row (row 0's load() then fails and starts fresh)
    if (!o?.doomed && (I.pressed('up') || I.pressed('down'))) { this.sel = 1 - this.sel; g.mods.audio?.sfx('blip'); }
    if (I.pressed('confirm')) {
      const fresh = o?.freshToast ?? 'STARTING FRESH. NO WORRIES!';
      if (this.sel === 0) { const r = g.mods.save.load(); if (r === 'corrupt' || r === 'none') { g.mods.save.wipe(); g.setScene('title'); this.toast(fresh); } }
      else { g.mods.save.wipe(); g.setScene('title'); this.toast(fresh); }
    }
  }

  // ---------------- drawing ----------------
  overlay(g: Game, ctx: CanvasRenderingContext2D) {
    const sc = g.state.scene; this.rows = []; this.bossBarOn = false;
    // the journal paints a full-bleed backdrop: skip the scene underneath (saves ~5 ms a frame)
    if (this.menuOpen === 'journal' && g.mods.journal?.draw) { g.mods.journal.draw(g, ctx); this.touch.draw(g, ctx, this.t); return; }
    if (sc === 'play' || sc === 'bonus' || sc === 'dialogue') { this.hud(g, ctx); if (sc === 'dialogue') this.dialogueBox(g, ctx); }
    else if (sc === 'title') this.title(g, ctx);
    else if (sc === 'map') this.map(g, ctx);
    else if (sc === 'ending') this.ending(g, ctx);
    else if (sc === 'recovery') this.recovery(ctx);
    else if (sc === 'boot') { rect(ctx, 0, 0, W, H, C.bg); text(ctx, 'LOADING...', W / 2, H / 2, C.line, { align: 'center' }); }
    if (sc !== 'boot') this.soundChip(g, ctx);
    // toasts first: an open menu dims them along with the playfield. While a memory card shows in play/bonus they
    // stay off screen (still held, not ageing) and come back in place when it leaves.
    if (!((sc === 'play' || sc === 'bonus') && g.mods.memories?.showing?.())) this.drawToasts(ctx);
    if (this.menuOpen === 'pause') this.pause(g, ctx);
    if (this.menuOpen === 'settings') this.settings(g, ctx);
    if (this.menuOpen === 'journal') g.mods.journal?.draw(g, ctx);
    this.touch.draw(g, ctx, this.t);
  }

  /**
   * Toasts: a pill that drops 4px into place and is always drawn whole, clamped to the playfield width (long news
   * wraps onto a second line). Two at most on screen. Anchors never cover a heading: top of the playfield in play
   * (under the boss bar when it is up), above the NEXT HOP panel on the sector map (stacking upward, centred on the
   * chart so the sector log stays clear, far below the map header), above the hint row on title / recovery.
   * Bad news (a route forfeits a quest, a quest expires) gets a peri frame and a pink cross instead of the gold star.
   */
  drawToasts(ctx: CanvasRenderingContext2D) {
    const sc = this.g?.state.scene;
    // play / bonus: the lane is the reserved strip under Pom's flight ceiling (she never flies below MIN..MAX_Y + her
    // sprite), stacking upward, so news never covers the Galaga formation, a diving cat or the boss up top. While a
    // conversation is up the pill takes the edge the dialogue box leaves free.
    const dlgTop = sc === 'dialogue' && (this.g?.mods.quest?.dock?.(DLG_H + 3) === 'top');
    const bottomLane = sc === 'play' || sc === 'bonus' || (sc === 'dialogue' && dlgTop);
    const up = sc === 'title' || sc === 'recovery' || bottomLane;
    // sector map: docked in the strip right under the header bar, never over the route grid or its nodes
    const cx = sc === 'map' ? W / 2 : PF_X + PF_W / 2;
    const base = sc === 'title' || sc === 'recovery' ? 336 : sc === 'map' ? 43 : bottomLane ? H - 3 : this.bossBarOn ? 24 : 8;
    const cap = this.toastCap();
    let acc = 0;
    this.toasts.forEach((x, i) => {
      if (i >= cap) return; // waiting its turn
      // clamp to the playfield: wrap onto as many lines as it takes (never wider than the playfield, never cut).
      // Wrapped at draw time: interaction bumps a pickup's counter by rewriting its text in place.
      const lines = wrap(x.text, TOAST_COLS); const bad = x.kind ? x.kind === 'warn' : BAD_NEWS.test(x.text); const good = x.kind === 'good';
      const h = 14 + (lines.length - 1) * 9;
      const target = up ? base - acc - h : base + acc; acc += h + 3;
      x.y = x.y < 0 ? target : x.y + Math.sign(target - x.y) * Math.min(2, Math.abs(target - x.y));
      if (x.t <= 2) return; // gone: the stack slides over
      const full = Math.min(PF_W - 8, Math.max(...lines.map(l => textWidth(l))) + 30); const bx = Math.round(cx - full / 2);
      const y = Math.round(x.y) - Math.max(0, 4 - x.age);
      const blink = (x.age >> 2) % 2 && x.age < 30;
      // bad news inverts the good pill: a bright pink frame with a peri inner trim on a plum fill (good news: hot frame,
      // night fill, gold text), so a warning reads at a glance in combat
      frame(ctx, bx, y, full, h, x.age < 3 ? C.text : bad ? C.pink : C.hot, bad ? C.plum : C.night, 4);
      if (bad) { if (x.age >= 3) chamferLine(ctx, bx, y, full, h, C.pink, 4); chamferLine(ctx, bx + 2, y + 2, full - 4, h - 4, C.peri, 3); }
      const ic = bad ? (/SEALED|LOCKED|BLOCKED/.test(x.text) ? 'lock' : 'cross') : x.text.startsWith('MEMORY') ? 'photo' : x.text.startsWith('PUPPY') ? 'paw' : x.text.includes('QUEST') ? 'flag' : x.text.includes('SOUND') ? 'speaker' : 'star';
      icon(ctx, ic, bx + 7, y + 4, bad ? C.pink : C.gold);
      lines.forEach((l, k) => text(ctx, l, bx + 18, y + 4 + k * 9, bad ? (blink ? C.text : C.pink) : blink ? C.text : good ? C.lime : C.gold));
    });
  }

  // ---------------- HUD ----------------
  panel(ctx: CanvasRenderingContext2D, x: number, accent: string) {
    rect(ctx, x, 0, PW, H, C.panel);
    // faint circuit grid, tinted by the time-of-day accent
    for (let yy = 24; yy < H; yy += 24) dither(ctx, x + 4, yy, PW - 8, 1, darkOf(accent), 'sparse');
    // ambient glow pooled at the panel foot in the accent's dark tone
    for (let k = 0; k < 4; k++) dither(ctx, x + 4, H - 8 - k * 2, PW - 8, 1, darkOf(accent), k < 2 ? 'check' : 'sparse');
    scanlines(ctx, x, 0, PW, H);
    frame(ctx, x + 2, 2, PW - 4, H - 4, accent, C.panel, 6);
    // animated detail lives on the frame itself (never across labels): a light pulse runs down the
    // left rail and up the right rail
    const span = H - 32; const p = (this.t >> 1) % span;
    rect(ctx, x + 2, 16 + p, 1, 8, lighter(accent)); rect(ctx, x + 2, 16 + p - 4, 1, 4, accent);
    rect(ctx, x + PW - 3, H - 24 - p, 1, 8, lighter(accent)); rect(ctx, x + PW - 3, H - 16 - p, 1, 4, accent);
    // rivets
    for (const yy of [12, H - 13]) { rect(ctx, x + 6, yy, 2, 2, C.indigo); rect(ctx, x + PW - 8, yy, 2, 2, C.indigo); }
  }
  hud(g: Game, ctx: CanvasRenderingContext2D) {
    const s = g.state; const P = g.mods.player; const A = g.mods.world?.area(); const t = this.t;
    const touch = this.touch.visible(g);
    const [accL, accR, accS] = todAccent(s.tod);
    // ===== left panel =====
    this.panel(ctx, 0, accL);
    const L1 = logoWord('POODLE', 1, PINK, 2, 1, 1), L2 = logoWord('PATROL', 1, CYAN, 2, 1, 1);
    const shine = (t % 240) * 0.6 - 20;
    drawLogo(ctx, L1, 64, 10, shine, 3); drawLogo(ctx, L2, 64, 27, shine - 20, 3);
    const x0 = 10, w0 = PW - 20;
    header(ctx, 'SCORE', x0, 50, w0, accL, t);
    num(ctx, String(Math.min(this.shownScore, 99999999)).padStart(8, '0'), x0 + 1, 61, C.text, { hi: C.ice, shadow: C.ink });
    icon(ctx, 'star', x0, 78, C.gold); text(ctx, 'HI', x0 + 10, 78, C.dim);
    text(ctx, String(s.hiScore).padStart(8, '0'), x0 + w0, 78, C.gold, { align: 'right' });
    header(ctx, 'HEARTS', x0, 92, w0, C.hot, t, s.hearts <= 1);
    const beat = s.hearts <= 1 && (t >> 4) % 2 === 0;
    for (let i = 0; i < s.maxHearts; i++) {
      const full = i < s.hearts; const hx = x0 + 8 + i * 13, hy = 107 + (full && beat && i === s.hearts - 1 ? -1 : 0);
      if (!full && this.heartFlash > 0 && i === s.hearts && (this.heartFlash >> 2) % 2) drawSprite(ctx, 'hud_heart', hx, hy, { flash: true });
      else drawSprite(ctx, full ? 'hud_heart' : 'hud_heart_empty', hx, hy);
    }
    // power-up bay: four fixed slots (lit when active, silhouettes when empty); labels stay readable
    header(ctx, 'POWER-UPS', x0, 120, w0, C.line, t);
    POWERS.forEach(([k, spr, nm, c], i) => {
      const left = P?.powers?.[k] ?? 0; const on = left > 0; const sx = x0 + i * 28, sy = 131;
      const low = on && left < 180 && (t >> 3) % 2;
      chamferFill(ctx, sx, sy, 24, 22, on ? C.night : C.ink, 3);
      chamferLine(ctx, sx, sy, 24, 22, on ? (low ? C.hot : c) : C.indigo, 3);
      if (on) { rect(ctx, sx + 3, sy + 1, 18, 1, darkOf(c)); drawSprite(ctx, spr, sx + 12, sy + 9); }
      else drawSprite(ctx, spr, sx + 12, sy + 9, { recolor: SILHOUETTE });
      // depleting 5-cell timer under the icon (never raw numbers)
      const p = on ? left / Math.max(1, this.powMax[k] ?? left) : 0; const lit = on ? Math.max(1, Math.ceil(p * 5)) : 0;
      for (let j = 0; j < 5; j++) rect(ctx, sx + 3 + j * 4, sy + 17, 3, 2, j < lit ? (low ? C.hot : c) : C.indigo);
      text(ctx, nm, sx + 12, sy + 25, on ? (low ? C.hot : c) : C.dim, { align: 'center' });
    });
    {
      // wingman pill: off = a plain instruction, on = status LED + ONLINE (matches the rescue toast)
      const on = !!P?.buddy; const by = 166, bh = 14;
      chamferFill(ctx, x0, by, w0, bh, on ? C.night : C.ink, 3); chamferLine(ctx, x0, by, w0, bh, on ? C.burnt : C.peri, 3);
      icon(ctx, 'pup', x0 + 6, by + 4, on ? C.gold : C.dim);
      if (on) {
        text(ctx, 'WINGMAN', x0 + 17, by + 4, C.gold);
        rect(ctx, x0 + w0 - 47, by + 6, 3, 3, (t >> 4) % 2 ? C.lime : C.deep);
        text(ctx, 'ONLINE', x0 + w0 - 6, by + 4, C.lime, { align: 'right' });
      } else text(ctx, 'RESCUE A PUP', x0 + 17, by + 4, C.dim);
    }
    // boop chain: consecutive boops within ~1.6s, with a decay bar
    header(ctx, 'BOOP CHAIN', x0, 186, w0, C.gold, t, this.chain > 1);
    {
      const by = 197, bh = 34; const live = this.chain > 0; const left = live ? Math.max(0, 100 - (g.tick - this.lastBoop)) / 100 : 0;
      chamferFill(ctx, x0, by, w0, bh, C.ink, 4); chamferLine(ctx, x0, by, w0, bh, live ? C.burnt : C.peri, 4);
      const pop = this.chainPop > 4 ? -1 : 0;
      num(ctx, 'X' + Math.min(999, this.chain), x0 + 7, by + 12 + pop, live ? C.gold : C.dim, { hi: live ? C.cream : C.pale, shadow: live ? C.burnt : C.night });
      const rx = x0 + 58;
      text(ctx, 'BEST', rx, by + 6, C.dim); text(ctx, String(this.bestChain), x0 + w0 - 6, by + 6, C.text, { align: 'right' });
      segBar(ctx, rx, by + 17, 8, 4, 3, left, left < 0.35 ? C.hot : C.gold);
      if (!live) text(ctx, 'BOOP!', rx, by + 23, C.dim);
    }
    if (!touch) {
      // flight stats
      header(ctx, 'STATS', x0, 240, w0, C.violet, t);
      const acc = s.stats.shots ? Math.round(100 * s.stats.hits / s.stats.shots) : 0;
      icon(ctx, 'cat', x0, 252, C.hot); text(ctx, 'BOOPS', x0 + 10, 252, C.dim); text(ctx, String(s.stats.catsBooped), x0 + w0, 252, C.text, { align: 'right' });
      icon(ctx, 'star', x0, 263, C.gold); text(ctx, 'AIM', x0 + 10, 263, C.dim); text(ctx, `${acc}%`, x0 + w0, 263, C.text, { align: 'right' });
      segBar(ctx, x0, 274, 18, 5, 2, acc / 100, C.violet);
      // controls block (device-aware); hidden while the touch deck occupies this space
      const k = keys(this.dev());
      header(ctx, 'CONTROLS', x0, 288, w0, C.line, t);
      const rows: [string, string][] = [[k.move, 'FLY'], [k.fire, 'TOOT'], [k.pause, 'PAUSE']];
      rows.forEach(([key, cap], i) => { const kw = keycap(ctx, key, x0, 302 + i * 14, C.line); text(ctx, cap, x0 + kw + 5, 302 + i * 14, C.pale); });
    }
    // ===== right panel: fixed slots (no reflow between areas or states) =====
    this.panel(ctx, RX, accR);
    const x1 = RX + 10;
    const B0 = g.mods.interaction?.boss;
    if (A) {
      const idx = g.content.areas.indexOf(A);
      // the header stops short of the sound chip that lives in the panel's top-right corner
      header(ctx, `SECTOR ${String(idx + 1).padStart(2, '0')}`, x1, 10, w0 - 26, accR, t, true);
      this.areaTitle(ctx, A, x1, 23, w0);
      // one source of truth with world's 'WAVE n / N' banner: N counts regular waves only; the Big Cat gets its own
      // strip cell (with a pip) and the BIG CAT WAVE plate, never a number
      const nw = A.waves.length; const tot = nw + (A.boss ? 1 : 0); const cur = Math.min(nw, s.waveIndex + 1);
      const MB = g.state.scene === 'bonus' && !B0 ? g.mods.minigames?.def : null;
      header(ctx, MB ? `BONUS STAGE ${String(g.content.bonus.indexOf(MB) + 1).padStart(2, '0')}` : 'WAVE', x1, 60, w0, MB ? C.gold : C.hot, t);
      const wy = 71;
      if (MB) this.fitText(ctx, String(MB.name), x1, wy + 2, w0, C.gold, C.ink);
      else if (B0) {
        chamferFill(ctx, x1, wy - 1, w0, 13, C.mag, 3); chamferFill(ctx, x1 + 1, wy - 1, w0 - 2, 12, (t >> 4) % 2 ? C.hot : C.mag, 3);
        icon(ctx, 'cat', x1 + 6, wy + 2, C.text); text(ctx, 'BIG CAT WAVE', x1 + 16, wy + 2, C.text);
        arrow(ctx, x1 + w0 - 8, wy + 5, 'l', 3, C.text);
      } else {
        const aw = num(ctx, String(cur), x1, wy, C.line, { hi: C.ice, shadow: C.ink });
        const bw = num(ctx, `/${nw}`, x1 + aw + 2, wy, C.dim, { hi: C.pale, shadow: C.ink });
        // wave strip on the same row: done cells cyan, the current one blinks, the boss cell carries a pip
        const sx0 = x1 + aw + bw + 8, avail = x1 + w0 - sx0;
        const cw = Math.max(3, Math.min(9, Math.floor((avail - (tot - 1)) / Math.max(1, tot))));
        const sx1 = x1 + w0 - (cw * tot + tot - 1);
        for (let i = 0; i < tot; i++) {
          const done = i < s.waveIndex, curw = i === s.waveIndex; const bossCell = A.boss && i === tot - 1;
          const c = done ? C.line : curw ? ((t >> 3) % 2 ? C.hot : C.pink) : C.indigo;
          chamferFill(ctx, sx1 + i * (cw + 1), wy + 2, cw, 7, c, 1);
          if (bossCell && !done) rect(ctx, sx1 + i * (cw + 1) + (cw >> 1) - 1, wy + 4, 2, 3, curw ? C.text : C.hot);
        }
      }
    }
    header(ctx, 'RESCUED', x1, 88, w0, C.gold, t);
    chamferFill(ctx, x1, 98, 52, 18, C.night, 2); drawSprite(ctx, 'pup', x1 + 9, 107);
    text(ctx, `X${s.inventory.pups ?? 0}`, x1 + 20, 103, C.gold);
    chamferFill(ctx, x1 + 56, 98, w0 - 56, 18, C.night, 2); drawSprite(ctx, 'pk_memory', x1 + 65, 107);
    text(ctx, `${g.mods.memories?.albumShown?.() ?? s.memories.length}/${g.content.memories.length}`, x1 + 76, 103, C.text);
    header(ctx, 'QUEST', x1, 122, w0, C.violet, t);
    // quest.tracked() returns null while a NEW QUEST toast is still held: no find() fallback then
    const Q = g.mods.quest;
    const q = Q?.tracked ? Q.tracked() : g.content.quests.find(q => s.quests[q.id] === 'active');
    if (q) {
      this.fitText(ctx, q.name, x1, 133, w0, C.violet, C.ink);
      icon(ctx, 'flag', x1, 144, C.violet);
      const pr = g.mods.quest?.progress?.(q);
      if (pr && pr.need > 1) {
        // the counter keeps its width; the bar takes what is left with a 4px gap (never runs into the numbers)
        const lbl = `${Math.min(pr.have, pr.need)}/${pr.need}`; const cells = Math.max(3, Math.min(10, Math.floor((w0 - 10 - textWidth(lbl) - 5) / 6)));
        segBar(ctx, x1 + 10, 145, cells, 5, 4, pr.have / pr.need, C.violet); text(ctx, lbl, x1 + w0, 144, C.text, { align: 'right' });
      }
      else { text(ctx, Q?.goal?.(q) || 'IN PROGRESS', x1 + 10, 144, C.dim); if (!Q?.goal) for (let i = 0; i < 3; i++) rect(ctx, x1 + 78 + i * 4, 149, 2, 2, ((t >> 4) % 4) > i ? C.violet : C.peri); }
    } else { text(ctx, 'NO ACTIVE QUEST', x1, 133, C.dim); icon(ctx, 'flag', x1, 144, C.peri); text(ctx, 'FLY ON, CAPTAIN', x1 + 10, 144, C.peri); }
    // threat slot: fixed 64px (boss armor, bonus tally, live breed roster, or the next formation preview)
    const TY = 158;
    if (B0) this.bossBlock(g, ctx, B0, x1, TY, w0);
    else if (g.state.scene === 'bonus') {
      // static stage info: the live HITS counter lives in the playfield (minigames), never a second tally here
      header(ctx, 'BONUS STAGE', x1, TY, w0, C.gold, t, true);
      const MD = g.mods.minigames?.def; const en = MD ? g.content.enemies.find(e => e.id === MD.breed) : null;
      if (en) {
        chamferFill(ctx, x1, TY + 12, 36, 36, C.night, 3); drawSprite(ctx, en.sprite, x1 + 18, TY + 30);
        text(ctx, 'NO RETURN', x1 + 42, TY + 16, C.text); text(ctx, 'FIRE', x1 + 42, TY + 25, C.text);
        text(ctx, 'BOOP THEM', x1 + 42, TY + 36, C.gold); text(ctx, 'ALL!', x1 + 42, TY + 45, C.gold);
      }
    } else this.roster(g, ctx, x1, TY, w0);
    if (!touch) {
      // sector checklist (what is still out there in this sector), then the clock blocks
      if (A) this.sectorGoals(g, ctx, A, x1, 230, w0, accS);
      const tod = s.tod; const tc = tod === 'night' ? C.violet : tod === 'dusk' ? C.pink : tod === 'dawn' ? C.orange : C.gold;
      header(ctx, 'LOCAL TIME', x1, 296, w0, tc, t);
      icon(ctx, tod === 'night' ? 'moon' : tod === 'dusk' ? 'dusk' : tod === 'dawn' ? 'dawn' : 'sun', x1, 307, tc); text(ctx, tod.toUpperCase(), x1 + 10, 307, tc);
      // day-cycle strip: four phases, current one lit
      (['dawn', 'day', 'dusk', 'night'] as const).forEach((p, i) => rect(ctx, x1 + 60 + i * 12, 309, 10, 3, p === tod ? tc : C.indigo));
      const mm = Math.floor(s.stats.playTicks / 3600), ss = Math.floor(s.stats.playTicks / 60) % 60;
      header(ctx, 'FLIGHT TIME', x1, 321, w0, C.line, t);
      this.clock(ctx, x1, 332, C.line, g.paused ? 0 : (s.stats.playTicks >> 4) % 8);
      text(ctx, `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`, x1 + 10, 332, C.text);
    }
    // boss armor bar docked along the top edge of the playfield, where the player's eyes are
    this.bossBarOn = !!B0 && typeof B0.hp === 'number';
    if (this.bossBarOn) this.bossTopBar(ctx, B0);
    // playfield frame edges: bright inner line, dark outer glow, tick marks
    rect(ctx, PF_X - 1, 0, 1, H, C.deep); rect(ctx, PF_X, 0, 1, H, C.line);
    rect(ctx, RX - 1, 0, 1, H, C.line); rect(ctx, RX, 0, 1, H, C.deep);
    const off = (t >> 2) % 16;
    for (let yy = -16 + off; yy < H; yy += 16) { rect(ctx, PF_X + 1, yy, 2, 1, C.deep); rect(ctx, RX - 3, yy, 2, 1, C.deep); }
  }
  /** Boss block in the right panel threat slot: name, armor bar, armor %, and a mood row. */
  bossBlock(g: Game, ctx: CanvasRenderingContext2D, B0: any, x1: number, y: number, w0: number) {
    const t = this.t;
    header(ctx, 'BIG CAT', x1, y, w0, C.hot, t, true);
    this.fitText(ctx, B0.def.name, x1, y + 11, w0, C.text, C.ink);
    const p = Math.max(0, B0.hp / Math.max(1, B0.maxHp));
    chamferFill(ctx, x1 - 1, y + 22, w0 + 2, 9, C.ink, 2);
    bar(ctx, x1 + 1, y + 24, w0 - 2, 5, p, p < 0.3 && (t >> 3) % 2 ? C.pink : C.hot);
    for (let i = 1; i < 10; i++) rect(ctx, x1 + 1 + Math.round(i * (w0 - 2) / 10), y + 24, 1, 5, C.ink);
    text(ctx, 'ARMOR', x1, y + 35, C.dim); text(ctx, `${Math.ceil(p * 100)}%`, x1 + w0, y + 35, C.hot, { align: 'right' });
    const mood = p > 0.6 ? 'CALM' : p > 0.3 ? 'GRUMPY' : 'FURIOUS'; const mc = p > 0.6 ? C.gold : p > 0.3 ? C.orange : C.hot;
    text(ctx, 'MOOD', x1, y + 46, C.dim);
    for (let i = 0; i < 3; i++) chamferFill(ctx, x1 + 30 + i * 9, y + 47, 7, 5, i < (p > 0.6 ? 1 : p > 0.3 ? 2 : 3) ? mc : C.indigo, 1);
    text(ctx, mood, x1 + w0, y + 46, mc, { align: 'right' });
  }
  /** Thin chamfered boss bar along the top edge of the playfield (Galaga-style readability). */
  bossTopBar(ctx: CanvasRenderingContext2D, B0: any) {
    const t = this.t; const x = PF_X + 40, w = PF_W - 80, y = 3, h = 15;
    const p = Math.max(0, B0.hp / Math.max(1, B0.maxHp));
    chamferFill(ctx, x - 1, y - 1, w + 2, h + 2, C.ink, 5);
    chamferFill(ctx, x, y, w, h, C.night, 4); chamferLine(ctx, x, y, w, h, C.mag, 4);
    rect(ctx, x + 5, y, 10, 1, C.hot); rect(ctx, x + w - 15, y, 10, 1, C.hot);
    icon(ctx, 'cat', x + 7, y + 4, C.hot);
    const nm = (B0.def?.name ?? 'BIG CAT').toUpperCase(); text(ctx, nm, x + 17, y + 4, C.text, { shadow: C.ink });
    const bx = x + 17 + textWidth(nm) + 8, bw = x + w - 8 - bx;
    rect(ctx, bx - 1, y + 4, bw + 2, 7, C.ink);
    bar(ctx, bx, y + 5, bw, 5, p, p < 0.3 && (t >> 3) % 2 ? C.pink : C.hot, C.plum);
    for (let i = 1; i < 10; i++) rect(ctx, bx + Math.round(i * bw / 10), y + 5, 1, 5, C.ink);
  }
  /** Clock icon with a sweeping hand (8 positions); the digits next to it stay static. */
  clock(ctx: CanvasRenderingContext2D, x: number, y: number, c: string, step: number) {
    icon(ctx, 'clockface', x, y, c);
    const H8: [number, number][][] = [[[3, 1], [3, 2]], [[5, 1], [4, 2]], [[5, 3], [4, 3]], [[5, 5], [4, 4]], [[3, 5], [3, 4]], [[1, 5], [2, 4]], [[1, 3], [2, 3]], [[1, 1], [2, 2]]];
    rect(ctx, x + 3, y + 3, 1, 1, c); for (const [dx, dy] of H8[step & 7]) rect(ctx, x + dx, y + dy, 1, 1, c === C.line ? C.ice : C.text);
  }
  /** Threat slot (64px): live breed roster with a cats-left bar, or the next formation preview when the sky is empty. */
  roster(g: Game, ctx: CanvasRenderingContext2D, x: number, y: number, w: number) {
    const cats = (g.mods.interaction?.cats ?? []) as { def?: { id: string; name: string; sprite: string } }[];
    header(ctx, 'HOSTILES', x, y, w, C.hot, this.t, cats.length > 0);
    const by: Record<string, { id: string; n: number; name: string; sprite: string }> = {};
    for (const c of cats) { const d = c.def; if (!d) continue; (by[d.id] ??= { id: d.id, n: 0, name: d.name, sprite: d.sprite }).n++; }
    const list = Object.values(by).sort((a, b) => b.n - a.n);
    y += 11;
    if (!list.length) {
      // before the first cats arrive the wave is INCOMING; once a wave is wiped out the skies are clear
      const incoming = this.waveCats === 0;
      chamferFill(ctx, x, y, w, 14, C.ink, 3); chamferLine(ctx, x, y, w, 14, incoming ? C.mag : C.peri, 3);
      const lbl = incoming ? 'INCOMING' : 'SKIES CLEAR';
      if (incoming) { const o = (this.t >> 3) % 2; arrow(ctx, x + 10, y + 6 + o, 'd', 3, C.hot); arrow(ctx, x + w - 11, y + 6 + o, 'd', 3, C.hot); }
      text(ctx, lbl, x + w / 2, y + 4, incoming ? ((this.t >> 4) % 2 ? C.hot : C.pink) : C.dim, { align: 'center' });
      this.formationPreview(g, ctx, x, y + 17, w, 35, incoming);
      return;
    }
    const rows = list.length > 3 ? 2 : list.length;
    // one line per breed, always: the full name when it fits the regular face, else the HUD short name
    // (YARNWITCH, BENGAL BOLT...), else the small tier on the same baseline. Never wrapped (rows are 9px).
    const room = (n: number) => w - 10 - textWidth(String(n)) - 6;
    const label = (e: { id: string; name: string; n: number }) => {
      const full = e.name.toUpperCase(); if (textWidth(full) <= room(e.n)) return full;
      return HUD_BREED[e.id] ?? full;
    };
    const names = list.slice(0, rows).map(label);
    const narrow = names.some((nm, i) => textWidth(nm) > room(list[i].n));
    list.slice(0, rows).forEach((e, i) => {
      const cy = y + i * 9; const nm = names[i];
      icon(ctx, 'cat', x, cy, breedColor(e.sprite), C.ink);
      if (narrow) { let s2 = nm; while (s2.length > 1 && tinyWidth(s2) > room(e.n)) s2 = s2.slice(0, -1); tiny(ctx, s2, x + 10, cy + 1, C.pale); }
      else text(ctx, nm, x + 10, cy, C.pale);
      text(ctx, String(e.n), x + w, cy, C.text, { align: 'right' });
    });
    if (list.length > 3) { const rest = list.slice(2).reduce((a, e) => a + e.n, 0); text(ctx, `+${list.length - 2} MORE BREEDS`, x + 10, y + 18, C.dim); text(ctx, String(rest), x + w, y + 18, C.text, { align: 'right' }); }
    // the section collapses to its rows: CATS LEFT follows the last breed row with a fixed 4px gap (no empty band
    // when the wave has one or two breeds); the slot's spare height falls below, before SECTOR GOALS
    const ly = y + Math.min(3, list.length) * 9 + 4;
    const tot = Math.max(1, this.waveCats, cats.length);
    text(ctx, 'CATS LEFT', x, ly, C.dim); text(ctx, `${cats.length}/${tot}`, x + w, ly, C.hot, { align: 'right' });
    segBar(ctx, x, ly + 10, 18, 5, 4, cats.length / tot, C.hot);
  }
  /**
   * Next-wave preview: up to three breed portraits (most numerous first) in a holo box. Head counts come only from
   * interaction.wavePreview (the formation it will really spawn); without that API the portraits show no numbers,
   * because the content roster is not what spawns (the sector's formation shape and difficulty cap trim it).
   */
  formationPreview(g: Game, ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, live: boolean) {
    const A = g.mods.world?.area();
    chamferFill(ctx, x, y, w, h, C.ink, 3); chamferLine(ctx, x, y, w, h, live ? C.plum : C.indigo, 3);
    const wid = A?.waves?.[g.state.waveIndex]; const wave = g.content.waves.find(v => v.id === wid);
    if (!wave) { text(ctx, 'ALL CLEAR', x + w / 2, y + h / 2 - 3, C.peri, { align: 'center' }); return; }
    let real: { breed: string; n: number }[] | null = null;
    try { real = g.mods.interaction?.wavePreview?.(A!.id, g.state.waveIndex) ?? null; } catch { real = null; }
    const by: Record<string, number> = {};
    if (real) for (const r of real) by[r.breed] = (by[r.breed] ?? 0) + r.n;
    else for (const c of wave.cats) by[c.breed] = (by[c.breed] ?? 0) + (c.cols ? c.cols.length : wave.formation.cols);
    const list = Object.entries(by).filter(e => e[1] > 0).sort((p, q) => q[1] - p[1]);
    const shown = list.slice(0, 3); const cw = Math.floor(w / 3); const ox = Math.round(x + (w - cw * shown.length) / 2);
    shown.forEach(([breed, n], i) => {
      const e = g.content.enemies.find(en => en.id === breed); const cx = ox + i * cw + (cw >> 1);
      // portrait well, then the breed's own sprite cropped to its face (a hop on the live INCOMING beat)
      // without real counts the portrait well grows to fill the box (no number row)
      const wy = real ? y + 3 : y + 4, wh = real ? 21 : h - 8;
      chamferFill(ctx, cx - 13, wy, 26, wh, C.night, 2);
      if (e && SHEETS[e.sprite]) {
        const hop = live && ((this.t >> 3) + i) % 6 === 0 ? -1 : 0;
        ctx.save(); ctx.beginPath(); ctx.rect(cx - 13, wy, 26, wh); ctx.clip();
        drawSprite(ctx, e.sprite, cx, wy + Math.round(wh / 2) + 1 + hop, { frame: frameCount(e.sprite) > 1 ? ((this.t >> 4) + i) % 2 : 0 });
        ctx.restore();
      } else icon(ctx, 'cat', cx - 3, wy + 7, C.hot);
      if (real) {
        const more = i === 2 && list.length > 3 ? list.slice(2).reduce((a, q) => a + q[1], 0) : n;
        text(ctx, `X${more}${i === 2 && list.length > 3 ? '+' : ''}`, cx, y + h - 9, live ? C.pink : C.pale, { align: 'center' });
      }
    });
  }

  /**
   * One line of text in a fixed slot that always fits whole: the regular 5x7 font when it fits `w`, else the narrow
   * 3x5 tier (vertically centred on the same row), else the narrow tier on two balanced lines. Never truncated.
   */
  fitText(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, w: number, c: string, shadow?: string) {
    const u = s.toUpperCase(); const o = shadow ? { shadow } : {};
    if (textWidth(u) <= w) { text(ctx, u, x, y, c, o); return; }
    if (tinyWidth(u) <= w) { tiny(ctx, u, x, y + 1, c, o); return; }
    const two = balancePx(u, w, tinyWidth) ?? wrapPx(u, w, tinyWidth).slice(0, 2);
    two.forEach((l, i) => tiny(ctx, l, x, y - 2 + i * 6, c, o));
  }
  /** Split a phrase at the word boundary that gives the most even two lines, each at most `cols` glyphs (or null). */
  balance(s: string, cols: number): string[] | null {
    if (s.length <= cols) return [s];
    const ws = s.split(' '); let best: string[] | null = null, bestW = 1e9;
    for (let i = 1; i < ws.length; i++) {
      const a = ws.slice(0, i).join(' '), b = ws.slice(i).join(' '); const m = Math.max(a.length, b.length);
      if (a.length <= cols && b.length <= cols && m < bestW) { best = [a, b]; bestW = m; }
    }
    return best;
  }
  /**
   * Sector name + subtitle in a fixed slot (y .. y+31), static and always whole. The name sits on one line or two
   * balanced lines of the main face (9px pitch: 7px glyphs, the 1px drop shadow, then 2px clear to the next row);
   * the subtitle takes one main-face line when it fits, else the small-caps tier on one line (or two balanced lines,
   * 7px pitch) so the block ends at least 6px above the WAVE header. Never a marquee, never truncated.
   */
  areaTitle(ctx: CanvasRenderingContext2D, A: { id?: string; name: string; subtitle?: string }, x: number, y: number, w: number) {
    // the same short display name the sector log uses (SCRATCH STATION), so the header stays one line
    const full = A.name.toUpperCase(); const sh = A.id ? LOG_SHORT[A.id] : undefined;
    const name = textWidth(full) > w && sh && textWidth(sh) <= w ? sh : full; const sub = (A.subtitle ?? '').toUpperCase();
    let yy = y;
    const nl = balancePx(name, w, textWidth);
    if (nl) for (const l of nl) { text(ctx, l, x, yy, C.text, { shadow: C.ink }); yy += 9; }
    else for (const l of balancePx(name, w, tinyWidth) ?? wrapPx(name, w, tinyWidth)) { tiny(ctx, l, x, yy + 1, C.text, { shadow: C.ink }); yy += 7; }
    if (!sub) return;
    yy += 1;
    if (textWidth(sub) <= w) { text(ctx, sub, x, yy, C.dim); return; }
    (balancePx(sub, w, tinyWidth) ?? wrapPx(sub, w, tinyWidth)).forEach((l, i) => tiny(ctx, l, x, yy + i * 7, C.dim));
  }
  /** Sectors whose waves carry a capturer hold one lost pup (flag pup_<area> once rescued); cached per area. */
  private pupHere = new Map<string, boolean>();
  hasPup(g: Game, areaId: string) {
    let v = this.pupHere.get(areaId); if (v !== undefined) return v;
    const ct = g.content; const a = ct.areas.find(x => x.id === areaId);
    v = !!a?.waves.some(w => ct.waves.find(x => x.id === w)?.cats.some(c => ct.enemies.find(e => e.id === c.breed)?.behavior === 'capturer'));
    this.pupHere.set(areaId, v); return v;
  }
  /** Sector checklist: this sector's memories (one polaroid per photo), its lost pup and its Big Cat. */
  sectorGoals(g: Game, ctx: CanvasRenderingContext2D, A: { id: string; boss?: string }, x: number, y: number, w: number, glow: string) {
    const t = this.t; const s = g.state;
    header(ctx, 'SECTOR GOALS', x, y, w, glow, t);
    const by = y + 11, bh = 45;
    chamferFill(ctx, x, by, w, bh, C.ink, 3); chamferLine(ctx, x, by, w, bh, darkOf(glow), 3);
    // memories placed here: lit polaroids for the ones in the album
    const mems = (g.mods.memories?.placed?.(A.id) ?? g.content.memories.filter(m => m.area === A.id)) as { id: string }[];
    const got = mems.filter(m => s.memories.includes(m.id)).length;
    const cleared = s.areasCleared.includes(A.id);
    const pup = this.hasPup(g, A.id), safe = !!s.flags['pup_' + A.id];
    const B0 = g.mods.interaction?.boss;
    const yy = (i: number) => by + 5 + i * 13;
    // row 0: memories
    icon(ctx, 'photo', x + 5, yy(0), got && got === mems.length ? C.gold : C.violet);
    text(ctx, 'MEMORIES', x + 15, yy(0), C.pale);
    if (!mems.length) text(ctx, '--', x + w - 5, yy(0), C.peri, { align: 'right' });
    mems.forEach((m, i) => {
      const on = s.memories.includes(m.id); const px = x + w - 5 - (mems.length - i) * 9 + 1;
      chamferFill(ctx, px, yy(0) - 1, 8, 9, on ? C.gold : C.night, 1); chamferLine(ctx, px, yy(0) - 1, 8, 9, on ? C.cream : C.peri, 1);
      if (on) rect(ctx, px + 2, yy(0) + 1, 4, 3, C.burnt);
    });
    // row 1: the sector's lost pup
    icon(ctx, 'paw', x + 5, yy(1), pup ? (safe ? C.lime : C.pink) : C.peri);
    text(ctx, 'LOST PUP', x + 15, yy(1), C.pale);
    text(ctx, !pup ? 'NONE' : safe ? 'SAVED' : 'CAGED', x + w - 5, yy(1), !pup ? C.peri : safe ? C.lime : (t >> 4) % 2 ? C.hot : C.pink, { align: 'right' });
    // row 2: the Big Cat
    icon(ctx, 'cat', x + 5, yy(2), A.boss ? (cleared ? C.line : C.hot) : C.peri);
    text(ctx, 'BIG CAT', x + 15, yy(2), C.pale);
    text(ctx, !A.boss ? 'NONE' : cleared ? 'NAPPING' : B0 ? 'AWAKE' : 'AHEAD', x + w - 5, yy(2), !A.boss ? C.peri : cleared ? C.line : B0 ? C.hot : C.orange, { align: 'right' });
  }
  /**
   * Sound status chip, always in the same top-right corner (inside the right HUD panel in play): a speaker with
   * waves while sound is actually playing, a crossed speaker when the audio context is locked, failed or muted.
   * Static (no blinking), so screenshots always show the real state.
   */
  soundChip(g: Game, ctx: CanvasRenderingContext2D) {
    if (g.headless) return;
    const A = g.mods.audio as any; const st = g.state.settings;
    let running = false; try { running = !!A?.running?.(); } catch { running = false; }
    const on = running && (st.music > 0 || st.sfx > 0);
    // sits on the SECTOR header row, inside the panel frame (clear of its chamfered corner and the title below)
    const x = SND_X, y = SND_Y, w = 17, h = 11;
    chamferFill(ctx, x - 1, y - 1, w + 2, h + 2, C.ink, 3);
    chamferFill(ctx, x, y, w, h, C.night, 2); chamferLine(ctx, x, y, w, h, on ? C.deep : C.mag, 2);
    const art = on ? SND_ON : SND_OFF; const ox = x + 4, oy = y + 2;
    art.forEach((r, yy) => { for (let xx = 0; xx < r.length; xx++) { const ch = r[xx]; if (ch === '.') continue; rect(ctx, ox + xx, oy + yy, 1, 1, ch === '#' ? (on ? C.line : C.dim) : ch === 'w' ? C.ice : C.red); } });
  }
  /** Portrait sprite: prefer portrait_<name>, then the named sheet, then poodle for Pom or pup. */
  portraitFor(node: { portrait?: string; speaker?: string }) {
    const p = node.portrait ?? '';
    if (SHEETS['portrait_' + p]) return 'portrait_' + p;
    if (p && SHEETS[p]) return p;
    return /pom|poodle/i.test(p + ' ' + (node.speaker ?? '')) ? (SHEETS.pom ? 'pom' : 'poodle') : 'pup';
  }
  /** Dialogue: a compact comm panel docked flush to the bottom of the playfield, leaving the cat formation up top in view. */
  dialogueBox(g: Game, ctx: CanvasRenderingContext2D, dock?: 'top' | 'bottom') {
    const d = g.mods.quest?.dlg ?? this.heldDlg; if (!d) return;
    const t = this.t;
    const isPom = /pom/i.test(d.node.speaker); const isBoss = /empress|boss|sergeant|madame|duchess/i.test(d.node.speaker + (d.node.portrait ?? ''));
    const accent = isPom ? C.pink : isBoss ? C.hot : C.line;
    // docks to the top while Pom sits in the bottom band the box would cover (quest.dock)
    const x = PF_X + 1, w = PF_W - 2, h = DLG_H, y = (dock ?? g.mods.quest?.dock?.(h + 3)) === 'top' ? 4 : H - h - 1;
    // solid backing flush with the playfield edges (no world pixels peek through the chamfers)
    rect(ctx, x, y - 2, w, h + 3, C.ink);
    rect(ctx, x, y - 2, w, 1, darkOf(accent));
    frame(ctx, x + 1, y, w - 2, h, accent, C.night, 5);
    scanlines(ctx, x + 3, y + 2, w - 6, h - 4);
    // portrait bay: name-colored backlight, a slow fading scan behind the sprite, then the sprite
    const pxx = x + 6, pyy = y + 6, ps = 50;
    chamferFill(ctx, pxx, pyy, ps, ps, C.ink, 4);
    dither(ctx, pxx + 3, pyy + 14, ps - 6, ps - 17, darkOf(accent), 'sparse');
    dither(ctx, pxx + 8, pyy + 24, ps - 16, ps - 27, darkOf(accent), 'check');
    const scan = (t >> 2) % (ps - 6);
    for (let k = 0; k < 4 && scan - k >= 0; k++) dither(ctx, pxx + 3, pyy + 3 + scan - k, ps - 6, 1, darkOf(accent), k === 0 ? 'check' : 'sparse');
    ctx.save(); ctx.beginPath(); ctx.rect(pxx + 2, pyy + 2, ps - 4, ps - 4); ctx.clip();
    const spr = this.portraitFor(d.node); const sc = spriteCanvas(spr, (t >> 5) % 2 && frameCount(spr) > 1 ? 1 : 0);
    if (sc) { // integer zoom so small fallback sprites fill the bay; large ones are cropped to the face
      const z = sc.height <= 24 ? 2 : 1; const dw = sc.width * z, dh = sc.height * z;
      ctx.drawImage(sc, Math.round(pxx + ps / 2 - dw / 2), Math.round(pyy + ps - dh - (z === 2 ? 1 : 2) + (sc.height > 44 ? 6 : 0)), dw, dh);
    }
    ctx.restore();
    chamferLine(ctx, pxx, pyy, ps, ps, accent, 4);
    rect(ctx, pxx + 4, pyy + ps - 1, ps - 8, 1, darkOf(accent));
    // name row with rule, then hints on the right
    const tx = pxx + ps + 8; const nm = d.node.speaker.toUpperCase();
    rect(ctx, tx, y + 7, 3, 5, accent);
    text(ctx, nm, tx + 6, y + 6, accent, { shadow: C.ink });
    const k = keys(this.dev());
    const done = d.chars >= d.node.text.length;
    const hx = x + w - 10;
    const skipLbl = this.dev() === 'touch' ? 'MENU' : 'SKIP';
    const sw = keycap(ctx, k.skip, hx - textWidth(skipLbl) - 4, y + 7, C.dim, 'right'); text(ctx, skipLbl, hx, y + 7, C.dim, { align: 'right' });
    const nx = hx - textWidth(skipLbl) - 4 - sw - 10;
    const nextLbl = done ? 'NEXT' : 'FAST';
    const bob = done && (t >> 3) % 2 ? 1 : 0;
    const nw = keycap(ctx, k.next, nx - textWidth(nextLbl) - 4, y + 7 + bob, done ? C.gold : C.line, 'right'); text(ctx, nextLbl, nx, y + 7, done ? C.gold : C.dim, { align: 'right' });
    const ruleL = tx + 6 + textWidth(nm) + 5, ruleR = nx - textWidth(nextLbl) - 4 - nw - 6;
    if (ruleR > ruleL) dither(ctx, ruleL, y + 10, ruleR - ruleL, 1, darkOf(accent));
    // body: max three lines
    // the engine wraps the full page first, so a half-typed word never jumps lines when it completes
    const lines: string[] = g.mods.quest?.visibleLines ? g.mods.quest.visibleLines() : wrap(d.node.text.slice(0, Math.floor(d.chars)), 51).slice(0, 3);
    lines.forEach((l, i) => text(ctx, l, tx, y + 20 + i * 11, C.text, { shadow: C.ink }));
    if (!done && (t >> 2) % 2) rect(ctx, tx + (lines.length ? textWidth(lines[lines.length - 1]) + 2 : 0), y + 20 + Math.max(0, lines.length - 1) * 11, 4, 7, accent);
    if (done) arrow(ctx, x + w - 12, y + h - 7 + bob, 'd', 3, C.gold);
  }

  // ---------------- title ----------------
  /** Shared synthwave set piece (title, ending, recovery): starfield, banded sun on a horizon, scrolling perspective grid. */
  synthSet(ctx: CanvasRenderingContext2D, t: number, HZ: number, sr: number, sx = W / 2, bands = [C.cream, C.gold, C.orange, C.hot, C.mag], stars = 110) {
    rect(ctx, 0, 0, W, H, C.bg);
    for (let i = 0; i < stars; i++) {
      const x = (i * 97 + (i >> 3) * 13) % W, y = Math.floor((i * 53 + t * (0.15 + (i % 3) * 0.2)) % HZ);
      const tw = (i * 7 + (t >> 3)) % 23 === 0;
      rect(ctx, x, y, 1, 1, tw ? C.text : i % 5 ? C.indigo : C.peri);
    }
    // faint halo ring of dither around the sun
    for (let dy = -sr - 6; dy <= 0; dy++) {
      const yy = HZ + dy; const ro = sr + 6, dxo = Math.floor(Math.sqrt(Math.max(0, ro * ro - dy * dy)));
      dither(ctx, sx - dxo, yy, dxo * 2 + 1, 1, C.plum, 'sparse');
    }
    for (let dy = -sr; dy <= 0; dy++) {
      const yy = HZ + dy; const f = (dy + sr) / sr;
      const slat = f > 0.5 && ((yy - (t >> 2)) % Math.max(3, Math.round(10 - f * 7))) === 0;
      const dx = Math.floor(Math.sqrt(sr * sr - dy * dy));
      if (slat) { rect(ctx, sx - dx, yy, dx * 2 + 1, 1, C.bg); continue; }
      const bf = f * (bands.length - 1); const bi = Math.floor(bf); const frac = bf - bi;
      rect(ctx, sx - dx, yy, dx * 2 + 1, 1, bands[Math.min(bands.length - 1, bi)]);
      if (frac > 0.6 && bi + 1 < bands.length) dither(ctx, sx - dx, yy, dx * 2 + 1, 1, bands[bi + 1], frac > 0.8 ? 'check' : 'sparse');
    }
    // ground: perspective grid scrolling toward the viewer
    rect(ctx, 0, HZ, W, H - HZ, C.ink);
    rect(ctx, 0, HZ, W, 1, C.hot);
    const ph = (t % 40) / 40; const depth = H - HZ;
    for (let k = 0; k < 14; k++) {
      const z = k + ph; const y = Math.round(HZ + 2 + z * z * 0.85 * depth / 146);
      if (y >= H) break;
      rect(ctx, 0, y, W, 1, z < 3 ? C.plum : C.purple);
      if (z < 3) dither(ctx, 0, y, W, 1, C.indigo);
    }
    for (let i = -16; i <= 16; i++) line(ctx, W / 2 + i * 10, HZ + 1, W / 2 + i * 64 * depth / 146, H, Math.abs(i) < 6 ? C.purple : C.plum);
  }
  /** Captain Pom as the hero shot: her in-game sprite plus its jet flames (player's own flame()), composed at 1x
   *  in an offscreen and blitted at an exact 2x, so the flames scale with her pixels. */
  private heroCv: HTMLCanvasElement | null = null;
  heroPom(ctx: CanvasRenderingContext2D, cx: number, cy: number, t: number) {
    const spr = SHEETS.pom ? 'pom' : 'poodle';
    if (!this.heroCv) { if (typeof document === 'undefined') return; this.heroCv = document.createElement('canvas'); this.heroCv.width = 40; this.heroCv.height = 44; }
    const c = this.heroCv.getContext('2d'); if (!c) return;
    c.imageSmoothingEnabled = false; c.clearRect(0, 0, 40, 44);
    drawSprite(c, spr, 20, 18, { frame: (t >> 3) % Math.max(1, frameCount(spr)) });
    const flen = 6 + ((t >> 2) % 2);
    for (const [ox, oy, w] of POM_NOZZLES.pom ?? []) flame(c, 20 + ox - w / 2, 18 + oy + 1, w, w <= 2 ? flen - 2 : flen, t);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.heroCv, Math.round(cx - 40), Math.round(cy - 36), 80, 88);
  }
  title(g: Game, ctx: CanvasRenderingContext2D) {
    const t = this.t; const HZ = 214;
    this.synthSet(ctx, t, HZ, 62);
    // logo
    const L1 = logoWord('POODLE', 3, PINK, 4, 3, 4), L2 = logoWord('PATROL', 2, CYAN, 3, 3, 4);
    const bob = Math.round(Math.sin(t / 30) * 2);
    const shine = (t % 360) * 4 - 120;
    drawLogo(ctx, L1, W / 2, 18 + bob, shine, 6);
    // speed streaks either side of PATROL
    const ly = 66 + bob;
    for (let i = 0; i < 4; i++) {
      const len = 40 - i * 8, yy = ly + 5 + i * 5;
      const sweep = (t + i * 9) % 60 < 30 ? 0 : 1;
      rect(ctx, W / 2 - L2.w / 2 - len - 2 - sweep, yy, len, 1, i % 2 ? C.deep : C.line2);
      rect(ctx, W / 2 + L2.w / 2 + 2 + sweep, yy, len, 1, i % 2 ? C.deep : C.line2);
    }
    drawLogo(ctx, L2, W / 2, ly, shine - 40, 5);
    // tagline in a chamfered ribbon
    const tag = 'OPERATION: GOOD GIRL'; const tw = textWidth(tag) + 20;
    chamferFill(ctx, W / 2 - tw / 2, 101 + bob, tw, 13, C.mag, 4); chamferFill(ctx, W / 2 - tw / 2 + 1, 101 + bob, tw - 2, 12, C.hot, 4);
    text(ctx, tag, W / 2, 104 + bob, C.text, { align: 'center', shadow: C.mag });
    // Galaga marquee: a breathing chevron of cats flying above the sun (never across it); every few
    // seconds one peels off on a looping dive and slots back in
    const N = 7; const breathe = Math.round(Math.sin(t / 24) * 2);
    const cyc = 200, active = Math.floor(t / cyc) % N, u = (t % cyc) / 130; const diving = u < 1;
    // the centre slot stays open: that is Pom's lane, so no cat ever sits on the hero's topknot
    const order = [1, 5, 2, 0, 6, 4, 1]; const diver = order[active];
    for (let i = 0; i < N; i++) {
      if (i === 3) continue;
      const sx0 = W / 2 + (i - 3) * (46 + breathe), sy0 = 130 + Math.abs(i - 3) * 7 + ((t >> 4) + i) % 2;
      let x = sx0, y = sy0;
      if (i === diver && diving) {
        const side = i < 3 ? -1 : i > 3 ? 1 : ((active & 1) ? 1 : -1);
        // outward loop that stays clear of the sun disc
        const path = (v: number): [number, number] => [sx0 + side * 54 * Math.sin(v * Math.PI), sy0 - 18 * Math.sin(v * Math.PI * 2)];
        [x, y] = path(u);
        for (let j = 1; j <= 3; j++) {
          const v = u - j * 0.04; if (v <= 0) break; const [tx, ty] = path(v);
          dither(ctx, Math.round(tx) - 2, Math.round(ty) - 2, 4, 4, j < 2 ? C.purple : C.plum, 'check');
        }
      }
      drawSprite(ctx, TITLE_CATS[i % TITLE_CATS.length], Math.round(x), Math.round(y), { frame: ((t >> 4) + i) % 2 });
    }
    // hero: chase-cam view of Pom flying toward the sun at an exact 2x of her in-game sprite, her shadow on the grid
    const hov = Math.round(Math.sin(t / 12) * 2);
    const shw = 22 - hov; dither(ctx, W / 2 - shw, 221, shw * 2, 4, C.ink, 'check'); rect(ctx, W / 2 - shw + 5, 222, shw * 2 - 10, 2, C.ink);
    this.heroPom(ctx, W / 2, 171 + hov, t);
    // menu: chamfered neon frame with targeting ticks, like the HUD
    const items = this.titleItems(); const off = this.titleDisabled();
    const mh = items.length * 15 + 14; const my = 230; const mw = 176, mx = W / 2 - mw / 2;
    frame(ctx, mx, my, mw, mh, C.line, C.night, 6);
    scanlines(ctx, mx + 2, my + 2, mw - 4, mh - 4);
    ticks(ctx, mx, my, mw, mh, (t >> 4) % 2 ? C.line : C.deep, 7, 3);
    this.rows = menu(ctx, items, this.sel, W / 2, my + 9, t, 15, ['play', 'new', 'book', 'gear'], 158, { disabled: off, tag: off.map(x => x ? 'NO SAVE' : '') });
    const hs = `HI-SCORE ${String(g.state.hiScore).padStart(8, '0')}`; const hx = Math.round(W / 2 - (textWidth(hs) + 10) / 2);
    chamferFill(ctx, hx - 6, my + mh + 6, textWidth(hs) + 22, 13, C.ink, 3); chamferLine(ctx, hx - 6, my + mh + 6, textWidth(hs) + 22, 13, C.burnt, 3);
    icon(ctx, 'star', hx, my + mh + 9, C.gold); text(ctx, hs, hx + 10, my + mh + 9, C.gold);
    const k = keys(this.dev());
    hintRow(ctx, [[k.move, 'CHOOSE'], [k.ok, 'SELECT']], W / 2, 346, C.line);
  }

  // ---------------- sector map ----------------
  map(g: Game, ctx: CanvasRenderingContext2D) {
    const t = this.t; const T0 = 46, B0 = 276;
    rect(ctx, 0, 0, W, H, C.bg);
    // soft nebulae: solid tone bands with ordered dither only where bands meet (cached, static)
    const neb = nebulaCanvas(); if (neb) ctx.drawImage(neb, 0, 0);
    // parallax stars: far layer slow, near layer faster, a few twinkles
    for (let i = 0; i < 70; i++) { const x = ((i * 131 - (t >> 3)) % W + W) % W, y = T0 + (i * 71) % (B0 - T0); rect(ctx, x, y, 1, 1, (i + (t >> 4)) % 11 ? C.indigo : C.pale); }
    for (let i = 0; i < 24; i++) { const x = ((i * 211 + 40 - (t >> 1)) % W + W) % W, y = T0 + (i * 113) % (B0 - T0); rect(ctx, x, y, 1, 1, i % 4 ? C.peri : C.ice); }
    // cyan hologram grid: dotted 16px lattice, dithered 64px rules
    for (let y = T0 + 2; y < B0; y += 16) for (let x = 16; x < W; x += 16) rect(ctx, x, y, 1, 1, (x % 64 === 0) ? C.deep : C.night);
    for (let x = 64; x < W; x += 64) dither(ctx, x, T0, 1, B0 - T0, C.deep, 'sparse');
    for (let y = T0 + 18; y < B0; y += 64) dither(ctx, 8, y, W - 16, 1, C.deep, 'sparse');
    // scan sweep: bright leading edge with a fading dither trail, drawn beneath routes, nodes and labels
    const sx = Math.round((t * 1.5) % (W + 80)) - 40;
    for (let k = 1; k < 9; k++) dither(ctx, sx - k, T0, 1, B0 - T0, k < 3 ? C.deep : C.night, k < 3 ? 'check' : 'sparse');
    rect(ctx, sx, T0, 1, B0 - T0, C.deep); if ((t >> 1) % 2) dither(ctx, sx, T0, 1, B0 - T0, C.line2, 'sparse');
    // frame for the chart area: corner ticks
    ticks(ctx, 10, T0, W - 20, B0 - T0, C.deep, 8, 0);
    // header bar
    // header bar stops short of the top-right corner, which holds the sound chip
    frame(ctx, 36, 6, W - 72, 34, C.line, C.night, 6);
    headline(ctx, 'SECTOR MAP', W / 2, 12, C.line, C.ice, C.deep);
    text(ctx, 'CHOOSE YOUR NEXT FLIGHT PATH', W / 2, 29, C.dim, { align: 'center' });
    // legend: each symbol is a distinct shape (dashed route, cat badge, check badge)
    const lx0 = 46;
    line(ctx, lx0, 20, lx0 + 12, 20, C.hot, [3, 1], -(t >> 2)); line(ctx, lx0, 21, lx0 + 12, 21, C.mag, [3, 1], -(t >> 2)); text(ctx, 'LIVE ROUTE', lx0 + 17, 17, C.hot);
    chamferFill(ctx, lx0 - 1, 27, 11, 11, C.ink, 2); chamferLine(ctx, lx0 - 1, 27, 11, 11, C.mag, 2); icon(ctx, 'cat', lx0 + 1, 29, C.hot); text(ctx, 'BIG CAT', lx0 + 15, 29, C.dim);
    chamferFill(ctx, lx0 + 63, 27, 11, 11, C.ink, 2); chamferLine(ctx, lx0 + 63, 27, 11, 11, C.deep, 2); checkMark(ctx, lx0 + 65, 29); text(ctx, 'CLEAR', lx0 + 79, 29, C.dim);
    const cl = g.state.areasCleared.length;
    // cleared count as a right-aligned pair (value + label) mirroring the legend on the left
    const clr = `${String(cl).padStart(2, '0')}/${String(g.content.areas.length).padStart(2, '0')}`;
    text(ctx, 'CLEAR', W - 46, 17, C.dim, { align: 'right' }); text(ctx, clr, W - 46 - textWidth('CLEAR') - 6, 17, C.line, { align: 'right' });
    const na = g.content.areas.length; segBar(ctx, W - 46 - (na * 5 - 1), 30, na, 4, 3, cl / Math.max(1, na), C.line);
    const pos = this.layout(g);
    const exits = g.mods.world.exitsFrom(g.state.areaId);
    const here = pos[g.state.areaId];
    if (here) { ring(ctx, here[0], here[1], 24, C.deep, [3, 3], t >> 2); ring(ctx, here[0], here[1], 38, C.plum, [2, 4], -(t >> 3)); }
    const selTo = exits[Math.min(this.mapSel, exits.length - 1)]?.to;
    // edges with a 1px glow underlay for lit routes
    for (const a of g.content.areas) for (const e of a.exits) {
      const p1 = pos[a.id], p2 = pos[e.to]; if (!p1 || !p2) continue;
      const live = a.id === g.state.areaId && exits.some((x: any) => x.to === e.to);
      const done = g.state.areasCleared.includes(e.to) && g.state.areasCleared.includes(a.id);
      const isSel = live && e.to === selTo;
      const c = isSel ? C.gold : live ? C.hot : done ? C.line : C.indigo;
      if (live || done) line(ctx, p1[0], p1[1] + 1, p2[0], p2[1] + 1, isSel ? C.burnt : live ? C.mag : C.deep);
      if (!live && !done) {
        // locked routes: dithered dim cyan (deep + cyan pixels alternating) so they read at 1x; secret routes dotted
        if (e.when) line(ctx, p1[0], p1[1], p2[0], p2[1], C.line2, [1, 2]);
        else { line(ctx, p1[0], p1[1], p2[0], p2[1], C.deep); line(ctx, p1[0], p1[1], p2[0], p2[1], C.line2, [1, 1]); }
      } else line(ctx, p1[0], p1[1], p2[0], p2[1], c, e.when ? [2, 3] : live ? [4, 2] : undefined, live ? -(t >> 1) : 0);
      if (live) { // data packet travelling along the live route
        const f = ((t + (isSel ? 0 : 20)) % 60) / 60;
        rect(ctx, Math.round(p1[0] + (p2[0] - p1[0]) * f) - 1, Math.round(p1[1] + (p2[1] - p1[1]) * f) - 1, 3, 3, isSel ? C.text : C.pink);
      }
    }
    // nodes: chamfered badges with a 16px sector glyph
    let selLabel: (() => void) | null = null;
    g.content.areas.forEach((a, idx) => {
      const p = pos[a.id]; if (!p) return;
      const cleared = g.state.areasCleared.includes(a.id), isHere = a.id === g.state.areaId, sel = a.id === selTo;
      const reachable = exits.some((x: any) => x.to === a.id);
      const c = sel ? C.gold : isHere ? C.hot : cleared ? C.line : reachable ? C.pink : C.peri;
      const bx = p[0] - 11, by = p[1] - 11;
      chamferFill(ctx, bx - 1, by - 1, 24, 24, C.ink, 6);
      chamferFill(ctx, bx, by, 22, 22, sel || isHere ? C.plum : C.night, 5);
      chamferLine(ctx, bx, by, 22, 22, sel || isHere || cleared || reachable ? c : C.indigo, 5);
      const gm = sel ? C.gold : isHere ? C.pink : cleared ? C.line : reachable ? C.pink : C.peri;
      const gs = sel ? C.burnt : isHere ? C.mag : cleared ? C.deep : reachable ? C.mag : C.indigo;
      glyph(ctx, a.id, p[0], p[1], gm, gs);
      if (cleared && !isHere) { chamferFill(ctx, bx + 14, by + 14, 11, 11, C.ink, 2); chamferLine(ctx, bx + 14, by + 14, 11, 11, C.deep, 2); checkMark(ctx, bx + 16, by + 16); }
      // every live exit wears its quest consequence on the chart (lime flag = finishes one, pink cross = closes one)
      const rn = reachable ? this.routeNote(g, a.id) : null;
      if (rn) { chamferFill(ctx, bx + 14, by - 3, 11, 11, C.ink, 2); chamferLine(ctx, bx + 14, by - 3, 11, 11, rn.good ? P20 : C.mag, 2); icon(ctx, rn.good ? 'flag' : 'cross', bx + 16, by - 1, rn.good ? C.lime : C.pink); }
      if (a.boss && (cleared || sel)) { chamferFill(ctx, bx - 3, by - 3, 11, 11, C.ink, 2); chamferLine(ctx, bx - 3, by - 3, 11, 11, sel ? C.burnt : C.mag, 2); icon(ctx, 'cat', bx - 1, by - 1, sel ? C.gold : C.hot); }
      // node number on an ink backplate so it reads over nebulae and grid
      const lbl = String(idx + 1).padStart(2, '0');
      chamferFill(ctx, p[0] - 8, p[1] + 13, 17, 11, C.ink, 2);
      text(ctx, lbl, p[0], p[1] + 15, sel ? C.gold : isHere ? C.hot : cleared ? C.line : C.dim, { align: 'center' });
      if (sel) selLabel = () => { // brackets + name tag drawn last so nothing crosses them
        const o = 15 + ((t >> 3) % 2);
        for (const [sx2, sy2] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          rect(ctx, p[0] + sx2 * o - (sx2 > 0 ? 3 : 0), p[1] + sy2 * o, 4, 1, C.gold);
          rect(ctx, p[0] + sx2 * o, p[1] + sy2 * o - (sy2 > 0 ? 3 : 0), 1, 4, C.gold);
        }
        const nm = a.name.toUpperCase(); const nw = textWidth(nm) + 10;
        const up = p[1] - 40 > T0 + 2; const ly = up ? p[1] - 36 : p[1] + 26;
        const lx = Math.max(10, Math.min(W - 10 - nw, p[0] - nw / 2));
        chamferFill(ctx, lx, ly, nw, 12, C.night, 3); chamferLine(ctx, lx, ly, nw, 12, C.burnt, 3);
        text(ctx, nm, lx + 5, ly + 3, C.gold);
        if (up) line(ctx, p[0], ly + 12, p[0], p[1] - o - 2, C.burnt, [1, 1]);
      };
      if (isHere) drawSprite(ctx, 'hud_paw', p[0], p[1] - 22 + ((t >> 4) % 2));
    });
    (selLabel as (() => void) | null)?.();
    this.sectorLog(g, ctx, selTo, exits);
    // info panel
    if (selTo) {
      const a = g.mods.world.area(selTo);
      const tv = this.touch.visible(g); const bx = tv ? PF_X + 4 : 96, by = 284, bw = W - 2 * bx, bh = 70;
      frame(ctx, bx, by, bw, bh, C.hot, C.night, 6);
      chamferFill(ctx, bx + 8, by - 5, 64, 11, C.hot, 3); text(ctx, 'NEXT HOP', bx + 14, by - 3, C.ink);
      // rows: name 7, subtitle 18, quest consequence 29, facts 41, hints 55 (all fixed, nothing swaps places)
      // glyph badge on the left of the info panel
      chamferFill(ctx, bx + 10, by + 12, 26, 26, C.ink, 6); chamferLine(ctx, bx + 10, by + 12, 26, 26, C.burnt, 6);
      glyph(ctx, selTo, bx + 23, by + 25, C.gold, C.burnt);
      text(ctx, a.name.toUpperCase(), W / 2, by + 7, C.gold, { align: 'center', shadow: C.burnt });
      if (a.subtitle) this.fitCentered(ctx, a.subtitle, W / 2, by + 18, bw - 90, C.text);
      // the hop's quest consequence, always on its own row (quest.routeNote): 'FINISHES: ...' / 'CLOSES: ...'
      const rn = this.routeNote(g, selTo);
      const anyNote = exits.some((e: { to: string }) => this.routeNote(g, e.to));
      if (rn) {
        const rw = textWidth(rn.text) + 12, rx = Math.round(W / 2 - rw / 2);
        icon(ctx, rn.good ? 'flag' : 'cross', rx, by + 29, rn.good ? C.lime : C.pink); text(ctx, rn.text, rx + 12, by + 29, rn.good ? C.lime : C.pink);
      } else if (anyNote) { const q = 'QUESTS: NO CHANGE'; const rw = textWidth(q) + 12, rx = Math.round(W / 2 - rw / 2); icon(ctx, 'flag', rx, by + 29, C.peri); text(ctx, q, rx + 12, by + 29, C.dim); }
      const parts: [string, string, string][] = [['wave', `${a.waves.length} WAVES`, C.line]];
      if (a.boss) parts.push(['cat', 'BIG CAT', C.hot]);
      if (a.bonus) parts.push(['gift', 'BONANZA', C.gold]);
      parts.push([a.tod === 'night' ? 'moon' : a.tod === 'dusk' ? 'dusk' : a.tod === 'dawn' ? 'dawn' : 'sun', a.tod.toUpperCase(), a.tod === 'night' ? C.violet : a.tod === 'dusk' ? C.pink : a.tod === 'dawn' ? C.orange : C.gold]);
      const pw = parts.reduce((s, [, l]) => s + textWidth(l) + 10, 0) + (parts.length - 1) * 12;
      let x = Math.round(W / 2 - pw / 2);
      for (const [ic, l, c] of parts) { icon(ctx, ic, x, by + 41, c); text(ctx, l, x + 10, by + 41, C.pale); x += textWidth(l) + 22; }
      const k = keys(this.dev());
      hintRow(ctx, [[k.adj, 'ROUTE'], [k.ok, 'LAUNCH'], [k.pause, 'MENU']], W / 2, by + 55, C.line);
    }
  }
  /** quest.routeNote for a hop, worded 'VERB: QUEST' ('CLOSES: FOLLOW THE CATNIP'), or null. */
  routeNote(g: Game, areaId: string | undefined): { text: string; good: boolean; more: number } | null {
    if (!areaId) return null;
    let rn: { kind?: string; text: string; good: boolean; more?: number } | null = null;
    try { rn = g.mods.quest?.routeNote?.(areaId, 60) ?? null; } catch { rn = null; }
    return rn ? { text: rn.text.replace(/^(FINISHES|CLOSES) /, '$1: ') + ((rn.more ?? 0) > 0 ? ` +${rn.more}` : ''), good: rn.kind ? rn.kind === 'finishes' : !!rn.good, more: rn.more ?? 0 } : null;
  }
  /** Centred one-liner that always fits whole: regular font, else the narrow tier, else two narrow lines. */
  fitCentered(ctx: CanvasRenderingContext2D, s: string, cx: number, y: number, w: number, c: string) {
    const u = s.toUpperCase();
    if (textWidth(u) <= w) { text(ctx, u, cx, y, c, { align: 'center' }); return; }
    if (tinyWidth(u) <= w) { tiny(ctx, u, cx, y + 1, c, { align: 'center' }); return; }
    (balancePx(u, w, tinyWidth) ?? wrapPx(u, w, tinyWidth).slice(0, 2)).forEach((l, i) => tiny(ctx, l, cx, y - 2 + i * 6, c, { align: 'center' }));
  }
  /** Sector log: every sector by number and name with its status, so the chart itself can stay numbers-only. */
  sectorLog(g: Game, ctx: CanvasRenderingContext2D, selTo: string | undefined, exits: { to: string }[]) {
    const t = this.t; const tv = this.touch.visible(g);
    const x = MAP_LIST_X, y = 52, w = W - 12 - x, bottom = tv ? 228 : 274, h = bottom - y;
    frame(ctx, x, y, w, h, C.line, C.night, 5);
    scanlines(ctx, x + 2, y + 2, w - 4, h - 4);
    header(ctx, 'SECTOR LOG', x + 8, y + 7, w - 16, C.line, t);
    const areas = g.content.areas; const step = Math.min(15, Math.floor((h - 26) / areas.length));
    areas.forEach((a, i) => {
      const yy = y + 21 + i * step;
      const cleared = g.state.areasCleared.includes(a.id), here = a.id === g.state.areaId, sel = a.id === selTo;
      const reach = exits.some(e => e.to === a.id);
      const secret = !cleared && !here && !reach && areas.some(b => b.exits.some(e => e.to === a.id && e.when));
      if (sel) { chamferFill(ctx, x + 4, yy - 2, w - 8, 11, C.plum, 2); chamferLine(ctx, x + 4, yy - 2, w - 8, 11, C.burnt, 2); }
      const c = sel ? C.gold : here ? C.hot : cleared ? C.line : reach ? C.pink : C.peri;
      text(ctx, String(i + 1).padStart(2, '0'), x + 9, yy, c);
      // the status icon owns a reserved column at the right; a long name is abbreviated to whole glyphs before it
      // (the NEXT HOP panel always shows the full name of the selected sector)
      const ix = x + w - 15; const tw = ix - 6 - (x + 25);
      const nc = sel ? C.gold : here ? C.text : cleared ? C.pale : reach ? C.text : C.dim;
      const nm = secret ? '? ? ?' : this.fitName(a.name, tw, a.id);
      if (nm) text(ctx, nm, x + 25, yy, nc); else tiny(ctx, a.name, x + 25, yy + 1, nc);
      if (here) icon(ctx, 'paw', ix, yy, (t >> 4) % 2 ? C.hot : C.pink);
      else if (cleared) checkMark(ctx, ix, yy - 1);
      else if (reach) arrow(ctx, ix + 5, yy + 3, 'l', 4, sel ? C.gold : C.pink);
      else icon(ctx, 'lock', ix, yy, C.indigo);
    });
  }
  /** A sector name for the main face in `px`: whole, or without a leading 'THE'; '' when it needs the small-caps tier
   *  (the row then draws the full name in tiny, never a cut-off name). */
  fitName(name: string, px: number, id?: string) {
    const s = name.toUpperCase();
    if (textWidth(s) <= px) return s;
    if (s.startsWith('THE ') && textWidth(s.slice(4)) <= px) return s.slice(4);
    const sh = id ? LOG_SHORT[id] : undefined; if (sh && textWidth(sh) <= px) return sh;
    return '';
  }
  /** Constellation layout: columns by graph depth, rows spread vertically and offset per column so the route zig-zags across the chart. */
  layout(g: Game): Record<string, [number, number]> {
    const depth: Record<string, number> = {}; const start = g.content.start;
    const visit = (id: string, d: number, guard: number) => { if (guard > 40) return; if ((depth[id] ?? -1) >= d) return; depth[id] = d; for (const e of g.content.areas.find(a => a.id === id)?.exits ?? []) visit(e.to, d + 1, guard + 1); };
    visit(start, 0, 0);
    const cols: Record<number, string[]> = {};
    for (const a of g.content.areas) if (depth[a.id] !== undefined) (cols[depth[a.id]] ??= []).push(a.id);
    const maxD = Math.max(...Object.keys(cols).map(Number));
    const out: Record<string, [number, number]> = {};
    const mid = 160, amp = 52; const x0 = 40, x1 = MAP_LIST_X - 30;
    // nodes snap to 40px rows so their number plates share baselines across the chart
    const snap = (y: number) => 76 + 40 * Math.max(0, Math.min(4, Math.round((y - 76) / 40)));
    for (const [d, ids] of Object.entries(cols)) {
      const k = +d; const yc = mid + Math.round(Math.sin(k * 1.25 + 0.6) * (ids.length > 1 ? amp * 0.4 : amp));
      ids.forEach((id, i) => { out[id] = [Math.round(x0 + (k / Math.max(1, maxD)) * (x1 - x0)), snap(yc + (i - (ids.length - 1) / 2) * 84)]; });
    }
    return out;
  }

  // ---------------- menus ----------------
  dim(ctx: CanvasRenderingContext2D) {
    // calm palette-remap dim of the playfield only, so the HUD panels stay readable while paused
    const sc = this.g.state.scene; const hud = sc === 'play' || sc === 'bonus' || sc === 'dialogue';
    if (hud) dimRect(ctx, PF_X + 1, 0, PF_W - 2, H); else dimRect(ctx, 0, 0, W, H);
  }
  pause(g: Game, ctx: CanvasRenderingContext2D) {
    this.dim(ctx);
    const items = this.pauseItems(); const n = items.length; const w = 196, h = 102 + n * 20; const x = Math.round(W / 2 - w / 2), y = Math.round(H / 2 - h / 2) + 4;
    frame(ctx, x, y, w, h, C.line, C.night, 8);
    scanlines(ctx, x + 2, y + 2, w - 4, h - 4);
    ticks(ctx, x, y, w, h, C.deep, 8, 3);
    chamferFill(ctx, x + 10, y - 8, w - 20, 26, C.ink, 5); chamferLine(ctx, x + 10, y - 8, w - 20, 26, C.deep, 5);
    headline(ctx, 'PAUSED', W / 2, y - 1, C.line, C.ice, C.deep);
    const A = g.mods.world?.area();
    if (A) text(ctx, A.name.toUpperCase(), W / 2, y + 26, C.dim, { align: 'center' });
    rect(ctx, x + 16, y + 38, w - 32, 1, C.indigo);
    const icons = items.map(it => ({ RESUME: 'play', 'SKIP BRIEFING': 'skip', JOURNAL: 'book', SETTINGS: 'gear', 'COPY SAVE CODE': 'paw' } as Record<string, string>)[it] ?? 'disk');
    this.rows = menu(ctx, items, this.sel, W / 2, y + 52, this.t, 20, icons, w - 28);
    const dy = y + 52 + n * 20;
    rect(ctx, x + 16, dy, w - 32, 1, C.indigo);
    text(ctx, this.heldDlg ? 'BRIEFING ON HOLD' : 'PROGRESS SAVES AUTOMATICALLY', W / 2, dy + 8, C.dim, { align: 'center' });
    const k = keys(this.dev());
    hintRow(ctx, [[k.ok, 'SELECT'], [k.back, 'RESUME']], W / 2, y + h - 18, C.line);
  }
  settings(g: Game, ctx: CanvasRenderingContext2D) {
    const s = g.state.settings;
    this.dim(ctx);
    const w = 280, h = 52 + SETTINGS_ROWS.length * 22; const x = Math.round(W / 2 - w / 2), y = Math.round((H - h) / 2) + 6;
    frame(ctx, x, y, w, h, C.violet, C.night, 8);
    scanlines(ctx, x + 2, y + 2, w - 4, h - 4);
    ticks(ctx, x, y, w, h, C.purple, 8, 3);
    chamferFill(ctx, x + 40, y - 8, w - 80, 26, C.ink, 5); chamferLine(ctx, x + 40, y - 8, w - 80, 26, C.purple, 5);
    headline(ctx, 'SETTINGS', W / 2, y - 1, C.violet, C.pale, C.purple);
    this.rows = [];
    SETTINGS_ROWS.forEach(([k, ic, key], i) => {
      const on = i === this.sel; const yy = y + 30 + i * 22; const rx = x + 14, rw = w - 28;
      this.rows.push({ x: rx, y: yy - 6, w: rw, h: 22 });
      if (on) { chamferFill(ctx, rx, yy - 5, rw, 18, C.plum, 4); chamferLine(ctx, rx, yy - 5, rw, 18, C.purple, 4); rect(ctx, rx + 1, yy - 1, 1, 10, C.violet); }
      icon(ctx, ic, rx + 8, yy, on ? C.gold : C.peri);
      text(ctx, k, rx + 20, yy, on ? C.gold : C.text, { shadow: C.ink });
      const vx = rx + rw - 8;
      if (key === 'music' || key === 'sfx' || key === 'amb') {
        const v = s[key];
        segBar(ctx, vx - 99, yy, 10, 8, 7, v, on ? C.gold : C.violet, C.ink);
        text(ctx, String(Math.round(v * 10)), vx - 104, yy, on ? C.gold : C.dim, { align: 'right' });
      } else if (key === 'shake' || key === 'flash' || key === 'reduceMotion') {
        this.pill(ctx, vx, yy, ['OFF', 'ON'], s[key] ? 1 : 0, on);
      } else if (key === 'touch') {
        this.pill(ctx, vx, yy, ['AUTO', 'ON', 'OFF'], ['auto', 'on', 'off'].indexOf(s.touch), on);
      }
    });
    const k = keys(this.dev());
    hintRow(ctx, [[k.adj, 'ADJUST'], [k.ok, 'TOGGLE'], [k.back, 'BACK']], W / 2, y + h - 18, C.violet);
  }
  /** Segmented option pill, right-aligned at rx. */
  pill(ctx: CanvasRenderingContext2D, rx: number, y: number, opts: string[], sel: number, focus: boolean) {
    const ws = opts.map(o => textWidth(o) + 8); const total = ws.reduce((a, b) => a + b, 0);
    let x = rx - total;
    chamferFill(ctx, x - 1, y - 3, total + 2, 13, C.ink, 3);
    opts.forEach((o, i) => {
      const on = i === sel;
      if (on) chamferFill(ctx, x, y - 2, ws[i], 11, focus ? C.gold : C.violet, 2);
      text(ctx, o, x + 4, y, on ? C.ink : C.peri);
      x += ws[i];
    });
  }

  // ---------------- ending ----------------
  /** Home yard silhouette on the horizon: house with lit windows, a tree and a picket fence (pixel rects only). */
  homeYard(ctx: CanvasRenderingContext2D, HZ: number, t: number) {
    // picket fence across the horizon
    for (let x = 4; x < W; x += 8) { rect(ctx, x, HZ - 9, 3, 9, C.plum); rect(ctx, x + 1, HZ - 10, 1, 1, C.plum); }
    rect(ctx, 0, HZ - 7, W, 1, C.plum); rect(ctx, 0, HZ - 3, W, 1, C.plum);
    // house (left of the sun)
    const hx = 150, hw = 68, hh = 34, top = HZ - hh;
    for (let i = 0; i < 22; i++) rect(ctx, hx - 6 + i * 2, top - i, hw + 12 - i * 4, 1, C.night);
    rect(ctx, hx, top, hw, hh, C.night);
    rect(ctx, hx + 46, top - 30, 8, 14, C.night);
    rect(ctx, hx - 6, top, hw + 12, 1, C.indigo);
    const lit = (t >> 5) % 6 ? C.gold : C.orange;
    for (const wx of [hx + 8, hx + 44]) { rect(ctx, wx, top + 8, 14, 10, C.burnt); rect(ctx, wx + 1, top + 9, 12, 8, lit); rect(ctx, wx + 7, top + 9, 1, 8, C.burnt); rect(ctx, wx + 1, top + 13, 12, 1, C.burnt); }
    rect(ctx, hx + 27, top + 14, 12, hh - 14, C.plum); rect(ctx, hx + 36, top + 24, 1, 1, C.gold);
    // round tree (right of the sun)
    const tx = 470;
    rect(ctx, tx - 2, HZ - 22, 5, 22, C.night);
    for (let dy = -18; dy <= 18; dy++) { const dx = Math.floor(Math.sqrt(324 - dy * dy) * 1.2); rect(ctx, tx - dx, HZ - 40 + dy, dx * 2 + 1, 1, C.night); }
    for (let dy = -17; dy <= -10; dy++) { const dx = Math.floor(Math.sqrt(289 - dy * dy) * 1.1); rect(ctx, tx - dx + 2, HZ - 40 + dy, Math.max(0, dx - 2), 1, C.indigo); }
  }
  /** Ending timeline: flight home (riders + a trailing ribbon of pups), credits roll, then the story card. Cached. */
  endPlan(g: Game) {
    // every number on screen is the save's own: the diorama, the PUPS HOME counter and the stat chip all show
    // inventory.pups. EVERY PUP HOME (the block party) is staged only when that count really is the full Lost Pups
    // roster; a true-ending flag with fewer pups home plays the hopeful search-party ending (its title and story too)
    const need = Math.max(1, (g.content.quests.find(q => q.id === 'lost_pups') as any)?.complete?.count ?? 6);
    const pups = Math.max(0, g.state.inventory.pups ?? 0);
    const want = g.content.endings.find(x => x.id === g.state.ending) ?? g.content.endings[0];
    const kind: 'true' | 'good' = want?.id === 'ending_true' && pups >= need ? 'true' : 'good';
    const e = kind === 'good' && want?.id === 'ending_true' ? (g.content.endings.find(x => x.id === 'ending_good') ?? want) : want;
    const shown = Math.min(END_MAX_PUPS, pups);
    const key = `${shown}|${e?.id}`;
    if (this.plan && this.plan.key === key) return this.plan;
    const fly = END_FLY + Math.max(0, shown - 1) * END_LAG + 90;
    const credits = this.creditItems(g, shown);
    const travel = credits.reduce((a, c) => a + c.h, 0) + END_WIN;
    // the roll is paced so the whole ending (flight, roll, typed story) lands on the card by tick ~1990
    const lines = e ? e.text.flatMap(t => [...wrap(t, 58), '']).slice(0, -1) : [];
    const reveal = (lines.length + 1) * END_LINE;
    const rollTicks = Math.max(560, Math.min(Math.round(travel / 0.7), 1990 - fly - reveal));
    this.plan = { key, kind, pups, need, shown, fly, card: fly + rollTicks, rollTicks, travel, credits, lines, reveal, e };
    return this.plan;
  }
  plan: { key: string; kind: 'true' | 'good'; pups: number; need: number; shown: number; fly: number; card: number; rollTicks: number; travel: number; credits: { h: number; draw: (ctx: CanvasRenderingContext2D, y: number, t: number) => void }[]; lines: string[]; reveal: number; e: any } | null = null;
  /** Credits roll items (heights in px; draw(y) paints the item with its top at y, centered on the screen). */
  creditItems(g: Game, shown: number) {
    const cx = W / 2; const items: { h: number; draw: (ctx: CanvasRenderingContext2D, y: number, t: number) => void }[] = [];
    const gap = (h: number) => items.push({ h, draw: () => {} });
    const title = (s: string, c: string, hi: string, sh: string) => items.push({ h: 24, draw: (ctx, y) => headline(ctx, s, cx, y + 4, c, hi, sh) });
    const small = (s: string, c = C.pale) => items.push({ h: 14, draw: (ctx, y) => inked(ctx, s, cx, y + 3, c) });
    items.push({ h: 64, draw: (ctx, y) => { drawLogo(ctx, logoWord('POODLE', 2, PINK, 3, 2, 3), cx, y + 6); drawLogo(ctx, logoWord('PATROL', 2, CYAN, 3, 2, 3), cx, y + 36); } });
    gap(18); small('STARRING');
    items.push({ h: 92, draw: (ctx, y, t) => { draw2x(ctx, 'end_pom_sit', cx, y + 38, { frame: (t >> 5) % 2 }); text(ctx, 'CAPTAIN POM', cx, y + 80, C.gold, { align: 'center', shadow: C.burnt }); } });
    gap(10);
    if (shown > 0) {
      small(shown === 1 ? 'AND THE PUP SHE BROUGHT HOME' : `AND THE ${shown} PUPS SHE BROUGHT HOME`);
      const perRow = 8, rows = Math.ceil(shown / perRow);
      items.push({ h: rows * 36 + 6, draw: (ctx, y, t) => {
        for (let i = 0; i < shown; i++) {
          const r = Math.floor(i / perRow), inRow = Math.min(perRow, shown - r * perRow), c = i % perRow;
          draw2x(ctx, 'end_pup_sit', cx + (c - (inRow - 1) / 2) * 36, y + 18 + r * 36 - (((t >> 3) + i) % 9 === 0 ? 2 : 0), { frame: ((t >> 4) + i) % 3 === 0 ? 1 : 0, recolor: PUP_COATS[i % PUP_COATS.length], flipX: c >= inRow / 2 });
        }
      } });
    } else small('AND EVERY PUP STILL ON THE WAY HOME');
    gap(26); title('THE FELINE ARMADA', C.hot, C.pink, C.mag); gap(8);
    // every cast entry: a name line (wrapped in one colour) and, for the Big Cats, one dim role line (their sector)
    // every text line is its own 14px row (13px scrim + 1px clear), so two lines never share a scrim or touch
    const LH = 14;
    const grid = (list: { sprite: string; lines: string[]; role?: string }[], cell: number, sh: number) => {
      for (let r = 0; r < list.length; r += 3) {
        const row = list.slice(r, r + 3);
        const nl = Math.max(...row.map(e => e.lines.length + (e.role ? 1 : 0)));
        items.push({ h: sh + 8 + nl * LH, draw: (ctx, y, t) => row.forEach((e, i) => {
          const x = cx + (i - (row.length - 1) / 2) * cell;
          drawSprite(ctx, e.sprite, x, y + sh / 2, { frame: frameCount(e.sprite) > 1 ? ((t >> 4) + i) % 2 : 0 });
          // names and role lines carry a full 1px ink outline, so they read on every band of either sky
          e.lines.forEach((l, k) => inked(ctx, l, x, y + sh + 4 + k * LH, C.text));
          if (e.role) inked(ctx, e.role, x, y + sh + 4 + e.lines.length * LH, C.gold);
        }) });
      }
    };
    const ens = g.content.enemies.filter(e => SHEETS[e.sprite]);
    // the armada: one line per breed in a 150px column (the full name when it fits, else the HUD's short name)
    const one = (id: string, nm: string) => { const f = nm.toUpperCase(); return textWidth(f) <= 140 ? f : HUD_BREED[id] ?? f; };
    grid(ens.filter(e => e.behavior !== 'boss').map(e => ({ sprite: e.sprite, lines: [one(e.id, e.name)] })), 150, 34);
    gap(22); title('THE BIG CATS', C.gold, C.cream, C.burnt); gap(10);
    grid(ens.filter(e => e.behavior === 'boss').map(e => {
      const home = g.content.areas.find(a => a.boss === e.id);
      return { sprite: e.sprite, lines: wrap(e.name.split(',')[0].toUpperCase(), 20).slice(0, 2), role: home ? (this.balance(home.name.toUpperCase(), 20) ?? [home.name.toUpperCase()]).join(' ') : 'BIG CAT' };
    }), 128, 66);
    gap(30); small('THANK YOU FOR FLYING', C.text); gap(4);
    items.push({ h: 30, draw: (ctx, y) => headline(ctx, 'GOOD GIRL, POM.', cx, y + 6, C.gold, C.cream, C.burnt) });
    return items;
  }

  // ---- ending diorama: two set pieces on one stage (sky, skyline, yard, lawn), everything that lives is 2x ----
  /** Banded sky with 6-row ordered-dither seams (25 / 50 / 75%) between bands (no gradients, palette exact). */
  endSky(ctx: CanvasRenderingContext2D, bands: [string, number][]) {
    let y0 = 0;
    bands.forEach(([c, y1], i) => {
      rect(ctx, 0, y0, W, y1 - y0, c);
      const nx = bands[i + 1];
      if (nx) { dither(ctx, 0, y1 - 6, W, 2, nx[0], 'sparse'); dither(ctx, 0, y1 - 4, W, 4, nx[0], 'check'); rect(ctx, 0, y1, W, 2, nx[0]); dither(ctx, 0, y1, W, 2, c, 'sparse'); }
      y0 = y1;
    });
  }
  /** Flat-bottomed pixel cloud: a row of discs on a slab, lit rim on top, shadow line underneath. */
  endCloud(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, body: string, rim: string, under: string) {
    x = Math.round(x);
    const bumps = Math.max(2, Math.round(w / 14));
    for (let i = 0; i < bumps; i++) { const bx = x + 7 + i * (w - 14) / Math.max(1, bumps - 1); const r = 5 + ((i * 7 + w) % 3) * 2; disc(ctx, bx, y - r + 4, r, rim); }
    for (let i = 0; i < bumps; i++) { const bx = x + 7 + i * (w - 14) / Math.max(1, bumps - 1); const r = 5 + ((i * 7 + w) % 3) * 2; disc(ctx, bx, y - r + 5, r - 1, body); }
    rect(ctx, x, y, w, 5, body); rect(ctx, x + 3, y + 5, w - 6, 1, under);
  }
  /** Manhattan skyline silhouette on the horizon (far row lighter, near row darker), windows lit in a fixed pattern. */
  endSkyline(ctx: CanvasRenderingContext2D, HZ: number, far: string, near: string, win: string, t: number, lit: number) {
    const H1 = HZ - 8;
    // far row: tall towers, one spire, water towers
    for (let i = 0, x = -6; x < W; i++) {
      const w = 18 + (i * 37) % 22, h = 34 + (i * 53) % 44; rect(ctx, x, H1 - h, w, h, far);
      if (i % 4 === 1) { rect(ctx, x + (w >> 1) - 1, H1 - h - 14, 2, 14, far); rect(ctx, x + (w >> 1) - 3, H1 - h - 4, 6, 4, far); }
      if (i % 5 === 3) { rect(ctx, x + 4, H1 - h - 7, 8, 5, far); rect(ctx, x + 5, H1 - h - 2, 1, 2, far); rect(ctx, x + 10, H1 - h - 2, 1, 2, far); for (let k = 0; k < 4; k++) rect(ctx, x + 4 + k * 2, H1 - h - 8, 1, 1, far); }
      x += w + 2 + (i % 3);
    }
    // near row: lower blocks with lit windows
    for (let i = 0, x = -10; x < W; i++) {
      const w = 24 + (i * 29) % 26, h = 16 + (i * 41) % 26; rect(ctx, x, H1 - h, w, h + 8, near);
      for (let wy = H1 - h + 4; wy < H1 - 2; wy += 5) for (let wx = x + 3; wx < x + w - 3; wx += 4) {
        const k = (wx * 7 + wy * 13 + i * 5) % 17; if (k < lit) rect(ctx, wx, wy, 2, 2, (k === 0 && (t >> 6) % 2) ? C.orange : win);
      }
      x += w + 1;
    }
  }
  /** Pom's yard: picket fence, her house (porch, door, lit windows), the round tree. */
  endYard(ctx: CanvasRenderingContext2D, HZ: number, kind: 'true' | 'good', t: number) {
    const wall = kind === 'true' ? C.plum : C.night, roof = kind === 'true' ? C.night : C.ink, trim = kind === 'true' ? C.purple : C.indigo;
    const hx = 34, hw = 104, hh = 46, top = HZ - hh;
    for (let i = 0; i < 30; i++) rect(ctx, hx - 8 + i * 2, top - i, hw + 16 - i * 4, 1, roof);
    rect(ctx, hx - 8, top, hw + 16, 1, trim);
    rect(ctx, hx + 74, top - 40, 10, 18, roof);
    rect(ctx, hx, top + 1, hw, hh - 1, wall);
    const lit = kind === 'true' ? C.gold : (t >> 5) % 7 ? C.gold : C.orange;
    for (const wx of [hx + 10, hx + 72]) { rect(ctx, wx, top + 10, 20, 14, C.burnt); rect(ctx, wx + 1, top + 11, 18, 12, lit); rect(ctx, wx + 10, top + 11, 1, 12, C.burnt); rect(ctx, wx + 1, top + 17, 18, 1, C.burnt); }
    rect(ctx, hx + 42, top + 16, 20, hh - 16, C.ink); rect(ctx, hx + 44, top + 18, 16, hh - 18, kind === 'true' ? C.burnt : C.plum); rect(ctx, hx + 56, top + 32, 2, 2, C.gold);
    // porch light by the door, left on for whoever is still on the way home (a solid core + 2-step dither pool)
    rect(ctx, hx + 66, top + 18, 4, 5, C.cream); rect(ctx, hx + 67, top + 17, 2, 1, C.gold);
    dither(ctx, hx + 58, top + 24, 20, 10, C.gold, 'sparse'); dither(ctx, hx + 62, top + 24, 12, 5, C.gold, 'check');
    // the round tree on the right
    const tx = 604; rect(ctx, tx - 3, HZ - 30, 6, 30, roof);
    const clumps: [number, number, number][] = [[-14, -40, 13], [12, -42, 14], [0, -56, 15], [-20, -56, 10], [20, -60, 10], [0, -34, 12]];
    const [leaf, sunlit] = kind === 'true' ? [C.dgreen, C.green] : [C.ink, C.night];
    for (const [dx, dy, r] of clumps) disc(ctx, tx + dx, HZ + dy, r, leaf);
    // light catches the upper-left of each clump: a solid core and a dithered falloff, never a hard ring
    for (const [dx, dy, r] of clumps) { disc(ctx, tx + dx - 3, HZ + dy - 4, Math.max(2, r - 8), sunlit); const rr = r - 4; for (let k = -rr; k <= 0; k++) { const w = Math.floor(Math.sqrt(rr * rr - k * k)); dither(ctx, tx + dx - 2 - w, HZ + dy - 2 + k, w * 2, 1, sunlit, 'check'); } }
    // picket fence along the back of the lawn
    const fc = kind === 'true' ? C.cream : C.peri, fs = kind === 'true' ? C.tan : C.indigo;
    for (let x = 2; x < W; x += 8) { rect(ctx, x, HZ - 12, 4, 12, fc); rect(ctx, x + 1, HZ - 13, 2, 1, fc); rect(ctx, x + 3, HZ - 11, 1, 11, fs); }
    rect(ctx, 0, HZ - 9, W, 2, fc); rect(ctx, 0, HZ - 4, W, 2, fc); rect(ctx, 0, HZ - 8, W, 1, fs); rect(ctx, 0, HZ - 3, W, 1, fs);
  }
  /** Lawn from the fence to the bottom edge: mown stripes (solid + dithered bands), a lit edge along the fence. */
  endLawn(ctx: CanvasRenderingContext2D, HZ: number, kind: 'true' | 'good') {
    const [a, b, edge] = kind === 'true' ? [C.green, C.dgreen, C.lime] : [C.dgreen, C.night, C.green];
    rect(ctx, 0, HZ, W, H - HZ, a);
    for (let i = 0; i < 9; i++) { const x0 = i * 80 - 40; for (let y = HZ; y < H; y += 2) { const sk = Math.round((y - HZ) * (i * 80 - 320) / 220); dither(ctx, x0 + sk, y, 40, 2, b, 'sparse'); } }
    rect(ctx, 0, HZ, W, 1, edge); dither(ctx, 0, HZ + 1, W, 2, edge, 'sparse');
  }
  /** Where pup i sits on the lawn (2x sitting pose): back row beside Pom, then a front row clear of the prompt. */
  pupSlot(i: number): { x: number; base: number; flip: boolean } {
    const side = i % 2 ? -1 : 1, k = i >> 1;
    if (k < 4) return { x: END_POM_X + side * (48 + k * 34), base: 306, flip: side > 0 };
    return { x: END_POM_X + side * (92 + (k - 4) * 40), base: 344, flip: side > 0 };
  }
  /** Flight path home (u 0..1): in from the right, high, a lazy wave over the skyline, down onto the lawn by Pom's spot. */
  homePath(u: number): [number, number] {
    const e = u < 0 ? 0 : u > 1 ? 1 : u;
    const x = 720 + (END_POM_X - 720) * (e * 0.8 + 0.2 * e * e);
    const y = 84 + (END_POM_Y - 84) * e * e + Math.sin(e * Math.PI * 2) * 26 * (1 - e);
    return [Math.round(x), Math.round(y)];
  }
  ending(g: Game, ctx: CanvasRenderingContext2D) {
    const P = this.endPlan(g); const T = this.endingT; const HZ = 262; const t = this.t; const tru = P.kind === 'true';
    // ---- the stage: sky, sun or moon, clouds, searchlights, skyline, yard, lawn
    if (tru) this.endSky(ctx, [[C.night, 44], [C.indigo, 84], [C.purple, 122], [C.mag, 158], [C.hot, 190], [C.orange, 222], [C.gold, HZ]]);
    else this.endSky(ctx, [[C.ink, 70], [C.night, 150], [C.indigo, 222], [C.peri, HZ]]);
    const starsTo = tru ? 84 : 200;
    for (let i = 0; i < (tru ? 40 : 120); i++) {
      const x = (i * 97 + (i >> 3) * 13) % W, y = (i * 53) % starsTo; const tw = (i * 7 + (t >> 3)) % 29 === 0;
      rect(ctx, x, y, 1, 1, tw ? C.text : i % 5 ? (tru ? C.peri : C.indigo) : C.pale);
      if (!tru && i % 17 === 0) { rect(ctx, x - 1, y, 3, 1, C.pale); rect(ctx, x, y - 1, 1, 3, C.pale); }
    }
    if (tru) {
      // the sun setting behind the skyline: banded, slatted (the title's sun, warmer and lower)
      const sx = 420, sy = HZ - 18, sr = 58;
      for (let dy = -sr; dy <= 0; dy++) {
        const yy = sy + dy, f = (dy + sr) / sr, dx = Math.floor(Math.sqrt(sr * sr - dy * dy));
        if (f > 0.55 && (yy - (t >> 3)) % Math.max(3, Math.round(10 - f * 7)) === 0) continue;
        rect(ctx, sx - dx, yy, dx * 2 + 1, 1, f < 0.3 ? C.cream : f < 0.6 ? C.gold : C.orange);
      }
      const drift = (t >> 3) % (W + 120);
      this.endCloud(ctx, ((90 + drift) % (W + 120)) - 100, 104, 70, C.mag, C.pink, C.purple);
      this.endCloud(ctx, ((380 + drift) % (W + 120)) - 100, 140, 96, C.hot, C.cream, C.mag);
      this.endCloud(ctx, ((610 + drift) % (W + 120)) - 100, 70, 54, C.purple, C.pink, C.indigo);
    } else {
      // a big moon with craters and a dithered halo
      const mx = 520, my = 62;
      for (let r = 30; r > 24; r -= 3) for (let dy = -r; dy <= r; dy++) { const dx = Math.floor(Math.sqrt(r * r - dy * dy)); dither(ctx, mx - dx, my + dy, dx * 2 + 1, 1, C.indigo, 'sparse'); }
      disc(ctx, mx, my, 20, C.pale); disc(ctx, mx + 3, my + 2, 18, C.text); disc(ctx, mx + 4, my + 3, 15, C.pale);
      disc(ctx, mx - 6, my - 5, 4, C.dim); disc(ctx, mx + 7, my + 6, 3, C.dim); disc(ctx, mx - 3, my + 9, 2, C.dim);
      const drift = (t >> 4) % (W + 120);
      this.endCloud(ctx, ((60 + drift) % (W + 120)) - 100, 120, 80, C.indigo, C.peri, C.night);
      this.endCloud(ctx, ((420 + drift) % (W + 120)) - 100, 96, 60, C.indigo, C.dim, C.night);
      // Biscuit's search parties: three searchlights sweeping the sky from behind the city
      for (const [bx, ph] of [[150, 0], [330, 2.1], [500, 4.2]] as [number, number][]) {
        const a = Math.sin(t / 90 + ph) * 0.5; const base = HZ - 30;
        for (let y = base; y > 20; y -= 2) {
          const d = base - y, cxl = bx + d * Math.tan(a), hw = 2 + d * 0.07;
          dither(ctx, Math.round(cxl - hw), y, Math.round(hw * 2), 2, d < 60 ? C.ice : C.dim, d < 120 ? 'sparse' : 'scan');
        }
      }
    }
    this.endSkyline(ctx, HZ, tru ? C.purple : C.plum, tru ? C.plum : C.night, tru ? C.cream : C.gold, t, tru ? 3 : 6);
    this.endYard(ctx, HZ, P.kind, t);
    this.endLawn(ctx, HZ, P.kind);
    const draws: { y: number; f: () => void }[] = [];
    if (tru) this.partyProps(ctx, HZ, T, t, draws); else { this.searchProps(ctx, HZ, T, t, draws); this.emptySlots(ctx, P, T, draws); }
    // ---- the flight home: Pom flies in nose-first (2x side view), the first pup riding on her back (true ending),
    // every other pup trailing her along the same path in a little caped ribbon, each landing on its own lawn spot
    const u = T / END_FLY;
    const rider = tru && P.shown > 0;
    let home = 0;
    for (let i = 0; i < P.shown; i++) {
      const coat = PUP_COATS[i % PUP_COATS.length]; const slot = this.pupSlot(i);
      if (rider && i === 0) {
        // the rider stays aboard until Pom lands, then hops down onto its spot
        if (u < 1) { const [px, py] = this.homePath(u); draws.push({ y: py + 1, f: () => draw2x(ctx, 'end_pup_sit', px + 18, py - 26 + (((T >> 3) % 2)), { recolor: coat, flipX: true }) }); continue; }
        const k = Math.min(1, (T - END_FLY) / 24); const x = Math.round(END_POM_X + 18 + (slot.x - END_POM_X - 18) * k), y = Math.round((END_POM_Y - 26) + (slot.base - 16 - (END_POM_Y - 26)) * k - Math.sin(k * Math.PI) * 22);
        if (k >= 1) home++;
        draws.push({ y: slot.base, f: () => draw2x(ctx, 'end_pup_sit', x, y, { recolor: coat, flipX: slot.flip, frame: k >= 1 && ((T >> 4) + i) % 4 === 0 ? 1 : 0 }) });
        continue;
      }
      const lagI = rider ? i : i + 1;
      const ui = (T - lagI * END_LAG) / END_FLY; if (ui <= 0) continue;
      if (ui < 1) {
        const [px, py] = this.homePath(ui); const w = smooth((ui - 0.7) / 0.3);
        const x = Math.round(px + (slot.x - END_POM_X) * w), y = Math.round(py + Math.sin((T + i * 20) / 9) * 3 * (1 - w) + (slot.base - 16 - END_POM_Y) * w);
        draws.push({ y, f: () => ui < 0.9 ? draw2x(ctx, 'end_pup_fly', x, y, { recolor: coat, frame: ((T >> 3) + i) % 2 }) : draw2x(ctx, 'end_pup_sit', x, y, { recolor: coat, flipX: slot.flip }) });
        continue;
      }
      home++;
      const since = T - lagI * END_LAG - END_FLY;
      const bob = since < 10 ? -Math.round(Math.sin(since / 10 * Math.PI) * 6) : tru && ((T >> 2) + i * 7) % 61 < 6 ? -Math.round(Math.sin((((T >> 2) + i * 7) % 61) / 6 * Math.PI) * 4) : 0;
      draws.push({ y: slot.base, f: () => draw2x(ctx, 'end_pup_sit', slot.x, slot.base - 16 + bob, { recolor: coat, flipX: slot.flip, frame: ((T >> 4) + i) % (tru ? 2 : 5) === 0 ? 1 : 0 }) });
    }
    if (u < 1) {
      const [x, y] = this.homePath(u);
      draws.push({ y, f: () => {
        // jet trail: sparks off her pod, cooling cream to plum
        for (let k = 1; k <= 7; k++) {
          if (u - k * 0.012 <= 0) break; const [tx, ty] = this.homePath(u - k * 0.012);
          const c = k < 2 ? C.cream : k < 4 ? C.gold : k < 6 ? C.orange : C.plum;
          if ((k + (T >> 1)) % 3) rect(ctx, tx + 16, ty - 10, 3, 2, c);
        }
        draw2x(ctx, 'end_pom_fly', x, y, { frame: (T >> 3) % 2 });
      } });
    } else {
      // touch-down: a dust puff, then she sits proudly in the middle of the lawn
      const since = T - END_FLY;
      draws.push({ y: END_POM_Y + 28, f: () => {
        if (since < 18) for (const s of [-1, 1]) { const r = 2 + (since >> 2); disc(ctx, END_POM_X + s * (20 + since), END_POM_Y + 26 - (since >> 3), r, tru ? C.lime : C.green); }
        draw2x(ctx, 'end_pom_sit', END_POM_X, END_POM_Y + (since < 6 ? 2 : 0), { frame: ((T >> 5) % 5 === 0) ? 1 : 0 });
      } });
    }
    draws.sort((a, b) => a.y - b.y).forEach(d => d.f());
    if (tru && T >= END_FLY) this.confetti(ctx, T);
    // ---- overlays: the homeward plate, the credits window, then the story card
    if (T < P.fly) {
      const head = tru ? 'HOMEWARD BOUND' : 'HEADING HOME'; const tw = numWidth(head) + 36;
      chamferFill(ctx, W / 2 - tw / 2, 10, tw, 26, C.ink, 6); chamferLine(ctx, W / 2 - tw / 2, 10, tw, 26, C.burnt, 6);
      headline(ctx, head, W / 2, 17, C.gold, C.cream, C.burnt);
      const lbl = P.shown ? `PUPS HOME ${home}/${P.shown}` : 'PUPS STILL ON THE WAY'; const lw = textWidth(lbl) + 24;
      chamferFill(ctx, W / 2 - lw / 2, 40, lw, 13, C.night, 3); chamferLine(ctx, W / 2 - lw / 2, 40, lw, 13, C.burnt, 3);
      icon(ctx, 'paw', W / 2 - lw / 2 + 6, 43, C.gold); text(ctx, lbl, W / 2 - lw / 2 + 16, 43, C.gold);
    } else if (T < P.card) {
      const off = Math.round((T - P.fly) * P.travel / P.rollTicks);
      this.creditsWindow(ctx, P, off, t);
      const k = keys(this.dev()); const pairs: [string, string][] = [[k.ok, 'SKIP']]; const pw = hintWidth(pairs) + 20;
      chamferFill(ctx, W / 2 - pw / 2, 340, pw, 17, C.ink, 4); chamferLine(ctx, W / 2 - pw / 2, 340, pw, 17, C.peri, 4);
      hintRow(ctx, pairs, W / 2, 345, C.text);
    } else this.endingCard(g, ctx, P, T - P.card);
  }
  /** Party set dressing (true ending): bunting from the roof to the tree, balloons on the fence, and the Empress at the
   *  picnic table with a cake and her hedgehog in a party hat. Table + Empress join the y-sorted draw list. */
  partyProps(ctx: CanvasRenderingContext2D, HZ: number, T: number, t: number, draws: { y: number; f: () => void }[]) {
    // bunting: a sagging string with triangle flags in four colours
    const x0 = 140, y0 = HZ - 70, x1 = 586, y1 = HZ - 58; const flags = [C.hot, C.gold, C.line, C.lime];
    for (let x = x0; x <= x1; x++) { const f = (x - x0) / (x1 - x0); const y = Math.round(y0 + (y1 - y0) * f + Math.sin(f * Math.PI) * 26); rect(ctx, x, y, 1, 1, C.ink); if ((x - x0) % 14 === 0 && x < x1 - 6) { const c = flags[((x - x0) / 14) % 4]; for (let k = 0; k < 7; k++) rect(ctx, x + 1 + (k >> 1), y + 1 + k, 7 - k, 1, c); } }
    // balloons tied to the fence by the gate
    for (const [bx, by, c] of [[214, HZ - 46, C.hot], [226, HZ - 54, C.line], [238, HZ - 44, C.gold]] as [number, number, string][]) {
      const bob = Math.round(Math.sin((t + bx) / 30) * 2);
      line(ctx, bx, by + 6 + bob, 226, HZ - 12, C.cream); disc(ctx, bx, by + bob, 6, darkOf(c)); disc(ctx, bx - 1, by - 1 + bob, 5, c); rect(ctx, bx - 3, by - 3 + bob, 2, 2, C.text);
    }
    // the picnic table (cake, the hedgehog in its party hat on the cloth) with the Empress sitting at its end
    const tx = 520, ty = 302, hw = 44;
    draws.push({ y: ty + 12, f: () => {
      rect(ctx, tx - hw, ty, hw * 2, 7, C.burnt); rect(ctx, tx - hw, ty, hw * 2, 2, C.orange); rect(ctx, tx - hw, ty + 7, hw * 2, 1, C.ink);
      for (let k = 0; k < 3; k++) rect(ctx, tx - hw + 6 + k * 28, ty + 2, 10, 3, k % 2 ? C.text : C.hot); // checked cloth hem
      rect(ctx, tx - hw + 4, ty + 8, 6, 24, C.burnt); rect(ctx, tx + hw - 10, ty + 8, 6, 24, C.burnt);
      rect(ctx, tx - hw + 4, ty + 8, 6, 1, C.ink); rect(ctx, tx + hw - 10, ty + 8, 6, 1, C.ink);
      // cake with three candles
      rect(ctx, tx - 38, ty - 12, 26, 12, C.cream); rect(ctx, tx - 38, ty - 12, 26, 3, C.pink); rect(ctx, tx - 38, ty - 5, 26, 1, C.hot);
      for (let k = 0; k < 3; k++) { rect(ctx, tx - 33 + k * 8, ty - 18, 2, 6, C.line); rect(ctx, tx - 33 + k * 8, ty - 21 + ((T >> 3) + k) % 2, 2, 2, C.gold); }
      // the hedgehog on the cloth, facing the cake; it hops now and then
      const hop = ((T >> 2) % 47) < 4 ? -Math.round(Math.sin(((T >> 2) % 47) / 4 * Math.PI) * 4) : 0;
      draw2x(ctx, 'end_hedgehog', tx + 14, ty - 14 + hop, { flipX: true, frame: (T >> 4) % 3 === 0 ? 1 : 0 });
    } });
    // the Empress: sitting on the lawn at the table's end, facing the party (tail flick + slow blink)
    draws.push({ y: 316, f: () => draw2x(ctx, 'end_empress_sit', 600, 316 - 36, { flipX: true, frame: (T >> 4) % 7 === 0 ? 1 : 0 }) });
  }
  /** Search set dressing (good ending): Commander Biscuit behind the hedge with a radio and a flashlight beam, and
   *  paw-print lanterns along the path for the pups still finding their way. */
  searchProps(ctx: CanvasRenderingContext2D, HZ: number, T: number, t: number, draws: { y: number; f: () => void }[]) {
    // lanterns on poles along the lawn edge
    for (const lx of [200, 456]) {
      rect(ctx, lx, HZ + 2, 2, 30, C.ink); rect(ctx, lx - 3, HZ - 6, 8, 9, C.ink); rect(ctx, lx - 2, HZ - 5, 6, 7, (t >> 4) % 9 ? C.gold : C.orange);
      dither(ctx, lx - 10, HZ - 10, 22, 18, C.gold, 'sparse');
    }
    // Commander Biscuit sitting on the lawn, flashlight raised, his field radio on the grass beside him
    const bx = 572, base = 318;
    draws.push({ y: base - 2, f: () => {
      const rx = bx + 30, ry = base - 14;
      rect(ctx, rx - 1, ry - 1, 18, 14, C.ink); rect(ctx, rx, ry, 16, 12, C.grayd); rect(ctx, rx, ry, 16, 2, col('p'));
      rect(ctx, rx + 2, ry + 4, 6, 4, C.ink); rect(ctx, rx + 3, ry + 5, 4, 2, (T >> 4) % 2 ? C.lime : C.dgreen);
      rect(ctx, rx + 10, ry + 4, 2, 2, C.gold); rect(ctx, rx + 13, ry + 4, 2, 2, col('o'));
      rect(ctx, rx + 13, ry - 16, 1, 15, C.ink); rect(ctx, rx + 12, ry - 17, 3, 2, (T >> 4) % 2 ? C.red : C.grayd);
      dither(ctx, rx - 2, ry + 12, 20, 2, C.ink, 'check');
    } });
    draws.push({ y: base, f: () => {
      // the beam leaves the lens (top left of the flipped sprite) and climbs into the night as a dithered cone
      const lx = bx - 30, ly = base - 52;
      for (let k = 0; k < 80; k += 2) { const hw = 1 + k * 0.28; dither(ctx, Math.round(lx - 4 - k * 0.8 - hw), ly - k, Math.round(hw * 2), 2, C.cream, k < 26 ? 'check' : 'sparse'); }
      draw2x(ctx, 'end_biscuit_sit', bx, base - 34, { flipX: true, frame: (T >> 4) % 2 });
    } });
  }
  /** Good ending: a paw-print lantern on a stake at each empty lawn spot, waiting for a pup still on the way home. */
  emptySlots(ctx: CanvasRenderingContext2D, P: NonNullable<UI['plan']>, T: number, draws: { y: number; f: () => void }[]) {
    for (let i = P.shown; i < Math.min(P.need, 8); i++) {
      const s = this.pupSlot(i); const x = s.x, b = s.base;
      draws.push({ y: b, f: () => {
        const lit = ((T >> 3) + i * 5) % 23 ? C.gold : C.orange;
        dither(ctx, x - 9, b - 2, 18, 4, C.gold, 'sparse');           // warm pool on the grass
        rect(ctx, x, b - 12, 1, 12, C.ink);                          // stake
        rect(ctx, x - 4, b - 22, 9, 10, C.ink); rect(ctx, x - 3, b - 21, 7, 8, lit); rect(ctx, x - 2, b - 24, 5, 2, C.ink);
        // the paw print in the glass: pad + three toes
        rect(ctx, x - 1, b - 16, 3, 2, C.burnt); rect(ctx, x - 2, b - 19, 1, 1, C.burnt); rect(ctx, x, b - 20, 1, 1, C.burnt); rect(ctx, x + 2, b - 19, 1, 1, C.burnt);
        dither(ctx, x - 7, b - 25, 15, 15, C.gold, 'sparse');
      } });
    }
  }
  /** Confetti drifting down over the party (deterministic per tick; 2x1 pixels in four colours). */
  confetti(ctx: CanvasRenderingContext2D, T: number) {
    const cs = [C.hot, C.gold, C.line, C.lime, C.text];
    for (let i = 0; i < 40; i++) {
      const x = (i * 149 + Math.round(Math.sin((T + i * 31) / 23) * 6)) % W, y = ((i * 71 + T * (0.5 + (i % 3) * 0.25)) % (H + 20)) - 10;
      rect(ctx, x, Math.round(y), (i + (T >> 3)) % 2 ? 2 : 1, (i + (T >> 3)) % 2 ? 1 : 2, cs[i % cs.length]);
    }
  }
  /** Credits roll in the sky window (y 4..208, its lower edge down over the dark skyline, below where the portraits
   *  pass): drawn to an offscreen, then cut by a 12px ordered-dither fade at both edges. */
  private credCv: HTMLCanvasElement | null = null; private credMask: HTMLCanvasElement | null = null;
  creditsWindow(ctx: CanvasRenderingContext2D, P: NonNullable<UI['plan']>, off: number, t: number) {
    const top = END_WIN_TOP, h = END_WIN; const FADE = END_FADE;
    if (typeof document === 'undefined') return;
    if (!this.credCv) { this.credCv = document.createElement('canvas'); this.credCv.width = W; this.credCv.height = h; }
    if (!this.credMask) {
      const m = document.createElement('canvas'); m.width = W; m.height = h; const mx = m.getContext('2d')!; mx.fillStyle = '#000';
      for (let y = 0; y < h; y++) {
        const d = Math.min(y, h - 1 - y); const lv = d >= FADE ? 16 : Math.floor((d + 1) * 16 / (FADE + 1));
        for (let x = 0; x < W; x++) if (BAYER[(y & 3) * 4 + (x & 3)] < lv) mx.fillRect(x, y, 1, 1);
      }
      this.credMask = m;
    }
    const c = this.credCv.getContext('2d'); if (!c) return;
    c.globalCompositeOperation = 'source-over'; c.imageSmoothingEnabled = false; c.clearRect(0, 0, W, h);
    let y = h - off;
    for (const it of P.credits) { if (y + it.h > -80 && y < h + 10) it.draw(c, y, t); y += it.h; }
    c.globalCompositeOperation = 'destination-in'; c.drawImage(this.credMask, 0, 0); c.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.credCv, 0, top);
  }
  /** Ordered-dither fade (0 = gone .. 16 = solid): cached 4x4 Bayer patterns used as a destination-in mask. */
  private fadePats: (CanvasPattern | null)[] = [];
  fadePattern(ctx: CanvasRenderingContext2D, lv: number) {
    if (this.fadePats[lv] !== undefined) return this.fadePats[lv];
    const c = document.createElement('canvas'); c.width = 4; c.height = 4; const x = c.getContext('2d')!; x.fillStyle = '#000';
    for (let i = 0; i < 16; i++) if (BAYER[i] < lv) x.fillRect(i & 3, i >> 2, 1, 1);
    return (this.fadePats[lv] = ctx.createPattern(c, 'repeat'));
  }
  private cardCv: HTMLCanvasElement | null = null;
  /**
   * The closing card: title, the typed story in a window, one row of stat chips, then the CONTINUE prompt. Once the
   * story has been read (END_CARD_HOLD ticks after the last line) the window dithers out and the stat row rises under
   * the title plate, so the diorama (sky, moon or sun, search lights or party) gets a clean final beat.
   */
  endingCard(g: Game, ctx: CanvasRenderingContext2D, P: NonNullable<UI['plan']>, T: number) {
    const e = P.e; if (!e) return;
    const title = e.title.toUpperCase();
    const tw = numWidth(title) + 36;
    chamferFill(ctx, W / 2 - tw / 2, 6, tw, 26, C.ink, 6); chamferLine(ctx, W / 2 - tw / 2, 6, tw, 26, C.burnt, 6);
    headline(ctx, title, W / 2, 13, C.gold, C.cream, C.burnt);
    const lines = P.lines;
    const py = 38, ph = Math.min(150, lines.length * 11 + 14);
    const shown = Math.floor(T / END_LINE);
    const fo = Math.max(0, Math.min(1, (T - P.reveal - END_HOLD) / END_OUT));
    const wx = PF_X - 20, ww = PF_W + 40;
    if (!this.cardCv && typeof document !== 'undefined') { this.cardCv = document.createElement('canvas'); this.cardCv.width = ww; this.cardCv.height = 152; }
    const c = fo < 1 ? this.cardCv?.getContext('2d') : null;
    if (c && this.cardCv) {
      // the story window is composed offscreen so it can dither out as one piece
      c.globalCompositeOperation = 'source-over'; c.imageSmoothingEnabled = false; c.clearRect(0, 0, ww, 152);
      frame(c, 0, 0, ww, ph, C.gold, C.night, 6);
      ticks(c, 0, 0, ww, ph, C.burnt, 7, 3);
      lines.slice(0, shown + 1).forEach((l, i) => { if (8 + i * 11 < ph - 8) text(c, l, ww / 2, 8 + i * 11, C.text, { align: 'center', shadow: C.ink }); });
      const lv = Math.round(16 * (1 - fo));
      if (lv < 16) { const pat = this.fadePattern(c, lv); c.globalCompositeOperation = 'destination-in'; c.fillStyle = pat ?? 'rgba(0,0,0,0)'; c.fillRect(0, 0, ww, 152); c.globalCompositeOperation = 'source-over'; }
      ctx.drawImage(this.cardCv, wx, py);
    }
    const s = g.state;
    // stats only once the story window is completely gone: chips drop in one by one, then the quest rewards, then the
    // epitaph plate (the last thing on the final screen)
    const s0 = T - (P.reveal + END_HOLD + END_OUT);
    if (s0 >= 0) {
      const stats: [string, string, string, string][] = [['star', String(s.score), 'PTS', C.gold], ['cat', String(s.stats.catsBooped), 'BOOPED', C.hot], ['paw', String(P.pups), 'PUPS', C.line],
        ['photo', `${s.memories.length}/${g.content.memories.length}`, 'MEMORIES', C.violet], ['clock', String(Math.floor(s.stats.playTicks / 3600)), 'MIN', C.lime], ['moon', String(s.stats.naps), 'NAPS', C.pale]];
      const ws = stats.map(([, v, l]) => 26 + textWidth(v) + 6 + textWidth(l) + 8); const gapX = 7;
      const rowW = ws.reduce((a, b) => a + b, 0) + gapX * (ws.length - 1);
      let cx = Math.round(W / 2 - rowW / 2);
      const cy = 40;
      // the chips sit in one ink tray (it drops in with the first chip), so the moon, searchlights and clouds never
      // show through the even 7px gaps between them
      if (s0 >= 0) { const ty = cy - 3 - Math.max(0, 4 - s0); chamferFill(ctx, cx - 4, ty, rowW + 8, 24, C.ink, 5); chamferLine(ctx, cx - 4, ty, rowW + 8, 24, C.night, 5); }
      stats.forEach(([ic, v, l, c], i) => {
        const cw = ws[i]; const k = s0 - i * 5;
        if (k >= 0) {
          const y = cy - Math.max(0, 4 - k);
          chamferFill(ctx, cx, y, cw, 18, C.ink, 4); chamferLine(ctx, cx, y, cw, 18, k < 2 ? lighter(c) : darkOf(c), 4);
          chamferFill(ctx, cx + 2, y + 2, 18, 14, darkOf(c), 3); icon(ctx, ic, cx + 7, y + 5, c === C.pale ? C.text : lighter(c));
          text(ctx, v, cx + 26, y + 6, C.text, { shadow: C.night }); text(ctx, l, cx + cw - 8, y + 6, c, { align: 'right' });
        }
        cx += cw + gapX;
      });
      // quiet quest rewards paid during the finale (quest.endingRewards), listed under the stats
      let qr: { name: string; text: string }[] = [];
      try { qr = g.mods.quest?.endingRewards?.() ?? []; } catch { qr = []; }
      const rows = qr.length > 3 ? [...qr.slice(0, 2).map(r => `QUEST ${r.name.toUpperCase()} ${r.text}`), `+${qr.length - 2} MORE QUESTS`] : qr.map(r => `QUEST ${r.name.toUpperCase()} ${r.text}`);
      const r0 = stats.length * 5 + 8;
      rows.forEach((r, i) => {
        if (s0 < r0 + i * 6) return;
        const y = cy + 26 + i * 12; const rw = textWidth(r);
        dither(ctx, Math.round(W / 2 - rw / 2) - 18, y - 3, rw + 26, 13, C.ink, 'check');
        icon(ctx, 'flag', Math.round(W / 2 - rw / 2 - 12), y, C.lime);
        text(ctx, r, W / 2, y, C.gold, { align: 'center', shadow: C.ink });
      });
      // the epitaph: one line on its own plate, centred in the open sky under everything else
      if (s0 >= r0 + rows.length * 6 + 10) {
        const ep = 'GOOD GIRL, POM. GOOD GIRL.'; const ew = numWidth(ep) + 36; const ey = cy + 26 + Math.max(1, rows.length) * 12 + 22;
        chamferFill(ctx, W / 2 - ew / 2, ey, ew, 26, C.ink, 6); chamferLine(ctx, W / 2 - ew / 2, ey, ew, 26, C.burnt, 6);
        headline(ctx, ep, W / 2, ey + 7, C.gold, C.cream, C.burnt);
      }
    }
    // prompt: plate and caption appear together once everything has been revealed (never an empty frame)
    if (T >= P.reveal) {
      const k = keys(this.dev()); const pairs: [string, string][] = [[k.ok, 'CONTINUE']]; const pw = hintWidth(pairs) + 20;
      chamferFill(ctx, W / 2 - pw / 2, 340, pw, 17, C.ink, 4); chamferLine(ctx, W / 2 - pw / 2, 340, pw, 17, (this.t >> 4) % 2 ? C.gold : C.burnt, 4);
      hintRow(ctx, pairs, W / 2, 345, (this.t >> 4) % 2 ? C.gold : C.orange);
    }
  }
  recovery(ctx: CanvasRenderingContext2D) {
    const t = this.t; const HZ = 300;
    // dusk version of the set piece: the sun sinks behind the panel, the yard waits on the horizon
    this.synthSet(ctx, t, HZ, 70, W / 2, [C.pink, C.hot, C.mag, C.purple, C.plum], 80);
    this.homeYard(ctx, HZ, t);
    // Captain Pom (the in-game sprite) hovers over the garden gate against the sun, waiting to fly again
    const hov = Math.round(Math.sin(t / 14) * 2);
    const shw = 20 - hov; dither(ctx, W / 2 - shw, HZ + 8, shw * 2, 4, C.ink, 'check'); rect(ctx, W / 2 - shw + 5, HZ + 9, shw * 2 - 10, 2, C.ink);
    this.heroPom(ctx, W / 2, HZ - 29 + hov, t);
    const w = 340, h = 160, x = Math.round(W / 2 - w / 2), y = 70;
    frame(ctx, x, y, w, h, C.hot, C.night, 8);
    scanlines(ctx, x + 2, y + 2, w - 4, h - 4);
    ticks(ctx, x, y, w, h, C.mag, 8, 3);
    chamferFill(ctx, x + 70, y - 8, w - 140, 18, C.hot, 5); text(ctx, 'SAVE RECOVERY', W / 2, y - 3, C.ink, { align: 'center' });
    // the culprit chewing the master floppy, the slot status, the options worded by save, and the hint row
    // (TAP AN OPTION on touch, CTRL+V SAVE CODE on keyboards)
    this.rows = drawRecoveryCard(ctx, this.g.mods.save.recoveryOptions(), this.sel, t, this.dev());
  }
}
export const makeUI = (): Module => new UI();
