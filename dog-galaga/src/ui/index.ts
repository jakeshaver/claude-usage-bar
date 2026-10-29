import type { Game, Module } from '../core/game';
import { drawRecoveryCard } from '../save/index';
import { W, H, PF_X, PF_W } from '../core/game';
import { text, wrap, textWidth } from '../art/font';
import { drawSprite, spriteCanvas, frameCount, SHEETS } from '../art/sprite';
import { KEY, col } from '../core/palette';
import { C, frame, bar, segBar, menu, scanlines, header, icon, rect, line, ring, disc, dither, arrow, keycap, hintRow, chamferFill, chamferLine, darkOf, lighter, keys, ticks, dimRect, type Device, type Row } from './draw';
import { logoWord, drawLogo, PINK, CYAN, GOLD } from './logo';
import { glyph } from './glyphs';
import { Touch } from './touch';
import { num, numWidth, headline } from './numerals';

type Menu = 'none' | 'pause' | 'settings' | 'journal' | 'confirmQuit';
const RX = PF_X + PF_W;               // right panel x
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

/** Settings rows: label, icon, settings key ('' = BACK). */
const SETTINGS_ROWS: [string, string, 'music' | 'sfx' | 'amb' | 'shake' | 'flash' | 'reduceMotion' | 'touch' | ''][] = [
  ['MUSIC', 'note', 'music'], ['SFX', 'speaker', 'sfx'], ['AMBIENCE', 'speaker', 'amb'], ['SCREEN SHAKE', 'shake', 'shake'],
  ['FLASHES', 'bolt', 'flash'], ['REDUCE MOTION', 'wave', 'reduceMotion'], ['TOUCH CONTROLS', 'hand', 'touch'], ['BACK', 'back', ''],
];

