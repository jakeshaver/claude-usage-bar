// Ambience beds: a few continuous, slowly-modulated layers plus sparse randomized one-shot details.
import { type Kit, tone, noise, noiseBed, lfo } from './synth';

export const AMBIENCE_IDS = ['birds', 'city', 'wind', 'cafe', 'water', 'factory', 'space'] as const;

export interface AmbHandle { id: string; stop(t: number): void; tick(until: number, now?: number): void }

interface Ev { next: number; min: number; max: number; fire: (t: number) => void }

export function startAmbience(k: Kit, out: AudioNode, id: string, t0: number): AmbHandle | null {
  if (!(AMBIENCE_IDS as readonly string[]).includes(id)) return null;
  const c = k.ctx; const r = k.rng;
  const bus = c.createGain(); bus.gain.setValueAtTime(0, t0); bus.gain.linearRampToValueAtTime(1, t0 + 1.5); bus.connect(out);
  const srcs: AudioScheduledSourceNode[] = [];
  const evs: Ev[] = [];
  const bed = (type: BiquadFilterType, f: number, q: number, v: number) => { const b = noiseBed(k, bus, type, f, q, v, t0); srcs.push(b.src); return b; };
  const osc = (type: OscillatorType, f: number, v: number, lp = 0) => {
    const o = c.createOscillator(); o.type = type; o.frequency.value = f; const g = c.createGain(); g.gain.value = v;
    if (lp) { const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; o.connect(fl); fl.connect(g); } else o.connect(g);
    g.connect(bus); o.start(t0); srcs.push(o); return { o, g };
  };
  const mod = (p: AudioParam, rate: number, depth: number) => { srcs.push(lfo(k, p, rate, depth, t0)); };
  const every = (min: number, max: number, fire: (t: number) => void, first = 0.5) => evs.push({ next: t0 + first + r.range(0, max - min), min, max, fire });
  // one-shot sound sources route through `bus` so they fade with the bed
  const O = bus;

  switch (id) {
    case 'birds': {
      const leaves = bed('bandpass', 3200, 0.6, 0.012); mod(leaves.gain.gain, 0.13, 0.008);
      bed('lowpass', 380, 0.5, 0.05);
      every(0.7, 2.8, t => { // chirp trill
        const n = r.int(2, 6); const f = r.range(2600, 4200); const up = r.next() < 0.6;
        for (let i = 0; i < n; i++) tone(k, O, t + i * 0.075, f * (1 + i * 0.02), 0.045, 0.045, { wave: 'sine', slideTo: f * (up ? 1.35 : 0.75), slideTime: 0.04, attack: 0.004, release: 0.02 });
      });
      every(9, 17, t => { // dove: coo-COO-coo
        [[520, 0, 0.18], [640, 0.26, 0.3], [520, 0.66, 0.22]].forEach(([f, dt, d]) => tone(k, O, t + dt, f, d, 0.035, { wave: 'sine', slideTo: f * 0.9, attack: 0.05, release: 0.08, vib: 20 }));
      }, 4);
      break;
    }
    case 'city': {
      bed('lowpass', 170, 0.6, 0.13);
      const traffic = bed('bandpass', 700, 0.8, 0.025); mod(traffic.gain.gain, 0.07, 0.015); mod(traffic.filter.frequency, 0.05, 200);
      every(4, 9, t => { // car passing
        const s = c.createBufferSource(); s.buffer = k.noise; s.loop = true;
        const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2; f.frequency.setValueAtTime(380, t); f.frequency.linearRampToValueAtTime(1100, t + 1.2); f.frequency.linearRampToValueAtTime(420, t + 2.6);
        const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 1.2); g.gain.linearRampToValueAtTime(0, t + 2.6);
        s.connect(f); f.connect(g); g.connect(O); s.start(t, r.range(0, 1)); s.stop(t + 2.7);
      }, 1.5);
      every(13, 24, t => { [0, 0.18].forEach(dt => { tone(k, O, t + dt, 2350, 0.5, 0.025, { wave: 'sine', attack: 0.002, sustain: 0.3, decay: 0.25 }); tone(k, O, t + dt, 3170, 0.4, 0.012, { wave: 'sine', attack: 0.002, sustain: 0.2, decay: 0.2 }); }); }, 6);
      every(20, 34, t => { tone(k, O, t, 349, 0.32, 0.018, { wave: 'pulse', duty: 0.5, lp: 900 }); tone(k, O, t, 440, 0.32, 0.015, { wave: 'pulse', duty: 0.5, lp: 900 }); }, 10);
      break;
    }
    case 'wind': {
      const a = bed('bandpass', 520, 1.1, 0.07); mod(a.filter.frequency, 0.11, 240); mod(a.gain.gain, 0.09, 0.035);
      const b = bed('bandpass', 1300, 2.2, 0.03); mod(b.filter.frequency, 0.07, 520); mod(b.gain.gain, 0.13, 0.02);
      every(6, 12, t => {
        const s = c.createBufferSource(); s.buffer = k.noise; s.loop = true;
        const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.6; f.frequency.setValueAtTime(500, t); f.frequency.linearRampToValueAtTime(1500, t + 1); f.frequency.linearRampToValueAtTime(600, t + 2.4);
        const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.9); g.gain.linearRampToValueAtTime(0, t + 2.4);
        s.connect(f); f.connect(g); g.connect(O); s.start(t, r.range(0, 1)); s.stop(t + 2.5);
      }, 2);
      every(14, 26, t => tone(k, O, t, r.range(820, 1000), 1.6, 0.012, { wave: 'sine', slideTo: r.range(1000, 1250), attack: 0.6, release: 0.6, vib: 25, vibRate: 3 }), 7);
      break;
    }
    case 'cafe': {
      bed('lowpass', 260, 0.5, 0.08);
      for (const [f, rate] of [[380, 0.37], [720, 0.53], [1150, 0.71]] as const) { const m = bed('bandpass', f, 3, 0.03); mod(m.gain.gain, rate, 0.022); mod(m.filter.frequency, rate * 0.6, f * 0.18); }
      every(1.8, 6, t => { // cup / spoon clink
        const f = r.range(3400, 4400); const n = r.next() < 0.3 ? 2 : 1;
        for (let i = 0; i < n; i++) { tone(k, O, t + i * 0.12, f, 0.18, 0.02, { wave: 'sine', attack: 0.001, sustain: 0.25, decay: 0.08, release: 0.06 }); tone(k, O, t + i * 0.12, f * 1.47, 0.12, 0.01, { wave: 'sine', attack: 0.001, sustain: 0.2, decay: 0.05 }); }
      });
      every(18, 30, t => noise(k, O, t, 2.2, 0.035, { type: 'highpass', freq: 3200, attack: 0.5 }), 8);
      break;
    }
    case 'water': {
      const w = bed('lowpass', 480, 0.6, 0.07); mod(w.gain.gain, 0.12, 0.05);
      const hiss = bed('highpass', 2600, 0.5, 0.008); mod(hiss.gain.gain, 0.12, 0.006);
      every(0.6, 2.2, t => { const f = r.range(700, 1100); tone(k, O, t, f, 0.06, 0.03, { wave: 'sine', slideTo: f * 0.4, attack: 0.002, release: 0.03 }); });
      every(10, 20, t => { const n = r.int(2, 3); for (let i = 0; i < n; i++) tone(k, O, t + i * 0.32, 1350, 0.24, 0.022, { wave: 'pulse', duty: 0.25, slideTo: 900, vib: 40, vibRate: 12, lp: 2200, release: 0.06 }); }, 3);
      every(30, 48, t => { tone(k, O, t, 73.4, 1.8, 0.05, { wave: 'saw', lp: 320, attack: 0.4, release: 0.6 }); tone(k, O, t, 110, 1.8, 0.03, { wave: 'saw', lp: 320, attack: 0.4, release: 0.6 }); }, 12);
      break;
    }
    case 'factory': {
      osc('sawtooth', 55, 0.035, 220); osc('sine', 110, 0.018);
      bed('lowpass', 300, 0.7, 0.06);
      let beat = 0;
      every(0.857, 0.857, t => { // steady machine rhythm: thump . clank . thump . clank-clank
        const ph = beat++ % 4;
        if (ph % 2 === 0) tone(k, O, t, 90, 0.12, 0.09, { wave: 'tri', slideTo: 48, attack: 0.001 });
        else { noise(k, O, t, 0.07, 0.04, { type: 'bandpass', freq: 1800, q: 3 }); tone(k, O, t, 1250, 0.06, 0.012, { wave: 'pulse', duty: 0.125, attack: 0.001 }); tone(k, O, t, 1870, 0.05, 0.008, { wave: 'pulse', duty: 0.125, attack: 0.001 }); }
      }, 0.3);
      every(8, 14, t => noise(k, O, t, 1.2, 0.03, { type: 'highpass', freq: 2500, attack: 0.15 }), 4);
      break;
    }
    case 'space': {
      osc('sine', 55, 0.03); osc('sine', 55.35, 0.03); osc('triangle', 82.4, 0.015, 400);
      const neb = bed('lowpass', 320, 2, 0.03); mod(neb.filter.frequency, 0.05, 180);
      const PENT = [0, 2, 4, 7, 9];
      every(1.4, 4, t => { const m = 84 + PENT[r.int(0, 4)] + 12 * r.int(0, 1); const f = 440 * Math.pow(2, (m - 69) / 12); tone(k, O, t, f, 0.4, 0.016, { wave: 'sine', attack: 0.01, sustain: 0.4, decay: 0.2, release: 0.2 }); tone(k, O, t + 0.28, f, 0.3, 0.007, { wave: 'sine', sustain: 0.4, release: 0.2 }); });
      every(8, 15, t => { const n = r.int(3, 5); for (let i = 0; i < n; i++) tone(k, O, t + i * 0.06, r.range(1200, 2400), 0.04, 0.012, { wave: 'pulse', duty: 0.25, sustain: 1, release: 0.01 }); }, 3);
      break;
    }
  }

  return {
    id,
    tick(until: number, now = -Infinity) {
      for (const e of evs) {
        if (e.next < now - 0.1) e.next = now + r.range(0, e.max - e.min) + 0.05; // tab was hidden: never burst-fire stale events
        let guard = 0; while (e.next < until && guard++ < 64) { e.fire(e.next); e.next += r.range(e.min, e.max); } }
    },
    stop(t: number) {
      bus.gain.cancelScheduledValues(t); bus.gain.setValueAtTime(bus.gain.value, t); bus.gain.linearRampToValueAtTime(0, t + 0.8);
      for (const s of srcs) { try { s.stop(t + 0.9); } catch { /* already stopped */ } }
      evs.length = 0;
    },
  };
}
