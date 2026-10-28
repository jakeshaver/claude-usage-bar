// Chiptune song data. Pure data + a compiler; no DOM/WebAudio access here (tools/lint-content.ts imports it).
//
// Notation (16 steps per bar, one step = a 16th note):
//   chords: one entry per bar; "Am D" splits the bar evenly. Qualities: '', m, 7, m7, maj7, dim, sus2, sus4.
//   lead:   one string per bar (purely for readability; notes may tie across bars). Tokens "E5/2" = E5 for
//           2 sixteenths, "r/4" = rest. Duration defaults to 2. Total must equal bars*16.
//   bass:   16-token pattern per bar, cycled: R root(oct 2) O root(oct 3) 5 fifth 3 third 7 seventh
//           o fifth-up-an-octave, '-' hold previous, '.' rest.
//   arp:    pattern of chord-tone indices (0 root, 1 third, 2 fifth, 3 seventh/octave, 4.. next octave), '.' rest.
//   drums:  16-token patterns cycled per bar: k kick s snare h hat o open hat c crash t/T toms x clap, '.' rest.
//           `fill` replaces the drum pattern of the last bar of the loop.
import type { Duty } from './synth';

export interface Track {
  bpm: number;
  /** 0..0.3: delays every odd 16th for shuffle. */
  swing?: number;
  chords: string[];
  lead: string[];
  leadVoice: { wave: 'pulse' | 'tri'; duty?: Duty; vol: number; vib?: number; echo?: number };
  bass: string[];
  bassVol?: number;
  arp?: { pat: string; oct: number; duty?: Duty; vol: number; len?: number };
  drums: string[];
  fill?: string;
  drumVol?: number;
  /** Optional sustained pad (pulse 12.5%, very quiet) on chord tones 0/1/2 per chord. */
  pad?: number;
}

