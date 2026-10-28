import type { Game, Module } from '../core/game';
import { W, H } from '../core/game';
import { text, wrap } from '../art/font';
import { drawSprite } from '../art/sprite';
import { C, frame, scanlines } from '../ui/draw';

const TABS = ['QUESTS', 'MEMORIES', 'BESTIARY'] as const;
/** Journal: quests, memories (polaroids), and the cat bestiary. Opened from pause or title. */
class Journal implements Module {
  id = 'journal';
  api = this;
  tab = 0; sel = 0; t = 0;
  open() { this.tab = 0; this.sel = 0; }
  seenBreeds(g: Game) { const s = new Set<string>(); for (const e of g.bus.log) if (e.evt === 'cat:boop') s.add(e.p.breed); return s; }
  update2(g: Game, close: () => void) {
    const I = g.input; this.t++;
    if (I.pressed('left')) { this.tab = (this.tab + 2) % 3; this.sel = 0; g.mods.audio?.sfx('blip'); }
    if (I.pressed('right')) { this.tab = (this.tab + 1) % 3; this.sel = 0; g.mods.audio?.sfx('blip'); }
    const n = this.items(g).length;
    if (I.pressed('up')) this.sel = Math.max(0, this.sel - 1);
    if (I.pressed('down')) this.sel = Math.min(Math.max(0, n - 1), this.sel + 1);
    if (I.pressed('back') || I.pressed('pause')) close();
  }
  items(g: Game): { name: string; body: string; sprite: string; known: boolean; extra?: string }[] {
    const s = g.state;
    if (this.tab === 0) return g.content.quests.map(q => {
      const st = s.quests[q.id] ?? 'locked'; const pr = g.mods.quest.progress(q);
      return { name: st === 'locked' ? '???' : q.name, body: st === 'locked' ? 'Keep flying to discover this quest.' : q.desc, sprite: st === 'done' ? 'hud_paw' : 'pk_treat', known: st !== 'locked', extra: st === 'done' ? 'COMPLETE' : st === 'active' ? `${pr.have}/${pr.need}` : '' };
    });
    if (this.tab === 1) return g.content.memories.map(m => {
      const got = s.memories.includes(m.id); const a = g.content.areas.find(a => a.id === m.area);
      return { name: got ? m.title : '???', body: got ? m.text : `Somewhere in ${a?.name ?? 'the sky'}. Look for a glowing cat.`, sprite: 'pk_memory', known: got };
    });
    return g.content.enemies.filter(e => e.behavior !== 'boss' || true).map(e => ({ name: e.name, body: e.bestiary, sprite: e.sprite, known: true, extra: `${e.points} PTS  HP ${e.hp}` }));
  }
  draw(g: Game, ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = 'rgba(11,10,20,0.92)'; ctx.fillRect(0, 0, W, H);
    frame(ctx, 20, 14, W - 40, H - 28, C.line, '#141226'); scanlines(ctx, 20, 14, W - 40, H - 28);
    text(ctx, "POM'S JOURNAL", W / 2, 24, C.pink, { align: 'center', scale: 2, shadow: '#a3285f' });
    TABS.forEach((t, i) => { const x = W / 2 - 120 + i * 120; const on = i === this.tab; if (on) { ctx.fillStyle = '#e8578f44'; ctx.fillRect(x - 40, 44, 80, 13); } text(ctx, t, x, 47, on ? C.gold : C.dim, { align: 'center' }); });
    const items = this.items(g);
    const start = Math.max(0, Math.min(this.sel - 6, items.length - 14));
    items.slice(start, start + 14).forEach((it, k) => {
      const i = start + k; const on = i === this.sel; const y = 66 + k * 18;
      if (on) { ctx.fillStyle = '#4ef2e622'; ctx.fillRect(30, y - 3, 250, 16); }
      text(ctx, it.name.toUpperCase().slice(0, 30), 40, y + 2, it.known ? (on ? C.gold : C.text) : '#4b4f8c');
      if (it.extra) text(ctx, it.extra, 276, y + 2, C.line, { align: 'right' });
    });
    const cur = items[this.sel];
    if (cur) {
      frame(ctx, 300, 66, 312, 250, C.hot, '#1d1b33');
      if (this.tab === 1 && cur.known) { ctx.fillStyle = '#ffffff'; ctx.fillRect(416, 80, 80, 90); ctx.fillStyle = '#26a6c9'; ctx.fillRect(422, 86, 68, 62); drawSprite(ctx, 'poodle', 446, 120); drawSprite(ctx, 'pup', 470, 132); ctx.fillStyle = '#3fa34d'; ctx.fillRect(422, 140, 68, 8); }
      else if (cur.known || this.tab !== 1) drawSprite(ctx, cur.sprite, 456, 120);
      text(ctx, cur.name.toUpperCase(), 456, 184, C.gold, { align: 'center' });
      wrap(cur.body, 46).slice(0, 10).forEach((l, i) => text(ctx, l, 312, 204 + i * 11, C.text));
    }
    text(ctx, '< > TAB   ^ V SELECT   ESC CLOSE', W / 2, H - 26, C.dim, { align: 'center' });
  }
}
export const makeJournal = (): Module => new Journal();
