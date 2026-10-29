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
import { evalCond } from '../core/conditions';
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
  if (q.complete.on === 'wave:clear' && area) ok(q.complete.count <= area.waves.length, `quest ${q.id}: needs ${q.complete.count} wave clears but ${aid} has ${area.waves.length} waves`);
  if (raw?.complete?.on === 'wave:clear' && q.complete.on === 'area:clear') notes.push(`content: quest ${q.id} counts ${raw.complete.count ?? 1} wave clears; the engine completes it on area:clear ${aid} (boss stage included). Please change content (docs/core-requests/quest.md)`);
  if (/every wave/i.test(q.desc) && q.complete.on !== 'area:clear') problems.push(`quest ${q.id}: says "every wave" but does not finish on clearing the sector (the HUD counts the boss stage too)`);
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
const started: Record<string, string[]> = {}; const done: Record<string, string[]> = {}; const missedOn: Record<string, string[]> = {};
const queue: string[][] = [[]]; const seen = new Set<string>(); let paths = 0;
// quests bound to one sector (or route) must end done or missed on every path that started them
const bound = new Set(nq.filter(q => typeof q.complete.match?.areaId === 'string' || typeof q.complete.match?.bossId === 'string').map(q => q.id));
while (opts.paths !== false && queue.length) {
  const r = queue.shift()!; const key = r.join('>'); if (seen.has(key)) continue; seen.add(key);
  const res = runPath(r, 1337, { onTick: fair }); paths++;
  const label = res.route.join('>');
  ok(!res.softlock, `path ${label}: ${res.softlock}`);
  ok(!res.errors.length, `path ${label}: errors ${res.errors.join('; ')}`);
  for (const [id, st] of Object.entries(res.quests)) {
    if (st !== 'locked') (started[id] ??= []).push(label);
    if (st === 'done') (done[id] ??= []).push(label);
    if (st === 'missed') (missedOn[id] ??= []).push(label);
    // the run is over: every quest that started is closed (done or missed) in the saved state itself, so the
    // journal after the credits never lists a dangling open quest (critic issue: secret_route on moon routes)
    if (st === 'active') problems.push(`path ${label}: quest ${id} is still 'active' at the ending (neither done nor missed)${bound.has(id) ? ' [sector-bound]' : ''}`);
    if (st !== 'locked' && st !== 'active' && st !== 'done' && st !== 'missed') problems.push(`path ${label}: quest ${id} has unknown state "${st}"`);
  }
  queue.push(...res.branches);
}
if (opts.paths !== false) for (const q of content.quests) {
  ok(started[q.id]?.length, `quest ${q.id} is never started on any path`);
  ok(done[q.id]?.length, `quest ${q.id} is never completed on any path`);
  if (missedOn[q.id]?.length) log.push(`  quest ${q.id.padEnd(16)} missed on ${missedOn[q.id].length}/${paths} paths`);
}

