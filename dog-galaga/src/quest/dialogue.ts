import type { Game } from '../core/game';
import type { DialogueDef, Scene } from '../core/types';
import { evalCond } from '../core/conditions';
import { wrap } from '../art/font';

/** Dialogue box text layout (ui draws the box; the engine pages text so nothing is ever cut off). */
export const DLG_COLS = 51;
export const DLG_ROWS = 3;

/** Typewriter timing, in 60 Hz ticks. */
const CPS = 0.72;                 // characters per tick (~43 cps): readable, still brisk
const FAST = 4;                   // speed multiplier while fire/confirm is held
const PAUSE: Record<string, number> = { '.': 9, '!': 9, '?': 9, ',': 4, ';': 5, ':': 5, '-': 3 };
const ELLIPSIS_DOT = 5;           // each dot of "..." lands one beat at a time
const OPEN_LOCK = 10;             // ticks after a conversation opens where presses are ignored (stray fire mashing)
const CLOSE_HOLD = 40;            // max ticks the closing press is held back from play (so it never fires a turd)
const CARD_GATE = 8;              // an area briefing opens once the world's sector title card is down to this many ticks
const CARD_MAX = 200;             // never wait on a title card longer than this
const MAX_NODES = 64;             // hard cap per conversation (protects against next-cycles in content)

/**
 * Speaker voices: every character gets their own 'talk' blip (passed to audio.sfx('talk', {voice, pitch})).
 * `gap` is the minimum number of ticks between blips, so a gruff voice talks in slower, heavier syllables.
 */
export interface Voice { voice: 'gruff' | 'bright' | 'meow' | 'regal' | 'plain'; pitch: number; gap: number }
const VOICES: [RegExp, Voice][] = [
  [/biscuit|bulldog|commander/i, { voice: 'gruff', pitch: 0.62, gap: 6 }],
  [/pom|poodle/i, { voice: 'bright', pitch: 1.26, gap: 4 }],
  [/empress|fluffington|queen|duchess|madame/i, { voice: 'regal', pitch: 0.9, gap: 5 }],
  [/cat|tom|whisk|sal|mau|patches|sphynx|siamese|tabby|kitty|admiral|ace|kingpin|fold|mainsail|blue/i, { voice: 'meow', pitch: 1.08, gap: 5 }],
  [/pup|puppy/i, { voice: 'bright', pitch: 1.5, gap: 4 }],
];
const PLAIN: Voice = { voice: 'plain', pitch: 1, gap: 5 };
/** Voice for a speaker (matched on speaker name, then portrait id). */
export function voiceFor(node: { speaker?: string; portrait?: string }): Voice {
  const key = `${node.speaker ?? ''}|${node.portrait ?? ''}`;
  for (const [re, v] of VOICES) if (re.test(key)) return v;
  return PLAIN;
}
/**
 * Should typing character i of `txt` blip? Only letters and digits speak, a doubled letter ("woof", "Pommm")
 * does not repeat the syllable, and the voice's gap keeps the rhythm to words rather than a machine-gun buzz.
 */
export function blipAt(txt: string, i: number): boolean {
  const ch = txt[i]; if (!ch || !/[A-Za-z0-9]/.test(ch)) return false;
  return i === 0 || txt[i - 1].toLowerCase() !== ch.toLowerCase();
}

/** A missing or broken node never crashes: Pom fills the gap herself. */
export const FALLBACK_NODE: DialogueDef = {
  id: 'missing', speaker: 'Captain Pom', portrait: 'portrait_pom',
  text: "Huh. I was about to say something important... it's gone. Probably a squirrel. Onward!",
};

/** What ui reads each frame: `node` is the current page (speaker, portrait, page text), `chars` how much is typed. */
export interface DlgState {
  node: DialogueDef;
  src: DialogueDef;
  pages: string[]; page: number;
  prev: Scene;
  done?: () => void;
  /** ticks on this page / since the conversation opened */
  t: number; age: number;
  chars: number;
  acc: number; wait: number; lastBlip: number;
  nodes: number;
  /** speaker voice of the current node */
  voice: Voice;
}

/** Split text into pages of DLG_ROWS wrapped lines. Page text is the lines rejoined, so ui's re-wrap is identical. */
export function paginate(text: string, cols = DLG_COLS, rows = DLG_ROWS): string[] {
  const lines = wrap(text, cols);
  // a single word longer than a line: hard-split it so it cannot overflow the box
  const fixed: string[] = [];
  for (const l of lines) { if (l.length <= cols) fixed.push(l); else for (let i = 0; i < l.length; i += cols) fixed.push(l.slice(i, i + cols)); }
  if (!fixed.length) return [''];
  const pages: string[] = [];
  for (let i = 0; i < fixed.length; i += rows) pages.push(fixed.slice(i, i + rows).join(' '));
  return pages;
}

