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
const BLIP_GAP = 4;               // min ticks between 'talk' blips (the sfx is ~6 ticks long)
const OPEN_LOCK = 10;             // ticks after a conversation opens where presses are ignored (stray fire mashing)
const MAX_NODES = 64;             // hard cap per conversation (protects against next-cycles in content)

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
  private pending: { id: string; done?: () => void }[] = [];
  private closing = false;
  constructor(private g: Game) {}

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
        this.g.reportError('quest', `missing dialogue "${id}"`);
        return fallback ? { ...FALLBACK_NODE, id: 'missing:' + id } : null;
      }
      let ok = true;
      try { ok = evalCond(n.when, this.g.state); } catch { ok = false; }
      if (ok) return this.clean(n);
      id = n.next;
    }
    return null;
  }

  busy() { return !!this.dlg || !!this.g.mods.ui?.heldDlg; }

  /**
   * Open a conversation. While another one runs: a conversation nobody waits on (no `done`) is replaced,
   * one with a callback (area outros) is never dropped: the new one queues behind it. `queue` forces queueing.
   * A conversation parked by the pause menu always queues.
   */
  open(nodeId: string, done?: () => void, queue = false) {
    if (typeof nodeId !== 'string' || !nodeId) { this.g.reportError('quest', `bad dialogue id ${JSON.stringify(nodeId)}`); this.safeDone(done); return; }
    if (this.busy()) {
      const cur = this.dlg;
      if (queue || !cur || cur.done) { this.pending.push({ id: nodeId, done }); return; }
      this.g.bus.emit('dialogue:close', { nodeId: cur.src.id });
      this.dlg = null;
    }
    const node = this.resolve(nodeId);
    if (!node) { this.safeDone(done); return; } // every node gated off: nothing to say
    const sc = this.g.state.scene;
    const prev: Scene = sc === 'dialogue' ? 'play' : sc;
    this.dlg = { node, src: node, pages: [], page: 0, prev, done, t: 0, age: 0, chars: 0, acc: 0, wait: 0, lastBlip: -99, nodes: 1 };
    this.setPages(node);
    this.g.setScene('dialogue');
    this.g.bus.emit('dialogue:open', { nodeId: node.id });
  }

  private setPages(src: DialogueDef) {
    const d = this.dlg!; d.src = src; d.pages = paginate(src.text); d.page = 0; this.showPage();
  }
  private showPage() {
    const d = this.dlg!; d.node = { ...d.src, text: d.pages[d.page] ?? '' };
    d.t = 0; d.chars = 0; d.acc = 0; d.wait = 0;
  }

  typing() { const d = this.dlg; return !!d && d.chars < d.node.text.length; }

  /** Confirm press: finish the page if it is still typing, else go to the next page / node / end. */
  advance() {
    const d = this.dlg; if (!d) return;
    if (d.chars < d.node.text.length) { d.chars = d.node.text.length; d.wait = 0; return; }
    if (d.page + 1 < d.pages.length) { d.page++; this.showPage(); return; }
    this.g.bus.emit('dialogue:close', { nodeId: d.src.id });
    const next = d.nodes < MAX_NODES ? this.resolve(d.src.next) : null;
    if (next) { d.nodes++; this.setPages(next); this.g.bus.emit('dialogue:open', { nodeId: next.id }); return; }
    this.finish(true);
  }

  /** Fast-forward the whole open conversation (skip key / pause menu). */
  skipAll() {
    for (let i = 0; i < MAX_NODES * 8 && this.dlg; i++) { this.dlg.chars = 1e9; this.advance(); }
  }

  private finish(restoreScene: boolean) {
    const d = this.dlg; if (!d) return;
    this.dlg = null;
    this.closing = true;
    try { if (restoreScene && this.g.state.scene === 'dialogue') this.g.setScene(d.prev); } finally { this.closing = false; }
    this.safeDone(d.done);
    this.drain();
  }

  private drain() {
    if (this.dlg || !this.pending.length) return;
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
    if (to === 'title' || to === 'recovery' || to === 'ending' || to === 'boot') { this.dlg = null; this.pending = []; return; }
    if (from === 'dialogue' && this.dlg) { this.g.bus.emit('dialogue:close', { nodeId: this.dlg.src.id }); this.finish(false); return; }
    this.drain();
  }

  reset() { this.dlg = null; this.pending = []; }

  update(g: Game) {
    if (!this.dlg && this.pending.length && !g.paused) this.drain();
    const d = this.dlg; if (!d || g.paused || g.state.scene !== 'dialogue') return;
    d.t++; d.age++;
    if (g.autopilot) { this.type(1); if (d.t > 20) this.advance(); return; }
    const I = g.input;
    const press = d.age > OPEN_LOCK && (I.pressed('confirm') || I.pressed('fire'));
    const hold = d.age > OPEN_LOCK && (I.held('confirm') || I.held('fire'));
    if (press) {
      const wasTyping = this.typing();
      this.advance();
      if (!wasTyping) g.mods.audio?.sfx('talk');
      return;
    }
    this.type(hold ? FAST : 1);
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
      if (/[A-Za-z0-9]/.test(ch) && d.age - d.lastBlip >= BLIP_GAP) { d.lastBlip = d.age; this.g.mods.audio?.sfx('talk'); }
      const nextCh = txt[i + 1];
      let p = 0;
      if (ch === '.' && nextCh === '.') p = ELLIPSIS_DOT;
      else if (PAUSE[ch] !== undefined && (nextCh === undefined || nextCh === ' ' || nextCh === '"' || nextCh === "'")) p = ch === '-' ? (nextCh === ' ' ? PAUSE[ch] : 0) : PAUSE[ch];
      if (p && d.chars < txt.length) { d.wait = p; d.acc = 0; break; }
    }
  }
}
