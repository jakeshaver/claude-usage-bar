import type { Game, Module } from '../core/game';
import { TRACKS } from './tracks';
import { makeKit, type Kit } from './synth';
import { buildMixer, Sequencer, LEVELS, PAUSE, type Mixer } from './engine';
import { startAmbience, type AmbHandle } from './ambience';
import { SfxVoices, SFX_LEN } from './sfx';
import { text, textWidth } from '../art/font';
import { col } from '../core/palette';

export { renderTrackOffline, renderAmbienceOffline, renderSfxOffline, renderMixOffline, renderFireHoldOffline, type RenderStats } from './offline';
export { TRACKS, validateTracks, findUnknownSfx } from './tracks';
export { SFX_IDS } from './sfx';
export { AMBIENCE_IDS } from './ambience';

/**
 * Audio: WebAudio-synthesized chiptune music, ambience beds and sfx. No audio files.
 * The AudioContext is created on the first key/pointer/touch gesture or the first gamepad press (a pad press
 * is not a user activation for autoplay, so the title shows a "press any key / tap for sound" hint until the
 * context actually runs). Before that every call just records what *should* play. Missing WebAudio support
 * makes every call a silent no-op.
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
  voices = new SfxVoices();
  /** one sfx requested while the context was still starting (e.g. the select/bark of the unlocking press). */
  pending: { id: string; at: number } | null = null;
  private padTry = -999;

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
    // the hint must draw above the UI's title screen, so it is a tiny module appended after every other one
    g.register({ id: 'audio-hint', overlay: (gg, ctx) => this.hint(gg, ctx) });
  }

  /** True once sound can actually be heard. */
  running(): boolean { try { return !!this.ctx && this.ctx.state === 'running'; } catch { return false; } }

  /** Create/resume the AudioContext. The first call should run inside a user gesture. */
  ensure() {
    if (this.failed) return;
    const hidden = typeof document !== 'undefined' && document.hidden;
    if (this.ctx) { try { if (this.ctx.state === 'suspended' && !hidden) void this.ctx.resume().then(() => this.flushPending(), () => { /* not yet */ }); } catch { /* ignore */ } return; }
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext; if (!AC) { this.failed = true; return; }
      const ctx = new AC() as AudioContext;
      this.kit = makeKit(ctx, (Date.now() & 0xffff) + 1);
      this.mix = buildMixer(ctx, ctx.destination);
      this.seq = new Sequencer(this.kit, this.mix);
      this.ctx = ctx;
      ctx.onstatechange = () => this.flushPending();
      this.setVolumes();
      this.trackId = ''; this.ambId = '';
      // the scene may have been set before our bus listeners existed (deep links, showcases)
      if (!this.wantMusic) this.sceneMusic(this.g.state?.scene ?? 'title');
      else { this.music(this.wantMusic); if (this.wantAmb) this.ambience(this.wantAmb); }
      if (ctx.state === 'suspended' && !hidden) void ctx.resume().then(() => this.flushPending(), () => { /* not allowed yet */ });
    } catch { this.ctx = null; this.failed = true; }
  }

  private flushPending() {
    const p = this.pending; if (!p || !this.running()) return;
    this.pending = null;
    if (performance.now() - p.at < 1500) this.sfx(p.id);
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

  /**
   * The area's music. An area whose content music is 'boss' (the mothership's regular waves) plays the
   * dedicated 'mothership' march instead, so the real boss fight still escalates (see core-requests/audio.md).
   */
  areaTrack(): string { const m = this.g.mods.world?.area()?.music ?? 'yard'; return m === 'boss' ? 'mothership' : m; }
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
    if (!this.ctx || !this.kit || !this.mix || SFX_LEN[id] === undefined) return;
    try {
      if (this.ctx.state !== 'running') { this.pending = { id, at: performance.now() }; return; }
      this.voices.play(this.kit, this.mix.sfx, id, this.ctx.currentTime + 0.005);
    } catch { /* ignore */ }
  }

  /** Gamepads never fire DOM events: create/resume the context on pad input instead. */
  private pollPad(g: Game) {
    try {
      let pressed = g.input?.lastDevice === 'gamepad';
      if (!pressed && typeof navigator !== 'undefined' && navigator.getGamepads) {
        for (const p of navigator.getGamepads()) if (p && p.buttons.some(b => b?.pressed)) { pressed = true; break; }
      }
      if (!pressed) return;
      // retry at most every ~0.5 s while a pad is in use (cheap; succeeds as soon as the page has activation)
      if (g.tick - this.padTry > 30) { this.padTry = g.tick; this.ensure(); }
    } catch { /* ignore */ }
  }

  update(g: Game) {
    if (!g.headless && !this.failed && !this.running()) this.pollPad(g);
    const c = this.ctx; if (!c || !this.seq || !this.mix || c.state !== 'running') return;
    const now = c.currentTime;
    // resync after the tab was hidden / the loop stalled: never burst-schedule the past
    if (this.seq.nextT < now - 0.25) this.seq.nextT = now + 0.05;
    this.seq.schedule(now + 0.15);
    this.amb?.tick(now + 0.3, now);
    // pause: duck + muffle the music and let the ambience bed come up a little. The ambience lift lives on
    // its own node, so Settings changing volumes from the pause menu can't undo it.
    const duck = !!g.paused;
    if (duck !== this.ducked) {
      this.ducked = duck;
      this.mix.duck.gain.setTargetAtTime(duck ? PAUSE.music : 1, now, 0.08);
      this.mix.duckLP.frequency.setTargetAtTime(duck ? PAUSE.musicLP : 20000, now, 0.08);
      this.mix.ambDuck.gain.setTargetAtTime(duck ? PAUSE.amb : 1, now, 0.15);
    }
  }

  /** Title-screen hint until sound is actually running (gamepad presses can't unlock audio on their own). */
  hint(g: Game, ctx: CanvasRenderingContext2D) {
    if (g.headless || this.failed || g.state?.scene !== 'title' || this.running()) return;
    if (Math.floor(g.tick / 40) % 4 === 3) return; // gentle blink: visible 3/4 of the time
    try {
      const msg = 'PRESS ANY KEY / TAP FOR SOUND'; const w = textWidth(msg) + 10; const x = 320 - (w >> 1), y = 314;
      ctx.fillStyle = col(2); ctx.fillRect(x - 1, y - 1, w + 2, 13); ctx.fillStyle = col(1); ctx.fillRect(x, y, w, 11);
      text(ctx, msg, 320, y + 2, col(5), { align: 'center' });
    } catch { /* ignore */ }
  }
}
export const makeAudio = (): Module => new Audio();
