import type { Game, Module } from '../core/game';
import { PF_X, PF_W } from '../core/game';
import { text } from '../art/font';
/** Treat Bonanza: Galaga-style challenging stages. Cats fly patterns and never attack. */
class Minigames implements Module {
  id = 'minigames';
  api = this;
  g!: Game;
  result: { hits: number; total: number; t: number; bonus: number } | null = null;
  banner = 0;
  init(g: Game) {
    this.g = g;
    g.bus.on('bonus:result', (p: any) => {
      const perfect = p.hits === p.total; const bonus = perfect ? 10000 : p.hits * 100;
      g.ops.addScore(bonus);
      this.result = { hits: p.hits, total: p.total, t: g.headless ? 1 : 180, bonus };
      if (perfect) g.ops.setFlag('perfect_bonus'); g.mods.audio?.sfx(perfect ? 'quest' : 'pickup');
    });
  }
  startBonus(id: string) {
    const def = this.g.content.bonus.find(b => b.id === id);
    if (!def) { this.g.bus.emit('bonus:end', { id, hits: 0 }); return; }
    this.g.setScene('bonus'); this.banner = 120;
    this.g.bus.emit('bonus:start', { id });
    this.g.mods.interaction.startBonus(def);
  }
  update(g: Game) {
    if (g.paused) return;
    if (this.banner > 0) this.banner--;
    if (this.result && --this.result.t <= 0) {
      const r = this.result; this.result = null;
      if (g.state.scene === 'bonus') g.setScene('play');
      g.bus.emit('bonus:end', { hits: r.hits, total: r.total });
    }
  }
  overlay(g: Game, ctx: CanvasRenderingContext2D) {
    const cx = PF_X + PF_W / 2;
    if (g.state.scene === 'bonus' && this.banner > 0) {
      text(ctx, 'TREAT BONANZA!', cx, 140, '#ffd166', { align: 'center', scale: 2, shadow: '#a3285f' });
      text(ctx, 'BOOP THEM ALL FOR A PERFECT BONUS', cx, 164, '#ffffff', { align: 'center', shadow: '#0b0a14' });
    }
    if (this.result) {
      const r = this.result;
      ctx.fillStyle = '#0b0a14cc'; ctx.fillRect(PF_X + 40, 120, PF_W - 80, 80);
      ctx.fillStyle = '#4ef2e6'; ctx.fillRect(PF_X + 40, 120, PF_W - 80, 1); ctx.fillRect(PF_X + 40, 199, PF_W - 80, 1);
      text(ctx, r.hits === r.total ? 'PERFECT!' : 'BONANZA RESULTS', cx, 132, r.hits === r.total ? '#ffd166' : '#4ef2e6', { align: 'center', scale: 2 });
      text(ctx, `CATS BOOPED  ${r.hits} / ${r.total}`, cx, 160, '#ffffff', { align: 'center' });
      text(ctx, `BONUS  ${r.bonus}`, cx, 176, '#ff9ec8', { align: 'center' });
    }
  }
}
export const makeMinigames = (): Module => new Minigames();
