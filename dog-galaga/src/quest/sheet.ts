import type { Game } from '../core/game';
import { PF_X, PF_W, H } from '../core/game';
import type { DialogueDef } from '../core/types';
import { text, textWidth } from '../art/font';
import { C, rect, chamferFill, dither } from '../ui/draw';
import type { DlgState, DialogueEngine } from './dialogue';

/** One reviewable state of the dialogue engine: a frozen conversation snapshot plus what it demonstrates. */
export interface SheetSlot { tag: string; d: DlgState }

/** ui draws its comm panel with its top edge (backing strip) at this y; slots are translated from there. */
const BOX_TOP = H - 62 - 1 - 2;
const BOX_H = 65;

const PAGED: DialogueDef = {
  id: 'sheet-paged', speaker: 'Commander Biscuit', portrait: 'portrait_biscuit',
  text: 'Listen up, Captain. The Armada has the whole block wrapped around its little paws: the squeaky toys, the tennis balls, ' +
    "even Mrs. Alvarez's garden gnome. When a speech runs long, the box turns the page for you, so no line is ever cut off. " +
    'Now get up there and show those cats who is a good girl.',
};

/** Play `id` forward one tick at a time until `pred` holds (or `max` ticks), returning that snapshot. */
function stageUntil(E: DialogueEngine, id: string | DialogueDef, pred: (d: DlgState) => boolean, max = 400): DlgState | null {
  for (let at = 1; at <= max; at++) { const d = E.stage(id, at); if (!d) return null; if (pred(d)) return d; }
  return E.stage(id, max);
}

/**
 * Build the review sheet: the voices (gruff Biscuit, bright Pom, regal Empress), typing in progress, a
 * punctuation pause, a finished page waiting on NEXT, the second page of a long node, and the friendly
 * fallback for a missing id. Each snapshot is detached from the engine, which is left idle.
 */
export function buildSheet(g: Game, E: DialogueEngine): SheetSlot[] {
  const out: SheetSlot[] = [];
  const has = (id: string) => g.content.dialogue.some(d => d && d.id === id);
  const pick = (re: RegExp) => g.content.dialogue.find(d => d && re.test(`${d.speaker} ${d.portrait ?? ''}`))?.id;
  const gruff = has('intro-backyard-1') ? 'intro-backyard-1' : pick(/biscuit/i);
  const bright = has('intro-backyard-2') ? 'intro-backyard-2' : pick(/pom/i);
  const regal = has('outro-mothership-1') ? 'outro-mothership-1' : pick(/empress|regal|queen/i);
  if (gruff) { const d = E.stage(gruff, 110); if (d) out.push({ tag: `GRUFF VOICE: TYPING ${Math.floor(d.chars)}/${d.node.text.length}`, d }); }
  if (bright) { const d = E.stage(bright); if (d) out.push({ tag: 'BRIGHT VOICE: PAGE DONE, NEXT', d }); }
  if (regal) {
    const d = stageUntil(E, regal, x => x.wait > 0 && /[,.!?]/.test(x.node.text[Math.floor(x.chars) - 1] ?? ''));
    if (d) out.push({ tag: 'REGAL VOICE: PUNCTUATION BEAT', d });
  }
  { const d = stageUntil(E, PAGED, x => x.page === 1 && x.chars > 24); if (d) out.push({ tag: `LONG LINE: PAGE ${d.page + 1}/${d.pages.length}, TYPING`, d }); }
  { const d = E.stage('sheet-missing-id'); if (d) out.push({ tag: 'MISSING ID: FRIENDLY FALLBACK', d }); }
  E.reset();
  return out;
}

/** Draw the sheet over the playfield: ui's own comm panel for each slot, stacked, with a small tag each. */
export function drawSheet(g: Game, ctx: CanvasRenderingContext2D, slots: SheetSlot[], E: DialogueEngine) {
  const ui = g.mods.ui; if (!ui?.dialogueBox) return;
  rect(ctx, PF_X, 0, PF_W, H, C.ink);
  dither(ctx, PF_X, 0, PF_W, H, C.night, 'sparse');
  const gap = 2; const top = Math.max(12, H - slots.length * (BOX_H + gap));
  text(ctx, 'DIALOGUE ENGINE', PF_X + 8, Math.max(2, top - 10), C.gold, { shadow: C.night });
  const held = E.dlg;
  try {
    slots.forEach((s, i) => {
      const y = top + i * (BOX_H + gap);
      E.dlg = s.d;
      ctx.save(); ctx.translate(0, y - BOX_TOP);
      try { ui.dialogueBox(g, ctx, 'bottom'); } finally { ctx.restore(); }
      // state tag, bottom right inside the panel (below the third text line, left of the NEXT arrow)
      const tw = textWidth(s.tag) + 8; const tx = PF_X + PF_W - 22 - tw; const ty = y + BOX_H - 12;
      chamferFill(ctx, tx, ty, tw, 9, C.indigo, 2);
      text(ctx, s.tag, tx + 4, ty + 1, C.gold);
    });
  } finally { E.dlg = held; }
}
