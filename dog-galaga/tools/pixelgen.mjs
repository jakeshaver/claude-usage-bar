// Authoring helper: compose pixel art from shapes on a palette-key grid, then auto-outline.
// Output is plain sprite rows to paste into src/art/sprites/*.ts. Not used at runtime.
//
// Workflow used by tools/art/*.mjs: build each body part on its own Grid "layer"
// (fill -> relight -> outline), then composite back-to-front with over(). Because
// every part carries its own 1px dark outline, overlapping parts stay readable,
// and the final silhouette has one consistent outline. Hand-authored details
// (eyes, bows, crowns) are pasted with stamp().
export class Grid {
  constructor(w, h) { this.w = w; this.h = h; this.g = Array.from({ length: h }, () => Array(w).fill('.')); }
  px(x, y, c) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.g[y][x] = c; return this; }
  get(x, y) { return this.g[y]?.[x] ?? '.'; }
  clone() { const n = new Grid(this.w, this.h); n.g = this.g.map(r => r.slice()); return n; }
  ellipse(cx, cy, rx, ry, c, only) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1 && (!only || only.includes(this.g[y][x]))) this.g[y][x] = c;
    }
    return this;
  }
  rect(x0, y0, w, h, c) { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.px(x, y, c); return this; }
  poly(pts, c, only) { // filled polygon, pts [[x,y],...]
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      let inside = false; const px = x + 0.5, py = y + 0.5;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
      }
      if (inside && (!only || only.includes(this.g[y][x]))) this.g[y][x] = c;
    }
    return this;
  }
  line(x0, y0, x1, y1, c) { // bresenham, integer endpoints
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) { this.px(x0, y0, c); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
    return this;
  }
  // scalloped ellipse: a fluffy cloud outline (n bumps of radius br around the rim)
  fluff(cx, cy, rx, ry, c, n = 10, br = 1.6, phase = 0) {
    this.ellipse(cx, cy, rx - br * 0.6, ry - br * 0.6, c);
    for (let i = 0; i < n; i++) {
      const a = phase + i / n * Math.PI * 2;
      this.ellipse(cx + Math.cos(a) * (rx - br), cy + Math.sin(a) * (ry - br), br, br, c);
    }
    return this;
  }
  // shade: pixels of color `c` whose neighbor in direction (dx,dy) is transparent/other become `s`
  shade(c, s, dx, dy, depth = 1) {
    const copy = this.g.map(r => r.slice());
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (copy[y][x] !== c) continue;
      for (let d = 1; d <= depth; d++) { const n = copy[y + dy * d]?.[x + dx * d] ?? '.'; if (n !== c) { this.g[y][x] = s; break; } }
    }
    return this;
  }
  // relight: light from top-left. Pixels of `base` within `d` px of the bottom/right edge of
  // the layer's silhouette become `lo` (with an optional darker outermost band `lo2`);
  // pixels on the top/top-left edge become `hi`. Only transparency counts as an edge, so
  // markings drawn before relight do not create false edges.
  relight(base, { hi, lo, lo2, d = 1, hiD = 1 } = {}) {
    const copy = this.g.map(r => r.slice());
    const empty = (x, y) => (copy[y]?.[x] ?? '.') === '.';
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (copy[y][x] !== base) continue;
      let done = false;
      for (let k = 1; k <= d && !done; k++) {
        if (empty(x + k, y + k) || empty(x, y + k) || empty(x + k, y)) { this.g[y][x] = (k === 1 && lo2) ? lo2 : lo; done = true; }
      }
      if (!done && hi) for (let k = 1; k <= hiD && !done; k++) if (empty(x, y - k) || empty(x - k, y - k)) { this.g[y][x] = hi; done = true; }
    }
    return this;
  }
  outline(c = '0', diag = false) {
    const copy = this.g.map(r => r.slice());
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (copy[y][x] !== '.') continue;
      const ns = [[1, 0], [-1, 0], [0, 1], [0, -1]].concat(diag ? [[1, 1], [-1, 1], [1, -1], [-1, -1]] : []);
      if (ns.some(([dx, dy]) => (copy[y + dy]?.[x + dx] ?? '.') !== '.')) this.g[y][x] = c;
    }
    return this;
  }
  // remove lonely pixels: any non-transparent pixel with <= `min` non-transparent 4-neighbours
  despeckle(min = 0) {
    const copy = this.g.map(r => r.slice());
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (copy[y][x] === '.') continue;
      const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => (copy[y + dy]?.[x + dx] ?? '.') !== '.').length;
      if (n <= min) this.g[y][x] = '.';
    }
    return this;
  }
  // knock out 1px fill "spikes" before outlining: a fill pixel with only one fill neighbour
  // (4-connected) becomes transparent. Run before outline() for clean silhouettes.
  smooth(passes = 1) {
    for (let p = 0; p < passes; p++) this.despeckle(1);
    return this;
  }
  // paste hand-authored rows at (x,y). '.' is skipped; `map` translates placeholder letters.
  stamp(x, y, rows, map = {}) {
    rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ch !== '.' && ch !== ' ') this.px(x + i, y + j, map[ch] ?? ch); }));
    return this;
  }
  replace(a, b, only) { // recolor every `a` to `b` (optionally inside rect [x,y,w,h])
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (only && (x < only[0] || y < only[1] || x >= only[0] + only[2] || y >= only[1] + only[3])) continue;
      if (this.g[y][x] === a) this.g[y][x] = b;
    }
    return this;
  }
  over(top, ox = 0, oy = 0) { // composite another grid on top
    for (let y = 0; y < top.h; y++) for (let x = 0; x < top.w; x++) { const c = top.g[y][x]; if (c !== '.') this.px(x + ox, y + oy, c); }
    return this;
  }
  flipX() { for (const r of this.g) r.reverse(); return this; }
  mirrorX() { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w / 2; x++) this.g[y][this.w - 1 - x] = this.g[y][x]; return this; }
  rows() { return this.g.map(r => r.join('')); }
  print() { console.log(this.rows().map(r => `    '${r}',`).join('\n')); }
}
// deterministic hash noise for texture placement (reproducible generator output)
export function hash2(x, y, seed = 0) { let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
// emit a sprite map as a TS module. defs: { name: Grid | Grid[] (frames) }
export function emitModule(constName, generator, defs) {
  const out = [`// generated by ${generator}: change the generator and re-run, do not hand-edit`, "import type { SpriteDef } from '../sprite';", `export const ${constName}: Record<string, SpriteDef> = {`];
  for (const [k, frames] of Object.entries(defs)) {
    const fs = Array.isArray(frames) ? frames : [frames];
    out.push(`  ${k}: { rows: [`); out.push(...fs[0].rows().map(r => `    '${r}',`));
    if (fs.length > 1) { out.push('  ], frames: ['); for (const f of fs.slice(1)) { out.push('    ['); out.push(...f.rows().map(r => `      '${r}',`)); out.push('    ],'); } out.push('  ] },'); }
    else out.push('  ] },');
  }
  out.push('};');
  return out.join('\n');
}
