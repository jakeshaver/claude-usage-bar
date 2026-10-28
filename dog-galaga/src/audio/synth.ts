// Low-level chiptune voices shared by the live engine and the offline renderer.
// Everything takes a BaseAudioContext so it works for AudioContext and OfflineAudioContext alike.
import { Rng } from '../core/rng';

const NOTE_IDX: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
/** 'A4' -> 69. Returns -1 for anything that is not a note name. */
export function midiOf(n: string): number {
  const m = /^([A-G][#b]?)(-?\d)$/.exec(n); if (!m || NOTE_IDX[m[1]] === undefined) return -1;
  return NOTE_IDX[m[1]] + (+m[2] + 1) * 12;
}
export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
export const noteIndex = (name: string): number => NOTE_IDX[name] ?? -1;

export type Duty = 0.125 | 0.25 | 0.5;

/** Shared, per-context resources: noise buffers and PeriodicWaves (pulse duties + stepped NES triangle). */
export interface Kit {
  ctx: BaseAudioContext;
  noise: AudioBuffer;
  pulse: Record<string, PeriodicWave>;
  tri: PeriodicWave;
  rng: Rng;
}

export function makeKit(ctx: BaseAudioContext, seed = 0x9e3779b1): Kit {
  const rng = new Rng(seed);
  const len = Math.floor(ctx.sampleRate * 2);
  const noise = ctx.createBuffer(1, len, ctx.sampleRate); const d = noise.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = rng.next() * 2 - 1;
  const H = 48;
  const pulse: Record<string, PeriodicWave> = {};
  for (const duty of [0.125, 0.25, 0.5]) {
    const re = new Float32Array(H + 1), im = new Float32Array(H + 1);
    for (let n = 1; n <= H; n++) re[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
    pulse[String(duty)] = ctx.createPeriodicWave(re, im);
  }
  // 4-bit stepped triangle (NES-style): DFT of a 32-step table.
  const tbl: number[] = []; for (let i = 0; i < 32; i++) tbl.push(i < 16 ? 15 - i : i - 16);
  const re = new Float32Array(33), im = new Float32Array(33);
  for (let n = 1; n <= 32; n++) {
    let a = 0, b = 0;
    for (let i = 0; i < 32; i++) { const v = tbl[i] / 7.5 - 1; const ph = (2 * Math.PI * n * i) / 32; a += v * Math.cos(ph); b += v * Math.sin(ph); }
    re[n] = (2 * a) / 32; im[n] = (2 * b) / 32;
  }
  const tri = ctx.createPeriodicWave(re, im);
  return { ctx, noise, pulse, tri, rng };
}

export interface ToneOpts {
  wave?: 'pulse' | 'tri' | 'sine' | 'saw';
  duty?: Duty;
  /** vibrato depth in cents (fades in after ~120 ms). */
  vib?: number; vibRate?: number;
  /** pitch slide target in Hz (exponential over the note). */
  slideTo?: number; slideTime?: number;
  attack?: number; release?: number;
  /** sustain level as a fraction of vol (decay over `decay` s). */
  sustain?: number; decay?: number;
  /** optional lowpass cutoff for softening. */
  lp?: number;
  detune?: number;
}

/** One enveloped oscillator note. Returns the end time. */
export function tone(k: Kit, out: AudioNode, t: number, freq: number, dur: number, vol: number, o: ToneOpts = {}): number {
  if (!(freq > 0) || !(dur > 0) || !(vol > 0)) return t;
  const c = k.ctx;
  const osc = c.createOscillator();
  const w = o.wave ?? 'pulse';
  if (w === 'pulse') osc.setPeriodicWave(k.pulse[String(o.duty ?? 0.5)]);
  else if (w === 'tri') osc.setPeriodicWave(k.tri);
  else osc.type = w === 'saw' ? 'sawtooth' : 'sine';
  osc.frequency.setValueAtTime(freq, t);
  if (o.detune) osc.detune.setValueAtTime(o.detune, t);
  if (o.slideTo && o.slideTo > 0) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t + (o.slideTime ?? dur));
  const g = c.createGain();
  const a = o.attack ?? 0.004, r = o.release ?? 0.04;
  const sus = (o.sustain ?? 0.75) * vol, dec = o.decay ?? 0.09;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + a);
  g.gain.setTargetAtTime(sus, t + a, dec / 3);
  const end = t + Math.max(dur, a + 0.005);
  g.gain.setTargetAtTime(0, end, r / 4);
  let node: AudioNode = osc;
  if (o.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; f.Q.value = 0.5; osc.connect(f); node = f; }
  node.connect(g); g.connect(out);
  let lfo: OscillatorNode | null = null;
  if (o.vib && dur > 0.18) {
    lfo = c.createOscillator(); lfo.frequency.value = o.vibRate ?? 5.6;
    const lg = c.createGain(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(0, t + 0.12); lg.gain.linearRampToValueAtTime(o.vib, t + Math.min(dur, 0.45));
    lfo.connect(lg); lg.connect(osc.detune); lfo.start(t); lfo.stop(end + r + 0.05);
  }
  osc.start(t); osc.stop(end + r + 0.05);
  return end + r;
}

export interface NoiseOpts { type?: BiquadFilterType; freq?: number; q?: number; sweepTo?: number; attack?: number; rate?: number }
/** Filtered noise burst with exponential decay over `dur`. */
export function noise(k: Kit, out: AudioNode, t: number, dur: number, vol: number, o: NoiseOpts = {}): number {
  if (!(dur > 0) || !(vol > 0)) return t;
  const c = k.ctx;
  const s = c.createBufferSource(); s.buffer = k.noise; if (o.rate) s.playbackRate.value = o.rate;
  const f = c.createBiquadFilter(); f.type = o.type ?? 'highpass'; f.frequency.setValueAtTime(o.freq ?? 1000, t); f.Q.value = o.q ?? 0.7;
  if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, t + dur);
  const g = c.createGain(); const a = o.attack ?? 0.002;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + a);
  g.gain.exponentialRampToValueAtTime(0.0005, t + a + dur);
  s.connect(f); f.connect(g); g.connect(out);
  const off = k.rng.next() * (k.noise.duration - dur - 0.1);
  s.start(t, Math.max(0, off), dur + a + 0.05);
  return t + a + dur;
}

