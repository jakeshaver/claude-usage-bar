import type { Game, Module } from '../core/game';
import { evalCond } from '../core/conditions';
import type { QuestDef, QuestState, Scene } from '../core/types';
import { normalizeQuests, matchPayload, deriveQuest, type NQuest } from './validate';
import { DialogueEngine, revealLines, DLG_COLS, DLG_ROWS, type DlgState } from './dialogue';
import { buildSheet, drawSheet, type SheetSlot } from './sheet';

/** Events the engine never reacts to (they would only feed back into itself or carry no game meaning). */
const IGNORED = new Set(['error', 'state:set']);
/** Progress is stored in the save under these inventory keys (kept for save compatibility). */
const PKEY = (id: string) => '_q_' + id;
/** Legacy marker (saves before polish 1): an 'active' quest closed as missed. Migrated to state 'missed' on load. */
const XKEY = (id: string) => '_qx_' + id;
/** Marks a quest the run-end sweep closed (its window simply ran out), as opposed to a route forfeit. */
const EKEY = (id: string) => '_qe_' + id;
/**
 * Quest states the engine writes. 'missed' is a closed, terminal state like 'done' (its window passed: the other
 * branch was taken, or the run ended first). It is stored in `state.quests`, so the journal and save see it.
 */
/** The run is over: nothing may stay "in progress" past this event (quests still open close as missed, quietly). */
const RUN_END = 'ending';
/** Min ticks between quest toasts, so they arrive one at a time instead of stacking. */
const TOAST_GAP = 36;
/** Ticks the next toast waits after a news-bearing one (a quest closing, a route choice), so it reads alone. */
const TOAST_ALONE = 150;
/**
 * How a quest reads to the player (journal row, detail card, HUD). `tone` picks the palette: 'missed' is a route
 * the player passed by (indigo / peri, MISSED), 'expired' is a quest the run ended before (softer NEXT TIME).
 */
