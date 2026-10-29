import type { Game, Module } from '../core/game';
import { evalCond } from '../core/conditions';
import type { QuestDef, Scene } from '../core/types';
import { normalizeQuests, matchPayload, type NQuest } from './validate';
import { DialogueEngine, revealLines, DLG_COLS, DLG_ROWS, type DlgState } from './dialogue';

/** Events the engine never reacts to (they would only feed back into itself or carry no game meaning). */
const IGNORED = new Set(['error', 'state:set']);
/** Progress is stored in the save under these inventory keys (kept for save compatibility). */
const PKEY = (id: string) => '_q_' + id;
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

  /** dialogue box layout the engine pages text for (ui should wrap with these) */
  readonly cols = DLG_COLS;
  readonly rows = DLG_ROWS;

  init(g: Game) {
    this.g = g;
    this.dlgEngine = new DialogueEngine(g);
    this.quests();
    g.bus.on('*', (p: any) => this.onEvent(p.evt, p));
    g.bus.on('scene:change', (p: any) => { this.dlgEngine.onSceneChange(p.from, p.to); this.flushDeferred(); });
    g.bus.on('game:new', () => { this.dlgEngine.reset(); this.deferred = []; this.check(); });
    g.bus.on('state:set', () => this.check());
  }

  /** Validated quest list (re-validated if content is swapped, e.g. by tests or showcases). */
  quests(): NQuest[] {
    const src = this.g.content.quests;
    if (src !== this.listSrc) {
      this.listSrc = src;
      this.list = normalizeQuests(src, msg => this.g.reportError('quest', msg));
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

  update(g: Game) { this.dlgEngine.update(g); if (!g.paused) this.flushDeferred(); }

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
      } catch (e) { this.g.reportError('quest', e); }
    }
  }

  private begin(q: NQuest) {
    this.g.ops.setQuest(q.id, 'active');
    this.g.mods.ui?.toast('NEW QUEST: ' + q.name.toUpperCase());
    if (q.dialogue) { this.deferred.push(q.dialogue); this.flushDeferred(); }
  }

  private bump(q: NQuest) {
    const s = this.g.state; const k = PKEY(q.id); const need = q.complete.count;
    const have = Math.min(need, (s.inventory[k] ?? 0) + 1);
    s.inventory[k] = have;
    this.g.bus.emit('quest:progress', { questId: q.id, have, need });
    if (have >= need) { this.complete(q); return; }
    // progress toasts: every step for small goals, quarter milestones for big ones
    const step = need <= 10 ? 1 : Math.ceil(need / 4);
    if (have % step === 0) this.g.mods.ui?.toast(`${q.name.toUpperCase()} ${fmt(have)}/${fmt(need)}`);
  }

  /** {have, need} for a quest (ui HUD and journal). Done quests report full progress. */
  progress(q: Pick<QuestDef, 'id'> & { complete?: { count?: number } }) {
    const id = q?.id ?? '';
    const nq = this.list.find(x => x.id === id);
    const need = Math.max(1, Math.floor(nq?.complete.count ?? q?.complete?.count ?? 1));
    const have = this.st(id) === 'done' ? need : Math.min(this.g.state.inventory[PKEY(id)] ?? 0, need);
    return { have, need };
  }

  /** Finish a quest and pay its reward (idempotent). */
  complete(q: Pick<QuestDef, 'id'>) {
    const g = this.g; const nq = this.quests().find(x => x.id === q?.id); if (!nq || this.st(nq.id) === 'done') return;
    g.state.inventory[PKEY(nq.id)] = nq.complete.count;
    g.ops.setQuest(nq.id, 'done');
    for (const f of nq.reward.flags) g.ops.setFlag(f);
    for (const [k, v] of Object.entries(nq.reward.items)) if (v > 0) g.ops.addItem(k, v);
    if (nq.reward.score) g.ops.addScore(nq.reward.score);
    g.mods.ui?.toast('QUEST COMPLETE: ' + nq.name.toUpperCase());
    const items = Object.entries(nq.reward.items).filter(([, v]) => v > 0).map(([k, v]) => {
      const it = g.content.items.find(i => i.id === k); return `${it ? it.name.toUpperCase() : k.toUpperCase()}${v > 1 ? ' X' + v : ''}`;
    });
    const parts = [nq.reward.score ? `+${fmt(nq.reward.score)}` : '', ...items].filter(Boolean);
    if (parts.length) g.mods.ui?.toast('REWARD ' + parts.join(', '));
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
    const ids = this.deferred; this.deferred = [];
    for (const id of ids) this.dlgEngine.open(id, undefined, true);
  }
}
export const makeQuest = (): Module => new Quest();