/** Wrapped lines of `text` with only the first `chars` characters visible. Words never jump lines while typing. */
export function revealLines(text: string, chars: number, cols = DLG_COLS, rows = DLG_ROWS): string[] {
  const out: string[] = []; let left = Math.floor(chars);
  for (const l of wrap(text, cols).slice(0, rows)) {
    if (left <= 0) break;
    out.push(l.slice(0, left)); left -= l.length + 1;
  }
  return out;
}

export class DialogueEngine {
  dlg: DlgState | null = null;
  /**
   * A briefing waiting for the sector title card to finish (scene is already 'dialogue', so the world holds its
   * intro timer and the player stays put, but nothing is drawn over the card). Promoted to `dlg` in update().
   */
  staged: { node: DialogueDef; prev: Scene; done?: () => void; t: number } | null = null;
  /** The last page was closed by a press that is still held: play resumes once fire/confirm is released. */
  releasing: { d: DlgState; t: number } | null = null;
  private pending: { id: string; done?: () => void }[] = [];
  private closing = false;
  /** `issue` reports content problems quietly (no crash toast); see Quest.issue. */
  constructor(private g: Game, private issue: (file: string, msg: string) => void = (_f, m) => g.reportError('quest', m)) {}

  /** Sanitize a content node so ui can always draw it. */
  private clean(n: any): DialogueDef {
    if (!n || typeof n !== 'object') return FALLBACK_NODE;
    const text = typeof n.text === 'string' && n.text.trim() ? n.text : FALLBACK_NODE.text;
    return { ...n, id: String(n.id ?? 'node'), speaker: typeof n.speaker === 'string' && n.speaker ? n.speaker : '???', portrait: typeof n.portrait === 'string' ? n.portrait : '', text };
  }

  /** Follow `next` links from `id`, skipping nodes whose `when` fails. Missing ids yield the fallback node. */
  resolve(id: string | undefined, fallback = true): DialogueDef | null {
    let guard = 0;
    while (id && guard++ < MAX_NODES) {
      const n = this.g.content.dialogue.find(d => d && d.id === id);
      if (!n) {
        this.issue('dialogue', `missing dialogue "${id}"`);
        return fallback ? { ...FALLBACK_NODE, id: 'missing:' + id } : null;
      }
      let ok = true;
      try { ok = evalCond(n.when, this.g.state); } catch { ok = false; }
      if (ok) return this.clean(n);
      id = n.next;
    }
    return null;
  }

  busy() { return !!this.dlg || !!this.staged || !!this.releasing || !!this.g.mods.ui?.heldDlg; }

  /** Ticks left on the world's sector title card (0 when there is none). */
  private card(): number { const c = Number(this.g.mods.world?.titleCard ?? 0); return Number.isFinite(c) ? c : 0; }

  /**
   * Open a conversation. While another one runs: a conversation nobody waits on (no `done`) is replaced,
   * one with a callback (area outros) is never dropped: the new one queues behind it. `queue` forces queueing.
   * A conversation parked by the pause menu always queues.
   */
  open(nodeId: string, done?: () => void, queue = false) {
    if (typeof nodeId !== 'string' || !nodeId) { this.issue('dialogue', `bad dialogue id ${JSON.stringify(nodeId)}`); this.safeDone(done); return; }
    if (this.busy()) {
      const cur = this.dlg ?? this.staged;
      if (queue || !cur || cur.done || this.releasing) { this.pending.push({ id: nodeId, done }); return; }
      if (this.dlg) this.g.bus.emit('dialogue:close', { nodeId: this.dlg.src.id });
      this.dlg = null; this.staged = null;
    }
    const node = this.resolve(nodeId);
    if (!node) { this.safeDone(done); return; } // every node gated off: nothing to say
    const sc = this.g.state.scene;
    const prev: Scene = sc === 'dialogue' ? 'play' : sc;
    // one thing to read at a time: a briefing waits for the sector title card (the bot never waits)
    if (!this.g.autopilot && sc === 'play' && this.card() > CARD_GATE) {
      this.staged = { node, prev, done, t: 0 };
      this.g.setScene('dialogue');
      return;
    }
    this.show(node, prev, done);
  }

