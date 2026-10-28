import type { Game, Module } from '../core/game';
import { W, H, PF_X, PF_W } from '../core/game';
import { text, wrap, textWidth } from '../art/font';
import { drawSprite, spriteCanvas, frameCount, SHEETS } from '../art/sprite';
import { C, frame, bar, segBar, menu, scanlines, header, icon, rect, line, ring, disc, dither, arrow, keycap, hintRow, chamferFill, chamferLine, darkOf, keys, type Device } from './draw';
import { logoWord, drawLogo, PINK, CYAN, GOLD } from './logo';
import { Touch } from './touch';

type Menu = 'none' | 'pause' | 'settings' | 'journal' | 'confirmQuit';
const RX = PF_X + PF_W;               // right panel x
const PW = W - RX;                    // panel width (128)
const TITLE_CATS = ['cat_tabby', 'cat_siamese', 'cat_calico', 'cat_sphynx'];

/** UI shell: HUD panels, title, sector map, pause, settings, dialogue box, ending, recovery, toasts. */
class UI implements Module {
  id = 'ui';
  api = this;
  g!: Game;
  t = 0; sel = 0; menuOpen: Menu = 'none'; settingsFrom: Menu | 'title' = 'pause';
  toasts: { text: string; t: number; age: number }[] = [];
  mapSel = 0; endingT = 0; shownScore = 0; lastHearts = -1; heartFlash = 0;
  touch = new Touch();

  init(g: Game) {
    this.g = g;
    g.toastFn = (s) => this.toast(s);
    g.bus.on('scene:change', (p: any) => { this.sel = 0; this.mapSel = 0; if (p.to === 'ending') this.endingT = 0; if (p.to !== 'play' && p.to !== 'bonus') this.menuOpen = this.menuOpen === 'journal' ? 'journal' : 'none'; });
    g.bus.on('save:recovered', () => this.toast('SAVE PATCHED UP FROM BACKUP'));
    if (g.contentIssues.length) setTimeout(() => this.toast(`${g.contentIssues.length} CONTENT ISSUE(S): USING SAFE DEFAULTS`), 0);
    if (!g.headless) this.touch.attach(g);
  }
  toast(s: string) { this.toasts.push({ text: s, t: 170, age: 0 }); if (this.toasts.length > 4) this.toasts.shift(); }
  openPause() { if (this.menuOpen === 'none') { this.menuOpen = 'pause'; this.sel = 0; this.g.paused = true; this.g.mods.audio?.sfx('select'); } }
  closeMenus() { this.menuOpen = 'none'; this.g.paused = false; }
  openMap() { this.g.setScene('map'); }
  showDialogue(id: string) { this.g.mods.quest?.dialogue(id); }
  dev(): Device { return this.g.input.lastDevice; }

  update(g: Game) {
    this.t++;
    for (const x of this.toasts) { x.t--; x.age++; } this.toasts = this.toasts.filter(x => x.t > 0);
    // rolling score counter + heart-loss flash
    const s = g.state; const diff = s.score - this.shownScore;
    this.shownScore = diff <= 0 ? s.score : this.shownScore + Math.max(1, Math.ceil(diff / 6));
    if (this.lastHearts >= 0 && s.hearts < this.lastHearts) this.heartFlash = 40;
    this.lastHearts = s.hearts; if (this.heartFlash > 0) this.heartFlash--;
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
    if ((sc === 'play' || sc === 'bonus' || sc === 'map') && I.pressed('pause')) { this.openPause(); return; }
    if (sc === 'title') this.titleNav(g);
    else if (sc === 'map') this.mapNav(g);
    else if (sc === 'ending') { this.endingT++; if (this.endingT > 240 && I.pressed('confirm')) { g.setScene('title'); } }
    else if (sc === 'recovery') this.recoveryNav(g);
  }

  autopilotNav(g: Game) {
    const sc = g.state.scene;
    if (sc === 'map' && this.t % 30 === 0) { const ex = g.mods.world.exitsFrom(g.state.areaId); if (ex.length) g.mods.world.chooseExit(ex[(g.state.seed + g.state.areasCleared.length) % ex.length].to); }
  }

  titleItems() { return [...(this.g.mods.save?.hasSave() ? ['CONTINUE'] : []), 'NEW GAME', 'JOURNAL', 'SETTINGS']; }
  pauseItems() { return ['RESUME', 'JOURNAL', 'SETTINGS', 'SAVE & QUIT']; }

