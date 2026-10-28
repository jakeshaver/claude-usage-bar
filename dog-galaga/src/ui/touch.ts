import type { Game } from '../core/game';
import type { Action } from '../core/input';
import { W, H, PF_X, PF_W } from '../core/game';
import { C, chamferFill, chamferLine, disc, ring, arrow, rect, frame, darkOf } from './draw';
import { text } from '../art/font';

/**
 * On-screen touch controls with a dedicated layout: each side panel reserves its lower block
 * (y >= TOUCH_TOP) as a "touch deck". The HUD hides whatever lives there while touch is visible,
 * so controls never overlap HUD text. Left deck: 8-way d-pad. Right deck: PAUSE key + TOOT button.
 */
export const TOUCH_TOP = 236;
const PAD = { x: 64, y: 296, arm: 20 };          // d-pad center + arm size
const FIRE = { x: 576, y: 306, r: 28 };          // TOOT button
const PAUSE = { x: 548, y: 246, w: 56, h: 15 };   // pause key (rect)
const RX = PF_X + PF_W;

export class Touch {
  active = false; g!: Game;
  /** visible = setting 'on', or 'auto' and a touch has been seen. */
  visible(g: Game) { const st = g.state.settings.touch; return st === 'on' || (st === 'auto' && this.active); }
  attach(g: Game) {
    this.g = g;
    const cv = () => document.getElementById('game') as HTMLCanvasElement | null;
    const update = (e: TouchEvent) => {
      const c = cv(); if (!c) return; this.active = true; g.input.lastDevice = 'touch';
      e.preventDefault();
      const r = c.getBoundingClientRect(); const set = new Set<Action>();
      for (const t of Array.from(e.touches)) {
        const x = (t.clientX - r.left) / r.width * W, y = (t.clientY - r.top) / r.height * H;
        for (const a of this.hit(x, y)) set.add(a);
        // a tap in the playfield acts as confirm outside of gameplay (menus, dialogue, map)
        if (x > PF_X && x < PF_X + PF_W && g.state.scene !== 'play') set.add('confirm');
      }
      g.input.touch = set;
    };
    addEventListener('touchstart', update, { passive: false });
    addEventListener('touchmove', update, { passive: false });
    addEventListener('touchend', update, { passive: false });
    addEventListener('touchcancel', update, { passive: false });
  }
  /** Map a touch point (internal px) to actions. D-pad is 8-way with a small dead zone. */
  hit(x: number, y: number): Action[] {
    const out: Action[] = [];
    const dx = x - PAD.x, dy = y - PAD.y;
    if (Math.abs(dx) < 60 && dy > -62 && dy < 64 && x < PF_X) {
      if (dx < -7) out.push('left'); if (dx > 7) out.push('right');
      if (dy < -7) out.push('up'); if (dy > 7) out.push('down');
    }
    if (x >= PAUSE.x - 4 && x < PAUSE.x + PAUSE.w + 4 && y >= PAUSE.y - 6 && y < PAUSE.y + PAUSE.h + 4) out.push('pause');
    else if (x > RX && y > PAUSE.y + PAUSE.h + 4 && Math.hypot(x - FIRE.x, y - FIRE.y) < FIRE.r + 18) out.push('fire', 'confirm');
    return out;
  }
  draw(g: Game, ctx: CanvasRenderingContext2D, t: number) {
    if (!this.visible(g)) return;
    const on = (a: Action) => g.input.held(a);
    // decks (panels are already drawn by the HUD in play; elsewhere draw a backing so it reads)
    const sc = g.state.scene; const hud = sc === 'play' || sc === 'bonus' || sc === 'dialogue';
    if (!hud) { frame(ctx, 2, TOUCH_TOP - 4, PF_X - 4, H - TOUCH_TOP + 2, C.line, C.night); frame(ctx, RX + 2, TOUCH_TOP - 4, W - RX - 4, H - TOUCH_TOP + 2, C.hot, C.night); }
    else {
      rect(ctx, 8, TOUCH_TOP - 4, PF_X - 16, 1, C.indigo); rect(ctx, RX + 8, TOUCH_TOP - 4, W - RX - 16, 1, C.indigo);
      text(ctx, 'MOVE', 10, TOUCH_TOP + 2, C.peri);
    }
    // ---- d-pad: a beveled cross with pixel arrows; pressed arms glow hot
    const { x: cx, y: cy, arm: a } = PAD; const hlf = a >> 1;
    disc(ctx, cx, cy, a + hlf + 6, C.ink); ring(ctx, cx, cy, a + hlf + 6, C.indigo);
    ring(ctx, cx, cy, a + hlf + 4, C.plum, [2, 3], -(t >> 2));
    const arms: [Action, number, number, 'l' | 'r' | 'u' | 'd'][] = [['up', 0, -1, 'u'], ['down', 0, 1, 'd'], ['left', -1, 0, 'l'], ['right', 1, 0, 'r']];
    chamferFill(ctx, cx - hlf - 1, cy - a - hlf - 1, a + 2, a * 2 + a + 2, C.deep, 3);
    chamferFill(ctx, cx - a - hlf - 1, cy - hlf - 1, a * 2 + a + 2, a + 2, C.deep, 3);
    for (const [act, ax, ay, dir] of arms) {
      const bx = cx - hlf + ax * a, by = cy - hlf + ay * a; const p = on(act);
      chamferFill(ctx, bx, by, a, a, p ? C.hot : C.panel2, 2);
      rect(ctx, bx + 2, by, a - 4, 1, p ? C.pink : C.peri);
      rect(ctx, bx + 2, by + a - 1, a - 4, 1, p ? C.mag : C.night);
      const tx = cx + ax * (a - 2), ty = cy + ay * (a - 2);
      arrow(ctx, tx + (dir === 'r' ? 2 : dir === 'l' ? -2 : 0), ty + (dir === 'd' ? 2 : dir === 'u' ? -2 : 0), dir, 4, p ? C.text : C.line);
    }
    rect(ctx, cx - hlf, cy - hlf, a, a, C.panel2); disc(ctx, cx, cy, 3, C.night); rect(ctx, cx - 1, cy - 1, 2, 2, C.indigo);
    // ---- pause key
    const pp = on('pause');
    chamferFill(ctx, PAUSE.x, PAUSE.y, PAUSE.w, PAUSE.h, pp ? C.hot : C.night, 3);
    chamferLine(ctx, PAUSE.x, PAUSE.y, PAUSE.w, PAUSE.h, pp ? C.pink : darkOf(C.line), 3);
    rect(ctx, PAUSE.x + 7, PAUSE.y + 4, 2, 7, pp ? C.text : C.line); rect(ctx, PAUSE.x + 11, PAUSE.y + 4, 2, 7, pp ? C.text : C.line);
    text(ctx, 'PAUSE', PAUSE.x + 18, PAUSE.y + 4, pp ? C.text : C.dim);
    // ---- TOOT button: layered discs with a pulsing ring
    const fp = on('fire'); const { x: fx, y: fy, r } = FIRE;
    disc(ctx, fx, fy, r + 5, C.ink);
    ring(ctx, fx, fy, r + 5, fp ? C.hot : C.mag, [3, 2], t >> 2);
    disc(ctx, fx, fy + 2, r, C.mag);
    disc(ctx, fx, fy, r, fp ? C.pink : C.hot);
    if (!fp) { disc(ctx, fx, fy + 1, r - 4, C.mag); disc(ctx, fx, fy, r - 4, C.hot); }
    disc(ctx, fx - 8, fy - 10, 3, fp ? C.text : C.pink);
    text(ctx, 'TOOT', fx, fy - 3, C.text, { align: 'center', shadow: C.mag });
  }
}
