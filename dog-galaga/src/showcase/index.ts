import type { Game } from '../core/game';
import { W, H } from '../core/game';
import { SHEETS, drawSprite } from '../art/sprite';
import { text } from '../art/font';
import { PALETTE, col } from '../core/palette';
import { TRACKS } from '../audio/tracks';
import { SFX_IDS } from '../audio/sfx';
import { AMBIENCE_IDS } from '../audio/ambience';
import type { RenderStats } from '../audio/offline';

/** ?showcase=<module> stages a representative scene for one module (for screenshots + critics). */
export function runShowcase(g: Game, which: string, p: URLSearchParams) {
  const area = p.get('area') ?? 'backyard';
  const W_ = g.mods.world;
  const quiet = () => { W_.phase = 'done'; W_.titleCard = 0; };
  switch (which) {
    case 'art': gallery(g, p.get('filter') ?? ''); break;
    case 'world': W_.enterArea(area, 0); quiet(); g.mods.quest.dlg = null; g.setScene('play'); g.mods.player.y = 999; break;
    case 'player': W_.enterArea(area, 0); quiet(); g.mods.quest.dlg = null; g.setScene('play'); g.mods.player.power('shield', 9999); g.mods.player.buddy = true; g.mods.player.invuln = 0; break;
    case 'interaction': {
      const I = g.mods.interaction; const st = p.get('stage') ?? 'play';
      W_.enterArea(area, +(p.get('wave') ?? 2)); g.mods.quest.dlg = null; g.setScene('play'); W_.titleCard = 0;
      // interaction stages itself once its wave is live; 'play' lets the autopilot fly for `ticks`
      if (st !== 'play') g.mods.ui?.muteToasts?.(true);
      if (I) { I.stageReq = st; I.stageAt = +(p.get('at') ?? 0); I.stagePhase = +(p.get('phase') ?? 0); }
      const n = st === 'play' ? +(p.get('ticks') ?? 700) : 400;
      for (let i = 0; i < n && !g.paused; i++) g.step();
      break;
    }
    case 'boss': { const a = W_.area(area); W_.enterArea(area, a.waves.length); g.mods.quest.dlg = null; g.setScene('play'); W_.titleCard = 0; for (let i = 0; i < 400; i++) g.step(); break; }
    case 'effects': W_.enterArea(area, 0); quiet(); g.mods.quest.dlg = null; g.setScene('play');
      g.mods.ui?.muteToasts?.(true);
      g.mods.effects.stage(p.get('fx') ?? 'grid', p.has('fxt') ? +p.get('fxt')! : -1); break;
    case 'quest': case 'dialogue': W_.enterArea(area, 0); W_.titleCard = 0; g.mods.quest.dialogue(p.get('node') ?? W_.area(area).intro ?? 'intro-backyard-1'); g.mods.quest.dlg.chars = 999; break;
    case 'ui': W_.enterArea(area, 2); g.mods.quest.dlg = null; g.setScene('play'); W_.titleCard = 0; for (let i = 0; i < 300; i++) g.step(); g.mods.ui.toast('NEW QUEST: LOST PUPS'); if (p.get('menu') === 'pause') g.mods.ui.openPause(); if (p.get('menu') === 'settings') { g.mods.ui.menuOpen = 'settings'; g.mods.ui.settingsFrom = 'pause'; g.paused = true; } break;
    case 'title': g.setScene('title'); break;
    case 'map': g.state.areasCleared = ['backyard', 'street']; g.state.areaId = 'street'; g.setScene('map'); break;
    case 'journal': g.state.memories = g.content.memories.slice(0, 3).map(m => m.id); g.mods.ui.menuOpen = 'journal'; g.mods.journal.open(); g.mods.journal.tab = +(p.get('tab') ?? 1); break;
    case 'minigames': case 'bonus': { const a = g.content.areas.find(a => a.bonus) ?? W_.area(area); W_.enterArea(a.id, 0); quiet(); g.mods.quest.dlg = null; g.setScene('play'); g.mods.minigames.startBonus(a.bonus); for (let i = 0; i < 260; i++) g.step(); break; }
    case 'save': if (g.mods.save?.stage) g.mods.save.stage(p.get('stage') ?? 'recovery'); else g.setScene('recovery'); break;
    case 'memories': { const m = g.content.memories[0]; W_.enterArea(m?.area ?? area, m?.wave ?? 0); g.mods.quest.dlg = null; g.setScene('play'); W_.titleCard = 0; for (let i = 0; i < 400; i++) g.step(); if (m) g.mods.interaction.spawnPickup('memory:' + m.id, 224, 200); break; }
    case 'ending':
      g.state.ending = p.get('ending') ?? g.content.endings[0].id; g.state.inventory.pups = 6;
      g.state.score = 184250; g.state.hiScore = 184250;
      g.state.stats = { ...g.state.stats, shots: 2140, hits: 1610, catsBooped: 1312, naps: 3, playTicks: 60 * 60 * 47 };
      g.state.memories = g.content.memories.slice(0, 14).map(m => m.id);
      g.setScene('ending'); g.mods.ui.endingT = 2000; break;
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
      if (x + w + 8 > W) { x = 8; y += rowH + 21; rowH = 0; }
      drawSprite(ctx, name, x + w / 2, y + h / 2);
      // full name (minus the family prefix), wrapped onto a second line when wider than the cell
      const label = name.replace(/^(cat_|boss_|pk_|hud_|portrait_|blt_)/, '').toUpperCase(); const per = Math.max(5, Math.floor((Math.max(w, 30) + 6) / 6));
      text(ctx, label.slice(0, per), x, y + h + 2, '#b9c1f2');
      if (label.length > per) text(ctx, label.slice(per, per * 2), x, y + h + 9, '#b9c1f2');
      x += Math.max(w, 30) + 8; rowH = Math.max(rowH, h);
    }
    PALETTE.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(8 + i * 12, H - 14, 12, 10); });
  } });
}

