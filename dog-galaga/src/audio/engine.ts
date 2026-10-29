// Mixer graph + music sequencer, shared by the live module and the offline renderer.
import { type Kit, tone, pwmTone, drum, mtof } from './synth';
import { compileTrack, type Compiled, type Track } from './tracks';

/**
 * Default bus levels at volume setting 1.0, tuned with the offline renderer. Round 3: music +4 dB (0.44 -> 0.7)
 * so the melody sits level with gameplay sfx on laptop speakers; big sfx dip the music briefly instead (SIDE).
 * Ambience beds sit ~-14 dB under the music; sfx families are trimmed in sfx.ts.
 */
export const LEVELS = { music: 0.7, sfx: 0.7, amb: 1.7 };
/** Sidechain-style music dip on big sfx only: -2 dB for ~150 ms. */
export const SIDE = { ids: ['hurt', 'bossdown', 'memory'] as readonly string[], gain: 0.794, hold: 0.15 };
/** Pause: the music ducks and muffles while the ambience comes *up* a little (the room you paused in). */
export const PAUSE = { music: 0.35, musicLP: 1100, amb: 1.25 };

export interface Mixer {
  music: GainNode;      // music bus (volume)
  switchFade: GainNode; // short dip when changing tracks
  trim: GainNode;       // per-song loudness trim (Track.gain)
  side: GainNode;       // sidechain-style dip under big sfx
  duck: GainNode;       // pause ducking
  duckLP: BiquadFilterNode;
  ambDuck: GainNode;    // pause lift for ambience (separate from the volume-controlled amb gain)
  arpEcho: AudioNode;   // echo-arp doubling on repeat passes, panned right
  echoSend: GainNode;   // lead echo send (wet level per track)
  echoDelay: DelayNode;
  arpOut: AudioNode;    // panned slightly left
  sfx: GainNode;
  amb: GainNode;
  master: GainNode;
  limiter: DynamicsCompressorNode;
}

function pan(ctx: BaseAudioContext, v: number, out: AudioNode): AudioNode {
  try { const p = ctx.createStereoPanner(); p.pan.value = v; p.connect(out); return p; } catch { return out; }
}

export function buildMixer(ctx: BaseAudioContext, dest: AudioNode): Mixer {
  const limiter = ctx.createDynamicsCompressor();
  // safety limiter: only transients should reach it (music alone peaks ~-7 dBFS)
  limiter.threshold.value = -3; limiter.knee.value = 3; limiter.ratio.value = 12; limiter.attack.value = 0.003; limiter.release.value = 0.12;
  const post = ctx.createGain(); post.gain.value = 0.92;
  limiter.connect(post); post.connect(dest);
  const master = ctx.createGain(); master.gain.value = 0.75; master.connect(limiter);

  const duck = ctx.createGain(); duck.connect(master);
  const duckLP = ctx.createBiquadFilter(); duckLP.type = 'lowpass'; duckLP.frequency.value = 20000; duckLP.Q.value = 0.4; duckLP.connect(duck);
  const music = ctx.createGain(); music.gain.value = LEVELS.music; music.connect(duckLP);
  const side = ctx.createGain(); side.connect(music);
  const trim = ctx.createGain(); trim.connect(side);
  const switchFade = ctx.createGain(); switchFade.connect(trim);

  // lead echo: dotted-eighth delay with a darkening feedback loop, returned slightly right.
  const echoSend = ctx.createGain(); echoSend.gain.value = 0;
  const echoDelay = ctx.createDelay(1.5); echoDelay.delayTime.value = 0.3;
  const fb = ctx.createGain(); fb.gain.value = 0.38;
  const fbLP = ctx.createBiquadFilter(); fbLP.type = 'lowpass'; fbLP.frequency.value = 2600;
  echoSend.connect(echoDelay); echoDelay.connect(fbLP); fbLP.connect(fb); fb.connect(echoDelay);
  fbLP.connect(pan(ctx, 0.35, switchFade));

  const arpOut = pan(ctx, -0.28, switchFade);
  const arpEcho = pan(ctx, 0.45, switchFade);
  const sfx = ctx.createGain(); sfx.gain.value = LEVELS.sfx; sfx.connect(master);
  const ambDuck = ctx.createGain(); ambDuck.connect(master);
  const amb = ctx.createGain(); amb.gain.value = LEVELS.amb; amb.connect(ambDuck);
  return { music, switchFade, trim, side, duck, duckLP, ambDuck, arpEcho, echoSend, echoDelay, arpOut, sfx, amb, master, limiter };
}

/** Dip the music under a big sfx (sidechain feel). */
export function sideDip(mix: Mixer, t: number) {
  const g = mix.side.gain;
  g.cancelScheduledValues(t); g.setTargetAtTime(SIDE.gain, t, 0.012); g.setTargetAtTime(1, t + SIDE.hold, 0.07);
}

/**
 * Step sequencer: schedules compiled song steps ahead of time on the audio clock.
 * Song changes are quantized: `queue()` switches on a step boundary (the caller picks a bar line), and a
 * one-shot song (`once`) hands over to `after` when its last step has been scheduled.
 */
export class Sequencer {
  track: Track | null = null; comp: Compiled | null = null;
  step = 0; nextT = 0;
  /** song to start at global step `pendingAt` of the current song. */
  pending: Track | null = null; pendingAt = -1;
  /** what follows a one-shot song, in order (empty = silence). */
  after: Track[] = [];
  constructor(private k: Kit, private mix: Mixer) {}

