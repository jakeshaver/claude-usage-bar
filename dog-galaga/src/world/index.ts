import type { Game, Module } from '../core/game';
import { W, H, PF_X, PF_W } from '../core/game';
import type { AreaDef, Scene, Tod } from '../core/types';
import { evalCond } from '../core/conditions';
import { Background } from './bg';
import { text } from '../art/font';

type Phase = 'intro' | 'wave' | 'between' | 'bonus' | 'boss' | 'outro' | 'nap' | 'done';

/** World: areas, the quest-graph director, scrolling backgrounds, time of day, transitions. */
class World implements Module {
  id = 'world';
  api = this;
  g!: Game;
  phase: Phase = 'done';
  timer = 0;
  bonusDone = false;
  bg = new Background();
  trans: { t: number; dur: number; kind: 'fade' | 'iris'; mid?: () => void; done?: boolean } | null = null;
  titleCard = 0;

  init(g: Game) {
    this.g = g;
    g.bus.on('wave:clear', () => this.onWaveClear());
    g.bus.on('boss:defeat', () => { if (this.phase === 'boss') { this.phase = 'outro'; this.timer = 90; } });
    g.bus.on('bonus:end', () => { if (this.phase === 'bonus') { this.phase = 'between'; this.timer = 60; } });
    g.bus.on('player:nap', () => { if (this.phase !== 'wave' && this.phase !== 'boss') return; this.napFromBoss = this.phase === 'boss'; this.phase = 'nap'; this.timer = 150; });
  }
  napFromBoss = false;

  area(id = this.g.state.areaId): AreaDef | undefined { return this.g.content.areas.find(a => a.id === id); }
  currentArea() { return this.area(); }

  /** Exits available from an area given current state. Always includes unconditional exits. */
  exitsFrom(id: string) { return (this.area(id)?.exits ?? []).filter(e => evalCond(e.when, this.g.state) && this.area(e.to)); }

  graph() {
    return {
      start: this.g.content.start,
      nodes: this.g.content.areas.map(a => ({ id: a.id, ending: a.ending ?? null })),
      edges: this.g.content.areas.flatMap(a => a.exits.map(e => ({ from: a.id, to: e.to, when: e.when ?? null }))),
    };
  }

  setTod(tod: Tod) { this.g.state.tod = tod; }

  transition(kind: 'fade' | 'iris', mid: () => void) {
    if (this.g.headless) { mid(); return; }
    this.trans = { t: 0, dur: 50, kind, mid };
  }

  newGame() {
    const s = this.g.state;
    Object.assign(s, { areaId: this.g.content.start, waveIndex: 0, score: 0, hearts: s.maxHearts, flags: {}, quests: {}, inventory: {}, memories: [], areasCleared: [], ending: null,
      stats: { shots: 0, hits: 0, naps: 0, playTicks: 0, catsBooped: 0 } });
    this.g.bus.emit('game:new', {});
    this.enterArea(this.g.content.start, 0);
  }

  enterArea(id: string, wave = 0) {
    const a = this.area(id); if (!a) { this.g.reportError('world', `unknown area ${id}`); return; }
    const s = this.g.state;
    s.areaId = id; s.waveIndex = Math.max(0, Math.min(wave, a.waves.length)); s.tod = a.tod;
    this.bonusDone = s.waveIndex > this.bonusAt(a);
    this.g.mods.interaction?.clearAll();
    this.bg.setArea(a, this.g);
    this.g.setScene('play');
    this.phase = 'intro'; this.timer = 150; this.titleCard = 150;
    this.g.mods.player?.respawn();
    this.g.bus.emit('area:enter', { areaId: id, waveIndex: s.waveIndex });
    if (s.waveIndex === 0 && a.intro) this.g.mods.quest?.dialogue(a.intro);
    this.g.mods.save?.save();
  }

  bonusAt(a: AreaDef) { return a.bonus ? Math.ceil(a.waves.length / 2) : 999; }

  private startNext() {
    const a = this.area()!; const s = this.g.state;
    if (a.bonus && !this.bonusDone && s.waveIndex === this.bonusAt(a)) {
      this.bonusDone = true; this.phase = 'bonus'; this.g.mods.minigames?.startBonus(a.bonus); return;
    }
    if (s.waveIndex < a.waves.length) { this.phase = 'wave'; this.g.mods.interaction?.startWave(a.id, s.waveIndex); return; }
    if (a.boss) { this.phase = 'boss'; this.g.mods.interaction?.startBoss(a.boss); return; }
    this.phase = 'outro'; this.timer = 30;
  }

  private onWaveClear() {
    if (this.phase !== 'wave') return;
    this.g.state.waveIndex++;
    this.phase = 'between'; this.timer = 75;
    this.g.mods.save?.save();
  }

  private finishArea() {
    const a = this.area()!; const s = this.g.state;
    if (!s.areasCleared.includes(a.id)) s.areasCleared.push(a.id);
    this.g.bus.emit('area:clear', { areaId: a.id });
    this.phase = 'done';
    if (a.ending) {
      const end = this.g.content.endings.find(e => e.when && evalCond(e.when, s)) ?? this.g.content.endings.find(e => e.id === a.ending) ?? this.g.content.endings[0];
      s.ending = end.id;
      this.g.mods.save?.save();
      this.transition('iris', () => { this.g.setScene('ending'); this.g.bus.emit('ending', { endingId: end.id }); });
      return;
    }
    this.g.mods.save?.save();
    this.transition('fade', () => this.g.setScene('map'));
  }

