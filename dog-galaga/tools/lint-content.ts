// Content linter: schema, dangling references, unreachable nodes, missing sprites/tracks, banned APIs.
import fs from 'node:fs';
import path from 'node:path';
import { validateCollection, SCHEMAS } from '../src/core/schema';
import { condRefs } from '../src/core/conditions';
import { SHEETS } from '../src/art/sprite';
import '../src/art/index';
import { TRACKS } from '../src/audio/tracks';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const errors: string[] = []; const warns: string[] = [];
const data: Record<string, any[]> = {};
for (const f of Object.keys(SCHEMAS)) {
  const p = path.join(root, 'content', f + '.json');
  if (!fs.existsSync(p)) { errors.push(`missing file content/${f}.json`); data[f] = []; continue; }
  let raw: unknown; try { raw = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { errors.push(`content/${f}.json: invalid JSON: ${e}`); data[f] = []; continue; }
  const { ok, issues } = validateCollection(f, raw);
  for (const i of issues) errors.push(`${f}${i.id ? '#' + i.id : ''}: ${i.msg}`);
  data[f] = ok;
}
const ids = (k: string) => new Set(data[k].map((x: any) => x.id));
const A = ids('areas'), Wv = ids('waves'), E = ids('enemies'), D = ids('dialogue'), I = ids('items'), Bn = ids('bonus'), En = ids('endings'), Q = ids('quests');
const sprite = (where: string, s: string) => { if (!SHEETS[s]) errors.push(`${where}: sprite "${s}" does not exist`); };
const flagsSet = new Set<string>(['perfect_bonus']);
for (const q of data.quests) for (const f of q.reward.flags ?? []) flagsSet.add(f);
for (const a of data.areas) { flagsSet.add('pup_' + a.id); }
const checkCond = (where: string, c: any) => {
  const r = condRefs(c);
  r.flags.forEach(f => { if (!flagsSet.has(f)) errors.push(`${where}: condition references flag "${f}" that nothing sets`); });
  r.quests.forEach(q => { if (!Q.has(q)) errors.push(`${where}: unknown quest "${q}"`); });
  r.items.forEach(i => { if (!I.has(i) && i !== 'pups') errors.push(`${where}: unknown item "${i}"`); });
  r.areas.forEach(x => { if (!A.has(x)) errors.push(`${where}: unknown area "${x}"`); });
};
for (const a of data.areas) {
  const w = `areas#${a.id}`;
  a.waves.forEach((x: string) => { if (!Wv.has(x)) errors.push(`${w}: unknown wave "${x}"`); });
  if (a.boss && !E.has(a.boss)) errors.push(`${w}: unknown boss "${a.boss}"`);
  if (a.boss && data.enemies.find((e: any) => e.id === a.boss)?.behavior !== 'boss') warns.push(`${w}: boss "${a.boss}" is not behavior=boss`);
  for (const k of ['intro', 'outro']) if (a[k] && !D.has(a[k])) errors.push(`${w}: unknown dialogue "${a[k]}"`);
  if (a.bonus && !Bn.has(a.bonus)) errors.push(`${w}: unknown bonus "${a.bonus}"`);
  if (a.ending && !En.has(a.ending)) errors.push(`${w}: unknown ending "${a.ending}"`);
  if (!TRACKS[a.music]) errors.push(`${w}: unknown music track "${a.music}"`);
  for (const e of a.exits) { if (!A.has(e.to)) errors.push(`${w}: exit to unknown area "${e.to}"`); checkCond(w + ' exit', e.when); }
  if (!a.ending && !a.exits.some((e: any) => !e.when)) errors.push(`${w}: no unconditional exit and not an ending (softlock risk)`);
}
for (const wv of data.waves) {
  for (const c of wv.cats) { if (!E.has(c.breed)) errors.push(`waves#${wv.id}: unknown breed "${c.breed}"`); if (c.row >= wv.formation.rows) warns.push(`waves#${wv.id}: row ${c.row} >= rows`); }
  if (wv.pickup && !I.has(wv.pickup)) errors.push(`waves#${wv.id}: unknown pickup "${wv.pickup}"`);
  if (!data.areas.some((a: any) => a.waves.includes(wv.id))) warns.push(`waves#${wv.id}: not used by any area`);
}
for (const e of data.enemies) sprite(`enemies#${e.id}`, e.sprite);
if (!E.has('kitten')) errors.push('enemies: "kitten" required (splitter spawn)');
for (const i of data.items) sprite(`items#${i.id}`, i.sprite);
for (const b of data.bonus) if (!E.has(b.breed)) errors.push(`bonus#${b.id}: unknown breed "${b.breed}"`);
for (const d of data.dialogue) { if (d.next && !D.has(d.next)) errors.push(`dialogue#${d.id}: next "${d.next}" missing`); sprite(`dialogue#${d.id} portrait`, d.portrait); checkCond(`dialogue#${d.id}`, d.when); }
for (const m of data.memories) { const a = data.areas.find((x: any) => x.id === m.area); if (!a) errors.push(`memories#${m.id}: unknown area`); else if (m.wave >= a.waves.length) errors.push(`memories#${m.id}: wave ${m.wave} out of range`); }
for (const q of data.quests) { checkCond(`quests#${q.id} start`, q.start.when); checkCond(`quests#${q.id} complete`, q.complete.when); if (q.start.match?.areaId && !A.has(q.start.match.areaId)) errors.push(`quests#${q.id}: unknown area in match`); }
for (const e of data.endings) checkCond(`endings#${e.id}`, e.when);
// reachability over the area graph (ignoring conditions = optimistic)
const start = 'backyard'; const seen = new Set<string>([start]); const stack = [start];
while (stack.length) { const id = stack.pop()!; for (const e of data.areas.find((a: any) => a.id === id)?.exits ?? []) if (!seen.has(e.to)) { seen.add(e.to); stack.push(e.to); } }
for (const a of data.areas) if (!seen.has(a.id)) errors.push(`areas#${a.id}: unreachable from start`);
// dialogue reachability
const usedD = new Set<string>(); for (const a of data.areas) for (const k of ['intro', 'outro']) { let id = a[k]; while (id && !usedD.has(id)) { usedD.add(id); id = data.dialogue.find((d: any) => d.id === id)?.next; } }
for (const q of data.quests) if (q.dialogue) usedD.add(q.dialogue);
for (const d of data.dialogue) if (!usedD.has(d.id)) warns.push(`dialogue#${d.id}: unreachable`);
// cycle check (graph must be a DAG so every path terminates)
const color: Record<string, number> = {};
const dfs = (id: string): boolean => { color[id] = 1; for (const e of data.areas.find((a: any) => a.id === id)?.exits ?? []) { if (color[e.to] === 1) { errors.push(`areas: cycle via ${id} -> ${e.to}`); return true; } if (!color[e.to] && dfs(e.to)) return true; } color[id] = 2; return false; };
dfs(start);
// banned runtime APIs in src/
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap(f => f.isDirectory() ? walk(path.join(d, f.name)) : [path.join(d, f.name)]);
for (const f of walk(path.join(root, 'src'))) {
  const s = fs.readFileSync(f, 'utf8');
  if (/Math\.random\(/.test(s)) errors.push(`${path.relative(root, f)}: Math.random is banned (use core/rng)`);
  if (/\bfetch\(|XMLHttpRequest|https?:\/\/(?!www\.w3)/.test(s)) errors.push(`${path.relative(root, f)}: network access is banned at runtime`);
}
const sum = { files: Object.keys(SCHEMAS).length, areas: data.areas.length, waves: data.waves.length, enemies: data.enemies.length, quests: data.quests.length, dialogue: data.dialogue.length, memories: data.memories.length, errors: errors.length, warnings: warns.length };
warns.forEach(w => console.log('warn  ' + w)); errors.forEach(e => console.log('ERROR ' + e));
console.log(JSON.stringify(sum));
fs.mkdirSync(path.join(root, 'tools/out'), { recursive: true });
fs.writeFileSync(path.join(root, 'tools/out/lint.json'), JSON.stringify({ ...sum, errorList: errors, warnList: warns }, null, 1));
process.exit(errors.length ? 1 : 0);