/** UI shell: HUD panels, title, sector map, pause, settings, dialogue box, ending, recovery, toasts. */
class UI implements Module {
  id = 'ui';
  api = this;
  g!: Game;
  t = 0; sel = 0; menuOpen: Menu = 'none'; settingsFrom: Menu | 'title' = 'pause';
  toasts: { text: string; t: number; age: number; y: number }[] = [];
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
    g.toastFn = (s) => this.toast(s);
    g.bus.on('scene:change', (p: any) => {
      this.sel = p.to === 'title' && !this.g.mods.save?.hasSave() ? 1 : 0; this.mapSel = 0;
      if (p.to === 'ending') this.endingT = 0;
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
  private toastHold = false; private toastPend: string[] = [];
  holdToasts(on: boolean) { this.toastHold = on; }
  private toastsHeld() { const sc = this.g?.state.scene; return this.toastHold || (!!this.g?.mods.memories?.revealing?.() && (sc === 'play' || sc === 'bonus')); }
  toast(s: string) {
    if (this.toastsMuted) return;
    if (this.toastsHeld()) { if (this.toastPend.length < 4) this.toastPend.push(s); return; }
    // power pickups: name the HUD slot the item lights up, so the bay labels and pickups tie together
    const it = this.g?.content?.items?.find(i => i.name.toUpperCase() === s);
    const pw = it && POWERS.find(p => p[0] === it.effect.kind);
    if (pw) s = `${s}: ${pw[4]}`;
    this.toasts.push({ text: s, t: 170, age: 0, y: -1 }); if (this.toasts.length > 4) this.toasts.shift(); }
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
    // toasts hold while a menu is open (they sit under the dim layer and resume afterwards)
    // ...and while a memory reveal card is up (held toasts play the tick it leaves)
    const held = this.toastsHeld();
    if (!held && this.toastPend.length) { const q = this.toastPend; this.toastPend = []; for (const s of q) this.toast(s); }
    if (this.menuOpen === 'none' && !held) { for (const x of this.toasts) { x.t--; x.age++; } this.toasts = this.toasts.filter(x => x.t > 0); }
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
    if (g.autopilot && this.menuOpen === 'none' && !(pauseable && I.pressed('pause'))) { this.autopilotNav(g); return; }
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
    else if (sc === 'ending') { this.endingT++; if (this.endingT > 240 && I.pressed('confirm')) { g.setScene('title'); } }
    else if (sc === 'recovery') this.recoveryNav(g);
  }

  autopilotNav(g: Game) {
    const sc = g.state.scene;
    if (sc === 'map' && !g.botDrivesMap && this.t % 30 === 0) { const ex = g.mods.world.exitsFrom(g.state.areaId); if (ex.length) g.mods.world.chooseExit(ex[(g.state.seed + g.state.areasCleared.length) % ex.length].to); }
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
    // toasts first: an open menu dims them along with the playfield
    this.drawToasts(ctx);
    if (this.menuOpen === 'pause') this.pause(g, ctx);
    if (this.menuOpen === 'settings') this.settings(g, ctx);
    if (this.menuOpen === 'journal') g.mods.journal?.draw(g, ctx);
    this.touch.draw(g, ctx, this.t);
  }

  /** Toasts unfold horizontally from their own center at a fixed y (>= 8): never clipped by the screen edge. */
  drawToasts(ctx: CanvasRenderingContext2D) {
    const cx = PF_X + PF_W / 2;
    // stack from the top (under the boss bar when it is up); on title/recovery just above the hint row, clear of the logo and menu
    const sc = this.g?.state.scene; const top = sc === 'title' || sc === 'recovery' ? 327 : this.bossBarOn ? 24 : 8;
    this.toasts.forEach((x, i) => {
      const target = top + i * 17;
      x.y = x.y < 0 ? target : x.y + Math.sign(target - x.y) * Math.min(2, Math.abs(target - x.y));
      const f = Math.min(1, x.age / 12, x.t / 10); const open = 1 - (1 - f) * (1 - f);
      const full = textWidth(x.text) + 30; const w = Math.max(14, Math.round(full * open)); const bx = Math.round(cx - w / 2);
      const y = Math.round(x.y);
      // never an empty chip: below 30% open nothing is drawn; after that the label is revealed together with
      // the frame (clipped to the pill's inside), so pill and words open and close as one
      if (open < 0.3) return;
      frame(ctx, bx, y, w, 14, C.hot, C.night, 4);
      const fx = Math.round(cx - full / 2), clip = open < 0.98;
      if (clip) { ctx.save(); ctx.beginPath(); ctx.rect(bx + 3, y + 2, w - 6, 10); ctx.clip(); }
      icon(ctx, x.text.startsWith('MEMORY') ? 'photo' : x.text.startsWith('PUPPY') ? 'paw' : x.text.includes('QUEST') ? 'flag' : 'star', fx + 7, y + 4, C.gold);
      text(ctx, x.text, fx + 18, y + 4, (x.age >> 2) % 2 && x.age < 30 ? C.text : C.gold);
      if (clip) ctx.restore();
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
  /** Wrap a name into at most `max` lines of `chars` characters (the last line ends in '.' if cut). */
  lines(s: string, chars: number, max = 2) {
    const nl = wrap(s.toUpperCase(), chars);
    if (nl.length <= max) return nl;
    const head = nl.slice(0, max - 1); const rest = nl.slice(max - 1).join(' ');
    return [...head, rest.slice(0, chars - 1).trimEnd() + '.'];
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
    // ===== right panel: fixed slots (no reflow between areas or states); the scanner fills the rest =====
    this.panel(ctx, RX, accR);
    const x1 = RX + 10;
    const B0 = g.mods.interaction?.boss;
    if (A) {
      const idx = g.content.areas.indexOf(A);
      header(ctx, `SECTOR ${String(idx + 1).padStart(2, '0')}`, x1, 10, w0, accR, t, true);
      // two reserved name lines: a long name wraps into both; a short one shares the slot with a subtitle ticker
      const nl = this.lines(A.name, 18);
      nl.forEach((l, i) => text(ctx, l, x1, 21 + i * 9, C.text, { shadow: C.ink }));
      if (nl.length === 1 && A.subtitle) text(ctx, this.clip(A.subtitle.toUpperCase(), 18), x1, 30, C.dim);
      const tot = A.waves.length + (A.boss ? 1 : 0); const cur = Math.min(tot, s.waveIndex + 1);
      const MB = g.state.scene === 'bonus' && !B0 ? g.mods.minigames?.def : null;
      header(ctx, MB ? `BONUS STAGE ${String(g.content.bonus.indexOf(MB) + 1).padStart(2, '0')}` : 'WAVE', x1, 44, w0, MB ? C.gold : C.hot, t);
      const wy = 55;
      if (MB) text(ctx, this.clip(String(MB.name).toUpperCase(), 18), x1, wy + 2, C.gold, { shadow: C.ink });
      else if (B0) {
        chamferFill(ctx, x1, wy - 1, w0, 13, C.mag, 3); chamferFill(ctx, x1 + 1, wy - 1, w0 - 2, 12, (t >> 4) % 2 ? C.hot : C.mag, 3);
        icon(ctx, 'cat', x1 + 6, wy + 2, C.text); text(ctx, 'BIG CAT WAVE', x1 + 16, wy + 2, C.text);
        arrow(ctx, x1 + w0 - 8, wy + 5, 'l', 3, C.text);
      } else {
        const aw = num(ctx, String(cur), x1, wy, C.line, { hi: C.ice, shadow: C.ink });
        const bw = num(ctx, `/${tot}`, x1 + aw + 2, wy, C.dim, { hi: C.pale, shadow: C.ink });
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
    header(ctx, 'RESCUED', x1, 72, w0, C.gold, t);
    chamferFill(ctx, x1, 82, 52, 18, C.night, 2); drawSprite(ctx, 'pup', x1 + 9, 91);
    text(ctx, `X${s.inventory.pups ?? 0}`, x1 + 20, 87, C.gold);
    chamferFill(ctx, x1 + 56, 82, w0 - 56, 18, C.night, 2); drawSprite(ctx, 'pk_memory', x1 + 65, 91);
    text(ctx, `${s.memories.length}/${g.content.memories.length}`, x1 + 76, 87, C.text);
    header(ctx, 'QUEST', x1, 106, w0, C.violet, t);
    // quest.tracked() returns null while a NEW QUEST toast is still held: no find() fallback then
    const Q = g.mods.quest;
    const q = Q?.tracked ? Q.tracked() : g.content.quests.find(q => s.quests[q.id] === 'active');
    if (q) {
      text(ctx, this.lines(q.name, 18, 1)[0], x1, 117, C.violet, { shadow: C.ink });
      icon(ctx, 'flag', x1, 128, C.violet);
      const pr = g.mods.quest?.progress?.(q);
      if (pr && pr.need > 1) { segBar(ctx, x1 + 10, 129, 10, 5, 4, pr.have / pr.need, C.violet); text(ctx, `${pr.have}/${pr.need}`, x1 + w0, 128, C.text, { align: 'right' }); }
      else { text(ctx, Q?.goal?.(q) || 'IN PROGRESS', x1 + 10, 128, C.dim); if (!Q?.goal) for (let i = 0; i < 3; i++) rect(ctx, x1 + 78 + i * 4, 133, 2, 2, ((t >> 4) % 4) > i ? C.violet : C.peri); }
    } else { text(ctx, 'NO ACTIVE QUEST', x1, 117, C.dim); icon(ctx, 'flag', x1, 128, C.peri); text(ctx, 'FLY ON, CAPTAIN', x1 + 10, 128, C.peri); }
    // threat slot: fixed 64px (boss armor, bonus tally, live breed roster, or the next formation preview)
    const TY = 142;
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
      // scanner anchored right under the threat slot, filling down to the clock blocks
      this.radar(g, ctx, x1, TY + 66, w0, 290 - (TY + 66), accS);
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
    text(ctx, this.lines(B0.def.name, 18, 1)[0], x1, y + 11, C.text, { shadow: C.ink });
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
  /** Fit a phrase into `chars` columns at a word boundary, ending in '...' when cut. */
  clip(s: string, chars: number) {
    if (s.length <= chars) return s;
    let out = ''; for (const w of s.split(' ')) { const n = out ? out + ' ' + w : w; if (n.length > chars - 3) break; out = n; }
    return out.replace(/[,.;:!-]+$/, '') + '...';
  }
  /** Threat slot (64px): live breed roster with a cats-left bar, or the next formation preview when the sky is empty. */
  roster(g: Game, ctx: CanvasRenderingContext2D, x: number, y: number, w: number) {
    const cats = (g.mods.interaction?.cats ?? []) as { def?: { id: string; name: string; sprite: string } }[];
    header(ctx, 'HOSTILES', x, y, w, C.hot, this.t, cats.length > 0);
    const by: Record<string, { n: number; name: string; sprite: string }> = {};
    for (const c of cats) { const d = c.def; if (!d) continue; (by[d.id] ??= { n: 0, name: d.name, sprite: d.sprite }).n++; }
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
    list.slice(0, rows).forEach((e, i) => {
      const cy = y + i * 9;
      icon(ctx, 'cat', x, cy, breedColor(e.sprite), C.ink);
      const nm = e.name.toUpperCase(); text(ctx, nm.length <= 13 ? nm : nm.split(' ')[0].slice(0, 13), x + 10, cy, C.pale);
      text(ctx, String(e.n), x + w, cy, C.text, { align: 'right' });
    });
    for (let i = Math.min(3, list.length); i < 3; i++) dither(ctx, x + 10, y + i * 9 + 3, w - 10, 1, C.indigo, 'check');
    if (list.length > 3) { const rest = list.slice(2).reduce((a, e) => a + e.n, 0); text(ctx, `+${list.length - 2} MORE BREEDS`, x + 10, y + 18, C.dim); text(ctx, String(rest), x + w, y + 18, C.text, { align: 'right' }); }
    const ly = y + 28;
    const tot = Math.max(1, this.waveCats, cats.length);
    text(ctx, 'CATS LEFT', x, ly, C.dim); text(ctx, `${cats.length}/${tot}`, x + w, ly, C.hot, { align: 'right' });
    segBar(ctx, x, ly + 10, 18, 5, 4, cats.length / tot, C.hot);
  }
  /** Mini preview of the formation about to fly in: one blip per cat, tinted by breed, in a holo box. */
  formationPreview(g: Game, ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, live: boolean) {
    const t = this.t; const A = g.mods.world?.area();
    chamferFill(ctx, x, y, w, h, C.ink, 3); chamferLine(ctx, x, y, w, h, live ? C.plum : C.indigo, 3);
    for (let gx = x + 6; gx < x + w - 3; gx += 6) dither(ctx, gx, y + 2, 1, h - 4, C.night, 'sparse');
    const wid = A?.waves?.[g.state.waveIndex]; const wave = g.content.waves.find(v => v.id === wid);
    if (!wave) { text(ctx, 'ALL CLEAR', x + w / 2, y + h / 2 - 3, C.peri, { align: 'center' }); return; }
    const { cols, rows } = wave.formation; const cw = Math.min(9, Math.floor((w - 8) / cols)), ch = Math.min(6, Math.floor((h - 12) / rows));
    const ox = Math.round(x + w / 2 - (cols * cw) / 2), oy = y + 4;
    const drop = live ? Math.max(0, 6 - ((t >> 2) % 40)) : 0;
    for (const c of wave.cats) {
      const e = g.content.enemies.find(en => en.id === c.breed); const col0 = e ? breedColor(e.sprite) : C.hot;
      for (let ci = 0; ci < cols; ci++) {
        if (c.cols && !c.cols.includes(ci)) continue;
        const bx = ox + ci * cw + ((cw - 5) >> 1), byy = oy + c.row * ch - drop;
        if (byy < y + 2) continue;
        rect(ctx, bx, byy, 5, 3, col0); rect(ctx, bx, byy, 1, 1, C.ink); rect(ctx, bx + 4, byy, 1, 1, C.ink);
      }
    }
    text(ctx, 'NEXT', x + 4, y + h - 9, C.peri); text(ctx, `${wave.cats.reduce((a, c) => a + (c.cols ? c.cols.length : cols), 0)} CATS`, x + w - 4, y + h - 9, live ? C.pink : C.dim, { align: 'right' });
  }

  /** Mini scanner of the playfield: cats as blips, Pom as a cyan chevron, sweeping beam (tinted per time of day). */
  radar(g: Game, ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, glow = C.lime) {
    const t = this.t; const I = g.mods.interaction; const P = g.mods.player;
    header(ctx, 'SCANNER', x, y, w, glow, t, true);
    const by = y + 11, bh = h - 11;
    chamferFill(ctx, x, by, w, bh, C.ink, 3); chamferLine(ctx, x, by, w, bh, darkOf(glow), 3);
    for (let gx = x + 9; gx < x + w - 2; gx += 9) dither(ctx, gx, by + 2, 1, bh - 4, C.night);
    for (let gy = by + 7; gy < by + bh - 2; gy += 7) dither(ctx, x + 2, gy, w - 4, 1, C.night);
    const sx = x + 2 + ((t >> 1) % (w - 4));
    for (let k = 1; k < 6 && sx - k > x + 1; k++) dither(ctx, sx - k, by + 2, 1, bh - 4, darkOf(glow), k < 3 ? 'check' : 'sparse');
    rect(ctx, sx, by + 2, 1, bh - 4, glow);
    const mx = (wx: number) => Math.round(x + 3 + Math.max(0, Math.min(1, wx / 448)) * (w - 7));
    const my = (wy: number) => Math.round(by + 3 + Math.max(0, Math.min(1, wy / 360)) * (bh - 7));
    for (const c of (I?.cats ?? []) as { x: number; y: number; st: string }[]) {
      if (c.y < -8 || c.y > 368) continue;
      const near = Math.abs(mx(c.x) - sx) < 6; const dive = c.st === 'dive' || c.st === 'kdive';
      rect(ctx, mx(c.x), my(c.y), dive ? 2 : 1, dive ? 2 : 1, near ? C.pink : dive ? C.hot : C.mag);
    }
    if (I?.boss && typeof I.boss.x === 'number') { const bx = mx(I.boss.x), byy = my(Math.max(0, I.boss.y)); rect(ctx, bx - 2, byy - 1, 5, 3, (t >> 3) % 2 ? C.hot : C.pink); }
    if (P && typeof P.x === 'number') { const px0 = mx(P.x), py0 = my(P.y); rect(ctx, px0, py0 - 1, 1, 1, C.line); rect(ctx, px0 - 1, py0, 3, 1, C.line); }
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
    const order = [1, 5, 3, 0, 6, 2, 4]; const diver = order[active];
    for (let i = 0; i < N; i++) {
      const sx0 = W / 2 + (i - 3) * (46 + breathe), sy0 = 135 + Math.abs(i - 3) * 7 + ((t >> 4) + i) % 2;
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
    // hero: chase-cam view of Pom flying toward the sun, high above the grid, her shadow on the ground
    const hov = Math.round(Math.sin(t / 12) * 2);
    const shw = 12 - hov; dither(ctx, W / 2 - shw, 220, shw * 2, 3, C.ink, 'check'); rect(ctx, W / 2 - shw + 3, 221, shw * 2 - 6, 1, C.ink);
    for (let i = 0; i < 3; i++) { const ly2 = 206 + hov + i * 3 + ((t >> 2) + i) % 3; rect(ctx, W / 2 - 1, ly2, 2, 1, i ? C.plum : C.purple); }
    drawSprite(ctx, SHEETS.pom ? 'pom' : 'poodle', W / 2, 186 + hov, { frame: (t >> 3) % 2 });
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
    frame(ctx, 8, 6, W - 16, 34, C.line, C.night, 6);
    headline(ctx, 'SECTOR MAP', W / 2, 12, C.line, C.ice, C.deep);
    text(ctx, 'CHOOSE YOUR NEXT FLIGHT PATH', W / 2, 29, C.dim, { align: 'center' });
    // legend: each symbol is a distinct shape (dashed route, cat badge, check badge)
    line(ctx, 18, 20, 30, 20, C.hot, [3, 1], -(t >> 2)); line(ctx, 18, 21, 30, 21, C.mag, [3, 1], -(t >> 2)); text(ctx, 'LIVE ROUTE', 35, 17, C.hot);
    chamferFill(ctx, 17, 27, 11, 11, C.ink, 2); chamferLine(ctx, 17, 27, 11, 11, C.mag, 2); icon(ctx, 'cat', 19, 29, C.hot); text(ctx, 'BIG CAT', 33, 29, C.dim);
    chamferFill(ctx, 81, 27, 11, 11, C.ink, 2); chamferLine(ctx, 81, 27, 11, 11, C.deep, 2); checkMark(ctx, 83, 29); text(ctx, 'CLEAR', 97, 29, C.dim);
    const cl = g.state.areasCleared.length;
    text(ctx, `${String(cl).padStart(2, '0')}/${String(g.content.areas.length).padStart(2, '0')} CLEAR`, W - 20, 17, C.dim, { align: 'right' });
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
      // glyph badge on the left of the info panel
      chamferFill(ctx, bx + 10, by + 12, 26, 26, C.ink, 6); chamferLine(ctx, bx + 10, by + 12, 26, 26, C.burnt, 6);
      glyph(ctx, selTo, bx + 23, by + 25, C.gold, C.burnt);
      text(ctx, a.name.toUpperCase(), W / 2, by + 9, C.gold, { align: 'center', shadow: C.burnt });
      if (a.subtitle) text(ctx, a.subtitle.toUpperCase(), W / 2, by + 21, C.text, { align: 'center' });
      const parts: [string, string, string][] = [['wave', `${a.waves.length} WAVES`, C.line]];
      if (a.boss) parts.push(['cat', 'BIG CAT', C.hot]);
      if (a.bonus) parts.push(['gift', 'BONANZA', C.gold]);
      parts.push([a.tod === 'night' ? 'moon' : a.tod === 'dusk' ? 'dusk' : a.tod === 'dawn' ? 'dawn' : 'sun', a.tod.toUpperCase(), a.tod === 'night' ? C.violet : a.tod === 'dusk' ? C.pink : a.tod === 'dawn' ? C.orange : C.gold]);
      const pw = parts.reduce((s, [, l]) => s + textWidth(l) + 10, 0) + (parts.length - 1) * 12;
      let x = Math.round(W / 2 - pw / 2);
      for (const [ic, l, c] of parts) { icon(ctx, ic, x, by + 35, c); text(ctx, l, x + 10, by + 35, C.pale); x += textWidth(l) + 22; }
      const k = keys(this.dev());
      hintRow(ctx, [[k.adj, 'ROUTE'], [k.ok, 'LAUNCH'], [k.pause, 'MENU']], W / 2, by + 53, C.line);
    }
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
      const nm = secret ? '? ? ?' : this.clip(a.name.toUpperCase(), 19);
      text(ctx, nm, x + 25, yy, sel ? C.gold : here ? C.text : cleared ? C.pale : reach ? C.text : C.dim);
      const ix = x + w - 15;
      if (here) icon(ctx, 'paw', ix, yy, (t >> 4) % 2 ? C.hot : C.pink);
      else if (cleared) checkMark(ctx, ix, yy - 1);
      else if (reach) arrow(ctx, ix + 5, yy + 3, 'l', 4, sel ? C.gold : C.pink);
      else icon(ctx, 'lock', ix, yy, C.indigo);
    });
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
  /** Pom's front-facing bust peeking over the picket fence at the horizon (rise 0..1 pops her up). */
  peekPom(ctx: CanvasRenderingContext2D, HZ: number, rise: number, t: number) {
    const spr = SHEETS.portrait_pom ? 'portrait_pom' : SHEETS.pom ? 'pom' : 'poodle';
    const sc = spriteCanvas(spr, 0); if (!sc) return;
    const cx = W / 2, top = Math.round(HZ - 4 - sc.height + (1 - rise) * 40 + (rise >= 1 ? (t >> 4) % 2 : 0));
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, HZ - 3); ctx.clip();
    ctx.drawImage(sc, Math.round(cx - sc.width / 2), top);
    ctx.restore();
    // fence pickets back in front of her
    for (let x = 4; x < W; x += 8) if (x > cx - sc.width / 2 - 8 && x < cx + sc.width / 2 + 4) { rect(ctx, x, HZ - 9, 3, 9, C.plum); rect(ctx, x + 1, HZ - 10, 1, 1, C.plum); }
    rect(ctx, cx - sc.width / 2 - 8, HZ - 7, sc.width + 16, 1, C.plum); rect(ctx, cx - sc.width / 2 - 8, HZ - 3, sc.width + 16, 1, C.plum);
  }
  ending(g: Game, ctx: CanvasRenderingContext2D) {
    const e = g.content.endings.find(x => x.id === g.state.ending) ?? g.content.endings[0];
    const T = this.endingT; const HZ = 262;
    // staging: the title's sunset set piece, now framing the home yard where Pom and the pups land
    this.synthSet(ctx, T, HZ, 62, W / 2, [C.cream, C.gold, C.orange, C.hot, C.mag], 70);
    this.homeYard(ctx, HZ, T);
    const title = e.title.toUpperCase();
    const allLogo = [...title].every(ch => ch === ' ' || 'PODLEATR'.includes(ch));
    if (allLogo && title.length <= 14) drawLogo(ctx, logoWord(title.replace(/ /g, ''), 2, GOLD, 3, 2, 3), W / 2, 12);
    else {
      const tw = numWidth(title) + 36;
      chamferFill(ctx, W / 2 - tw / 2, 10, tw, 26, C.ink, 6); chamferLine(ctx, W / 2 - tw / 2, 10, tw, 26, C.burnt, 6);
      headline(ctx, title, W / 2, 17, C.gold, C.cream, C.burnt);
    }
    // story panel in the sky
    const lines = e.text.flatMap(t => [...wrap(t, 58), '']).slice(0, -1);
    const py = 44, ph = Math.min(148, lines.length * 11 + 14);
    const shown = Math.floor(T / 40);
    frame(ctx, PF_X + 2, py, PF_W - 4, ph, C.gold, C.night, 6);
    ticks(ctx, PF_X + 2, py, PF_W - 4, ph, C.burnt, 7, 3);
    lines.slice(0, shown + 1).forEach((l, i) => { if (py + 8 + i * 11 < py + ph - 8) text(ctx, l, W / 2, py + 8 + i * 11, C.text, { align: 'center', shadow: C.ink }); });
    // home: Pom pops up over the garden fence (front-facing bust, like the pups), pups glide down beside her
    const land = Math.min(1, T / 150); const ease = 1 - (1 - land) * (1 - land);
    this.peekPom(ctx, HZ, ease, T);
    const pups = g.state.inventory.pups ?? 0; const n = Math.min(8, pups);
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1, k = (i >> 1) + 1;
      const f = Math.max(0, Math.min(1, (T - 40 - i * 18) / 90)); const fe = 1 - (1 - f) * (1 - f);
      const px = W / 2 + side * (12 + k * 22) + Math.round((1 - fe) * side * 60);
      const pyy = Math.round(HZ - 8 - (1 - fe) * 150 - (f >= 1 && (T + i * 7) % 40 < 6 ? 2 : 0));
      if (f > 0) drawSprite(ctx, 'pup', px, pyy);
    }
    // stat chips on the grid: an accent tab with the icon, then the value and a quiet label
    const s = g.state;
    if (shown > lines.length) {
      const stats: [string, string, string, string][] = [['star', String(s.score), 'PTS', C.gold], ['cat', String(s.stats.catsBooped), 'BOOPED', C.hot], ['paw', String(pups), 'PUPS', C.line],
        ['photo', `${s.memories.length}/${g.content.memories.length}`, 'MEMORIES', C.violet], ['clock', String(Math.floor(s.stats.playTicks / 3600)), 'MIN', C.lime], ['moon', String(s.stats.naps), 'NAPS', C.pale]];
      const cw = 128, cols = 3;
      stats.forEach(([ic, v, l, c], i) => {
        const cx = W / 2 - (cols * cw) / 2 + (i % cols) * cw + 4, cy = 276 + Math.floor(i / cols) * 22;
        chamferFill(ctx, cx, cy, cw - 8, 18, C.ink, 4); chamferLine(ctx, cx, cy, cw - 8, 18, darkOf(c), 4);
        chamferFill(ctx, cx + 2, cy + 2, 18, 14, darkOf(c), 3); icon(ctx, ic, cx + 7, cy + 5, c === C.pale ? C.text : lighter(c));
        text(ctx, v, cx + 26, cy + 6, C.text, { shadow: C.night }); text(ctx, l, cx + cw - 14, cy + 6, c, { align: 'right' });
      });
    }
    if (T > 240) { chamferFill(ctx, W / 2 - 56, 338, 112, 17, C.ink, 4); chamferLine(ctx, W / 2 - 56, 338, 112, 17, C.burnt, 4); if ((this.t >> 4) % 2) hintRow(ctx, [[keys(this.dev()).ok, 'CONTINUE']], W / 2, 343, C.gold); }
  }
  recovery(ctx: CanvasRenderingContext2D) {
    const t = this.t; const HZ = 300;
    // dusk version of the set piece: the sun sinks behind the panel, the yard waits on the horizon
    this.synthSet(ctx, t, HZ, 70, W / 2, [C.pink, C.hot, C.mag, C.purple, C.plum], 80);
    this.homeYard(ctx, HZ, t);
    const w = 340, h = 160, x = Math.round(W / 2 - w / 2), y = 70;
    frame(ctx, x, y, w, h, C.hot, C.night, 8);
    scanlines(ctx, x + 2, y + 2, w - 4, h - 4);
    ticks(ctx, x, y, w, h, C.mag, 8, 3);
    chamferFill(ctx, x + 70, y - 8, w - 140, 18, C.hot, 5); text(ctx, 'SAVE RECOVERY', W / 2, y - 3, C.ink, { align: 'center' });
    // the culprit chewing the master floppy, the slot status, the options worded by save, and the hint row
    // (TAP AN OPTION on touch, CTRL+V SAVE CODE on keyboards)
    this.rows = drawRecoveryCard(ctx, this.g.mods.save.recoveryOptions(), this.sel, t, this.dev());
    // Pom peeks over the garden fence, waiting to fly again
    this.peekPom(ctx, HZ, 1, t);
  }
}
export const makeUI = (): Module => new UI();
