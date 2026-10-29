import type { Game } from './game';
// Unified input: keyboard, gamepad, touch, and synthetic (bot/API). Action-based.
export type Action = 'left' | 'right' | 'up' | 'down' | 'fire' | 'pause' | 'confirm' | 'back' | 'pageL' | 'pageR';
const KEYMAP: Record<string, Action> = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  KeyA: 'left', KeyD: 'right', KeyW: 'up', KeyS: 'down',
  Space: 'fire', KeyZ: 'fire', Enter: 'confirm', Escape: 'pause', KeyP: 'pause', Backspace: 'back', KeyX: 'back',
  KeyQ: 'pageL', PageUp: 'pageL', KeyE: 'pageR', PageDown: 'pageR',
};
export class Input {
  down = new Set<Action>();
  private prev = new Set<Action>();
  private kb = new Set<Action>();
  /** keys pressed since the last endFrame(): a tap shorter than one tick still registers for one frame */
  private latched = new Set<Action>();
  touch = new Set<Action>();
  synthetic = new Set<Action>();
  lastDevice: 'keyboard' | 'gamepad' | 'touch' = 'keyboard';
  /** first gamepad's left stick: radial dead zone 0.2, magnitude remapped to 0..1 (0,0 with no pad / centred).
   *  Digital left/right/up/down still come from the 0.35 threshold (keyboard, d-pad, touch, autopilot). */
  readonly axis = { x: 0, y: 0 };
  attach(target: Window) {
    target.addEventListener('keydown', e => {
      const a = KEYMAP[e.code]; if (!a) return;
      e.preventDefault(); this.kb.add(a); this.latched.add(a); this.lastDevice = 'keyboard';
      if (a === 'fire') { this.kb.add('confirm'); this.latched.add('confirm'); }
    });
    target.addEventListener('keyup', e => {
      const a = KEYMAP[e.code]; if (!a) return;
      this.kb.delete(a); if (a === 'fire') this.kb.delete('confirm');
    });
    target.addEventListener('blur', () => this.kb.clear());
  }
  poll(_g: Game) {
    // reuse the two preallocated sets (no per-tick allocation): down <- kb | latched | touch | synthetic
    const d = this.down; d.clear();
    for (const a of this.kb) d.add(a);
    for (const a of this.latched) d.add(a);
    for (const a of this.touch) d.add(a);
    for (const a of this.synthetic) d.add(a);
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const axis = this.axis; axis.x = 0; axis.y = 0;
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] ?? 0, ay = p.axes[1] ?? 0; const b = (i: number) => !!p.buttons[i]?.pressed;
      const before = this.down.size;
      const m = Math.hypot(ax, ay);
      if (m >= 0.2 && axis.x === 0 && axis.y === 0) {
        const k = Math.min(1, (m - 0.2) / 0.75) / m; axis.x = ax * k; axis.y = ay * k; this.lastDevice = 'gamepad';
      }
      if (ax < -0.35 || b(14)) this.down.add('left');
      if (ax > 0.35 || b(15)) this.down.add('right');
      if (ay < -0.35 || b(12)) this.down.add('up');
      if (ay > 0.35 || b(13)) this.down.add('down');
      if (b(0) || b(7)) { this.down.add('fire'); this.down.add('confirm'); }
      if (b(1)) this.down.add('back');
      if (b(9)) this.down.add('pause');
      if (b(4)) this.down.add('pageL');
      if (b(5)) this.down.add('pageR');
      if (this.down.size > before) this.lastDevice = 'gamepad';
    }
  }
  held(a: Action) { return this.down.has(a); }
  pressed(a: Action) { return this.down.has(a) && !this.prev.has(a); }
  endFrame() {
    this.prev.clear(); for (const a of this.down) this.prev.add(a);
    this.latched.clear();
  }
}