  private show(node: DialogueDef, prev: Scene, done?: () => void) {
    this.dlg = { node, src: node, pages: [], page: 0, prev, done, t: 0, age: 0, chars: 0, acc: 0, wait: 0, lastBlip: -99, nodes: 1, voice: voiceFor(node) };
    this.setPages(node);
    if (this.g.state.scene !== 'dialogue') this.g.setScene('dialogue');
    this.g.bus.emit('dialogue:open', { nodeId: node.id });
  }

  /** The reader asked to go on: shorten the sector title card to its last fade-out frames. */
  private cutCard() {
    const W = this.g.mods.world; if (!W || !Number.isFinite(Number(W.titleCard))) return;
    if (W.titleCard > CARD_GATE) W.titleCard = CARD_GATE;
  }

  /** A briefing is waiting behind the sector title card. */
  isStaged() { return !!this.staged; }

  /** Promote a staged briefing now (title card done, a skip, a press, a pause, or any caller asking for `dlg`). */
  unstage() {
    const s = this.staged; if (!s) return;
    this.staged = null; this.show(s.node, s.prev, s.done);
  }

  private setPages(src: DialogueDef) {
    const d = this.dlg!; d.src = src; d.voice = voiceFor(src); d.pages = paginate(src.text); d.page = 0; this.showPage();
  }
  private showPage() {
    const d = this.dlg!; d.node = { ...d.src, text: d.pages[d.page] ?? '' };
    d.t = 0; d.chars = 0; d.acc = 0; d.wait = 0;
  }

  typing() { const d = this.dlg; return !!d && d.chars < d.node.text.length; }

  /** Confirm press: finish the page if it is still typing, else go to the next page / node / end. */
  advance() {
    if (!this.dlg && this.staged) { this.unstage(); return; }
    const d = this.dlg; if (!d) return;
    if (d.chars < d.node.text.length) { d.chars = d.node.text.length; d.wait = 0; return; }
    if (d.page + 1 < d.pages.length) { d.page++; this.showPage(); return; }
    this.g.bus.emit('dialogue:close', { nodeId: d.src.id });
    const next = d.nodes < MAX_NODES ? this.resolve(d.src.next) : null;
    if (next) { d.nodes++; this.setPages(next); this.g.bus.emit('dialogue:open', { nodeId: next.id }); return; }
    // the press that closed the last page must not reach play (Space is fire AND confirm): hold the scene
    // until it is released, so Pom never toots on her first frame back
    const I = this.g.input;
    if (!this.g.autopilot && (I?.held('fire') || I?.held('confirm'))) { this.dlg = null; this.releasing = { d, t: 0 }; return; }
    this.finish(true);
  }

  /** Fast-forward the whole open conversation (skip key / pause menu), including a briefing still waiting on the title card. */
  skipAll() {
    if (this.staged) this.unstage();
    for (let i = 0; i < MAX_NODES * 8 && this.dlg; i++) { this.dlg.chars = 1e9; this.advance(); }
    if (this.releasing) this.finish(true);
  }

  private finish(restoreScene: boolean) {
    const d = this.dlg ?? this.releasing?.d ?? null; if (!d) return;
    this.dlg = null; this.releasing = null;
    this.closing = true;
    try { if (restoreScene && this.g.state.scene === 'dialogue') this.g.setScene(d.prev); } finally { this.closing = false; }
    this.safeDone(d.done);
    this.drain();
  }

  private drain() {
    if (this.dlg || this.staged || this.releasing || !this.pending.length) return;
    const sc = this.g.state.scene;
    if (sc !== 'play' && sc !== 'map' && sc !== 'dialogue' && sc !== 'bonus') return; // wait for a scene that can host it
    const nx = this.pending.shift()!; this.open(nx.id, nx.done);
  }

  private safeDone(done?: () => void) {
    if (!done) return;
    try { done(); } catch (e) { this.g.reportError('quest', e); }
  }

  /** Scene moved away from 'dialogue' without us: abort to menus silently, otherwise end as if skipped. */
  onSceneChange(from: Scene, to: Scene) {
    if (this.closing) return;
    if (to === 'dialogue') return;
    if (to === 'title' || to === 'recovery' || to === 'ending' || to === 'boot') { this.reset(); return; }
    if (from === 'dialogue' && this.staged) { const s = this.staged; this.staged = null; this.safeDone(s.done); this.drain(); return; }
    if (from === 'dialogue' && this.releasing) { this.finish(false); return; }
    if (from === 'dialogue' && this.dlg) { this.g.bus.emit('dialogue:close', { nodeId: this.dlg.src.id }); this.finish(false); return; }
    this.drain();
  }

