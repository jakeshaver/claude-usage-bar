import type { Game, Module } from '../core/game';
import { WORLD_W, PF_W, PF_X, H } from '../core/game';
import { drawSprite } from '../art/sprite';
import { autopilotInput } from './autopilot';
import { pxRing } from '../core/pixel';
import { col } from '../core/palette';
import { shadowOval, ghostSprite, zGlyph, hitDot, dot } from './draw';
import './sprites';

export const MIN_Y = 200, MAX_Y = 336;

/** Jet-pod nozzles on Pom's harness, relative to her centre (the flames point down the screen). */
const PODS: [number, number][] = [[-11, 9], [11, 9]];
const HIST = 16;            // ticks of position history kept for the wingpup's lag
const PUP_LAG = 9;          // the pup flies where Pom was this many ticks ago
const NAP_CURL = 22;        // ticks of the "spin and flop" before Pom curls up

interface Spark { x: number; y: number; vx: number; vy: number; t: number; life: number; kind: number }

/** Cheap deterministic hash noise in [0,1) (no Math.random in src/). */
const noise = (n: number) => { let h = (n * 374761393) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

/** Player: Captain Pom. Accelerating flight with banking, small forgiving hitbox, lagging wingpup, smooth camera. */
class Player implements Module {
  id = 'player';
  api = this;
  x = WORLD_W / 2; y = 316; vx = 0; vy = 0;
  invuln = 0; invulnMax = 0; cooldown = 0; anim = 0;
  bank = 0;                 // -1 (banking left) .. 1 (banking right), eased
  kick = 0;                 // recoil ticks after a toot
  buddy = false;            // rescued puppy wingman (double shot) until hit
  powers: Record<string, number> = {}; // double/spread/shield/speed -> ticks left
  camera = { x: (WORLD_W - PF_W) / 2 };
  camF = (WORLD_W - PF_W) / 2;
  hx: number[] = []; hy: number[] = [];   // position history (newest last)
  pupX = WORLD_W / 2 + 20; pupY = 320; hadBuddy = false;
  sparks: Spark[] = [];
  napT = -1;                // ticks into the current nap (-1: awake)
  near = 0;                 // ticks the hitbox marker stays visible (threat close by)
  g!: Game;
  init(g: Game) { this.g = g; }
  pos() { return { x: this.x, y: this.y }; }
  hitbox() { return { x: this.x - 5, y: this.y - 4, w: 10, h: 10 }; }
  setInvuln(t: number) { if (t > this.invuln) { this.invuln = t; this.invulnMax = t; } }
  respawn() {
    this.x = WORLD_W / 2; this.y = 316; this.vx = this.vy = 0; this.setInvuln(120); this.cooldown = 10;
    this.bank = 0; this.hx.length = this.hy.length = 0; this.pupX = this.x + 20; this.pupY = this.y + 4; this.sparks.length = 0;
  }
  power(kind: string, ticks: number) { this.powers[kind] = Math.max(this.powers[kind] ?? 0, ticks); }

  hit() {
    const g = this.g;
    if (this.invuln > 0) return false;
    if (this.powers.shield > 0) { this.powers.shield = 0; this.setInvuln(60); g.mods.effects?.burst(this.x, this.y, 'shield'); g.mods.audio?.sfx('shield'); return false; }
    if (this.buddy) { this.buddy = false; this.setInvuln(90); g.mods.effects?.burst(this.pupX, this.pupY, 'poof'); g.mods.audio?.sfx('whimper'); return false; }
    g.state.hearts--; this.setInvuln(120);
    g.mods.effects?.shake(4, 16); g.mods.effects?.flash('r', 6); g.mods.audio?.sfx('hurt');
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
    this.stepSparks();
    if (g.mods.world?.phase === 'nap') { this.napT++; this.anim++; this.vx = this.vy = 0; this.followCamera(); return; }
    this.napT = -1;
    const inp = g.autopilot ? autopilotInput(g, this) : null;
    const held = (a: any) => (inp ? inp.has(a) : g.input.held(a));
    const sp = this.powers.speed > 0 ? 3.4 : 2.6, acc = 0.55, fr = 0.72;
    let ax = 0, ay = 0;
    if (held('left')) ax -= 1; if (held('right')) ax += 1;
    if (held('up')) ay -= 1; if (held('down')) ay += 1;
    // reversing direction bites harder than speeding up: snappy dodges without a twitchy top speed
    const ix = ax * (ax * this.vx < 0 ? acc * 1.7 : acc), iy = ay * (ay * this.vy < 0 ? acc * 1.7 : acc);
    this.vx = ax ? Math.max(-sp, Math.min(sp, this.vx + ix)) : this.vx * fr;
    this.vy = ay ? Math.max(-sp, Math.min(sp, this.vy + iy)) : this.vy * fr;
    if (Math.abs(this.vx) < 0.05) this.vx = 0; if (Math.abs(this.vy) < 0.05) this.vy = 0;
    this.x = Math.max(14, Math.min(WORLD_W - 14, this.x + this.vx));
    this.y = Math.max(MIN_Y, Math.min(MAX_Y, this.y + this.vy));
    // banking eases toward the stick so the lean frames do not flicker on taps
    const bt = Math.max(-1, Math.min(1, this.vx / 2.2));
    this.bank += (bt - this.bank) * 0.22; if (Math.abs(this.bank) < 0.01) this.bank = 0;
    if (this.invuln > 0) this.invuln--;
    for (const k in this.powers) if (this.powers[k] > 0) this.powers[k]--;
    if (this.cooldown > 0) this.cooldown--;
    if (this.kick > 0) this.kick--;
    this.anim++;
    this.trackHistory();
    if (held('fire') && this.cooldown <= 0) {
      const fired = g.mods.interaction?.fireTurds(this.x, this.y - 14, this.shotPattern());
      if (fired) { this.cooldown = this.powers.spread > 0 ? 14 : 11; this.kick = 4; g.state.stats.shots++; g.mods.audio?.sfx('plop'); }
    }
    this.emitTrail();
    // hitbox marker: shown while something dangerous is close, lingers a moment so it does not strobe
    let close = false;
    const th = g.mods.interaction?.threats?.() ?? [];
    for (const s of th) if (Math.abs(s.x - this.x) < 44 && Math.abs(s.y - this.y) < 52) { close = true; break; }
    this.near = close ? 24 : Math.max(0, this.near - 1);
    this.followCamera();
  }

  /** Smooth horizontal follow with a little look-ahead, clamped to the 448px world, settling exactly (no sub-pixel creep). */
  followCamera() {
    const max = WORLD_W - PF_W;
    const target = Math.max(0, Math.min(max, this.x - PF_W / 2 + this.vx * 9));
    const d = target - this.camF;
    this.camF = Math.abs(d) < 0.2 ? target : this.camF + d * 0.1;
    this.camera.x = this.camF;
  }

  trackHistory() {
    this.hx.push(this.x); this.hy.push(this.y);
    if (this.hx.length > HIST) { this.hx.shift(); this.hy.shift(); }
    if (this.buddy && !this.hadBuddy) { this.pupX = this.x + 20; this.pupY = this.y + 4; }
    this.hadBuddy = this.buddy;
    const i = Math.max(0, this.hx.length - 1 - PUP_LAG);
    const tx = (this.hx[i] ?? this.x) + 20, ty = (this.hy[i] ?? this.y) + 4;
    this.pupX += (tx - this.pupX) * 0.35; this.pupY += (ty - this.pupY) * 0.35;
  }

  emitTrail() {
    const n = this.anim;
    const moving = Math.abs(this.vx) + Math.abs(this.vy) > 0.6;
    const every = this.vy < -0.5 ? 2 : moving ? 3 : 5;
    if (n % every === 0 && this.sparks.length < 48) {
      for (let p = 0; p < 2; p++) {
        const [ox, oy] = PODS[p];
        const r = noise(n * 2 + p);
        this.sparks.push({ x: this.x + ox + (r - 0.5) * 2, y: this.y + oy, vx: -this.vx * 0.25 + (r - 0.5) * 0.3,
          vy: 1.1 + r * 0.6 - Math.min(0, this.vy) * 0.3, t: 0, life: 14 + Math.floor(r * 8), kind: noise(n + 7 * p) < 0.12 ? 1 : 0 });
      }
    }
    if (this.buddy && n % 6 === 0 && this.sparks.length < 48) {
      const r = noise(n * 3 + 11);
      this.sparks.push({ x: this.pupX + (r - 0.5) * 4, y: this.pupY + 7, vx: 0, vy: 1 + r * 0.4, t: 0, life: 10, kind: r < 0.3 ? 1 : 2 });
    }
  }
  stepSparks() {
    let w = 0;
    for (const s of this.sparks) { s.t++; s.x += s.vx; s.y += s.vy; s.vx *= 0.9; if (s.t < s.life) this.sparks[w++] = s; }
    this.sparks.length = w;
  }

  shotPattern(): { dx: number; vx: number }[] {
    const p: { dx: number; vx: number }[] = [];
    const base = this.powers.double > 0 ? [{ dx: -5, vx: 0 }, { dx: 5, vx: 0 }] : [{ dx: 0, vx: 0 }];
    p.push(...base);
    if (this.powers.spread > 0) p.push({ dx: -4, vx: -1.3 }, { dx: 4, vx: 1.3 });
    if (this.buddy) p.push({ dx: Math.round(Math.max(8, Math.min(30, this.pupX - this.x))), vx: 0 });
    return p;
  }

  render(g: Game, r: any) {
    const sc = g.state.scene;
    if (sc !== 'play' && sc !== 'bonus' && sc !== 'dialogue') return;
    const ground = g.mods.interaction?.grounded?.() ?? true;
    // draw Pom at a screen-rounded position so she never wobbles a pixel against the integer camera
    const cam = this.camF, camR = Math.round(cam);
    const sx = (wx: number) => Math.round(wx - cam) + camR;
    const t = this.anim;
    // jet trail (under Pom: same layer, sorted just above her)
    if (this.sparks.length) r.push(2, this.y - 40, (ctx: CanvasRenderingContext2D) => {
      for (const s of this.sparks) {
        const k = s.t / s.life;
        if (s.kind === 1) { if (k < 0.7) dot(ctx, s.x, s.y, (s.t >> 2) & 1 ? '6' : 'f', k < 0.4); continue; }
        if (s.kind === 2) { dot(ctx, s.x, s.y, k < 0.5 ? 'c' : 'd'); continue; }
        dot(ctx, s.x, s.y, k < 0.3 ? 'f' : k < 0.6 ? 'g' : k < 0.85 ? 'h' : 'v', k < 0.3);
      }
    });
    if (g.mods.world?.phase === 'nap' && this.napT >= 0) return this.renderNap(r, ground, sx);
    const blinkOff = this.invuln > 0 && (this.invuln >> 2) % 2 === 0;
    const whiteFlash = this.invuln > 0 && this.invulnMax - this.invuln < 10 && (this.invuln >> 1) % 2 === 0;
    const bob = Math.round(Math.sin(t / 10) * 1.2);
    const px = sx(this.x), py = Math.round(this.y) + bob + (this.kick > 1 ? 1 : 0);
    const name = this.bank < -0.4 ? 'poodle_left' : this.bank > 0.4 ? 'poodle_right' : 'poodle';
    const frame = Math.floor(t / 6) % 2;
    if (ground) r.push(1, this.y, (ctx: CanvasRenderingContext2D) => shadowOval(ctx, px + 6, Math.round(this.y) + 17, 18, 4));
    r.push(2, this.y, (ctx: CanvasRenderingContext2D) => {
      const sh = this.powers.shield ?? 0;
      const bubble = sh > 0 && !(sh < 180 && (t >> 3) % 2);
      const rr = 19 + ((t >> 4) % 4 === 0 ? 1 : 0);
      if (whiteFlash) drawSprite(ctx, name, px, py, { frame, flash: true });
      else if (blinkOff) ghostSprite(ctx, name, frame, px, py, t >> 1);
      else drawSprite(ctx, name, px, py, { frame });
      if (bubble) {
        pxRing(ctx, px, py, rr, (t >> 2) % 2 ? 'l' : 'm');
        pxRing(ctx, px, py, rr - 1, 's', 5, t / 18);
        ctx.fillStyle = col('6');  // glint, upper left
        ctx.fillRect(px - 12, py - 14, 3, 1); ctx.fillRect(px - 14, py - 12, 1, 2); ctx.fillRect(px - 11, py - 12, 1, 1);
      }
    });
    if (this.buddy) {
      const ppx = sx(this.pupX), ppy = Math.round(this.pupY + Math.sin(t / 8 + 1.3) * 1.6);
      if (ground) r.push(1, this.pupY + 1, (ctx: CanvasRenderingContext2D) => shadowOval(ctx, ppx + 5, Math.round(this.pupY) + 11, 10, 2));
      r.push(2, this.pupY + 1, (ctx: CanvasRenderingContext2D) => drawSprite(ctx, 'pup', ppx, ppy, { flipX: this.pupX < this.x }));
    }
    if (this.near > 0 && !blinkOff) {
      const hb = this.hitbox();
      r.push(3, this.y, (ctx: CanvasRenderingContext2D) => hitDot(ctx, sx(hb.x + hb.w / 2), Math.round(hb.y + hb.h / 2) + bob, (t >> 3) & 1 ? 'c' : '6'));
    }
  }

  renderNap(r: any, ground: boolean, sx: (wx: number) => number) {
    // the world dims the playfield during a nap; Pom herself is drawn in overlay() so she stays lit, "spotlit" in the dim
    if (ground && this.napT < NAP_CURL) r.push(1, this.y, (ctx: CanvasRenderingContext2D) => shadowOval(ctx, sx(this.x) + 6, Math.round(this.y) + 17, 18, 4));
  }

  /** Nap pose + Zzz, drawn above the world's nap dim (player overlays run after the world's). */
  overlay(g: Game, ctx: CanvasRenderingContext2D) {
    if (g.state.scene !== 'play' || g.mods.world?.phase !== 'nap' || this.napT < 0) return;
    const camR = Math.round(this.camF);
    ctx.save();
    ctx.beginPath(); ctx.rect(PF_X, 0, PF_W, H); ctx.clip();
    ctx.translate(PF_X - camR, 0);
    this.drawNap(ctx, Math.round(this.x - this.camF) + camR, Math.round(this.y), g.mods.interaction?.grounded?.() ?? true);
    ctx.restore();
  }

  drawNap(ctx: CanvasRenderingContext2D, px: number, y0: number, ground: boolean) {
    const t = this.napT;
    if (t < NAP_CURL) {
      // spin in place with a little hop: left, poodle, right, poodle...
      const seq = ['poodle_left', 'poodle', 'poodle_right', 'poodle'];
      const dy = Math.round(Math.sin((t / NAP_CURL) * Math.PI) * -5);
      drawSprite(ctx, seq[(t >> 2) % 4], px, y0 + dy);
      return;
    }
    const k = t - NAP_CURL;
    const breathe = (k >> 5) % 2;       // slow in/out
    const squash = k < 6 ? 1 : 0;       // tiny flop on landing
    if (ground) shadowOval(ctx, px + 4, y0 + 11, 26, 4);
    drawSprite(ctx, 'poodle_nap', px, y0 + squash, { frame: breathe });
    // three Zs float up from her snoot, staggered, swaying, growing as they rise
    for (let i = 0; i < 3; i++) {
      const z = k - i * 22; if (z < 0) continue;
      const p = (z % 66) / 66;
      const n = 4 + Math.floor(p * 3);
      const zx = px - 12 + Math.round(Math.sin(p * 6.28 + i) * 3) - Math.round(p * 6);
      const zy = y0 - 10 - Math.round(p * 30);
      if (p < 0.9) zGlyph(ctx, zx, zy, n, p < 0.6 ? '6' : '5');
    }
  }
}
export const makePlayer = (): Module => new Player();
