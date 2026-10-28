import type { Game, Module } from '../core/game';
import { WORLD_W, PF_W, H } from '../core/game';
import { drawSprite } from '../art/sprite';
import { autopilotInput } from './autopilot';
import { pxRing } from '../core/pixel';

export const MIN_Y = 200, MAX_Y = 336;

/** Player: Captain Pom. Smooth accel movement, small forgiving hitbox, camera follow. */
class Player implements Module {
  id = 'player';
  api = this;
  x = WORLD_W / 2; y = 316; vx = 0; vy = 0;
  invuln = 0; cooldown = 0; anim = 0;
  buddy = false;            // rescued puppy wingman (double shot) until hit
  powers: Record<string, number> = {}; // double/spread/shield/speed -> ticks left
  camera = { x: (WORLD_W - PF_W) / 2 };
  g!: Game;
  init(g: Game) { this.g = g; }
  pos() { return { x: this.x, y: this.y }; }
  hitbox() { return { x: this.x - 5, y: this.y - 4, w: 10, h: 10 }; }
  setInvuln(t: number) { this.invuln = Math.max(this.invuln, t); }
  respawn() { this.x = WORLD_W / 2; this.y = 316; this.vx = this.vy = 0; this.invuln = 120; this.cooldown = 10; }
  power(kind: string, ticks: number) { this.powers[kind] = Math.max(this.powers[kind] ?? 0, ticks); }

  hit() {
    const g = this.g;
    if (this.invuln > 0) return false;
    if (this.powers.shield > 0) { this.powers.shield = 0; this.invuln = 60; g.mods.effects?.burst(this.x, this.y, 'shield'); g.mods.audio?.sfx('shield'); return false; }
    if (this.buddy) { this.buddy = false; this.invuln = 90; g.mods.effects?.burst(this.x + 18, this.y, 'poof'); g.mods.audio?.sfx('whimper'); return false; }
    g.state.hearts--; this.invuln = 120;
    g.mods.effects?.shake(4, 16); g.mods.effects?.flash('#ff5a4f', 6); g.mods.audio?.sfx('hurt');
    g.bus.emit('player:hit', { hearts: g.state.hearts });
    if (g.state.hearts <= 0) {
      g.state.stats.naps++; g.mods.effects?.burst(this.x, this.y, 'fur'); g.mods.interaction?.napReset(); this.powers = {};
      g.bus.emit('player:nap', { hearts: 0 });
    }
    return true;
  }

  update(g: Game) {
    const sc = g.state.scene;
    if (sc !== 'play' && sc !== 'bonus') return;
    if (g.paused) return;
    if (g.mods.world?.phase === 'nap') return;
    const inp = g.autopilot ? autopilotInput(g, this) : null;
    const held = (a: any) => (inp ? inp.has(a) : g.input.held(a));
    const sp = this.powers.speed > 0 ? 3.4 : 2.6, acc = 0.55, fr = 0.72;
    let ax = 0, ay = 0;
    if (held('left')) ax -= 1; if (held('right')) ax += 1;
    if (held('up')) ay -= 1; if (held('down')) ay += 1;
    this.vx = ax ? Math.max(-sp, Math.min(sp, this.vx + ax * acc)) : this.vx * fr;
    this.vy = ay ? Math.max(-sp, Math.min(sp, this.vy + ay * acc)) : this.vy * fr;
    if (Math.abs(this.vx) < 0.05) this.vx = 0; if (Math.abs(this.vy) < 0.05) this.vy = 0;
    this.x = Math.max(14, Math.min(WORLD_W - 14, this.x + this.vx));
    this.y = Math.max(MIN_Y, Math.min(MAX_Y, this.y + this.vy));
    if (this.invuln > 0) this.invuln--;
    for (const k in this.powers) if (this.powers[k] > 0) this.powers[k]--;
    if (this.cooldown > 0) this.cooldown--;
    this.anim++;
    if (held('fire') && this.cooldown <= 0) {
      const fired = g.mods.interaction?.fireTurds(this.x, this.y - 14, this.shotPattern());
      if (fired) { this.cooldown = this.powers.spread > 0 ? 14 : 11; g.state.stats.shots++; g.mods.audio?.sfx('plop'); }
    }
    // camera follow (lerp, clamp)
    const target = Math.max(0, Math.min(WORLD_W - PF_W, this.x - PF_W / 2));
    this.camera.x += (target - this.camera.x) * 0.12;
  }

  shotPattern(): { dx: number; vx: number }[] {
    const p: { dx: number; vx: number }[] = [];
    const base = this.powers.double > 0 ? [{ dx: -5, vx: 0 }, { dx: 5, vx: 0 }] : [{ dx: 0, vx: 0 }];
    p.push(...base);
    if (this.powers.spread > 0) p.push({ dx: -4, vx: -1.3 }, { dx: 4, vx: 1.3 });
    if (this.buddy) p.push({ dx: 20, vx: 0 });
    return p;
  }

  render(g: Game, r: any) {
    const sc = g.state.scene;
    if (sc !== 'play' && sc !== 'bonus' && sc !== 'dialogue') return;
    if (g.mods.world?.phase === 'nap') {
      r.push(2, this.y, (ctx: CanvasRenderingContext2D) => drawSprite(ctx, 'poodle', this.x, this.y, { alpha: 0.6 }));
      return;
    }
    const blink = this.invuln > 0 && Math.floor(this.invuln / 4) % 2 === 0;
    const bob = Math.round(Math.sin(this.anim / 10));
    r.push(1, this.y, (ctx: CanvasRenderingContext2D) => { ctx.fillStyle = 'rgba(11,10,20,0.35)'; ctx.fillRect(Math.round(this.x - 9), Math.round(this.y + 18), 18, 3); });
    r.push(2, this.y, (ctx: CanvasRenderingContext2D) => {
      if (!blink) drawSprite(ctx, this.vx < -0.8 ? 'poodle_left' : this.vx > 0.8 ? 'poodle_right' : 'poodle', this.x, this.y + bob, { frame: Math.floor(this.anim / 6) % 2 });
      if (this.powers.shield > 0) { pxRing(ctx, this.x, this.y + bob, 19, (this.anim >> 2) % 2 ? 'l' : 'm', 6, this.anim / 20); if (this.powers.shield < 180 && (this.anim >> 3) % 2) pxRing(ctx, this.x, this.y + bob, 18, 's', 6, -this.anim / 20); }
    });
    if (this.buddy) r.push(2, this.y + 1, (ctx: CanvasRenderingContext2D) => drawSprite(ctx, 'pup', this.x + 20, this.y + 4 - bob));
  }
}
export const makePlayer = (): Module => new Player();
