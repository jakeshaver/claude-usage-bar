import type { Game, Module } from '../core/game';
import { W, H, PF_X, PF_W } from '../core/game';
import { text, wrap } from '../art/font';
import { drawSprite, SHEETS } from '../art/sprite';
import { C, frame, bar, menu, scanlines, label } from './draw';
import { Touch } from './touch';

type Menu = 'none' | 'pause' | 'settings' | 'journal' | 'confirmQuit';

/** UI shell: HUD panels, title, sector map, pause, settings, dialogue box, ending, recovery, toasts. */
class UI implements Module {
  id = 'ui';
  api = this;
  g!: Game;
  t = 0; sel = 0; menuOpen: Menu = 'none'; settingsFrom: Menu | 'title' = 'pause';
  toasts: { text: string; t: number }[] = [];
  mapSel = 0; endingT = 0;
  touch = new Touch();

  init(g: Game) {
    this.g = g;
    g.toastFn = (s) => this.toast(s);
    g.bus.on('scene:change', (p: any) => { this.sel = 0; this.mapSel = 0; if (p.to === 'ending') this.endingT = 0; if (p.to !== 'play' && p.to !== 'bonus') this.menuOpen = this.menuOpen === 'journal' ? 'journal' : 'none'; });
    g.bus.on('save:recovered', () => this.toast('SAVE PATCHED UP FROM BACKUP'));
    if (g.contentIssues.length) setTimeout(() => this.toast(`${g.contentIssues.length} CONTENT ISSUE(S): USING SAFE DEFAULTS`), 0);
    if (!g.headless) this.touch.attach(g);
  }
  toast(s: string) { this.toasts.push({ text: s, t: 150 }); if (this.toasts.length > 4) this.toasts.shift(); }
  openPause() { if (this.menuOpen === 'none') { this.menuOpen = 'pause'; this.sel = 0; this.g.paused = true; this.g.mods.audio?.sfx('select'); } }
  closeMenus() { this.menuOpen = 'none'; this.g.paused = false; }
  openMap() { this.g.setScene('map'); }
  showDialogue(id: string) { this.g.mods.quest?.dialogue(id); }

