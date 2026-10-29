import type { Game, Module } from '../core/game';
import { WORLD_W, PF_W, PF_X, H } from '../core/game';
import { drawSprite } from '../art/sprite';
import { autopilotInput } from './autopilot';
import { pxRing } from '../core/pixel';
import { col } from '../core/palette';
import { shadowOval, ghostSprite, zGlyph, hitDot, dot, flame, tootPuff } from './draw';
import { POM_NOZZLES, PUP_NOZZLE } from './pom-art';
import './sprites';

export const MIN_Y = 200, MAX_Y = 336;

const HIST = 16;            // ticks of position history kept for the wingpup's lag
const PUP_LAG = 9;          // the pup flies where Pom was this many ticks ago
const NAP_CURL = 22;        // ticks of the "spin and flop" before Pom curls up
const WAKE_STRETCH = 9, WAKE_DROP = 6, WAKE_FLY = 16;   // wake-up: stretch + yawn, drop off-screen, fly back in
const WAKE = WAKE_STRETCH + WAKE_DROP + WAKE_FLY;
const START_X = WORLD_W / 2, START_Y = 316, BELOW = H + 26;
const ease = (k: number) => 1 - Math.pow(1 - k, 3);
const cam0 = (x: number) => Math.max(0, Math.min(WORLD_W - PF_W, x - PF_W / 2));

