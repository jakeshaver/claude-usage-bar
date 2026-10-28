// Chiptune song data. Pure data + a compiler; no DOM/WebAudio access here (tools/lint-content.ts imports it).
//
// Notation (16 steps per bar, one step = a 16th note):
//   chords: one entry per bar; "Am D" splits the bar evenly. Qualities: '', m, 7, m7, maj7, dim, sus2, sus4.
//   lead:   one string per bar (purely for readability; notes may tie across bars). Tokens "E5/2" = E5 for
//           2 sixteenths, "r/4" = rest, "~E5/2" = glide (portamento) into E5 from the previous note.
//           Duration defaults to 2. Total must equal bars*16.
//   bass:   16-token pattern per bar, cycled: R root(oct 2) O root(oct 3) 5 fifth 3 third 7 seventh
//           o fifth-up-an-octave, '-' hold previous, '.' rest. `bassB` replaces it from bar `bAt` (B section).
//   arp:    pattern of chord-tone indices (0 root, 1 third, 2 fifth, 3 seventh/octave, 4.. next octave), '.' rest.
//   drums:  16-token patterns cycled per bar: k kick s snare h hat o open hat c crash t/T toms x clap, '.' rest.
//           `drumsB` replaces them from bar `bAt`; `drumBars` overrides single bars (drops, half-time bars);
//           `fill` replaces the drum pattern of the last bar of the loop.
//   intro:  optional bars played once before the loop starts (a sting; never repeated).
//   repeat: what changes on every second pass of the loop (key lift, auto counter-melody, echo-arp, lead duty).
import type { Duty } from './synth';
import { SFX_IDS } from './sfx';

export interface Track {
  bpm: number;
  /** 0..0.3: delays every odd 16th for shuffle. */
  swing?: number;
  chords: string[];
  lead: string[];
  /**
   * accent: duty the lead switches to mid-note on held notes (>= 4 steps), e.g. 12.5% -> 25%.
   * pwm: held notes use a swept-duty (PWM) voice instead. glide: portamento time for "~" notes (s).
   */
  leadVoice: { wave: 'pulse' | 'tri'; duty?: Duty; vol: number; vib?: number; echo?: number; accent?: Duty; pwm?: boolean; glide?: number };
  bass: string[];
  bassB?: string[];
  /** first bar of the B section (default: half the loop). */
  bAt?: number;
  bassVol?: number;
  arp?: { pat: string; oct: number; duty?: Duty; vol: number; len?: number };
  drums: string[];
  drumsB?: string[];
  drumBars?: Record<number, string>;
  fill?: string;
  drumVol?: number;
  /** Optional sustained pad (pulse 12.5%, very quiet) on chord tones 0/1/2 per chord. */
  pad?: number;
  intro?: { chords: string[]; lead: string[]; drums: string[]; bass?: string };
  /** lift: semitones up on repeat passes; counter: volume of the auto counter-melody (tri) on repeat passes. */
  repeat?: { lift?: number; counter?: number; echoArp?: boolean; leadDuty?: Duty };
}

