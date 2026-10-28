import type { Content } from './types';
import { validateCollection, type Issue } from './schema';
import { FALLBACK } from './fallback';

import areas from '../../content/areas.json';
import waves from '../../content/waves.json';
import enemies from '../../content/enemies.json';
import quests from '../../content/quests.json';
import dialogue from '../../content/dialogue.json';
import items from '../../content/items.json';
import memories from '../../content/memories.json';
import bonus from '../../content/bonus.json';
import endings from '../../content/endings.json';

export const RAW: Record<string, unknown> = { areas, waves, enemies, quests, dialogue, items, memories, bonus, endings };

/** Validate every file independently. Bad entries are dropped; a file with nothing valid falls back. */
export function loadContent(raw: Record<string, unknown> = RAW): { content: Content; issues: Issue[] } {
  const issues: Issue[] = [];
  const out: any = { start: 'backyard' };
  for (const key of Object.keys(FALLBACK) as (keyof typeof FALLBACK)[]) {
    if (key === 'start') continue;
    try {
      const { ok, issues: is } = validateCollection(key, raw[key]);
      issues.push(...is);
      out[key] = ok.length ? ok : (FALLBACK as any)[key];
      if (!ok.length) issues.push({ file: key, msg: 'no valid entries, using built-in fallback' });
    } catch (e) {
      out[key] = (FALLBACK as any)[key]; issues.push({ file: key, msg: 'failed to load: ' + String(e) });
    }
  }
  if (!out.areas.find((a: any) => a.id === out.start)) out.start = out.areas[0].id;
  return { content: out as Content, issues };
}
