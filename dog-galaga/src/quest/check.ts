/**
 * Headless quest + dialogue check. Run: npx tsx src/quest/check.ts  (exit 1 on any gap), or through vitest
 * (src/quest/quest.test.ts calls runQuestCheck()).
 *
 * 1. Static: every quest trigger names an event some module actually emits.
 * 1b. Semantics: quest content agrees with the sector graph: a wave-count quest needs exactly the area's wave
 *    total, a "reach X" quest behind a gated exit shows the gate as progress and can be missed.
 * 2. Treat Bonanza: every bonus layout can be cleared perfectly by a fair pilot that plays through the real
 *    input path (player speed, acceleration, fire cooldown, turd cap), and every cat stays on screen above
 *    Pom long enough to line up.
 * 3. Coverage: plays every sector-graph path headless (autopilot, with the fair pilot flying each Treat
 *    Bonanza) and proves each quest is started and completed on at least one path, and that every
 *    sector-bound quest ends done or missed (never "in progress" forever).
 * 4. Robustness: malformed quest entries are skipped and reported (valid ones still run), missing dialogue
 *    ids show the fallback line, next-cycles terminate, nested conversations never drop an outro callback,
 *    the pause menu parks and resumes a conversation, event storms are bounded; one-thing-at-a-time
 *    presentation (briefing waits for the title card, quest toasts wait for the briefing), the closing press
 *    never fires, speaker voices, showcase staging, tracked()/goal() for the HUD.
 */
import fs from 'node:fs';
import path from 'node:path';
import { runPath } from '../../tools/bot-core';
import { createGame } from '../core/boot';
import { RAW, loadContent } from '../core/content';
import { paginate, revealLines, voiceFor, blipAt, DLG_COLS, DLG_ROWS } from './dialogue';
import { normalizeQuests, deriveQuest } from './validate';
import { bonusPilot, predict } from './bonuspilot';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

export interface QuestCheckResult { problems: string[]; notes: string[]; log: string[] }

