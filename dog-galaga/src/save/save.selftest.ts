// Save reliability self-test. Pure headless: no DOM, no real localStorage.
// Wire from tests/ (integrator-owned):
//   import { saveSelftest } from '../src/save/save.selftest';
//   it('save selftest', () => { const r = saveSelftest(); expect(r.filter(c => !c.ok)).toEqual([]); });
import { createGame } from '../core/boot';
import { makeApi } from '../core/api';
import { STATE_VERSION } from '../core/state';
import type { Game } from '../core/game';
import { checksum, encodeEnvelope, migrate, toExportString, type Migration } from './codec';
import { memStorage, type Storage } from './storage';
import { KEYS, BURST, REFILL, FALLBACK_TOAST, FUTURE_TOAST, indicatorPos } from './index';
import { FLOPPY, FLOPPY7 } from './indicator';
import { IND_W, IND_H } from './indicator';
import { W, H, PF_X, PF_W } from '../core/game';

export interface SelftestCase { name: string; ok: boolean; detail?: string }

class Fail extends Error {}
function check(cond: unknown, msg: string): asserts cond { if (!cond) throw new Fail(msg); }
function eq(a: unknown, b: unknown, msg: string) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Fail(`${msg}: got ${x}, want ${y}`); }

const S = (g: Game) => g.mods.save;
const fresh = () => createGame({ headless: true });
/** a second "process" that shares the first one's storage (the quit / relaunch boundary) */
function relaunch(store: Storage): Game { const g = fresh(); S(g).store = store; S(g).restoreSettings(); return g; }
function stepN(g: Game, n: number) { for (let i = 0; i < n; i++) g.step(); }
/** close the sector intro dialogue the way a player tapping through it would */
function skipDialogue(g: Game) { for (let n = 0; n < 80 && g.mods.quest?.dlg; n++) g.mods.quest.advance(); }
function playUntil(g: Game, pred: () => boolean, max = 60 * 60 * 20) {
  for (let i = 0; i < max && !pred(); i++) { if (g.state.scene === 'map') { const ex = g.mods.world.exitsFrom(g.state.areaId); g.mods.world.chooseExit(ex[0].to); } g.step(); }
}
/** tiny deterministic PRNG for fuzz input (Math.random is banned in src/) */
function lcg(seed: number) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }
/** storage that fails like a real browser can */
function hostile(kind: 'blocked' | 'quota', cap = 0): Storage {
  const m = new Map<string, string>(); const size = () => [...m.values()].reduce((n, v) => n + v.length, 0);
  const deny = () => { const e = new Error('denied'); e.name = 'SecurityError'; throw e; };
  if (kind === 'blocked') return { get: deny, set: deny, del: deny };
  return {
    get: k => m.get(k) ?? null, del: k => void m.delete(k),
    set: (k, v) => { const prev = m.get(k)?.length ?? 0; if (size() - prev + v.length > cap) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } m.set(k, v); },
  };
}
const STATUSES = ['ok', 'recovered', 'corrupt', 'none'];

