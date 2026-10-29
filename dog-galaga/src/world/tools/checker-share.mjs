// Measures the "strict 1px checkerboard" share of the playfield (x 128..512) for every area x time of day.
// A pixel p counts when p != right && p == right2 && p != below && p == below2.
// Also measures 1px stripe alternation (rows or columns alternating while constant along the other axis).
// Targets: checker < 5% and stripes < 8% of playfield pixels in every cell.
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
const crops = {}; const tops = [];
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
      let n = 0, hit = 0, vs = 0, hs = 0;
      for (let y = 0; y < 358; y++) for (let xx = 128; xx < 510; xx++) {
        const p = d[y * 640 + xx]; n++;
        const r1 = d[y * 640 + xx + 1], r2 = d[y * 640 + xx + 2], b1 = d[(y + 1) * 640 + xx], b2 = d[(y + 2) * 640 + xx], br = d[(y + 1) * 640 + xx + 1];
        if (p !== r1 && p === r2 && p !== b1 && p === b2) hit++;
        if (p !== r1 && p === r2 && p === b1 && r1 === br) vs++; // 1px vertical stripes (columns alternate)
        if (p !== b1 && p === b2 && p === r1 && b1 === br) hs++; // 1px horizontal stripes (rows alternate)
      }
      const cnt = new Map(); for (let y = 0; y < 360; y++) for (let xx = 128; xx < 512; xx++) { const v = d[y * 640 + xx]; cnt.set(v, (cnt.get(v) ?? 0) + 1); }
      const hex = v => '#' + [v & 255, (v >> 8) & 255, (v >> 16) & 255].map(c => c.toString(16).padStart(2, '0')).join('');
      const top = [...cnt].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([v, c]) => hex(v) + ' ' + Math.round(c / 1382.4) + '%').join(', ');
      const o = document.createElement('canvas'); o.width = 384; o.height = 360; o.getContext('2d').drawImage(c, 128, 0, 384, 360, 0, 0, 384, 360);
      return { share: hit / n, stripe: Math.max(vs, hs) / n, top, url: o.toDataURL() };
    }).then(r => { crops[area + '-' + tod] = r.url; tops.push(`${area} ${tod}: ${r.top}`); return r; });
    if (args.shots) { fs.mkdirSync(args.shots, { recursive: true }); await page.screenshot({ path: `${args.shots}/${area}-${tod}.png` }); }
    row.push((share.share * 100).toFixed(1) + '/' + (share.stripe * 100).toFixed(1));
  }
  rows.push(row);
}
if (args.montage) {
  fs.mkdirSync(args.montage, { recursive: true });
  for (const area of AREAS) {
    const url = await page.evaluate(async ({ urls }) => {
      const c = document.createElement('canvas'); c.width = 386 * urls.length; c.height = 360; const x = c.getContext('2d'); x.fillStyle = '#f0f'; x.fillRect(0, 0, c.width, 360);
      for (let i = 0; i < urls.length; i++) { const im = new Image(); im.src = urls[i]; await im.decode(); x.drawImage(im, i * 386, 0); }
      return c.toDataURL();
    }, { urls: TODS.map(t => crops[area + '-' + t]) });
    fs.writeFileSync(`${args.montage}/${area}.png`, Buffer.from(url.split(',')[1], 'base64'));
  }
}
if (args.colors) for (const t of tops) console.log(t);
await browser.close();
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('area', 12) + TODS.map(t => pad(t, 11)).join(''));
for (const r of rows) console.log(pad(r[0], 12) + r.slice(1).map(v => pad(v, 11)).join(''));
const worst = Math.max(...rows.flatMap(r => r.slice(1).map(v => parseFloat(v))));
const worstS = Math.max(...rows.flatMap(r => r.slice(1).map(v => parseFloat(v.split('/')[1]))));
console.log(`cells: checker% / 1px-stripe%   worst checker ${worst.toFixed(1)}% (target < 5%)  worst stripe ${worstS.toFixed(1)}% (target < 8%)`);
