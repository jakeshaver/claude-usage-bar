// Sound effects. Every effect is built from oscillators/noise at call time; nothing is sampled.
import { type Kit, tone, noise, mtof } from './synth';

export const SFX_IDS = ['plop', 'thud', 'meow', 'dive', 'hurt', 'whimper', 'shield', 'pickup', 'memory', 'quest', 'bossdown', 'blip', 'select', 'bark'] as const;

/** Rough length of each effect in seconds (used for voice limiting and offline rendering). */
export const SFX_LEN: Record<string, number> = { plop: 0.16, thud: 0.1, meow: 0.42, dive: 0.45, hurt: 0.35, whimper: 0.7, shield: 0.5, pickup: 0.3, memory: 1.1, quest: 0.9, bossdown: 1.8, blip: 0.05, select: 0.14, bark: 0.25 };
/** Max simultaneous voices per effect. */
export const SFX_POLY: Record<string, number> = { plop: 3, thud: 3, meow: 3, dive: 2 };

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
function plop(k: Kit, out: AudioNode, t: number) {
  const c = k.ctx; const r = k.rng;
  const base = r.range(105, 135);
  const o = c.createOscillator(); o.setPeriodicWave(k.pulse['0.25']);
  o.frequency.setValueAtTime(base * 1.15, t); o.frequency.exponentialRampToValueAtTime(base * 0.7, t + 0.08);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100; lp.Q.value = 2;
  const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.34, t + 0.006); g.gain.setTargetAtTime(0, t + 0.06, 0.015);
  // flutter: square LFO chopping the amplitude (the "brrrt")
  const am = c.createGain(); am.gain.value = 0.5;
  const fl = c.createOscillator(); fl.type = 'square'; fl.frequency.value = r.range(34, 44);
  const fg = c.createGain(); fg.gain.value = 0.5; fl.connect(fg); fg.connect(am.gain);
  o.connect(lp); lp.connect(am); am.connect(g); g.connect(out);
  o.start(t); fl.start(t); o.stop(t + 0.14); fl.stop(t + 0.14);
  // bubbly plip (rising sine = water-drop "bloop")
  const b = r.range(380, 460);
  tone(k, out, t + 0.06, b, 0.05, 0.3, { wave: 'sine', slideTo: b * 2.3, slideTime: 0.045, attack: 0.002, sustain: 0.6, decay: 0.03, release: 0.03 });
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

export function playSfx(k: Kit, out: AudioNode, id: string, t: number): void {
  const r = k.rng;
  switch (id) {
    case 'plop': plop(k, out, t); break;
    case 'thud':
      tone(k, out, t, r.range(200, 240), 0.07, 0.55, { wave: 'tri', slideTo: 70, attack: 0.001, sustain: 0.5, decay: 0.04, release: 0.03 });
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
