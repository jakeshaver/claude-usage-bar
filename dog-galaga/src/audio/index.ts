import type { Game, Module } from '../core/game';
import { TRACKS, type Track } from './tracks';
import { makeKit, type Kit } from './synth';
import { buildMixer, Sequencer, LEVELS, PAUSE, SIDE, sideDip, type Mixer } from './engine';
import { startAmbience, type AmbHandle } from './ambience';
import { SfxVoices, SFX_LEN } from './sfx';
import { col } from '../core/palette';

export type { RenderStats } from './offline';
export { TRACKS, validateTracks, findUnknownSfx } from './tracks';

// Offline renderers are lazy: `./offline` is only fetched when a showcase/tool calls one, so it stays out of
// the boot chunk. (A showcase can also `await import('../audio/offline')` directly.)
type Off = typeof import('./offline');
const off = (): Promise<Off> => import('./offline');
export const renderTrackOffline: Off['renderTrackOffline'] = (...a) => off().then(m => m.renderTrackOffline(...a));
export const renderAmbienceOffline: Off['renderAmbienceOffline'] = (...a) => off().then(m => m.renderAmbienceOffline(...a));
export const renderSfxOffline: Off['renderSfxOffline'] = (...a) => off().then(m => m.renderSfxOffline(...a));
export const renderMixOffline: Off['renderMixOffline'] = (...a) => off().then(m => m.renderMixOffline(...a));
export const renderFireHoldOffline: Off['renderFireHoldOffline'] = (...a) => off().then(m => m.renderFireHoldOffline(...a));
export const renderSequenceOffline: Off['renderSequenceOffline'] = (...a) => off().then(m => m.renderSequenceOffline(...a));

/** Sfx that already announce an event; a toast arriving with one of them stays silent. */
const BIG = new Set(['quest', 'memory', 'pickup', 'bossdown', 'select', 'bark']);
/** Longest wait for a bar-line switch before falling back to a half bar / beat. */
const MAX_QUANT = 1.1;