export const TRACKS: Record<string, Track> = {
  // Captain Pom's theme: heroic but cozy, C major. A = the fanfare, B = the wistful A-minor answer.
  title: {
    bpm: 116,
    chords: ['C', 'G', 'Am', 'Em', 'F', 'C', 'Dm', 'G', 'Am', 'F', 'C', 'G', 'Am', 'F', 'Dm', 'G7'],
    lead: [
      'G4/2 C5/2 E5/2 G5/4 E5/2 G5/2 A5/2',
      'G5/6 D5/2 B4/4 D5/4',
      'C5/2 E5/2 A5/4 G5/2 E5/2 C5/4',
      'B4/6 G4/2 B4/4 E5/4',
      'F5/2 E5/2 F5/2 A5/6 G5/2 F5/2',
      'E5/4 G5/4 C6/8',
      'D5/2 F5/2 A5/2 C6/2 B5/2 A5/2 F5/2 D5/2',
      'G5/8 F5/2 D5/2 B4/4',
      'E5/4 A5/4 C6/6 B5/2',
      'A5/4 F5/4 C5/8',
      'E5/2 G5/2 C6/4 ~D6/2 E6/2 D6/4',
      'B5/8 G5/4 D5/4',
      'C6/2 B5/2 A5/2 E5/2 A5/4 C6/4',
      'A5/2 G5/2 F5/2 C5/2 F5/4 A5/4',
      'F5/2 E5/2 D5/2 F5/2 A5/4 ~D6/4',
      'B5/4 G5/2 F5/2 D5/4 B4/4',
    ],
    leadVoice: { wave: 'pulse', duty: 0.25, vol: 0.2, vib: 18, echo: 0.18, accent: 0.5, glide: 0.06 },
    bass: ['R - . R O - R . 5 - . 5 O - 5 .'],
    bassB: ['R . . R . . R . 5 . . 5 . . O .'],
    arp: { pat: '0 1 2 3 2 1 0 1 2 3 2 1 0 1 2 1', oct: 4, duty: 0.125, vol: 0.07 },
    drums: ['k . h . s . h . k . h k s . h h', 'k . h . s . h . k . h . s . o .'],
    drumsB: ['k . h h s . h . k . k h s . h o'],
    drumBars: { 8: 'k . . . h . . . s . . . h . . .', 12: 'k . h . s . h . k . h . s s s s' },
    fill: 'k . h . s . s . s s t . t T T c',
    repeat: { counter: 0.11, echoArp: true, leadDuty: 0.125 },
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
      'G5/2 E5/2 C5/4 E5/2 G5/2 ~C6/4',
      'C6/2 B5/2 A5/2 G5/2 E5/2 G5/2 A5/4',
      'F#5/4 A5/2 D6/2 C6/2 A5/2 F#5/2 D5/2',
    ],
    leadVoice: { wave: 'pulse', duty: 0.5, vol: 0.17, vib: 12, accent: 0.25, glide: 0.05 },
    bass: ['R . O . 5 . O . R . O . 5 . 3 .'],
    bassB: ['R . 5 . O . 5 . R . 3 . 5 . O .'],
    arp: { pat: '. . 1 2 . . 1 2 . . 1 2 . . 1 2', oct: 4, duty: 0.25, vol: 0.06, len: 1 },
    drums: ['k . h . s . h k . k h . s . h .'],
    drumsB: ['k . h h s . h . k . h h s . o .'],
    drumBars: { 7: 'k . h . s . h . . . . . . . . .', 12: 'k . . . s . . . k . . . s . . .' },
    fill: 'k . h . s . h k s . s s t t T T',
    repeat: { counter: 0.1, echoArp: true, leadDuty: 0.25 },
  },
  // Alley / cafe / factory: sneaky, syncopated A minor.
  city: {
    bpm: 138,
    chords: ['Am', 'F', 'G', 'Em', 'Am', 'F', 'G', 'E', 'Dm', 'Am', 'Bb', 'E', 'Dm', 'Am', 'F', 'E7'],
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
      'F5/3 A5/3 D6/2 r/2 C6/2 A5/2 F5/2',
      'E5/3 A5/3 C6/2 r/2 B5/2 A5/2 E5/2',
      'F5/2 A5/2 C6/2 F6/2 E6/2 C6/2 A5/2 F5/2',
      'G#5/6 ~B5/2 D6/4 G#5/2 E5/2',
    ],
    leadVoice: { wave: 'pulse', duty: 0.25, vol: 0.17, vib: 10, accent: 0.125, glide: 0.05 },
    bass: ['R R . O . R O . R . O R . 5 7 .'],
    bassB: ['R . R O . R . 5 R . R O . 7 5 .'],
    bassVol: 0.42,
    arp: { pat: '0 . 2 . 1 . 2 . 0 . 2 . 1 . 3 .', oct: 4, duty: 0.125, vol: 0.05, len: 1 },
    drums: ['k . h k x . h . k k h . x . h h', 'k . h k x . h . k . h k x . o .'],
    drumsB: ['k . h . x . h k . k h . x . h h'],
    drumBars: { 7: 'k . . . x . . . k . . . x . . .', 12: '. . h . . . h . . . h . . . h .' },
    fill: 'k . h k x . x . x x t . T . c .',
    repeat: { counter: 0.1, echoArp: true, leadDuty: 0.5 },
  },
  // Rooftops / docks / station: dreamy E minor lullaby with echo and a PWM lead.
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
      'F#5/4 A5/4 ~D6/8',
      'D6/4 B5/4 F#5/4 B5/4',
      'G5/12 E5/4',
      'A5/4 C6/4 E6/4 C6/4',
      'B5/8 A5/4 F#5/4',
      'G5/4 E5/4 C5/2 E5/2 G5/4',
      'F#5/8 D#5/4 B4/4',
    ],
    leadVoice: { wave: 'pulse', duty: 0.125, vol: 0.17, vib: 22, echo: 0.32, pwm: true, glide: 0.09 },
    bass: ['R - - - . . 5 - O - - - 5 - - -'],
    bassB: ['R - - - - - - - 5 - - - O - 5 -'],
    bassVol: 0.38,
    arp: { pat: '0 1 2 3 4 3 2 1 0 1 2 3 4 3 2 1', oct: 4, duty: 0.25, vol: 0.05 },
    drums: ['k . . . . . h . s . . . . . h .', 'k . . . . . h . s . . k . . h h'],
    drumsB: ['k . . . h . h . s . . . h . h .'],
    drumBars: { 11: '. . . . . . . . . . . . . . h .' },
    fill: 'k . . . s . . . s . s . t . T .',
    drumVol: 0.55,
    pad: 0.02,
    repeat: { counter: 0.09, echoArp: true },
  },
  // Sky / moon / nebula: driving D-minor space race. Lifts a whole step on the repeat.
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
      'A5/4 D6/4 ~F6/8',
      'F6/4 D6/4 Bb5/4 F5/4',
      'E5/2 G5/2 A5/2 C#6/2 E6/4 G6/4',
    ],
    leadVoice: { wave: 'pulse', duty: 0.25, vol: 0.16, vib: 14, echo: 0.22, accent: 0.5, glide: 0.05 },
    bass: ['R O R O R O R O R O R O 5 o 5 o'],
    bassB: ['R . O . R . O . 5 . o . 5 . o .'],
    bassVol: 0.36,
    arp: { pat: '0 1 2 4 0 1 2 4 0 1 2 4 0 1 2 4', oct: 4, duty: 0.125, vol: 0.05, len: 1 },
    drums: ['k . h . s . h k . k h . s . h .', 'k . h . s . h k . k h . s . o .'],
    drumsB: ['k . h . s . h . k . h . s . h h'],
    drumBars: { 8: 'k . . . . . . . s . . . . . . .', 12: 'c . . . . . . . . . . . . . . .' },
    fill: 'k . s . s . s s t t t T T T c .',
    repeat: { lift: 2, counter: 0.09, echoArp: true },
  },
  // Boss fights: urgent E minor, 160 bpm. 2-bar sting (not looped), 16-bar A/B loop, lifts a semitone on repeat.
  boss: {
    bpm: 160,
    intro: {
      chords: ['B7', 'B7'],
      lead: ['B4/1 r/1 B4/1 r/1 B4/1 r/3 D#5/4 F#5/4', 'B5/12 r/4'],
      drums: ['c . . . . . . . k . k . k k k k', 's . s . s . s s s s s s t t T T'],
      bass: 'R . R . R . . . O . O . O O O O',
    },
    chords: ['Em', 'Em', 'C', 'D', 'Em', 'Em', 'F', 'B7', 'Am', 'Am', 'Em', 'Em', 'C', 'D', 'B7', 'B7'],
    lead: [
      'E5/2 E5/2 r/2 E5/2 G5/2 E5/2 D5/2 E5/2',
      'B5/4 A5/2 G5/2 F#5/2 G5/2 A5/4',
      'G5/2 G5/2 r/2 G5/2 C6/2 B5/2 A5/2 G5/2',
      'F#5/4 A5/4 D6/4 C6/2 A5/2',
      'E6/2 D6/2 B5/2 G5/2 E5/2 G5/2 B5/2 D6/2',
      'E6/4 F#6/4 G6/6 F#6/2',
      'F6/2 E6/2 C6/2 A5/2 F5/2 A5/2 C6/2 E6/2',
      'D#6/4 F#6/4 B5/2 A5/2 F#5/2 D#5/2',
      'A5/4 C6/4 E6/6 D6/2',
      'C6/2 B5/2 A5/2 G5/2 A5/8',
      'G5/4 B5/4 E6/6 F#6/2',
      'G6/2 F#6/2 E6/2 B5/2 E6/8',
      'E6/2 r/2 E6/2 D6/2 C6/2 G5/2 E5/2 G5/2',
      'F#5/2 r/2 F#5/2 A5/2 D6/4 ~E6/2 F#6/2',
      'D#6/6 B5/2 F#5/4 A5/4',
      'B5/2 A5/2 G5/2 F#5/2 D#5/4 B4/4',
    ],
    leadVoice: { wave: 'pulse', duty: 0.5, vol: 0.15, vib: 8, accent: 0.25, glide: 0.04 },
    bass: ['R O R O R O R O R O R O R O 5 o'],
    bassB: ['R R O R R O R R O R R O 5 5 o 5'],
    bassVol: 0.4,
    arp: { pat: '0 2 4 2 0 2 4 2 0 2 4 2 0 2 4 2', oct: 4, duty: 0.125, vol: 0.045, len: 1 },
    drums: ['k h s h k h s h k h s h k k s h'],
    drumsB: ['k . h . s . h . k . h . s . h k', 'k . h . s . h . k k h . s . h h'],
    drumBars: { 12: 'k . . . . . . . . . . . . . . .', 13: 'k . . . s . . . k . k . s s s s' },
    fill: 'k h s h k h s h s s s s t t T c',
    repeat: { lift: 1, counter: 0.09, echoArp: true, leadDuty: 0.25 },
  },
  // Mothership waves: ominous F#-minor march that builds; leaves 'finale' for the final boss.
  mothership: {
    bpm: 126,
    chords: ['F#m', 'D', 'E', 'C#m', 'F#m', 'D', 'Bm', 'C#', 'D', 'E', 'F#m', 'F#m', 'Bm', 'D', 'C#', 'C#7'],
    lead: [
      'F#5/6 C#5/2 F#5/4 A5/4',
      'A5/2 G#5/2 F#5/4 D5/8',
      'E5/6 B4/2 E5/4 G#5/4',
      'G#5/8 r/4 E5/2 G#5/2',
      'C#6/6 B5/2 A5/4 F#5/4',
      'A5/2 B5/2 A5/4 F#5/4 D5/4',
      'D5/4 F#5/4 B5/6 A5/2',
      'G#5/12 F5/4',
      'F#5/4 A5/4 D6/6 C#6/2',
      'B5/4 G#5/4 E5/8',
      'A5/2 C#6/2 F#6/4 E6/2 C#6/2 A5/4',
      'C#6/12 r/4',
      'D6/4 C#6/4 B5/4 F#5/4',
      'A5/4 F#5/4 D5/4 ~F#5/4',
      'F5/4 G#5/4 C#6/8',
      'B5/2 G#5/2 F5/2 C#5/2 F5/4 G#5/4',
    ],
    leadVoice: { wave: 'pulse', duty: 0.125, vol: 0.16, vib: 16, echo: 0.24, pwm: true, glide: 0.07 },
    bass: ['R . R . R . R . R . R . R . 5 .'],
    bassB: ['R R O R R O R R O R R O 5 5 o 5'],
    bassVol: 0.4,
    arp: { pat: '0 . 2 . 4 . 2 . 0 . 2 . 4 . 2 .', oct: 4, duty: 0.125, vol: 0.05, len: 1 },
    drums: ['k . h . s . h . k . h . s . h .', 'k . h . s . h . k . h k s . h .'],
    drumsB: ['k h s h k h s h k k s h k h s h'],
    drumBars: { 7: 'k . . . s . . . k . . . s s t T', 11: '. . h . . . h . . . h . . . h .' },
    fill: 'k h s h s s s s t t T T c . . .',
    pad: 0.016,
    repeat: { counter: 0.09, echoArp: true, leadDuty: 0.25 },
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
      'F6/2 D6/2 Bb5/2 F5/2 Bb5/4 ~D6/4',
      'G6/4 F6/2 D6/2 B5/4 G5/4',
      'F5/2 G5/2 B5/2 D6/2 F6/2 D6/2 B5/2 G5/2',
    ],
    leadVoice: { wave: 'pulse', duty: 0.25, vol: 0.16, vib: 12, echo: 0.15, accent: 0.5, glide: 0.05 },
    bass: ['R R O R R O R O R R O R 5 5 o 5'],
    bassB: ['R . R . O . R . R . R . 5 . o .'],
    bassVol: 0.4,
    arp: { pat: '0 1 2 1 0 1 2 1 0 1 2 1 0 1 2 1', oct: 4, duty: 0.125, vol: 0.045, len: 1 },
    drums: ['k h s h k h s k k h s h k k s h', 'k h s h k h s k k h s h k h s o'],
    drumsB: ['k . h . s . h . k . h . s . h k'],
    drumBars: { 7: 'k h s h k h s h s s s s s s s s', 11: 'k . . . . . . . s . . . . . . .' },
    fill: 'k h s h s s s s t t T T c . c .',
    pad: 0.018,
    repeat: { counter: 0.09, echoArp: true, leadDuty: 0.5 },
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
      'E5/4 A5/4 ~C6/8',
      'D6/4 C6/4 Bb5/2 A5/2 G5/4',
      'A5/12 r/4',
      'Bb5/4 A5/4 G5/4 D5/4',
      'E5/4 G5/4 C6/4 E6/4',
      'F6/6 E6/2 C6/4 A5/4',
      'G5/4 Bb5/4 E5/4 C5/4',
    ],
    leadVoice: { wave: 'tri', vol: 0.3, vib: 16, echo: 0.3, glide: 0.1 },
    bass: ['R - - - 5 - - - O - - - 5 - - -'],
    bassB: ['R - - - 3 - - - 5 - - - O - - -'],
    bassVol: 0.32,
    arp: { pat: '0 2 3 4 3 2 0 2 3 4 3 2 0 2 3 2', oct: 4, duty: 0.125, vol: 0.05 },
    drums: ['k . . . . . h . . . . . . . h .', 'k . . . . . h . . . k . . . h .'],
    drumsB: ['k . . . h . h . k . . . h . h .'],
    drumBars: { 7: '. . . . . . . . . . . . . . . .' },
    fill: 'k . . . . . h . s . . . h . h .',
    drumVol: 0.45,
    pad: 0.022,
    repeat: { counter: 0.08, echoArp: true },
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

