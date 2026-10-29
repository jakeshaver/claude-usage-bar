/**
 * Headless quest + dialogue check. Run: npx tsx src/quest/check.ts  (exit 1 on any gap)
 *
 * 1. Static: every quest trigger names an event some module actually emits.
 * 2. Coverage: plays every sector-graph path headless with a "skilled" autopilot (every Treat Bonanza is
 *    perfect: the bonus:result payload is forced to hits === total, the only thing the bot cannot aim for)
 *    and proves each quest in content/quests.json is started and completed on at least one path.
 * 3. Robustness: malformed quest entries are skipped and reported (valid ones still run), missing dialogue
 *    ids show the fallback line, next-cycles terminate, nested conversations never drop an outro callback,
 *    the pause menu parks and resumes a conversation, event storms are bounded.
 */
import fs from 'node:fs';
import path from 'node:path';
import { runPath } from '../../tools/bot-core';
import { createGame } from '../core/boot';
import { RAW, loadContent } from '../core/content';
import { paginate, revealLines, DLG_COLS, DLG_ROWS } from './dialogue';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const problems: string[] = [];
const ok = (cond: unknown, msg: string) => { if (!cond) problems.push(msg); };
const { content } = loadContent();

// ---------- 1. static: trigger events are emitted somewhere ----------
const emitted = new Set<string>(['check']);
const walk = (d: string) => {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.ts')) for (const m of fs.readFileSync(p, 'utf8').matchAll(/emit\(\s*'([a-z]+:[a-z_]+|[a-z]+)'/g)) emitted.add(m[1]);
  }
};
walk(path.join(root, 'src'));
for (const q of content.quests) for (const t of [q.start, q.complete]) ok(emitted.has(t.on), `quest ${q.id}: nothing emits "${t.on}"`);

// ---------- 2. coverage over every path ----------
const skilled = (api: any) => {
  const g = api.game; if (g.__skilled) return; g.__skilled = true;
  const emit = g.bus.emit.bind(g.bus);
  g.bus.emit = (evt: string, p: any = {}) => emit(evt, evt === 'bonus:result' ? { ...p, hits: p.total } : p);
};
const started: Record<string, string[]> = {}; const done: Record<string, string[]> = {};
const queue: string[][] = [[]]; const seen = new Set<string>(); let paths = 0;
while (queue.length) {
  const r = queue.shift()!; const key = r.join('>'); if (seen.has(key)) continue; seen.add(key);
  const res = runPath(r, 1337, { onTick: skilled }); paths++;
  const label = res.route.join('>');
  ok(!res.softlock, `path ${label}: ${res.softlock}`);
  ok(!res.errors.length, `path ${label}: errors ${res.errors.join('; ')}`);
  for (const [id, st] of Object.entries(res.quests)) {
    if (st !== 'locked') (started[id] ??= []).push(label);
    if (st === 'done') (done[id] ??= []).push(label);
  }
  queue.push(...res.branches);
}
for (const q of content.quests) {
  ok(started[q.id]?.length, `quest ${q.id} is never started on any path`);
  ok(done[q.id]?.length, `quest ${q.id} is never completed on any path`);
}

