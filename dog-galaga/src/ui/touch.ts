import type { Game } from '../core/game';
import type { Action } from '../core/input';
import { W, H } from '../core/game';
import { C } from './draw';
import { text } from '../art/font';
/** On-screen touch controls drawn in the side panels: d-pad left, TOOT + pause right. */
export class Touch {
  active = false; g!: Game;
  pads: { a: Action; x: number; y: number; r: number; label: string }[] = [
    { a: 'left', x: 30, y: 300, r: 18, label: '<' }, { a: 'right', x: 94, y: 300, r: 18, label: '>' },
    { a: 'up', x: 62, y: 268, r: 18, label: '^' }, { a: 'down', x: 62, y: 332, r: 16, label: 'V' },
    { a: 'fire', x: 576, y: 296, r: 30, label: 'TOOT' }, { a: 'pause', x: 610, y: 20, r: 14, label: 'II' },
  ];
  attach(g: Game) {
    this.g = g;
    const cv = () => document.getElementById('game') as HTMLCanvasElement | null;
    const update = (e: TouchEvent) => {
      const c = cv(); if (!c) return; this.active = true; g.input.lastDevice = 'touch';
      e.preventDefault();
      const r = c.getBoundingClientRect(); const set = new Set<Action>();
      for (const t of Array.from(e.touches)) {
        const x = (t.clientX - r.left) / r.width * W, y = (t.clientY - r.top) / r.height * H;
        for (const p of this.pads) if (Math.hypot(x - p.x, y - p.y) < p.r + 8) { set.add(p.a); if (p.a === 'fire') set.add('confirm'); }
        // tap in the middle area acts as confirm (menus)
        if (x > 128 && x < 512 && g.state.scene !== 'play') set.add('confirm');
      }
      g.input.touch = set;
    };
    addEventListener('touchstart', update, { passive: false });
    addEventListener('touchmove', update, { passive: false });
    addEventListener('touchend', update, { passive: false });
    addEventListener('touchcancel', update, { passive: false });
  }
  draw(g: Game, ctx: CanvasRenderingContext2D) {
    const st = g.state.settings.touch; const show = st === 'on' || (st === 'auto' && this.active);
    if (!show) return;
    for (const p of this.pads) {
      const on = g.input.held(p.a);
      ctx.globalAlpha = on ? 0.9 : 0.55;
      ctx.fillStyle = on ? '#e8578f' : '#1d1b33'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
      ctx.strokeStyle = C.line; ctx.beginPath(); ctx.arc(p.x + 0.5, p.y + 0.5, p.r, 0, 7); ctx.stroke();
      text(ctx, p.label, p.x, p.y - 3, '#ffffff', { align: 'center' });
      ctx.globalAlpha = 1;
    }
  }
}