/** A held quest toast. `kind: 'warn'` is bad news (a quest closing, a hop that closes one): ui may style it apart. */
interface QToast { t: string; reveal?: string; alone?: boolean; kind?: ToastKind; done?: EndingReward }
export type ToastKind = 'good' | 'warn';
/** A quest finished while the run was wrapping up (its toasts were skipped so the ending card stays clean). */
export interface EndingReward { questId: string; name: string; score: number; items: string[]; text: string }
/** What a sector-map hop means for the quest log (quest.routeNote). */
export interface RouteNote {
  kind: 'closes' | 'finishes'; questName: string;
  /** ready-made card line, e.g. 'FINISHES FOLLOW THE CATNIP' (fits `max` chars) */
  text: string;
  /** kind === 'finishes' (kept for ui's existing check) */
  good: boolean;
  /** other quests the same hop finishes / closes (beyond `questName`) */
  more: number;
}
export interface QuestLook {
  state: QuestState; tone: 'locked' | 'active' | 'done' | 'missed' | 'expired';
  /** short pill for the journal row in place of the n/n counter ('' = show the counter) */
  pill: string;
  /** detail card tag */
  tag: string;
  /** one line under the description on the detail card ('' = none) */
  note: string;
  /** reward line drawn dim (done or closed: nothing left to earn this flight) */
  dimReward: boolean;
}
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
  private toastQ: QToast[] = [];
  /**
   * The final sector is cleared (or the ending is up): the run is wrapping up behind an iris and the ending title
   * card, so quest news goes quiet. Rewards are still paid; `endingRewards()` lists them for the ending stats.
   */
  private finale = false;
  private finaleLog: EndingReward[] = [];
  private toastGap = TOAST_GAP;
  /** the sector map just opened: put the cursor on the exit that finishes a quest (once per visit) */
  private mapFresh = false;
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
    g.bus.on('scene:change', (p: any) => {
      this.dlgEngine.onSceneChange(p.from, p.to); this.flushDeferred();
      if (p.to === 'ending') this.wrapUp();
      if (p.to === 'map') { this.mapFresh = true; try { this.routeHeadsUp(); } catch (e) { g.reportError('quest', e); } }
    });
    g.bus.on('game:new', () => { this.dlgEngine.reset(); this.deferred = []; this.toastQ = []; this.unrevealed.clear(); this.touched = {}; this.finale = false; this.finaleLog = []; this.check(); });
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
    if (this.mapFresh && g.state.scene === 'map') { this.mapFresh = false; this.aimMapCursor(); }
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
  private say(t: string, reveal?: string, done?: EndingReward) {
    if (this.inFinale()) { if (reveal) this.unrevealed.delete(reveal); return; }
    this.toastQ.push({ t, reveal, done }); this.flushToasts();
  }
  /** News that must not be buried (a quest closing, a route choice): jumps the queue and is read alone. */
  private sayAlone(t: string, kind?: ToastKind) {
    if (this.inFinale()) return;
    const i = this.toastQ.findIndex(x => !x.alone); const e: QToast = { t, alone: true, kind };
    if (i < 0) this.toastQ.push(e); else this.toastQ.splice(i, 0, e);
    this.flushToasts();
  }
  /** Release held quest toasts one by one once no conversation or sector title card is on screen. */
  private flushToasts() {
    if (!this.toastQ.length || this.g.paused || this.inFinale()) return;
    const g = this.g; const sc = g.state.scene;
    if (sc !== 'play' && sc !== 'bonus' && sc !== 'map') return;
    if (this.dlgEngine.busy()) return;
    if (sc === 'play' && Number(g.mods.world?.titleCard ?? 0) > 0) return;
    if (g.tick - this.toastT < this.toastGap && !g.headless) return;
    this.toastT = g.tick;
    const t = this.toastQ.shift()!;
    if (t.kind) g.mods.ui?.toast(t.t, { kind: t.kind }); else g.mods.ui?.toast(t.t);
    this.toastGap = t.alone ? TOAST_ALONE : TOAST_GAP;
    if (t.reveal) { this.unrevealed.delete(t.reveal); this.touched[t.reveal] = g.tick + 0.5; }
  }
  /** The run is wrapping up: the final sector was cleared, or the ending is set / on screen. */
  private inFinale() { const s = this.g.state; return this.finale || !!s.ending || s.scene === 'ending'; }
  /**
   * The ending scene is up: drop quest toasts still waiting (a completion whose toast never showed is kept in
   * `endingRewards()`), and clear toasts already on screen so nothing stacks over the ending title card.
   */
  private wrapUp() { this.enterFinale(); }
  /**
   * The climax is over (the final Big Cat is down, or the final sector is cleared / the ending is up): quest news
   * goes quiet from here. Completions still waiting for their toast move to `endingRewards()`, and toasts already
   * on screen or parked by ui (`toastPend`, held while a memory card is up) are dropped so nothing stacks over the
   * victory dialogue or the ending title card. Idempotent.
   */
  private enterFinale() {
    this.finale = true;
    for (const x of this.toastQ) if (x.done && !this.finaleLog.some(r => r.questId === x.done!.questId)) this.finaleLog.push(x.done);
    this.toastQ = []; this.unrevealed.clear();
    const ui = this.g.mods.ui; if (!ui) return;
    if (typeof ui.muteToasts === 'function') { const was = !!ui.toastsMuted; ui.muteToasts(true); ui.muteToasts(was); }
    else if (Array.isArray(ui.toasts)) ui.toasts = [];
    // ui parks toasts here while a memory reveal card is up and flushes them the next tick it is not; quest owns
    // this clear for now (docs/core-requests/quest.md, Polish 2 round 2)
    if (Array.isArray(ui.toastPend)) ui.toastPend = [];
  }
  /** True for the area that ends the game (content `ending`). */
  private isEndingArea(id: unknown) { return typeof id === 'string' && !!this.g.content.areas?.find?.(a => a?.id === id)?.ending; }
  /**
   * Quests finished while the run was wrapping up (final sector clear, or whose toast was still waiting when the
   * ending came up): rewards were paid quietly; the ending stats can list them. Not saved (one run's news).
   */
  endingRewards(): EndingReward[] { return this.finaleLog.slice(); }
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
    // clearing a sector that ends the game: whatever this clear finishes is paid quietly (ending stats list it)
    // a fresh sector (e.g. a save loaded after an earlier finale this session) talks again; nothing enters an area
    // between the finale and the ending card, so the ending stats still see this run's quiet rewards
    if (evt === 'area:enter' && this.finale && !this.g.state.ending && this.g.state.scene !== 'ending') { this.finale = false; this.finaleLog = []; }
    if (evt === 'area:clear' && !this.finale && this.isEndingArea(p?.areaId)) this.enterFinale();
    // the final Big Cat going down is the climax: its quests (home_again, big_cats) pay quietly under the victory
    // dialogue instead of stacking QUEST COMPLETE / REWARD toasts over Pom's last lines
    if (evt === 'boss:defeat' && !this.finale) {
      const end = this.g.content.areas?.find?.(a => a?.ending);
      if (this.isEndingArea(this.g.state.areaId) || (end?.boss && p?.bossId === end.boss)) this.enterFinale();
    }
    if (evt === RUN_END) this.enterFinale();
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

  private st(id: string): QuestState { return this.g.state.quests[id] ?? 'locked'; }

  private process(evt: string, p: any) {
    for (const q of this.quests()) {
      try {
        if (this.st(q.id) === 'locked' && this.matches(q.start, evt, p)) this.begin(q);
        // the starting event also counts toward completion when it matches (e.g. first memory of the scrapbook)
        if (this.st(q.id) === 'active' && this.matches(q.complete, evt, p)) this.bump(q);
        else if (this.st(q.id) === 'active') {
          if (q.track && evt === 'memory:get') this.trackStep(q);
          if (evt === RUN_END) this.miss(q, true, true);
          else if (q.expire.some(t => this.matches(t, evt, p))) this.miss(q);
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
    // the gate opens once (more memories after that are scrapbook news, not route news)
    if (have === need && this.g.state.memories.length === need) this.say(`${q.name.toUpperCase()}: ROUTE OPEN!`);
    else if (have < need) this.say(`${q.name.toUpperCase()} ${have}/${need} MEMORIES`);
  }

  /**
   * The quest's window closed (its route was passed by, an `expire` trigger fired, or the run ended): close it
   * gently as 'missed' (no reward, no penalty). Progress is kept so the journal can show how far Pom got.
   * `quiet` skips the toast (the run-end sweep happens behind the ending scene).
   */
  private miss(q: NQuest, quiet = false, runEnd = false) {
    const p = this.progress(q);
    delete this.g.state.inventory[XKEY(q.id)];
    if (runEnd) this.g.state.inventory[EKEY(q.id)] = 1;
    this.unrevealed.delete(q.id);
    this.g.ops.setQuest(q.id, 'missed');
    this.g.bus.emit('quest:progress', { questId: q.id, ...p, missed: true });
    if (!quiet) this.sayAlone(`${q.name.toUpperCase()}: MISSED. NEXT FLIGHT!`, 'warn');
  }
  /** Why a closed quest closed: 'route' (another branch was taken), 'run' (the flight ended first), or null. */
  closedBy(id: string): 'route' | 'run' | null {
    if (!this.missed(id)) return null;
    return this.g.state.inventory[EKEY(id)] ? 'run' : 'route';
  }
  /**
   * Presentation of a quest for the journal and HUD, so no module has to special-case states itself:
   * locked / active / done, 'missed' (route forfeit: MISSED, NEXT FLIGHT) and 'expired' (the run ended first: a
   * softer NOT THIS FLIGHT, since a cozy game should not end on a page of failures).
   */
  look(id: string): QuestLook {
    const state = this.status(id);
    if (state === 'done') return { state, tone: 'done', pill: 'DONE', tag: 'COMPLETE', note: '', dimReward: true };
    if (state === 'active') return { state, tone: 'active', pill: '', tag: 'IN PROGRESS', note: '', dimReward: false };
    if (state === 'missed') {
      return this.closedBy(id) === 'run'
        ? { state, tone: 'expired', pill: 'NEXT TIME', tag: 'NOT THIS FLIGHT', note: 'The flight ended first. It opens again on your next flight.', dimReward: true }
        : { state, tone: 'missed', pill: 'MISSED', tag: 'MISSED: NEXT FLIGHT', note: 'Pom took the other route. Try it on your next flight.', dimReward: true };
    }
    return { state: 'locked', tone: 'locked', pill: '', tag: 'LOCKED', note: '', dimReward: false };
  }

  // ---------------- route choices (sector map) ----------------
  /** Open quests that entering `areaId` would close as missed (the map card warns: 'CLOSES FOLLOW THE CATNIP'). */
  forfeits(areaId: string): NQuest[] {
    const e = { areaId, waveIndex: 0 };
    return this.quests().filter(q => this.status(q.id) === 'active' && q.expire.some(t => t.on === 'area:enter' && matchPayload(t.match, e) && this.holds(t.when)));
  }
  /** Open quests that entering `areaId` would complete (the map card cheers: 'FINISHES FOLLOW THE CATNIP'). */
  completes(areaId: string): NQuest[] {
    const e = { areaId, waveIndex: 0 };
    return this.quests().filter(q => this.status(q.id) === 'active' && q.complete.on === 'area:enter' && matchPayload(q.complete.match, e) && this.holds(q.complete.when)
      && (this.g.state.inventory[PKEY(q.id)] ?? 0) + 1 >= q.complete.count);
  }
  /** A trigger's condition (quiet: a bad condition reads as false, like matches()). */
  private holds(when: unknown) { try { return evalCond(when as any, this.g.state); } catch { return false; } }
  /**
   * What taking the hop to `areaId` means for the quest log, for the sector map's NEXT HOP card, or null when it
   * changes nothing. `kind`: 'finishes' (entering completes an open quest: lime / gold) or 'closes' (entering
   * forfeits one: peri / pink); a hop that does both reports the finish. `questName` is the quest's display name,
   * `text` a ready-made line that fits `max` chars, `more` how many other quests the same hop finishes / closes.
   * Only hops the map can offer matter (gated exits are filtered by world.exitsFrom), so a sealed route never
   * reads FINISHES. Never throws.
   */
  routeNote(areaId: string, max = 40): RouteNote | null {
    if (typeof areaId !== 'string' || !areaId) return null;
    const fit = (verb: string, q: NQuest) => { const s = `${verb} ${q.name.toUpperCase()}`; return s.length > max ? s.slice(0, max) : s; };
    try {
      const c = this.completes(areaId); if (c.length) return { kind: 'finishes', questName: c[0].name, text: fit('FINISHES', c[0]), good: true, more: c.length - 1 };
      const f = this.forfeits(areaId); if (f.length) return { kind: 'closes', questName: f[0].name, text: fit('CLOSES', f[0]), good: false, more: f.length - 1 };
    } catch (e) { this.g.reportError('quest', e); }
    return null;
  }
  /** Index into `exits` the map cursor should start on: the hop that finishes a quest, else one that closes none. */
  preferredExit(exits: { to: string }[]): number {
    if (!Array.isArray(exits) || !exits.length) return 0;
    const fin = exits.findIndex(e => this.completes(e?.to).length > 0); if (fin >= 0) return fin;
    const safe = exits.findIndex(e => this.forfeits(e?.to).length === 0);
    return safe >= 0 && this.exits().some(e => this.forfeits(e.to).length) ? safe : 0;
  }
  private exits(): { to: string }[] {
    const W = this.g.mods.world; return W?.exitsFrom ? W.exitsFrom(this.g.state.areaId) : [];
  }
  /** On the sector map: start the cursor on the hop that finishes a quest (ui resets mapSel to 0 on scene change). */
  private aimMapCursor() {
    const ui = this.g.mods.ui; if (!ui || typeof ui.mapSel !== 'number') return;
    const ex = this.exits(); if (ex.length < 2) return;
    ui.mapSel = this.preferredExit(ex);
  }
  /**
   * Arriving on the sector map in front of a hop that would close an open quest: say so before the choice, not
   * after it. With the route open: 'NEBULA HOP FINISHES <QUEST>' then 'MOON HOP CLOSES <QUEST>'. Still sealed:
   * how many memories it needs, so taking the only hop never comes as a surprise.
   */
  private routeHeadsUp() {
    const ex = this.exits(); if (!ex.length) return;
    // short sector names for a toast that fits: CATNIP NEBULA -> NEBULA, THE LITTER MOON -> MOON
    const areaName = (id: string) => String(this.g.content.areas.find(a => a?.id === id)?.name ?? id).split(',')[0].trim().split(/\s+/).pop()!.toUpperCase();
    for (const q of this.quests()) {
      if (this.status(q.id) !== 'active') continue;
      const lose = ex.filter(e => this.forfeits(e.to).includes(q)); if (!lose.length) continue;
      const win = ex.find(e => this.completes(e.to).includes(q));
      const name = q.name.toUpperCase();
      // the NEXT HOP card already says FINISHES for the hop under the cursor (routeNote, cursor starts there):
      // only the bad news about the other hop is worth a toast
      if (win) this.sayAlone(`${areaName(lose[0].to)} HOP CLOSES ${name}`, 'warn');
      else if (q.track) { const { have, need } = this.progress(q); this.sayAlone(`${name}: SEALED, ${have}/${need} MEMORIES`, 'warn'); }
      else this.sayAlone(`${name}: THIS HOP CLOSES IT`, 'warn');
    }
  }
  /**
   * Quests one flight can reach at most (branch quests on the other branches stay sealed for a replay): the
   * journal header can read 'n/14 THIS FLIGHT' instead of a 17 nobody can reach in one run.
   */
  flightMax(): number {
    const areas = Array.isArray(this.g.content.areas) ? this.g.content.areas : [];
    const byId = new Map(areas.map(a => [a?.id, a]));
    const qs = this.quests();
    const tied = (q: NQuest) => (q.start.on === 'area:enter' && typeof q.start.match?.areaId === 'string') ? q.start.match.areaId as string : null;
    const free = qs.filter(q => !tied(q) || !byId.has(tied(q)!)).length;
    let best = 0; let guard = 0;
    const walk = (id: string, seen: Set<string>) => {
      if (++guard > 5000) return;
      const a = byId.get(id); const exits = (Array.isArray(a?.exits) ? a!.exits : []).filter(e => e?.to && byId.has(e.to) && !seen.has(e.to));
      if (!exits.length) { best = Math.max(best, qs.filter(q => { const t = tied(q); return t && seen.has(t); }).length); return; }
      for (const e of exits) { seen.add(e.to); walk(e.to, seen); seen.delete(e.to); }
    };
    const start = this.g.content.start; if (byId.has(start)) walk(start, new Set([start]));
    return Math.min(qs.length, free + best);
  }
  /** True when a quest was closed as missed (also reads the pre-polish marker on an 'active' quest). */
  missed(id: string) { const s = this.st(id); return s === 'missed' || (s === 'active' && !!this.g.state.inventory[XKEY(id)]); }
  /** Quest status including 'missed' (ui journal / HUD). */
  status(id: string): QuestState { return this.missed(id) ? 'missed' : this.st(id); }

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
    if (st === 'missed') return this.closedBy(nq.id) === 'run' ? 'NOT THIS FLIGHT' : 'NEXT FLIGHT!';
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
    return typeof areaId === 'string' && areaId !== c.start && (!Array.isArray(s.areasCleared) || s.areasCleared.length === 0)
      // the headless bot and tests drive autopilot from fixed sectors and assert on a clean log; the browser
      // autopilot (screenshot tool deep links) gets the seeded log a real pilot would have
      && !(this.g.autopilot && this.g.headless);
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
      // every sector with a Treat Bonanza plays it on the way (whether it is perfect is luck: not seeded)
      if (a.bonus) evts.push({ evt: 'bonus:start', p: { areaId: id, bonusId: a.bonus } });
      evts.push({ evt: 'area:clear', p: { areaId: id } });
    }
    const s = this.g.state; const seeded: string[] = [];
    const hit = (t: NQuest['start'], e: { evt: string; p: any }) => t.on === e.evt && matchPayload(t.match, e.p);
    for (const q of this.quests()) {
      if (this.st(q.id) !== 'locked') continue;
      const i0 = evts.findIndex(e => hit(q.start, e)); if (i0 < 0) continue;
      // its window closed on the way (secret_route on a deep link past the moon) or closes on arriving here
      // (a deep link to the moon): closed already as a route forfeit, no toast. Completing first wins.
      const arrive = { evt: 'area:enter', p: { areaId, waveIndex: 0 } };
      const rest = [...evts.slice(i0), arrive];
      const iDone = rest.findIndex(e => hit(q.complete, e) && q.complete.count <= 1);
      const iGone = rest.findIndex(e => q.expire.some(t => hit(t, e)));
      if (iGone >= 0 && (iDone < 0 || iGone < iDone)) { seeded.push(q.id); this.g.ops.setQuest(q.id, 'missed'); continue; }
      // arriving here counts when the quest is "reach this sector" (a deep link to the nebula finishes the route)
      const n = evts.slice(i0).filter(e => hit(q.complete, e)).length + (q.complete.on === 'area:enter' && hit(q.complete, arrive) ? 1 : 0);
      seeded.push(q.id); this.touched[q.id] = this.g.tick - 1;
      if (n >= q.complete.count && (!q.track || q.complete.on === 'area:enter')) {
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
    delete g.state.inventory[XKEY(nq.id)]; delete g.state.inventory[EKEY(nq.id)];
    g.ops.setQuest(nq.id, 'done');
    for (const f of nq.reward.flags) g.ops.setFlag(f);
    for (const [k, v] of Object.entries(nq.reward.items)) if (v > 0) g.ops.addItem(k, v);
    if (nq.reward.score) g.ops.addScore(nq.reward.score);
    const items = Object.entries(nq.reward.items).filter(([, v]) => v > 0).map(([k, v]) => {
      const it = g.content.items.find(i => i.id === k); return `${it ? it.name.toUpperCase() : k.toUpperCase()}${v > 1 ? ' X' + v : ''}`;
    });
    const parts = [nq.reward.score ? `+${fmt(nq.reward.score)}` : '', ...items].filter(Boolean);
    const rec: EndingReward = { questId: nq.id, name: nq.name, score: nq.reward.score || 0, items, text: parts.join(', ') };
    // the run is wrapping up (final sector cleared / ending): paid quietly, listed for the ending stats instead
    if (this.inFinale()) { if (!this.finaleLog.some(r => r.questId === nq.id)) this.finaleLog.push(rec); return; }
    this.say('QUEST COMPLETE: ' + nq.name.toUpperCase(), undefined, rec);
    if (parts.length) this.say('REWARD ' + parts.join(', '), undefined, rec);
    g.mods.audio?.sfx('quest');
  }

  /** Re-evaluate: quests that start on 'check' (condition-only), and active quests already at their count. */
  check() {
    // saves from before 'missed' was a state: an active quest with the old marker becomes 'missed'
    for (const q of this.quests()) if (this.st(q.id) === 'active' && this.g.state.inventory[XKEY(q.id)]) this.miss(q, true);
    // a save written at the ending (or an old one) never keeps a quest open past the run
    if (this.g.state.ending) for (const q of this.quests()) if (this.st(q.id) === 'active') this.miss(q, true, true);
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
