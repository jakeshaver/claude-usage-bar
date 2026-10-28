// Authoring helper: compose pixel art from shapes on a palette-key grid, then auto-outline.
// Output is plain sprite rows to paste into src/art/sprites/*.ts. Not used at runtime.
export class Grid {
  constructor(w, h) { this.w = w; this.h = h; this.g = Array.from({ length: h }, () => Array(w).fill('.')); }
  px(x, y, c) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.g[y][x] = c; return this; }
  get(x, y) { return this.g[y]?.[x] ?? '.'; }
  ellipse(cx, cy, rx, ry, c, only) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1 && (!only || only.includes(this.g[y][x]))) this.g[y][x] = c;
    }
    return this;
  }
  rect(x0, y0, w, h, c) { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.px(x, y, c); return this; }
  poly(pts, c) { // filled polygon, pts [[x,y],...]
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      let inside = false; const px = x + 0.5, py = y + 0.5;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) this.g[y][x] = c;
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
  outline(c = '0', diag = false) {
    const copy = this.g.map(r => r.slice());
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (copy[y][x] !== '.') continue;
      const ns = [[1, 0], [-1, 0], [0, 1], [0, -1]].concat(diag ? [[1, 1], [-1, 1], [1, -1], [-1, -1]] : []);
      if (ns.some(([dx, dy]) => (copy[y + dy]?.[x + dx] ?? '.') !== '.')) this.g[y][x] = c;
    }
    return this;
  }
  mirrorX() { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w / 2; x++) this.g[y][this.w - 1 - x] = this.g[y][x]; return this; }
  rows() { return this.g.map(r => r.join('')); }
  print() { console.log(this.rows().map(r => `    '${r}',`).join('\n')); }
}