  set(track: Track | null, t0: number) {
    this.track = track; this.comp = track ? compileTrack(track) : null; this.step = 0; this.nextT = t0;
    this.pending = null; this.pendingAt = -1;
    if (track && this.comp) {
      const t = Math.max(0, t0 - 0.01);
      this.mix.echoSend.gain.setValueAtTime(track.leadVoice.echo ?? 0, t);
      this.mix.trim.gain.setValueAtTime(track.gain ?? 1, t);
      this.mix.echoDelay.delayTime.setValueAtTime(Math.min(1.4, this.comp.stepSec * 3), t);
    }
  }

  /** Steps from the next unscheduled step to the next boundary of `grid` steps (16 = bar line). */
  stepsTo(grid: number): number { return (grid - (this.step % grid)) % grid; }

  /** Switch to `track` after `steps` more steps (0 = at the next step). */
  queue(track: Track | null, steps: number) { this.pending = track; this.pendingAt = this.step + Math.max(0, steps); }

  /** Audio-clock time at which a queued switch happens (or now-ish when idle). */
  switchTime(): number { return this.comp && this.pendingAt >= 0 ? this.nextT + (this.pendingAt - this.step) * this.comp.stepSec : this.nextT; }

  /** Loop pass of a global step (-1 = intro) and the index into compiled steps. */
  locate(step: number): { i: number; pass: number } {
    const c = this.comp!; const loopLen = c.steps.length - c.intro;
    if (step < c.intro || loopLen <= 0) return { i: step, pass: -1 };
    const s = step - c.intro; return { i: c.intro + (s % loopLen), pass: Math.floor(s / loopLen) };
  }

  /** Schedule every step that starts before `until` (audio-clock seconds). */
  schedule(until: number) {
    let guard = 0;
    while (guard++ < 512) {
      if (this.pending !== null || this.pendingAt >= 0) {
        if (this.step >= this.pendingAt) { const p = this.pending; this.set(p, this.nextT); if (!p) return; }
      }
      const tr = this.track, c = this.comp; if (!tr || !c || !c.steps.length) return;
      if (tr.once && this.step >= c.steps.length) { this.set(this.after.shift() ?? null, this.nextT); continue; }
      if (this.nextT >= until) return;
      const { i, pass } = this.locate(this.step);
      const swing = !tr.once && (i - c.intro) % 2 === 1 ? (tr.swing ?? 0) * c.stepSec : 0;
      this.play(tr, c, i, pass, this.nextT + swing);
      this.step++; this.nextT += c.stepSec;
    }
  }

  private play(tr: Track, c: Compiled, i: number, pass: number, t: number) {
    const ev = c.steps[i]; const k = this.k; const M = this.mix.switchFade; const sp = c.stepSec;
    const rep = pass % 2 === 1 ? tr.repeat : undefined; // variations on every second pass
    const tp = rep?.lift ?? 0;
    if (ev.lead) {
      const lv = tr.leadVoice; const dur = ev.lead.len * sp * 0.9;
      const f = mtof(ev.lead.m + tp); const from = ev.lead.from !== undefined ? mtof(ev.lead.from + tp) : 0;
      const duty = rep?.leadDuty ?? lv.duty; const held = ev.lead.len >= 4;
      if (lv.wave === 'pulse' && lv.pwm && held) {
        pwmTone(k, M, t, f, dur, lv.vol, { vib: lv.vib, slideFrom: from || undefined, slideTime: lv.glide ?? 0.06, sustain: 0.66, decay: 0.12, release: 0.08 });
      } else {
        const glide = from ? { slideTo: f, slideTime: lv.glide ?? 0.05 } : {};
        const accent = lv.wave === 'pulse' && lv.accent && held ? { dutyTo: lv.accent, dutyAt: Math.min(0.09, dur * 0.3) } : {};
        tone(k, M, t, from || f, dur, lv.vol, { wave: lv.wave, duty, vib: lv.vib, sustain: lv.wave === 'tri' ? 0.85 : 0.62, decay: 0.12, release: 0.06, ...glide, ...accent });
      }
      if (lv.echo) tone(k, this.mix.echoSend, t, f, Math.min(dur, sp * 2), lv.vol * 0.8, { wave: lv.wave, duty, sustain: 0.5, release: 0.05 });
    }
    if (ev.bass) tone(k, M, t, mtof(ev.bass.m + tp), ev.bass.len * sp * 0.88, tr.bassVol ?? 0.38, { wave: 'tri', sustain: 0.9, decay: 0.2, release: 0.03 });
    if (ev.arp !== undefined && tr.arp) {
      const ao = { wave: 'pulse' as const, duty: tr.arp.duty ?? 0.125, sustain: 0.5, decay: 0.05, release: 0.02 };
      const al = (tr.arp.len ?? 1) * sp * 0.85;
      tone(k, this.mix.arpOut, t, mtof(ev.arp + tp), al, tr.arp.vol, ao);
      // echo-arp: an octave-up copy a dotted eighth later, quieter and on the other side
      if (rep?.echoArp) tone(k, this.mix.arpEcho, t + sp * 3, mtof(ev.arp + tp + 12), al, tr.arp.vol * 0.5, ao);
    }
    if (ev.ctr && rep?.counter) tone(k, M, t, mtof(ev.ctr.m + tp), ev.ctr.len * sp * 0.92, rep.counter, { wave: 'tri', attack: 0.02, sustain: 0.7, decay: 0.25, release: 0.12, vib: 10 });
    if (ev.pad && tr.pad) for (const m of ev.pad) tone(k, M, t, mtof(m + tp), (ev.padLen ?? 16) * sp * 0.95, tr.pad, { wave: 'pulse', duty: 0.125, attack: 0.12, sustain: 0.8, decay: 0.3, release: 0.25, lp: 1600, vib: 6 });
    if (ev.drum) drum(k, M, t, ev.drum, tr.drumVol ?? 0.8);
  }
}
