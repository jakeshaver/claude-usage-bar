import type { Game, Module } from '../core/game';
import { TRACKS, type Track } from './tracks';

const NOTE: Record<string, number> = { C: -9, 'C#': -8, Db: -8, D: -7, 'D#': -6, Eb: -6, E: -5, F: -4, 'F#': -3, Gb: -3, G: -2, 'G#': -1, Ab: -1, A: 0, 'A#': 1, Bb: 1, B: 2 };
function freq(n: string): number { const m = /^([A-G][#b]?)(\d)$/.exec(n); if (!m) return 0; return 440 * Math.pow(2, (NOTE[m[1]] + (+m[2] - 4) * 12) / 12); }

/** Audio: WebAudio-synthesized chiptune music, ambience beds and sfx. No audio files. */
class Audio implements Module {
  id = 'audio';
  api = this;
  g!: Game;
  ctx: AudioContext | null = null;
  master!: GainNode; musicBus!: GainNode; sfxBus!: GainNode; ambBus!: GainNode;
  track: Track | null = null; trackId = ''; step = 0; nextT = 0;
  ambId = ''; ambNodes: AudioNode[] = []; ambTimer = 0;
  noiseBuf: AudioBuffer | null = null;
  wantMusic = ''; wantAmb = '';

  init(g: Game) {
    this.g = g;
    if (g.headless || typeof window === 'undefined') return;
    const unlock = () => { this.ensure(); };
    addEventListener('keydown', unlock); addEventListener('pointerdown', unlock); addEventListener('touchstart', unlock);
    g.bus.on('scene:change', (p: any) => this.sceneMusic(p.to));
    g.bus.on('area:enter', () => this.sceneMusic('play'));
    g.bus.on('boss:start', () => this.music('boss'));
    g.bus.on('boss:defeat', () => this.music(this.areaTrack()));
  }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext; if (!AC) return;
      this.ctx = new AC() as AudioContext;
      this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain(); this.musicBus.connect(this.master);
      this.sfxBus = this.ctx.createGain(); this.sfxBus.connect(this.master);
      this.ambBus = this.ctx.createGain(); this.ambBus.connect(this.master);
      const b = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate); const d = b.getChannelData(0);
      let s = 1; for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
      this.noiseBuf = b;
      this.setVolumes();
      if (this.wantMusic) this.music(this.wantMusic);
      if (this.wantAmb) this.ambience(this.wantAmb);
    } catch { this.ctx = null; }
  }
  setVolumes() {
    if (!this.ctx) return; const st = this.g.state.settings;
    this.musicBus.gain.value = st.music * 0.22; this.sfxBus.gain.value = st.sfx * 0.35; this.ambBus.gain.value = st.music * 0.25;
  }
  areaTrack() { return this.g.mods.world?.area()?.music ?? 'yard'; }
  sceneMusic(scene: string) {
    if (scene === 'title' || scene === 'map') { this.music('title'); this.ambience('none'); }
    else if (scene === 'play') { this.music(this.g.mods.interaction?.boss ? 'boss' : this.areaTrack()); this.ambience(this.g.mods.world?.area()?.ambience ?? 'none'); }
    else if (scene === 'ending') { this.music('ending'); this.ambience('none'); }
  }
  music(id: string) {
    this.wantMusic = id; if (!this.ctx || this.trackId === id) return;
    this.track = TRACKS[id] ?? null; this.trackId = id; this.step = 0; this.nextT = this.ctx.currentTime + 0.05;
  }
  ambience(id: string) {
    this.wantAmb = id; if (!this.ctx || this.ambId === id) return;
    this.ambNodes.forEach(n => { try { (n as any).stop?.(); n.disconnect(); } catch { /* */ } }); this.ambNodes = []; this.ambId = id;
    if (id === 'none' || !this.noiseBuf) return;
    const c = this.ctx; const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); const gn = c.createGain();
    const cfg: Record<string, [BiquadFilterType, number, number]> = { birds: ['lowpass', 500, 0.15], city: ['lowpass', 260, 0.5], water: ['bandpass', 600, 0.35], wind: ['bandpass', 900, 0.25], space: ['lowpass', 120, 0.6], factory: ['lowpass', 200, 0.5], cafe: ['bandpass', 1200, 0.12] };
    const [type, fr, vol] = cfg[id] ?? cfg.wind; f.type = type; f.frequency.value = fr; gn.gain.value = vol;
    src.connect(f); f.connect(gn); gn.connect(this.ambBus); src.start();
    this.ambNodes.push(src, f, gn);
  }
  tone(f: number, t: number, dur: number, type: OscillatorType, vol: number, bus: GainNode, slide = 0) {
    if (!this.ctx || f <= 0) return; const c = this.ctx;
    const o = c.createOscillator(); const gn = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f * slide), t + dur);
    gn.gain.setValueAtTime(vol, t); gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(gn); gn.connect(bus); o.start(t); o.stop(t + dur + 0.02);
  }
  noise(t: number, dur: number, vol: number, bus: GainNode, hp = 1000) {
    if (!this.ctx || !this.noiseBuf) return; const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
    const gn = c.createGain(); gn.gain.setValueAtTime(vol, t); gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(gn); gn.connect(bus); s.start(t, (this.step % 10) * 0.05, dur + 0.05);
  }
  sfx(id: string) {
    if (!this.ctx) return; const t = this.ctx.currentTime; const B = this.sfxBus;
    switch (id) {
      case 'plop': this.tone(220, t, 0.09, 'square', 0.25, B, 0.4); break;
      case 'thud': this.tone(140, t, 0.06, 'triangle', 0.4, B, 0.6); break;
      case 'meow': this.tone(700, t, 0.08, 'square', 0.18, B, 1.4); this.tone(980, t + 0.07, 0.12, 'square', 0.15, B, 0.6); this.noise(t, 0.1, 0.12, B, 3000); break;
      case 'dive': this.tone(900, t, 0.3, 'triangle', 0.08, B, 0.5); break;
      case 'hurt': this.tone(300, t, 0.25, 'sawtooth', 0.3, B, 0.3); this.noise(t, 0.2, 0.2, B, 500); break;
      case 'whimper': this.tone(800, t, 0.25, 'triangle', 0.2, B, 0.6); break;
      case 'shield': this.tone(500, t, 0.2, 'sine', 0.3, B, 2); break;
      case 'pickup': [523, 659, 784].forEach((f, i) => this.tone(f, t + i * 0.05, 0.1, 'square', 0.18, B)); break;
      case 'memory': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, t + i * 0.08, 0.25, 'triangle', 0.25, B)); break;
      case 'quest': [392, 523, 659, 784, 1046].forEach((f, i) => this.tone(f, t + i * 0.07, 0.2, 'square', 0.16, B)); break;
      case 'bossdown': this.noise(t, 0.8, 0.4, B, 200); [784, 659, 523, 392].forEach((f, i) => this.tone(f, t + i * 0.1, 0.3, 'square', 0.2, B)); break;
      case 'blip': this.tone(1200, t, 0.03, 'square', 0.1, B); break;
      case 'select': this.tone(880, t, 0.05, 'square', 0.15, B); this.tone(1320, t + 0.05, 0.08, 'square', 0.12, B); break;
      case 'bark': this.tone(320, t, 0.07, 'sawtooth', 0.3, B, 0.7); this.tone(260, t + 0.1, 0.09, 'sawtooth', 0.3, B, 0.6); break;
    }
  }
  update(g: Game) {
    if (!this.ctx || !this.track) return;
    const c = this.ctx; const tr = this.track; const sp = 60 / tr.bpm / 4;
    const L = tr.lead.split(' '), Bs = tr.bass.split(' '), D = tr.drums.split(' ');
    const M = this.musicBus; const quiet = g.paused ? 0.4 : 1;
    while (this.nextT < c.currentTime + 0.12) {
      const i = this.step;
      const l = L[i % L.length], b = Bs[i % Bs.length], d = D[i % D.length];
      if (l && l !== '.') this.tone(freq(l), this.nextT, sp * 1.8, tr.wave ?? 'square', 0.16 * quiet, M);
      if (b && b !== '.') this.tone(freq(b), this.nextT, sp * 1.6, 'triangle', 0.3 * quiet, M);
      if (d === 'k') this.tone(120, this.nextT, 0.12, 'sine', 0.5 * quiet, M, 0.4);
      else if (d === 's') this.noise(this.nextT, 0.1, 0.25 * quiet, M, 1500);
      else if (d === 'h') this.noise(this.nextT, 0.03, 0.12 * quiet, M, 6000);
      this.step++; this.nextT += sp;
    }
    // ambient one-shots
    if (this.ambId === 'birds' && ++this.ambTimer % 97 === 0) { const t = c.currentTime; const f = 2200 + (this.ambTimer % 7) * 180; this.tone(f, t, 0.06, 'sine', 0.05, this.ambBus, 1.3); this.tone(f * 1.1, t + 0.08, 0.06, 'sine', 0.04, this.ambBus, 1.2); }
    if (this.ambId === 'city' && ++this.ambTimer % 400 === 0) this.tone(330, c.currentTime, 0.4, 'square', 0.03, this.ambBus);
    if (this.ambId === 'factory' && ++this.ambTimer % 45 === 0) this.noise(c.currentTime, 0.05, 0.15, this.ambBus, 300);
  }
}
export const makeAudio = (): Module => new Audio();