// ---------- 4. robustness ----------
const bad: any[] = [
  null, 42, { id: 'no_triggers', name: 'x', desc: 'x', start: {}, complete: { on: 'wave:clear' }, reward: {} },
  { id: 'bad_count', name: 'x', desc: 'x', start: { on: 'area:enter' }, complete: { on: 'cat:boop', count: -3 }, reward: {} },
  { id: 'bad_cond', name: 'x', desc: 'x', start: { on: 'area:enter', when: { banana: 1 } }, complete: { on: 'cat:boop' }, reward: {} },
  { id: 'bad_reward', name: 'x', desc: 'x', start: { on: 'area:enter' }, complete: { on: 'cat:boop' }, reward: { items: { treat: 'lots' } } },
  { id: 'bad_score', name: 'x', desc: 'x', start: { on: 'area:enter' }, complete: { on: 'cat:boop' }, reward: { score: 'abc', items: { treat: -2, bone: 2 }, flags: ['ok', 7] } },
  { id: 'bad_match', name: 'x', desc: 'x', start: { on: 'area:enter', match: { areaId: { deep: 1 } } }, complete: { on: 'cat:boop' }, reward: {} },
];
const good = { id: 'probe', name: 'Probe', desc: 'probe', start: { on: 'probe:go', match: { n: 1 } }, complete: { on: 'probe:hit', count: 3 }, reward: { score: 7, flags: ['probed'] } };
{
  let g: any;
  try { g = createGame({ headless: true, content: { ...RAW, quests: [...bad, good, { ...good }] } }); } catch (e) { problems.push('createGame threw on malformed quests: ' + e); }
  if (g) {
    const Q = g.mods.quest;
    // only unusable triggers skip an entry; bad counts and reward fields fall back field by field (and are reported)
    const kept = Q.quests().map((q: any) => q.id).sort().join(',');
    ok(kept === 'bad_count,bad_reward,bad_score,probe', `malformed quests: expected bad_count,bad_reward,bad_score,probe kept, got ${kept}`);
    const qd = (id: string) => Q.quests().find((q: any) => q.id === id);
    ok(qd('bad_count')?.complete.count === 1, 'bad count did not fall back to 1');
    ok(qd('bad_score')?.reward.score === 0 && JSON.stringify(qd('bad_score')?.reward.items) === '{"bone":2}' && qd('bad_score')?.reward.flags.join() === 'ok', `bad reward fields not dropped one by one: ${JSON.stringify(qd('bad_score')?.reward)}`);
    ok(JSON.stringify(qd('bad_reward')?.reward.items) === '{}', 'bad reward item count not dropped');
    // content problems go to the quiet channel (contentIssues), never to g.errors (= the crash toast)
    ok(!g.errors.some((e: any) => e.module === 'quest'), 'malformed quests reported through g.errors (shows the crash toast)');
    ok(!g.mods.ui.toasts.some((t: any) => /KNOCKED OVER/i.test(t.text)), 'malformed quests raised the crash toast');
    const qerr = g.contentIssues.filter((e: any) => /^\[quest\]/.test(e.msg)).map((e: any) => ({ message: e.msg }));
    ok(qerr.length >= 5, `malformed quests: expected each bad entry reported, got ${qerr.length}`);
    // loader drops the non-objects itself; the rest must be reported by us
    for (const id of ['no_triggers', 'bad_count', 'bad_cond', 'bad_reward', 'bad_score', 'bad_match']) ok(qerr.some((e: any) => e.message.includes(id)), `malformed quest ${id} not reported`);
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
  Q.start('nope_quest_zz');
  ok(!g.errors.length, 'missing dialogue / unknown quest reported through g.errors (crash toast): ' + g.errors.map((e: any) => e.message).join('; '));
  ok(!g.mods.ui.toasts.some((t: any) => /KNOCKED OVER/i.test(t.text)), 'missing dialogue / unknown quest showed the crash toast');
  ok(g.contentIssues.some((e: any) => /does-not-exist/.test(e.msg)) && g.contentIssues.some((e: any) => /nope_quest_zz/.test(e.msg)), 'content misses not reported in contentIssues');
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
  {
    // one press finishes the page at once (holding is the x4 fast-forward); the press is not a page turn
    const page0 = Q.dlg.page, node0 = Q.dlg.node.id;
    g.input.synthetic.add('confirm'); g.step(); g.input.synthetic.clear(); g.step();
    ok(Q.dlg && Q.dlg.chars >= Q.dlg.node.text.length && Q.dlg.page === page0 && Q.dlg.node.id === node0, 'a press did not finish the page instantly');
    Q.dialogue('intro-backyard-1'); for (let i = 0; i < 30; i++) g.step();
  }
  const c30b = Q.dlg.chars;
  g.mods.ui.openPause(); ok(g.paused && !Q.dlg, 'pause did not park the conversation');
  for (let i = 0; i < 60; i++) g.step();
  g.mods.ui.closeMenus(false); ok(Q.dlg && Q.dlg.chars === c30b, 'conversation not resumed intact after pause');
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
    ok(g.state.scene === 'dialogue' && !Q.dlgEngine.dlg && Q.dlgEngine.staged, 'briefing did not wait for the sector title card');
    let n = 0; while (!Q.dlgEngine.dlg && n++ < 400) g.step();
    ok(Q.dlgEngine.dlg && W.titleCard <= 8, `briefing opened while the title card still had ${W.titleCard} ticks`);
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
  // the staged briefing (waiting on the title card) answers every input
  {
    const mk = () => { const g6: any = createGame({ headless: true }); g6.autopilot = false; g6.mods.world.enterArea('park', 0); return g6; };
    const press = (g6: any, a: string) => { g6.input.synthetic.add(a); g6.step(); g6.input.synthetic.clear(); g6.step(); };
    let g6 = mk(); ok(g6.mods.quest.dlgEngine.staged, 'park briefing not staged behind the title card');
    press(g6, 'confirm'); ok(g6.mods.quest.dlgEngine.dlg && !g6.mods.quest.dlgEngine.staged && g6.mods.world.titleCard <= 8, 'confirm during the title card did not open the briefing');
    g6 = mk(); press(g6, 'fire'); ok(g6.mods.quest.dlgEngine.dlg, 'fire / tap during the title card did not open the briefing');
    g6 = mk(); press(g6, 'back'); ok(g6.state.scene === 'play' && !g6.mods.quest.briefingPending(), 'back during the title card did not skip the briefing');
    g6 = mk(); press(g6, 'pause');
    ok(g6.mods.ui.menuOpen === 'pause' && g6.mods.ui.heldDlg && g6.mods.ui.pauseItems().includes('SKIP BRIEFING'), 'pause during the title card: no BRIEFING ON HOLD / SKIP BRIEFING');
    g6.mods.ui.closeMenus(false); ok(g6.mods.quest.dlgEngine.dlg, 'briefing lost after pausing during the title card');
    // tools/screenshot.mjs --skipDialogue: `while (scene === 'dialogue' && quest.dlg) advance()` must skip a staged briefing
    g6 = mk(); const Qs = g6.mods.quest;
    for (let k = 0; k < 60 && g6.state.scene === 'dialogue' && Qs.dlg; k++) Qs.advance();
    ok(g6.state.scene === 'play' && !Qs.briefingPending(), 'tool skip loop left the staged briefing open');
    // ui's skip loop does the same
    g6 = mk(); g6.mods.ui.skipDialogue(g6); ok(g6.state.scene === 'play' && !g6.mods.quest.briefingPending(), 'ui skipDialogue left the staged briefing open');
  }
  // deep links seed the quest log a pilot would have on the shortest route
  {
    const g7: any = createGame({ headless: true }); g7.autopilot = false; const Q7 = g7.mods.quest;
    g7.mods.world.enterArea('docks', 0); Q7.skipAll();
    const route = Q7.routeTo('docks'); ok(route[0] === content.start && route[route.length - 1] === 'docks', `routeTo(docks) = ${route.join('>')}`);
    for (const q of Q7.quests()) {
      const certain = ['area:enter', 'wave:clear', 'boss:start', 'boss:defeat', 'area:clear'].includes(q.start.on) && (!q.start.match?.areaId || route.slice(0, -1).includes(q.start.match.areaId));
      if (certain && !q.start.match?.areaId && q.start.on === 'area:enter') continue;
      if (certain) ok(g7.state.quests[q.id] === 'active' || g7.state.quests[q.id] === 'done', `deep link to docks: quest ${q.id} (starts on ${q.start.on}) not seeded`);
    }
    ok(Q7.tracked(), 'deep link to docks: HUD has no quest to track');
    ok(!g7.errors.length, 'seedRoute raised errors: ' + g7.errors.map((e: any) => e.message).join('; '));
  }
  // the HUD does not spoil a NEW QUEST toast that is still held behind the briefing
  {
    const g8: any = createGame({ headless: true }); g8.autopilot = false; const Q8 = g8.mods.quest;
    g8.mods.world.enterArea('alley', 0);
    const pend = Q8.quests().find((q: any) => g8.state.quests[q.id] === 'active' && !Q8.revealed(q.id));
    if (pend) {
      ok(Q8.tracked()?.id !== pend.id, `tracked() shows ${pend.id} before its NEW QUEST toast`);
      Q8.skipAll(); for (let i = 0; i < 400 && !Q8.revealed(pend.id); i++) g8.step();
      ok(Q8.revealed(pend.id) && Q8.tracked()?.id === pend.id, `tracked() never switched to ${pend.id} after its toast`);
    }
  }
  // boss banter: optional taunt-<bossId> on arrival, defeat-<bossId> opens the outro
  {
    const extra = [
      { id: 'taunt-boss_whiskers', speaker: 'Sergeant Whiskers', portrait: 'cat_tabby', text: 'Probe taunt.' },
      { id: 'defeat-boss_whiskers', speaker: 'Sergeant Whiskers', portrait: 'cat_tabby', text: 'Probe defeat.' },
    ];
    const g9: any = createGame({ headless: true, content: { ...RAW, dialogue: [...(RAW.dialogue as any[]), ...extra] } }); g9.autopilot = false; const Q9 = g9.mods.quest;
    g9.mods.world.enterArea('backyard', 1); Q9.skipAll(); g9.mods.world.titleCard = 0;
    g9.bus.emit('boss:start', { bossId: 'boss_whiskers' }); ok(Q9.dlg?.node.id === 'taunt-boss_whiskers', 'boss taunt not played on boss:start');
    Q9.skipAll(); let fin = 0;
    const outro = W.area('backyard')?.outro;
    if (outro) {
      Q9.dialogue(outro, () => fin++); ok(Q9.dlg?.node.id === 'defeat-boss_whiskers', 'boss defeat line does not open the outro');
      Q9.advance(); Q9.advance(); ok(Q9.dlg?.node.id === outro, 'outro did not follow the boss defeat line');
      Q9.skipAll(); ok(fin === 1 && !Q9.briefingPending(), 'outro callback lost after the boss defeat line');
    }
  }
  // tracked(): the sector's own quest wins over long-running ones; goal() gives a readable line
  const ids = content.quests.map(q => q.id);
  if (ids.includes('night_owl') && ids.includes('boop_brigade')) {
    const g2: any = createGame({ headless: true }); g2.autopilot = true;
    g2.mods.world.enterArea('rooftops', 0); g2.mods.quest.skipAll(); g2.mods.world.titleCard = 0; for (let i = 0; i < 3; i++) g2.step();
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
    ok(g3.state.quests.secret_route === 'missed', `secret_route state is "${g3.state.quests.secret_route}" after the moon branch, not 'missed' (journal reads state)`);
    ok(Q3.goal({ id: 'secret_route' }) === 'NEXT FLIGHT!', 'goal() of a missed quest');
    // missed is terminal: reaching the nebula later (deep link) does not reopen or pay it
    g3.bus.emit('area:enter', { areaId: 'nebula', waveIndex: 0 });
    ok(g3.state.quests.secret_route === 'missed' && !g3.state.flags.nebula_visited, 'a missed quest completed after its window closed');
    // conditions can test it
    ok(evalCond({ quest: 'secret_route', is: 'missed' as any }, g3.state), '{quest, is: "missed"} condition false for a missed quest');
  }
  // the run ending closes every quest still open as missed (quietly), and leaves done ones alone
  {
    const g5: any = createGame({ headless: true }); const Q5 = g5.mods.quest;
    g5.mods.world.enterArea(content.start, 0); Q5.skipAll();
    const open0 = Object.keys(g5.state.quests).filter(id => g5.state.quests[id] === 'active');
    ok(open0.length > 0, 'no quest active in the start sector (ending sweep untested)');
    Q5.complete({ id: open0[0] });
    const toasts0 = Q5.heldToasts().length;
    g5.bus.emit('ending', { endingId: 'ending_good' });
    const left = Object.keys(g5.state.quests).filter(id => g5.state.quests[id] === 'active');
    ok(!left.length, `quests still active after the ending event: ${left.join(', ')}`);
    ok(g5.state.quests[open0[0]] === 'done', 'ending sweep touched a done quest');
    ok(open0.slice(1).every(id => g5.state.quests[id] === 'missed'), 'ending sweep did not mark open quests missed');
    ok(Q5.heldToasts().length === toasts0, 'ending sweep queued MISSED toasts behind the ending');
    // a save from before 'missed' was a state (active + the old marker) loads as missed; a save written at the
    // ending (quests still active: the save runs before the ending event) loads with nothing open
    const g6: any = createGame({ headless: true }); const Q6 = g6.mods.quest;
    g6.ops.setQuest('secret_route', 'active'); g6.state.inventory._qx_secret_route = 1; Q6.check();
    ok(g6.state.quests.secret_route === 'missed' && !g6.state.inventory._qx_secret_route, 'legacy missed marker not migrated to state missed');
    g6.ops.setQuest('lost_pups', 'active'); g6.state.ending = 'ending_good'; Q6.check();
    ok(g6.state.quests.lost_pups === 'missed', 'loading a save written at the ending left a quest active');
    // a deep link to the moon closes secret_route quietly (no MISSED toast on a tool / showcase jump)
    const g7m: any = createGame({ headless: true }); g7m.mods.world.enterArea('moon', 0);
    ok(g7m.state.quests.secret_route === 'missed' && !g7m.mods.quest.heldToasts().some((t: string) => /MISSED/.test(t)), 'deep link to moon: secret_route not closed quietly');
    // run-end closures read softer than route forfeits (journal / HUD presentation)
    ok(Q5.look(open0[1] ?? open0[0]).tone === (open0[1] ? 'expired' : 'done'), `run-end closure tone is ${Q5.look(open0[1] ?? '').tone}, not expired`);
    ok(g7m.mods.quest.look('secret_route').tone === 'missed' && g7m.mods.quest.look('secret_route').tag === 'MISSED: NEXT FLIGHT', 'route forfeit does not read MISSED: NEXT FLIGHT');
    if (open0[1]) ok(Q5.goal({ id: open0[1] }) === 'NOT THIS FLIGHT', `goal() of a run-end closure is ${Q5.goal({ id: open0[1] })}`);
    // deep links past the branch: the station seeds secret_route closed (moon route) and the bonanza quest started
    const g7s: any = createGame({ headless: true }); g7s.autopilot = false; g7s.mods.world.enterArea('station', 0);
    const rs = g7s.mods.quest.routeTo('station');
    const wantS = rs.includes('nebula') ? 'done' : 'missed';
    ok(g7s.state.quests.secret_route === wantS, `deep link to station (${rs.join('>')}): secret_route is ${g7s.state.quests.secret_route}, not ${wantS}`);
    if (content.quests.some(q => q.id === 'bonanza_star')) ok(g7s.state.quests.bonanza_star === 'active', `deep link to station: bonanza_star is ${g7s.state.quests.bonanza_star}, not active`);
    // a deep link to the nebula finishes the route quietly
    const g7n: any = createGame({ headless: true }); g7n.autopilot = false; g7n.mods.world.enterArea('nebula', 0);
    ok(g7n.state.quests.secret_route === 'done', `deep link to nebula: secret_route is ${g7n.state.quests.secret_route}, not done`);
    // the browser autopilot (screenshot deep links) seeds too; the headless bot does not
    const g7a: any = createGame({ headless: true }); g7a.autopilot = true; g7a.mods.world.enterArea('sky', 0);
    ok(!g7a.state.quests.big_cats, 'headless autopilot deep link was seeded (bot / tests expect a clean log)');
  }
  // the sector map telegraphs a route choice that closes a quest, and starts the cursor on the finishing hop
  if (ids.includes('secret_route')) {
    const gm: any = createGame({ headless: true }); gm.autopilot = false; const Qm = gm.mods.quest;
    gm.mods.world.enterArea('sky', 0); Qm.skipAll();
    for (const m of content.memories.slice(0, 6)) gm.ops.addMemory(m.id);
    const ex = gm.mods.world.exitsFrom('sky'); const neb = ex.findIndex((e: any) => e.to === 'nebula');
    ok(neb >= 0, 'memory gate did not open the nebula exit');
    ok(Qm.completes('nebula').some((q: any) => q.id === 'secret_route') && Qm.forfeits('moon').some((q: any) => q.id === 'secret_route'), 'completes()/forfeits() do not name secret_route');
    ok(Qm.routeNote('nebula')?.good === true && Qm.routeNote('moon')?.good === false && /CLOSES/.test(Qm.routeNote('moon')?.text ?? ''), `routeNote: ${JSON.stringify([Qm.routeNote('nebula'), Qm.routeNote('moon')])}`);
    ok(Qm.preferredExit(ex) === neb, `preferredExit = ${Qm.preferredExit(ex)}, not the nebula hop ${neb}`);
    const seen: string[] = []; const t0 = gm.mods.ui.toast.bind(gm.mods.ui); gm.mods.ui.toast = (x: string) => { seen.push(x); t0(x); };
    gm.state.areasCleared.push('sky'); gm.setScene('map');
    const heads = [...seen, ...Qm.heldToasts()].join(' | ');
    ok(Qm.heldToasts().filter((t: string) => /ROUTE OPEN!$/.test(t) && !/NEBULA|SECRET/.test(t)).length <= 1, `ROUTE OPEN toast repeated per memory: ${Qm.heldToasts().join(' | ')}`);
    ok(/HOP FINISHES/.test(heads) && /HOP CLOSES/.test(heads), `map arrival does not telegraph the route choice: ${heads}`);
    gm.step(); gm.step();
    ok(gm.mods.ui.mapSel === neb, `map cursor starts on ${gm.mods.ui.mapSel}, not the nebula hop`);
    // gate shut: say how far the route is instead
    const gc: any = createGame({ headless: true }); gc.autopilot = false; gc.mods.world.enterArea('sky', 0); gc.mods.quest.skipAll();
    const seenC: string[] = []; const tc = gc.mods.ui.toast.bind(gc.mods.ui); gc.mods.ui.toast = (x: string) => { seenC.push(x); tc(x); };
    gc.state.areasCleared.push('sky'); gc.setScene('map');
    const allC = [...seenC, ...gc.mods.quest.heldToasts()];
    ok(allC.some((t: string) => /SEALED, \d/.test(t)), `sealed route not announced on the map: ${allC.join(' | ')}`);
    // a forfeit toast is read before a NEW QUEST toast that arrives with it
    const gt: any = createGame({ headless: true }); gt.autopilot = false; gt.mods.world.enterArea('sky', 0); gt.mods.quest.skipAll();
    gt.mods.world.enterArea('moon', 0);
    const order = gt.mods.quest.heldToasts(); const im = order.findIndex((t: string) => /MISSED/.test(t)), iq = order.findIndex((t: string) => /NEW QUEST/.test(t));
    if (im >= 0 && iq >= 0) ok(im < iq, `moon arrival: MISSED toast queued behind NEW QUEST (${order.join(' | ')})`);
  }
  // one flight can reach at most this many quests (branch quests on the other side stay sealed)
  {
    const gf: any = createGame({ headless: true }); const fm = gf.mods.quest.flightMax();
    ok(fm > 0 && fm <= content.quests.length, `flightMax() = ${fm}`);
    log.push(`  flightMax: ${fm}/${content.quests.length} quests reachable in one flight`);
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
    const tags = Q4.showSheet(); ok(tags.length >= 5, `dialogue review sheet has ${tags.length} states`);
    ok(!Q4.dlg && !g4.errors.length, 'review sheet left the engine busy or raised errors');
    Q4.showSheet(false);
  }
  // sector quests measure progress in the HUD's own stages (waves + boss), and finish on clearing the sector
  {
    const g5: any = createGame({ headless: true }); g5.autopilot = true; const Q5 = g5.mods.quest;
    for (const q of Q5.quests()) {
      const sg = Q5.stages(q); if (!sg) continue;
      const a = content.areas.find(x => x.id === sg.areaId)!;
      g5.mods.world.enterArea(a.id, 0); Q5.skipAll(); Q5.start(q.id);
      const tot = a.waves.length + (a.boss ? 1 : 0);
      ok(Q5.progress(q).need === tot && Q5.progress(q).have === 0, `quest ${q.id}: progress ${JSON.stringify(Q5.progress(q))} does not match the HUD's ${tot} stages`);
      g5.state.waveIndex = 3; ok(Q5.progress(q).have === 3, `quest ${q.id}: progress does not follow cleared stages`);
    }
    for (const q of Q5.quests()) if (/every wave/i.test(q.desc)) ok(q.complete.on === 'area:clear', `quest ${q.id}: "every wave" does not finish on area:clear`);
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