/** Continuous looping noise through a filter (for ambience beds). Caller owns the returned nodes. */
export function noiseBed(k: Kit, out: AudioNode, type: BiquadFilterType, freq: number, q: number, vol: number, t: number): { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } {
  const c = k.ctx;
  const src = c.createBufferSource(); src.buffer = k.noise; src.loop = true;
  const filter = c.createBiquadFilter(); filter.type = type; filter.frequency.value = freq; filter.Q.value = q;
  const gain = c.createGain(); gain.gain.value = vol;
  src.connect(filter); filter.connect(gain); gain.connect(out);
  src.start(t, k.rng.next() * 1.5);
  return { src, filter, gain };
}

/** Slow LFO modulating an AudioParam: param += sin * depth. */
export function lfo(k: Kit, param: AudioParam, rate: number, depth: number, t: number, shape: OscillatorType = 'sine'): OscillatorNode {
  const c = k.ctx; const o = c.createOscillator(); o.type = shape; o.frequency.value = rate;
  const g = c.createGain(); g.gain.value = depth; o.connect(g); g.connect(param); o.start(t);
  return o;
}

// ---- drum kit -------------------------------------------------------------------------------
export function drum(k: Kit, out: AudioNode, t: number, kind: string, vol = 1): void {
  switch (kind) {
    case 'k': // kick: triangle pitch drop + click
      tone(k, out, t, 150, 0.11, 0.9 * vol, { wave: 'sine', slideTo: 42, slideTime: 0.1, attack: 0.001, sustain: 0.6, decay: 0.08, release: 0.05 });
      noise(k, out, t, 0.012, 0.25 * vol, { type: 'lowpass', freq: 2500 });
      break;
    case 's': // snare: body tone + bright noise
      tone(k, out, t, 210, 0.05, 0.35 * vol, { wave: 'tri', slideTo: 150, attack: 0.001, release: 0.03 });
      noise(k, out, t, 0.13, 0.42 * vol, { type: 'bandpass', freq: 2400, q: 0.6 });
      break;
    case 'h': noise(k, out, t, 0.028, 0.16 * vol, { type: 'highpass', freq: 7500 }); break;
    case 'o': noise(k, out, t, 0.16, 0.13 * vol, { type: 'highpass', freq: 6500 }); break;
    case 'c': noise(k, out, t, 0.9, 0.22 * vol, { type: 'highpass', freq: 4000, sweepTo: 7000 }); break;
    case 't': tone(k, out, t, 180, 0.14, 0.5 * vol, { wave: 'tri', slideTo: 90, attack: 0.001, release: 0.04 }); break;
    case 'T': tone(k, out, t, 120, 0.16, 0.55 * vol, { wave: 'tri', slideTo: 65, attack: 0.001, release: 0.04 }); break;
    case 'x': // clap / rim
      noise(k, out, t, 0.02, 0.3 * vol, { type: 'bandpass', freq: 1500, q: 1.2 });
      noise(k, out, t + 0.012, 0.07, 0.28 * vol, { type: 'bandpass', freq: 1300, q: 1.2 });
      break;
  }
}
