import type { Game, Module } from '../core/game';
import { evalCond } from '../core/conditions';
import type { QuestDef, Scene } from '../core/types';
import { normalizeQuests, matchPayload, deriveQuest, type NQuest } from './validate';
import { DialogueEngine, revealLines, DLG_COLS, DLG_ROWS, type DlgState } from './dialogue';

/** Events the engine never reacts to (they would only feed back into itself or carry no game meaning). */
const IGNORED = new Set(['error', 'state:set']);
/** Progress is stored in the save under these inventory keys (kept for save compatibility). */
const PKEY = (id: string) => '_q_' + id;
/** A quest closed as missed (its route was passed by). Saved alongside progress. */
const XKEY = (id: string) => '_qx_' + id;
/** Min ticks between quest toasts, so they arrive one at a time instead of stacking. */
const TOAST_GAP = 36;
const fmt = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * Quest engine + dialogue engine.
 * Quests are declarative (content/quests.json): `start` and `complete` triggers name a bus event, an optional
 * `match` filter on its payload and an optional `when` condition; `complete.count` matching events finish the
 * quest. Events are processed through a queue, so rewards that emit events (flags, items, quest:update) are
 * handled after the current event instead of re-entering the loop.
 */
class Quest implements Module {
  id = 'quest';
  api = this;
  g!: Game;
  dlgEngine!: DialogueEngine;
  private list: NQuest[] = [];
  private listSrc: unknown = null;
  private q: { evt: string; p: any }[] = [];
  private busy = false;
  /** quest dialogues waiting for a scene that can host them (not bonus/title/ending) */
  private deferred: string[] = [];
  /** quest toasts held until nothing else is being read (no dialogue, no sector title card) */
  private toastQ: string[] = [];
  private toastT = 0;
  /** tick each quest was last started or reached a milestone (drives tracked()) */
  private touched: Record<string, number> = {};

  /** dialogue box layout the engine pages text for (ui should wrap with these) */
  readonly cols = DLG_COLS;
  readonly rows = DLG_ROWS;

  init(g: Game) {
    this.g = g;
    this.dlgEngine = new DialogueEngine(g);
    this.quests();
    g.bus.on('*', (p: any) => this.onEvent(p.evt, p));
    g.bus.on('scene:change', (p: any) => { this.dlgEngine.onSceneChange(p.from, p.to); this.flushDeferred(); });
    g.bus.on('game:new', () => { this.dlgEngine.reset(); this.deferred = []; this.toastQ = []; this.touched = {}; this.check(); });
    g.bus.on('state:set', () => this.check());
  }

  /** Validated quest list (re-validated if content is swapped, e.g. by tests or showcases). */
  quests(): NQuest[] {
    const src = this.g.content.quests;
    if (src !== this.listSrc) {
      this.listSrc = src;
      const areas = Array.isArray(this.g.content.areas) ? this.g.content.areas : [];
      this.list = normalizeQuests(src, msg => this.g.reportError('quest', msg)).map(q => deriveQuest(q, areas as any));
    }
    return this.list;
  }

  // ---------------- dialogue (ui reads `dlg`; ui's pause menu parks it by setting dlg = null and back) ----------------
  get dlg(): DlgState | null { return this.dlgEngine?.dlg ?? null; }
  set dlg(v: DlgState | null) { if (this.dlgEngine) this.dlgEngine.dlg = v; }

  /** Open a dialogue chain. Pauses play; `done` runs after the last node closes. Missing ids show a friendly fallback. */
  dialogue(nodeId: string, done?: () => void) { this.dlgEngine.open(nodeId, done); }
  advance() { this.dlgEngine.advance(); }
  /** Fast-forward the whole open conversation. */
  skipAll() { this.dlgEngine.skipAll(); }
  typing() { return this.dlgEngine.typing(); }
  /** Wrapped lines of the current page, revealed up to the typewriter position (words never jump lines). */
  visibleLines(): string[] { const d = this.dlg ?? this.g.mods.ui?.heldDlg; return d ? revealLines(d.node.text, d.chars, DLG_COLS, DLG_ROWS) : []; }

