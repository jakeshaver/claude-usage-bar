import type { Game } from './game';
// Unified input: keyboard, gamepad, touch, and synthetic (bot/API). Action-based.
export type Action = 'left' | 'right' | 'up' | 'down' | 'fire' | 'pause' | 'confirm' | 'back';
const KEYMAP: Record<string, Action> = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  KeyA: 'left', KeyD: 'right', KeyW: 'up', KeyS: 'down',
  Space: 'fire', KeyZ: 'fire', Enter: 'confirm', Escape: 'pause', KeyP: 'pause', Backspace: 'back', KeyX: 'back',
};
export class Input {
  down = new Set<Action>();
  private prev = new Set<Action>();
  private kb = new Set<Action>();
  touch = new Set<Action>();
  synthetic = new Set<Action>();
  lastDevice: 'keyboard' | 'gamepad' | 'touch' = 'keyboard';
  attach(target: Window) {
    target.addEventListener('keydown', e => {
      const a = KEYMAP[e.code]; if (!a) return;
      e.preventDefault(); this.kb.add(a); this.lastDevice = 'keyboard';
      if (a === 'fire') this.kb.add('confirm');
    });
    target.addEventListener('keyup', e => {
      const a = KEYMAP[e.code]; if (!a) return;
      this.kb.delete(a); if (a === 'fire') this.kb.delete('confirm');
    });
    target.addEventListener('blur', () => this.kb.clear());
  }
  poll(_g: Game) {
    this.down = new Set([...this.kb, ...this.touch, ...this.synthetic]);
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] ?? 0, ay = p.axes[1] ?? 0; const b = (i: number) => !!p.buttons[i]?.pressed;
      const before = this.down.size;
      if (ax < -0.35 || b(14)) this.down.add('left');
      if (ax > 0.35 || b(15)) this.down.add('right');
      if (ay < -0.35 || b(12)) this.down.add('up');
      if (ay > 0.35 || b(13)) this.down.add('down');
      if (b(0) || b(7)) { this.down.add('fire'); this.down.add('confirm'); }
      if (b(1)) this.down.add('back');
      if (b(9)) this.down.add('pause');
      if (this.down.size > before) this.lastDevice = 'gamepad';
    }
  }
  held(a: Action) { return this.down.has(a); }
  pressed(a: Action) { return this.down.has(a) && !this.prev.has(a); }
  endFrame() { this.prev = new Set(this.down); }
}
