import type { Game, Module } from '../core/game';
import { TRACKS } from './tracks';
import { makeKit, type Kit } from './synth';
import { buildMixer, Sequencer, LEVELS, type Mixer } from './engine';
import { startAmbience, type AmbHandle } from './ambience';
import { playSfx, SFX_LEN, SFX_POLY } from './sfx';

export { renderTrackOffline, renderAmbienceOffline, renderSfxOffline, renderMixOffline, type RenderStats } from './offline';
export { TRACKS, validateTracks } from './tracks';
export { SFX_IDS } from './sfx';
export { AMBIENCE_IDS } from './ambience';

/**
 * Audio: WebAudio-synthesized chiptune music, ambience beds and sfx. No audio files.
 * The AudioContext is only created inside a user gesture (autoplay policy); before that every call
 * just records what *should* play. Missing WebAudio support makes every call a silent no-op.
 */
class Audio implements Module {
  id = 'audio';
  api = this;
  g!: Game;
  ctx: AudioContext | null = null;
  kit: Kit | null = null; mix: Mixer | null = null; seq: Sequencer | null = null;
  trackId = ''; amb: AmbHandle | null = null; ambId = '';
  wantMusic = ''; wantAmb = '';
  ducked = false; failed = false;
  voices: Record<string, number[]> = {};

  init(g: Game) {
    this.g = g;
    if (g.headless || typeof window === 'undefined' || typeof addEventListener !== 'function') return;
    const unlock = () => this.ensure();
    for (const ev of ['keydown', 'pointerdown', 'touchstart']) addEventListener(ev, unlock, { passive: true });
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
      try { if (!this.ctx) return; if (document.hidden) void this.ctx.suspend(); else void this.ctx.resume(); } catch { /* ignore */ }
    });
    g.bus.on('scene:change', (p: any) => this.sceneMusic(p.to));
    g.bus.on('area:enter', () => this.sceneMusic('play'));
    g.bus.on('boss:start', () => this.music(this.bossTrack()));
    g.bus.on('boss:defeat', () => this.music(this.areaTrack()));
  }

  /** Create/resume the AudioContext. Must run inside a user gesture the first time. */
  ensure() {
    if (this.failed) return;
    if (this.ctx) { try { if (this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume(); } catch { /* ignore */ } return; }
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext; if (!AC) { this.failed = true; return; }
      const ctx = new AC() as AudioContext;
      this.kit = makeKit(ctx, (Date.now() & 0xffff) + 1);
      this.mix = buildMixer(ctx, ctx.destination);
      this.seq = new Sequencer(this.kit, this.mix);
      this.ctx = ctx;
      this.setVolumes();
      this.trackId = ''; this.ambId = '';
      // the scene may have been set before our bus listeners existed (deep links, showcases)
      if (!this.wantMusic) this.sceneMusic(this.g.state?.scene ?? 'title');
      else { this.music(this.wantMusic); if (this.wantAmb) this.ambience(this.wantAmb); }
    } catch { this.ctx = null; this.failed = true; }
  }

  setVolumes() {
    if (!this.ctx || !this.mix) return;
    try {
      const st = this.g.state?.settings ?? { music: 0.6, sfx: 0.8 }; const t = this.ctx.currentTime;
      this.mix.music.gain.setTargetAtTime(Math.max(0, st.music) * LEVELS.music, t, 0.03);
      this.mix.amb.gain.setTargetAtTime(Math.max(0, st.music) * LEVELS.amb, t, 0.03);
      this.mix.sfx.gain.setTargetAtTime(Math.max(0, st.sfx) * LEVELS.sfx, t, 0.03);
    } catch { /* ignore */ }
  }

  areaTrack(): string { return this.g.mods.world?.area()?.music ?? 'yard'; }
  /** Regular bosses get 'boss'; the final area (one that leads to an ending) gets 'finale'. */
  bossTrack(): string { const a = this.g.mods.world?.area(); return a?.ending || a?.id === 'mothership' ? 'finale' : 'boss'; }

  sceneMusic(scene: string) {
    if (scene === 'title' || scene === 'map') { this.music('title'); this.ambience('none'); }
    else if (scene === 'play') { this.music(this.g.mods.interaction?.boss ? this.bossTrack() : this.areaTrack()); this.ambience(this.g.mods.world?.area()?.ambience ?? 'none'); }
    else if (scene === 'ending') { this.music('ending'); this.ambience('none'); }
  }

  music(id: string) {
    this.wantMusic = id;
    if (!this.ctx || !this.seq || !this.mix || this.trackId === id) return;
    try {
      this.trackId = id; const t = this.ctx.currentTime; const f = this.mix.switchFade.gain;
      // quick dip so the old song's already-scheduled notes don't clash with the new one
      f.cancelScheduledValues(t); f.setValueAtTime(f.value, t); f.linearRampToValueAtTime(0, t + 0.12); f.linearRampToValueAtTime(1, t + 0.3);
      this.seq.set(TRACKS[id] ?? null, t + 0.16);
    } catch { /* ignore */ }
  }

  ambience(id: string) {
    this.wantAmb = id;
    if (!this.ctx || !this.kit || !this.mix || this.ambId === id) return;
    try {
      const t = this.ctx.currentTime;
      this.amb?.stop(t); this.amb = null; this.ambId = id;
      if (id && id !== 'none') this.amb = startAmbience(this.kit, this.mix.amb, id, t + 0.05);
    } catch { /* ignore */ }
  }

  sfx(id: string) {
    if (!this.ctx || !this.kit || !this.mix || this.ctx.state !== 'running') return;
    try {
      const t = this.ctx.currentTime; const len = SFX_LEN[id]; if (len === undefined) return;
      const v = (this.voices[id] ??= []).filter(e => e > t);
      if (v.length >= (SFX_POLY[id] ?? 4)) { this.voices[id] = v; return; }
      if (v.length && v[v.length - 1] - len > t - 0.025) { this.voices[id] = v; return; } // same sfx < 25 ms ago: skip (avoids phasing)
      v.push(t + len); this.voices[id] = v;
      playSfx(this.kit, this.mix.sfx, id, t + 0.005);
    } catch { /* ignore */ }
  }

  update(g: Game) {
    const c = this.ctx; if (!c || !this.seq || !this.mix || c.state !== 'running') return;
    const now = c.currentTime;
    // resync after the tab was hidden / the loop stalled: never burst-schedule the past
    if (this.seq.nextT < now - 0.25) this.seq.nextT = now + 0.05;
    this.seq.schedule(now + 0.15);
    this.amb?.tick(now + 0.3, now);
    // pause: duck + muffle the music
    const duck = !!g.paused;
    if (duck !== this.ducked) {
      this.ducked = duck;
      this.mix.duck.gain.setTargetAtTime(duck ? 0.35 : 1, now, 0.08);
      this.mix.duckLP.frequency.setTargetAtTime(duck ? 1100 : 20000, now, 0.08);
      this.mix.amb.gain.setTargetAtTime((this.g.state?.settings?.music ?? 0.6) * LEVELS.amb * (duck ? 0.4 : 1), now, 0.1);
    }
  }
}
export const makeAudio = (): Module => new Audio();
