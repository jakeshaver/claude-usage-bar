// Tiny declarative schema validator shared by the runtime loader and the content linter.
type Spec = { [field: string]: string }; // 'string' | 'number' | 'boolean' | 'array' | 'object' | 'enum:a|b' ; suffix '?' = optional

export const SCHEMAS: Record<string, Spec> = {
  areas: { id: 'string', name: 'string', subtitle: 'string?', tileset: 'enum:backyard|street|park|alley|rooftops|cafe|docks|factory|sky|moon|nebula|station|mothership',
    music: 'string', ambience: 'string', tod: 'enum:dawn|day|dusk|night', waves: 'array', boss: 'string?', exits: 'array',
    intro: 'string?', outro: 'string?', bonus: 'string?', ending: 'string?', scroll: 'number?' },
  waves: { id: 'string', formation: 'object', cats: 'array', entry: 'enum:swirl-left|swirl-right|split|rain|loop', diveRate: 'number', fireRate: 'number', pickup: 'string?' },
  enemies: { id: 'string', name: 'string', sprite: 'string', hp: 'number', points: 'number', divePoints: 'number?',
    behavior: 'enum:basic|diver|shooter|tank|splitter|capturer|zigzag|boss', bestiary: 'string', size: 'number?', bossPattern: 'string?' },
  quests: { id: 'string', name: 'string', desc: 'string', start: 'object', complete: 'object', reward: 'object', dialogue: 'string?' },
  dialogue: { id: 'string', speaker: 'string', portrait: 'string', text: 'string', next: 'string?', when: 'object?' },
  items: { id: 'string', name: 'string', sprite: 'string', desc: 'string', effect: 'object' },
  memories: { id: 'string', area: 'string', wave: 'number', title: 'string', text: 'string' },
  bonus: { id: 'string', name: 'string', groups: 'number', pattern: 'enum:figure8|cross|spiral|zigzag', breed: 'string' },
  endings: { id: 'string', title: 'string', text: 'array', when: 'object?' },
};

export interface Issue { file: string; id?: string; msg: string }

export function validateEntry(file: string, e: any): string[] {
  const spec = SCHEMAS[file]; const errs: string[] = [];
  if (!e || typeof e !== 'object' || Array.isArray(e)) return ['entry is not an object'];
  for (const [f, t0] of Object.entries(spec)) {
    const opt = t0.endsWith('?'); const t = opt ? t0.slice(0, -1) : t0; const v = e[f];
    if (v === undefined) { if (!opt) errs.push(`missing "${f}"`); continue; }
    if (t.startsWith('enum:')) { if (!t.slice(5).split('|').includes(v)) errs.push(`"${f}" must be one of ${t.slice(5)} (got ${JSON.stringify(v)})`); }
    else if (t === 'array') { if (!Array.isArray(v)) errs.push(`"${f}" must be an array`); }
    else if (t === 'object') { if (typeof v !== 'object' || Array.isArray(v) || v === null) errs.push(`"${f}" must be an object`); }
    else if (typeof v !== t) errs.push(`"${f}" must be ${t}`);
  }
  return errs;
}

export function validateCollection(file: string, data: unknown): { ok: any[]; issues: Issue[] } {
  const issues: Issue[] = []; const ok: any[] = [];
  if (!Array.isArray(data)) return { ok, issues: [{ file, msg: 'file must contain a JSON array' }] };
  const seen = new Set<string>();
  for (const e of data) {
    const errs = validateEntry(file, e);
    if (e && seen.has(e.id)) errs.push(`duplicate id "${e.id}"`);
    if (errs.length) issues.push(...errs.map(msg => ({ file, id: e?.id, msg })));
    else { ok.push(e); seen.add(e.id); }
  }
  return { ok, issues };
}