/** Audio can't be heard by critics, so render every track/bed/sfx offline and draw its envelope and levels.
 *  Renders run a few at a time (in parallel) into fixed slots, so the layout never reflows and progress shows. */
function audioShowcase(g: Game) {
  g.setScene('boot');
  type Job = { id: string; kind: string; run: (A: typeof import('../audio/offline')) => Promise<RenderStats> };
  const jobs: Job[] = [];
  for (const [id, tr] of Object.entries(TRACKS)) jobs.push({ id, kind: 'music', run: A => A.renderTrackOffline(id, tr.once ? 6 : 48) });
  for (const id of AMBIENCE_IDS) jobs.push({ id, kind: 'amb', run: A => A.renderAmbienceOffline(id, 10) });
  for (const id of SFX_IDS) jobs.push({ id, kind: 'sfx', run: A => A.renderSfxOffline(id) });
  jobs.push({ id: 'boss+space', kind: 'mix', run: A => A.renderMixOffline('boss', 'space', 8) });
  jobs.push({ id: 'stage>street', kind: 'flow', run: A => A.renderSequenceOffline(['stage', 'street'], 16) });
  jobs.push({ id: 'boss>vict>map', kind: 'flow', run: A => A.renderSequenceOffline(['boss', 'victory', 'map'], 16, 5) });
  jobs.push({ id: 'nap>stage>park', kind: 'flow', run: A => A.renderSequenceOffline(['nap', 'stage', 'park'], 16) });
  const rows: { id: string; kind: string; r: RenderStats | null }[] = jobs.map(j => ({ id: j.id, kind: j.kind, r: null }));
  let done = 0;
  const api = (window as any).__game; if (api) api.audioReport = rows;
  (async () => {
    const A = await import('../audio/offline');
    let next = 0;
    const worker = async () => { while (next < jobs.length) { const i = next++; rows[i].r = await jobs[i].run(A); done++; } };
    await Promise.all(Array.from({ length: 4 }, worker));
    document.body.dataset.audioDone = '1';
  })().catch(e => g.reportError('showcase', e));
  const PER_COL = 18, COL_W = 212, ROW_H = 19, ENV_W = 200;
  g.register({ id: 'showcase', overlay: (_g, ctx) => {
    ctx.fillStyle = col(0); ctx.fillRect(0, 0, W, H);
    text(ctx, 'AUDIO  PEAK / RMS / CLIPPED   ENVELOPE: PEAK PINK, RMS CYAN', 8, 2, col('l'));
    text(ctx, done < rows.length ? `RENDERING ${done}/${rows.length}` : `DONE ${done}/${rows.length}`, W - 8, 2, done < rows.length ? col('f') : col('i'), { align: 'right' });
    rows.forEach((row, i) => {
      const x = 6 + Math.floor(i / PER_COL) * COL_W, y = 12 + (i % PER_COL) * ROW_H;
      const r = row.r; const bad = !!r && (!r.ok || r.clipped > 0 || r.peak >= 0.99);
      text(ctx, `${row.kind} ${row.id}`.slice(0, 20), x, y, bad ? col('r') : r ? col(6) : col('p'));
      text(ctx, !r ? '...' : r.ok ? `${r.peak.toFixed(2)} ${r.rms.toFixed(3)} ${r.clipped}` : 'ERR', x + ENV_W, y, col(5), { align: 'right' });
      if (!r) return;
      const draw = (env: number[], c: string) => {
        const n = Math.min(env.length, ENV_W); ctx.fillStyle = c;
        for (let k = 0; k < n; k++) { const v = Math.round((env[Math.floor(k * env.length / n)] ?? 0) * 10); if (v > 0) ctx.fillRect(x + k, y + 18 - v, 1, v); }
      };
      ctx.fillStyle = col(1); ctx.fillRect(x, y + 8, ENV_W, 10);
      draw(r.envelope ?? [], bad ? col('r') : col('d'));
      draw((r.envRms ?? []).map(v => Math.min(1, v * 3)), col('l'));
    });
  } });
}
