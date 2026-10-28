import type { Game, Module } from '../core/game';
import { W, H, PF_X, PF_W } from '../core/game';
import { text, wrap, textWidth } from '../art/font';
import { drawSprite, spriteCanvas, frameCount, SHEETS } from '../art/sprite';
import { KEY, col } from '../core/palette';
import { C, frame, bar, segBar, menu, scanlines, header, icon, rect, line, ring, disc, dither, arrow, keycap, hintRow, chamferFill, chamferLine, darkOf, lighter, keys, ticks, dimRect, type Device, type Row } from './draw';
import { logoWord, drawLogo, PINK, CYAN, GOLD } from './logo';
import { glyph } from './glyphs';
import { Touch } from './touch';

type Menu = 'none' | 'pause' | 'settings' | 'journal' | 'confirmQuit';
const RX = PF_X + PF_W;               // right panel x
const PW = W - RX;                    // panel width (128)
const TITLE_CATS = ['cat_tabby', 'cat_siamese', 'cat_calico', 'cat_sphynx'];
const DLG_H = 62;                     // dialogue box height (docked to the top of the playfield)
const SILHOUETTE: Record<string, string> = Object.fromEntries([...KEY].map(k => [k, '2']));
const POWERS: [string, string, string, string][] = [['double', 'pk_bone', 'X2', C.gold], ['spread', 'pk_chili', 'HOT', C.orange], ['shield', 'pk_bandana', 'SHLD', C.line], ['speed', 'pk_sneaker', 'ZOOM', C.lime]];

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

