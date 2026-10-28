import type { Game } from '../core/game';
import { W, H } from '../core/game';
import { SHEETS, drawSprite } from '../art/sprite';
import { text } from '../art/font';
import { PALETTE } from '../core/palette';

/** ?showcase=<module> stages a representative scene for one module (for screenshots + critics). */
export function runShowcase(g: Game, which: string, p: URLSearchParams) {
  if (p.get('touch')) g.state.settings.touch = 'on';
  const area = p.get('area') ?? 'backyard';
  const W_ = g.mods.world;
  const quiet = () => { W_.phase = 'done'; W_.titleCard = 0; };
  switch (which) {
    case 'art': gallery(g, p.get('filter') ?? ''); break;
    case 'world': W_.enterArea(area, 0); quiet(); g.mods.quest.dlg = null; g.setScene('play'); g.mods.player.y = 999; break;
    case 'player': W_.enterArea(area, 0); quiet(); g.mods.quest.dlg = null; g.setScene('play'); g.mods.player.power('shield', 9999); g.mods.player.buddy = true; g.mods.player.invuln = 0; break;
    case 'interaction': W_.enterArea(area, +(p.get('wave') ?? 2)); g.mods.quest.dlg = null; g.setScene('play'); g.mods.world.titleCard = 0; for (let i = 0; i < +(p.get('ticks') ?? 700); i++) g.step(); break;
    case 'boss': { const a = W_.area(area); W_.enterArea(area, a.waves.length); g.mods.quest.dlg = null; g.setScene('play'); W_.titleCard = 0; for (let i = 0; i < 400; i++) g.step(); break; }
    case 'effects': W_.enterArea(area, 0); quiet(); g.mods.quest.dlg = null; g.setScene('play');
      if (p.get('fx') === 'boss') { g.mods.effects.burst(224, 120, 'bigboop'); g.bus.emit('boss:defeat', { bossId: 'boss_whiskers', showcase: true }); break; }
      for (const [i, k] of ['boop', 'splat', 'sparkle', 'shield', 'poof', 'hearts', 'confetti', 'boom'].entries()) g.mods.effects.burst(130 + (i % 4) * 64, 90 + Math.floor(i / 4) * 110 + (i % 2) * 20, k);
      g.bus.emit('cat:boop', { breed: 'calico', x: 130, y: 90 });
      g.mods.effects.floatText(224, 60, '400'); g.mods.effects.floatText(330, 60, '1600');
      for (let i = 0; i < +(p.get('fxt') ?? 6); i++) g.mods.effects.update(g); break;
    case 'quest': case 'dialogue': W_.enterArea(area, 0); W_.titleCard = 0; g.mods.quest.dialogue(p.get('node') ?? W_.area(area).intro ?? 'intro-backyard-1'); g.mods.quest.dlg.chars = 999; break;
    case 'ui': W_.enterArea(area, 2); g.mods.quest.dlg = null; g.setScene('play'); W_.titleCard = 0; for (let i = 0; i < 300; i++) g.step(); g.mods.ui.toast('NEW QUEST: LOST PUPS'); if (p.get('menu') === 'pause') g.mods.ui.openPause(); if (p.get('menu') === 'settings') { g.mods.ui.menuOpen = 'settings'; g.mods.ui.settingsFrom = 'pause'; g.paused = true; } break;
    case 'title': g.setScene('title'); break;
    case 'map': g.state.areasCleared = ['backyard', 'street']; g.state.areaId = 'street'; g.setScene('map'); break;
    case 'journal': g.state.memories = g.content.memories.slice(0, 3).map(m => m.id); g.mods.ui.menuOpen = 'journal'; g.mods.journal.open(); g.mods.journal.tab = +(p.get('tab') ?? 1); break;
    case 'minigames': case 'bonus': { const a = g.content.areas.find(a => a.bonus) ?? W_.area(area); W_.enterArea(a.id, 0); quiet(); g.mods.quest.dlg = null; g.setScene('play'); g.mods.minigames.startBonus(a.bonus); for (let i = 0; i < 260; i++) g.step(); break; }
    case 'save': g.setScene('recovery'); break;
    case 'memories': { const m = g.content.memories[0]; W_.enterArea(m?.area ?? area, m?.wave ?? 0); g.mods.quest.dlg = null; g.setScene('play'); W_.titleCard = 0; for (let i = 0; i < 400; i++) g.step(); if (m) g.mods.interaction.spawnPickup('memory:' + m.id, 224, 200); break; }
    case 'ending': g.state.ending = p.get('ending') ?? g.content.endings[0].id; g.state.inventory.pups = 6; g.setScene('ending'); g.mods.ui.endingT = 2000; break;
    case 'audio': audioShowcase(g); break;
    default: g.reportError('showcase', `unknown showcase ${which}`);
  }
}

