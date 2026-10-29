import type { QuestDef, Trigger } from '../core/types';

/**
 * Quest content hardening. Every quest entry from content/quests.json passes through `normalizeQuests`
 * before the engine sees it: malformed entries are skipped with a readable reason (reported once by the
 * caller), well-formed ones come back with defaults filled in (count 1, empty reward lists).
 */
export interface NQuest extends QuestDef {
  start: Trigger;
  complete: Trigger & { count: number };
  reward: { flags: string[]; items: Record<string, number>; score: number };
  /** optional: events that close the quest as missed (e.g. taking the other branch past a secret exit) */
  expire: Trigger[];
  /** optional: a state goal shown as progress while the completion event has not happened yet */
  track: { memories: number } | null;
  /** how `expire` / `track` / count were filled in: 'content' or a note when the engine derived them */
  derived: string[];
}

const COND_KEYS = ['flag', 'notFlag', 'quest', 'item', 'cleared', 'memories', 'all', 'any', 'not'];
const QSTATES = ['locked', 'active', 'done'];

/** Returns a reason string when the condition is malformed, or null when it is fine. */
export function condProblem(c: unknown, depth = 0): string | null {
  if (c === undefined) return null;
  if (depth > 16) return 'condition nested too deep';
  if (!c || typeof c !== 'object' || Array.isArray(c)) return 'condition must be an object';
  const a = c as any; const k = COND_KEYS.find(k => k in a);
  if (!k) return `unknown condition ${JSON.stringify(c).slice(0, 60)}`;
  switch (k) {
    case 'flag': case 'notFlag': case 'cleared': return typeof a[k] === 'string' && a[k] ? null : `"${k}" must be a non-empty string`;
    case 'quest': return typeof a.quest === 'string' && QSTATES.includes(a.is) ? null : '"quest" condition needs a quest id and is: locked|active|done';
    case 'item': return typeof a.item === 'string' && Number.isFinite(a.min) ? null : '"item" condition needs an item id and a numeric min';
    case 'memories': return Number.isFinite(a.memories) ? null : '"memories" must be a number';
    case 'all': case 'any': {
      if (!Array.isArray(a[k])) return `"${k}" must be an array of conditions`;
      for (const x of a[k]) { const p = condProblem(x, depth + 1); if (p) return p; }
      return null;
    }
    case 'not': return a.not === undefined ? '"not" needs a condition' : condProblem(a.not, depth + 1);
  }
  return null;
}

function triggerProblem(t: any, what: string): string | null {
  if (!t || typeof t !== 'object' || Array.isArray(t)) return `${what} must be an object`;
  if (typeof t.on !== 'string' || !t.on.trim()) return `${what}.on must name an event`;
  if (t.match !== undefined) {
    if (!t.match || typeof t.match !== 'object' || Array.isArray(t.match)) return `${what}.match must be an object`;
    for (const [k, v] of Object.entries(t.match)) if (!['string', 'number', 'boolean'].includes(typeof v)) return `${what}.match.${k} must be a string, number or boolean`;
  }
  const c = condProblem(t.when); if (c) return `${what}.when: ${c}`;
  return null;
}

/**
 * Validate one quest entry. The entry is skipped (error) only when it cannot work at all: not an object, no id,
 * or an unusable start / complete trigger. Every other bad field falls back field by field (a bad reward score
 * becomes 0, a bad item count is dropped, a bad count becomes 1, ...) and is listed in `warnings`, so a typo in
 * a reward never deletes a quest from the game.
 */