interface Spark { x: number; y: number; vx: number; vy: number; t: number; life: number; kind: number; h?: number }

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
  wakeT = 0;                // ticks left of the wake-up sequence after a nap (no control meanwhile)
  wx0 = 0; wy0 = 0;         // where she napped
  g!: Game;
  init(g: Game) { this.g = g; }
  pos() { return { x: this.x, y: this.y }; }
  hitbox() { return { x: this.x - 5, y: this.y - 4, w: 10, h: 10 }; }
  setInvuln(t: number) { if (t > this.invuln) { this.invuln = t; this.invulnMax = t; } }
  respawn() {
    const napped = this.napT >= 0;
    this.wx0 = this.x; this.wy0 = this.y;
    this.x = START_X; this.y = START_Y; this.vx = this.vy = 0; this.setInvuln(120); this.cooldown = 10;
    this.bank = 0; this.hx.length = this.hy.length = 0; this.pupX = this.x + 20; this.pupY = this.y + 4; this.sparks.length = 0;
    if (napped) { this.wakeT = WAKE; this.x = this.wx0; this.y = this.wy0; this.setInvuln(120 + WAKE); }
    else { this.wakeT = 0; this.camF = cam0(this.x); this.camera.x = this.camF; }
  }
  /** Wake-up after a nap: stretch + yawn where she slept, drop below the screen, then fly back in with an eased camera. */
  stepWake() {
    const k = WAKE - this.wakeT; this.wakeT--;
    if (k < WAKE_STRETCH) { this.x = this.wx0; this.y = this.wy0; }
    else if (k < WAKE_STRETCH + WAKE_DROP) { const q = (k - WAKE_STRETCH + 1) / WAKE_DROP; this.x = this.wx0; this.y = this.wy0 + (BELOW - this.wy0) * q * q; }
    else { const q = ease((k - WAKE_STRETCH - WAKE_DROP + 1) / WAKE_FLY); this.x = START_X; this.y = BELOW + (START_Y - BELOW) * q; this.vy = -1.5; }
    if (this.wakeT <= 0) { this.x = START_X; this.y = START_Y; this.vy = 0; }
    this.pupX = this.x + 20; this.pupY = this.y + 4; this.hx.length = this.hy.length = 0;
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
    if (this.wakeT > 0) {
      this.anim++; if (this.invuln > 0) this.invuln--;
      this.stepWake(); this.emitTrail(); this.followCamera(this.wakeT > WAKE_FLY ? 0 : 0.14); return;
    }
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
  followCamera(rate = 0.1) {
    const target = cam0(this.wakeT > 0 ? START_X : this.x + this.vx * 9);
    const d = target - this.camF;
    this.camF = Math.abs(d) < 0.2 ? target : this.camF + d * rate;
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

  /** Current Pom frame (bank-dependent, before the time-of-day suffix). */
  frameName() {
    if (this.wakeT > WAKE - WAKE_STRETCH) return 'pom_stretch';
    const b = this.bank, a = Math.abs(b);
    return a < 0.35 ? 'pom' : a < 0.75 ? (b < 0 ? 'pom_lean_l' : 'pom_lean_r') : (b < 0 ? 'pom_bank_l' : 'pom_bank_r');
  }
  /** Flame length for this tick: longer when thrusting up the screen, shorter when backing off; 3-step flicker. */
  flameLen(w: number) {
    const base = this.vy < -0.5 ? 8 : this.vy > 0.5 ? 4 : 6;
    return Math.max(2, base + [0, 1, -1][(this.anim >> 1) % 3] - (w <= 2 ? 2 : 0));
  }
  lastY = 316;
  emitTrail() {
    const n = this.anim;
    // segment height covers the gap opened by this tick's motion, so a fast climb still leaves a solid streak
    const gap = Math.max(0, this.lastY - this.y); this.lastY = this.y;
    if (this.sparks.length < 64 && this.wakeT <= WAKE - WAKE_STRETCH) {
      for (const [ox, oy, w] of POM_NOZZLES[this.frameName()] ?? []) {
        if (w <= 2) continue;              // tucked far pod: flame only, no streak
        this.sparks.push({ x: this.x + ox - 1, y: this.y + oy + this.flameLen(w), vx: -this.vx * 0.15, vy: 1.6 + Math.max(0, -this.vy) * 0.4,
          t: 0, life: 11 + (this.vy < -0.5 ? 4 : 0), kind: 0, h: Math.min(8, 2 + Math.ceil(gap + Math.max(0, -this.vy) * 0.4)) });
      }
      // boosting (speed power-up): a few loose stars kick out of the streak
      if (this.powers.speed > 0 && n % 4 === 0) {
        const r = noise(n), [ox, oy] = (POM_NOZZLES[this.frameName()] ?? [[0, 0]])[n & 1] ?? [0, 0];
        this.sparks.push({ x: this.x + ox + (r - 0.5) * 6, y: this.y + oy + 6, vx: (r - 0.5) * 0.8, vy: 1.4, t: 0, life: 12, kind: 1 });
      }
    }
    if (this.buddy && this.sparks.length < 64) {
      const pn = PUP_NOZZLE[this.pupName()];
      if (pn) this.sparks.push({ x: this.pupX + pn[0] - 1, y: this.pupY + pn[1] + 3, vx: 0, vy: 1.5, t: 0, life: 6, kind: 2 });
    }
  }
  pupName() { return this.bank < -0.5 ? 'pom_pup_l' : this.bank > 0.5 ? 'pom_pup_r' : 'pom_pup'; }
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
    const tod = g.state.tod, lit = tod === 'dusk' || tod === 'night' ? '@' + tod : '';
    // jet streaks: 2px wide, fading yellow > orange > burnt > plum
    if (this.sparks.length) r.push(2, this.y - 40, (ctx: CanvasRenderingContext2D) => {
      for (const s of this.sparks) {
        const k = s.t / s.life, x = Math.round(s.x - cam) + camR;
        if (s.kind === 1) { if (k < 0.8) dot(ctx, x, s.y, (s.t >> 2) & 1 ? '6' : 'f', k < 0.4); continue; }
        if (s.kind === 2) { ctx.fillStyle = col(k < 0.5 ? 'g' : 'h'); ctx.fillRect(x, Math.round(s.y), 1, 2); continue; }
        ctx.fillStyle = col(k < 0.25 ? 'f' : k < 0.5 ? 'g' : k < 0.75 ? 'h' : 'v');
        ctx.fillRect(x, Math.round(s.y), k < 0.6 ? 2 : 1, k < 0.75 ? s.h ?? 2 : 2);
      }
    });
    if (g.mods.world?.phase === 'nap' && this.napT >= 0) return this.renderNap(r, ground, sx);
    const blink = this.invuln > 0 && !g.paused && this.wakeT <= 0;   // solid while paused and during the wake-up
    const whiteFlash = blink && this.invulnMax - this.invuln < 10 && (this.invuln >> 1) % 2 === 0;
    const ghost = blink && !whiteFlash && (this.invuln >> 2) % 2 === 0;
    const bob = Math.round(Math.sin(t / 10) * 1.2);
    const px = sx(this.x), py = Math.round(this.y) + bob + (this.kick > 2 ? 1 : 0);
    const base = this.frameName(), name = base + lit;
    const frame = this.kick > 2 && base !== 'pom_stretch' ? 1 : 0;   // tail pompom squashes on a toot
    const nozzles = this.wakeT > WAKE - WAKE_STRETCH ? [] : POM_NOZZLES[base] ?? [];
    // shadow: fixed light from the upper left, well below and right of her, breathing with the bob
    if (ground) r.push(1, this.y, (ctx: CanvasRenderingContext2D) => shadowOval(ctx, px + 13, Math.round(this.y) + 27 - bob, 16 + bob, 4));
    r.push(2, this.y, (ctx: CanvasRenderingContext2D) => {
      if (whiteFlash) drawSprite(ctx, name, px, py, { frame, flash: true });
      else if (ghost) ghostSprite(ctx, name, frame, px, py);
      else drawSprite(ctx, name, px, py, { frame });
      if (!whiteFlash) for (const [ox, oy, w] of nozzles) flame(ctx, px + ox - w / 2, py + oy + 1, w, this.flameLen(w));
      if (tod === 'night' && !ghost && !whiteFlash) {
        // warm pod glow spilling onto her flanks
        ctx.fillStyle = col('g');
        for (const [ox, oy, w] of nozzles) if (w > 2) { const ix = ox < 0 ? px + ox + w / 2 + 1 : px + ox - w / 2 - 2; ctx.fillRect(ix, py + oy - 2, 1, 2); ctx.fillRect(ix + (ox < 0 ? 1 : -1), py + oy - 1, 1, 1); }
      }
      if (this.kick > 0) tootPuff(ctx, px, py - 17, this.kick > 2 ? 0 : 1);
      const sh = this.powers.shield ?? 0;
      if (sh > 0 && !(sh < 180 && (t >> 3) % 2)) {
        const rr = 19 + ((t >> 4) % 4 === 0 ? 1 : 0);
        pxRing(ctx, px, py, rr, (t >> 2) % 2 ? 'l' : 'm');
        pxRing(ctx, px, py, rr - 1, 's', 5, t / 18);
        ctx.fillStyle = col('6');  // glint, upper left
        ctx.fillRect(px - 12, py - 14, 3, 1); ctx.fillRect(px - 14, py - 12, 1, 2); ctx.fillRect(px - 11, py - 12, 1, 1);
      }
    });
    if (this.buddy) {
      const pbob = Math.round(Math.sin(t / 8 + 1.3) * 1.6);
      const ppx = sx(this.pupX), ppy = Math.round(this.pupY) + pbob;
      const pn = this.pupName(), noz = PUP_NOZZLE[pn];
      if (ground) r.push(1, this.pupY + 1, (ctx: CanvasRenderingContext2D) => shadowOval(ctx, ppx + 9, Math.round(this.pupY) + 17 - pbob, 8 + pbob, 2));
      r.push(2, this.pupY + 1, (ctx: CanvasRenderingContext2D) => {
        drawSprite(ctx, pn + lit, ppx, ppy);
        if (noz) flame(ctx, ppx + noz[0] - noz[2] / 2, ppy + noz[1] + 1, noz[2], 3 + [0, 1, 2][(t >> 1) % 3]);
      });
    }
    if ((this.near > 0 || this.invuln > 0) && !whiteFlash && this.wakeT <= 0) {
      const hb = this.hitbox();
      r.push(3, this.y, (ctx: CanvasRenderingContext2D) => hitDot(ctx, sx(hb.x + hb.w / 2), Math.round(hb.y + hb.h / 2) + bob, (t >> 3) & 1 ? 'c' : '6'));
    }
  }

  renderNap(r: any, ground: boolean, sx: (wx: number) => number) {
    // the world dims the playfield during a nap; Pom herself is drawn in overlay() so she stays lit, "spotlit" in the dim
    if (ground && this.napT < NAP_CURL) r.push(1, this.y, (ctx: CanvasRenderingContext2D) => shadowOval(ctx, sx(this.x) + 13, Math.round(this.y) + 27, 15, 3));
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
      const seq = ['pom_bank_l', 'pom', 'pom_bank_r', 'pom'];
      const dy = Math.round(Math.sin((t / NAP_CURL) * Math.PI) * -5);
      drawSprite(ctx, seq[(t >> 2) % 4], px, y0 + dy);
      return;
    }
    const k = t - NAP_CURL;
    const breathe = (k >> 5) % 2;       // slow in/out
    const squash = k < 6 ? 1 : 0;       // tiny flop on landing
    if (ground) shadowOval(ctx, px + 6, y0 + 15, 26, 3);
    drawSprite(ctx, 'pom_nap', px, y0 + squash, { frame: breathe });
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
