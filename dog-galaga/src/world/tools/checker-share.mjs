// Measures the "strict 1px checkerboard" share of the playfield (x 128..512) for every area x time of day.
// A pixel p counts when p != right && p == right2 && p != below && p == below2.
// usage: node src/world/tools/checker-share.mjs [--port=4241 | --url=<preview url>] [--areas=a,b] [--tods=dawn,day] [--shots=dir]
// (dev tool only, never bundled: serve a build first with `npx vite preview --port 4241 --host 127.0.0.1`)
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); } catch { ({ chromium } = require('playwright')); }
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || '1']; }));
const base = args.url ?? ['http', `//127.0.0.1:${args.port ?? 4241}/`].join(':');
const AREAS = (args.areas ?? 'backyard,street,park,alley,rooftops,cafe,docks,factory,sky,moon,nebula,station,mothership').split(',');
const TODS = (args.tods ?? 'dawn,day,dusk,night').split(',');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
const rows = [];
for (const area of AREAS) {
  const row = [area];
  for (const tod of TODS) {
    await page.goto(`${base}?area=${area}&tod=${tod}&wave=0`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 15000 });
    await page.evaluate(() => { const g = window.__game.game; g.mods.quest?.skipAll?.(); for (let n = 0; n < 60 && g.state.scene === 'dialogue' && g.mods.quest?.dlg; n++) g.mods.quest.advance(); window.__game.step(200); });
    await page.waitForTimeout(300);
    const share = await page.evaluate(() => {
      const src = document.querySelector('canvas');
      const c = document.createElement('canvas'); c.width = 640; c.height = 360;
      const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(src, 0, 0, 640, 360);
      const d = new Uint32Array(x.getImageData(0, 0, 640, 360).data.buffer);
      let n = 0, hit = 0;
      for (let y = 0; y < 358; y++) for (let xx = 128; xx < 510; xx++) {
        const p = d[y * 640 + xx]; n++;
        if (p !== d[y * 640 + xx + 1] && p === d[y * 640 + xx + 2] && p !== d[(y + 1) * 640 + xx] && p === d[(y + 2) * 640 + xx]) hit++;
      }
      return hit / n;
    });
    if (args.shots) { fs.mkdirSync(args.shots, { recursive: true }); await page.screenshot({ path: `${args.shots}/${area}-${tod}.png` }); }
    row.push((share * 100).toFixed(1) + '%');
  }
  rows.push(row);
}
await browser.close();
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('area', 12) + TODS.map(t => pad(t, 8)).join(''));
for (const r of rows) console.log(pad(r[0], 12) + r.slice(1).map(v => pad(v, 8)).join(''));
const worst = Math.max(...rows.flatMap(r => r.slice(1).map(v => parseFloat(v))));
console.log(`worst ${worst.toFixed(1)}%  target < 5%`);
