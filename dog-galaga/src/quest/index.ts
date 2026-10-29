import type { Game, Module } from '../core/game';
import { evalCond } from '../core/conditions';
import type { QuestDef, Trigger, DialogueDef } from '../core/types';

/** Quest engine (declarative triggers) + dialogue engine. */
class Quest implements Module {
  id = 'quest';
  api = this;
  g!: Game;
  counts: Record<string, number> = {};
  dlg: { node: DialogueDef; prev: string; done?: () => void; t: number; chars: number } | null = null;

  init(g: Game) {
    this.g = g;
    g.bus.on('*', (p: any) => this.onEvent(p.evt, p));
    g.bus.on('game:new', () => { this.counts = {}; this.dlg = null; this.check(); });
  }

  private matches(t: Trigger, evt: string, p: any) {
    if (t.on !== evt) return false;
    if (t.match) for (const [k, v] of Object.entries(t.match)) if (p[k] !== v) return false;
    return evalCond(t.when, this.g.state);
  }

  onEvent(evt: string, p: any) {
    if (evt === 'quest:update' || evt === 'flag:set' && false) return;
    const s = this.g.state;
    for (const q of this.g.content.quests) {
      const st = s.quests[q.id] ?? 'locked';
      if (st === 'locked' && this.matches(q.start, evt, p)) { this.g.ops.setQuest(q.id, 'active'); this.g.mods.ui?.toast('NEW QUEST: ' + q.name.toUpperCase()); }
      if ((s.quests[q.id] ?? 'locked') === 'active' && this.matches(q.complete, evt, p)) {
        const key = q.id; const need = q.complete.count ?? 1;
        // counts persist via inventory-like progress map in flags-free store
        s.inventory['_q_' + key] = (s.inventory['_q_' + key] ?? 0) + 1;
        if (s.inventory['_q_' + key] >= need) this.complete(q);
      }
    }
  }

  progress(q: QuestDef) { return { have: Math.min(this.g.state.inventory['_q_' + q.id] ?? 0, q.complete.count ?? 1), need: q.complete.count ?? 1 }; }

  complete(q: QuestDef) {
    const g = this.g;
    g.ops.setQuest(q.id, 'done');
    for (const f of q.reward.flags ?? []) g.ops.setFlag(f);
    for (const [k, v] of Object.entries(q.reward.items ?? {})) g.ops.addItem(k, v);
    if (q.reward.score) g.ops.addScore(q.reward.score);
    g.mods.ui?.toast('QUEST COMPLETE: ' + q.name.toUpperCase());
    g.mods.audio?.sfx('quest');
  }

  check() { this.onEvent('check', {}); }
  start(id: string) { this.g.ops.setQuest(id, 'active'); }
  available() { return this.g.content.quests.filter(q => (this.g.state.quests[q.id] ?? 'locked') !== 'locked'); }

  /** Open a dialogue chain. Pauses play; `done` runs after the last node closes. */
  dialogue(nodeId: string, done?: () => void) {
    const node = this.resolve(nodeId);
    if (!node) { done?.(); return; }
    const prev = this.g.state.scene === 'dialogue' ? (this.dlg?.prev ?? 'play') : this.g.state.scene;
    this.dlg = { node, prev, done, t: 0, chars: 0 };
    this.g.setScene('dialogue');
    this.g.bus.emit('dialogue:open', { nodeId: node.id });
  }
  private resolve(id: string | undefined): DialogueDef | null {
    let guard = 0;
    while (id && guard++ < 50) {
      const n = this.g.content.dialogue.find(d => d.id === id);
      if (!n) { this.g.reportError('quest', `missing dialogue ${id}`); return null; }
      if (evalCond(n.when, this.g.state)) return n;
      id = n.next;
    }
    return null;
  }
  advance() {
    const d = this.dlg; if (!d) return;
    if (d.chars < d.node.text.length) { d.chars = d.node.text.length; return; }
    const next = this.resolve(d.node.next);
    this.g.bus.emit('dialogue:close', { nodeId: d.node.id });
    if (next) { d.node = next; d.t = 0; d.chars = 0; this.g.bus.emit('dialogue:open', { nodeId: next.id }); return; }
    this.dlg = null;
    this.g.setScene(d.prev as any);
    d.done?.();
  }

  update(g: Game) {
    const d = this.dlg; if (!d || g.paused || g.state.scene !== 'dialogue') return;
    d.t++; if (d.chars < d.node.text.length) d.chars += 1.5;
    if (g.autopilot) { if (d.t > 20) this.advance(); return; }
    if (g.input.pressed('confirm') || g.input.pressed('fire')) { this.advance(); g.mods.audio?.sfx('talk'); }
  }
}
export const makeQuest = (): Module => new Quest();
