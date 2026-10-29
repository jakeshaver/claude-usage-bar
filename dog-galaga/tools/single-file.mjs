// Inline the vite build into one self-contained HTML file that runs from file:// (double-click to play).
// Usage: npm run build && node tools/single-file.mjs [out=dist/PoodlePatrol.html]
import fs from 'node:fs'; import path from 'node:path';
const dist = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../dist');
const out = process.argv[2] ?? path.join(dist, 'PoodlePatrol.html');
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, (_, src) =>
  '<script type="module">' + fs.readFileSync(path.join(dist, src.replace(/^\.\//, '')), 'utf8').replace(/<\/script/g, '<\\/script') + '</script>');
html = html.replace(/<link rel="modulepreload"[^>]*>/g, '');
fs.writeFileSync(out, html);
console.log(`${out} (${Math.round(html.length / 1024)} KB)`);