  update(g: Game) {
    this.dlgEngine.update(g);
    if (!g.paused) { this.flushDeferred(); this.flushToasts(); }
  }

  /** Open `id` and play `at` ticks of typewriter (showcase stills: typing, punctuation pauses, later pages). */
  stage(id: string, at?: number) { return this.dlgEngine.stage(id, at); }

  /**
   * Where ui should dock the dialogue box so it never hides the speaker's own ship: 'top' while Pom is in the
   * bottom band the box covers, else 'bottom'.
   */
  dock(boxH = 80): 'top' | 'bottom' {
    const p = this.g.mods.player; const y = Number(p?.y ?? 0);
    return y + 20 > 360 - boxH - 4 ? 'top' : 'bottom';
  }

  // ---------------- toasts (one thing to read at a time) ----------------
  private say(t: string) { this.toastQ.push(t); this.flushToasts(); }
  /** Release held quest toasts one by one once no conversation or sector title card is on screen. */
  private flushToasts() {
    if (!this.toastQ.length || this.g.paused) return;
    const g = this.g; const sc = g.state.scene;
    if (sc !== 'play' && sc !== 'bonus' && sc !== 'map') return;
    if (this.dlgEngine.busy()) return;
    if (sc === 'play' && Number(g.mods.world?.titleCard ?? 0) > 0) return;
    if (g.tick - this.toastT < TOAST_GAP && !g.headless) return;
    this.toastT = g.tick;
    const t = this.toastQ.shift()!; g.mods.ui?.toast(t);
  }
  /** Quest toasts not shown yet (tests). */
  heldToasts() { return [...this.toastQ]; }

  // ---------------- quests ----------------
  private matches(t: NQuest['start'], evt: string, p: any) {
    if (t.on !== evt) return false;
    if (!matchPayload(t.match, p)) return false;
    try { return evalCond(t.when, this.g.state); } catch (e) { this.g.reportError('quest', e); return false; }
  }

  onEvent(evt: string, p: any) {
    if (!evt || IGNORED.has(evt)) return;
    this.q.push({ evt, p });
    if (this.busy) return;
    this.busy = true;
    try {
      let guard = 0;
      while (this.q.length) {
        if (++guard > 500) { this.g.reportError('quest', `event storm (${this.q[0].evt}); dropped ${this.q.length} events`); this.q.length = 0; break; }
        const e = this.q.shift()!;
        this.process(e.evt, e.p);
      }
    } finally { this.busy = false; }
  }

  private st(id: string) { return this.g.state.quests[id] ?? 'locked'; }

  private process(evt: string, p: any) {
    for (const q of this.quests()) {
      try {
        if (this.st(q.id) === 'locked' && this.matches(q.start, evt, p)) this.begin(q);
        // the starting event also counts toward completion when it matches (e.g. first memory of the scrapbook)
        if (this.st(q.id) === 'active' && this.matches(q.complete, evt, p)) this.bump(q);
        else if (this.st(q.id) === 'active' && !this.missed(q.id)) {
          if (q.track && evt === 'memory:get') this.trackStep(q);
          if (q.expire.some(t => this.matches(t, evt, p))) this.miss(q);
        }
      } catch (e) { this.g.reportError('quest', e); }
    }
  }

  private begin(q: NQuest) {
    this.g.ops.setQuest(q.id, 'active');
    this.touched[q.id] = this.g.tick + 0.5;
    this.say('NEW QUEST: ' + q.name.toUpperCase());
    if (q.dialogue) { this.deferred.push(q.dialogue); this.flushDeferred(); }
  }

  /** A state goal moved (e.g. one more memory toward the secret route). */
  private trackStep(q: NQuest) {
    const { have, need } = this.progress(q);
    this.g.bus.emit('quest:progress', { questId: q.id, have, need });
    this.touched[q.id] = this.g.tick;
    if (have === need) this.say(`${q.name.toUpperCase()}: ROUTE OPEN!`);
    else if (have < need) this.say(`${q.name.toUpperCase()} ${have}/${need} MEMORIES`);
  }

