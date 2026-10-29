// Headless-Chrome screenshot tool.
// node tools/screenshot.mjs --url=http://127.0.0.1:4173/ --out=shots/x --area=rooftops --tod=night --wave=2
//   --showcase=interaction --state='{"score":5}' --advance=300 --zoom=2 --wait=1500 --keys=ArrowLeft,Space
//   --showcase=interaction --stage=lineup|capturer|rescue|splitter|tank|dive|tell|boss|bullets|play [--at=N] [--phase=1|2]
//   --showcase=effects --fx=grid|strip|boss[-world] --fxt=N      --showcase=audio (waits until every render is done)
//   --skipDialogue: close any open dialogue (deep links open the intro) and only then run --advance ticks
// Writes <out>.png and <out>.json (console errors, page errors, game errors, fps, failed/external requests).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { const { execSync } = await import('node:child_process'); const g = execSync('npm root -g').toString().trim(); ({ chromium } = createRequire(g + '/')('playwright')); }
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || '1']; }));
const base = args.url ?? 'http://127.0.0.1:4173/';
const out = args.out ?? `shots/${args.showcase ?? args.area ?? args.scene ?? 'title'}-${args.tod ?? 'default'}`;
const zoom = +(args.zoom ?? 2);
const q = new URLSearchParams();
for (const k of ['area', 'wave', 'tod', 'showcase', 'scene', 'advance', 'seed', 'autopilot', 'node', 'menu', 'tab', 'filter', 'ending', 'ticks', 'freeze', 'fx', 'fxt', 'touch', 'stage', 'at', 'phase', 'sheet', 'viewer', 'hits']) if (args[k]) q.set(k, args[k]);
if (args.skipDialogue) { q.delete('advance'); q.delete('freeze'); }
if (args.state) q.set('state', Buffer.from(args.state).toString('base64'));
const url = base + (base.includes('?') ? '&' : '?') + q.toString();

const log = { url, consoleErrors: [], pageErrors: [], failedRequests: [], externalRequests: [], gameErrors: [], contentIssues: [], fps: null, scene: null, loadMs: null };
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 640 * zoom, height: 360 * zoom }, deviceScaleFactor: 1 });
page.on('console', m => { if (m.type() === 'error') log.consoleErrors.push(m.text()); });
page.on('pageerror', e => log.pageErrors.push(String(e)));
page.on('requestfailed', r => log.failedRequests.push(r.url() + ' ' + (r.failure()?.errorText ?? '')));
page.on('request', r => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !u.protocol.startsWith('data') && !u.protocol.startsWith('blob')) log.externalRequests.push(r.url()); });
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 15000 });
log.loadMs = Date.now() - t0;
if (args.skipDialogue) {
  await page.evaluate(({ adv, freeze }) => {
    const g = window.__game.game;
    g.mods.quest?.skipAll?.();
    for (let n = 0; n < 60 && g.state.scene === 'dialogue' && g.mods.quest?.dlg; n++) g.mods.quest.advance();
    if (adv) window.__game.step(adv);
    if (freeze) g.paused = true;
  }, { adv: +(args.advance ?? 0), freeze: !!args.freeze });
}
if (args.showcase === 'audio') await page.waitForFunction(() => document.body.dataset.audioDone === '1', null, { timeout: 120000 });
if (args.keys) {
  for (const k of args.keys.split(',')) { await page.keyboard.down(k); await page.waitForTimeout(+(args.hold ?? 300)); await page.keyboard.up(k); }
}
await page.waitForTimeout(+(args.wait ?? 1200));
const info = await page.evaluate(() => ({ audio: window.__game.audioReport ?? null, fps: window.__game.fps(), errors: window.__game.errors(), issues: window.__game.contentIssues(), scene: window.__game.getState().scene }));
log.fps = Math.round(info.fps); log.gameErrors = info.errors; log.contentIssues = info.issues; log.scene = info.scene; if (info.audio) log.audio = info.audio.map(r => ({ id: r.kind + ':' + r.id, ok: r.r?.ok, peak: r.r?.peak, rms: r.r?.rms, clipped: r.r?.clipped }));
fs.mkdirSync(path.dirname(out), { recursive: true });
await page.locator('canvas').screenshot({ path: out + '.png' });
fs.writeFileSync(out + '.json', JSON.stringify(log, null, 1));
await browser.close();
const bad = log.consoleErrors.length + log.pageErrors.length + log.failedRequests.length + log.externalRequests.length + log.gameErrors.length;
console.log(`${out}.png  scene=${log.scene} fps=${log.fps} load=${log.loadMs}ms errors=${bad}`);
process.exit(bad ? 1 : 0);