/** Speaker icon (palette keys) for the "sound is off until you press something" hint. */
const SPEAKER = [
  '.....66',
  '....656',
  '...6556',
  '6666556',
  '6555556',
  '6555556',
  '6666556',
  '...6556',
  '....656',
  '.....66',
];
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
  /** toast objects already heard (polled from the UI, which has no toast event) + last "big" sfx time. */
  private seenToasts = new WeakSet<object>();
  private bigAt = -9;
  private hinted = false;

  /** play the stage-start fanfare at the next wave:start (first wave of an area visit, after a nap). */
  stageDue = false;

  init(g: Game) {
    this.g = g;
    if (g.headless || typeof window === 'undefined' || typeof addEventListener !== 'function') return;
    const unlock = () => this.ensure();
    for (const ev of ['keydown', 'pointerdown', 'touchstart']) addEventListener(ev, unlock, { passive: true });
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
      try { if (!this.ctx) return; if (document.hidden) void this.ctx.suspend(); else void this.ctx.resume(); } catch { /* ignore */ }
    });
    g.bus.on('scene:change', (p: any) => this.sceneMusic(p.to));
    g.bus.on('area:enter', () => { this.stageDue = true; this.sceneMusic('play'); });
    g.bus.on('wave:start', () => { if (this.stageDue) { this.stageDue = false; this.stinger('stage', this.areaTrack()); } });
    g.bus.on('boss:start', () => { this.stageDue = false; this.music(this.bossTrack()); });
    // victory stinger after the bossdown sfx has had its moment, then back to the area (or whatever comes next)
    g.bus.on('boss:defeat', () => this.stinger('victory', this.areaTrack(), 0.7));
    g.bus.on('player:nap', () => { this.stageDue = !this.g.mods.interaction?.boss; this.stinger('nap', this.g.mods.interaction?.boss ? this.bossLoop() : this.areaTrack()); });
    g.bus.on('bonus:start', () => this.music('bonus'));
    g.bus.on('bonus:result', () => this.stinger('results', this.wantLoop()));
    g.bus.on('ending', () => this.music('ending'));
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
      // the cozy bed must not vanish with the music slider: own setting if there is one, else max(music, sfx)
      const amb = typeof (st as any).amb === 'number' ? (st as any).amb : Math.max(st.music, st.sfx);
      this.mix.amb.gain.setTargetAtTime(Math.max(0, amb) * LEVELS.amb, t, 0.03);
      this.mix.sfx.gain.setTargetAtTime(Math.max(0, st.sfx) * LEVELS.sfx, t, 0.03);
    } catch { /* ignore */ }
  }

  /** The area's music, exactly as content declares it (`areas.json` `music`; ARCHITECTURE.md section 5). */
  areaTrack(): string {
    const m = this.g.mods.world?.area()?.music;
    return typeof m === 'string' && TRACKS[m] ? m : 'yard';
  }
  /** Regular bosses get 'boss'; the final area (one that leads to an ending) gets 'finale'. */
  bossTrack(): string { const a = this.g.mods.world?.area(); return a?.ending || a?.id === 'mothership' ? 'finale' : 'boss'; }

  /** the boss loop without re-triggering the intro sting is not separable, so a boss nap resumes the boss song. */
  bossLoop(): string { return this.bossTrack(); }
  /** the loop the current scene wants. */
  wantLoop(): string {
    const sc = this.g.state?.scene ?? 'title';
    return sc === 'title' ? 'title' : sc === 'map' ? 'map' : sc === 'bonus' ? 'bonus' : sc === 'ending' ? 'ending'
      : this.g.mods.interaction?.boss ? this.bossTrack() : this.areaTrack();
  }

  sceneMusic(scene: string) {
    if (scene === 'title') { this.music('title'); this.ambience('none'); }
    else if (scene === 'map') { this.music('map'); this.ambience('none'); }
    else if (scene === 'bonus') { this.music('bonus'); }
    else if (scene === 'play') { this.music(this.g.mods.interaction?.boss ? this.bossTrack() : this.areaTrack()); this.ambience(this.g.mods.world?.area()?.ambience ?? 'none'); }
    else if (scene === 'ending') { this.music('ending'); this.ambience('none'); }
  }

  /** Steps until the switch point: the next bar line, or a half bar / beat when the bar line is too far off. */
  private quant(minDelay: number): number {
    const seq = this.seq!, c = seq.comp!; const lead = seq.nextT - this.ctx!.currentTime;
    for (const grid of [16, 8, 4]) {
      let n = seq.stepsTo(grid); while (lead + n * c.stepSec < minDelay) n += grid;
      if (lead + n * c.stepSec <= MAX_QUANT + minDelay || grid === 4) return n;
    }
    return 0;
  }

  /** Start `tr` on the next musical boundary (immediately when nothing is playing), fading the old song a bit. */
  private switchTo(tr: Track | null, minDelay = 0) {
    const seq = this.seq!, ctx = this.ctx!, now = ctx.currentTime;
    if (!seq.track || !seq.comp) { seq.set(tr, now + 0.05 + minDelay); return; }
    seq.queue(tr, this.quant(minDelay));
    const at = Math.max(now + 0.02, seq.switchTime()); const f = this.mix!.switchFade.gain;
    f.cancelScheduledValues(now); f.setValueAtTime(f.value, now);
    f.linearRampToValueAtTime(0.5, at); f.linearRampToValueAtTime(1, at + 0.06);
  }

  private busyWithStinger(): boolean { const s = this.seq!; return !!(s.track?.once || s.pending?.once); }

  /** Change the looping song (on the bar line). A playing stinger is allowed to finish first. */
  music(id: string) {
    this.wantMusic = id;
    if (!this.ctx || !this.seq || !this.mix || this.trackId === id) return;
    try {
      const tr = TRACKS[id] ?? null; this.trackId = id;
      if (this.busyWithStinger()) { this.seq.after = [...this.seq.after.filter(t => t.once), ...(tr ? [tr] : [])]; return; }
      this.seq.after = [];
      this.switchTo(tr);
    } catch { /* ignore */ }
  }

  /** Play a one-shot song (`once` track) on the next bar line, then continue with the loop `then`. */
  stinger(id: string, then: string, minDelay = 0) {
    this.wantMusic = then;
    if (!this.ctx || !this.seq || !this.mix) return;
    try {
      const st = TRACKS[id]; const nx = TRACKS[then]; if (!st) { this.music(then); return; }
      this.trackId = then;
      if (this.busyWithStinger()) { this.seq.after = [...this.seq.after.filter(t => t.once), st, ...(nx ? [nx] : [])]; return; }
      this.switchTo(st, minDelay); this.seq.after = nx ? [nx] : [];
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

  /**
   * Give every event its own sound even where a caller still uses the generic menu tick (see core-requests
   * R4-2): the boss wind-up plays `tell`, and advancing dialogue plays `talk`. Menus keep `blip`.
   */
  private remap(id: string): string {
    if (id !== 'blip') return id;
    try {
      const b: any = this.g.mods.interaction?.boss;
      if (b && b.st === 'tell' && b.stT <= 1) return 'tell';
      if (this.g.state?.scene === 'dialogue' && !this.g.paused) return 'talk';
    } catch { /* ignore */ }
    return id;
  }

  sfx(id: string) {
    id = this.remap(id);
    if (BIG.has(id)) this.bigAt = this.g?.tick ?? 0;
    if (!this.ctx || !this.kit || !this.mix || SFX_LEN[id] === undefined) return;
    try {
      if (this.ctx.state !== 'running') { this.pending = { id, at: performance.now() }; return; }
      const t = this.ctx.currentTime + 0.005;
      if (this.voices.play(this.kit, this.mix.sfx, id, t) && SIDE.ids.includes(id)) sideDip(this.mix, t);
    } catch { /* ignore */ }
  }

  /** New UI toasts chime (`toast`), unless a bigger cue (quest fanfare, memory...) just played for the same event. */
  private pollToasts(g: Game) {
    try {
      const list: any[] = (g.mods.ui as any)?.toasts; if (!Array.isArray(list)) return;
      let fresh = false;
      for (const x of list) if (x && typeof x === 'object' && !this.seenToasts.has(x)) { this.seenToasts.add(x); fresh = true; }
      if (fresh && g.tick - this.bigAt > 12 && g.state?.scene !== 'title') this.sfx('toast');
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
    if (!g.headless && !this.failed && !this.running()) {
      this.pollPad(g);
      // a pad player (or anyone who starts without a key/tap) gets told once, outside the title screen
      // ...and only on a calm screen: no briefing, title card or open menu to stack under
      const sc = g.state?.scene ?? 'title', W = g.mods.world as any, Q = g.mods.quest as any, U = g.mods.ui as any;
      const calm = (sc === 'play' || sc === 'map') && !(W?.titleCard > 0) && !Q?.briefingPending?.() && (U?.menuOpen ?? 'none') === 'none';
      if (!this.hinted && g.tick > 90 && calm) {
        this.hinted = true;
        try { (g.mods.ui as any)?.toast?.('TAP OR PRESS A KEY FOR SOUND'); } catch { /* ignore */ }
      }
    }
    if (!g.headless) this.pollToasts(g);
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

  /**
   * "Sound is off" hint on every scene until sound is actually running (gamepad presses can't unlock audio on their
   * own): a small pixel speaker in the top-right corner with a blinking red slash (the indie convention).
   */
  hint(g: Game, ctx: CanvasRenderingContext2D) {
    if (g.headless || this.failed || this.running()) return;
    try {
      const x0 = 612, y0 = 6;
      ctx.fillStyle = col(2); ctx.fillRect(x0 - 1, y0 - 1, 22, 16); ctx.fillStyle = col(1); ctx.fillRect(x0, y0, 20, 14);
      const keys = '0123456789abcdefghijklmnopqrstuv';
      SPEAKER.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const ch = row[x]; if (ch === '.') continue; ctx.fillStyle = col(keys.indexOf(ch)); ctx.fillRect(x0 + 6 + x, y0 + 2 + y, 1, 1); } });
      // red slash with an ink shadow, blinking ~1 Hz (the speaker itself stays put)
      if (Math.floor(g.tick / 30) % 2 === 0) {
        for (let i = 0; i < 11; i++) { ctx.fillStyle = col(0); ctx.fillRect(x0 + 16 - i, y0 + 1 + i, 3, 2); }
        for (let i = 0; i < 11; i++) { ctx.fillStyle = col(27); ctx.fillRect(x0 + 16 - i, y0 + 1 + i, 2, 1); }
      }
    } catch { /* ignore */ }
  }
}
export const makeAudio = (): Module => new Audio();