export function normalizeQuest(q: any): { quest: NQuest; warnings: string[] } | { error: string } {
  if (!q || typeof q !== 'object' || Array.isArray(q)) return { error: 'entry is not an object' };
  if (typeof q.id !== 'string' || !q.id.trim()) return { error: 'missing id' };
  const sp = triggerProblem(q.start, 'start') ?? triggerProblem(q.complete, 'complete');
  if (sp) return { error: sp };
  const warnings: string[] = [];
  let count = q.complete.count ?? 1;
  if (typeof count === 'string' && count.trim() && Number.isFinite(+count)) count = +count;
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 1) { warnings.push(`complete.count ${JSON.stringify(q.complete.count)} is not a number >= 1; using 1`); count = 1; }
  count = Math.floor(count);
  let r = q.reward ?? {};
  if (!r || typeof r !== 'object' || Array.isArray(r)) { warnings.push('reward is not an object; no reward'); r = {}; }
  let flags: string[] = [];
  if (r.flags !== undefined) {
    const list = Array.isArray(r.flags) ? r.flags : typeof r.flags === 'string' ? [r.flags] : null;
    if (!list) warnings.push('reward.flags is not a list of flag names; dropped');
    else { flags = list.filter((f: any) => typeof f === 'string' && f.trim()); if (flags.length !== list.length) warnings.push('reward.flags: non-string entries dropped'); }
  }
  const items: Record<string, number> = {};
  if (r.items !== undefined) {
    if (!r.items || typeof r.items !== 'object' || Array.isArray(r.items)) warnings.push('reward.items is not a map of item ids to counts; dropped');
    else for (const [k, v] of Object.entries(r.items)) {
      const n = typeof v === 'string' && v.trim() ? +v : v;
      if (typeof n === 'number' && Number.isFinite(n) && n >= 1) items[k] = Math.floor(n);
      else warnings.push(`reward.items.${k} = ${JSON.stringify(v)} is not a count >= 1; dropped`);
    }
  }
  let score = 0;
  if (r.score !== undefined) {
    const n = typeof r.score === 'string' && r.score.trim() ? +r.score : r.score;
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) score = Math.round(n);
    else warnings.push(`reward.score ${JSON.stringify(r.score)} is not a number >= 0; using 0`);
  }
  let dialogue: string | undefined;
  if (q.dialogue !== undefined) { if (typeof q.dialogue === 'string' && q.dialogue) dialogue = q.dialogue; else warnings.push('dialogue is not a dialogue id; dropped'); }
  const ex0 = q.expire === undefined ? [] : Array.isArray(q.expire) ? q.expire : [q.expire];
  const ex: Trigger[] = [];
  ex0.forEach((t: any, i: number) => { const e = triggerProblem(t, `expire[${i}]`); if (e) warnings.push(`${e}; dropped`); else ex.push(t); });
  let track: NQuest['track'] = null;
  if (q.track !== undefined) {
    if (!q.track || typeof q.track !== 'object' || !Number.isFinite(q.track.memories) || q.track.memories < 1) warnings.push('track must be {"memories": N} with N >= 1; dropped');
    else track = { memories: Math.floor(q.track.memories) };
  }
  if (q.name !== undefined && (typeof q.name !== 'string' || !q.name.trim())) warnings.push('name is not a string; using the id');
  const quest: NQuest = {
    ...q,
    name: typeof q.name === 'string' && q.name.trim() ? q.name : q.id,
    desc: typeof q.desc === 'string' ? q.desc : '',
    start: q.start, complete: { ...q.complete, count },
    reward: { flags, items, score },
    expire: ex, track, derived: [],
  };
  if (dialogue === undefined) delete (quest as any).dialogue; else quest.dialogue = dialogue;
  return { quest, warnings };
}

/**
 * Normalize a quest list. Unusable entries are reported and dropped, duplicates keep the first; field-level
 * fallbacks are reported too (the quest stays in the game).
 */
export function normalizeQuests(list: unknown, report: (msg: string) => void): NQuest[] {
  if (!Array.isArray(list)) { report('quest list is not an array; no quests loaded'); return []; }
  const out: NQuest[] = []; const seen = new Set<string>();
  list.forEach((q, i) => {
    const r = normalizeQuest(q);
    const label = `quest ${(q as any)?.id ?? '#' + i}`;
    if ('error' in r) { report(`${label} skipped: ${r.error}`); return; }
    if (seen.has(r.quest.id)) { report(`${label} skipped: duplicate id`); return; }
    for (const w of r.warnings) report(`${label}: ${w}`);
    seen.add(r.quest.id); out.push(r.quest);
  });
  return out;
}

