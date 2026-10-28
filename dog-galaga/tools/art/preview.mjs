// Quick sprite preview without a browser: node tools/art/preview.mjs <out.png> <scale> <filter...>
// Reads src/art/sprites/*.ts, renders every matching sprite (all frames) on three backdrops
// (night, grass, sand) so contrast can be judged against real play backgrounds.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
const root = new URL('../../', import.meta.url).pathname;
const pal = [...readFileSync(root + 'src/core/palette.ts', 'utf8').matchAll(/'(#[0-9a-f]{6})'/g)].map(m => m[1]);
const KEY = '0123456789abcdefghijklmnopqrstuv';
const [out = 'shots/preview.png', scaleArg = '4', ...filters] = process.argv.slice(2);
const scale = +scaleArg;
const sprites = [];
for (const f of readdirSync(root + 'src/art/sprites')) {
  const src = readFileSync(root + 'src/art/sprites/' + f, 'utf8');
  for (const m of src.matchAll(/^ {2}(\w+): \{ rows: \[([\s\S]*?)\n {2}\] \},?$/gm)) {
    const name = m[1]; if (filters.length && !filters.some(q => name.includes(q))) continue;
    const blocks = m[2].split(/\],\s*frames: \[|\],\s*\[/);
    const frames = blocks.map(b => [...b.matchAll(/'([^']*)'/g)].map(x => x[1])).filter(r => r.length);
    sprites.push({ name, frames });
  }
}
const bgs = process.env.BG ? process.env.BG.split(',') : ['#1d1b33', '#3fa34d', '#e0c7a8'];
const pad = 4;
let W = 0, H = 0; const rowsLayout = [];
for (const s of sprites) { const w = s.frames[0][0].length, h = s.frames[0].length; rowsLayout.push({ s, w, h }); W = Math.max(W, (w + pad) * s.frames.length * bgs.length); H += h + pad; }
W += pad; H += pad;
const img = Buffer.alloc(W * H * scale * scale * 3);
const put = (x, y, hex) => { const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16); for (let j = 0; j < scale; j++) for (let i = 0; i < scale; i++) { const o = ((y * scale + j) * W * scale + x * scale + i) * 3; img[o] = r; img[o + 1] = g; img[o + 2] = b; } };
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, '#555555');
let oy = pad;
for (const { s, w, h } of rowsLayout) {
  let ox = pad;
  for (const bg of bgs) for (const fr of s.frames) {
    for (let y = -2; y < h + 2; y++) for (let x = -2; x < w + 2; x++) if (ox + x >= 0 && oy + y >= 0 && ox + x < W && oy + y < H) put(ox + x, oy + y, bg);
    fr.forEach((r, y) => [...r].forEach((c, x) => { const i = KEY.indexOf(c); if (i >= 0) put(ox + x, oy + y, pal[i]); }));
    ox += w + pad;
  }
  oy += h + pad;
}
// PNG encode
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const PW = W * scale, PH = H * scale; const raw = Buffer.alloc((PW * 3 + 1) * PH);
for (let y = 0; y < PH; y++) { raw[y * (PW * 3 + 1)] = 0; img.copy(raw, y * (PW * 3 + 1) + 1, y * PW * 3, (y + 1) * PW * 3); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(PW, 0); ihdr.writeUInt32BE(PH, 4); ihdr[8] = 8; ihdr[9] = 2;
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(`${out}: ${sprites.length} sprites, ${PW}x${PH}`);
