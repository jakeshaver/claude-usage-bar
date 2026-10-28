// Sound effects. Every effect is built from oscillators/noise at call time; nothing is sampled.
import { type Kit, tone, noise, mtof } from './synth';

export const SFX_IDS = ['plop', 'thud', 'meow', 'dive', 'hurt', 'whimper', 'shield', 'pickup', 'memory', 'quest', 'bossdown', 'blip', 'select', 'bark', 'hack', 'tell'] as const;

/** Rough length of each effect in seconds (used for voice limiting and offline rendering). */
export const SFX_LEN: Record<string, number> = { plop: 0.16, thud: 0.1, meow: 0.42, dive: 0.45, hurt: 0.35, whimper: 0.7, shield: 0.5, pickup: 0.3, memory: 1.1, quest: 0.9, bossdown: 1.8, blip: 0.05, select: 0.14, bark: 0.25, hack: 0.32, tell: 0.32 };
/** Max simultaneous voices per effect. */
export const SFX_POLY: Record<string, number> = { plop: 3, thud: 3, meow: 3, dive: 2, hack: 2, tell: 2 };
/**
 * Per-effect output trim, calibrated with renderSfxOffline so the families sit together:
 * gameplay cues (plop, thud, dive, meow, hack) ~0.30-0.40 peak, UI (blip, select) ~0.15-0.20,
 * big stingers (bossdown, quest, memory) ~0.45-0.55.
 */
export const SFX_GAIN: Record<string, number> = {
  plop: 1.42, thud: 2.3, meow: 1.5, dive: 3.0, hack: 1.2, bark: 1.15, tell: 1.75,
  hurt: 0.85, whimper: 2, shield: 1.9, pickup: 1.9,
  memory: 2.4, quest: 1.5, bossdown: 0.84,
  blip: 2.3, select: 1.55,
};

export interface SfxOpts { gain?: number; variant?: number; short?: boolean }

/**
 * Voice manager shared by the live module and the offline renderer: per-id polyphony, duplicate
 * suppression, and the held-fire treatment for plop (shorter, quieter per overlapping voice, rotating
 * through 4 pitch/formant variants so autofire never phases or piles up into the loudest thing in the mix).
 */
export class SfxVoices {
  private ends: Record<string, number[]> = {};
  private lastStart: Record<string, number> = {};
  private streak: Record<string, number> = {};
  private rot = 0;
  play(k: Kit, out: AudioNode, id: string, t: number): boolean {
    const len = SFX_LEN[id]; if (len === undefined) return false;
    const v = (this.ends[id] ??= []).filter(e => e > t); this.ends[id] = v;
    if (v.length >= (SFX_POLY[id] ?? 4)) return false;
    const last = this.lastStart[id] ?? -9;
    if (t - last < 0.025) return false; // same sfx < 25 ms ago: skip (avoids phasing)
    const rapid = t - last < 0.32;
    this.streak[id] = rapid ? (this.streak[id] ?? 0) + 1 : 0;
    const o: SfxOpts = {};
    if (id === 'plop') {
      o.variant = this.rot++ % 4;
      o.short = rapid;
      // -2 dB per overlapping voice, and autofire sits a further 4.5 dB under a single tap
      o.gain = Math.pow(10, (-2 * v.length - (rapid ? 4.5 : 0)) / 20);
    } else if (rapid && (id === 'thud' || id === 'meow' || id === 'hack')) {
      o.gain = Math.pow(10, (-1.5 * v.length - 1.5) / 20);
      o.variant = this.streak[id] % 3;
    }
    v.push(t + (o.short ? 0.1 : len)); this.lastStart[id] = t;
    playSfx(k, out, id, t, o);
    return true;
  }
}

