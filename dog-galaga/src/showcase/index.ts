import type { Game } from '../core/game';
import { W, H } from '../core/game';
import { SHEETS, drawSprite } from '../art/sprite';
import { text } from '../art/font';
import { PALETTE } from '../core/palette';

/** ?showcase=<module> stages a representative scene for one module (for screenshots + critics). */
export function runShowcase(g: Game, which: string, p: URLSearchParams) {
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
      for (const [i, k] of ['boop', 'bigboop', 'sparkle', 'shield', 'poof'].entries()) g.mods.effects.burst(160 + i * 40, 120 + (i % 2) * 40, k);
      g.mods.effects.floatText(224, 90, '400'); for (let i = 0; i < 6; i++) g.mods.effects.update(g); break;
    case 'quest': case 'dialogue': W_.enterArea(area, 0); W_.titleCard = 0; g.mods.quest.dialogue(p.get('node') ?? W_.area(area).intro ?? 'intro-backyard-1'); g.mods.quest.dlg.chars = 999; break;
    case 'ui': W_.enterArea(area, 2); g.mods.quest.dlg = null; g.setScene('play'); W_.titleCard = 0; for (let i = 0; i < 300; i++) g.step(); g.mods.ui.toast('NEW QUEST: LOST PUPS'); if (p.get('menu') === 'pause') g.mods.ui.openPause(); break;
    case 'title': g.setScene('title'); break;
    case 'map': g.state.areasCleared = ['backyard', 'street']; g.state.areaId = 'street'; g.setScene('map'); break;
    case 'journal': g.state.memories = g.content.memories.slice(0, 3).map(m => m.id); g.mods.ui.menuOpen = 'journal'; g.mods.journal.open(); g.mods.journal.tab = +(p.get('tab') ?? 1); break;
    case 'minigames': case 'bonus': { const a = g.content.areas.find(a => a.bonus) ?? W_.area(area); W_.enterArea(a.id, 0); quiet(); g.mods.quest.dlg = null; g.setScene('play'); g.mods.minigames.startBonus(a.bonus); for (let i = 0; i < 260; i++) g.step(); break; }
    case 'save': g.setScene('recovery'); break;
    case 'memories': { const m = g.content.memories[0]; W_.enterArea(m?.area ?? area, m?.wave ?? 0); g.mods.quest.dlg = null; g.setScene('play'); W_.titleCard = 0; for (let i = 0; i < 400; i++) g.step(); if (m) g.mods.interaction.spawnPickup('memory:' + m.id, 224, 200); break; }
    case 'ending': g.state.ending = p.get('ending') ?? g.content.endings[0].id; g.state.inventory.pups = 6; g.setScene('ending'); g.mods.ui.endingT = 2000; break;
    case 'audio': g.setScene('title'); break;
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
