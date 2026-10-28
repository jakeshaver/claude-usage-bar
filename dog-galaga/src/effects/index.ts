import type { Game, Module } from '../core/game';
import { W, H } from '../core/game';
import { col } from '../core/palette';
import { text } from '../art/font';
import { Rng } from '../core/rng';

interface Part { x: number; y: number; vx: number; vy: number; life: number; max: number; k: string; size: number; kind: 'dot' | 'star' | 'ring' | 'text'; label?: string }
const KINDS: Record<string, { n: number; keys: string[]; speed: number; life: number; ring?: string }> = {
  boop: { n: 14, keys: ['6', 'c', 'f', '7'], speed: 2.2, life: 26, ring: '6' },
  bigboop: { n: 60, keys: ['6', 'c', 'f', 'd', 'l'], speed: 3.6, life: 60, ring: 'f' },
  poof: { n: 18, keys: ['6', '5', 'o'], speed: 1.4, life: 30 },
  sparkle: { n: 10, keys: ['f', '6', 'l'], speed: 1.5, life: 24 },
  shield: { n: 16, keys: ['l', 'm', '6'], speed: 2.4, life: 22, ring: 'l' },
};
/** Effects: particles, screen shake, flashes, floating text. Purely visual; owns its own RNG stream. */
class Effects implements Module {
  id = 'effects';
  api = this;
  g!: Game;
  parts: Part[] = [];
  shakeAmt = 0; shakeT = 0; flashC = ''; flashT = 0;
  rng = new Rng(4242); // visual-only stream: never affects sim determinism
  init(g: Game) { this.g = g; }
  burst(x: number, y: number, kind: string) {
    if (this.g.headless) return;
    const d = KINDS[kind] ?? KINDS.boop;
    for (let i = 0; i < d.n; i++) {
      const a = this.rng.range(0, Math.PI * 2), s = this.rng.range(0.4, 1) * d.speed;
      this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: d.life, max: d.life, k: this.rng.pick(d.keys), size: this.rng.chance(0.3) ? 2 : 1, kind: i % 5 === 0 ? 'star' : 'dot' });
    }
    if (d.ring) this.parts.push({ x, y, vx: 0, vy: 0, life: 14, max: 14, k: d.ring, size: 1, kind: 'ring' });
  }
  floatText(x: number, y: number, label: string) { if (!this.g.headless) this.parts.push({ x, y, vx: 0, vy: -0.6, life: 40, max: 40, k: 'f', size: 1, kind: 'text', label }); }
  shake(px: number, ticks: number) { if (!this.g.state.settings.shake) return; this.shakeAmt = Math.max(this.shakeAmt, px); this.shakeT = Math.max(this.shakeT, ticks); }
  flash(c: string, ticks: number) { this.flashC = c; this.flashT = ticks; }
  shakeOffset() { if (this.shakeT <= 0) return { x: 0, y: 0 }; const a = this.shakeAmt * (this.shakeT / 20); return { x: this.rng.range(-a, a), y: this.rng.range(-a, a) }; }
  update(g: Game) {
    if (g.paused) return;
    if (this.shakeT > 0) this.shakeT--; else this.shakeAmt = 0;
    if (this.flashT > 0) this.flashT--;
    for (const p of this.parts) { p.x += p.vx; p.y += p.vy; p.vx *= 0.94; p.vy *= 0.94; p.life--; }
    this.parts = this.parts.filter(p => p.life > 0);
    if (this.parts.length > 600) this.parts.splice(0, this.parts.length - 600);
  }
  render(g: Game, r: any) {
    r.push(4, 0, (ctx: CanvasRenderingContext2D) => {
      for (const p of this.parts) {
        const x = Math.round(p.x), y = Math.round(p.y);
        if (p.kind === 'text') { text(ctx, p.label!, x, y, p.life > 10 || (p.life >> 1) % 2 ? '#ffd166' : '#ffffff', { align: 'center', shadow: '#0b0a14' }); continue; }
        ctx.fillStyle = col(p.k);
        if (p.kind === 'ring') { const rad = (1 - p.life / p.max) * 22 + 4; ctx.strokeStyle = col(p.k); ctx.globalAlpha = p.life / p.max; ctx.beginPath(); ctx.arc(x, y, Math.round(rad), 0, 7); ctx.stroke(); ctx.globalAlpha = 1; continue; }
        if (p.kind === 'star' && p.life > p.max / 3) { ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3); }
        else ctx.fillRect(x, y, p.size, p.size);
      }
    });
  }
  overlay(_g: Game, ctx: CanvasRenderingContext2D) {
    if (this.flashT > 0) { ctx.globalAlpha = 0.25 * (this.flashT / 6); ctx.fillStyle = this.flashC; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  }
}
export const makeEffects = (): Module => new Effects();
