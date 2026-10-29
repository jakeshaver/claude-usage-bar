import type { Game, Module } from '../core/game';
import { evalCond } from '../core/conditions';
import type { QuestDef, Scene } from '../core/types';
import { normalizeQuests, matchPayload, deriveQuest, type NQuest } from './validate';
import { DialogueEngine, revealLines, DLG_COLS, DLG_ROWS, type DlgState } from './dialogue';
import { buildSheet, drawSheet, type SheetSlot } from './sheet';

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
  private toastQ: { t: string; reveal?: string }[] = [];
  /** quests started whose NEW QUEST toast has not been shown yet: the HUD keeps them hidden until it lands */
  private unrevealed = new Set<string>();
  private toastT = 0;
  /** tick each quest was last started or reached a milestone (drives tracked()) */
  private touched: Record<string, number> = {};

  /** dialogue box layout the engine pages text for (ui should wrap with these) */
  readonly cols = DLG_COLS;
  readonly rows = DLG_ROWS;

  init(g: Game) {
    this.g = g;
    this.dlgEngine = new DialogueEngine(g, (file, msg) => this.issue(file, msg));
    this.quests();
    g.bus.on('*', (p: any) => this.onEvent(p.evt, p));
    g.bus.on('scene:change', (p: any) => { this.dlgEngine.onSceneChange(p.from, p.to); this.flushDeferred(); });
    g.bus.on('game:new', () => { this.dlgEngine.reset(); this.deferred = []; this.toastQ = []; this.unrevealed.clear(); this.touched = {}; this.check(); });
    // deep links (tools, showcases, tests) land mid-route: start the quests the skipped sectors would have started
    g.bus.on('area:enter', (p: any) => { try { if (this.isDeepLink(p?.areaId)) this.seedRoute(p.areaId); } catch (e) { g.reportError('quest', e); } });
    // boss banter: optional content nodes taunt-<bossId> (boss arrives) and defeat-<bossId> (opens the outro)
    g.bus.on('boss:start', (p: any) => { const id = `taunt-${p?.bossId}`; if (p?.bossId && this.hasNode(id)) this.dialogue(id); });
    g.bus.on('state:set', () => this.check());
  }

  /** Validated quest list (re-validated if content is swapped, e.g. by tests or showcases). */
  quests(): NQuest[] {
    const src = this.g.content.quests;
    if (src !== this.listSrc) {
      this.listSrc = src;
      const areas = Array.isArray(this.g.content.areas) ? this.g.content.areas : [];
      this.list = normalizeQuests(src, msg => this.issue('quests', msg)).map(q => deriveQuest(q, areas as any));
    }
    return this.list;
  }

  /**
   * Quiet channel for content problems (malformed quest entry, missing dialogue id, unknown quest id): they go to
   * `g.contentIssues` (dev tools / screenshot JSON), never to `g.errors`, whose entries become the player-facing
   * crash toast. Real exceptions caught by the engine still go through `g.reportError`. Each message is kept once.
   */
  issue(file: string, msg: string) {
    const g = this.g; if (!g) return;
    const list: { file: string; msg: string }[] = Array.isArray(g.contentIssues) ? g.contentIssues : (g.contentIssues = []);
    const m = `[quest] ${msg}`;
    if (list.some(i => i.file === file && i.msg === m)) return;
    list.push({ file, msg: m });
    if (list.length > 400) list.shift();
    if (!g.headless && typeof console !== 'undefined') console.warn(m);
  }

  // ---------------- dialogue (ui reads `dlg`; ui's pause menu parks it by setting dlg = null and back) ----------------
  /**
   * The open conversation. A briefing that is still waiting behind the sector title card is invisible to the
   * frame painter (nothing is drawn over the card), but any other caller asking for `dlg` (ui's skip key and
   * pause menu, tools that advance or skip, tests) wants to act on it, so the read promotes it at once.
   */
  get dlg(): DlgState | null {
    const E = this.dlgEngine; if (!E) return null;
    if (!E.dlg && E.isStaged() && !this.painting) E.unstage();
    return E.dlg ?? null;
  }
  set dlg(v: DlgState | null) { if (!this.dlgEngine) return; if (!v) this.dlgEngine.staged = null; this.dlgEngine.dlg = v; }
  /** True while the renderer is drawing a frame (set by render(), cleared once the frame's task is over). */
  private painting = false;
  render() {
    if (this.painting) return;
    this.painting = true;
    const clear = () => { this.painting = false; };
    if (typeof queueMicrotask === 'function') queueMicrotask(clear); else Promise.resolve().then(clear);
  }
  /** A briefing is open, waiting on the title card, or parked by the pause menu (ui: pause items / hints). */
  briefingPending() { return this.dlgEngine.busy(); }

  /** Open a dialogue chain. Pauses play; `done` runs after the last node closes. Missing ids show a friendly fallback. */
  dialogue(nodeId: string, done?: () => void) {
    // the sector boss gets the first word of the outro when content gives it one (defeat-<bossId>)
    const a = this.g.content.areas?.find?.(x => x?.id === this.g.state.areaId);
    const line = a?.boss ? `defeat-${a.boss}` : '';
    if (a && nodeId === a.outro && line && this.hasNode(line)) {
      this.dlgEngine.open(line, () => this.dlgEngine.open(nodeId, done, true));
      return;
    }
    this.dlgEngine.open(nodeId, done);
  }
  /** Does content have a dialogue node with this id (no issue reported when it does not)? */
  hasNode(id: string) { const d = this.g.content.dialogue; return Array.isArray(d) && d.some(n => n && n.id === id); }
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

  /** Dialogue review sheet (showcase): several engine states drawn at once with ui's own comm panel. */
  private sheet: SheetSlot[] | null = null;
  /** Showcase: show the review sheet (voices, typing, punctuation beat, paging, fallback). Off with `false`. */
  showSheet(on = true) { this.sheet = on ? buildSheet(this.g, this.dlgEngine) : null; return this.sheet?.map(s => s.tag) ?? []; }
  overlay(g: Game, ctx: CanvasRenderingContext2D) { if (this.sheet) drawSheet(g, ctx, this.sheet, this.dlgEngine); }

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
  private say(t: string, reveal?: string) { this.toastQ.push({ t, reveal }); this.flushToasts(); }
  /** Release held quest toasts one by one once no conversation or sector title card is on screen. */
  private flushToasts() {
    if (!this.toastQ.length || this.g.paused) return;
    const g = this.g; const sc = g.state.scene;
    if (sc !== 'play' && sc !== 'bonus' && sc !== 'map') return;
    if (this.dlgEngine.busy()) return;
    if (sc === 'play' && Number(g.mods.world?.titleCard ?? 0) > 0) return;
    if (g.tick - this.toastT < TOAST_GAP && !g.headless) return;
    this.toastT = g.tick;
    const t = this.toastQ.shift()!; g.mods.ui?.toast(t.t);
    if (t.reveal) { this.unrevealed.delete(t.reveal); this.touched[t.reveal] = g.tick + 0.5; }
  }
  /** Quest toasts not shown yet (tests). */
  heldToasts() { return this.toastQ.map(x => x.t); }
  /** False while a just-started quest's NEW QUEST toast is still held (the HUD should not spoil it). */
  revealed(id: string) { return !this.unrevealed.has(id); }

  // ---------------- quests ----------------
  private matches(t: NQuest['start'], evt: string, p: any) {
    if (t.on !== evt) return false;
    if (!matchPayload(t.match, p)) return false;
    try { return evalCond(t.when, this.g.state); } catch (e) { this.issue('quests', `bad condition: ${e instanceof Error ? e.message : e}`); return false; }
  }

  onEvent(evt: string, p: any) {
    if (!evt || IGNORED.has(evt)) return;
    this.q.push({ evt, p });
    if (this.busy) return;
    this.busy = true;
    try {
      let guard = 0;
      while (this.q.length) {
        if (++guard > 500) { this.issue('quests', `event storm (${this.q[0].evt}); dropped ${this.q.length} events`); this.q.length = 0; break; }
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
    this.unrevealed.add(q.id);
    this.say('NEW QUEST: ' + q.name.toUpperCase(), q.id);
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

  /**
   * A one-shot quest bound to a whole sector ("clear X", "beat X's boss") measures progress in the sector's
   * stages, counted exactly like the HUD's WAVE n/N (waves plus the boss stage). Null for other quests.
   */
  stages(nq: NQuest | undefined): { areaId: string; total: number } | null {
    if (!nq || nq.complete.count !== 1 || nq.track) return null;
    const areas = Array.isArray(this.g.content.areas) ? this.g.content.areas : [];
    const m = nq.complete.match ?? {};
    let a = null as (typeof areas)[number] | null | undefined;
    if (nq.complete.on === 'area:clear' && typeof m.areaId === 'string') a = areas.find(x => x?.id === m.areaId);
    else if (nq.complete.on === 'boss:defeat' && typeof m.bossId === 'string') a = areas.find(x => x?.boss === m.bossId);
    const n = Array.isArray(a?.waves) ? a!.waves.length : 0;
    if (!a || !n) return null;
    return { areaId: a.id, total: n + (a.boss ? 1 : 0) };
  }

  /** {have, need} for a quest (ui HUD and journal). Done quests report full progress. */
  progress(q: Pick<QuestDef, 'id'> & { complete?: { count?: number } }) {
    const id = q?.id ?? '';
    const nq = this.quests().find(x => x.id === id);
    if (nq?.track && this.st(id) !== 'done') { const need = nq.track.memories; return { have: Math.min(need, this.g.state.memories.length), need }; }
    const sg = this.stages(nq);
    if (sg) {
      const s = this.g.state; const need = sg.total;
      if (this.st(id) === 'done') return { have: need, need };
      // stages behind Pom in this sector; the last one only counts when the quest itself completes
      const have = s.areaId === sg.areaId ? Math.max(0, Math.min(need - 1, Math.floor(Number(s.waveIndex) || 0))) : 0;
      return { have, need };
    }
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
      if (this.st(q.id) !== 'active' || this.missed(q.id) || this.unrevealed.has(q.id)) return;
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

  /**
   * Was this area entered through a deep link (tool, showcase, test) rather than flown to? Normal play reaches a
   * later sector only after clearing the ones before it, so nothing cleared and not the start sector means a jump.
   */
  private isDeepLink(areaId: unknown) {
    const s = this.g.state; const c = this.g.content;
    return typeof areaId === 'string' && areaId !== c.start && (!Array.isArray(s.areasCleared) || s.areasCleared.length === 0) && !this.g.autopilot;
  }

  /** Shortest flight from the start sector to `areaId` through the sector graph (exits), start first. */
  routeTo(areaId: string): string[] {
    const areas = Array.isArray(this.g.content.areas) ? this.g.content.areas : [];
    const start = this.g.content.start; if (!areas.some(a => a?.id === areaId)) return [];
    const prev: Record<string, string | null> = { [start]: null }; const q = [start];
    while (q.length) {
      const id = q.shift()!; if (id === areaId) break;
      const a = areas.find(x => x?.id === id);
      for (const e of Array.isArray(a?.exits) ? a!.exits : []) if (e?.to && !(e.to in prev)) { prev[e.to] = id; q.push(e.to); }
    }
    if (!(areaId in prev)) return [];
    const out: string[] = []; for (let id: string | null = areaId; id; id = prev[id]) out.unshift(id);
    return out;
  }

  /**
   * Deep-link helper: put the quest log where a pilot flying the shortest route to `areaId` would have it.
   * Events every such flight is certain to produce in the sectors before it (enter, each wave cleared, the boss
   * arriving and booped, sector clear) start the quests they would have started, and finish the one-shot quests
   * they would have finished; counted quests get the certain part of their count. Quests that hang on luck
   * (memories, pups, a perfect bonus) are left alone. Quiet: no toasts, no rewards, no dialogue. Returns the ids
   * it started (finished ones included).
   */
  seedRoute(areaId: string): string[] {
    const route = this.routeTo(areaId); if (route.length < 2) return [];
    const areas = this.g.content.areas;
    const evts: { evt: string; p: any }[] = [{ evt: 'game:new', p: {} }];
    for (const id of route.slice(0, -1)) {
      const a = areas.find(x => x.id === id); if (!a) continue;
      evts.push({ evt: 'area:enter', p: { areaId: id, waveIndex: 0 } });
      (Array.isArray(a.waves) ? a.waves : []).forEach((_w, i) => evts.push({ evt: 'wave:clear', p: { areaId: id, waveIndex: i } }));
      if (a.boss) { evts.push({ evt: 'boss:start', p: { bossId: a.boss } }); evts.push({ evt: 'boss:defeat', p: { bossId: a.boss } }); }
      evts.push({ evt: 'area:clear', p: { areaId: id } });
    }
    const s = this.g.state; const seeded: string[] = [];
    const hit = (t: NQuest['start'], e: { evt: string; p: any }) => t.on === e.evt && matchPayload(t.match, e.p);
    for (const q of this.quests()) {
      if (this.st(q.id) !== 'locked') continue;
      const i0 = evts.findIndex(e => hit(q.start, e)); if (i0 < 0) continue;
      if (q.expire.some(t => evts.slice(i0).some(e => hit(t, e)))) continue;
      const n = evts.slice(i0).filter(e => hit(q.complete, e)).length;
      seeded.push(q.id); this.touched[q.id] = this.g.tick - 1;
      if (n >= q.complete.count && !q.track) {
        s.inventory[PKEY(q.id)] = q.complete.count; this.g.ops.setQuest(q.id, 'done');
        for (const f of q.reward.flags) this.g.ops.setFlag(f);
      } else { if (n > 0) s.inventory[PKEY(q.id)] = n; this.g.ops.setQuest(q.id, 'active'); }
    }
    return seeded;
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
    if (!q) { this.issue('quests', `start: unknown quest "${id}"`); return; }
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
