import type { Game } from '../core/game';
import { WORLD_W } from '../core/game';
import type { EnemyDef } from '../core/types';
import { drawSprite } from '../art/sprite';

const BOSS_LIMIT = 150 * 60; // a boss that isn't beaten in 150s dozes off (counts as cleared): no softlocks

export class Boss {
  x = WORLD_W / 2; y = -60; t = 0; hp: number; maxHp: number; r = 26; flash = 0;
  dead = false; napped = false; entering = true;
  constructor(public g: Game, public ix: any, public def: EnemyDef) { this.hp = this.maxHp = def.hp; }
  damage(n: number) { this.hp -= n; this.flash = 4; if (this.hp <= 0) this.dead = true; this.g.bus.emit('boss:hp', { hp: this.hp, max: this.maxHp }); }
  update() {
    const g = this.g; this.t++; if (this.flash > 0) this.flash--;
    if (this.entering) { this.y += 1.2; if (this.y >= 80) this.entering = false; return; }
    if (this.t > BOSS_LIMIT) { this.dead = true; this.napped = true; return; }
    const phase = this.hp > this.maxHp * 0.66 ? 0 : this.hp > this.maxHp * 0.33 ? 1 : 2;
    const pat = this.def.bossPattern ?? 'sweep';
    // movement
    this.x = WORLD_W / 2 + Math.sin(this.t / (pat === 'charge' ? 50 : 80)) * (110 + phase * 10);
    this.y = 80 + Math.sin(this.t / 37) * 14 + (pat === 'charge' && phase > 0 && (this.t % 400) > 300 ? Math.sin(((this.t % 400) - 300) / 100 * Math.PI) * 150 : 0);
    const P = g.mods.player;
    const every = Math.max(28, 70 - phase * 15);
    if (this.t % every === 0) {
      if (pat === 'spiral' || (phase === 2 && pat !== 'sweep')) {
        const n = 8 + phase * 2; const off = this.t / 40;
        for (let i = 0; i < n; i++) { const a = off + (i / n) * Math.PI * 2; if (Math.sin(a) > -0.2) this.ix.bossSpit(this.x, this.y + 10, Math.cos(a) * 1.7, Math.abs(Math.sin(a)) * 1.7 + 0.6); }
      } else {
        const dx = (P?.x ?? this.x) - this.x, dy = (P?.y ?? 300) - this.y; const d = Math.hypot(dx, dy) || 1;
        const spread = 1 + phase;
        for (let i = -spread; i <= spread; i++) { const a = Math.atan2(dy, dx) + i * 0.22; this.ix.bossSpit(this.x, this.y + 14, Math.cos(a) * 2.1, Math.max(0.9, Math.sin(a) * 2.1)); }
      }
    }
    if (pat === 'summon' && this.t % 360 === 180 && this.ix.cats.length < 6) {
      const kd = this.ix.enemy('kitten');
      for (const s of [-1, 1]) this.ix.cats.push({ id: this.ix.nextId++, def: kd, hp: 1, x: this.x + s * 20, y: this.y, st: 'kdive', slot: [0, 0], path: [], u: 0, du: 0, delay: 0, t: 0, flash: 0, side: s, diveSeed: 0 });
    }
  }
  render(r: any) {
    r.push(1, this.y, (ctx: CanvasRenderingContext2D) => { ctx.fillStyle = 'rgba(11,10,20,0.3)'; ctx.fillRect(Math.round(this.x - 20), Math.round(this.y + 46), 40, 3); });
    r.push(2, this.y, (ctx: CanvasRenderingContext2D) => drawSprite(ctx, this.def.sprite, this.x, this.y, { frame: Math.floor(this.t / 14) % 2, flash: this.flash > 0 }));
  }
}
