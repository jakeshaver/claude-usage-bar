// Ambience beds: a few continuous, slowly-modulated layers plus sparse randomized one-shot details.
import { type Kit, tone, noise, noiseBed, lfo, mtof as mtof2 } from './synth';

export const AMBIENCE_IDS = ['birds', 'city', 'wind', 'cafe', 'water', 'factory', 'space'] as const;

/** Per-bed trim so every bed lands around 0.03-0.04 RMS offline (about -6..-9 dB under the music bus). */
const BED_TRIM: Record<string, number> = { birds: 1.3, city: 1.4, wind: 1.6, cafe: 1.8, water: 1.5, factory: 1.05, space: 0.85 };

/** Gain on the panned foreground-event buses (calibrated so event peaks land ~0.25-0.3 offline). */
const FG_BOOST: Record<string, number> = { birds: 2.0, city: 1.6, wind: 2.4, cafe: 1.4, water: 2.0, factory: 1.7, space: 3.8 };

export interface AmbHandle { id: string; stop(t: number): void; tick(until: number, now?: number): void }

interface Ev { next: number; min: number; max: number; fire: (t: number) => void }

export function startAmbience(k: Kit, out: AudioNode, id: string, t0: number): AmbHandle | null {
  if (!(AMBIENCE_IDS as readonly string[]).includes(id)) return null;
  const c = k.ctx; const r = k.rng;
  const bus = c.createGain(); bus.gain.setValueAtTime(0, t0); bus.gain.linearRampToValueAtTime(BED_TRIM[id] ?? 1, t0 + 1.5); bus.connect(out);
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
  let O: AudioNode = bus;
  // foreground events sit off-centre (alternating-ish left/right) and well above the bed floor, so they cut
  // through the music: peaks ~0.25-0.3 offline, while the continuous floor stays where it was.
  const side = (v: number): AudioNode => {
    const g = c.createGain(); g.gain.value = FG_BOOST[id] ?? 2.4;
    try { const p = c.createStereoPanner(); p.pan.value = v; g.connect(p); p.connect(bus); } catch { g.connect(bus); }
    return g;
  };
  const sides = [side(-0.6), side(0.55)]; let sideIx = r.int(0, 1);
  /** One recognizable foreground event every 3-6 s, never the same one twice in a row, panned off-centre. */
  const fg = (fns: ((t: number) => void)[], first = 2) => {
    let last = -1;
    every(3, 6, t => {
      let i = r.int(0, fns.length - 1); if (fns.length > 1 && i === last) i = (i + 1) % fns.length; last = i;
      sideIx = r.next() < 0.75 ? 1 - sideIx : sideIx; // mostly alternate sides
      const prev = O; O = sides[sideIx]; try { fns[i](t); } finally { O = prev; }
    }, first);
  };
  const sweep = (t: number, f0: number, f1: number, f2: number, dur: number, v: number, q = 1.2) => { // filtered-noise whoosh
    const s = c.createBufferSource(); s.buffer = k.noise; s.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.linearRampToValueAtTime(f1, t + dur * 0.45); f.frequency.linearRampToValueAtTime(f2, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + dur * 0.45); g.gain.linearRampToValueAtTime(0, t + dur);
    s.connect(f); f.connect(g); g.connect(O); s.start(t, r.range(0, 1)); s.stop(t + dur + 0.1);
  };
  const gull = (t: number) => { const n = r.int(2, 3); const p = r.range(0.92, 1.1); for (let i = 0; i < n; i++) tone(k, O, t + i * 0.3, 1400 * p, 0.24, 0.05, { wave: 'pulse', duty: 0.25, slideTo: 880 * p, vib: 45, vibRate: 13, lp: 2400, attack: 0.01, release: 0.06 }); };

  switch (id) {
    case 'birds': {
      const leaves = bed('bandpass', 3200, 0.6, 0.012); mod(leaves.gain.gain, 0.13, 0.008);
      bed('lowpass', 380, 0.5, 0.05);
      every(0.7, 2.8, t => { // chirp trill
        const n = r.int(2, 6); const f = r.range(2600, 4200); const up = r.next() < 0.6;
        for (let i = 0; i < n; i++) tone(k, O, t + i * 0.075, f * (1 + i * 0.02), 0.045, 0.045, { wave: 'sine', slideTo: f * (up ? 1.35 : 0.75), slideTime: 0.04, attack: 0.004, release: 0.02 });
      });
      fg([
        t => { // robin phrase: cheerily-cheer-up
          const p = r.range(0.9, 1.12); const ph = [[2600, 3300, 0.09], [3300, 2700, 0.09], [2400, 3100, 0.12], [3500, 2900, 0.1]];
          ph.forEach(([a, b, d], i) => tone(k, O, t + i * 0.13, a * p, d, 0.08, { wave: 'sine', slideTo: b * p, slideTime: d, attack: 0.006, release: 0.03, vib: 30, vibRate: 25 }));
        },
        t => { const p = r.range(0.9, 1.1); for (let i = 0; i < 6; i++) tone(k, O, t + i * 0.055, 4200 * p, 0.035, 0.06, { wave: 'sine', slideTo: 3000 * p, slideTime: 0.03, attack: 0.003, release: 0.015 }); }, // wren trill
        t => { tone(k, O, t, 1900, 0.16, 0.07, { wave: 'sine', slideTo: 2600, attack: 0.01, release: 0.04 }); tone(k, O, t + 0.22, 2600, 0.24, 0.07, { wave: 'sine', slideTo: 1800, attack: 0.01, release: 0.06 }); }, // whistle "wee-woo"
      ]);
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
      fg([
        t => { const p = r.range(0.95, 1.05); [0, 0.22].forEach(dt => { tone(k, O, t + dt, 392 * p, 0.16, 0.05, { wave: 'pulse', duty: 0.5, lp: 1400, sustain: 0.9 }); tone(k, O, t + dt, 494 * p, 0.16, 0.04, { wave: 'pulse', duty: 0.5, lp: 1400, sustain: 0.9 }); }); }, // car horn beep-beep
        t => [0, 0.16].forEach(dt => { tone(k, O, t + dt, 2350, 0.45, 0.05, { wave: 'sine', attack: 0.002, sustain: 0.3, decay: 0.22 }); tone(k, O, t + dt, 3170, 0.35, 0.025, { wave: 'sine', attack: 0.002, sustain: 0.2, decay: 0.2 }); }), // bike bell
        t => { noise(k, O, t, 0.7, 0.07, { type: 'highpass', freq: 3500, attack: 0.02 }); tone(k, O, t, 1650, 0.5, 0.02, { wave: 'sine', slideTo: 1400, attack: 0.02 }); }, // bus air brakes
        t => sweep(t, 300, 1300, 380, 1.8, 0.09), // scooter whoosh
      ], 2.5);
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
      fg([
        t => sweep(t, 600, 1900, 700, 2, 0.11, 2.4), // gust howl
        t => { for (let i = 0; i < 5; i++) noise(k, O, t + i * 0.09 + r.range(0, 0.03), 0.05, 0.07, { type: 'bandpass', freq: 900, q: 1.5 }); }, // flag flapping
        t => tone(k, O, t, r.range(700, 860), 1.4, 0.03, { wave: 'sine', slideTo: r.range(1000, 1200), attack: 0.4, release: 0.5, vib: 30, vibRate: 4 }), // whistling gap
      ]);
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
      fg([
        t => { const f = r.range(3000, 3600); [0, 0.1, 0.17].forEach((dt, i) => tone(k, O, t + dt, f * (1 + i * 0.04), 0.25, 0.05, { wave: 'sine', attack: 0.001, sustain: 0.25, decay: 0.1, release: 0.08 })); }, // spoon stirring a cup
        t => noise(k, O, t, 1.6, 0.08, { type: 'highpass', freq: 2800, attack: 0.15 }), // espresso steam wand
        t => { tone(k, O, t, mtof2(88), 0.6, 0.03, { wave: 'sine', attack: 0.001, sustain: 0.3, decay: 0.3, release: 0.3 }); tone(k, O, t, mtof2(95), 0.5, 0.02, { wave: 'sine', attack: 0.001, sustain: 0.2, decay: 0.25 }); }, // door bell ding
        t => { tone(k, O, t, 1250, 0.05, 0.05, { wave: 'pulse', duty: 0.125, attack: 0.001, lp: 3000 }); noise(k, O, t + 0.06, 0.12, 0.05, { type: 'bandpass', freq: 2200, q: 2 }); }, // till drawer
      ]);
      every(18, 30, t => noise(k, O, t, 2.2, 0.035, { type: 'highpass', freq: 3200, attack: 0.5 }), 8);
      break;
    }
    case 'water': {
      const w = bed('lowpass', 480, 0.6, 0.07); mod(w.gain.gain, 0.12, 0.05);
      const hiss = bed('highpass', 2600, 0.5, 0.008); mod(hiss.gain.gain, 0.12, 0.006);
      every(0.6, 2.2, t => { const f = r.range(700, 1100); tone(k, O, t, f, 0.06, 0.03, { wave: 'sine', slideTo: f * 0.4, attack: 0.002, release: 0.03 }); });
      fg([
        gull,
        t => { tone(k, O, t, 784, 1.2, 0.05, { wave: 'sine', attack: 0.001, sustain: 0.3, decay: 0.5, release: 0.5 }); tone(k, O, t, 1960, 0.7, 0.018, { wave: 'sine', attack: 0.001, sustain: 0.2, decay: 0.3 }); }, // buoy bell
        t => { noise(k, O, t, 0.9, 0.09, { type: 'lowpass', freq: 1800, sweepTo: 400, attack: 0.08 }); noise(k, O, t + 0.1, 0.5, 0.04, { type: 'highpass', freq: 3000 }); }, // wave slaps the pier
        t => { const f = r.range(500, 650); [0, 0.07, 0.15].forEach(dt => tone(k, O, t + dt, f, 0.07, 0.05, { wave: 'sine', slideTo: f * 1.8, attack: 0.002, release: 0.03 })); }, // fish plop-plop
      ], 1.5);
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
      fg([
        t => noise(k, O, t, 1.1, 0.09, { type: 'highpass', freq: 2400, attack: 0.04 }), // steam valve hiss
        t => { noise(k, O, t, 0.12, 0.08, { type: 'bandpass', freq: 2600, q: 4 }); tone(k, O, t, 1720, 0.4, 0.035, { wave: 'pulse', duty: 0.125, attack: 0.001, sustain: 0.2, decay: 0.2 }); tone(k, O, t, 2390, 0.3, 0.02, { wave: 'pulse', duty: 0.125, attack: 0.001, sustain: 0.2, decay: 0.15 }); }, // dropped wrench clang
        t => { tone(k, O, t, 466, 0.5, 0.035, { wave: 'pulse', duty: 0.5, lp: 1200, sustain: 0.9 }); tone(k, O, t, 554, 0.5, 0.03, { wave: 'pulse', duty: 0.5, lp: 1200, sustain: 0.9 }); }, // shift whistle
      ], 2);
      break;
    }
    case 'space': {
      osc('sine', 55, 0.03); osc('sine', 55.35, 0.03); osc('triangle', 82.4, 0.015, 400);
      const neb = bed('lowpass', 320, 2, 0.03); mod(neb.filter.frequency, 0.05, 180);
      const PENT = [0, 2, 4, 7, 9];
      every(1.4, 4, t => { const m = 84 + PENT[r.int(0, 4)] + 12 * r.int(0, 1); const f = 440 * Math.pow(2, (m - 69) / 12); tone(k, O, t, f, 0.4, 0.016, { wave: 'sine', attack: 0.01, sustain: 0.4, decay: 0.2, release: 0.2 }); tone(k, O, t + 0.28, f, 0.3, 0.007, { wave: 'sine', sustain: 0.4, release: 0.2 }); });
      fg([
        t => { tone(k, O, t, 1318, 0.9, 0.05, { wave: 'sine', attack: 0.002, sustain: 0.3, decay: 0.4, release: 0.4 }); tone(k, O, t + 0.45, 1318, 0.6, 0.015, { wave: 'sine', sustain: 0.3, release: 0.3 }); }, // sonar ping + echo
        t => { const n = r.int(4, 7); for (let i = 0; i < n; i++) tone(k, O, t + i * 0.07, r.range(900, 2200), 0.045, 0.035, { wave: 'pulse', duty: 0.25, sustain: 1, release: 0.01, lp: 3500 }); }, // radio telemetry
        t => tone(k, O, t, 220, 1.6, 0.04, { wave: 'sine', slideTo: 330, attack: 0.5, release: 0.6, vib: 40, vibRate: 2 }), // comet whoom
      ], 2);
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