/** Cute synthesized cat meow: pulse source through two moving formant filters ("m-ee-ow"). */
function meow(k: Kit, out: AudioNode, t: number) {
  const c = k.ctx; const r = k.rng;
  const p = r.range(560, 820); const L = r.range(0.26, 0.38);
  const o = c.createOscillator(); o.setPeriodicWave(k.pulse['0.25']);
  o.frequency.setValueAtTime(p * 0.82, t);
  o.frequency.linearRampToValueAtTime(p * 1.22, t + L * 0.28);
  o.frequency.linearRampToValueAtTime(p * 1.08, t + L * 0.6);
  o.frequency.exponentialRampToValueAtTime(p * 0.7, t + L);
  const vib = c.createOscillator(); vib.frequency.value = 7.5; const vg = c.createGain(); vg.gain.value = 22; vib.connect(vg); vg.connect(o.detune);
  const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 3.5;
  f1.frequency.setValueAtTime(650, t); f1.frequency.linearRampToValueAtTime(1350, t + L * 0.35); f1.frequency.linearRampToValueAtTime(800, t + L);
  const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 5;
  f2.frequency.setValueAtTime(1900, t); f2.frequency.linearRampToValueAtTime(2700, t + L * 0.35); f2.frequency.linearRampToValueAtTime(1500, t + L);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.95, t + 0.035); g.gain.setTargetAtTime(0.7, t + 0.05, 0.08);
  g.gain.setTargetAtTime(0, t + L * 0.8, L * 0.08);
  const g2 = c.createGain(); g2.gain.value = 0.55;
  o.connect(f1); o.connect(f2); f1.connect(g); f2.connect(g2); g2.connect(g); g.connect(out);
  o.start(t); vib.start(t); o.stop(t + L + 0.1); vib.stop(t + L + 0.1);
}

/** The signature turd toot: a fluttery little "pbbt" followed by a bubbly "plip". */
const PLOP_VAR = [{ p: 1, f: 1100 }, { p: 1.12, f: 1300 }, { p: 0.9, f: 950 }, { p: 1.26, f: 1500 }];
function plop(k: Kit, out: AudioNode, t: number, variant = 0, short = false) {
  const c = k.ctx; const r = k.rng; const V = PLOP_VAR[variant % PLOP_VAR.length];
  const base = r.range(110, 126) * V.p; const sc = short ? 0.62 : 1;
  const o = c.createOscillator(); o.setPeriodicWave(k.pulse['0.25']);
  o.frequency.setValueAtTime(base * 1.15, t); o.frequency.exponentialRampToValueAtTime(base * 0.7, t + 0.08 * sc);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = V.f; lp.Q.value = 2;
  const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.34, t + 0.006); g.gain.setTargetAtTime(0, t + 0.06 * sc, 0.015 * sc);
  // flutter: square LFO chopping the amplitude (the "brrrt")
  const am = c.createGain(); am.gain.value = 0.5;
  const fl = c.createOscillator(); fl.type = 'square'; fl.frequency.value = r.range(34, 44);
  const fg = c.createGain(); fg.gain.value = 0.5; fl.connect(fg); fg.connect(am.gain);
  o.connect(lp); lp.connect(am); am.connect(g); g.connect(out);
  o.start(t); fl.start(t); o.stop(t + 0.14 * sc); fl.stop(t + 0.14 * sc);
  // bubbly plip (rising sine = water-drop "bloop")
  const b = r.range(390, 450) * V.p;
  tone(k, out, t + 0.06 * sc, b, 0.05 * sc, 0.3, { wave: 'sine', slideTo: b * 2.3, slideTime: 0.045 * sc, attack: 0.002, sustain: 0.6, decay: 0.03, release: 0.03 * sc });
}

/** Cat hairball "hack": two raspy throat bursts with a falling triangle "hurk". Soft: it fires often. */
function hack(k: Kit, out: AudioNode, t: number, variant = 0) {
  const p = [1, 1.1, 0.92][variant % 3];
  noise(k, out, t, 0.06, 0.55, { type: 'bandpass', freq: 1400 * p, q: 2.2, sweepTo: 900 * p });
  noise(k, out, t + 0.1, 0.09, 0.6, { type: 'bandpass', freq: 1200 * p, q: 2, sweepTo: 600 * p });
  tone(k, out, t + 0.1, 520 * p, 0.14, 0.28, { wave: 'tri', slideTo: 170 * p, attack: 0.004, release: 0.05 });
  tone(k, out, t + 0.02, 330 * p, 0.05, 0.14, { wave: 'pulse', duty: 0.125, slideTo: 250 * p, lp: 1200, attack: 0.002, release: 0.03 });
}