export function runQuestCheck(opts: { paths?: boolean } = {}): QuestCheckResult {
const problems: string[] = []; const notes: string[] = []; const log: string[] = [];
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

// ---------- 1b. semantics: quests agree with the sector graph ----------
const nq = normalizeQuests(content.quests, m => problems.push('content quest rejected: ' + m)).map(q => deriveQuest(q, content.areas as any));
for (const q of nq) {
  const raw: any = content.quests.find(x => x.id === q.id);
  const aid = q.complete.match?.areaId as string | undefined; const area = content.areas.find(a => a.id === aid);
  if (q.complete.on === 'wave:clear' && area) {
    ok(q.complete.count === area.waves.length, `quest ${q.id}: needs ${q.complete.count} wave clears but ${aid} has ${area.waves.length} waves`);
    if ((raw?.complete?.count ?? 1) !== area.waves.length) notes.push(`content: quest ${q.id} complete.count ${raw?.complete?.count ?? 1} != ${area.waves.length} waves in ${aid} (engine uses ${q.complete.count}; see docs/core-requests/quest.md)`);
  }
  if (/every wave/i.test(q.desc) && !(q.complete.on === 'area:clear' || (q.complete.on === 'wave:clear' && area))) problems.push(`quest ${q.id}: says "every wave" but does not count an area's waves`);
  if (q.complete.on === 'area:enter' && area) {
    const gated = content.areas.some(a => a.exits.some(e => e.to === aid && e.when));
    if (gated) {
      ok(q.track || /memor/i.test(q.desc) === false, `quest ${q.id}: reaches a gated area but shows no gate progress`);
      ok(q.expire.length, `quest ${q.id}: reaches a gated area but can never be missed (stays in progress forever on other routes)`);
    }
  }
  for (const d of q.derived) notes.push(`derived: quest ${q.id}: ${d}`);
}

// ---------- 2. Treat Bonanza: every layout can be cleared perfectly at player speed ----------
for (const b of content.bonus) {
  const g: any = createGame({ headless: true, seed: 7 });
  g.mods.world.enterArea(content.start, 0); g.mods.quest.skipAll(); g.setScene('play');
  g.mods.world.phase = 'bonus'; g.mods.minigames.startBonus(b.id);
  const cats = [...g.mods.interaction.cats];
  // visibility window per cat: ticks on screen and above Pom's firing line, from its flight path
  let minWin = Infinity;
  for (const c of cats) { let w = 0; for (let k = 0; k < 2000; k++) { const f = predict(c, k); if (!f) { if (k > c.delay + 2) break; continue; } if (f.y > 0 && f.y < 316 - 22 && f.x > 0 && f.x < 448) w++; } minWin = Math.min(minWin, w); }
  ok(minWin >= 60, `bonus ${b.id}: a cat is on screen above Pom for only ${minWin} ticks`);
  let res: any = null; g.bus.on('bonus:result', (p: any) => { res = p; });
  for (let i = 0; i < 20000 && !res; i++) { const a = bonusPilot(g); g.input.synthetic.clear(); for (const x of a) g.input.synthetic.add(x); g.step(); }
  ok(res && res.hits === res.total, `bonus ${b.id}: the fair pilot booped ${res?.hits ?? '?'} / ${res?.total ?? '?'} (perfect bonus may be impossible)`);
  log.push(`  bonus ${b.id.padEnd(14)} pilot ${res?.hits}/${res?.total}, shortest cat window ${minWin} ticks`);
}

// ---------- 3. coverage over every path ----------
// autopilot everywhere except Treat Bonanzas, which the fair pilot flies through real input
const fair = (api: any) => {
  const g = api.game;
  if (g.state.scene === 'bonus') { g.autopilot = false; const a = bonusPilot(g); g.input.synthetic.clear(); for (const x of a) g.input.synthetic.add(x); }
  else if (!g.autopilot) { g.autopilot = true; g.input.synthetic.clear(); }
};
const started: Record<string, string[]> = {}; const done: Record<string, string[]> = {};
const queue: string[][] = [[]]; const seen = new Set<string>(); let paths = 0;
// quests bound to one sector (or route) must end done or missed on every path that started them
const bound = new Set(nq.filter(q => typeof q.complete.match?.areaId === 'string' || typeof q.complete.match?.bossId === 'string').map(q => q.id));
while (opts.paths !== false && queue.length) {
  const r = queue.shift()!; const key = r.join('>'); if (seen.has(key)) continue; seen.add(key);
  let missed: string[] = [];
  const res = runPath(r, 1337, { onTick: (api: any) => { fair(api); missed = Object.keys(api.game.state.quests).filter(id => api.game.mods.quest.missed(id)); } }); paths++;
  const label = res.route.join('>');
  ok(!res.softlock, `path ${label}: ${res.softlock}`);
  ok(!res.errors.length, `path ${label}: errors ${res.errors.join('; ')}`);
  for (const [id, st] of Object.entries(res.quests)) {
    if (st !== 'locked') (started[id] ??= []).push(label);
    if (st === 'done') (done[id] ??= []).push(label);
    if (bound.has(id) && st === 'active' && !missed.includes(id)) problems.push(`path ${label}: quest ${id} is still in progress at the ending (neither done nor missed)`);
  }
  queue.push(...res.branches);
}
if (opts.paths !== false) for (const q of content.quests) {
  ok(started[q.id]?.length, `quest ${q.id} is never started on any path`);
  ok(done[q.id]?.length, `quest ${q.id} is never completed on any path`);
}

// ---------- 4. robustness ----------
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
  g.mods.world.enterArea('backyard', 1); g.setScene('play'); g.mods.world.titleCard = 0; // (the briefing gate has its own test below)
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

// ---------- 5. presentation: one thing to read at a time ----------
{
  const g: any = createGame({ headless: true });
  const Q = g.mods.quest; const W = g.mods.world; const UI = g.mods.ui;
  g.autopilot = false; // real pacing rules (the bot skips the waits)
  W.enterArea(content.start, 0);
  const intro = W.area(content.start)?.intro;
  if (intro) {
    ok(g.state.scene === 'dialogue' && !Q.dlg && Q.dlgEngine.staged, 'briefing did not wait for the sector title card');
    let n = 0; while (!Q.dlg && n++ < 400) g.step();
    ok(Q.dlg && W.titleCard <= 8, `briefing opened while the title card still had ${W.titleCard} ticks`);
    ok(!UI.toasts.some((t: any) => /NEW QUEST/.test(t.text)) && Q.heldToasts().some((t: string) => /NEW QUEST/.test(t)), 'NEW QUEST toast shown on top of the briefing');
    // the closing press is held: fire stays down, the scene does not return to play until it is released
    for (let i = 0; i < 20; i++) g.step();
    // make the current page the last one
    const d = Q.dlg; d.nodes = 999; d.chars = 1e9; d.page = d.pages.length - 1; d.src = { ...d.src, next: undefined };
    const shots0 = g.state.stats.shots;
    g.input.synthetic.add('fire'); g.input.synthetic.add('confirm');
    for (let i = 0; i < 10; i++) g.step();
    ok(!Q.dlg && g.state.scene === 'dialogue', 'closing press reached play while still held');
    g.input.synthetic.clear();
    for (let i = 0; i < 3; i++) g.step();
    ok(g.state.scene === 'play' && g.state.stats.shots === shots0, 'Pom tooted with the press that closed the briefing');
    for (let i = 0; i < 200; i++) g.step();
    ok(UI.toasts.some((t: any) => /NEW QUEST/.test(t.text)) || !Q.heldToasts().length, 'held NEW QUEST toast never released after the briefing');
  }
  // tracked(): the sector's own quest wins over long-running ones; goal() gives a readable line
  const ids = content.quests.map(q => q.id);
  if (ids.includes('night_owl') && ids.includes('boop_brigade')) {
    const g2: any = createGame({ headless: true }); g2.autopilot = true;
    g2.mods.world.enterArea('rooftops', 0); g2.mods.quest.skipAll();
    g2.mods.quest.start('boop_brigade');
    ok(g2.mods.quest.tracked()?.id === 'night_owl', `tracked() in rooftops is ${g2.mods.quest.tracked()?.id}, not night_owl`);
    ok(g2.mods.quest.goal({ id: 'night_owl' }) === 'CLEAR ROOFTOPS', `goal(night_owl) = ${g2.mods.quest.goal({ id: 'night_owl' })}`);
    for (const q of content.quests) { const s = g2.mods.quest.goal(q); ok(s && s.length <= 16, `goal(${q.id}) "${s}" empty or too long`); }
  }
  // secret route: progress is the memory gate, and taking the other branch closes it as missed
  if (ids.includes('secret_route')) {
    const g3: any = createGame({ headless: true }); g3.autopilot = true; const Q3 = g3.mods.quest;
    g3.mods.world.enterArea('sky', 0); Q3.skipAll();
    ok(Q3.status('secret_route') === 'active', 'secret_route not started in sky');
    const p0 = Q3.progress({ id: 'secret_route' }); ok(p0.need >= 2, `secret_route progress need ${p0.need} (memory gate not tracked)`);
    g3.ops.addMemory(content.memories[0].id);
    ok(Q3.progress({ id: 'secret_route' }).have === Math.min(p0.need, g3.state.memories.length), 'secret_route progress does not follow memories');
    g3.bus.emit('area:enter', { areaId: 'moon', waveIndex: 0 });
    ok(Q3.status('secret_route') === 'missed' && Q3.tracked()?.id !== 'secret_route', 'taking the moon branch did not close secret_route as missed');
  }
  // voices and rhythm
  ok(voiceFor({ speaker: 'Commander Biscuit' }).voice === 'gruff' && voiceFor({ speaker: 'Captain Pom' }).voice === 'bright' && voiceFor({ speaker: 'Empress Fluffington' }).voice === 'regal', 'speaker voices not distinct');
  ok(!blipAt('woof', 2) && blipAt('woof', 3) && !blipAt('a b', 1), 'blips do not follow the words (doubled letters / spaces)');
  // showcase staging: typing in progress, then later pages
  {
    const g4: any = createGame({ headless: true }); const Q4 = g4.mods.quest; g4.mods.world.enterArea(content.start, 0); g4.setScene('play');
    const id = W.area(content.start)?.intro ?? content.dialogue[0].id;
    const a = Q4.stage(id, 30); ok(a && a.chars > 3 && a.chars < a.node.text.length, 'stage(at=30) does not show typing in progress');
    const full = Q4.stage(id); ok(full && full.chars >= full.node.text.length, 'stage() without at is not fully typed');
    const late = Q4.stage(id, 400); ok(late && (late.page > 0 || late.nodes > 1), 'stage(at=400) did not reach a second page or node');
  }
}


log.unshift(`quest check: ${paths} paths, ${content.quests.length} quests`);
for (const q of content.quests) log.push(`  ${q.id.padEnd(16)} started on ${started[q.id]?.length ?? 0}, completed on ${done[q.id]?.length ?? 0}${done[q.id] ? '  e.g. ' + done[q.id][0] : ''}`);
return { problems, notes, log };
}

// CLI
if (process.argv[1] && /check\.ts$/.test(process.argv[1])) {
  const r = runQuestCheck();
  console.log(r.log.join('\n'));
  if (r.notes.length) console.log('NOTES:\n  ' + r.notes.join('\n  '));
  if (r.problems.length) { console.log('PROBLEMS:\n  ' + r.problems.join('\n  ')); process.exit(1); }
  console.log('quest check: OK');
}