/** Does an event payload satisfy a trigger's `match` filter? Numbers and numeric strings compare loosely. */
export function matchPayload(match: Trigger['match'], p: any): boolean {
  if (!match) return true;
  for (const [k, v] of Object.entries(match)) {
    const pv = p?.[k];
    if (pv === v) continue;
    if ((typeof v === 'number' || typeof pv === 'number') && pv !== undefined && pv !== null && String(pv) === String(v)) continue;
    return false;
  }
  return true;
}

/** The memory threshold inside an exit condition ({memories: N}, possibly nested in all/any), or 0. */
function memGate(c: any, depth = 0): number {
  if (!c || typeof c !== 'object' || depth > 8) return 0;
  if (Number.isFinite(c.memories)) return Math.max(0, Math.floor(c.memories));
  for (const k of ['all', 'any']) if (Array.isArray(c[k])) for (const x of c[k]) { const n = memGate(x, depth + 1); if (n) return n; }
  return 0;
}

/**
 * Keep quest content honest against the sector graph (quests.json and areas.json are edited separately):
 * - "clear every wave in X" (wave:clear matching an areaId, "every"/"all" in the text or a count above half
 *   of X's waves) becomes `area:clear` of X, so the boss stage the HUD counts is included; a smaller count
 *   is capped at X's wave total (both noted in `derived`).
 * - "reach X" (area:enter matching an areaId) where X sits behind a gated exit: the gate's memory threshold
 *   becomes visible progress (`track`), and entering any sibling exit of the gate closes the quest as missed.
 * Explicit `track` / `expire` in content always win.
 */
export function deriveQuest(q: NQuest, areas: { id: string; waves?: unknown[]; exits?: { to: string; when?: unknown }[] }[]): NQuest {
  const out: NQuest = { ...q, complete: { ...q.complete }, expire: [...q.expire], derived: [...q.derived] };
  const aid = out.complete.match?.areaId;
  if (typeof aid !== 'string') return out;
  if (out.complete.on === 'wave:clear') {
    const a = areas.find(x => x?.id === aid); const n = Array.isArray(a?.waves) ? a!.waves!.length : 0;
    // "clear every wave in X": the HUD counts X's boss stage as a wave too, so the only honest finish line is
    // clearing the whole sector. Anything that asks for most of the sector's waves means the same thing.
    if (n > 0 && (/\b(every|all)\b/i.test(`${q.desc} ${q.name}`) || out.complete.count * 2 > n)) {
      out.derived.push(`wave:clear x${out.complete.count} -> area:clear (whole sector ${aid}, boss stage included)`);
      out.complete = { ...out.complete, on: 'area:clear', match: { areaId: aid }, count: 1 };
    } else if (n > 0 && out.complete.count > n) { out.derived.push(`count ${out.complete.count} -> ${n} (waves in ${aid})`); out.complete.count = n; }
  }
  if (out.complete.on === 'area:enter') {
    for (const src of areas) {
      const ex = Array.isArray(src?.exits) ? src.exits : [];
      const gate = ex.find(e => e?.to === aid && e.when !== undefined); if (!gate) continue;
      const n = memGate(gate.when);
      if (n && !out.track) { out.track = { memories: n }; out.derived.push(`track memories ${n} (gate ${src.id} -> ${aid})`); }
      if (!q.expire.length) for (const e of ex) if (e?.to && e.to !== aid) { out.expire.push({ on: 'area:enter', match: { areaId: e.to } }); out.derived.push(`expire on entering ${e.to}`); }
    }
  }
  return out;
}
