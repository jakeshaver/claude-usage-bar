import type { Condition, GameState } from './types';
export function evalCond(c: Condition | undefined, s: GameState): boolean {
  if (!c) return true;
  const a: any = c;
  if ('flag' in a) return !!s.flags[a.flag];
  if ('notFlag' in a) return !s.flags[a.notFlag];
  if ('quest' in a) return (s.quests[a.quest] ?? 'locked') === a.is;
  if ('item' in a) return (s.inventory[a.item] ?? 0) >= a.min;
  if ('cleared' in a) return s.areasCleared.includes(a.cleared);
  if ('memories' in a) return s.memories.length >= a.memories;
  if ('all' in a) return a.all.every((x: Condition) => evalCond(x, s));
  if ('any' in a) return a.any.some((x: Condition) => evalCond(x, s));
  if ('not' in a) return !evalCond(a.not, s);
  return false;
}
/** Collect every flag/quest/item/area referenced by a condition (for the linter). */
export function condRefs(c: Condition | undefined, out = { flags: [] as string[], quests: [] as string[], items: [] as string[], areas: [] as string[] }) {
  if (!c) return out;
  const a: any = c;
  if ('flag' in a) out.flags.push(a.flag);
  if ('notFlag' in a) out.flags.push(a.notFlag);
  if ('quest' in a) out.quests.push(a.quest);
  if ('item' in a) out.items.push(a.item);
  if ('cleared' in a) out.areas.push(a.cleared);
  for (const k of ['all', 'any']) if (a[k]) a[k].forEach((x: Condition) => condRefs(x, out));
  if (a.not) condRefs(a.not, out);
  return out;
}