  titleNav(g: Game) {
    const I = g.input; const items = this.titleItems();
    if (I.pressed('up')) { this.sel = (this.sel + items.length - 1) % items.length; g.mods.audio?.sfx('blip'); }
    if (I.pressed('down')) { this.sel = (this.sel + 1) % items.length; g.mods.audio?.sfx('blip'); }
    if (I.pressed('confirm')) {
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
      g.mods.save?.save(); this.menuOpen = this.settingsFrom === 'title' ? 'none' : 'pause'; this.sel = 0;
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
    const sc = g.state.scene;
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

  drawToasts(ctx: CanvasRenderingContext2D) {
    const cx = PF_X + PF_W / 2;
    this.toasts.forEach((x, i) => {
      // slide down on entry, slide up on exit (no alpha fades: palette-exact)
      const enter = Math.min(1, x.age / 10), exit = Math.min(1, x.t / 10);
      const y = Math.round(6 + i * 17 - (1 - Math.min(enter, exit)) * 20);
      if (y < -14) return;
      const w = textWidth(x.text) + 30; const bx = Math.round(cx - w / 2);
      frame(ctx, bx, y, w, 14, C.hot, C.night, 4);
      icon(ctx, x.text.startsWith('MEMORY') ? 'photo' : x.text.startsWith('PUPPY') ? 'paw' : x.text.includes('QUEST') ? 'flag' : 'star', bx + 7, y + 4, C.gold);
      text(ctx, x.text, bx + 18, y + 4, (x.age >> 2) % 2 && x.age < 24 ? C.text : C.gold);
    });
  }

  // ---------------- HUD ----------------
  panel(ctx: CanvasRenderingContext2D, x: number, accent: string) {
    rect(ctx, x, 0, PW, H, C.panel);
    // faint circuit grid
    for (let yy = 24; yy < H; yy += 24) dither(ctx, x + 4, yy, PW - 8, 1, C.indigo, 'sparse');
    scanlines(ctx, x, 0, PW, H);
    frame(ctx, x + 2, 2, PW - 4, H - 4, accent, C.panel, 6);
    // sweeping scan line (subtle animated detail)
    const sy = 8 + ((this.t >> 1) % (H - 16));
    dither(ctx, x + 4, sy, PW - 8, 1, C.indigo);
    // rivets
    for (const yy of [12, H - 13]) { rect(ctx, x + 6, yy, 2, 2, C.indigo); rect(ctx, x + PW - 8, yy, 2, 2, C.indigo); }
  }
  hud(g: Game, ctx: CanvasRenderingContext2D) {
    const s = g.state; const P = g.mods.player; const A = g.mods.world?.area(); const t = this.t;
    const touch = this.touch.visible(g);
    // ===== left panel =====
    this.panel(ctx, 0, C.pink);
    const L1 = logoWord('POODLE', 1, PINK, 2, 1, 1), L2 = logoWord('PATROL', 1, CYAN, 2, 1, 1);
    const shine = (t % 240) * 0.6 - 20;
    drawLogo(ctx, L1, 64, 10, shine, 3); drawLogo(ctx, L2, 64, 27, shine - 20, 3);
    const x0 = 10, w0 = PW - 20;
    header(ctx, 'SCORE', x0, 50, w0, C.pink, t);
    text(ctx, String(Math.min(this.shownScore, 99999999)).padStart(8, '0'), x0 + 2, 61, C.text, { scale: 2, shadow: C.ink });
    icon(ctx, 'star', x0, 80, C.gold); text(ctx, 'HI', x0 + 10, 80, C.dim);
    text(ctx, String(s.hiScore).padStart(8, '0'), x0 + 26, 80, C.gold);
    header(ctx, 'HEARTS', x0, 96, w0, C.hot, t, s.hearts <= 1);
    const beat = s.hearts <= 1 && (t >> 4) % 2 === 0;
    for (let i = 0; i < s.maxHearts; i++) {
      const full = i < s.hearts; const hx = x0 + 8 + i * 13, hy = 112 + (full && beat && i === s.hearts - 1 ? -1 : 0);
      if (!full && this.heartFlash > 0 && i === s.hearts && (this.heartFlash >> 2) % 2) drawSprite(ctx, 'hud_heart', hx, hy, { flash: true });
      else drawSprite(ctx, full ? 'hud_heart' : 'hud_heart_empty', hx, hy);
    }
    header(ctx, 'POWER-UPS', x0, 126, w0, C.line, t);
    let py = 138;
    const pw: [string, string, string, string][] = [['double', 'pk_bone', 'DOUBLE', C.gold], ['spread', 'pk_chili', 'CHILI', C.orange], ['shield', 'pk_bandana', 'SHIELD', C.line], ['speed', 'pk_sneaker', 'ZOOM', C.lime]];
    const rowH = 17;
    for (const [k, spr, nm, c] of pw) {
      const left = P?.powers?.[k] ?? 0; if (left <= 0) continue;
      chamferFill(ctx, x0, py - 1, w0, rowH - 2, C.night, 2);
      drawSprite(ctx, spr, x0 + 8, py + 6);
      const low = left < 180 && (t >> 3) % 2;
      text(ctx, nm, x0 + 18, py, low ? C.dim : C.text);
      text(ctx, String(Math.ceil(left / 60)) + 'S', x0 + w0 - 2, py, c, { align: 'right' });
      segBar(ctx, x0 + 18, py + 9, 12, 5, 2, left / 900, c);
      py += rowH;
    }
    if (P?.buddy) {
      chamferFill(ctx, x0, py - 1, w0, rowH - 2, C.night, 2);
      drawSprite(ctx, 'pup', x0 + 8, py + 6); text(ctx, 'WINGPUP', x0 + 18, py, C.gold); text(ctx, 'ONLINE', x0 + 18, py + 8, C.lime); py += rowH;
    }
    if (py === 138) { text(ctx, '- STANDBY -', x0 + w0 / 2, py + 2, C.peri, { align: 'center' }); dither(ctx, x0 + 4, py + 13, w0 - 8, 1, C.indigo); }
    if (!touch) {
      // flight stats
      header(ctx, 'STATS', x0, 236, w0, C.violet, t);
      const acc = s.stats.shots ? Math.round(100 * s.stats.hits / s.stats.shots) : 0;
      icon(ctx, 'cat', x0, 248, C.hot); text(ctx, 'BOOPS', x0 + 10, 248, C.dim); text(ctx, String(s.stats.catsBooped), x0 + w0, 248, C.text, { align: 'right' });
      icon(ctx, 'star', x0, 260, C.gold); text(ctx, 'AIM', x0 + 10, 260, C.dim); text(ctx, `${acc}%`, x0 + w0, 260, C.text, { align: 'right' });
      segBar(ctx, x0, 271, 18, 5, 2, acc / 100, C.violet);
      // controls block (device-aware); hidden while the touch deck occupies this space
      const k = keys(this.dev());
      header(ctx, 'CONTROLS', x0, 288, w0, C.line, t);
      const rows: [string, string][] = [[k.move, 'FLY'], [k.fire, 'TOOT'], [k.pause, 'PAUSE']];
      rows.forEach(([key, cap], i) => { const kw = keycap(ctx, key, x0, 302 + i * 14, C.line); text(ctx, cap, x0 + kw + 5, 302 + i * 14, C.pale); });
    }
    // ===== right panel =====
    this.panel(ctx, RX, C.line);
    const x1 = RX + 10;
    if (A) {
      const idx = g.content.areas.indexOf(A);
      header(ctx, `SECTOR ${String(idx + 1).padStart(2, '0')}`, x1, 12, w0, C.line, t, true);
      wrap(A.name.toUpperCase(), 18).slice(0, 2).forEach((l, i) => text(ctx, l, x1, 24 + i * 10, C.text, { shadow: C.ink }));
      const tot = A.waves.length + (A.boss ? 1 : 0); const cur = Math.min(tot, s.waveIndex + 1);
      const B0 = g.mods.interaction?.boss;
      header(ctx, 'WAVE', x1, 48, w0, C.hot, t);
      text(ctx, B0 ? 'BIG CAT!' : `${cur}`, x1, 59, B0 ? C.hot : C.line, { scale: B0 ? 1 : 2, shadow: C.ink });
      if (!B0) text(ctx, `/ ${tot}`, x1 + textWidth(String(cur), 2) + 4, 66, C.dim);
      const cw = Math.max(4, Math.min(12, Math.floor((w0 - (tot - 1)) / Math.max(1, tot))));
      for (let i = 0; i < tot; i++) {
        const done = i < s.waveIndex, curw = i === s.waveIndex; const bossCell = A.boss && i === tot - 1;
        const c = done ? C.line : curw ? ((t >> 3) % 2 ? C.hot : C.pink) : C.plum;
        chamferFill(ctx, x1 + i * (cw + 1), 76, cw, 5, c, 1);
        if (bossCell && !done) rect(ctx, x1 + i * (cw + 1) + (cw >> 1) - 1, 77, 2, 3, curw ? C.text : C.hot);
      }
    }
    header(ctx, 'RESCUED', x1, 88, w0, C.gold, t);
    chamferFill(ctx, x1, 98, 52, 18, C.night, 2); drawSprite(ctx, 'pup', x1 + 9, 107);
    text(ctx, `X${s.inventory.pups ?? 0}`, x1 + 20, 103, C.gold);
    chamferFill(ctx, x1 + 56, 98, w0 - 56, 18, C.night, 2); drawSprite(ctx, 'pk_memory', x1 + 65, 107);
    text(ctx, `${s.memories.length}/${g.content.memories.length}`, x1 + 76, 103, C.text);
    header(ctx, 'QUEST', x1, 124, w0, C.violet, t);
    const q = g.content.quests.find(q => s.quests[q.id] === 'active');
    if (q) {
      icon(ctx, 'flag', x1, 136, C.violet);
      wrap(q.name.toUpperCase(), 16).slice(0, 2).forEach((l, i) => text(ctx, l, x1 + 10, 136 + i * 10, C.violet));
      const pr = g.mods.quest?.progress?.(q);
      if (pr && pr.need > 1) { segBar(ctx, x1, 159, 10, 7, 3, pr.have / pr.need, C.violet); text(ctx, `${pr.have}/${pr.need}`, x1 + w0, 158, C.dim, { align: 'right' }); }
    } else text(ctx, 'ALL CLEAR', x1, 136, C.peri);
    const B = g.mods.interaction?.boss;
    if (B) {
      header(ctx, 'BIG CAT', x1, 176, w0, C.hot, t, true);
      icon(ctx, 'cat', x1, 188, C.hot);
      wrap(B.def.name.toUpperCase(), 16).slice(0, 2).forEach((l: string, i: number) => text(ctx, l, x1 + 10, 188 + i * 10, C.text));
      const p = B.hp / B.maxHp;
      chamferFill(ctx, x1 - 1, 209, w0 + 2, 9, C.ink, 2);
      bar(ctx, x1 + 1, 211, w0 - 2, 5, p, p < 0.3 && (t >> 3) % 2 ? C.pink : C.hot);
      for (let i = 1; i < 10; i++) rect(ctx, x1 + 1 + Math.round(i * (w0 - 2) / 10), 211, 1, 5, C.ink);
    }
    if (g.state.scene === 'bonus') {
      header(ctx, 'BONANZA', x1, 176, w0, C.gold, t, true);
      const b = g.mods.interaction?.bonus;
      if (b) { icon(ctx, 'gift', x1, 188, C.gold); text(ctx, `${b.hits} / ${b.total}`, x1 + 10, 188, C.text); segBar(ctx, x1, 200, 20, 4, 3, b.hits / Math.max(1, b.total), C.gold); }
    }
    if (!touch) this.radar(g, ctx, x1, 226, w0, 54);
    if (!touch) {
      const night = s.tod === 'night', tc = night ? C.violet : s.tod === 'dusk' ? C.pink : s.tod === 'dawn' ? C.orange : C.gold;
      header(ctx, 'LOCAL TIME', x1, 288, w0, tc, t);
      icon(ctx, night || s.tod === 'dusk' ? 'moon' : 'sun', x1, 300, tc); text(ctx, s.tod.toUpperCase(), x1 + 10, 300, tc);
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

  /** Mini scanner of the playfield: cats as blips, Pom as a cyan chevron, rotating sweep. */
  radar(g: Game, ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    const t = this.t; const I = g.mods.interaction; const P = g.mods.player;
    header(ctx, 'SCANNER', x, y, w, C.lime, t, true);
    const by = y + 11, bh = h - 11;
    chamferFill(ctx, x, by, w, bh, C.ink, 3); chamferLine(ctx, x, by, w, bh, C.indigo, 3);
    for (let gx = x + 9; gx < x + w - 2; gx += 9) dither(ctx, gx, by + 2, 1, bh - 4, C.night);
    for (let gy = by + 7; gy < by + bh - 2; gy += 7) dither(ctx, x + 2, gy, w - 4, 1, C.night);
    const sx = x + 2 + ((t >> 1) % (w - 4)); rect(ctx, sx, by + 2, 1, bh - 4, C.deep);
    const mx = (wx: number) => Math.round(x + 3 + Math.max(0, Math.min(1, wx / 448)) * (w - 7));
    const my = (wy: number) => Math.round(by + 3 + Math.max(0, Math.min(1, wy / 360)) * (bh - 7));
    for (const c of (I?.cats ?? []) as { x: number; y: number; st: string }[]) {
      if (c.y < -8 || c.y > 368) continue;
      const near = Math.abs(mx(c.x) - sx) < 6;
      rect(ctx, mx(c.x), my(c.y), c.st === 'dive' || c.st === 'kdive' ? 2 : 1, c.st === 'dive' || c.st === 'kdive' ? 2 : 1, near ? C.pink : c.st === 'dive' || c.st === 'kdive' ? C.hot : C.mag);
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
  dialogueBox(g: Game, ctx: CanvasRenderingContext2D) {
    const d = g.mods.quest?.dlg; if (!d) return;
    const x = PF_X + 6, y = H - 94, w = PF_W - 12, h = 88; const t = this.t;
    const isPom = /pom/i.test(d.node.speaker);
    const accent = isPom ? C.pink : C.line;
    frame(ctx, x, y, w, h, accent, C.night, 6);
    scanlines(ctx, x + 2, y + 2, w - 4, h - 4);
    // portrait bay with a scanning hologram backdrop
    const pxx = x + 7, pyy = y + 8, ps = 48;
    chamferFill(ctx, pxx, pyy, ps, ps, C.ink, 4);
    for (let yy = 4; yy < ps - 2; yy += 3) dither(ctx, pxx + 2, pyy + yy, ps - 4, 1, C.indigo, 'sparse');
    const scan = (t >> 1) % (ps - 4);
    ctx.save(); ctx.beginPath(); ctx.rect(pxx + 2, pyy + 2, ps - 4, ps - 4); ctx.clip();
    const spr = this.portraitFor(d.node); const sc = spriteCanvas(spr, (t >> 5) % 2 && frameCount(spr) > 1 ? 1 : 0);
    if (sc) { // integer zoom so small sprites fill the bay; large ones are cropped to the face
      const z = sc.height <= 22 ? 2 : 1; const dw = sc.width * z, dh = sc.height * z;
      const oy = sc.height > 40 ? 6 : 0;
      ctx.drawImage(sc, Math.round(pxx + ps / 2 - dw / 2), Math.round(pyy + ps / 2 - dh / 2 + oy + (z === 2 ? 2 : 0)), dw, dh);
    }
    ctx.restore();
    rect(ctx, pxx + 2, pyy + 2 + scan, ps - 4, 1, darkOf(accent));
    chamferLine(ctx, pxx, pyy, ps, ps, accent, 4);
    rect(ctx, pxx + 4, pyy + ps + 3, ps - 8, 2, C.plum); rect(ctx, pxx + 4, pyy + ps + 3, ((t >> 2) % (ps - 8)) + 1, 2, darkOf(accent));
    // nameplate tab
    const nx = x + 62, nm = d.node.speaker.toUpperCase(); const nw = textWidth(nm) + 14;
    chamferFill(ctx, nx, y - 6, nw, 13, accent, 3);
    text(ctx, nm, nx + 7, y - 3, C.ink);
    const lines = wrap(d.node.text.slice(0, Math.floor(d.chars)), 48).slice(0, 6);
    lines.forEach((l, i) => text(ctx, l, nx, y + 14 + i * 11, C.text, { shadow: C.ink }));
    if (d.chars >= d.node.text.length) {
      const bob = (t >> 3) % 2;
      arrow(ctx, x + w - 12, y + h - 9 + bob, 'd', 4, C.gold);
      text(ctx, keys(this.dev()).ok, x + w - 20, y + h - 12, C.dim, { align: 'right' });
    } else if ((t >> 2) % 2) rect(ctx, nx + (lines.length ? textWidth(lines[lines.length - 1]) + 2 : 0), y + 14 + Math.max(0, lines.length - 1) * 11, 4, 7, accent);
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
    // synthwave sun: banded disc, slatted near the horizon
    const sx = W / 2, sr = 52;
    for (let dy = -sr; dy <= 0; dy++) {
      const yy = HZ + dy; const f = (dy + sr) / sr;
      const slat = f > 0.45 && ((yy - (t >> 2)) % Math.max(3, Math.round(9 - f * 6))) === 0;
      if (slat) continue;
      const dx = Math.floor(Math.sqrt(sr * sr - dy * dy));
      rect(ctx, sx - dx, yy, dx * 2 + 1, 1, f < 0.25 ? C.gold : f < 0.5 ? C.orange : f < 0.75 ? C.hot : C.mag);
    }
    // ground: perspective grid scrolling toward the viewer
    rect(ctx, 0, HZ, W, H - HZ, C.ink);
    rect(ctx, 0, HZ, W, 1, C.hot);
    const ph = (t % 40) / 40;
    for (let k = 0; k < 14; k++) {
      const z = k + ph; const y = Math.round(HZ + 2 + z * z * 0.85);
      if (y >= H) break;
      rect(ctx, 0, y, W, 1, z < 3 ? C.plum : z < 7 ? C.purple : C.purple);
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
    // hero + cats
    const pyy = 168 + Math.round(Math.sin(t / 12) * 3);
    drawSprite(ctx, 'poodle', W / 2, pyy, { frame: (t >> 3) % 2 });
    TITLE_CATS.forEach((b, i) => {
      const side = i < 2 ? -1 : 1, k = i % 2;
      const x = W / 2 + side * (150 + k * 90), y = 158 + k * 18 + Math.round(Math.sin(t / 15 + i) * 5);
      drawSprite(ctx, b, x, y, { frame: ((t >> 4) + i) % 2 });
    });
    // menu
    const items = this.titleItems(); const mh = items.length * 15 + 14; const my = 234;
    frame(ctx, W / 2 - 84, my, 168, mh, C.line, C.night, 6);
    menu(ctx, items, this.sel, W / 2, my + 9, t, 15, items.map(s => s === 'CONTINUE' ? 'play' : s === 'NEW GAME' ? 'new' : s === 'JOURNAL' ? 'book' : 'gear'), 150);
    const hs = `HI-SCORE ${String(g.state.hiScore).padStart(8, '0')}`; const hx = Math.round(W / 2 - (textWidth(hs) + 10) / 2);
    chamferFill(ctx, hx - 6, my + mh + 4, textWidth(hs) + 22, 13, C.ink, 3);
    icon(ctx, 'star', hx, my + mh + 7, C.gold); text(ctx, hs, hx + 10, my + mh + 7, C.dim);
    const k = keys(this.dev());
    hintRow(ctx, [[k.move, 'CHOOSE'], [k.ok, 'SELECT']], W / 2, 346, C.line);
  }

  // ---------------- sector map ----------------
  map(g: Game, ctx: CanvasRenderingContext2D) {
    const t = this.t;
    rect(ctx, 0, 0, W, H, C.bg);
    // holo grid: fine dots every 16px, rules every 64px
    for (let y = 48; y < 276; y += 16) for (let x = 16; x < W; x += 16) rect(ctx, x, y, 1, 1, (x % 64 === 0 || y % 64 === 0) ? C.indigo : C.night);
    for (let x = 64; x < W; x += 64) dither(ctx, x, 48, 1, 228, C.plum);
    for (let y = 64; y < 276; y += 64) dither(ctx, 8, y, W - 16, 1, C.plum);
    for (let i = 0; i < 60; i++) { const x = (i * 131) % W, y = 48 + (i * 71) % 228; rect(ctx, x, y, 1, 1, (i + (t >> 4)) % 9 ? C.indigo : C.peri); }
    // header bar
    frame(ctx, 8, 6, W - 16, 34, C.line, C.night, 6);
    text(ctx, 'SECTOR MAP', W / 2, 12, C.line, { align: 'center', scale: 2, shadow: C.deep });
    text(ctx, 'CHOOSE YOUR NEXT FLIGHT PATH', W / 2, 29, C.dim, { align: 'center' });
    rect(ctx, 20, 18, 4, 4, (t >> 4) % 2 ? C.hot : C.mag); text(ctx, 'LIVE', 28, 17, C.hot);
    const cl = g.state.areasCleared.length;
    text(ctx, `${String(cl).padStart(2, '0')}/${String(g.content.areas.length).padStart(2, '0')} CLEAR`, W - 20, 17, C.dim, { align: 'right' });
    const pos = this.layout(g);
    const exits = g.mods.world.exitsFrom(g.state.areaId);
    const here = pos[g.state.areaId];
    // range rings around current position
    if (here) { ring(ctx, here[0], here[1], 22, C.deep, [3, 3], t >> 2); ring(ctx, here[0], here[1], 36, C.plum, [2, 4], -(t >> 3)); }
    const selTo = exits[Math.min(this.mapSel, exits.length - 1)]?.to;
    // edges
    for (const a of g.content.areas) for (const e of a.exits) {
      const p1 = pos[a.id], p2 = pos[e.to]; if (!p1 || !p2) continue;
      const live = a.id === g.state.areaId && exits.some((x: any) => x.to === e.to);
      const done = g.state.areasCleared.includes(e.to) && g.state.areasCleared.includes(a.id);
      const isSel = live && e.to === selTo;
      const c = isSel ? C.gold : live ? C.hot : done ? C.line : C.indigo;
      line(ctx, p1[0], p1[1], p2[0], p2[1], c, e.when ? [2, 3] : live ? [4, 2] : undefined, live ? -(t >> 1) : 0);
      if (live) { // data packet travelling along the live route
        const f = ((t + (isSel ? 0 : 20)) % 60) / 60;
        rect(ctx, Math.round(p1[0] + (p2[0] - p1[0]) * f) - 1, Math.round(p1[1] + (p2[1] - p1[1]) * f) - 1, 3, 3, isSel ? C.text : C.pink);
      }
    }
    // nodes: diamonds with sector numbers
    g.content.areas.forEach((a, idx) => {
      const p = pos[a.id]; if (!p) return;
      const cleared = g.state.areasCleared.includes(a.id), isHere = a.id === g.state.areaId, sel = a.id === selTo;
      const reachable = exits.some((x: any) => x.to === a.id);
      const c = sel ? C.gold : isHere ? C.hot : cleared ? C.line : reachable ? C.pink : C.peri;
      const r = sel || isHere ? 7 : 6;
      for (let dy = -r - 1; dy <= r + 1; dy++) { const w = r + 1 - Math.abs(dy); rect(ctx, p[0] - w, p[1] + dy, w * 2 + 1, 1, C.ink); }
      for (let dy = -r; dy <= r; dy++) { const w = r - Math.abs(dy); rect(ctx, p[0] - w, p[1] + dy, 1, 1, c); rect(ctx, p[0] + w, p[1] + dy, 1, 1, c); }
      if (cleared || isHere) for (let dy = -3; dy <= 3; dy++) { const w = 3 - Math.abs(dy); rect(ctx, p[0] - w, p[1] + dy, w * 2 + 1, 1, isHere ? C.hot : C.deep); }
      if (cleared && !isHere) rect(ctx, p[0], p[1], 1, 1, C.line);
      if (a.boss && !cleared) rect(ctx, p[0] - 1, p[1] - 1, 3, 3, sel ? C.gold : C.mag);
      text(ctx, String(idx + 1).padStart(2, '0'), p[0], p[1] + r + 4, sel ? C.gold : isHere ? C.hot : C.indigo, { align: 'center' });
      if (sel) { // rotating-in corner brackets
        const o = 11 + ((t >> 3) % 2);
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          rect(ctx, p[0] + sx * o - (sx > 0 ? 3 : 0), p[1] + sy * o, 4, 1, C.gold);
          rect(ctx, p[0] + sx * o, p[1] + sy * o - (sy > 0 ? 3 : 0), 1, 4, C.gold);
        }
        const nm = a.name.toUpperCase(); const nw = textWidth(nm) + 10;
        const lx = Math.max(10, Math.min(W - 10 - nw, p[0] - nw / 2)), ly = p[1] - 30;
        chamferFill(ctx, lx, ly, nw, 12, C.night, 3); chamferLine(ctx, lx, ly, nw, 12, C.burnt, 3);
        text(ctx, nm, lx + 5, ly + 3, C.gold); line(ctx, p[0], ly + 12, p[0], p[1] - o - 2, C.burnt, [1, 1]);
      }
      if (isHere) drawSprite(ctx, 'hud_paw', p[0], p[1] - 18 + ((t >> 4) % 2));
    });
    // sweep line (holographic scanner)
    const sx = (t * 2) % (W + 60) - 30;
    for (let k = 0; k < 4; k++) dither(ctx, sx - k * 3, 48, 1, 228, k === 0 ? C.line2 : C.deep, k > 1);
    // info panel
    if (selTo) {
      const a = g.mods.world.area(selTo);
      const tv = this.touch.visible(g); const bx = tv ? PF_X + 4 : 96, by = 282, bw = W - 2 * bx, bh = 70;
      frame(ctx, bx, by, bw, bh, C.hot, C.night, 6);
      chamferFill(ctx, bx + 8, by - 5, 64, 11, C.hot, 3); text(ctx, 'NEXT HOP', bx + 14, by - 3, C.ink);
      text(ctx, a.name.toUpperCase(), W / 2, by + 9, C.gold, { align: 'center', shadow: C.burnt });
      if (a.subtitle) text(ctx, a.subtitle.toUpperCase(), W / 2, by + 21, C.text, { align: 'center' });
      // stats row with icons
      const parts: [string, string, string][] = [['wave', `${a.waves.length} WAVES`, C.line]];
      if (a.boss) parts.push(['cat', 'BIG CAT', C.hot]);
      if (a.bonus) parts.push(['gift', 'BONANZA', C.gold]);
      parts.push([a.tod === 'night' || a.tod === 'dusk' ? 'moon' : 'sun', a.tod.toUpperCase(), a.tod === 'night' ? C.violet : C.gold]);
      const pw = parts.reduce((s, [, l]) => s + textWidth(l) + 10, 0) + (parts.length - 1) * 12;
      let x = Math.round(W / 2 - pw / 2);
      for (const [ic, l, c] of parts) { icon(ctx, ic, x, by + 35, c); text(ctx, l, x + 10, by + 35, C.pale); x += textWidth(l) + 22; }
      const k = keys(this.dev());
      hintRow(ctx, [[this.dev() === 'gamepad' ? 'D-PAD' : this.dev() === 'touch' ? 'PAD' : '< >', 'ROUTE'], [k.ok, 'LAUNCH'], [k.pause, 'MENU']], W / 2, by + 53, C.line);
    }
  }
  /** Lay out the quest graph by depth (longest path from start). */
  layout(g: Game): Record<string, [number, number]> {
    const depth: Record<string, number> = {}; const start = g.content.start;
    const visit = (id: string, d: number, guard: number) => { if (guard > 40) return; if ((depth[id] ?? -1) >= d) return; depth[id] = d; for (const e of g.content.areas.find(a => a.id === id)?.exits ?? []) visit(e.to, d + 1, guard + 1); };
    visit(start, 0, 0);
    const cols: Record<number, string[]> = {};
    for (const a of g.content.areas) if (depth[a.id] !== undefined) (cols[depth[a.id]] ??= []).push(a.id);
    const maxD = Math.max(...Object.keys(cols).map(Number));
    const out: Record<string, [number, number]> = {};
    for (const [d, ids] of Object.entries(cols)) ids.forEach((id, i) => { out[id] = [Math.round(44 + (+d / Math.max(1, maxD)) * (W - 88)), Math.round(166 + (i - (ids.length - 1) / 2) * 64)]; });
    return out;
  }

  // ---------------- menus ----------------
  dim(ctx: CanvasRenderingContext2D) {
    // dim only the playfield so the HUD panels stay readable while paused
    const sc = this.g.state.scene; const hud = sc === 'play' || sc === 'bonus' || sc === 'dialogue';
    if (hud) dither(ctx, PF_X + 1, 0, PF_W - 2, H, C.ink); else dither(ctx, 0, 0, W, H, C.ink);
  }
  pause(g: Game, ctx: CanvasRenderingContext2D) {
    this.dim(ctx);
    const items = this.pauseItems(); const w = 196, h = 182; const x = Math.round(W / 2 - w / 2), y = 82;
    frame(ctx, x, y, w, h, C.line, C.night, 8);
    scanlines(ctx, x + 2, y + 2, w - 4, h - 4);
    chamferFill(ctx, x + 10, y - 8, w - 20, 26, C.ink, 5); chamferLine(ctx, x + 10, y - 8, w - 20, 26, C.deep, 5);
    text(ctx, 'PAUSED', W / 2, y - 2, C.line, { align: 'center', scale: 2, shadow: C.deep });
    // mission readout
    const A = g.mods.world?.area();
    if (A) text(ctx, A.name.toUpperCase(), W / 2, y + 26, C.dim, { align: 'center' });
    rect(ctx, x + 16, y + 38, w - 32, 1, C.indigo);
    menu(ctx, items, this.sel, W / 2, y + 52, this.t, 20, ['play', 'book', 'gear', 'disk'], w - 28);
    rect(ctx, x + 16, y + 132, w - 32, 1, C.indigo);
    text(ctx, 'PROGRESS SAVES EVERY WAVE', W / 2, y + 140, C.peri, { align: 'center' });
    const k = keys(this.dev());
    hintRow(ctx, [[k.ok, 'SELECT'], [k.back, 'RESUME']], W / 2, y + h - 18, C.line);
  }
  settings(g: Game, ctx: CanvasRenderingContext2D) {
    const s = g.state.settings; const t = this.t;
    this.dim(ctx);
    const w = 280, h = 196; const x = Math.round(W / 2 - w / 2), y = 76;
    frame(ctx, x, y, w, h, C.violet, C.night, 8);
    scanlines(ctx, x + 2, y + 2, w - 4, h - 4);
    chamferFill(ctx, x + 40, y - 8, w - 80, 26, C.ink, 5); chamferLine(ctx, x + 40, y - 8, w - 80, 26, C.purple, 5);
    text(ctx, 'SETTINGS', W / 2, y - 2, C.violet, { align: 'center', scale: 2, shadow: C.purple });
    const rows: [string, string][] = [['MUSIC', 'note'], ['SFX', 'speaker'], ['SCREEN SHAKE', 'shake'], ['TOUCH CONTROLS', 'hand'], ['BACK', 'back']];
    rows.forEach(([k, ic], i) => {
      const on = i === this.sel; const yy = y + 30 + i * 26; const rx = x + 14, rw = w - 28;
      if (on) { chamferFill(ctx, rx, yy - 5, rw, 18, C.plum, 4); chamferLine(ctx, rx, yy - 5, rw, 18, C.purple, 4); rect(ctx, rx + 1, yy - 1, 1, 10, C.violet); }
      icon(ctx, ic, rx + 8, yy, on ? C.gold : C.peri);
      text(ctx, k, rx + 20, yy, on ? C.gold : C.text, { shadow: C.ink });
      const vx = rx + rw - 8; // right edge of control
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
    hintRow(ctx, [[this.dev() === 'gamepad' ? 'D-PAD' : this.dev() === 'touch' ? 'PAD' : '< >', 'ADJUST'], [k.ok, 'TOGGLE'], [k.back, 'BACK']], W / 2, y + h - 18, C.violet);
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
    for (let i = 0; i < 90; i++) { const x = (i * 97) % W, y = (i * 53 + T * 0.2 * (1 + i % 3)) % H; rect(ctx, x, Math.floor(y), 1, 1, i % 4 ? C.indigo : (i + (T >> 3)) % 7 ? C.gold : C.text); }
    // confetti of hearts drifting down
    for (let i = 0; i < 14; i++) { const x = (i * 47 + 20) % W, y = (i * 29 + (T >> 1) * (1 + i % 2)) % (H + 20) - 10; icon(ctx, i % 3 ? 'heart' : 'star', x, y, i % 2 ? C.mag : C.purple); }
    const title = e.title.toUpperCase();
    const allLogo = [...title].every(ch => ch === ' ' || 'PODLEATR'.includes(ch));
    if (allLogo && title.length <= 14) drawLogo(ctx, logoWord(title.replace(/ /g, ''), 2, GOLD, 3, 2, 3), W / 2, 16);
    else {
      const tw = textWidth(title, 2) + 32;
      chamferFill(ctx, W / 2 - tw / 2, 14, tw, 26, C.ink, 6); chamferLine(ctx, W / 2 - tw / 2, 14, tw, 26, C.burnt, 6);
      text(ctx, title, W / 2, 20, C.gold, { align: 'center', scale: 2, shadow: C.burnt });
    }
    // Pom and the rescued pups in a little parade
    disc(ctx, W / 2, 80, 18, C.night); ring(ctx, W / 2, 80, 18, C.burnt, [2, 2], T >> 2);
    drawSprite(ctx, 'poodle', W / 2, 78 + ((T >> 4) % 2), { frame: (T >> 3) % 2 });
    const pups = g.state.inventory.pups ?? 0; const n = Math.min(8, pups);
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1, k = (i >> 1) + 1;
      drawSprite(ctx, 'pup', W / 2 + side * (18 + k * 20), 90 + Math.round(Math.sin(T / 10 + i) * 2));
    }
    // story text in a framed panel, revealed line by line
    const lines = e.text.flatMap(t => [...wrap(t, 58), '']).slice(0, -1);
    const shown = Math.floor(T / 40);
    const ph = Math.min(176, lines.length * 11 + 14);
    frame(ctx, PF_X + 2, 112, PF_W - 4, ph, C.gold, C.night, 6);
    lines.slice(0, shown + 1).forEach((l, i) => { if (120 + i * 11 < 112 + ph - 8) text(ctx, l, W / 2, 120 + i * 11, C.text, { align: 'center', shadow: C.ink }); });
    const s = g.state; const y = 112 + ph + 10;
    if (shown > lines.length) {
      const stats: [string, string, string][] = [['star', `${s.score} PTS`, C.gold], ['cat', `${s.stats.catsBooped} BOOPED`, C.hot], ['paw', `${pups} PUPS`, C.line], ['photo', `${s.memories.length}/${g.content.memories.length}`, C.violet], ['clock', `${Math.floor(s.stats.playTicks / 3600)} MIN`, C.pale], ['moon', `${s.stats.naps} NAPS`, C.dim]];
      const cw = 124, cols = 3;
      stats.forEach(([ic, l, c], i) => {
        const cx = W / 2 - (cols * cw) / 2 + (i % cols) * cw, cy = y + Math.floor(i / cols) * 18;
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
    const w = 340, h = 180, x = Math.round(W / 2 - w / 2), y = 86;
    frame(ctx, x, y, w, h, C.hot, C.night, 8);
    scanlines(ctx, x + 2, y + 2, w - 4, h - 4);
    chamferFill(ctx, x + 70, y - 8, w - 140, 18, C.hot, 5); text(ctx, 'SAVE RECOVERY', W / 2, y - 3, C.ink, { align: 'center' });
    // the culprit, with a sheepish wobble and a chewed floppy
    disc(ctx, W / 2, y + 40, 20, C.ink); ring(ctx, W / 2, y + 40, 20, C.mag, [3, 3], t >> 3);
    drawSprite(ctx, 'cat_tabby', W / 2 + ((t >> 5) % 2 ? 1 : -1), y + 40, { frame: (t >> 4) % 2 });
    icon(ctx, 'disk', W / 2 + 22, y + 48, C.peri, C.ink);
    text(ctx, 'UH OH! A CAT CHEWED YOUR SAVE.', W / 2, y + 70, C.gold, { align: 'center', shadow: C.burnt });
    text(ctx, 'NOTHING IS BROKEN. PICK AN OPTION:', W / 2, y + 84, C.text, { align: 'center' });
    menu(ctx, ['TRY BACKUP SAVE', 'START FRESH'], this.sel, W / 2, y + 106, t, 20, ['retry', 'new'], 200);
    const k = keys(this.dev());
    hintRow(ctx, [[this.dev() === 'gamepad' ? 'D-PAD' : this.dev() === 'touch' ? 'PAD' : 'ARROWS', 'CHOOSE'], [k.ok, 'CONFIRM']], W / 2, y + h - 18, C.hot);
  }
}
export const makeUI = (): Module => new UI();