const CASES: [string, () => void][] = [
  ['save mid-wave, quit, resume reproduces area/wave/score/quests/memories', () => {
    const g = fresh(); makeApi(g).autopilot(true);
    g.mods.world.newGame();
    playUntil(g, () => g.state.waveIndex >= 2 && g.state.scene === 'play');
    check(g.state.waveIndex >= 2 && g.tick > 600, `autopilot reached wave ${g.state.waveIndex} at tick ${g.tick}`);
    stepN(g, 90); // mid-wave: cats on screen, score moving
    g.ops.setQuest('selftest_q', 'active'); g.ops.addMemory(g.content.memories[0]?.id ?? 'mem_selftest'); g.ops.addScore(4321); g.ops.setFlag('selftest_flag');
    // SAVE & QUIT, exactly as ui does it
    S(g).save(); g.mods.interaction?.clearAll(); g.setScene('title');
    check(!S(g).pending, 'leaving for the title flushes the queued save');
    const snap = JSON.parse(JSON.stringify(g.state));
    const g2 = relaunch(S(g).store);
    check(S(g2).hasSave(), 'relaunched game sees the save');
    eq(S(g2).load(), 'ok', 'load status');
    eq(g2.state.areaId, snap.areaId, 'area'); eq(g2.state.waveIndex, snap.waveIndex, 'wave');
    eq(g2.state.score, snap.score, 'score'); eq(g2.state.hiScore, snap.hiScore, 'hi score');
    eq(g2.state.quests, snap.quests, 'quests'); eq(g2.state.memories, snap.memories, 'memories');
    eq(g2.state.flags, snap.flags, 'flags'); eq(g2.state.stats, snap.stats, 'stats');
    eq(g2.state.version, STATE_VERSION, 'version'); eq(g2.state.scene, 'play', 'scene');
    makeApi(g2).autopilot(true); stepN(g2, 600);
    eq(g2.errors, [], 'resumed game runs without errors');
  }],

  ['write throttle: bursts coalesce, last state always lands', () => {
    const g = fresh(); g.mods.world.newGame(); stepN(g, REFILL * (BURST + 1));
    const w0 = S(g).writes;
    for (let i = 1; i <= 20; i++) { g.state.score = i; S(g).save(); }
    check(S(g).writes - w0 <= BURST, `20 saves in one frame wrote ${S(g).writes - w0} times (max ${BURST})`);
    check(S(g).pending, 'the rest is queued');
    stepN(g, REFILL + 1);
    check(!S(g).pending, 'queued save written within a second');
    eq(S(g).decode(S(g).store.get(KEYS.MAIN)).score, 20, 'stored score is the latest');
    const w1 = S(g).writes; S(g).save(); S(g).save();
    eq(S(g).writes, w1, 'unchanged state is not rewritten');
    // a queued save is flushed immediately when leaving for the title
    stepN(g, REFILL * (BURST + 1));
    for (let i = 0; i < BURST + 2; i++) { g.state.score = 100 + i; S(g).save(); }
    g.setScene('title');
    eq(S(g).decode(S(g).store.get(KEYS.MAIN)).score, 100 + BURST + 1, 'flush on quit');
  }],

  ['corrupt main falls back to backup and repairs main', () => {
    const g = fresh(); g.mods.world.newGame(); stepN(g, REFILL * (BURST + 1));
    g.state.score = 1234; S(g).save(); g.state.score = 5678; S(g).save();
    const bad = '{"v":1,"data":"{bad json","sum":"x"}';
    S(g).store.set(KEYS.MAIN, bad);
    let recovered = 0; g.bus.on('save:recovered', () => { recovered++; });
    const g2 = relaunch(S(g).store); g2.bus.on('save:recovered', () => { recovered++; });
    eq(S(g2).load(), 'recovered', 'status'); eq(g2.state.score, 1234, 'score from backup'); eq(recovered, 1, 'save:recovered emitted');
    check(S(g2).decode(S(g2).store.get(KEYS.MAIN)), 'main rewritten as a valid save');
    check((S(g2).store.get(KEYS.QUARANTINE) ?? '').includes('bad json'), 'damaged main kept in quarantine');
    // bit flip inside a valid envelope is caught by the checksum
    const env = JSON.parse(S(g2).store.get(KEYS.MAIN)!); env.data = env.data.replace('"score":1234', '"score":9999');
    S(g2).store.set(KEYS.MAIN, JSON.stringify(env));
    eq(S(g2).load(), 'recovered', 'tampered main rejected'); eq(g2.state.score, 1234, 'backup used');
  }],

  ['both corrupt shows recovery and never throws; salvage and start fresh work', () => {
    const g = fresh(); g.mods.world.newGame(); g.state.score = 777; S(g).save();
    const good = S(g).store.get(KEYS.MAIN)!;
    const store = S(g).store;
    store.set(KEYS.MAIN, 'garbage'); store.set(KEYS.BACKUP, 'garbage too');
    const g2 = relaunch(store);
    eq(S(g2).load(), 'corrupt', 'status'); eq(g2.state.scene, 'recovery', 'scene');
    eq(S(g2).info().main, 'corrupt', 'info main');
    check(!S(g2).save(), 'no writes while the recovery screen is up');
    eq(store.get(KEYS.MAIN), 'garbage', 'damaged data untouched');
    // "try backup" again with a salvageable save (checksum broken, data intact)
    const env = JSON.parse(good); env.sum = 'nope'; store.set(KEYS.MAIN, JSON.stringify(env));
    eq(S(g2).info().main, 'damaged', 'info sees a damaged-but-parseable save');
    eq(S(g2).load(), 'recovered', 'salvaged from the recovery screen'); eq(g2.state.score, 777, 'salvaged score');
    // outside the recovery screen, a broken checksum is never trusted
    store.set(KEYS.MAIN, JSON.stringify(env)); store.set(KEYS.BACKUP, 'x');
    const g3 = relaunch(store); eq(S(g3).load(), 'corrupt', 'checksum required on normal load');
    // start fresh
    S(g3).wipe(); g3.setScene('title');
    check(!S(g3).hasSave(), 'wipe clears main and backup'); check(store.get(KEYS.QUARANTINE), 'quarantine survives a wipe');
    eq(S(g3).load(), 'none', 'nothing to load');
    eq([...g2.errors, ...g3.errors], [], 'no errors reported');
  }],

  ['recovery screen options and START FRESH keep the high score and settings', () => {
    const g = fresh(); g.mods.world.newGame(); g.ops.addScore(48200); g.state.settings.music = 0.25; S(g).save();
    eq(g.state.hiScore, 48200, 'hi score set');
    const store = S(g).store; const good = store.get(KEYS.MAIN)!;
    // both slots unreadable: the hi score still comes back on the next boot (keepsake), START FRESH keeps it
    store.set(KEYS.MAIN, 'chewed'); store.set(KEYS.BACKUP, 'also chewed');
    const g2 = relaunch(store);
    eq(g2.state.hiScore, 48200, 'title shows the kept hi score before CONTINUE');
    eq(S(g2).load(), 'corrupt', 'recovery');
    let o = S(g2).recoveryOptions();
    eq([o.primary, o.rows, o.status, o.doomed], ['START FRESH', ['START FRESH'], 'MAIN: CHEWED  BACKUP: CHEWED', true], 'nothing left: START FRESH is the only option');
    S(g2).wipe(); g2.setScene('title');
    eq(g2.state.hiScore, 48200, 'hi score survives START FRESH');
    const g3 = relaunch(store); eq([g3.state.hiScore, g3.state.settings.music], [48200, 0.25], 'hi score and settings survive a relaunch after the wipe');
    g3.mods.world.newGame(); eq(g3.state.hiScore, 48200, 'new game keeps it'); eq(g3.state.score, 0, 'score resets');
    // keepsake lost too: the hi score is read from a nibbled save (checksum broken, data intact)
    const env = JSON.parse(good); env.sum = 'nope'; store.set(KEYS.MAIN, JSON.stringify(env)); store.del(KEYS.KEEP);
    const g4 = relaunch(store); eq(g4.state.hiScore, 48200, 'hi score read from a damaged slot');
    eq(S(g4).load(), 'corrupt', 'still needs the recovery screen');
    o = S(g4).recoveryOptions();
    eq([o.primary, o.rows, o.status, o.doomed], ['PATCH UP MY SAVE', ['PATCH UP MY SAVE', 'START FRESH'], 'MAIN: NIBBLED  BACKUP: GONE', false], 'damaged slot: patch up');
    eq(o.recoveredToast('salvage'), 'SAVE PATCHED UP. GOOD AS NEW', 'salvage toast');
    // a good backup: try backup
    const g5 = fresh(); g5.mods.world.newGame(); S(g5).save(); g5.state.score = 3; S(g5).save();
    S(g5).store.set(KEYS.MAIN, 'x'); eq(S(g5).recoveryOptions().primary, 'TRY BACKUP SAVE', 'backup safe');
    eq([...g.errors, ...g2.errors, ...g3.errors, ...g4.errors], [], 'no errors');
  }],

  ['save never reorders g.modules mid-step; notices never stack; indicator stays in the HUD grid', () => {
    const g = fresh(); const order = g.modules.map(m => m.id);
    let updates = 0; const orig = S(g).update.bind(S(g)); S(g).update = (gg: Game) => { updates++; orig(gg); };
    g.mods.world.newGame(); stepN(g, 10);
    eq(g.modules.map(m => m.id), order, 'module order untouched by update()');
    eq(updates, 10, 'save.update runs exactly once per step');
    // two notices arrive on the same frame: shown one after the other, never stacked
    const shown: [string, number][] = []; const ui = g.mods.ui; const t0 = ui.toast.bind(ui);
    ui.toast = (t: string) => { shown.push([t, g.tick]); t0(t); };
    skipDialogue(g); stepN(g, 200); shown.length = 0;
    (S(g) as any).notify('ONE'); (S(g) as any).notify('TWO');
    stepN(g, 300);
    eq(shown.map(x => x[0]), ['ONE', 'TWO'], 'both shown in order');
    check(shown[1][1] - shown[0][1] >= 100, `spaced out (${shown[1][1] - shown[0][1]} ticks)`);
    // indicator placement: right-aligned to the right panel's text column, clear of the touch deck
    const col = PF_X + PF_W + 118;
    const kb = indicatorPos('play', false), tc = indicatorPos('play', true), ti = indicatorPos('title', false);
    eq([kb.x + IND_W, kb.y + IND_H], [col, H - 10], 'keyboard: beside FLIGHT TIME, above the inner frame');
    eq(tc.x + IND_W, col, 'touch: same column'); eq(tc.y + IND_H / 2, 242, 'touch: centred on the ACTION header rule (y 241)');
    check(tc.y > 232 && tc.y + IND_H + 1 < 252, 'touch: between the deck divider (232) and the PAUSE pill (252)');
    eq([ti.x + IND_W, ti.y + IND_H], [W - 8, H - 8], 'title: bottom-right corner');
    eq([IND_W, IND_H], [16, 16], '16px grid');
  }],

  ['fuzz: truncated and random saves never throw', () => {
    const g = fresh(); g.mods.world.newGame(); S(g).save();
    const good = S(g).store.get(KEYS.MAIN)!; const rnd = lcg(42);
    const inputs: string[] = [];
    for (let n = 0; n < good.length; n += Math.max(1, good.length >> 6)) inputs.push(good.slice(0, n));
    for (let i = 0; i < 40; i++) { let s = ''; const len = (rnd() * 200) | 0; for (let j = 0; j < len; j++) s += String.fromCharCode((rnd() * 0xffff) | 0); inputs.push(s); }
    inputs.push('null', '[]', '{}', '{"data":5}', '{"v":"x","data":"null","sum":"' + checksum('null') + '"}', '{"v":1,"data":"[1,2]","sum":"' + checksum('[1,2]') + '"}');
    for (const s of inputs) {
      const g2 = fresh(); S(g2).store.set(KEYS.MAIN, s); S(g2).store.set(KEYS.BACKUP, s.slice(1));
      let r: string; try { r = S(g2).load(); } catch (e) { throw new Fail(`load threw on ${JSON.stringify(s.slice(0, 40))}: ${e}`); }
      check(STATUSES.includes(r), `status ${r}`);
      if (r === 'corrupt') check(g2.state.scene === 'recovery', 'corrupt -> recovery');
      try { S(g2).importString(s); } catch (e) { throw new Fail(`import threw: ${e}`); }
    }
  }],

  ['localStorage unavailable: in-memory store and a friendly toast', () => {
    const g = fresh(); const toasts: string[] = []; const ui = g.mods.ui; const orig = ui.toast.bind(ui);
    ui.toast = (t: string) => { toasts.push(t); orig(t); };
    S(g).useStorage(null);
    check(!S(g).info().persistent, 'falls back to memory');
    g.mods.world.newGame(); g.state.score = 42; S(g).save(); g.step();
    // the notice waits for a calm moment: never over the intro dialogue or the sector title card
    eq(toasts.filter(t => t === FALLBACK_TOAST.blocked).length, 0, 'no toast over the intro / title card');
    skipDialogue(g); stepN(g, 200);
    eq(toasts.filter(t => t === FALLBACK_TOAST.blocked).length, 1, 'one friendly toast once the title card is gone');
    check(!toasts.some(t => /STORAGE|MEMORY/.test(t)), 'cozy wording, no tech words');
    eq(S(g).decode(S(g).store.get(KEYS.MAIN)).score, 42, 'save kept in memory');
    eq(S(g).load(), 'ok', 'loads from memory');
    // a store that throws SecurityError on every call
    const g2 = fresh(); S(g2).useStorage(hostile('blocked'));
    g2.mods.world.newGame(); S(g2).save(); stepN(g2, 30);
    check(S(g2).notices.includes(FALLBACK_TOAST.blocked), 'blocked notice');
    check(S(g2).hasSave(), 'memory save present'); eq([...g.errors, ...g2.errors], [], 'no errors');
  }],

  ['quota exceeded: frees space, then falls back to memory and keeps playing', () => {
    const probe = fresh(); probe.mods.world.newGame(); const one = probe.mods.save.encode().length;
    // room for one save but not two: dropping the backup makes room, still persistent
    const g = fresh(); S(g).useStorage(hostile('quota', Math.floor(one * 1.6)));
    g.mods.world.newGame(); g.state.score = 1; S(g).save(); g.state.score = 2; S(g).save();
    check(S(g).info().persistent, 'still persistent after freeing the backup');
    check(!S(g).notices.length, 'no toast while still persistent');
    eq(S(g).decode(S(g).store.get(KEYS.MAIN)).score, 2, 'latest save written');
    // no room at all
    const g2 = fresh(); makeApi(g2).autopilot(true); S(g2).useStorage(hostile('quota', 64));
    g2.mods.world.newGame(); stepN(g2, 600);
    check(!S(g2).info().persistent, 'memory fallback');
    check(S(g2).notices.includes(FALLBACK_TOAST.full), 'quota toast queued');
    g2.state.score = 31337; S(g2).flush(); S(g2).save(); g2.setScene('title');
    eq(S(g2).load(), 'ok', 'session save loads from memory'); eq(g2.state.score, 31337, 'score kept');
    eq([...g.errors, ...g2.errors], [], 'no errors');
  }],

  ['migrations: chained steps, legacy v0, saves from a newer build', () => {
    const table: Record<number, Migration> = { 1: d => ({ ...d, hearts2: d.hearts }), 2: d => ({ ...d, renamed: d.hearts2, hearts2: undefined }) };
    const m = migrate({ hearts: 3 }, 1, 3, table);
    eq([m.data.renamed, m.data.version, m.future], [3, 3, false], 'chain 1->2->3');
    eq(migrate({ a: 1 }, 5, 3, table).future, true, 'future flagged');
    // legacy: bare state object with no envelope
    const g = fresh(); g.mods.world.newGame(); g.state.score = 99; g.state.waveIndex = 1;
    const bare = JSON.stringify({ ...g.state, version: undefined, scene: undefined });
    const g2 = fresh(); S(g2).store.set(KEYS.MAIN, bare);
    eq(S(g2).load(), 'ok', 'legacy loads'); eq([g2.state.score, g2.state.version], [99, STATE_VERSION], 'legacy migrated');
    // newer build: load best effort, keep the original, tell the player
    const g3 = fresh(); const fut = encodeEnvelope({ ...g.state, version: STATE_VERSION + 1, shinyNewField: 1 }, 0, STATE_VERSION + 1);
    S(g3).store.set(KEYS.MAIN, fut);
    eq(S(g3).load(), 'ok', 'future loads'); eq(g3.state.score, 99, 'future score');
    eq(S(g3).store.get(KEYS.FUTURE), fut, 'original kept'); check(S(g3).notices.includes(FUTURE_TOAST), 'future toast');
  }],

  ['export / import save string', () => {
    const g = fresh(); g.mods.world.newGame(); g.state.score = 2468; g.ops.addMemory('mem_x'); S(g).save();
    const code = S(g).exportString();
    check(code.startsWith('POODLE1:') && /^[A-Za-z0-9_:-]+$/.test(code.slice(8)), 'url-safe code');
    const g2 = fresh();
    eq(S(g2).importString('\n  ' + code.slice(0, 30) + '\n' + code.slice(30) + '  '), 'ok', 'import with whitespace');
    eq([g2.state.score, g2.state.memories], [2468, ['mem_x']], 'imported state');
    const before = S(g2).store.get(KEYS.MAIN);
    eq(S(g2).importString('POODLE1:not-a-save'), 'corrupt', 'bad code'); eq(S(g2).importString(code.slice(0, -6)), 'corrupt', 'truncated code');
    eq(S(g2).store.get(KEYS.MAIN), before, 'bad code changes nothing'); check(g2.state.scene !== 'recovery', 'no recovery screen');
    // older plain-base64 codes still import
    const g3 = fresh(); eq(S(g3).importString(btoa(S(g).encode())), 'ok', 'legacy base64');
    // stored save exports even before CONTINUE
    const g4 = relaunch(S(g).store); check(S(g4).exportString().startsWith('POODLE1:'), 'export from title');
    void toExportString;
  }],

  ['title-screen settings never overwrite progress, and survive a relaunch', () => {
    const g = fresh(); g.mods.world.newGame(); g.state.score = 5555; S(g).save();
    const g2 = relaunch(S(g).store); g2.setScene('title');
    g2.state.settings.music = 0.1; S(g2).save();
    const stored = S(g2).decode(S(g2).store.get(KEYS.MAIN));
    eq([stored.score, stored.settings.music], [5555, 0.1], 'progress kept, settings patched');
    const g3 = relaunch(S(g).store); eq(g3.state.settings.music, 0.1, 'settings restored on boot');
    // no save yet: settings go to their own key
    const g4 = fresh(); g4.setScene('title'); g4.state.settings.sfx = 0.3; S(g4).save();
    check(!S(g4).hasSave(), 'no fake save created');
    eq(relaunch(S(g4).store).state.settings.sfx, 0.3, 'settings-only restore');
    // settings-only writes never blink the floppy (the title may read CONTINUE [NO SAVE])
    eq(S(g4).blink, 0, 'no floppy for a settings-only write'); eq(S(g2).blink, 0, 'no floppy for a settings patch');
    g.mods.world.newGame(); S(g).flush(); g.state.score = 1; S(g).save(); check(S(g).blink > 0, 'a real save blinks');
  }],

  ['recovery: nothing left -> one START FRESH row; load(slot) as documented; salvage in one press', () => {
    const g = fresh(); g.mods.world.newGame(); S(g).save();
    const store = S(g).store; store.set(KEYS.MAIN, 'chewed'); store.set(KEYS.BACKUP, 'chewed too');
    const g2 = relaunch(store);
    eq(S(g2).load(), 'corrupt', 'recovery'); check(S(g2).recoveryOptions().doomed, 'doomed');
    eq(S(g2).recoveryOptions().rows, ['START FRESH'], 'no TRY AGAIN when nothing can be fetched');
    // ui's row 0 on a doomed card: load() fails at once (no two-press confirm), ui wipes and goes to the title
    eq(S(g2).load(), 'corrupt', 'row 0 = start fresh'); eq(g2.state.scene, 'recovery', 'still on the card until ui wipes');
    S(g2).wipe(); g2.setScene('title'); check(!S(g2).hasSave(), 'fresh start');
    eq(S(g2).recoveryOptions().status, 'MAIN: GONE  BACKUP: GONE', 'both gone');
    // load(slot): 'backup' starts from the backup; 'main' (default) prefers main; legacy boolean still works
    const g5 = fresh(); g5.mods.world.newGame(); g5.state.score = 10; S(g5).save(); S(g5).flush();
    g5.state.score = 20; S(g5).save(); S(g5).flush();
    const src5 = S(g5).store;
    // every relaunch gets its own copy (a resumed game autosaves on area enter and would rotate the slots)
    const st5 = () => { const m = memStorage(); for (const k of [KEYS.MAIN, KEYS.BACKUP]) { const v = src5.get(k); if (v) m.set(k, v); } return m; };
    const gm = relaunch(st5()); eq([S(gm).load('main'), gm.state.score], ['ok', 20], "load('main')");
    const gb = relaunch(st5()); eq([S(gb).load('backup'), gb.state.score], ['recovered', 10], "load('backup')");
    const gl = relaunch(st5()); eq([S(gl).load(false), gl.state.score], ['ok', 20], 'load(false): legacy resume flag');
    const gx = relaunch(st5()); eq(S(gx).load('nonsense' as any), 'ok', 'unknown slot name = main');
    // a salvageable slot is never doomed: one press patches it up
    const g3 = fresh(); g3.mods.world.newGame(); g3.state.score = 99; S(g3).save();
    const env = JSON.parse(S(g3).store.get(KEYS.MAIN)!); env.sum = 'x'; S(g3).store.set(KEYS.MAIN, JSON.stringify(env)); S(g3).store.del(KEYS.BACKUP);
    const g4 = relaunch(S(g3).store); eq(S(g4).load(), 'corrupt', 'needs recovery');
    eq(S(g4).load(), 'recovered', 'patched in one press'); eq(g4.state.score, 99, 'score back');
    eq([...g2.errors, ...g4.errors, ...gm.errors, ...gb.errors, ...gl.errors], [], 'no errors');
  }],

  ['storage notices fit one toast line; memory-only saves are flagged for the grey floppy; one floppy sprite', () => {
    for (const t of Object.values(FALLBACK_TOAST)) check(t.length <= 26, `toast too long: ${t}`);
    const g = fresh(); S(g).useStorage(hostile('blocked')); g.mods.world.newGame(); S(g).save();
    eq(S(g).info().persistent, false, 'memory-only store reported'); check(S(g).blink > 0, 'still acknowledges the save');
    const g2 = fresh(); g2.mods.world.newGame(); S(g2).save(); eq(S(g2).info().persistent, true, 'persistent store');
    eq([FLOPPY.length, ...new Set(FLOPPY.map(r => r.length))], [16, 16], '16x16 master');
    eq([FLOPPY7.length, ...new Set(FLOPPY7.map(r => r.length))], [7, 7], '7x7 glyph');
    eq(FLOPPY.filter(r => r.includes('7')).length, 7, '7-row label');
    eq([FLOPPY[0].slice(13), FLOPPY[1].slice(13), FLOPPY[2].slice(13)], ['0..', '30.', '330'], 'clean 2px diagonal notch');
    // paw: 3 toes + 1 pad, each a separate blob (4-connected components of 'P'), so it never reads as a face
    eq(blobs(FLOPPY, 'P'), 4, 'paw = 3 toes + 1 pad');
  }],
];

/** number of 4-connected blobs of `ch` in a sprite */
function blobs(rows: readonly string[], ch: string): number {
  const seen = new Set<string>(); let n = 0;
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) {
    if (rows[r][c] !== ch || seen.has(r + ',' + c)) continue;
    n++; const q = [[r, c]];
    while (q.length) {
      const [y, x] = q.pop()!; const k = y + ',' + x;
      if (seen.has(k) || rows[y]?.[x] !== ch) continue;
      seen.add(k); q.push([y + 1, x], [y - 1, x], [y, x + 1], [y, x - 1]);
    }
  }
  return n;
}

/** Runs every case; never throws. */
export function saveSelftest(only?: string): SelftestCase[] {
  const out: SelftestCase[] = [];
  for (const [name, fn] of CASES) {
    if (only && !name.includes(only)) continue;
    try { fn(); out.push({ name, ok: true }); }
    catch (e) { out.push({ name, ok: false, detail: e instanceof Error ? (e instanceof Fail ? e.message : e.stack ?? e.message) : String(e) }); }
  }
  return out;
}
void memStorage;