export const TRACKS: Record<string, Track> = {
  // Captain Pom's theme: heroic but cozy, C major.
  title: {
    bpm: 116,
    chords: ['C', 'G', 'Am', 'Em', 'F', 'C', 'Dm', 'G'],
    lead: [
      'G4/2 C5/2 E5/2 G5/4 E5/2 G5/2 A5/2',
      'G5/6 D5/2 B4/4 D5/4',
      'C5/2 E5/2 A5/4 G5/2 E5/2 C5/4',
      'B4/6 G4/2 B4/4 E5/4',
      'F5/2 E5/2 F5/2 A5/6 G5/2 F5/2',
      'E5/4 G5/4 C6/8',
      'D5/2 F5/2 A5/2 C6/2 B5/2 A5/2 F5/2 D5/2',
      'G5/8 F5/2 D5/2 B4/4',
    ],
    leadVoice: { wave: 'pulse', duty: 0.25, vol: 0.2, vib: 18, echo: 0.18 },
    bass: ['R - . R O - R . 5 - . 5 O - 5 .'],
    arp: { pat: '0 1 2 3 2 1 0 1 2 3 2 1 0 1 2 1', oct: 4, duty: 0.125, vol: 0.07 },
    drums: ['k . h . s . h . k . h k s . h h', 'k . h . s . h . k . h . s . o .'],
    fill: 'k . h . s . s . s s t . t T T c',
  },
  // Backyard / street / park: bouncy G-major romp.
  yard: {
    bpm: 132, swing: 0.12,
    chords: ['G', 'C', 'G', 'D', 'G', 'C', 'Am D', 'G', 'Em', 'C', 'G', 'D', 'Em', 'C', 'Am', 'D7'],
    lead: [
      'D5/2 G5/2 B5/2 G5/2 A5/2 B5/2 G5/4',
      'E5/2 G5/2 C6/2 B5/2 A5/4 G5/4',
      'B5/2 A5/2 G5/2 D5/2 G5/2 B5/2 D6/4',
      'C6/2 B5/2 A5/2 F#5/2 A5/8',
      'D5/2 G5/2 B5/2 G5/2 A5/2 B5/2 G5/4',
      'E5/2 G5/2 C6/4 E6/4 D6/2 C6/2',
      'B5/2 C6/2 A5/4 F#5/2 G5/2 A5/4',
      'G5/8 r/4 D5/2 E5/2',
      'E5/4 B4/2 E5/2 G5/4 F#5/2 E5/2',
      'E5/2 D5/2 C5/4 G4/4 C5/4',
      'D5/4 B4/2 D5/2 G5/4 F#5/2 G5/2',
      'A5/8 F#5/4 D5/4',
      'E5/2 G5/2 B5/4 A5/2 G5/2 E5/4',
      'G5/2 E5/2 C5/4 E5/2 G5/2 C6/4',
      'C6/2 B5/2 A5/2 G5/2 E5/2 G5/2 A5/4',
      'F#5/4 A5/2 D6/2 C6/2 A5/2 F#5/2 D5/2',
    ],
    leadVoice: { wave: 'pulse', duty: 0.5, vol: 0.17, vib: 12 },
    bass: ['R . O . 5 . O . R . O . 5 . 3 .'],
    arp: { pat: '. . 1 2 . . 1 2 . . 1 2 . . 1 2', oct: 4, duty: 0.25, vol: 0.06, len: 1 },
    drums: ['k . h . s . h k . k h . s . h .'],
    fill: 'k . h . s . h k s . s s t t T T',
  },
  // Alley / cafe / factory: sneaky, syncopated A minor.
  city: {
    bpm: 138,
    chords: ['Am', 'F', 'G', 'Em', 'Am', 'F', 'G', 'E', 'Dm', 'Am', 'Bb', 'E'],
    lead: [
      'A4/3 C5/3 E5/2 r/2 D5/2 C5/2 A4/2',
      'r/2 F5/2 r/1 E5/1 D5/2 C5/4 A4/4',
      'B4/3 D5/3 G5/2 r/2 F5/2 E5/2 D5/2',
      'E5/6 r/2 G4/2 A4/2 B4/2 D5/2',
      'A5/3 G5/3 E5/2 r/2 D5/2 E5/2 A4/2',
      'r/2 C6/2 r/1 A5/1 G5/2 F5/4 C5/4',
      'D5/2 E5/2 G5/2 A5/2 B5/2 A5/2 G5/2 D5/2',
      'G#5/8 E5/4 B4/4',
      'D5/2 F5/2 A5/4 G5/2 F5/2 D5/4',
      'E5/2 A5/2 C6/4 B5/2 A5/2 E5/4',
      'F5/2 Bb5/2 D6/4 C6/2 Bb5/2 F5/4',
      'G#5/4 B5/4 E6/2 D6/2 B5/2 G#5/2',
    ],
    leadVoice: { wave: 'pulse', duty: 0.25, vol: 0.17, vib: 10 },
    bass: ['R R . O . R O . R . O R . 5 7 .'],
    bassVol: 0.42,
    arp: { pat: '0 . 2 . 1 . 2 . 0 . 2 . 1 . 3 .', oct: 4, duty: 0.125, vol: 0.05, len: 1 },
    drums: ['k . h k x . h . k k h . x . h h', 'k . h k x . h . k . h k x . o .'],
    fill: 'k . h k x . x . x x t . T . c .',
  },
  // Rooftops / docks / station: dreamy E minor lullaby with echo.
  night: {
    bpm: 100,
    chords: ['Em', 'Cmaj7', 'Am7', 'B7', 'Em', 'Cmaj7', 'Am7 B7', 'Em', 'C', 'D', 'Bm', 'Em', 'Am', 'B7', 'C', 'B7'],
    lead: [
      'B4/4 E5/4 G5/6 F#5/2',
      'E5/12 D5/2 E5/2',
      'C5/4 E5/4 A5/6 G5/2',
      'F#5/12 D#5/4',
      'B5/4 G5/4 E5/4 G5/2 B5/2',
      'C6/8 B5/4 G5/4',
      'A5/4 G5/2 F#5/2 D#5/4 F#5/4',
      'E5/12 r/4',
      'G5/4 E5/4 C5/4 E5/4',
      'F#5/4 A5/4 D6/8',
      'D6/4 B5/4 F#5/4 B5/4',
      'G5/12 E5/4',
      'A5/4 C6/4 E6/4 C6/4',
      'B5/8 A5/4 F#5/4',
      'G5/4 E5/4 C5/2 E5/2 G5/4',
      'F#5/8 D#5/4 B4/4',
    ],
    leadVoice: { wave: 'pulse', duty: 0.125, vol: 0.17, vib: 22, echo: 0.32 },
    bass: ['R - - - . . 5 - O - - - 5 - - -'],
    bassVol: 0.38,
    arp: { pat: '0 1 2 3 4 3 2 1 0 1 2 3 4 3 2 1', oct: 4, duty: 0.25, vol: 0.05 },
    drums: ['k . . . . . h . s . . . . . h .', 'k . . . . . h . s . . k . . h h'],
    fill: 'k . . . s . . . s . s . t . T .',
    drumVol: 0.55,
    pad: 0.02,
  },
  // Sky / moon / nebula: driving D-minor space race.
  space: {
    bpm: 144,
    chords: ['Dm', 'Bb', 'C', 'Am', 'Dm', 'Bb', 'C', 'A', 'Gm', 'Dm', 'Bb', 'F', 'Gm', 'Dm', 'Bb', 'A7'],
    lead: [
      'D5/2 A5/2 F5/2 A5/2 D6/4 C6/2 A5/2',
      'Bb5/6 A5/2 F5/4 D5/4',
      'E5/2 G5/2 C6/2 G5/2 E6/4 D6/2 C6/2',
      'A5/8 E5/4 C5/4',
      'D5/2 A5/2 F5/2 A5/2 D6/4 E6/2 F6/2',
      'D6/6 C6/2 Bb5/4 F5/4',
      'G5/2 C6/2 E6/2 G6/2 F6/2 E6/2 C6/2 G5/2',
      'C#6/8 A5/4 E5/4',
      'G5/4 Bb5/4 D6/6 C6/2',
      'A5/4 F5/4 D5/8',
      'F5/2 Bb5/2 D6/2 F6/2 E6/4 D6/4',
      'C6/8 A5/4 F5/4',
      'Bb5/4 A5/2 G5/2 D6/4 Bb5/4',
      'A5/4 D6/4 F6/8',
      'F6/4 D6/4 Bb5/4 F5/4',
      'E5/2 G5/2 A5/2 C#6/2 E6/4 G6/4',
    ],
    leadVoice: { wave: 'pulse', duty: 0.25, vol: 0.16, vib: 14, echo: 0.22 },
    bass: ['R O R O R O R O R O R O 5 o 5 o'],
    bassVol: 0.36,
    arp: { pat: '0 1 2 4 0 1 2 4 0 1 2 4 0 1 2 4', oct: 4, duty: 0.125, vol: 0.05, len: 1 },
    drums: ['k . h . s . h k . k h . s . h .', 'k . h . s . h k . k h . s . o .'],
    fill: 'k . s . s . s s t t t T T T c .',
  },
  // Boss fights: urgent E minor, 160 bpm.
  boss: {
    bpm: 160,
    chords: ['Em', 'Em', 'C', 'D', 'Em', 'Em', 'F', 'B7'],
    lead: [
      'E5/2 E5/2 r/2 E5/2 G5/2 E5/2 D5/2 E5/2',
      'B5/4 A5/2 G5/2 F#5/2 G5/2 A5/4',
      'G5/2 G5/2 r/2 G5/2 C6/2 B5/2 A5/2 G5/2',
      'F#5/4 A5/4 D6/4 C6/2 A5/2',
      'E6/2 D6/2 B5/2 G5/2 E5/2 G5/2 B5/2 D6/2',
      'E6/4 F#6/4 G6/6 F#6/2',
      'F6/2 E6/2 C6/2 A5/2 F5/2 A5/2 C6/2 E6/2',
      'D#6/4 F#6/4 B5/2 A5/2 F#5/2 D#5/2',
    ],
    leadVoice: { wave: 'pulse', duty: 0.5, vol: 0.15, vib: 8 },
    bass: ['R O R O R O R O R O R O R O 5 o'],
    bassVol: 0.4,
    arp: { pat: '0 2 4 2 0 2 4 2 0 2 4 2 0 2 4 2', oct: 4, duty: 0.125, vol: 0.045, len: 1 },
    drums: ['k h s h k h s h k h s h k k s h'],
    fill: 'k h s h k h s h s s s s t t T c',
  },
  // Final boss: epic C minor.
  finale: {
    bpm: 150,
    chords: ['Cm', 'Ab', 'Bb', 'G', 'Cm', 'Ab', 'Fm', 'G', 'Ab', 'Bb', 'Gm', 'Cm', 'Ab', 'Bb', 'G', 'G7'],
    lead: [
      'C5/2 Eb5/2 G5/2 C6/6 Bb5/2 G5/2',
      'Ab5/6 G5/2 Eb5/4 C5/4',
      'D5/2 F5/2 Bb5/2 D6/6 C6/2 Bb5/2',
      'B5/8 G5/4 D5/4',
      'C6/2 Bb5/2 G5/2 Eb5/2 G5/2 C6/2 Eb6/4',
      'Eb6/2 D6/2 C6/4 Ab5/4 C6/4',
      'F5/2 Ab5/2 C6/4 Eb6/4 D6/4',
      'B5/4 D6/4 G6/8',
      'C6/4 Eb6/4 Ab6/6 G6/2',
      'F6/4 D6/4 Bb5/8',
      'G5/2 Bb5/2 D6/2 G6/2 F6/2 D6/2 Bb5/4',
      'C6/8 G5/4 Eb5/4',
      'Ab5/2 C6/2 Eb6/2 Ab6/2 G6/4 Eb6/4',
      'F6/2 D6/2 Bb5/2 F5/2 Bb5/4 D6/4',
      'G6/4 F6/2 D6/2 B5/4 G5/4',
      'F5/2 G5/2 B5/2 D6/2 F6/2 D6/2 B5/2 G5/2',
    ],
    leadVoice: { wave: 'pulse', duty: 0.25, vol: 0.16, vib: 12, echo: 0.15 },
    bass: ['R R O R R O R O R R O R 5 5 o 5'],
    bassVol: 0.4,
    arp: { pat: '0 1 2 1 0 1 2 1 0 1 2 1 0 1 2 1', oct: 4, duty: 0.125, vol: 0.045, len: 1 },
    drums: ['k h s h k h s k k h s h k k s h', 'k h s h k h s k k h s h k h s o'],
    fill: 'k h s h s s s s t t T T c . c .',
    pad: 0.018,
  },
  // Ending: warm F-major lullaby.
  ending: {
    bpm: 92,
    chords: ['F', 'C', 'Dm', 'Bb', 'F', 'Am', 'Bb', 'C', 'Dm', 'Am', 'Bb', 'F', 'Gm', 'C', 'F', 'C7'],
    lead: [
      'C5/4 F5/4 A5/6 G5/2',
      'G5/8 E5/4 C5/4',
      'D5/4 F5/4 A5/4 D6/4',
      'C6/8 Bb5/4 F5/4',
      'A5/4 C6/4 F6/6 E6/2',
      'E6/8 C6/4 A5/4',
      'D6/4 C6/4 Bb5/4 A5/4',
      'G5/12 r/4',
      'A5/4 F5/4 D5/4 F5/4',
      'E5/4 A5/4 C6/8',
      'D6/4 C6/4 Bb5/2 A5/2 G5/4',
      'A5/12 r/4',
      'Bb5/4 A5/4 G5/4 D5/4',
      'E5/4 G5/4 C6/4 E6/4',
      'F6/6 E6/2 C6/4 A5/4',
      'G5/4 Bb5/4 E5/4 C5/4',
    ],
    leadVoice: { wave: 'tri', vol: 0.3, vib: 16, echo: 0.3 },
    bass: ['R - - - 5 - - - O - - - 5 - - -'],
    bassVol: 0.32,
    arp: { pat: '0 2 3 4 3 2 0 2 3 4 3 2 0 2 3 2', oct: 4, duty: 0.125, vol: 0.05 },
    drums: ['k . . . . . h . . . . . . . h .', 'k . . . . . h . . . k . . . h .'],
    fill: 'k . . . . . h . s . . . h . h .',
    drumVol: 0.45,
    pad: 0.022,
  },
};