function gallery(g: Game, filter: string) {
  g.setScene('boot');
  g.register({ id: 'showcase', overlay: (_g, ctx) => {
    ctx.fillStyle = '#2a2438'; ctx.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 16) for (let x = (y / 16) % 2 ? 16 : 0; x < W; x += 32) { ctx.fillStyle = '#1d1b33'; ctx.fillRect(x, y, 16, 16); }
    let x = 8, y = 8, rowH = 0;
    for (const name of Object.keys(SHEETS).filter(n => n.includes(filter))) {
      const rows = SHEETS[name].rows; const w = (SHEETS[name].mirror ? 2 : 1) * rows[0].length, h = rows.length;
      if (x + w + 8 > W) { x = 8; y += rowH + 14; rowH = 0; }
      drawSprite(ctx, name, x + w / 2, y + h / 2);
      text(ctx, name.replace(/^(cat_|boss_|pk_|hud_)/, '').slice(0, Math.max(3, Math.floor((w + 6) / 6))), x, y + h + 2, '#b9c1f2');
      x += Math.max(w, 30) + 8; rowH = Math.max(rowH, h);
    }
    PALETTE.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(8 + i * 12, H - 14, 12, 10); });
  } });
}

/** Audio can't be heard by critics, so render every track/bed/sfx offline and draw its envelope and levels. */
function audioShowcase(g: Game) {
  g.setScene('boot');
  const rows: { id: string; kind: string; r: any }[] = [];
  (window as any).__game && ((window as any).__game.audioReport = rows);
  (async () => {
    const A: any = await import('../audio/index');
    for (const id of Object.keys(A.TRACKS)) rows.push({ id, kind: 'music', r: await A.renderTrackOffline(id, 16) });
    for (const id of A.AMBIENCE_IDS) rows.push({ id, kind: 'amb', r: await A.renderAmbienceOffline(id, 10) });
    for (const id of A.SFX_IDS) rows.push({ id, kind: 'sfx', r: await A.renderSfxOffline(id) });
    rows.push({ id: 'boss+space', kind: 'mix', r: await A.renderMixOffline('boss', 'space', 8) });
    document.body.dataset.audioDone = '1';
  })().catch(e => g.reportError('showcase', e));
  g.register({ id: 'showcase', overlay: (_g, ctx) => {
    ctx.fillStyle = '#0b0a14'; ctx.fillRect(0, 0, W, H);
    text(ctx, 'AUDIO SHOWCASE  (OFFLINE RENDER: PEAK / RMS / CLIPPED + ENVELOPE)', 8, 4, '#4ef2e6');
    rows.forEach((row, i) => {
      const col = Math.floor(i / 21), y = 16 + (i % 21) * 16, x = 8 + col * 316;
      const r = row.r ?? {}; const bad = !r.ok || r.clipped > 0 || r.peak >= 0.99;
      text(ctx, `${row.kind} ${row.id}`.slice(0, 18), x, y, bad ? '#ff5a4f' : '#ffffff');
      text(ctx, r.ok ? `${(r.peak ?? 0).toFixed(2)} ${(r.rms ?? 0).toFixed(3)} ${r.clipped ?? 0}` : 'ERR', x + 112, y, '#b9c1f2');
      const env: number[] = r.envelope ?? []; const n = Math.min(env.length, 110);
      for (let k = 0; k < n; k++) { const v = Math.round((env[Math.floor(k * env.length / n)] ?? 0) * 12); ctx.fillStyle = bad ? '#ff5a4f' : '#e8578f'; ctx.fillRect(x + 196 + k, y + 12 - v, 1, Math.max(1, v)); }
    });
  } });
}