  /** Map choice (UI or bot). */
  chooseExit(to: string) {
    const ok = this.exitsFrom(this.g.state.areaId).find(e => e.to === to);
    if (!ok) return false;
    this.transition('iris', () => this.enterArea(to, 0));
    return true;
  }

  goto(scene: Scene, opts: any = {}) {
    if (scene === 'play') return this.enterArea(opts.area ?? this.g.state.areaId, opts.wave ?? 0);
    if (scene === 'map' && opts.area) this.g.state.areaId = opts.area;
    this.g.setScene(scene);
  }

  update(g: Game) {
    if (this.trans) {
      this.trans.t++;
      if (!this.trans.done && this.trans.t >= this.trans.dur / 2) { this.trans.done = true; this.trans.mid?.(); }
      if (this.trans.t >= this.trans.dur) this.trans = null;
    }
    if (g.paused) return;
    const sc = g.state.scene;
    if (sc === 'play' || sc === 'bonus' || sc === 'title' || sc === 'map' || sc === 'ending') this.bg.update(g);
    if (sc !== 'play' && sc !== 'bonus') return;
    if (this.titleCard > 0) this.titleCard--;
    switch (this.phase) {
      case 'intro': if (--this.timer <= 0) this.startNext(); break;
      case 'between': if (--this.timer <= 0) this.startNext(); break;
      case 'nap':
        if (--this.timer <= 0) {
          g.state.hearts = g.state.maxHearts; g.mods.player?.respawn();
          if (this.napFromBoss) { this.phase = 'boss'; if (!g.mods.interaction?.boss) g.mods.interaction?.startBoss(this.area()!.boss!); } else { this.phase = 'wave'; g.mods.interaction?.startWave(g.state.areaId, g.state.waveIndex); }
        }
        break;
      case 'outro':
        if (--this.timer <= 0) {
          const a = this.area()!; this.phase = 'done';
          if (a.outro) { g.mods.quest?.dialogue(a.outro, () => this.finishArea()); } else this.finishArea();
        }
        break;
    }
  }

  render(g: Game, r: any) {
    const sc = g.state.scene;
    if (sc === 'play' || sc === 'bonus' || sc === 'dialogue') this.bg.render(g, r);
  }

  overlay(g: Game, ctx: CanvasRenderingContext2D) {
    const sc = g.state.scene;
    if ((sc === 'play' || sc === 'dialogue') && this.titleCard > 0) {
      const a = this.area(); if (a) {
        const t = this.titleCard; const alpha = Math.min(1, t / 30, (150 - t) / 20 + 0.01);
        ctx.globalAlpha = Math.max(0, alpha);
        const cx = PF_X + PF_W / 2;
        ctx.fillStyle = '#0b0a14cc'; ctx.fillRect(PF_X, 130, PF_W, 64);
        ctx.fillStyle = '#4ef2e6'; ctx.fillRect(PF_X, 130, PF_W, 1); ctx.fillRect(PF_X, 193, PF_W, 1);
        const idx = g.content.areas.indexOf(a);
        text(ctx, `SECTOR ${String(idx + 1).padStart(2, '0')}`, cx, 140, '#4ef2e6', { align: 'center' });
        text(ctx, a.name, cx, 154, '#ffffff', { align: 'center', scale: 2, shadow: '#a3285f' });
        if (a.subtitle) text(ctx, a.subtitle, cx, 176, '#c9a2ff', { align: 'center' });
        ctx.globalAlpha = 1;
      }
    }
    if (sc === 'play' && this.phase === 'nap') {
      const cx = PF_X + PF_W / 2;
      ctx.fillStyle = '#1d1b33aa'; ctx.fillRect(PF_X, 0, PF_W, H);
      text(ctx, 'POM IS TAKING A NAP', cx, 150, '#ffd166', { align: 'center', scale: 2, shadow: '#0b0a14' });
      text(ctx, 'Z z z . . .  BACK IN A SEC!', cx, 176, '#b9c1f2', { align: 'center' });
    }
    if (sc === 'play' && this.phase === 'between' && this.g.state.waveIndex > 0) {
      const a = this.area();
      if (a && this.timer > 20) {
        const left = a.waves.length - g.state.waveIndex;
        text(ctx, left > 0 ? `WAVE ${g.state.waveIndex + 1} / ${a.waves.length}` : (a.boss ? 'WARNING: BIG CAT INBOUND' : 'SECTOR CLEAR'), PF_X + PF_W / 2, 160, left > 0 ? '#4ef2e6' : '#ff5a4f', { align: 'center', scale: 2, shadow: '#0b0a14' });
      }
    }
    if (this.trans) {
      const p = this.trans.t / this.trans.dur; const k = p < 0.5 ? p * 2 : (1 - p) * 2;
      if (this.trans.kind === 'fade') { ctx.fillStyle = `rgba(11,10,20,${k})`; ctx.fillRect(0, 0, W, H); }
      else {
        const rad = Math.max(0, (1 - k) * 380);
        ctx.save(); ctx.fillStyle = '#0b0a14'; ctx.beginPath(); ctx.rect(0, 0, W, H);
        ctx.arc(W / 2, H / 2, rad, 0, Math.PI * 2, true); ctx.fill('evenodd'); ctx.restore();
        // pawprint sparkle ring
        if (rad > 4 && rad < 360) { ctx.strokeStyle = '#4ef2e6'; ctx.beginPath(); ctx.arc(W / 2, H / 2, rad, 0, Math.PI * 2); ctx.stroke(); }
      }
    }
  }
}
export const makeWorld = (): Module => new World();