// ---- compiler -------------------------------------------------------------------------------
const NOTE_IDX: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const QUAL: Record<string, number[]> = { '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], dim: [0, 3, 6], sus2: [0, 2, 7], sus4: [0, 5, 7] };
function midi(n: string): number { const m = /^([A-G][#b]?)(\d)$/.exec(n); if (!m || NOTE_IDX[m[1]] === undefined) return -1; return NOTE_IDX[m[1]] + (+m[2] + 1) * 12; }
/** 'Am7' -> {root pitch class, intervals}. */
export function parseChord(s: string): { root: number; iv: number[] } | null {
  const m = /^([A-G][#b]?)(.*)$/.exec(s); if (!m || NOTE_IDX[m[1]] === undefined || !QUAL[m[2]]) return null;
  return { root: NOTE_IDX[m[1]], iv: QUAL[m[2]] };
}

export interface StepEvents { lead?: { m: number; len: number }; bass?: { m: number; len: number }; arp?: number; drum?: string; pad?: number[]; padLen?: number }
export interface Compiled { steps: StepEvents[]; bars: number; stepSec: number; errors: string[] }

export function compileTrack(t: Track): Compiled {
  const errors: string[] = [];
  const bars = t.chords.length; const N = bars * 16;
  const steps: StepEvents[] = Array.from({ length: N }, () => ({}));
  const chordAt: ({ root: number; iv: number[] } | null)[] = new Array(N).fill(null);
  t.chords.forEach((cs, b) => {
    const parts = cs.trim().split(/\s+/); const per = 16 / parts.length;
    parts.forEach((p, j) => {
      const ch = parseChord(p); if (!ch) errors.push(`bad chord "${p}"`);
      for (let s = 0; s < per; s++) chordAt[b * 16 + j * per + s] = ch;
      if (t.pad && ch) { const st = steps[b * 16 + j * per]; st.pad = [0, 1, 2].map(i => 60 + ch.root + ch.iv[i]); st.padLen = per; }
    });
  });
  // lead
  let pos = 0;
  for (const tok of t.lead.join(' ').trim().split(/\s+/)) {
    const [n, d] = tok.split('/'); const len = d ? +d : 2;
    if (!(len > 0)) { errors.push(`bad duration "${tok}"`); continue; }
    if (n !== 'r') { const m = midi(n); if (m < 0) errors.push(`bad note "${tok}"`); else if (pos < N) steps[pos].lead = { m, len }; }
    pos += len;
  }
  if (pos !== N) errors.push(`lead length ${pos} != ${N} steps (${bars} bars)`);
  // bass
  for (let b = 0; b < bars; b++) {
    const pat = t.bass[b % t.bass.length].split(/\s+/);
    let last: { m: number; len: number } | undefined;
    for (let s = 0; s < 16; s++) {
      const i = b * 16 + s; const tok = pat[s % pat.length]; const ch = chordAt[i];
      if (!ch || tok === '.') { last = undefined; continue; }
      if (tok === '-') { if (last) last.len++; continue; }
      const off = tok === 'O' ? 12 : tok === '5' ? ch.iv[2] : tok === 'o' ? ch.iv[2] + 12 : tok === '3' ? ch.iv[1] : tok === '7' ? (ch.iv[3] ?? 10) : 0;
      last = { m: 36 + ch.root + off, len: 1 }; steps[i].bass = last;
    }
  }
  // arp
  if (t.arp) {
    const pat = t.arp.pat.split(/\s+/);
    for (let i = 0; i < N; i++) {
      const tok = pat[i % pat.length]; const ch = chordAt[i]; if (!ch || tok === '.') continue;
      const k = +tok; const tones = ch.iv.length === 3 ? [...ch.iv, 12] : ch.iv;
      steps[i].arp = (t.arp.oct + 1) * 12 + ch.root + tones[k % tones.length] + 12 * Math.floor(k / tones.length);
    }
  }
  // drums
  for (let b = 0; b < bars; b++) {
    const pat = (b === bars - 1 && t.fill ? t.fill : t.drums[b % t.drums.length]).split(/\s+/);
    for (let s = 0; s < 16; s++) { const tok = pat[s]; if (tok && tok !== '.') steps[b * 16 + s].drum = tok; }
  }
  return { steps, bars, stepSec: 60 / t.bpm / 4, errors };
}

/** All track problems (bad chords, wrong bar lengths). Empty when every track is well-formed. */
export function validateTracks(): string[] {
  const out: string[] = [];
  for (const [id, t] of Object.entries(TRACKS)) for (const e of compileTrack(t).errors) out.push(`${id}: ${e}`);
  return out;
}
