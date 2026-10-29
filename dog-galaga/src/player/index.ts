import type { Game, Module } from '../core/game';
import { WORLD_W, PF_W, PF_X, W, H } from '../core/game';
import { drawSprite } from '../art/sprite';
import { text } from '../art/font';
import { col } from '../core/palette';
import { autopilotInput } from './autopilot';
import { shadowOval, shadowInk, shadowDX, hitDot, dot, flame, tootPuff, ribbon, scarfTail, shieldRing, drawNapPose } from './draw';
import { POM_NOZZLES, POM_KNOT, PUP_NOZZLES } from './pom-art';
import { galleryModule } from './gallery';
import './sprites';

// Galaga keeps the ship well clear of the bottom edge: at MAX_Y her flames, shadow and the shield bubble all fit
export const MIN_Y = 196, MAX_Y = 316;

const HIST = 16;            // ticks of position history kept for the wingpup's lag
const PUP_LAG = 9;          // the pup flies where Pom was this many ticks ago
const PUP_DX = 25;          // pup's sideways offset from Pom (side swaps on a sustained bank)
const TRAIL = 8;            // ticks of nozzle history behind each exhaust ribbon
const NAP_CURL = 22;        // ticks of the "spin and flop" before Pom curls up
const WAKE_STRETCH = 9, WAKE_DROP = 6, WAKE_FLY = 16;   // wake-up: stretch + yawn, drop off-screen, fly back in
const WAKE = WAKE_STRETCH + WAKE_DROP + WAKE_FLY;
const START_X = WORLD_W / 2, START_Y = 300, BELOW = H + 26;
const ease = (k: number) => 1 - Math.pow(1 - k, 3);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const cam0 = (x: number) => clamp(x - PF_W / 2, 0, WORLD_W - PF_W);

interface Spark { x: number; y: number; vx: number; vy: number; t: number; life: number }
interface Drag { id: number; fx: number; fy: number; px: number; py: number; cx: number; cy: number; t0: number; moved: number }

