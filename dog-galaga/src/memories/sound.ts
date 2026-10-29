// The memory drop cue: a camera shutter click, then a rising music-box arpeggio with a glassy tail.
// Built from the audio module's own synth voices and played into its sfx bus, so it follows the SFX volume
// slider and stays unique to memories (the generic 'toast' ding is for notifications).
import type { Game } from '../core/game';
import { tone, noise, mtof } from '../audio/synth';

export function memdrop(g: Game) {
  const A: any = g.mods.audio;
  try {
    const k = A?.kit, out = A?.mix?.sfx, c: AudioContext | undefined = A?.ctx;
    if (!k || !out || !c || c.state !== 'running') return;
    const t = c.currentTime + 0.005;
    // shutter: a bright tick, the mirror slap (low thump), and a second tick as the curtain closes
    noise(k, out, t, 0.018, 0.32, { type: 'highpass', freq: 5200 });
    tone(k, out, t + 0.006, 180, 0.05, 0.22, { wave: 'sine', slideTo: 70, attack: 0.001, release: 0.02 });
    noise(k, out, t + 0.07, 0.022, 0.24, { type: 'bandpass', freq: 3600, q: 2 });
    // music box: E6 G#6 B6 E7 F#7 rising, each tine a sine with a quiet octave partial and a fast decay
    [88, 92, 95, 100, 102].forEach((m, i) => {
      const at = t + 0.13 + i * 0.075;
      tone(k, out, at, mtof(m), 0.32, 0.17, { wave: 'sine', attack: 0.002, sustain: 0.18, decay: 0.12, release: 0.16 });
      tone(k, out, at, mtof(m + 12), 0.12, 0.05, { wave: 'tri', attack: 0.001, sustain: 0.1, decay: 0.05, release: 0.05 });
    });
    tone(k, out, t + 0.52, mtof(107), 0.5, 0.05, { wave: 'sine', vib: 9, attack: 0.01, sustain: 0.4, decay: 0.2, release: 0.25 });
  } catch { /* sound is optional */ }
}