  /** The quest's route was passed by: close it gently (no reward, no penalty). */
  private miss(q: NQuest) {
    this.g.state.inventory[XKEY(q.id)] = 1;
    this.g.bus.emit('quest:progress', { questId: q.id, ...this.progress(q), missed: true });
    this.say(`${q.name.toUpperCase()}: MISSED. NEXT FLIGHT!`);
  }
  /** True when an active quest was closed as missed. */
  missed(id: string) { return this.st(id) === 'active' && !!this.g.state.inventory[XKEY(id)]; }
  /** Quest status including 'missed' (ui journal / HUD). */
  status(id: string): 'locked' | 'active' | 'done' | 'missed' { return this.missed(id) ? 'missed' : this.st(id); }

  private bump(q: NQuest) {
    const s = this.g.state; const k = PKEY(q.id); const need = q.complete.count;
    const have = Math.min(need, (s.inventory[k] ?? 0) + 1);
    s.inventory[k] = have;
    this.g.bus.emit('quest:progress', { questId: q.id, have, need });
    if (have >= need) { this.complete(q); return; }
    // progress toasts: every step for small goals, quarter milestones for big ones
    const step = need <= 10 ? 1 : Math.ceil(need / 4);
    if (have % step === 0) { this.touched[q.id] = this.g.tick; this.say(`${q.name.toUpperCase()} ${fmt(have)}/${fmt(need)}`); }
  }

  /** {have, need} for a quest (ui HUD and journal). Done quests report full progress. */
  progress(q: Pick<QuestDef, 'id'> & { complete?: { count?: number } }) {
    const id = q?.id ?? '';
    const nq = this.quests().find(x => x.id === id);
    if (nq?.track && this.st(id) !== 'done') { const need = nq.track.memories; return { have: Math.min(need, this.g.state.memories.length), need }; }
    const need = Math.max(1, Math.floor(nq?.complete.count ?? q?.complete?.count ?? 1));
    const have = this.st(id) === 'done' ? need : Math.min(this.g.state.inventory[PKEY(id)] ?? 0, need);
    return { have, need };
  }

  /**
   * The quest the HUD should show: active (not missed) quests tied to the current sector first, then the one
   * most recently started or advanced to a milestone. Long-running quests (boops, scrapbook) never bury new ones.
   */
  tracked(): NQuest | null {
    const s = this.g.state; let best: NQuest | null = null; let bestScore = -Infinity;
    this.quests().forEach((q, i) => {
      if (this.st(q.id) !== 'active' || this.missed(q.id)) return;
      const here = q.complete.match?.areaId === s.areaId || q.start.match?.areaId === s.areaId;
      const score = (here ? 1e12 : 0) + (this.touched[q.id] ?? -1) * 1000 - i;
      if (score > bestScore) { bestScore = score; best = q; }
    });
    return best;
  }
  /** Alias kept for ui: the focused quest. */
  focus() { return this.tracked(); }