// ---------- 3. robustness ----------
const bad: any[] = [
  null, 42, { id: 'no_triggers', name: 'x', desc: 'x', start: {}, complete: { on: 'wave:clear' }, reward: {} },
  { id: 'bad_count', name: 'x', desc: 'x', start: { on: 'area:enter' }, complete: { on: 'cat:boop', count: -3 }, reward: {} },
  { id: 'bad_cond', name: 'x', desc: 'x', start: { on: 'area:enter', when: { banana: 1 } }, complete: { on: 'cat:boop' }, reward: {} },
  { id: 'bad_reward', name: 'x', desc: 'x', start: { on: 'area:enter' }, complete: { on: 'cat:boop' }, reward: { items: { treat: 'lots' } } },
  { id: 'bad_match', name: 'x', desc: 'x', start: { on: 'area:enter', match: { areaId: { deep: 1 } } }, complete: { on: 'cat:boop' }, reward: {} },
];
const good = { id: 'probe', name: 'Probe', desc: 'probe', start: { on: 'probe:go', match: { n: 1 } }, complete: { on: 'probe:hit', count: 3 }, reward: { score: 7, flags: ['probed'] } };
{
  let g: any;
  try { g = createGame({ headless: true, content: { ...RAW, quests: [...bad, good, { ...good }] } }); } catch (e) { problems.push('createGame threw on malformed quests: ' + e); }
  if (g) {
    const Q = g.mods.quest;
    ok(Q.quests().length === 1, `malformed quests: expected 1 valid quest, got ${Q.quests().length}`);
    const qerr = g.errors.filter((e: any) => e.module === 'quest');
    ok(qerr.length >= 5, `malformed quests: expected each bad entry reported, got ${qerr.length}`);
    // loader drops the non-objects itself; the rest must be reported by us
    for (const id of ['no_triggers', 'bad_count', 'bad_cond', 'bad_reward', 'bad_match']) ok(qerr.some((e: any) => e.message.includes(id)), `malformed quest ${id} not reported`);
    g.bus.emit('probe:go', { n: 2 }); ok(g.state.quests.probe === undefined, 'match filter ignored');
    g.bus.emit('probe:go', { n: '1' }); ok(g.state.quests.probe === 'active', 'match filter (numeric string) failed to start quest');
    g.bus.emit('probe:hit', {}); g.bus.emit('probe:hit', {});
    ok(Q.progress(good).have === 2 && Q.progress(good).need === 3, 'progress tracking wrong');
    const sc0 = g.state.score; g.bus.emit('probe:hit', {});
    ok(g.state.quests.probe === 'done' && g.state.flags.probed && g.state.score === sc0 + 7, 'completion reward not paid');
    g.bus.emit('probe:hit', {}); ok(g.state.score === sc0 + 7, 'reward paid twice');
    // a quest whose completion re-triggers itself through flags must not recurse forever
    const storm = createGame({ headless: true, content: { ...RAW, quests: [
      { id: 'a', name: 'A', desc: '', start: { on: 'flag:set' }, complete: { on: 'flag:set' }, reward: { flags: ['fa'] } },
      { id: 'b', name: 'B', desc: '', start: { on: 'quest:update', match: { questId: 'a', state: 'done' } }, complete: { on: 'flag:set', match: { flag: 'fa' } }, reward: { flags: ['fb'] } },
    ] } });
    storm.ops.setFlag('kick');
    ok(storm.state.quests.a === 'done' && storm.state.quests.b === 'done', 'chained quests (quest:update trigger) did not resolve');
  }
}
{
  const dlg = [
    { id: 'loop-1', speaker: 'Biscuit', portrait: 'portrait_biscuit', text: 'Round and round.', next: 'loop-2' },
    { id: 'loop-2', speaker: 'Pom', portrait: 'portrait_pom', text: 'Like a tail chase.', next: 'loop-1' },
    { id: 'gated', speaker: 'Pom', portrait: 'portrait_pom', text: 'Hidden', when: { flag: 'never' }, next: 'after-gate' },
    { id: 'after-gate', speaker: 'Pom', portrait: 'portrait_pom', text: 'Visible. ' + 'Woof woof bark. '.repeat(20) },
    { id: 'dangling', speaker: 'Pom', portrait: 'portrait_pom', text: 'Then...', next: 'nope-not-here' },
  ];
  const g: any = createGame({ headless: true, content: { ...RAW, dialogue: [...(RAW.dialogue as any[]), ...dlg] } });
  const Q = g.mods.quest;
  g.mods.world.enterArea('backyard', 1); g.setScene('play');
  // missing id: friendly fallback, then done runs
  let fired = 0; Q.dialogue('does-not-exist', () => fired++);
  ok(Q.dlg && /squirrel/i.test(Q.dlg.node.text), 'missing dialogue: no fallback line');
  Q.skipAll(); ok(fired === 1 && g.state.scene === 'play', 'missing dialogue: done not called or scene not restored');
  // dangling next: shows the line, then fallback, then closes
  Q.dialogue('dangling'); ok(Q.dlg?.node.id === 'dangling', 'dangling: first node not shown');
  Q.skipAll(); ok(!Q.dlg && g.state.scene === 'play', 'dangling: conversation did not close');
  // cycles terminate
  Q.dialogue('loop-1'); Q.skipAll(); ok(!Q.dlg && g.state.scene === 'play', 'next-cycle did not terminate');
  // gated node skipped; long text paged so nothing is cut off
  Q.dialogue('gated'); ok(Q.dlg?.node.id === 'after-gate', 'when-gated node not skipped');
  ok(Q.dlg.pages.length > 1 && Q.dlg.pages.every((p: string) => revealLines(p, 1e9).join(' ') === p), 'long text not paged into full boxes');
  Q.skipAll();
  // typewriter: types over time, pauses on punctuation, never blocks pause, resumes after it
  Q.dialogue('intro-backyard-1');
  g.autopilot = false;
  for (let i = 0; i < 30; i++) g.step();
  const c30 = Q.dlg.chars; ok(c30 > 5 && c30 < Q.dlg.node.text.length, `typewriter not progressive (chars ${c30})`);
  g.mods.ui.openPause(); ok(g.paused && !Q.dlg, 'pause did not park the conversation');
  for (let i = 0; i < 60; i++) g.step();
  g.mods.ui.closeMenus(false); ok(Q.dlg && Q.dlg.chars === c30, 'conversation not resumed intact after pause');
  // nested: an outro with a callback is never dropped by a later request
  Q.skipAll(); let outro = 0;
  Q.dialogue('loop-1', () => outro++); Q.dialogue('intro-backyard-1');
  ok(Q.dlg?.node.id === 'loop-1', 'conversation with callback was replaced');
  Q.skipAll(); ok(outro === 1, 'outro callback lost');
  for (let i = 0; i < 3; i++) g.step();
  Q.skipAll(); ok(!Q.dlg && g.state.scene === 'play', 'queued conversation did not play/close');
  // a scene jump to the title drops the conversation without crashing
  Q.dialogue('loop-1'); g.setScene('title'); ok(!Q.dlg, 'title jump left a dangling conversation');
  const qerr = g.errors.filter((e: any) => e.module !== 'quest');
  ok(!qerr.length, 'dialogue checks raised non-quest errors: ' + qerr.map((e: any) => e.message).join('; '));
}
// every real dialogue node fits the box after paging (ui shows DLG_ROWS lines of DLG_COLS)
for (const d of content.dialogue) for (const p of paginate(d.text)) ok(revealLines(p, 1e9, DLG_COLS, DLG_ROWS).join(' ') === p, `dialogue ${d.id}: page does not fit the box`);

console.log(`quest check: ${paths} paths, ${content.quests.length} quests`);
for (const q of content.quests) console.log(`  ${q.id.padEnd(16)} started on ${started[q.id]?.length ?? 0}, completed on ${done[q.id]?.length ?? 0}${done[q.id] ? '  e.g. ' + done[q.id][0] : ''}`);
if (problems.length) { console.log('PROBLEMS:\n  ' + problems.join('\n  ')); process.exit(1); }
console.log('quest check: OK');
