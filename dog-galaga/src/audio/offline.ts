// Offline rendering for inspection (critics can't listen, so they read numbers / waveforms instead).
// Window-free: uses globalThis.OfflineAudioContext only. Never throws; returns ok:false on failure.
import { makeKit } from './synth';
import { buildMixer, Sequencer } from './engine';
import { TRACKS } from './tracks';
import { startAmbience } from './ambience';
import { playSfx, SFX_LEN } from './sfx';

export interface RenderStats {
  ok: boolean;
  error?: string;
  /** absolute sample peak over both channels (1.0 = 0 dBFS). */
  peak: number;
  /** RMS over the whole render. */
  rms: number;
  durationSec: number;
  sampleRate: number;
  /** samples with |x| >= 0.999. Should be 0. */
  clipped: number;
  /** 0..1 fraction of 50 ms windows that are audible (> -50 dBFS RMS). */
  activity: number;
  /** per-window peak (bins), for drawing a waveform overview in a showcase. */
  envelope: number[];
}

const EMPTY = (error: string): RenderStats => ({ ok: false, error, peak: 0, rms: 0, durationSec: 0, sampleRate: 0, clipped: 0, activity: 0, envelope: [] });
const SR = 22050;

type Setup = (k: ReturnType<typeof makeKit>, mix: ReturnType<typeof buildMixer>, seconds: number) => void;

async function render(seconds: number, setup: Setup, bins = 200): Promise<RenderStats> {
  try {
    const OAC = (globalThis as any).OfflineAudioContext || (globalThis as any).webkitOfflineAudioContext;
    if (!OAC) return EMPTY('OfflineAudioContext unavailable');
    const sec = Math.max(0.05, Math.min(120, +seconds || 0));
    const ctx: OfflineAudioContext = new OAC(2, Math.ceil(sec * SR), SR);
    const k = makeKit(ctx, 1234);
    const mix = buildMixer(ctx, ctx.destination);
    setup(k, mix, sec);
    const buf = await ctx.startRendering();
    const chans: Float32Array[] = []; for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
    let peak = 0, sum = 0, clipped = 0; const n = buf.length;
    const env = new Array(bins).fill(0); const win = Math.max(1, Math.floor(SR * 0.05)); let wsum = 0, wcount = 0, active = 0, windows = 0;
    for (let i = 0; i < n; i++) {
      let s2 = 0;
      for (const ch of chans) { const v = ch[i]; const a = Math.abs(v); if (a > peak) peak = a; if (a >= 0.999) clipped++; s2 += v * v; const b = Math.floor((i / n) * bins); if (a > env[b]) env[b] = a; }
      s2 /= chans.length; sum += s2; wsum += s2; wcount++;
      if (wcount === win) { windows++; if (Math.sqrt(wsum / win) > 0.00316) active++; wsum = 0; wcount = 0; }
    }
    const r3 = (x: number) => Math.round(x * 1000) / 1000;
    return { ok: true, peak: r3(peak), rms: r3(Math.sqrt(sum / Math.max(1, n))), durationSec: r3(buf.duration), sampleRate: SR, clipped, activity: r3(windows ? active / windows : 0), envelope: env.map(r3) };
  } catch (e) { return EMPTY(String(e)); }
}

/** Render `seconds` of a music track through the real mixer (default volumes). */
export function renderTrackOffline(trackId: string, seconds = 12): Promise<RenderStats> {
  const tr = TRACKS[trackId]; if (!tr) return Promise.resolve(EMPTY(`unknown track "${trackId}"`));
  return render(seconds, (k, mix, sec) => { const s = new Sequencer(k, mix); s.set(tr, 0.02); s.schedule(sec); });
}

/** Render an ambience bed. */
export function renderAmbienceOffline(id: string, seconds = 12): Promise<RenderStats> {
  return render(seconds, (k, mix, sec) => { const h = startAmbience(k, mix.amb, id, 0); if (!h) throw new Error(`unknown ambience "${id}"`); h.tick(sec); });
}

/** Render one sound effect (length chosen automatically when seconds is omitted). */
export function renderSfxOffline(id: string, seconds?: number): Promise<RenderStats> {
  if (!(id in SFX_LEN)) return Promise.resolve(EMPTY(`unknown sfx "${id}"`));
  return render(seconds ?? SFX_LEN[id] + 0.3, (k, mix) => playSfx(k, mix.sfx, id, 0.01), 100);
}

/** Everything at once: game-like worst case (music + ambience + a burst of sfx). */
export function renderMixOffline(trackId: string, ambienceId: string, seconds = 8): Promise<RenderStats> {
  const tr = TRACKS[trackId]; if (!tr) return Promise.resolve(EMPTY(`unknown track "${trackId}"`));
  return render(seconds, (k, mix, sec) => {
    const s = new Sequencer(k, mix); s.set(tr, 0.02); s.schedule(sec);
    startAmbience(k, mix.amb, ambienceId, 0)?.tick(sec);
    for (let t = 0.5; t < sec - 0.5; t += 0.19) { playSfx(k, mix.sfx, 'plop', t); if (Math.floor(t * 10) % 3 === 0) playSfx(k, mix.sfx, 'meow', t + 0.05); playSfx(k, mix.sfx, 'thud', t + 0.03); }
    playSfx(k, mix.sfx, 'bossdown', sec / 2);
  });
}