  reset() { this.dlg = null; this.staged = null; this.releasing = null; this.pending = []; }

  update(g: Game) {
    if (!this.busy() && this.pending.length && !g.paused) this.drain();
    if (g.paused || g.state.scene !== 'dialogue') return;
    if (this.releasing) {
      const r = this.releasing; r.t++;
      if (!(g.input.held('fire') || g.input.held('confirm')) || r.t >= CLOSE_HOLD || g.autopilot) this.finish(true);
      return;
    }
    if (this.staged) {
      // the reader is in charge even while the sector card plays: back skips the whole briefing, confirm / fire /
      // a playfield tap ("got it") drops the card and opens the briefing now. Pause is ui's: reading `quest.dlg`
      // promotes the staged briefing, so the pause menu parks it ('BRIEFING ON HOLD', SKIP BRIEFING).
      const I = g.input;
      if (!g.autopilot && I?.pressed('back')) { this.skipAll(); return; }
      if (!g.autopilot && (I?.pressed('confirm') || I?.pressed('fire'))) { this.cutCard(); this.unstage(); return; }
      if (g.autopilot || this.card() <= CARD_GATE || ++this.staged.t > CARD_MAX) this.unstage();
      return;
    }
    const d = this.dlg; if (!d) return;
    d.t++; d.age++;
    if (g.autopilot) { this.type(1); if (d.t > 20) this.advance(); return; }
    const I = g.input;
    const press = d.age > OPEN_LOCK && (I.pressed('confirm') || I.pressed('fire'));
    const hold = d.age > OPEN_LOCK && (I.held('confirm') || I.held('fire'));
    if (press) {
      const wasTyping = this.typing();
      this.advance();
      if (!wasTyping) this.blip(d, 1);
      return;
    }
    this.type(hold ? FAST : 1);
  }

  /** One 'talk' syllable in the speaker's voice; a small per-letter pitch wobble keeps it from sounding like a beep. */
  private blip(d: DlgState, code: number) {
    if (this.quiet) return;
    const v = d.voice; const pitch = +(v.pitch * (1 + ((code % 5) - 2) * 0.035)).toFixed(3);
    this.g.mods.audio?.sfx('talk', { voice: v.voice, pitch });
  }
  /** Silences blips (showcase staging fast-forwards typing without a burst of sound). */
  quiet = false;

  /**
   * Showcase/tool staging: open `id` and play `at` ticks of a reader who lets every page type out and presses
   * confirm ~45 ticks after it finishes, so stills can show typing in progress, a punctuation pause, a second page.
   * `at` undefined shows the first page fully typed.
   */
  stage(id: string | DialogueDef, at?: number) {
    this.reset();
    if (typeof id === 'string') this.open(id);
    else { const sc = this.g.state.scene; this.show(this.clean(id), sc === 'dialogue' ? 'play' : sc); }
    if (this.staged) this.unstage();
    const d0 = this.dlg; if (!d0) return null;
    if (at === undefined || !Number.isFinite(at)) { d0.chars = d0.node.text.length; return d0; }
    this.quiet = true;
    try {
      let idle = 0;
      for (let i = 0; i < at && this.dlg; i++) {
        const d = this.dlg; d.t++; d.age++;
        if (d.chars >= d.node.text.length) { if (++idle >= 45) { idle = 0; this.advance(); } }
        else this.type(1);
      }
    } finally { this.quiet = false; }
    return this.dlg;
  }

  /** Reveal characters with punctuation pauses and throttled per-character blips. */
  private type(mult: number) {
    const d = this.dlg!; const txt = d.node.text;
    if (d.chars >= txt.length) return;
    if (d.wait > 0) { d.wait -= mult; if (d.wait > 0) return; }
    d.acc += CPS * mult;
    while (d.acc >= 1 && d.chars < txt.length) {
      d.acc--;
      const i = Math.floor(d.chars); const ch = txt[i]; d.chars = i + 1;
      if (blipAt(txt, i) && d.age - d.lastBlip >= d.voice.gap) { d.lastBlip = d.age; this.blip(d, ch.charCodeAt(0)); }
      const nextCh = txt[i + 1];
      let p = 0;
      if (ch === '.' && nextCh === '.') p = ELLIPSIS_DOT;
      else if (PAUSE[ch] !== undefined && (nextCh === undefined || nextCh === ' ' || nextCh === '"' || nextCh === "'")) p = ch === '-' ? (nextCh === ' ' ? PAUSE[ch] : 0) : PAUSE[ch];
      if (p && d.chars < txt.length) { d.wait = p; d.acc = 0; break; }
    }
  }
}