  /** Short goal line for the HUD (fits `max` chars), e.g. 'CLEAR 1 WAVE', 'BOOP BIG SAL', 'MEMORIES 2/4'. */
  goal(q: Pick<QuestDef, 'id'>, max = 16): string {
    const nq = this.quests().find(x => x.id === q?.id); if (!nq) return '';
    const st = this.status(nq.id);
    if (st === 'done') return 'COMPLETE!';
    if (st === 'missed') return 'NEXT FLIGHT!';
    const c = this.g.content; const m = nq.complete.match ?? {};
    // "VERB NAME", dropping leading words of the name until it fits: CLEAR MANHATTAN ROOFTOPS -> CLEAR ROOFTOPS
    const fit = (verb: string, name: string | undefined, alt: string) => {
      if (!name) return alt;
      const w = name.split(',')[0].replace(/^the\s+/i, '').toUpperCase().split(/\s+/);
      for (let i = 0; i < w.length; i++) { const s = `${verb} ${w.slice(i).join(' ')}`; if (s.length <= max) return s; }
      return alt;
    };
    const areaName = (id: unknown) => c.areas.find(a => a.id === id)?.name;
    const { have, need } = this.progress(nq);
    let s: string;
    if (nq.track) s = have >= need ? 'ROUTE OPEN: MAP' : `MEMORIES ${have}/${need}`;
    else switch (nq.complete.on) {
      case 'wave:clear': s = need > 1 ? `WAVES ${have}/${need}` : 'CLEAR 1 WAVE'; break;
      case 'area:clear': s = fit('CLEAR', areaName(m.areaId), 'CLEAR THE SECTOR'); break;
      case 'area:enter': s = fit('REACH', areaName(m.areaId), 'FIND THE WAY'); break;
      case 'boss:defeat': s = m.bossId ? fit('BOOP', c.enemies.find(e => e.id === m.bossId)?.name, 'BOOP THE BIG CAT') : need > 1 ? `BIG CATS ${have}/${need}` : 'BOOP A BIG CAT'; break;
      case 'cat:boop': s = need > 1 ? `BOOPS ${fmt(have)}/${fmt(need)}` : 'BOOP A CAT'; break;
      case 'pup:rescue': s = need > 1 ? `PUPS ${have}/${need}` : 'RESCUE A PUP'; break;
      case 'memory:get': s = need > 1 ? `MEMORIES ${have}/${need}` : 'FIND A MEMORY'; break;
      case 'flag:set': s = m.flag === 'perfect_bonus' ? 'PERFECT BONANZA' : 'KEEP FLYING'; break;
      default: s = need > 1 ? `${have}/${need}` : 'KEEP FLYING';
    }
    return s.length > max ? s.slice(0, max) : s;
  }

  /** Finish a quest and pay its reward (idempotent). */
  complete(q: Pick<QuestDef, 'id'>) {
    const g = this.g; const nq = this.quests().find(x => x.id === q?.id); if (!nq || this.st(nq.id) === 'done') return;
    g.state.inventory[PKEY(nq.id)] = nq.complete.count;
    delete g.state.inventory[XKEY(nq.id)];
    g.ops.setQuest(nq.id, 'done');
    for (const f of nq.reward.flags) g.ops.setFlag(f);
    for (const [k, v] of Object.entries(nq.reward.items)) if (v > 0) g.ops.addItem(k, v);
    if (nq.reward.score) g.ops.addScore(nq.reward.score);
    this.say('QUEST COMPLETE: ' + nq.name.toUpperCase());
    const items = Object.entries(nq.reward.items).filter(([, v]) => v > 0).map(([k, v]) => {
      const it = g.content.items.find(i => i.id === k); return `${it ? it.name.toUpperCase() : k.toUpperCase()}${v > 1 ? ' X' + v : ''}`;
    });
    const parts = [nq.reward.score ? `+${fmt(nq.reward.score)}` : '', ...items].filter(Boolean);
    if (parts.length) this.say('REWARD ' + parts.join(', '));
    g.mods.audio?.sfx('quest');
  }

  /** Re-evaluate: quests that start on 'check' (condition-only), and active quests already at their count. */
  check() {
    this.onEvent('check', {});
    for (const q of this.quests()) if (this.st(q.id) === 'active' && (this.g.state.inventory[PKEY(q.id)] ?? 0) >= q.complete.count) this.complete(q);
  }
  /** Force-start a quest by id (debug / scripted). Unknown ids are reported, never thrown. */
  start(id: string) {
    const q = this.quests().find(x => x.id === id);
    if (!q) { this.g.reportError('quest', `start: unknown quest "${id}"`); return; }
    if (this.st(id) === 'locked') this.begin(q);
  }
  available() { return this.quests().filter(q => this.st(q.id) !== 'locked'); }

  private flushDeferred() {
    if (!this.deferred.length || this.g.paused) return;
    const sc: Scene = this.g.state.scene;
    if (sc !== 'play' && sc !== 'map' && sc !== 'dialogue') return;
    if (sc === 'play' && Number(this.g.mods.world?.titleCard ?? 0) > 0 && !this.g.autopilot) return;
    const ids = this.deferred; this.deferred = [];
    for (const id of ids) this.dlgEngine.open(id, undefined, true);
  }
}
export const makeQuest = (): Module => new Quest();