function bark(k: Kit, out: AudioNode, t: number) {
  const c = k.ctx;
  const yap = (t0: number, p: number, v: number) => {
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(p, t0); o.frequency.linearRampToValueAtTime(p * 1.15, t0 + 0.02); o.frequency.exponentialRampToValueAtTime(p * 0.55, t0 + 0.1);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(1300, t0); bp.frequency.linearRampToValueAtTime(800, t0 + 0.1); bp.Q.value = 1.6;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
    const g = c.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(v, t0 + 0.008); g.gain.setTargetAtTime(0, t0 + 0.05, 0.022);
    o.connect(bp); bp.connect(lp); lp.connect(g); g.connect(out); o.start(t0); o.stop(t0 + 0.18);
    noise(k, out, t0, 0.025, v * 0.35, { type: 'bandpass', freq: 2000, q: 1 });
  };
  yap(t, 620, 0.9);
}

export function playSfx(k: Kit, dest: AudioNode, id: string, t: number, o: SfxOpts = {}): void {
  const r = k.rng;
  const trim = k.ctx.createGain(); trim.gain.value = (SFX_GAIN[id] ?? 1) * (o.gain ?? 1); trim.connect(dest);
  const out: AudioNode = trim;
  switch (id) {
    case 'plop': plop(k, out, t, o.variant, o.short); break;
    case 'hack': hack(k, out, t, o.variant); break;
    case 'tell': // boss wind-up: rising two-note chirp with a duty flip on the second note
      tone(k, out, t, mtof(76), 0.1, 0.3, { wave: 'pulse', duty: 0.25, slideTo: mtof(79), slideTime: 0.08, attack: 0.002, sustain: 0.9, release: 0.02 });
      tone(k, out, t + 0.13, mtof(83), 0.14, 0.32, { wave: 'pulse', duty: 0.125, dutyTo: 0.5, dutyAt: 0.06, slideTo: mtof(88), slideTime: 0.12, vib: 30, attack: 0.002, sustain: 0.9, release: 0.04 });
      break;
    case 'thud':
      tone(k, out, t, r.range(200, 240) * [1, 1.08, 0.93][(o.variant ?? 0) % 3], 0.07, 0.55, { wave: 'tri', slideTo: 70, attack: 0.001, sustain: 0.5, decay: 0.04, release: 0.03 });
      noise(k, out, t, 0.04, 0.22, { type: 'lowpass', freq: 900 });
      break;
    case 'meow': meow(k, out, t); break;
    case 'dive': // Galaga-style swooping whistle
      tone(k, out, t, 1500, 0.42, 0.24, { wave: 'pulse', duty: 0.125, slideTo: 330, slideTime: 0.42, vib: 45, vibRate: 11, sustain: 0.8, release: 0.05 });
      break;
    case 'hurt': // startled little "yip!" + bump
      tone(k, out, t, 940, 0.12, 0.32, { wave: 'pulse', duty: 0.25, slideTo: 1250, slideTime: 0.03, release: 0.03 });
      tone(k, out, t + 0.1, 1100, 0.2, 0.26, { wave: 'pulse', duty: 0.25, slideTo: 420, vib: 30, release: 0.05 });
      tone(k, out, t, 160, 0.14, 0.5, { wave: 'sine', slideTo: 55, attack: 0.001 });
      noise(k, out, t, 0.12, 0.25, { type: 'lowpass', freq: 1200, sweepTo: 200 });
      break;
    case 'whimper': // "hnn... hnnn"
      tone(k, out, t, 900, 0.18, 0.5, { wave: 'tri', slideTo: 1150, slideTime: 0.1, vib: 40, vibRate: 9, attack: 0.03, release: 0.05 });
      tone(k, out, t + 0.26, 1050, 0.36, 0.5, { wave: 'tri', slideTo: 700, vib: 50, vibRate: 8, attack: 0.04, release: 0.08 });
      break;
    case 'shield': // bubble shield pops: rising shimmer
      tone(k, out, t, 380, 0.24, 0.2, { wave: 'pulse', duty: 0.125, slideTo: 1600, release: 0.06 });
      tone(k, out, t, 390, 0.24, 0.12, { wave: 'pulse', duty: 0.5, slideTo: 1640, release: 0.06, detune: 12 });
      [1568, 2093, 2637].forEach((f, i) => tone(k, out, t + 0.2 + i * 0.05, f, 0.14, 0.1, { wave: 'tri', release: 0.08 }));
      break;
    case 'pickup': // classic coin: B5 -> E6
      tone(k, out, t, mtof(83), 0.06, 0.22, { wave: 'pulse', duty: 0.25, sustain: 0.9 });
      tone(k, out, t + 0.06, mtof(88), 0.22, 0.22, { wave: 'pulse', duty: 0.25, sustain: 0.7, decay: 0.15, vib: 15 });
      break;
    case 'memory': { // dreamy maj9 arpeggio with soft echoes + sparkle
      const notes = [72, 76, 79, 83, 86];
      notes.forEach((m, i) => {
        tone(k, out, t + i * 0.09, mtof(m), 0.34, 0.24, { wave: 'tri', vib: 12, release: 0.15 });
        tone(k, out, t + 0.27 + i * 0.09, mtof(m + 12), 0.2, 0.06, { wave: 'pulse', duty: 0.125, release: 0.12 });
      });
      noise(k, out, t + 0.4, 0.5, 0.05, { type: 'highpass', freq: 8000 });
      break;
    }
    case 'quest': { // little fanfare: G C E . G(held) with harmony
      const mel: [number, number, number][] = [[67, 0, 0.08], [72, 0.09, 0.08], [76, 0.18, 0.08], [79, 0.3, 0.45]];
      for (const [m, dt, d] of mel) {
        tone(k, out, t + dt, mtof(m), d, 0.2, { wave: 'pulse', duty: 0.25, vib: d > 0.2 ? 18 : 0, release: 0.08 });
        tone(k, out, t + dt, mtof(m - 4), d, 0.11, { wave: 'pulse', duty: 0.5, release: 0.08 });
      }
      tone(k, out, t + 0.3, mtof(48), 0.45, 0.35, { wave: 'tri', release: 0.1 });
      break;
    }
    case 'bossdown': { // big poof, tumbling notes, then a bright major chord
      noise(k, out, t, 1.1, 0.55, { type: 'lowpass', freq: 5000, sweepTo: 90, q: 1.5 });
      [0, 0.12, 0.26].forEach(dt => tone(k, out, t + dt, 140, 0.18, 0.55, { wave: 'sine', slideTo: 40, attack: 0.001 }));
      [88, 84, 81, 76, 72].forEach((m, i) => tone(k, out, t + 0.1 + i * 0.07, mtof(m), 0.08, 0.14, { wave: 'pulse', duty: 0.25 }));
      [72, 76, 79, 84].forEach(m => tone(k, out, t + 0.55, mtof(m), 0.9, 0.11, { wave: 'pulse', duty: m === 84 ? 0.25 : 0.125, vib: 14, sustain: 0.7, decay: 0.3, release: 0.3 }));
      tone(k, out, t + 0.55, mtof(48), 0.9, 0.35, { wave: 'tri', sustain: 0.8, release: 0.3 });
      break;
    }
    case 'blip': tone(k, out, t, 1760, 0.028, 0.2, { wave: 'pulse', duty: 0.25, attack: 0.001, sustain: 1, release: 0.012 }); break;
    case 'select':
      tone(k, out, t, mtof(88), 0.045, 0.24, { wave: 'pulse', duty: 0.5, sustain: 1, release: 0.02 });
      tone(k, out, t + 0.05, mtof(93), 0.08, 0.22, { wave: 'pulse', duty: 0.5, sustain: 0.8, release: 0.03 });
      break;
    case 'bark': bark(k, out, t); break;
  }
}