/** UI shell: HUD panels, title, sector map, pause, settings, dialogue box, ending, recovery, toasts. */
class UI implements Module {
  id = 'ui';
  api = this;
  g!: Game;
  t = 0; sel = 0; menuOpen: Menu = 'none'; settingsFrom: Menu | 'title' = 'pause';
  toasts: { text: string; t: number; age: number; y: number }[] = [];
  mapSel = 0; endingT = 0; shownScore = 0; lastHearts = -1; heartFlash = 0;
  chain = 0; bestChain = 0; lastBoop = -999; chainPop = 0;
  powMax: Record<string, number> = {}; waveCats = 0;
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
    g.bus.on('save:recovered', () => this.toast('SAVE PATCHED UP FROM BACKUP'));
    g.bus.on('cat:boop', () => {
      this.chain = g.tick - this.lastBoop <= 100 ? this.chain + 1 : 1; this.lastBoop = g.tick;
      this.bestChain = Math.max(this.bestChain, this.chain); this.chainPop = 8;
    });
    g.bus.on('wave:start', () => { this.waveCats = 0; });
    g.bus.on('player:nap', () => { this.chain = 0; });
    if (g.contentIssues.length) setTimeout(() => this.toast(`${g.contentIssues.length} CONTENT ISSUE(S): USING SAFE DEFAULTS`), 0);
    if (!g.headless) this.touch.attach(g);
  }
  toast(s: string) { this.toasts.push({ text: s, t: 170, age: 0, y: -1 }); if (this.toasts.length > 4) this.toasts.shift(); }
  openPause() { if (this.menuOpen === 'none') { this.menuOpen = 'pause'; this.sel = 0; this.g.paused = true; this.g.mods.audio?.sfx('select'); } }
  closeMenus() { this.menuOpen = 'none'; this.g.paused = false; }
  openMap() { this.g.setScene('map'); }
  showDialogue(id: string) { this.g.mods.quest?.dialogue(id); }
  dev(): Device { return this.g.input.lastDevice; }
  /** Fast-forward the whole open conversation (ESC / START / pause key during dialogue). */
  skipDialogue(g: Game) {
    const Q = g.mods.quest; if (!Q) return;
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
    for (const x of this.toasts) { x.t--; x.age++; } this.toasts = this.toasts.filter(x => x.t > 0);
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
    if (g.autopilot) { this.autopilotNav(g); return; }
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
        else if (it === 'JOURNAL') { this.menuOpen = 'journal'; this.settingsFrom = 'pause'; g.mods.journal?.open(); }
        else if (it === 'SETTINGS') { this.menuOpen = 'settings'; this.settingsFrom = 'pause'; this.sel = 0; }
        else if (it === 'SAVE & QUIT') { g.mods.save?.save(); this.closeMenus(); g.mods.interaction?.clearAll(); g.setScene('title'); }
      }
      return;
    }
    if (sc === 'dialogue' && I.pressed('pause')) { this.skipDialogue(g); return; }
    if ((sc === 'play' || sc === 'bonus' || sc === 'map') && I.pressed('pause')) { this.openPause(); return; }
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
  pauseItems() { return ['RESUME', 'JOURNAL', 'SETTINGS', 'SAVE & QUIT']; }

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
    const I = g.input; const s = g.state.settings; const n = 5;
    if (I.pressed('up')) { this.sel = (this.sel + n - 1) % n; g.mods.audio?.sfx('blip'); }
    if (I.pressed('down')) { this.sel = (this.sel + 1) % n; g.mods.audio?.sfx('blip'); }
    // left/right adjust; confirm also cycles toggles so a single button works on gamepad/touch
    let d = I.pressed('left') ? -1 : I.pressed('right') ? 1 : 0;
    if (!d && I.pressed('confirm') && this.sel >= 2 && this.sel <= 3) d = 1;
    if (d) {
      if (this.sel === 0) s.music = Math.max(0, Math.min(1, Math.round((s.music + d * 0.1) * 10) / 10));
      if (this.sel === 1) s.sfx = Math.max(0, Math.min(1, Math.round((s.sfx + d * 0.1) * 10) / 10));
      if (this.sel === 2) s.shake = !s.shake;
      if (this.sel === 3) s.touch = (['auto', 'on', 'off'] as const)[((['auto', 'on', 'off'].indexOf(s.touch) + d) + 3) % 3];
      g.mods.audio?.setVolumes(); g.mods.audio?.sfx('blip');
    }
    if (I.pressed('back') || I.pressed('pause') || (I.pressed('confirm') && this.sel === 4)) {
      g.mods.save?.save(); this.menuOpen = this.settingsFrom === 'title' ? 'none' : 'pause'; this.sel = this.settingsFrom === 'title' ? 3 : 2;
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
    if (I.pressed('up') || I.pressed('down')) { this.sel = 1 - this.sel; g.mods.audio?.sfx('blip'); }
    if (I.pressed('confirm')) {
      if (this.sel === 0) { const r = g.mods.save.load(); if (r === 'corrupt' || r === 'none') { g.mods.save.wipe(); g.setScene('title'); this.toast('STARTING FRESH. NO WORRIES!'); } }
      else { g.mods.save.wipe(); g.setScene('title'); this.toast('STARTING FRESH. NO WORRIES!'); }
    }
  }

  // ---------------- drawing ----------------
  overlay(g: Game, ctx: CanvasRenderingContext2D) {
    const sc = g.state.scene; this.rows = [];
    if (sc === 'play' || sc === 'bonus' || sc === 'dialogue') { this.hud(g, ctx); if (sc === 'dialogue') this.dialogueBox(g, ctx); }
    else if (sc === 'title') this.title(g, ctx);
    else if (sc === 'map') this.map(g, ctx);
    else if (sc === 'ending') this.ending(g, ctx);
    else if (sc === 'recovery') this.recovery(ctx);
    else if (sc === 'boot') { rect(ctx, 0, 0, W, H, C.bg); text(ctx, 'LOADING...', W / 2, H / 2, C.line, { align: 'center' }); }
    if (this.menuOpen === 'pause') this.pause(g, ctx);
    if (this.menuOpen === 'settings') this.settings(g, ctx);
    if (this.menuOpen === 'journal') g.mods.journal?.draw(g, ctx);
    this.drawToasts(ctx);
    this.touch.draw(g, ctx, this.t);
  }

  /** Toasts unfold horizontally from their own center at a fixed y (>= 8): never clipped by the screen edge. */
  drawToasts(ctx: CanvasRenderingContext2D) {
    const cx = PF_X + PF_W / 2;
    const top = this.g.state.scene === 'dialogue' ? DLG_H + 6 : 8;
    this.toasts.forEach((x, i) => {
      const target = top + i * 17;
      x.y = x.y < 0 ? target : x.y + Math.sign(target - x.y) * Math.min(2, Math.abs(target - x.y));
      const f = Math.min(1, x.age / 12, x.t / 10); const open = 1 - (1 - f) * (1 - f);
      const full = textWidth(x.text) + 30; const w = Math.max(14, Math.round(full * open)); const bx = Math.round(cx - w / 2);
      const y = Math.round(x.y);
      frame(ctx, bx, y, w, 14, C.hot, C.night, 4);
      if (open < 0.98) { rect(ctx, bx + 4, y + 6, w - 8, 1, C.hot); return; }
      icon(ctx, x.text.startsWith('MEMORY') ? 'photo' : x.text.startsWith('PUPPY') ? 'paw' : x.text.includes('QUEST') ? 'flag' : 'star', bx + 7, y + 4, C.gold);
      text(ctx, x.text, bx + 18, y + 4, (x.age >> 2) % 2 && x.age < 30 ? C.text : C.gold);
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
    // sweeping scan line (subtle animated detail)
    const sy = 8 + ((this.t >> 1) % (H - 16));
    dither(ctx, x + 4, sy, PW - 8, 1, darkOf(accent));
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
    text(ctx, String(Math.min(this.shownScore, 99999999)).padStart(8, '0'), x0 + 2, 61, C.text, { scale: 2, shadow: C.ink });
    icon(ctx, 'star', x0, 80, C.gold); text(ctx, 'HI', x0 + 10, 80, C.dim);
    text(ctx, String(s.hiScore).padStart(8, '0'), x0 + 26, 80, C.gold);
    header(ctx, 'HEARTS', x0, 94, w0, C.hot, t, s.hearts <= 1);
    const beat = s.hearts <= 1 && (t >> 4) % 2 === 0;
    for (let i = 0; i < s.maxHearts; i++) {
      const full = i < s.hearts; const hx = x0 + 8 + i * 13, hy = 109 + (full && beat && i === s.hearts - 1 ? -1 : 0);
      if (!full && this.heartFlash > 0 && i === s.hearts && (this.heartFlash >> 2) % 2) drawSprite(ctx, 'hud_heart', hx, hy, { flash: true });
      else drawSprite(ctx, full ? 'hud_heart' : 'hud_heart_empty', hx, hy);
    }
    // power-up bay: four fixed slots (lit when active, silhouettes when empty) + wingpup status
    header(ctx, 'POWER-UPS', x0, 122, w0, C.line, t);
    POWERS.forEach(([k, spr, nm, c], i) => {
      const left = P?.powers?.[k] ?? 0; const on = left > 0; const sx = x0 + i * 28, sy = 133;
      const low = on && left < 180 && (t >> 3) % 2;
      chamferFill(ctx, sx, sy, 24, 22, on ? C.night : C.ink, 3);
      chamferLine(ctx, sx, sy, 24, 22, on ? (low ? C.hot : c) : C.indigo, 3);
      if (on) { rect(ctx, sx + 3, sy + 1, 18, 1, darkOf(c)); drawSprite(ctx, spr, sx + 12, sy + 10); }
      else drawSprite(ctx, spr, sx + 12, sy + 10, { recolor: SILHOUETTE });
      // drain bar inside the slot base
      const p = on ? left / Math.max(1, this.powMax[k] ?? left) : 0;
      rect(ctx, sx + 3, sy + 18, 18, 2, C.plum); if (on) rect(ctx, sx + 3, sy + 18, Math.max(1, Math.round(18 * p)), 2, low ? C.hot : c);
      text(ctx, on ? `${Math.ceil(left / 60)}S` : nm, sx + 12, sy + 25, on ? c : C.indigo, { align: 'center' });
    });
    {
      const on = !!P?.buddy; const by = 168;
      chamferFill(ctx, x0, by, w0, 13, on ? C.night : C.ink, 3); chamferLine(ctx, x0, by, w0, 13, on ? C.burnt : C.indigo, 3);
      if (on) drawSprite(ctx, 'pup', x0 + 9, by + 6); else drawSprite(ctx, 'pup', x0 + 9, by + 6, { recolor: SILHOUETTE });
      text(ctx, 'WINGPUP', x0 + 19, by + 3, on ? C.gold : C.peri);
      rect(ctx, x0 + w0 - 40, by + 5, 3, 3, on ? ((t >> 4) % 2 ? C.lime : C.deep) : C.indigo);
      text(ctx, on ? 'ONLINE' : 'RESCUE', x0 + w0 - 4, by + 3, on ? C.lime : C.indigo, { align: 'right' });
    }
    // boop chain: consecutive boops within ~1.6s, with a decay bar
    header(ctx, 'BOOP CHAIN', x0, 186, w0, C.gold, t, this.chain > 1);
    {
      const by = 197; const live = this.chain > 0; const left = live ? Math.max(0, 100 - (g.tick - this.lastBoop)) / 100 : 0;
      chamferFill(ctx, x0, by, w0, 32, C.ink, 4); chamferLine(ctx, x0, by, w0, 32, live ? C.burnt : C.indigo, 4);
      const pop = this.chainPop > 4 ? -1 : 0;
      text(ctx, 'X', x0 + 7, by + 13 + pop, live ? C.gold : C.indigo);
      text(ctx, String(Math.min(999, this.chain)), x0 + 14, by + 7 + pop, live ? C.gold : C.indigo, { scale: 2, shadow: live ? C.burnt : undefined });
      const rx = x0 + 58;
      text(ctx, 'BEST', rx, by + 6, C.dim); text(ctx, String(this.bestChain), x0 + w0 - 6, by + 6, C.text, { align: 'right' });
      segBar(ctx, rx, by + 18, 8, 4, 3, left, left < 0.35 ? C.hot : C.gold, C.plum);
      text(ctx, live ? '' : 'BOOP!', rx, by + 24, C.indigo);
    }
    if (!touch) {
      // flight stats
      header(ctx, 'STATS', x0, 238, w0, C.violet, t);
      const acc = s.stats.shots ? Math.round(100 * s.stats.hits / s.stats.shots) : 0;
      icon(ctx, 'cat', x0, 250, C.hot); text(ctx, 'BOOPS', x0 + 10, 250, C.dim); text(ctx, String(s.stats.catsBooped), x0 + w0, 250, C.text, { align: 'right' });
      icon(ctx, 'star', x0, 262, C.gold); text(ctx, 'AIM', x0 + 10, 262, C.dim); text(ctx, `${acc}%`, x0 + w0, 262, C.text, { align: 'right' });
      segBar(ctx, x0, 273, 18, 5, 2, acc / 100, C.violet);
      // controls block (device-aware); hidden while the touch deck occupies this space
      const k = keys(this.dev());
      header(ctx, 'CONTROLS', x0, 288, w0, C.line, t);
      const rows: [string, string][] = [[k.move, 'FLY'], [k.fire, 'TOOT'], [k.pause, 'PAUSE']];
      rows.forEach(([key, cap], i) => { const kw = keycap(ctx, key, x0, 302 + i * 14, C.line); text(ctx, cap, x0 + kw + 5, 302 + i * 14, C.pale); });
    }
    // ===== right panel =====
    this.panel(ctx, RX, accR);
    const x1 = RX + 10;
    const B0 = g.mods.interaction?.boss;
    if (A) {
      const idx = g.content.areas.indexOf(A);
      header(ctx, `SECTOR ${String(idx + 1).padStart(2, '0')}`, x1, 12, w0, accR, t, true);
      // two lines are always reserved for the sector name; both lines share one left edge
      const nl = wrap(A.name.toUpperCase(), 18);
      (nl.length > 2 ? [nl[0], nl.slice(1).join(' ').slice(0, 17) + '.'] : nl).forEach((l, i) => text(ctx, l, x1, 23 + i * 9, C.text, { shadow: C.ink }));
      const tot = A.waves.length + (A.boss ? 1 : 0); const cur = Math.min(tot, s.waveIndex + 1);
      header(ctx, 'WAVE', x1, 46, w0, C.hot, t);
      if (B0) text(ctx, 'BIG CAT', x1, 57, (t >> 4) % 2 ? C.hot : C.pink, { scale: 2, shadow: C.ink });
      else {
        // number and total share one baseline and one font tier
        const a = String(cur), b = `/${tot}`;
        text(ctx, a, x1, 57, C.line, { scale: 2, shadow: C.ink });
        text(ctx, b, x1 + textWidth(a, 2) + 3, 57, C.peri, { scale: 2, shadow: C.ink });
        // live hostiles count, right-aligned on the same row
        const live = (g.mods.interaction?.cats ?? []).length;
        icon(ctx, 'cat', x1 + w0 - 30, 61, live ? C.hot : C.indigo); text(ctx, String(live).padStart(2, '0'), x1 + w0 - 2, 61, live ? C.text : C.indigo, { align: 'right' });
      }
      const cw = Math.max(4, Math.min(12, Math.floor((w0 - (tot - 1)) / Math.max(1, tot))));
      for (let i = 0; i < tot; i++) {
        const done = i < s.waveIndex, curw = i === s.waveIndex; const bossCell = A.boss && i === tot - 1;
        const c = done ? C.line : curw ? ((t >> 3) % 2 ? C.hot : C.pink) : C.plum;
        chamferFill(ctx, x1 + i * (cw + 1), 75, cw, 5, c, 1);
        if (bossCell && !done) rect(ctx, x1 + i * (cw + 1) + (cw >> 1) - 1, 76, 2, 3, curw ? C.text : C.hot);
      }
    }
    header(ctx, 'RESCUED', x1, 88, w0, C.gold, t);
    chamferFill(ctx, x1, 98, 52, 18, C.night, 2); drawSprite(ctx, 'pup', x1 + 9, 107);
    text(ctx, `X${s.inventory.pups ?? 0}`, x1 + 20, 103, C.gold);
    chamferFill(ctx, x1 + 56, 98, w0 - 56, 18, C.night, 2); drawSprite(ctx, 'pk_memory', x1 + 65, 107);
    text(ctx, `${s.memories.length}/${g.content.memories.length}`, x1 + 76, 103, C.text);
    header(ctx, 'QUEST', x1, 122, w0, C.violet, t);
    const q = g.content.quests.find(q => s.quests[q.id] === 'active');
    if (q) {
      icon(ctx, 'flag', x1, 133, C.violet);
      wrap(q.name.toUpperCase(), 16).slice(0, 2).forEach((l, i) => text(ctx, l, x1 + 10, 133 + i * 9, C.violet));
      const pr = g.mods.quest?.progress?.(q);
      if (pr && pr.need > 1) { segBar(ctx, x1 + 10, 153, 10, 5, 3, pr.have / pr.need, C.violet); text(ctx, `${pr.have}/${pr.need}`, x1 + w0, 151, C.dim, { align: 'right' }); }
      else { text(ctx, 'IN PROGRESS', x1 + 10, 151, C.peri); for (let i = 0; i < 3; i++) rect(ctx, x1 + 78 + i * 4, 156, 2, 2, ((t >> 4) % 4) > i ? C.violet : C.plum); }
    } else { icon(ctx, 'star', x1, 133, C.peri); text(ctx, 'ALL CLEAR', x1 + 10, 133, C.peri); }
    // threat block: boss bar, bonus tally, or live breed roster
    if (B0) {
      header(ctx, 'BIG CAT', x1, 166, w0, C.hot, t, true);
      icon(ctx, 'cat', x1, 177, C.hot);
      const nm = wrap(B0.def.name.toUpperCase(), 16);
      (nm.length > 2 ? [nm[0], nm.slice(1).join(' ').slice(0, 15) + '.'] : nm).forEach((l: string, i: number) => text(ctx, l, x1 + 10, 177 + i * 9, C.text));
      const p = B0.hp / B0.maxHp;
      chamferFill(ctx, x1 - 1, 198, w0 + 2, 9, C.ink, 2);
      bar(ctx, x1 + 1, 200, w0 - 2, 5, p, p < 0.3 && (t >> 3) % 2 ? C.pink : C.hot);
      for (let i = 1; i < 10; i++) rect(ctx, x1 + 1 + Math.round(i * (w0 - 2) / 10), 200, 1, 5, C.ink);
      text(ctx, `${Math.ceil(p * 100)}%`, x1 + w0, 211, C.hot, { align: 'right' }); text(ctx, 'ARMOR', x1, 211, C.dim);
    } else if (g.state.scene === 'bonus') {
      header(ctx, 'BONANZA', x1, 166, w0, C.gold, t, true);
      const b = g.mods.interaction?.bonus;
      if (b) { icon(ctx, 'gift', x1, 178, C.gold); text(ctx, `${b.hits} / ${b.total}`, x1 + 10, 178, C.text); segBar(ctx, x1, 190, 20, 4, 3, b.hits / Math.max(1, b.total), C.gold); text(ctx, 'TREATS CAUGHT', x1, 200, C.dim); }
    } else this.roster(g, ctx, x1, 166, w0);
    if (!touch) this.radar(g, ctx, x1, 226, w0, 54, accS);
    if (!touch) {
      const night = s.tod === 'night', tc = night ? C.violet : s.tod === 'dusk' ? C.pink : s.tod === 'dawn' ? C.orange : C.gold;
      header(ctx, 'LOCAL TIME', x1, 288, w0, tc, t);
      icon(ctx, night || s.tod === 'dusk' ? 'moon' : 'sun', x1, 300, tc); text(ctx, s.tod.toUpperCase(), x1 + 10, 300, tc);
      // day-cycle strip: four phases, current one lit
      (['dawn', 'day', 'dusk', 'night'] as const).forEach((p, i) => rect(ctx, x1 + 60 + i * 12, 302, 10, 3, p === s.tod ? tc : C.plum));
      const mm = Math.floor(s.stats.playTicks / 3600), ss = Math.floor(s.stats.playTicks / 60) % 60;
      header(ctx, 'FLIGHT TIME', x1, 316, w0, C.line, t);
      icon(ctx, 'clock', x1, 328, C.line);
      text(ctx, `${String(mm).padStart(2, '0')}${(t >> 5) % 2 ? ':' : ' '}${String(ss).padStart(2, '0')}`, x1 + 10, 328, C.text);
    }
    // playfield frame edges: bright inner line, dark outer glow, tick marks
    rect(ctx, PF_X - 1, 0, 1, H, C.deep); rect(ctx, PF_X, 0, 1, H, C.line);
    rect(ctx, RX - 1, 0, 1, H, C.line); rect(ctx, RX, 0, 1, H, C.deep);
    const off = (t >> 2) % 16;
    for (let yy = -16 + off; yy < H; yy += 16) { rect(ctx, PF_X + 1, yy, 2, 1, C.deep); rect(ctx, RX - 3, yy, 2, 1, C.deep); }
  }
  /** Live breed roster: up to four breeds with tinted icons and counts, plus a wave-remaining bar. */
  roster(g: Game, ctx: CanvasRenderingContext2D, x: number, y: number, w: number) {
    const cats = (g.mods.interaction?.cats ?? []) as { def?: { id: string; name: string; sprite: string } }[];
    header(ctx, 'HOSTILES', x, y, w, C.hot, this.t, cats.length > 0);
    const by: Record<string, { n: number; name: string; sprite: string }> = {};
    for (const c of cats) { const d = c.def; if (!d) continue; (by[d.id] ??= { n: 0, name: d.name, sprite: d.sprite }).n++; }
    const list = Object.values(by).sort((a, b) => b.n - a.n).slice(0, 4);
    if (!list.length) {
      chamferFill(ctx, x, y + 11, w, 22, C.ink, 3); chamferLine(ctx, x, y + 11, w, 22, C.indigo, 3);
      text(ctx, 'SKIES CLEAR', x + w / 2, y + 19, C.peri, { align: 'center' });
    }
    list.slice(0, 3).forEach((e, i) => {
      const cy = y + 12 + i * 9;
      icon(ctx, 'cat', x, cy, breedColor(e.sprite), C.ink);
      text(ctx, e.name.toUpperCase().slice(0, 13), x + 10, cy, C.dim);
      text(ctx, String(e.n), x + w, cy, C.text, { align: 'right' });
    });
    if (list.length > 3) text(ctx, `+${list.length - 3}`, x + w - 16, y + 30, C.peri, { align: 'right' });
    const tot = Math.max(1, this.waveCats);
    if (cats.length || this.waveCats) { segBar(ctx, x, y + 41, 14, 5, 3, cats.length / tot, C.hot); text(ctx, 'LEFT', x + w, y + 39, C.dim, { align: 'right' }); }
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
    return /pom|poodle/i.test(p + ' ' + (node.speaker ?? '')) ? 'poodle' : 'pup';
  }
  /** Dialogue: a compact comm panel docked flush to the top of the playfield, so Pom stays visible. */
  dialogueBox(g: Game, ctx: CanvasRenderingContext2D) {
    const d = g.mods.quest?.dlg; if (!d) return;
    const t = this.t;
    const isPom = /pom/i.test(d.node.speaker); const isBoss = /empress|boss|sergeant|madame|duchess/i.test(d.node.speaker + (d.node.portrait ?? ''));
    const accent = isPom ? C.pink : isBoss ? C.hot : C.line;
    const x = PF_X + 1, w = PF_W - 2, y = 0, h = DLG_H;
    // solid backing flush with the playfield edges (no world pixels peek through the chamfers)
    rect(ctx, x, y, w, h + 2, C.ink);
    frame(ctx, x + 1, y + 1, w - 2, h, accent, C.night, 5);
    scanlines(ctx, x + 3, y + 3, w - 6, h - 4);
    rect(ctx, x, y + h + 1, w, 1, darkOf(accent));
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
    const sw = keycap(ctx, k.skip, hx - textWidth('SKIP') - 4, y + 7, C.peri, 'right'); text(ctx, 'SKIP', hx, y + 7, C.peri, { align: 'right' });
    const nx = hx - textWidth('SKIP') - 4 - sw - 10;
    const nextLbl = done ? 'NEXT' : 'FAST';
    const bob = done && (t >> 3) % 2 ? 1 : 0;
    const nw = keycap(ctx, k.next, nx - textWidth(nextLbl) - 4, y + 7 + bob, done ? C.gold : C.line, 'right'); text(ctx, nextLbl, nx, y + 7, done ? C.gold : C.dim, { align: 'right' });
    const ruleL = tx + 6 + textWidth(nm) + 5, ruleR = nx - textWidth(nextLbl) - 4 - nw - 6;
    if (ruleR > ruleL) dither(ctx, ruleL, y + 10, ruleR - ruleL, 1, darkOf(accent));
    // body: max three lines
    const lines = wrap(d.node.text.slice(0, Math.floor(d.chars)), 51).slice(0, 3);
    lines.forEach((l, i) => text(ctx, l, tx, y + 20 + i * 11, C.text, { shadow: C.ink }));
    if (!done && (t >> 2) % 2) rect(ctx, tx + (lines.length ? textWidth(lines[lines.length - 1]) + 2 : 0), y + 20 + Math.max(0, lines.length - 1) * 11, 4, 7, accent);
    if (done) arrow(ctx, x + w - 12, y + h - 7 + bob, 'd', 3, C.gold);
  }

  // ---------------- title ----------------
  title(g: Game, ctx: CanvasRenderingContext2D) {
    const t = this.t; const HZ = 214;
    rect(ctx, 0, 0, W, H, C.bg);
    for (let i = 0; i < 110; i++) {
      const x = (i * 97 + (i >> 3) * 13) % W, y = Math.floor((i * 53 + t * (0.15 + (i % 3) * 0.2)) % HZ);
      const tw = (i * 7 + (t >> 3)) % 23 === 0;
      rect(ctx, x, y, 1, 1, tw ? C.text : i % 5 ? C.indigo : C.peri);
    }
    // synthwave sun: large banded disc with dithered band transitions, slatted near the horizon
    const sx = W / 2, sr = 92;
    const bands = [C.cream, C.gold, C.orange, C.hot, C.mag];
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
      // ordered dither into the next band over the last 40% of each band
      if (frac > 0.6 && bi + 1 < bands.length) dither(ctx, sx - dx, yy, dx * 2 + 1, 1, bands[bi + 1], frac > 0.8 ? 'check' : 'sparse');
    }
    // ground: perspective grid scrolling toward the viewer
    rect(ctx, 0, HZ, W, H - HZ, C.ink);
    rect(ctx, 0, HZ, W, 1, C.hot);
    const ph = (t % 40) / 40;
    for (let k = 0; k < 14; k++) {
      const z = k + ph; const y = Math.round(HZ + 2 + z * z * 0.85);
      if (y >= H) break;
      rect(ctx, 0, y, W, 1, z < 3 ? C.plum : C.purple);
      if (z < 3) dither(ctx, 0, y, W, 1, C.indigo);
    }
    for (let i = -16; i <= 16; i++) line(ctx, W / 2 + i * 10, HZ + 1, W / 2 + i * 64, H, Math.abs(i) < 6 ? C.purple : C.plum);
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
    chamferFill(ctx, W / 2 - tw / 2, 104 + bob, tw, 13, C.mag, 4); chamferFill(ctx, W / 2 - tw / 2 + 1, 104 + bob, tw - 2, 12, C.hot, 4);
    text(ctx, tag, W / 2, 107 + bob, C.text, { align: 'center', shadow: C.mag });
    // hero + a symmetric V of cats swooping in (speed trails show the motion)
    const pyy = 172 + Math.round(Math.sin(t / 12) * 3);
    drawSprite(ctx, 'poodle', W / 2, pyy, { frame: (t >> 3) % 2 });
    TITLE_CATS.forEach((b, i) => {
      const side = i < 2 ? -1 : 1, k = i < 2 ? 1 - i : i - 2; // k=0 inner, 1 outer
      const sway = Math.round(Math.sin(t / 20 + k) * 4);
      const x = W / 2 + side * (120 + k * 82) + side * sway, y = 140 + k * 26 + Math.round(Math.sin(t / 15 + k * 1.3) * 3);
      // trail: stepped dither streaks behind the cat, angled away from Pom
      for (let j = 0; j < 4; j++) {
        const tx = x + side * (10 + j * 9), ty = y - 8 - j * 5;
        rect(ctx, tx - 3, ty, 7 - j, 1, j < 2 ? C.purple : C.plum);
        if (j < 3) dither(ctx, tx - 3, ty + 2, 6 - j, 1, C.indigo);
      }
      drawSprite(ctx, b, x, y, { frame: ((t >> 4) + i) % 2 });
    });
    // menu: chamfered neon frame with targeting ticks, like the HUD
    const items = this.titleItems(); const off = this.titleDisabled();
    const mh = items.length * 15 + 14; const my = 230; const mw = 176, mx = W / 2 - mw / 2;
    frame(ctx, mx, my, mw, mh, C.line, C.night, 6);
    scanlines(ctx, mx + 2, my + 2, mw - 4, mh - 4);
    ticks(ctx, mx, my, mw, mh, (t >> 4) % 2 ? C.line : C.deep, 7, 3);
    this.rows = menu(ctx, items, this.sel, W / 2, my + 9, t, 15, ['play', 'new', 'book', 'gear'], 158, { disabled: off, tag: off.map(x => x ? 'NO SAVE' : '') });
    const hs = `HI-SCORE ${String(g.state.hiScore).padStart(8, '0')}`; const hx = Math.round(W / 2 - (textWidth(hs) + 10) / 2);
    chamferFill(ctx, hx - 6, my + mh + 6, textWidth(hs) + 22, 13, C.ink, 3); chamferLine(ctx, hx - 6, my + mh + 6, textWidth(hs) + 22, 13, C.burnt, 3);
    icon(ctx, 'star', hx, my + mh + 9, C.gold); text(ctx, hs, hx + 10, my + mh + 9, C.dim);
    const k = keys(this.dev());
    hintRow(ctx, [[k.move, 'CHOOSE'], [k.ok, 'SELECT']], W / 2, 346, C.line);
  }

  // ---------------- sector map ----------------
  map(g: Game, ctx: CanvasRenderingContext2D) {
    const t = this.t; const T0 = 46, B0 = 276;
    rect(ctx, 0, 0, W, H, C.bg);
    // dithered nebula clouds (deterministic blobs)
    const blobs: [number, number, number, number, string][] = [[150, 110, 120, 50, C.purple], [470, 210, 150, 56, C.plum], [330, 90, 90, 34, C.deep], [80, 230, 90, 40, C.deep], [560, 100, 80, 40, C.plum]];
    for (const [bx, by, rx, ry, c] of blobs) for (let dy = -ry; dy <= ry; dy++) {
      const f = 1 - (dy * dy) / (ry * ry); const dx = Math.round(rx * Math.sqrt(f) * (0.85 + 0.15 * Math.sin(dy * 0.4 + bx)));
      dither(ctx, bx - dx, by + dy, dx * 2, 1, c, 'sparse');
      if (f > 0.55) { const ix = Math.round(dx * 0.55); dither(ctx, bx - ix, by + dy, ix * 2, 1, c, 'check'); }
    }
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
    text(ctx, 'SECTOR MAP', W / 2, 12, C.line, { align: 'center', scale: 2, shadow: C.deep });
    text(ctx, 'CHOOSE YOUR NEXT FLIGHT PATH', W / 2, 29, C.dim, { align: 'center' });
    rect(ctx, 20, 18, 4, 4, (t >> 4) % 2 ? C.hot : C.mag); text(ctx, 'LIVE', 28, 17, C.hot);
    // legend
    rect(ctx, 20, 30, 3, 3, C.hot); text(ctx, 'BIG CAT', 26, 29, C.peri);
    rect(ctx, 76, 32, 1, 1, C.lime); rect(ctx, 77, 33, 1, 1, C.lime); rect(ctx, 78, 32, 1, 1, C.lime); rect(ctx, 79, 31, 1, 1, C.lime); text(ctx, 'CLEAR', 83, 29, C.peri);
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
      line(ctx, p1[0], p1[1], p2[0], p2[1], c, e.when ? [2, 3] : live ? [4, 2] : undefined, live ? -(t >> 1) : 0);
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
      if (cleared && !isHere) { chamferFill(ctx, bx + 15, by + 15, 8, 8, C.ink, 2); rect(ctx, bx + 17, by + 19, 1, 1, C.lime); rect(ctx, bx + 18, by + 20, 1, 1, C.lime); rect(ctx, bx + 19, by + 19, 1, 1, C.lime); rect(ctx, bx + 20, by + 18, 1, 1, C.lime); }
      if (a.boss && !cleared) { rect(ctx, bx - 1, by - 1, 5, 5, C.ink); rect(ctx, bx, by, 3, 3, sel ? C.gold : C.hot); }
      text(ctx, String(idx + 1).padStart(2, '0'), p[0], p[1] + 15, sel ? C.gold : isHere ? C.hot : cleared ? C.line : C.peri, { align: 'center', shadow: C.ink });
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
      parts.push([a.tod === 'night' || a.tod === 'dusk' ? 'moon' : 'sun', a.tod.toUpperCase(), a.tod === 'night' ? C.violet : C.gold]);
      const pw = parts.reduce((s, [, l]) => s + textWidth(l) + 10, 0) + (parts.length - 1) * 12;
      let x = Math.round(W / 2 - pw / 2);
      for (const [ic, l, c] of parts) { icon(ctx, ic, x, by + 35, c); text(ctx, l, x + 10, by + 35, C.pale); x += textWidth(l) + 22; }
      const k = keys(this.dev());
      hintRow(ctx, [[k.adj, 'ROUTE'], [k.ok, 'LAUNCH'], [k.pause, 'MENU']], W / 2, by + 53, C.line);
    }
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
    const mid = 160, amp = 52;
    for (const [d, ids] of Object.entries(cols)) {
      const k = +d; const yc = mid + Math.round(Math.sin(k * 1.25 + 0.6) * (ids.length > 1 ? amp * 0.4 : amp));
      ids.forEach((id, i) => { out[id] = [Math.round(40 + (k / Math.max(1, maxD)) * (W - 80)), Math.max(70, Math.min(256, Math.round(yc + (i - (ids.length - 1) / 2) * 84)))]; });
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
    const items = this.pauseItems(); const w = 196, h = 182; const x = Math.round(W / 2 - w / 2), y = 82;
    frame(ctx, x, y, w, h, C.line, C.night, 8);
    scanlines(ctx, x + 2, y + 2, w - 4, h - 4);
    ticks(ctx, x, y, w, h, C.deep, 8, 3);
    chamferFill(ctx, x + 10, y - 8, w - 20, 26, C.ink, 5); chamferLine(ctx, x + 10, y - 8, w - 20, 26, C.deep, 5);
    text(ctx, 'PAUSED', W / 2, y - 2, C.line, { align: 'center', scale: 2, shadow: C.deep });
    const A = g.mods.world?.area();
    if (A) text(ctx, A.name.toUpperCase(), W / 2, y + 26, C.dim, { align: 'center' });
    rect(ctx, x + 16, y + 38, w - 32, 1, C.indigo);
    this.rows = menu(ctx, items, this.sel, W / 2, y + 52, this.t, 20, ['play', 'book', 'gear', 'disk'], w - 28);
    rect(ctx, x + 16, y + 132, w - 32, 1, C.indigo);
    text(ctx, 'PROGRESS SAVES EVERY WAVE', W / 2, y + 140, C.peri, { align: 'center' });
    const k = keys(this.dev());
    hintRow(ctx, [[k.ok, 'SELECT'], [k.back, 'RESUME']], W / 2, y + h - 18, C.line);
  }
  settings(g: Game, ctx: CanvasRenderingContext2D) {
    const s = g.state.settings;
    this.dim(ctx);
    const w = 280, h = 196; const x = Math.round(W / 2 - w / 2), y = 76;
    frame(ctx, x, y, w, h, C.violet, C.night, 8);
    scanlines(ctx, x + 2, y + 2, w - 4, h - 4);
    ticks(ctx, x, y, w, h, C.purple, 8, 3);
    chamferFill(ctx, x + 40, y - 8, w - 80, 26, C.ink, 5); chamferLine(ctx, x + 40, y - 8, w - 80, 26, C.purple, 5);
    text(ctx, 'SETTINGS', W / 2, y - 2, C.violet, { align: 'center', scale: 2, shadow: C.purple });
    const rows: [string, string][] = [['MUSIC', 'note'], ['SFX', 'speaker'], ['SCREEN SHAKE', 'shake'], ['TOUCH CONTROLS', 'hand'], ['BACK', 'back']];
    this.rows = [];
    rows.forEach(([k, ic], i) => {
      const on = i === this.sel; const yy = y + 30 + i * 26; const rx = x + 14, rw = w - 28;
      this.rows.push({ x: rx, y: yy - 6, w: rw, h: 22 });
      if (on) { chamferFill(ctx, rx, yy - 5, rw, 18, C.plum, 4); chamferLine(ctx, rx, yy - 5, rw, 18, C.purple, 4); rect(ctx, rx + 1, yy - 1, 1, 10, C.violet); }
      icon(ctx, ic, rx + 8, yy, on ? C.gold : C.peri);
      text(ctx, k, rx + 20, yy, on ? C.gold : C.text, { shadow: C.ink });
      const vx = rx + rw - 8;
      if (i <= 1) {
        const v = i === 0 ? s.music : s.sfx;
        segBar(ctx, vx - 99, yy, 10, 8, 7, v, on ? C.gold : C.violet, C.ink);
        text(ctx, String(Math.round(v * 10)), vx - 104, yy, on ? C.gold : C.dim, { align: 'right' });
      } else if (i === 2) {
        this.pill(ctx, vx, yy, ['OFF', 'ON'], s.shake ? 1 : 0, on);
      } else if (i === 3) {
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
  ending(g: Game, ctx: CanvasRenderingContext2D) {
    const e = g.content.endings.find(x => x.id === g.state.ending) ?? g.content.endings[0];
    const T = this.endingT;
    rect(ctx, 0, 0, W, H, C.bg);
    const lines = e.text.flatMap(t => [...wrap(t, 58), '']).slice(0, -1);
    const ph = Math.min(176, lines.length * 11 + 14);
    const statY = 112 + ph + 10;
    // decor stays out of the story panel, the stat chips and the parade disc
    const keep: [number, number, number, number][] = [[PF_X - 6, 104, PF_W + 12, ph + 16], [W / 2 - 192, statY - 12, 384, 46], [W / 2 - 26, 56, 52, 50], [W / 2 - 110, 8, 220, 40]];
    const free = (x: number, y: number) => !keep.some(([kx, ky, kw, kh]) => x > kx - 8 && x < kx + kw && y > ky - 8 && y < ky + kh);
    for (let i = 0; i < 90; i++) { const x = (i * 97) % W, y = Math.floor((i * 53 + T * 0.2 * (1 + i % 3)) % H); if (free(x, y)) rect(ctx, x, y, 1, 1, i % 4 ? C.indigo : (i + (T >> 3)) % 7 ? C.gold : C.text); }
    for (let i = 0; i < 14; i++) { const x = (i * 47 + 20) % W, y = (i * 29 + (T >> 1) * (1 + i % 2)) % (H + 20) - 10; if (free(x, y)) icon(ctx, i % 3 ? 'heart' : 'star', x, y, i % 2 ? C.mag : C.purple); }
    const title = e.title.toUpperCase();
    const allLogo = [...title].every(ch => ch === ' ' || 'PODLEATR'.includes(ch));
    if (allLogo && title.length <= 14) drawLogo(ctx, logoWord(title.replace(/ /g, ''), 2, GOLD, 3, 2, 3), W / 2, 16);
    else {
      const tw = textWidth(title, 2) + 32;
      chamferFill(ctx, W / 2 - tw / 2, 14, tw, 26, C.ink, 6); chamferLine(ctx, W / 2 - tw / 2, 14, tw, 26, C.burnt, 6);
      text(ctx, title, W / 2, 20, C.gold, { align: 'center', scale: 2, shadow: C.burnt });
    }
    disc(ctx, W / 2, 80, 18, C.night); ring(ctx, W / 2, 80, 18, C.burnt); ring(ctx, W / 2, 80, 19, C.burnt, [2, 2], T >> 2);
    drawSprite(ctx, 'poodle', W / 2, 78 + ((T >> 4) % 2), { frame: (T >> 3) % 2 });
    const pups = g.state.inventory.pups ?? 0; const n = Math.min(8, pups);
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1, k = (i >> 1) + 1;
      drawSprite(ctx, 'pup', W / 2 + side * (18 + k * 20), 90 + Math.round(Math.sin(T / 10 + i) * 2));
    }
    const shown = Math.floor(T / 40);
    frame(ctx, PF_X + 2, 112, PF_W - 4, ph, C.gold, C.night, 6);
    lines.slice(0, shown + 1).forEach((l, i) => { if (120 + i * 11 < 112 + ph - 8) text(ctx, l, W / 2, 120 + i * 11, C.text, { align: 'center', shadow: C.ink }); });
    const s = g.state;
    if (shown > lines.length) {
      const stats: [string, string, string][] = [['star', `${s.score} PTS`, C.gold], ['cat', `${s.stats.catsBooped} BOOPED`, C.hot], ['paw', `${pups} PUPS`, C.line], ['photo', `${s.memories.length}/${g.content.memories.length}`, C.violet], ['clock', `${Math.floor(s.stats.playTicks / 3600)} MIN`, C.pale], ['moon', `${s.stats.naps} NAPS`, C.dim]];
      const cw = 124, cols = 3;
      stats.forEach(([ic, l, c], i) => {
        const cx = W / 2 - (cols * cw) / 2 + (i % cols) * cw, cy = statY + Math.floor(i / cols) * 18;
        chamferFill(ctx, cx + 4, cy - 4, cw - 8, 15, C.night, 3); chamferLine(ctx, cx + 4, cy - 4, cw - 8, 15, darkOf(c), 3);
        icon(ctx, ic, cx + 12, cy, c); text(ctx, l, cx + 24, cy, C.text);
      });
    }
    if (T > 240 && (this.t >> 4) % 2) hintRow(ctx, [[keys(this.dev()).ok, 'CONTINUE']], W / 2, 344, C.gold);
  }
  recovery(ctx: CanvasRenderingContext2D) {
    const t = this.t;
    rect(ctx, 0, 0, W, H, C.bg);
    for (let y = 0; y < H; y += 16) for (let x = 0; x < W; x += 16) rect(ctx, x, y, 1, 1, C.night);
    const w = 340, h = 160, x = Math.round(W / 2 - w / 2), y = 96;
    frame(ctx, x, y, w, h, C.hot, C.night, 8);
    scanlines(ctx, x + 2, y + 2, w - 4, h - 4);
    ticks(ctx, x, y, w, h, C.mag, 8, 3);
    chamferFill(ctx, x + 70, y - 8, w - 140, 18, C.hot, 5); text(ctx, 'SAVE RECOVERY', W / 2, y - 3, C.ink, { align: 'center' });
    // the culprit in a solid 2px medallion, with the chewed floppy pinned on as a badge
    const mx = W / 2, my = y + 38;
    disc(ctx, mx, my, 22, C.ink); ring(ctx, mx, my, 22, C.mag); ring(ctx, mx, my, 21, C.hot); ring(ctx, mx, my, 25, C.plum, [3, 3], t >> 3);
    for (const [dx, dy] of [[0, -23], [0, 22], [-23, 0], [22, 0]]) rect(ctx, mx + dx, my + dy, 2, 2, C.pink);
    drawSprite(ctx, 'cat_tabby', mx + ((t >> 5) % 2 ? 1 : -1), my, { frame: (t >> 4) % 2 });
    const bx = mx + 12, by = my + 9;
    chamferFill(ctx, bx, by, 15, 15, C.ink, 3); chamferLine(ctx, bx, by, 15, 15, C.gold, 3);
    icon(ctx, 'disk', bx + 4, by + 4, C.pale);
    text(ctx, 'UH OH! A CAT CHEWED YOUR SAVE.', W / 2, y + 70, C.gold, { align: 'center', shadow: C.burnt });
    text(ctx, 'NOTHING IS BROKEN. PICK AN OPTION:', W / 2, y + 83, C.text, { align: 'center' });
    this.rows = menu(ctx, ['TRY BACKUP SAVE', 'START FRESH'], this.sel, W / 2, y + 102, t, 19, ['retry', 'new'], 200, { center: true });
    const k = keys(this.dev());
    hintRow(ctx, [[k.move, 'CHOOSE'], [k.ok, 'CONFIRM']], W / 2, y + h - 14, C.hot);
  }
}
export const makeUI = (): Module => new UI();