export interface StepEvents {
  lead?: { m: number; len: number; from?: number };
  bass?: { m: number; len: number };
  arp?: number; drum?: string; pad?: number[]; padLen?: number;
  /** auto counter-melody note (only played on repeat passes). */
  ctr?: { m: number; len: number };
}
export interface Compiled {
  /** intro steps followed by loop steps. */
  steps: StepEvents[];
  /** number of intro steps (played once, before the loop). */
  intro: number;
  /** bars in the loop (excluding the intro). */
  bars: number;
  stepSec: number;
  errors: string[];
}

type Chord = { root: number; iv: number[] } | null;
interface Section { chords: string[]; lead: string[]; bass: (bar: number) => string; drums: (bar: number) => string; arp?: Track['arp']; pad?: number }

function compileSection(sec: Section, label: string, errors: string[]): StepEvents[] {
  const bars = sec.chords.length; const N = bars * 16;
  const steps: StepEvents[] = Array.from({ length: N }, () => ({}));
  const chordAt: Chord[] = new Array(N).fill(null);
  sec.chords.forEach((cs, b) => {
    const parts = cs.trim().split(/\s+/); const per = 16 / parts.length;
    parts.forEach((p, j) => {
      const ch = parseChord(p); if (!ch) errors.push(`${label}bad chord "${p}"`);
      for (let s = 0; s < per; s++) chordAt[b * 16 + j * per + s] = ch;
      if (sec.pad && ch) { const st = steps[b * 16 + j * per]; st.pad = [0, 1, 2].map(i => 60 + ch.root + ch.iv[i]); st.padLen = per; }
    });
  });
  // lead
  let pos = 0; let prev = -1;
  for (const raw of sec.lead.join(' ').trim().split(/\s+/)) {
    const glide = raw.startsWith('~'); const tok = glide ? raw.slice(1) : raw;
    const [n, d] = tok.split('/'); const len = d ? +d : 2;
    if (!(len > 0)) { errors.push(`${label}bad duration "${raw}"`); continue; }
    if (n !== 'r') {
      const m = midi(n);
      if (m < 0) errors.push(`${label}bad note "${raw}"`);
      else {
        if (pos < N) steps[pos].lead = glide && prev > 0 && prev !== m ? { m, len, from: prev } : { m, len };
        prev = m;
      }
    }
    pos += len;
  }
  if (pos !== N) errors.push(`${label}lead length ${pos} != ${N} steps (${bars} bars)`);
  // bass
  for (let b = 0; b < bars; b++) {
    const pat = sec.bass(b).split(/\s+/);
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
  if (sec.arp) {
    const pat = sec.arp.pat.split(/\s+/);
    for (let i = 0; i < N; i++) {
      const tok = pat[i % pat.length]; const ch = chordAt[i]; if (!ch || tok === '.') continue;
      const k = +tok; const tones = ch.iv.length === 3 ? [...ch.iv, 12] : ch.iv;
      steps[i].arp = (sec.arp.oct + 1) * 12 + ch.root + tones[k % tones.length] + 12 * Math.floor(k / tones.length);
    }
  }
  // auto counter-melody: one chord tone per half bar in G3..C5, the smallest move from the previous one,
  // avoiding the lead's pitch class at that moment (so it reads as a second line, not a doubling).
  let cm = 64; let leadNow = -1;
  for (let i = 0; i < N; i++) {
    if (steps[i].lead) leadNow = steps[i].lead!.m;
    if (i % 8 !== 0) continue;
    const ch = chordAt[i]; if (!ch) continue;
    let best = -1, bd = 99;
    for (let m = 55; m <= 72; m++) {
      const pc = ((m - ch.root) % 12 + 12) % 12; if (!ch.iv.includes(pc)) continue;
      if (leadNow >= 0 && (m - leadNow) % 12 === 0) continue;
      const dist = Math.abs(m - cm) + (m === cm ? 1.5 : 0); if (dist < bd) { bd = dist; best = m; }
    }
    if (best > 0) { steps[i].ctr = { m: best, len: 8 }; cm = best; }
  }
  // drums
  for (let b = 0; b < bars; b++) {
    const pat = sec.drums(b).split(/\s+/);
    for (let s = 0; s < 16; s++) { const tok = pat[s]; if (tok && tok !== '.') steps[b * 16 + s].drum = tok; }
  }
  return steps;
}

export function compileTrack(t: Track): Compiled {
  const errors: string[] = [];
  const bars = t.chords.length; const bAt = t.bAt ?? Math.floor(bars / 2);
  const loop = compileSection({
    chords: t.chords, lead: t.lead, arp: t.arp, pad: t.pad,
    bass: b => (b >= bAt && t.bassB ? t.bassB[(b - bAt) % t.bassB.length] : t.bass[b % t.bass.length]),
    drums: b => (b === bars - 1 && t.fill ? t.fill : t.drumBars?.[b] ?? (b >= bAt && t.drumsB ? t.drumsB[(b - bAt) % t.drumsB.length] : t.drums[b % t.drums.length])),
  }, '', errors);
  let intro: StepEvents[] = [];
  if (t.intro) {
    const it = t.intro;
    intro = compileSection({ chords: it.chords, lead: it.lead, arp: t.arp, bass: () => it.bass ?? t.bass[0], drums: b => it.drums[b % it.drums.length] ?? '' }, 'intro: ', errors);
    for (const s of intro) delete s.ctr;
  }
  return { steps: [...intro, ...loop], intro: intro.length, bars, stepSec: 60 / t.bpm / 4, errors };
}

/** All track problems (bad chords, wrong bar lengths) plus sfx ids used in source but not defined. */
export function validateTracks(): string[] {
  const out: string[] = [];
  for (const [id, t] of Object.entries(TRACKS)) for (const e of compileTrack(t).errors) out.push(`${id}: ${e}`);
  for (const e of lintSfxCalls()) out.push(e);
  return out;
}

// ---- sfx call-site lint (node only) ----------------------------------------------------------

/** Pure: every string literal inside `sfx(...)` calls in `files` that is not a known sfx id. */
export function findUnknownSfx(files: { path: string; src: string }[], ids: readonly string[] = SFX_IDS): string[] {
  const known = new Set(ids); const out: string[] = [];
  for (const f of files) {
    const re = /\bsfx\(([^()]*)\)/g; let m: RegExpExecArray | null;
    while ((m = re.exec(f.src))) {
      const lits = m[1].match(/(['"`])([^'"`]*)\1/g) ?? [];
      for (const l of lits) { const id = l.slice(1, -1); if (!known.has(id)) out.push(`sfx id "${id}" used in ${f.path}:${f.src.slice(0, m.index).split('\n').length} is not in SFX_IDS`); }
    }
  }
  return out;
}

/** Scans src/**.ts for sfx('id') calls (only when running under node, e.g. tools/lint-content.ts). */
export function lintSfxCalls(ids: readonly string[] = SFX_IDS): string[] {
  try {
    const proc = (globalThis as any).process; const get = proc?.getBuiltinModule;
    if (typeof get !== 'function' || typeof import.meta?.url !== 'string' || !import.meta.url.startsWith('file:')) return [];
    const fs = get('node:fs'); const path = get('node:path'); const url = get('node:url');
    const srcDir = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
    const files: { path: string; src: string }[] = [];
    const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.ts$/.test(e.name) && !path.relative(srcDir, p).startsWith(`audio${path.sep}`)) files.push({ path: path.relative(srcDir, p), src: fs.readFileSync(p, 'utf8') }); } };
    walk(srcDir);
    return findUnknownSfx(files, ids);
  } catch { return []; }
}