/** Cheap deterministic hash noise in [0,1) (no Math.random in src/). */
const noise = (n: number) => { let h = (n * 374761393) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

/** Player: Captain Pom. Accelerating flight with banking, small forgiving hitbox, lagging wingpup, smooth camera.
 *  Keyboard and d-pad are digital; a gamepad stick is analog (deflection sets the target speed); touch is
 *  relative drag-to-move on the playfield (Pom follows the finger's offset) with auto-fire while dragging and
 *  a quick tap toggling auto-fire on/off. */
class Player implements Module {
  id = 'player';
  api = this;
  x = WORLD_W / 2; y = START_Y; vx = 0; vy = 0;
  invuln = 0; invulnMax = 0; cooldown = 0; anim = 0;
  bank = 0;                 // -1 (banking left) .. 1 (banking right), eased
  kick = 0;                 // recoil ticks after a toot
  buddy = false;            // rescued puppy wingman (double shot) until hit
  powers: Record<string, number> = {}; // double/spread/shield/speed -> ticks left
  camera = { x: (WORLD_W - PF_W) / 2 };
  camF = (WORLD_W - PF_W) / 2; camV = 0;
  hx: number[] = []; hy: number[] = [];   // position history (newest last)
  trX: number[] = []; trY: number[] = []; // Pom positions for the exhaust ribbons (newest last)
  puX: number[] = []; puY: number[] = []; // pup positions for its ribbon
  pupX = WORLD_W / 2 + PUP_DX; pupY = START_Y + 4; hadBuddy = false;
  pupSide = 1; pupOff = PUP_DX; bankHold = 0;
  sparks: Spark[] = [];
  napT = -1;                // ticks into the current nap (-1: awake)
  near = 0;                 // ticks the hitbox marker stays visible (threat close by)
  wakeT = 0;                // ticks left of the wake-up sequence after a nap (no control meanwhile)
  wx0 = 0; wy0 = 0;         // where she napped
  drag: Drag | null = null; autoFire = false; touchSeen = false;
  g!: Game;
  init(g: Game) {
    this.g = g;
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      this.attachTouch(g);
      const q = new URLSearchParams(location.search);
      if (q.get('showcase') === 'player' && q.get('filter') === 'gallery') g.register(galleryModule());
    }
  }
  pos() { return { x: this.x, y: this.y }; }
  hitbox() { return { x: this.x - 5, y: this.y - 4, w: 10, h: 10 }; }
  setInvuln(t: number) { if (t > this.invuln) { this.invuln = t; this.invulnMax = t; } }
  respawn() {
    const napped = this.napT >= 0;
    this.wx0 = this.x; this.wy0 = this.y;
    this.x = START_X; this.y = START_Y; this.vx = this.vy = 0; this.setInvuln(120); this.cooldown = 10;
    this.bank = 0; this.hx.length = this.hy.length = 0; this.sparks.length = 0; this.clearTrails();
    this.pupSide = 1; this.pupOff = PUP_DX; this.bankHold = 0; this.pupX = this.x + PUP_DX; this.pupY = this.y + 4;
    this.drag = null;
    if (napped) { this.wakeT = WAKE; this.x = this.wx0; this.y = this.wy0; this.setInvuln(120 + WAKE); }
    else { this.wakeT = 0; this.camF = cam0(this.x); this.camera.x = this.camF; this.camV = 0; }
  }
  clearTrails() { this.trX.length = this.trY.length = this.puX.length = this.puY.length = 0; }
  /** Wake-up after a nap: stretch + yawn where she slept, drop below the screen, then fly back in with an eased camera. */
  stepWake() {
    const k = WAKE - this.wakeT; this.wakeT--;
    if (k < WAKE_STRETCH) { this.x = this.wx0; this.y = this.wy0; }
    else if (k < WAKE_STRETCH + WAKE_DROP) { const q = (k - WAKE_STRETCH + 1) / WAKE_DROP; this.x = this.wx0; this.y = this.wy0 + (BELOW - this.wy0) * q * q; }
    else { const q = ease((k - WAKE_STRETCH - WAKE_DROP + 1) / WAKE_FLY); this.x = START_X; this.y = BELOW + (START_Y - BELOW) * q; this.vy = -1.5; }
    if (k === WAKE_STRETCH + WAKE_DROP) this.clearTrails();      // she teleports below the screen: no ribbon across it
    if (this.wakeT <= 0) { this.x = START_X; this.y = START_Y; this.vy = 0; }
    this.pupX = this.x + PUP_DX; this.pupY = this.y + 4; this.hx.length = this.hy.length = 0;
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

  // ---- input ----
  /** Relative drag-to-move on the playfield: the finger's offset from where it touched down moves Pom by the
   *  same offset (x1.3) from where she was. A quick tap (no drag) toggles auto-fire. */
  attachTouch(g: Game) {
    const toInternal = (t: { clientX: number; clientY: number }) => {
      const c = document.getElementById('game'); if (!c) return null;
      const r = c.getBoundingClientRect(); if (!r.width || !r.height) return null;
      return { x: (t.clientX - r.left) / r.width * W, y: (t.clientY - r.top) / r.height * H };
    };
    const live = () => (g.state.scene === 'play' || g.state.scene === 'bonus') && !g.paused && (g.mods.ui?.menuOpen ?? 'none') === 'none';
    addEventListener('touchstart', (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        const p = toInternal(t); if (!p) continue;
        this.touchSeen = true;
        if (this.drag || !live() || p.x < PF_X || p.x >= PF_X + PF_W) continue;
        this.drag = { id: t.identifier, fx: p.x, fy: p.y, px: this.x, py: this.y, cx: p.x, cy: p.y, t0: performance.now(), moved: 0 };
      }
    }, { passive: true });
    addEventListener('touchmove', (e: TouchEvent) => {
      const d = this.drag; if (!d) return;
      for (const t of Array.from(e.changedTouches)) if (t.identifier === d.id) {
        const p = toInternal(t); if (!p) continue;
        d.cx = p.x; d.cy = p.y; d.moved = Math.max(d.moved, Math.hypot(p.x - d.fx, p.y - d.fy));
      }
    }, { passive: true });
    const end = (e: TouchEvent) => {
      const d = this.drag; if (!d) return;
      for (const t of Array.from(e.changedTouches)) if (t.identifier === d.id) {
        if (performance.now() - d.t0 < 230 && d.moved < 5) this.autoFire = !this.autoFire;
        this.drag = null;
      }
    };
    addEventListener('touchend', end, { passive: true });
    addEventListener('touchcancel', end, { passive: true });
  }
  update(g: Game) {
    const sc = g.state.scene;
    if (sc !== 'play' && sc !== 'bonus') { this.drag = null; return; }
    if (g.paused) return;
    this.stepSparks();
    if (g.mods.world?.phase === 'nap') { this.napT++; this.anim++; this.vx = this.vy = 0; this.drag = null; this.followCamera(); return; }
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
    let fire = held('fire');
    if (!inp) {
      const pad = g.input.axis; // core/input: left stick, radial dead zone 0.2, remapped to 0..1
      if (Math.abs(pad.x) > 0.02) ax = pad.x; if (Math.abs(pad.y) > 0.02) ay = pad.y;
      const d = this.drag;
      if (d) {
        const tx = clamp(d.px + (d.cx - d.fx) * 1.3, 14, WORLD_W - 14), ty = clamp(d.py + (d.cy - d.fy) * 1.3, MIN_Y, MAX_Y);
        ax = clamp((tx - this.x) / 10, -1, 1); ay = clamp((ty - this.y) / 10, -1, 1);
        if (Math.abs(tx - this.x) < 0.6) ax = 0; if (Math.abs(ty - this.y) < 0.6) ay = 0;
        fire = true;
      }
      if (this.autoFire && this.touchSeen) fire = true;
    }
    // the stick sets a target velocity (analog = fine steering); reversing bites harder than speeding up,
    // so dodges are snappy without a twitchy top speed
    const steer = (v: number, a: number) => {
      if (!a) return v * fr;
      const tv = a * sp, k = tv * v < 0 ? acc * 1.7 : acc;
      return v + clamp(tv - v, -k, k);
    };
    this.vx = steer(this.vx, ax); this.vy = steer(this.vy, ay);
    if (Math.abs(this.vx) < 0.05) this.vx = 0; if (Math.abs(this.vy) < 0.05) this.vy = 0;
    // in a Big Cat fight Pom stays inside the lane walls (boss bullets pop at them, so the gutters would be a free
    // safe zone); a Pom caught outside when the fight starts glides back in 2px a tick, never a snap
    let nx = clamp(this.x + this.vx, 14, WORLD_W - 14);
    const IX = g.mods.interaction;
    if (IX?.mode === 'boss' && typeof IX.lane === 'function') {
      const [l, r] = IX.lane() as [number, number]; const lo = l + 12, hi = r - 12;
      if (lo < hi) {
        if (nx < lo) { nx = Math.max(nx, Math.min(lo, this.x + 2)); if (this.vx < 0) this.vx = 0; }
        if (nx > hi) { nx = Math.min(nx, Math.max(hi, this.x - 2)); if (this.vx > 0) this.vx = 0; }
      }
    }
    this.x = nx;
    this.y = clamp(this.y + this.vy, MIN_Y, MAX_Y);
    // banking eases toward the stick so the lean frames do not flicker on taps
    const bt = clamp(this.vx / 2.2, -1, 1);
    this.bank += (bt - this.bank) * 0.22; if (Math.abs(this.bank) < 0.01) this.bank = 0;
    if (this.invuln > 0) this.invuln--;
    for (const k in this.powers) if (this.powers[k] > 0) this.powers[k]--;
    if (this.cooldown > 0) this.cooldown--;
    if (this.kick > 0) this.kick--;
    this.anim++;
    this.trackHistory();
    if (fire && this.cooldown <= 0) {
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

  /** Horizontal follow with a little look-ahead, clamped to the 448px world. A critically damped spring
   *  (no overshoot) with a minimum settle speed once Pom has stopped, and an exact snap as soon as the rounded
   *  camera equals the rounded target: no sub-pixel crawl of the background after she stops. */
  followCamera(rate?: number) {
    const target = cam0(this.wakeT > 0 ? START_X : this.x + this.vx * 9);
    const d = target - this.camF;
    if (rate !== undefined) {
      this.camV = 0;
      this.camF = Math.abs(d) < 0.5 ? target : this.camF + d * rate;
    } else {
      const k = 0.03, c = 2 * Math.sqrt(k);
      this.camV += d * k - this.camV * c;
      let step = this.camV;
      if (this.vx === 0 && Math.abs(step) < 0.4) step = Math.sign(d) * Math.min(Math.abs(d), 0.4);
      this.camF += step;
      if (Math.round(this.camF) === Math.round(target) && Math.abs(this.vx) < 0.3) { this.camF = target; this.camV = 0; }
    }
    this.camera.x = this.camF;
  }

  trackHistory() {
    this.hx.push(this.x); this.hy.push(this.y);
    if (this.hx.length > HIST) { this.hx.shift(); this.hy.shift(); }
    // the pup trails on the side opposite a sustained bank, so its lag reads as following
    const b = this.bank;
    this.bankHold = b > 0.6 ? Math.max(0, this.bankHold) + 1 : b < -0.6 ? Math.min(0, this.bankHold) - 1 : this.bankHold - Math.sign(this.bankHold);
    if (this.bankHold > 20) this.pupSide = -1; else if (this.bankHold < -20) this.pupSide = 1;
    this.pupOff += (this.pupSide * PUP_DX - this.pupOff) * 0.08;
    if (this.buddy && !this.hadBuddy) { this.pupX = this.x + this.pupOff; this.pupY = this.y + 4; }
    this.hadBuddy = this.buddy;
    const i = Math.max(0, this.hx.length - 1 - PUP_LAG);
    const swing = 1 - Math.min(1, Math.abs(this.pupOff) / PUP_DX);   // dips below her while it crosses over
    const tx = (this.hx[i] ?? this.x) + this.pupOff, ty = (this.hy[i] ?? this.y) + 4 + swing * 14;
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
    const base = this.vy < -0.5 ? 7 : this.vy > 0.5 ? 3 : 5;
    return Math.max(2, base + [0, 1, -1][(this.anim >> 1) % 3] - (w <= 2 ? 2 : 0));
  }
  emitTrail() {
    const n = this.anim;
    this.trX.push(this.x); this.trY.push(this.y);
    if (this.trX.length > TRAIL) { this.trX.shift(); this.trY.shift(); }
    if (this.buddy) { this.puX.push(this.pupX); this.puY.push(this.pupY); if (this.puX.length > 5) { this.puX.shift(); this.puY.shift(); } }
    else this.puX.length = this.puY.length = 0;
    // normal flight: a lone 1px ember drops off a pod every 7 ticks so the exhaust always looks alive
    if (!(this.powers.speed > 0) && n % 7 === 0 && this.sparks.length < 24 && this.wakeT <= 0) {
      const r = noise(n * 3 + 1), noz = POM_NOZZLES[this.frameName()] ?? [];
      const [ox, oy] = noz[(n / 7) & 1] ?? noz[0] ?? [0, 0];
      this.sparks.push({ x: this.x + ox + (r - 0.5) * 2, y: this.y + oy + 8, vx: (r - 0.5) * 0.5 - this.vx * 0.2, vy: 1.1 + r * 0.4, t: 0, life: 9 });
    }
    // boosting (speed power-up): a few loose stars kick out of the exhaust
    if (this.powers.speed > 0 && n % 4 === 0 && this.sparks.length < 24) {
      const r = noise(n), [ox, oy] = (POM_NOZZLES[this.frameName()] ?? [[0, 0]])[n & 1] ?? [0, 0];
      this.sparks.push({ x: this.x + ox + (r - 0.5) * 6, y: this.y + oy + 10, vx: (r - 0.5) * 0.8, vy: 1.4, t: 0, life: 12 });
    }
  }
  /** Ribbon points for one nozzle: starts exactly at the flame tip, then follows where that nozzle was on
   *  earlier ticks (so lateral motion leaves a continuous diagonal), drifting down 1.2px per tick;
   *  capped at 7px past the tip when idle, longer when climbing. */
  ribbonPts(xs: number[], ys: number[], sx: number, sy: number, cap: number): [number, number][] {
    const n = xs.length; if (!n) return [];
    const nowX = xs[n - 1], nowY = ys[n - 1];
    const pts: [number, number][] = [[sx, sy]];
    for (let i = 1; i < n; i++) {
      const hx = xs[n - 1 - i], hy = ys[n - 1 - i];
      const px = sx + (hx - nowX) * 0.55, py = Math.max(pts[i - 1][1] + 0.6, sy + (hy - nowY) + i * 1.2);
      if (py - sy > cap) { const k = (cap - (pts[i - 1][1] - sy)) / Math.max(0.01, py - pts[i - 1][1]); pts.push([pts[i - 1][0] + (px - pts[i - 1][0]) * k, sy + cap]); break; }
      pts.push([px, py]);
    }
    return pts;
  }
  /** Scarf tail polyline from the knot: hangs down and flutters when idle, streams opposite to her sideways
   *  motion (along the same position history as the exhaust ribbons) and stretches out when she climbs.
   *  Always mostly downward, so it never reaches across to the wingpup. */
  scarfPts(kx: number, ky: number, side: number, t: number): [number, number][] {
    const n = this.trX.length, moving = Math.abs(this.vx) + Math.abs(this.vy) > 0.4;
    const len = Math.round(8 + clamp(-this.vy, 0, 3) * 0.8 + Math.abs(this.vx) * 0.5);
    const dirX = clamp(-this.vx * 0.3 + side * 0.42, -0.8, 0.8);
    const amp = moving ? 0.9 : 1.4;
    const pts: [number, number][] = [];
    for (let i = 0; i <= len; i += 2) {
      const j = Math.min(n - 1, i >> 1), hx = n ? this.trX[n - 1 - j] - this.x : 0, hy = n ? this.trY[n - 1 - j] - this.y : 0;
      const f = Math.sin(i * 0.6 - t * 0.28) * amp * (i / len);
      const x = kx + dirX * i + clamp(hx * 0.45, -5, 5) + f;
      const y = ky + Math.max(i * 0.55, i * 0.9 + clamp(hy * 0.35, -3, 4)) - f * dirX * 0.6;
      pts.push([x, y]);
    }
    return pts;
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
    if (this.buddy) { const d = clamp(this.pupX - this.x, -30, 30); p.push({ dx: Math.round(Math.abs(d) < 8 ? (d < 0 ? -8 : 8) : d), vx: 0 }); }
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
    if (this.sparks.length) r.push(2, this.y - 40, (ctx: CanvasRenderingContext2D) => {
      for (const s of this.sparks) { const k = s.t / s.life; if (k < 0.8) dot(ctx, sx(s.x), s.y, s.life < 12 ? (k < 0.4 ? 'f' : 'g') : (s.t >> 2) & 1 ? '6' : 'f', s.life >= 12 && k < 0.4); }
    });
    if (g.mods.world?.phase === 'nap' && this.napT >= 0) return this.renderNap(r, ground, sx, tod);
    // solid while paused, during the wake-up and during briefings (invuln only counts down in play/bonus)
    const blink = this.invuln > 0 && !g.paused && this.wakeT <= 0 && g.state.scene !== 'dialogue';
    const whiteFlash = blink && this.invulnMax - this.invuln < 10 && (this.invuln >> 1) % 2 === 0;
    // Galaga-clean blink: 4 ticks visible, 4 ticks gone
    const hidden = blink && !whiteFlash && this.invulnMax - this.invuln >= 10 && ((this.invuln >> 2) & 1) === 1;
    const bob = Math.round(Math.sin(t / 10) * 1.2);
    const px = sx(this.x), py = Math.round(this.y) + bob + (this.kick > 2 ? 1 : 0);
    const base = this.frameName(), name = base + lit;
    const frame = this.kick > 2 && base !== 'pom_stretch' ? 1 : 0;   // tail pompom squashes on a toot
    const nozzles = this.wakeT > WAKE - WAKE_STRETCH ? [] : POM_NOZZLES[base] ?? [];
    if (ground && !hidden) {
      // shadow: light from the upper left; longer at dusk, faint and small at night, none in the sky/space
      const night = tod === 'night', long = tod === 'dusk' || tod === 'dawn', ink = shadowInk(g.state.areaId, tod);
      r.push(1, this.y, (ctx: CanvasRenderingContext2D) => shadowOval(ctx, px + shadowDX(tod), Math.round(this.y) + 19 - bob, (long ? 22 : night ? 14 : 20) + bob, night ? 3 : 5, ink, night));
    }
    if (hidden) { this.renderPup(r, ground, sx, lit, tod, t, g.state.areaId); return; }
    r.push(2, this.y, (ctx: CanvasRenderingContext2D) => {
      // exhaust ribbons from the outer pods (tucked far pods only show a flame)
      // exhaust ribbons (the tucked far pod leaves a thinner 1px one)
      if (!whiteFlash) for (const [ox, oy, w] of nozzles) {
        const len = this.flameLen(w), cap = (this.vy < -0.5 ? 13 : this.vy > 0.5 ? 4 : 7) - (w <= 2 ? 2 : 0);
        ribbon(ctx, this.ribbonPts(this.trX, this.trY, px + ox, py + oy + 1 + len, cap), w <= 2 ? 1 : 2, t);
      }
      // hit flash: a white silhouette that keeps its 1px ink outline and face, so it never reads as a hole
      drawSprite(ctx, whiteFlash ? base + '!w' : name, px, py, { frame });
      const kn = POM_KNOT[base];
      if (kn && !whiteFlash) scarfTail(ctx, this.scarfPts(px + kn[0], py + kn[1], kn[2], t));
      if (!whiteFlash) for (const [ox, oy, w] of nozzles) flame(ctx, px + ox - w / 2, py + oy + 1, w, this.flameLen(w), t);
      if (tod === 'night' && !whiteFlash) {
        // warm pod glow spilling onto her flanks
        ctx.fillStyle = col('g');
        for (const [ox, oy, w] of nozzles) if (w > 2) { const ix = ox < 0 ? px + ox + w / 2 + 1 : px + ox - w / 2 - 2; ctx.fillRect(ix, py + oy - 2, 1, 2); }
      }
      if (this.kick > 0) tootPuff(ctx, px, py - 18, this.kick > 2 ? 0 : 1);
      const sh = this.powers.shield ?? 0;
      if (sh > 0 && !(sh < 180 && (t >> 3) % 2)) {
        const rr = 19 + (Math.sin(t / 22) > 0.2 ? 1 : 0);      // gentle 1px breathing
        shieldRing(ctx, px, py + 1, rr, t);
      }
    });
    this.renderPup(r, ground, sx, lit, tod, t, g.state.areaId);
    if (this.near > 0 && !whiteFlash && this.wakeT <= 0) {
      const hb = this.hitbox();
      r.push(3, this.y, (ctx: CanvasRenderingContext2D) => hitDot(ctx, sx(hb.x + hb.w / 2), Math.round(hb.y + hb.h / 2) + bob, (t >> 3) & 1 ? 'f' : '6'));
    }
  }

  renderPup(r: any, ground: boolean, sx: (wx: number) => number, lit: string, tod: string, t: number, area: string) {
    if (!this.buddy) return;
    const ph = Math.sin(t / 8 + 1.3);
    const pbob = Math.round(ph * 1.6);
    const ppx = sx(this.pupX), ppy = Math.round(this.pupY) + pbob;
    const pn = this.pupName(), noz = PUP_NOZZLES[pn] ?? [];
    if (ground) r.push(1, this.pupY + 1, (ctx: CanvasRenderingContext2D) => shadowOval(ctx, ppx + shadowDX(tod, 0.6), Math.round(this.pupY) + 12 - pbob, tod === 'night' ? 8 : 12, 3, shadowInk(area, tod), tod === 'night'));
    r.push(2, this.pupY + 1, (ctx: CanvasRenderingContext2D) => {
      for (const [ox, oy, w] of noz) {
        const len = 3 + [0, 1, 1][(t >> 1) % 3];
        ribbon(ctx, this.ribbonPts(this.puX, this.puY, ppx + ox, ppy + oy + 1 + len, 5), 2, t);
      }
      drawSprite(ctx, pn + lit, ppx, ppy, { frame: ph > 0.2 ? 1 : 0 });     // ears flap up with the bob
      for (const [ox, oy, w] of noz) flame(ctx, ppx + ox - w / 2, ppy + oy + 1, w, 3 + [0, 1, 1][(t >> 1) % 3], t);
    });
  }

  renderNap(r: any, ground: boolean, sx: (wx: number) => number, tod: string) {
    // the world dims the playfield during a nap; Pom herself is drawn in overlay() so she stays lit, "spotlit" in the dim
    if (ground && this.napT < NAP_CURL) r.push(1, this.y, (ctx: CanvasRenderingContext2D) => shadowOval(ctx, sx(this.x) + shadowDX(tod), Math.round(this.y) + 19, 18, 4, shadowInk(this.g.state.areaId, tod), tod === 'night'));
  }

  /** Nap pose + Zzz, drawn above the world's nap dim (player overlays run after the world's); touch auto-fire tag. */
  overlay(g: Game, ctx: CanvasRenderingContext2D) {
    if (this.touchSeen && this.autoFire && (g.state.scene === 'play' || g.state.scene === 'bonus')) {
      const x = PF_X + 4, y = H - 12;
      ctx.fillStyle = col('0'); ctx.fillRect(x, y, 31, 9);
      ctx.fillStyle = col('r'); ctx.fillRect(x + 1, y + 1, 29, 7);
      text(ctx, 'AUTO', x + 4, y + 1, col('6'));
    }
    if (g.state.scene !== 'play' || g.mods.world?.phase !== 'nap' || this.napT < 0) return;
    const camR = Math.round(this.camF);
    ctx.save();
    ctx.beginPath(); ctx.rect(PF_X, 0, PF_W, H); ctx.clip();
    ctx.translate(PF_X - camR, 0);
    this.drawNap(ctx, Math.round(this.x - this.camF) + camR, Math.round(this.y), g.mods.interaction?.grounded?.() ?? true, g.state.tod);
    ctx.restore();
  }

  drawNap(ctx: CanvasRenderingContext2D, px: number, y0: number, ground: boolean, tod = 'day') {
    const t = this.napT;
    if (t < NAP_CURL) {
      // spin in place with a little hop: left, poodle, right, poodle...
      const seq = ['pom_bank_l', 'pom', 'pom_bank_r', 'pom'];
      const dy = Math.round(Math.sin((t / NAP_CURL) * Math.PI) * -5);
      drawSprite(ctx, seq[(t >> 2) % 4], px, y0 + dy);
      return;
    }
    const k = t - NAP_CURL;
    drawNapPose(ctx, px, y0, k, ground, tod, shadowInk(this.g.state.areaId, tod));
  }
}

export const makePlayer = (): Module => new Player();
