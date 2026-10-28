// Mixer graph + music sequencer, shared by the live module and the offline renderer.
import { type Kit, tone, drum, mtof } from './synth';
import { compileTrack, type Compiled, type Track } from './tracks';

/** Default bus levels at volume setting 1.0 (tuned with renderTrackOffline so the mix peaks below 0 dBFS). */
export const LEVELS = { music: 0.62, sfx: 0.7, amb: 0.85 };

export interface Mixer {
  music: GainNode;      // music bus (volume)
  switchFade: GainNode; // short dip when changing tracks
  duck: GainNode;       // pause ducking
  duckLP: BiquadFilterNode;
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
  limiter.threshold.value = -6; limiter.knee.value = 4; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.15;
  const post = ctx.createGain(); post.gain.value = 0.92;
  limiter.connect(post); post.connect(dest);
  const master = ctx.createGain(); master.gain.value = 0.75; master.connect(limiter);

  const duck = ctx.createGain(); duck.connect(master);
  const duckLP = ctx.createBiquadFilter(); duckLP.type = 'lowpass'; duckLP.frequency.value = 20000; duckLP.Q.value = 0.4; duckLP.connect(duck);
  const music = ctx.createGain(); music.gain.value = LEVELS.music; music.connect(duckLP);
  const switchFade = ctx.createGain(); switchFade.connect(music);

  // lead echo: dotted-eighth delay with a darkening feedback loop, returned slightly right.
  const echoSend = ctx.createGain(); echoSend.gain.value = 0;
  const echoDelay = ctx.createDelay(1.5); echoDelay.delayTime.value = 0.3;
  const fb = ctx.createGain(); fb.gain.value = 0.38;
  const fbLP = ctx.createBiquadFilter(); fbLP.type = 'lowpass'; fbLP.frequency.value = 2600;
  echoSend.connect(echoDelay); echoDelay.connect(fbLP); fbLP.connect(fb); fb.connect(echoDelay);
  fbLP.connect(pan(ctx, 0.35, switchFade));

  const arpOut = pan(ctx, -0.28, switchFade);
  const sfx = ctx.createGain(); sfx.gain.value = LEVELS.sfx; sfx.connect(master);
  const amb = ctx.createGain(); amb.gain.value = LEVELS.amb; amb.connect(master);
  return { music, switchFade, duck, duckLP, echoSend, echoDelay, arpOut, sfx, amb, master, limiter };
}

/** Step sequencer: schedules compiled song steps ahead of time on the audio clock. */
export class Sequencer {
  track: Track | null = null; comp: Compiled | null = null;
  step = 0; nextT = 0;
  constructor(private k: Kit, private mix: Mixer) {}

  set(track: Track | null, t0: number) {
    this.track = track; this.comp = track ? compileTrack(track) : null; this.step = 0; this.nextT = t0;
    if (track && this.comp) {
      const t = Math.max(0, t0 - 0.01);
      this.mix.echoSend.gain.setValueAtTime(track.leadVoice.echo ?? 0, t);
      this.mix.echoDelay.delayTime.setValueAtTime(Math.min(1.4, this.comp.stepSec * 3), t);
    }
  }

  /** Schedule every step that starts before `until` (audio-clock seconds). */
  schedule(until: number) {
    const tr = this.track, c = this.comp; if (!tr || !c || !c.steps.length) return;
    let guard = 0;
    while (this.nextT < until && guard++ < 512) {
      const i = this.step % c.steps.length;
      const swing = i % 2 === 1 ? (tr.swing ?? 0) * c.stepSec : 0;
      this.play(tr, c, i, this.nextT + swing);
      this.step++; this.nextT += c.stepSec;
    }
  }

  private play(tr: Track, c: Compiled, i: number, t: number) {
    const ev = c.steps[i]; const k = this.k; const M = this.mix.switchFade; const sp = c.stepSec;
    if (ev.lead) {
      const lv = tr.leadVoice; const dur = ev.lead.len * sp * 0.9;
      const f = mtof(ev.lead.m);
      tone(k, M, t, f, dur, lv.vol, { wave: lv.wave, duty: lv.duty, vib: lv.vib, sustain: lv.wave === 'tri' ? 0.85 : 0.62, decay: 0.12, release: 0.06 });
      if (lv.echo) tone(k, this.mix.echoSend, t, f, Math.min(dur, sp * 2), lv.vol * 0.8, { wave: lv.wave, duty: lv.duty, sustain: 0.5, release: 0.05 });
    }
    if (ev.bass) tone(k, M, t, mtof(ev.bass.m), ev.bass.len * sp * 0.88, tr.bassVol ?? 0.38, { wave: 'tri', sustain: 0.9, decay: 0.2, release: 0.03 });
    if (ev.arp !== undefined && tr.arp) tone(k, this.mix.arpOut, t, mtof(ev.arp), (tr.arp.len ?? 1) * sp * 0.85, tr.arp.vol, { wave: 'pulse', duty: tr.arp.duty ?? 0.125, sustain: 0.5, decay: 0.05, release: 0.02 });
    if (ev.pad && tr.pad) for (const m of ev.pad) tone(k, M, t, mtof(m), (ev.padLen ?? 16) * sp * 0.95, tr.pad, { wave: 'pulse', duty: 0.125, attack: 0.12, sustain: 0.8, decay: 0.3, release: 0.25, lp: 1600, vib: 6 });
    if (ev.drum) drum(k, M, t, ev.drum, tr.drumVol ?? 0.8);
  }
}
