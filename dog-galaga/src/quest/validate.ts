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

/** Validate one quest entry. Returns the normalized quest, or the reason it was rejected. */
export function normalizeQuest(q: any): { quest: NQuest } | { error: string } {
  if (!q || typeof q !== 'object' || Array.isArray(q)) return { error: 'entry is not an object' };
  if (typeof q.id !== 'string' || !q.id.trim()) return { error: 'missing id' };
  const sp = triggerProblem(q.start, 'start') ?? triggerProblem(q.complete, 'complete');
  if (sp) return { error: sp };
  let count = q.complete.count ?? 1;
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 1) return { error: `complete.count must be a number >= 1 (got ${JSON.stringify(q.complete.count)})` };
  count = Math.floor(count);
  const r = q.reward ?? {};
  if (typeof r !== 'object' || Array.isArray(r)) return { error: 'reward must be an object' };
  if (r.flags !== undefined && (!Array.isArray(r.flags) || r.flags.some((f: any) => typeof f !== 'string' || !f))) return { error: 'reward.flags must be a list of flag names' };
  if (r.items !== undefined && (typeof r.items !== 'object' || Array.isArray(r.items) || Object.values(r.items).some(v => typeof v !== 'number' || !Number.isFinite(v)))) return { error: 'reward.items must map item ids to numbers' };
  if (r.score !== undefined && (typeof r.score !== 'number' || !Number.isFinite(r.score))) return { error: 'reward.score must be a number' };
  if (q.dialogue !== undefined && typeof q.dialogue !== 'string') return { error: 'dialogue must be a dialogue id' };
  return {
    quest: {
      ...q,
      name: typeof q.name === 'string' && q.name.trim() ? q.name : q.id,
      desc: typeof q.desc === 'string' ? q.desc : '',
      start: q.start, complete: { ...q.complete, count },
      reward: { flags: r.flags ?? [], items: r.items ?? {}, score: Math.max(0, r.score ?? 0) },
    },
  };
}

/** Normalize a quest list; rejected entries are passed to `report` and dropped, duplicates keep the first. */
export function normalizeQuests(list: unknown, report: (msg: string) => void): NQuest[] {
  if (!Array.isArray(list)) { report('quest list is not an array; no quests loaded'); return []; }
  const out: NQuest[] = []; const seen = new Set<string>();
  list.forEach((q, i) => {
    const r = normalizeQuest(q);
    const label = `quest ${(q as any)?.id ?? '#' + i}`;
    if ('error' in r) { report(`${label} skipped: ${r.error}`); return; }
    if (seen.has(r.quest.id)) { report(`${label} skipped: duplicate id`); return; }
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