  update(g: Game) {
    this.t++;
    for (const x of this.toasts) x.t--; this.toasts = this.toasts.filter(x => x.t > 0);
    const I = g.input; const sc = g.state.scene;
    if (g.autopilot) { this.autopilotNav(g); return; }
    // menus layered over play
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
    if (I.pressed('up')) this.sel = (this.sel + n - 1) % n;
    if (I.pressed('down')) this.sel = (this.sel + 1) % n;
    const d = I.pressed('left') ? -1 : I.pressed('right') ? 1 : 0;
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
    if (I.pressed('up') || I.pressed('down')) this.sel = 1 - this.sel;
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
    else if (sc === 'boot') { ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H); text(ctx, 'LOADING...', W / 2, H / 2, C.line, { align: 'center' }); }
    if (this.menuOpen === 'pause') this.pause(ctx);
    if (this.menuOpen === 'settings') this.settings(g, ctx);
    if (this.menuOpen === 'journal') g.mods.journal?.draw(g, ctx);
    // toasts
    this.toasts.forEach((x, i) => {
      const y = 8 + i * 14; const a = Math.min(1, x.t / 20);
      ctx.globalAlpha = a; const w = x.text.length * 6 + 14;
      frame(ctx, Math.round(W / 2 - w / 2), y, w, 12, C.hot, '#1d1b33ee');
      text(ctx, x.text, W / 2, y + 3, C.gold, { align: 'center' }); ctx.globalAlpha = 1;
    });
    this.touch.draw(g, ctx);
  }

  hud(g: Game, ctx: CanvasRenderingContext2D) {
    const s = g.state; const P = g.mods.player; const A = g.mods.world?.area();
    // left panel
    frame(ctx, 0, 0, PF_X, H, C.line, C.panel); scanlines(ctx, 0, 0, PF_X, H);
    text(ctx, 'POODLE', 64, 10, C.pink, { align: 'center', scale: 2, shadow: '#a3285f' });
    text(ctx, 'PATROL', 64, 26, C.line, { align: 'center', scale: 2, shadow: '#1b5d8f' });
    label(ctx, 'SCORE', 12, 52); text(ctx, String(s.score).padStart(8, '0'), 12, 62, C.text, { scale: 1 });
    label(ctx, 'HI-SCORE', 12, 78); text(ctx, String(s.hiScore).padStart(8, '0'), 12, 88, C.gold);
    label(ctx, 'HEARTS', 12, 106);
    for (let i = 0; i < s.maxHearts; i++) drawSprite(ctx, i < s.hearts ? 'hud_heart' : 'hud_heart_empty', 18 + i * 12, 122);
    label(ctx, 'POWER-UPS', 12, 140);
    let py = 152;
    const pw: [string, string, string][] = [['double', 'pk_bone', 'DOUBLE'], ['spread', 'pk_chili', 'CHILI'], ['shield', 'pk_bandana', 'SHIELD'], ['speed', 'pk_sneaker', 'ZOOM']];
    for (const [k, spr, nm] of pw) if ((P?.powers[k] ?? 0) > 0) { drawSprite(ctx, spr, 20, py + 4); text(ctx, nm, 34, py, C.text); bar(ctx, 34, py + 9, 80, 2, P.powers[k] / 900, C.line); py += 18; }
    if (P?.buddy) { drawSprite(ctx, 'pup', 20, py + 4); text(ctx, 'WINGPUP', 34, py, C.gold); py += 18; }
    if (py === 152) text(ctx, '- NONE -', 12, py, '#4b4f8c');
    label(ctx, 'CONTROLS', 12, 300); text(ctx, 'ARROWS MOVE', 12, 312, '#b9c1f2'); text(ctx, 'SPACE  TOOT', 12, 322, '#b9c1f2'); text(ctx, 'ESC    PAUSE', 12, 332, '#b9c1f2');
    // right panel
    const RX = PF_X + PF_W;
    frame(ctx, RX, 0, W - RX, H, C.line, C.panel); scanlines(ctx, RX, 0, W - RX, H);
    if (A) {
      const idx = g.content.areas.indexOf(A);
      label(ctx, `SECTOR ${String(idx + 1).padStart(2, '0')}`, RX + 10, 10);
      wrap(A.name.toUpperCase(), 18).slice(0, 2).forEach((l, i) => text(ctx, l, RX + 10, 22 + i * 10, C.text));
      label(ctx, 'WAVE', RX + 10, 52);
      const tot = A.waves.length + (A.boss ? 1 : 0); const cur = Math.min(tot, s.waveIndex + 1);
      text(ctx, g.mods.interaction?.boss ? 'BOSS' : `${cur} / ${tot}`, RX + 10, 62, C.line);
      for (let i = 0; i < tot; i++) { ctx.fillStyle = i < s.waveIndex ? C.line : i === s.waveIndex ? C.hot : '#2f2f5a'; ctx.fillRect(RX + 10 + i * 10, 74, 8, 3); }
    }
    label(ctx, 'PUPS RESCUED', RX + 10, 90); drawSprite(ctx, 'pup', RX + 18, 108); text(ctx, `x ${s.inventory.pups ?? 0}`, RX + 30, 105, C.gold);
    label(ctx, 'MEMORIES', RX + 10, 124); drawSprite(ctx, 'pk_memory', RX + 18, 142); text(ctx, `${s.memories.length} / ${g.content.memories.length}`, RX + 30, 139, C.text);
    label(ctx, 'QUEST', RX + 10, 160);
    const q = g.content.quests.find(q => s.quests[q.id] === 'active');
    if (q) { wrap(q.name.toUpperCase(), 18).slice(0, 2).forEach((l, i) => text(ctx, l, RX + 10, 172 + i * 10, C.violet)); const pr = g.mods.quest.progress(q); if (pr.need > 1) { bar(ctx, RX + 10, 194, 100, 3, pr.have / pr.need, C.violet); text(ctx, `${pr.have}/${pr.need}`, RX + 10, 200, C.dim); } }
    else text(ctx, 'ALL CLEAR', RX + 10, 172, '#4b4f8c');
    const B = g.mods.interaction?.boss;
    if (B) {
      label(ctx, 'BIG CAT', RX + 10, 224, C.hot);
      wrap(B.def.name.toUpperCase(), 18).slice(0, 2).forEach((l: string, i: number) => text(ctx, l, RX + 10, 236 + i * 10, C.text));
      bar(ctx, RX + 10, 258, 100, 5, B.hp / B.maxHp, C.hot);
    }
    if (g.state.scene === 'bonus') { label(ctx, 'BONANZA', RX + 10, 224, C.gold); const b = g.mods.interaction?.bonus; if (b) text(ctx, `${b.hits} / ${b.total}`, RX + 10, 236, C.text); }
    // tod indicator
    label(ctx, 'LOCAL TIME', RX + 10, 300); text(ctx, s.tod.toUpperCase(), RX + 10, 312, s.tod === 'night' ? C.violet : s.tod === 'dusk' ? C.pink : C.gold);
    const mm = Math.floor(s.stats.playTicks / 3600), ss = Math.floor(s.stats.playTicks / 60) % 60;
    label(ctx, 'FLIGHT TIME', RX + 10, 326); text(ctx, `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`, RX + 10, 338, C.text);
    // playfield frame edges
    ctx.fillStyle = C.line; ctx.fillRect(PF_X, 0, 1, H); ctx.fillRect(PF_X + PF_W - 1, 0, 1, H);
  }

  dialogueBox(g: Game, ctx: CanvasRenderingContext2D) {
    const d = g.mods.quest?.dlg; if (!d) return;
    const x = PF_X + 8, y = H - 92, w = PF_W - 16, h = 84;
    frame(ctx, x, y, w, h, C.hot, '#141226f0');
    frame(ctx, x + 6, y + 6, 44, 44, C.line, '#1d1b33');
    const portrait = SHEETS[d.node.portrait] ? d.node.portrait : 'pup';
    drawSprite(ctx, portrait, x + 28, y + 28);
    text(ctx, d.node.speaker.toUpperCase(), x + 58, y + 8, C.gold);
    ctx.fillStyle = C.hot; ctx.fillRect(x + 58, y + 17, d.node.speaker.length * 6, 1);
    const shown = d.node.text.slice(0, Math.floor(d.chars));
    wrap(shown, 46).slice(0, 6).forEach((l, i) => text(ctx, l, x + 58, y + 22 + i * 10, C.text));
    if (d.chars >= d.node.text.length && (this.t >> 4) % 2) text(ctx, 'SPACE >', x + w - 8, y + h - 11, C.line, { align: 'right' });
  }

  title(g: Game, ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    // starfield
    for (let i = 0; i < 90; i++) { const x = (i * 97) % W, y = (i * 53 + this.t * (0.3 + (i % 3) * 0.3)) % H; ctx.fillStyle = i % 5 ? '#4b4f8c' : '#b9c1f2'; ctx.fillRect(x, Math.floor(y), 1, 1); }
    // grid horizon
    ctx.strokeStyle = '#7a4fd155'; for (let i = 0; i < 12; i++) { const y = 250 + i * i * 1.2; ctx.beginPath(); ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(W, Math.round(y) + 0.5); ctx.stroke(); }
    for (let i = -10; i <= 10; i++) { ctx.beginPath(); ctx.moveTo(W / 2 + i * 12, 250); ctx.lineTo(W / 2 + i * 70, H); ctx.stroke(); }
    const bob = Math.round(Math.sin(this.t / 20) * 3);
    text(ctx, 'POODLE', W / 2, 40 + bob, C.pink, { align: 'center', scale: 5, shadow: '#a3285f' });
    text(ctx, 'PATROL', W / 2, 82 + bob, C.line, { align: 'center', scale: 5, shadow: '#1b5d8f' });
    text(ctx, 'OPERATION: GOOD GIRL', W / 2, 124, C.gold, { align: 'center' });
    drawSprite(ctx, 'poodle', W / 2, 162 + Math.round(Math.sin(this.t / 12) * 2), { frame: (this.t >> 3) % 2 });
    for (const [i, b] of ['cat_tabby', 'cat_siamese', 'cat_tuxedo', 'cat_persian', 'cat_calico', 'cat_sphynx'].entries()) {
      const x = 90 + i * 92, y = 150 + Math.round(Math.sin(this.t / 15 + i) * 6) - (i > 1 && i < 4 ? 30 : 0);
      if (i === 2 || i === 3) continue;
      drawSprite(ctx, b, x, y, { frame: ((this.t >> 4) + i) % 2 });
    }
    frame(ctx, W / 2 - 80, 200, 160, 82, C.line, '#141226dd');
    menu(ctx, this.titleItems(), this.sel, W / 2, 212, this.t);
    text(ctx, `HI-SCORE ${String(g.state.hiScore).padStart(8, '0')}`, W / 2, 296, C.dim, { align: 'center' });
    text(ctx, 'ARROWS + SPACE  /  GAMEPAD  /  TOUCH', W / 2, 340, '#4b4f8c', { align: 'center' });
  }

  map(g: Game, ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 70; i++) { const x = (i * 131) % W, y = (i * 71) % H; ctx.fillStyle = '#2f2f5a'; ctx.fillRect(x, y, 1, 1); }
    text(ctx, 'SECTOR MAP', W / 2, 12, C.line, { align: 'center', scale: 2, shadow: '#1b5d8f' });
    text(ctx, 'CHOOSE YOUR NEXT FLIGHT PATH', W / 2, 32, C.dim, { align: 'center' });
    const pos = this.layout(g);
    const exits = g.mods.world.exitsFrom(g.state.areaId);
    // edges
    for (const a of g.content.areas) for (const e of a.exits) {
      const p1 = pos[a.id], p2 = pos[e.to]; if (!p1 || !p2) continue;
      const live = a.id === g.state.areaId && exits.some((x: any) => x.to === e.to);
      ctx.strokeStyle = live ? C.hot : g.state.areasCleared.includes(e.to) && g.state.areasCleared.includes(a.id) ? C.line : '#2f2f5a';
      ctx.setLineDash(e.when ? [2, 3] : []); ctx.beginPath(); ctx.moveTo(p1[0] + 0.5, p1[1] + 0.5); ctx.lineTo(p2[0] + 0.5, p2[1] + 0.5); ctx.stroke(); ctx.setLineDash([]);
    }
    const selTo = exits[Math.min(this.mapSel, exits.length - 1)]?.to;
    for (const a of g.content.areas) {
      const p = pos[a.id]; if (!p) continue;
      const cleared = g.state.areasCleared.includes(a.id), here = a.id === g.state.areaId, sel = a.id === selTo;
      const c = sel ? C.gold : here ? C.hot : cleared ? C.line : '#4b4f8c';
      ctx.fillStyle = '#0b0a14'; ctx.fillRect(p[0] - 7, p[1] - 7, 14, 14);
      ctx.strokeStyle = c; ctx.strokeRect(p[0] - 6.5, p[1] - 6.5, 13, 13);
      if (cleared) { ctx.fillStyle = C.line; ctx.fillRect(p[0] - 3, p[1] - 3, 6, 6); }
      if (sel && (this.t >> 3) % 2) { ctx.strokeStyle = C.gold; ctx.strokeRect(p[0] - 9.5, p[1] - 9.5, 19, 19); }
      if (here) drawSprite(ctx, 'hud_paw', p[0], p[1] - 16);
    }
    if (selTo) {
      const a = g.mods.world.area(selTo);
      frame(ctx, W / 2 - 150, 290, 300, 56, C.hot, '#141226ee');
      text(ctx, a.name.toUpperCase(), W / 2, 298, C.gold, { align: 'center', scale: 1 });
      if (a.subtitle) text(ctx, a.subtitle, W / 2, 312, C.text, { align: 'center' });
      text(ctx, `${a.waves.length} WAVES${a.boss ? ' + BIG CAT' : ''}${a.bonus ? ' + BONANZA' : ''}  -  ${a.tod.toUpperCase()}`, W / 2, 326, C.dim, { align: 'center' });
      text(ctx, '< >  CHOOSE    SPACE  LAUNCH', W / 2, 336 + 0, '#4b4f8c', { align: 'center' });
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
    for (const [d, ids] of Object.entries(cols)) ids.forEach((id, i) => { out[id] = [Math.round(40 + (+d / Math.max(1, maxD)) * (W - 80)), Math.round(150 + (i - (ids.length - 1) / 2) * 60)]; });
    return out;
  }

  pause(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = 'rgba(11,10,20,0.7)'; ctx.fillRect(0, 0, W, H);
    frame(ctx, W / 2 - 90, 90, 180, 150, C.line, '#141226f0');
    text(ctx, 'PAUSED', W / 2, 104, C.line, { align: 'center', scale: 2, shadow: '#1b5d8f' });
    menu(ctx, this.pauseItems(), this.sel, W / 2, 140, this.t, 18);
    text(ctx, 'PROGRESS SAVES EVERY WAVE', W / 2, 224, C.dim, { align: 'center' });
  }
  settings(g: Game, ctx: CanvasRenderingContext2D) {
    const s = g.state.settings;
    ctx.fillStyle = 'rgba(11,10,20,0.8)'; ctx.fillRect(0, 0, W, H);
    frame(ctx, W / 2 - 120, 80, 240, 170, C.line, '#141226f0');
    text(ctx, 'SETTINGS', W / 2, 92, C.line, { align: 'center', scale: 2 });
    const rows: [string, string][] = [['MUSIC', '#'.repeat(Math.round(s.music * 10)).padEnd(10, '.')], ['SFX', '#'.repeat(Math.round(s.sfx * 10)).padEnd(10, '.')], ['SCREEN SHAKE', s.shake ? 'ON' : 'OFF'], ['TOUCH CONTROLS', s.touch.toUpperCase()], ['BACK', '']];
    rows.forEach(([k, v], i) => { const on = i === this.sel; text(ctx, (on ? '> ' : '  ') + k, W / 2 - 100, 124 + i * 20, on ? C.gold : C.text); text(ctx, v, W / 2 + 100, 124 + i * 20, C.line, { align: 'right' }); });
    text(ctx, '< > ADJUST', W / 2, 236, C.dim, { align: 'center' });
  }
  ending(g: Game, ctx: CanvasRenderingContext2D) {
    const e = g.content.endings.find(x => x.id === g.state.ending) ?? g.content.endings[0];
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 80; i++) { const x = (i * 97) % W, y = (i * 53 + this.endingT * 0.2 * (1 + i % 3)) % H; ctx.fillStyle = i % 4 ? '#4b4f8c' : '#ffd166'; ctx.fillRect(x, Math.floor(y), 1, 1); }
    text(ctx, e.title.toUpperCase(), W / 2, 30, C.gold, { align: 'center', scale: 2, shadow: '#a3285f' });
    drawSprite(ctx, 'poodle', W / 2, 74, { frame: (this.endingT >> 3) % 2 });
    const pups = g.state.inventory.pups ?? 0;
    for (let i = 0; i < Math.min(8, pups); i++) drawSprite(ctx, 'pup', W / 2 - 70 + i * 20 - (i >= 4 ? -20 : 20) * 0 + (i >= 4 ? 30 : -30), 98 + Math.round(Math.sin(this.endingT / 10 + i) * 2));
    const lines = e.text.flatMap(t => wrap(t, 70));
    const shown = Math.floor(this.endingT / 40);
    lines.slice(0, shown + 1).forEach((l, i) => text(ctx, l, W / 2, 124 + i * 12, C.text, { align: 'center' }));
    const s = g.state; const y = 124 + lines.length * 12 + 12;
    if (shown > lines.length) {
      text(ctx, `FINAL SCORE ${s.score}   CATS BOOPED ${s.stats.catsBooped}   PUPS ${pups}   MEMORIES ${s.memories.length}/${g.content.memories.length}`, W / 2, y, C.line, { align: 'center' });
      const mm = Math.floor(s.stats.playTicks / 3600);
      text(ctx, `FLIGHT TIME ${mm} MIN   NAPS TAKEN ${s.stats.naps}`, W / 2, y + 12, C.dim, { align: 'center' });
    }
    if (this.endingT > 240 && (this.t >> 4) % 2) text(ctx, 'PRESS SPACE', W / 2, 340, C.gold, { align: 'center' });
  }
  recovery(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    frame(ctx, W / 2 - 160, 90, 320, 170, C.hot, '#141226');
    drawSprite(ctx, 'cat_tabby', W / 2, 124);
    text(ctx, 'UH OH! A CAT CHEWED YOUR SAVE.', W / 2, 150, C.gold, { align: 'center' });
    text(ctx, 'NOTHING IS BROKEN. PICK AN OPTION:', W / 2, 166, C.text, { align: 'center' });
    menu(ctx, ['TRY BACKUP SAVE', 'START FRESH'], this.sel, W / 2, 196, this.t, 18);
  }
}
export const makeUI = (): Module => new UI();
