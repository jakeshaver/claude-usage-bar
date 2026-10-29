// Ending diorama art (side views, drawn at 2x by ui): node src/ui/art/gen-ending.mjs > src/ui/ending-art.ts
// Same rules as Pom's in-game sheet (src/player/art/gen-pom.mjs): cool cream coat shaded pale lavender / lavender,
// curly scalloped fur masses lit from the upper left, teal flight harness + jet pod, red captain's scarf, 1px ink line.
import { Grid } from '../../../tools/pixelgen.mjs';

const FUR = ['6', '7', '5', '4'];
const EAR = ['6', '7', '5', '4'];   // ears: same coat, their own ink line separates them from the head
const PUPF = ['8', '9', 'a', 'a'];       // apricot pup coat (ui recolours it per pup)
const PUPE = ['9', 'a', 'b', 'b'];

function curly(w, h, cx, cy, rx, ry, { n = 10, br = 1.8, phase = 0, tones = FUR, outline = false } = {}) {
  const [hi, mid, lo, lo2] = tones; const g = new Grid(w, h);
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2; const bx = cx + Math.cos(a) * (rx - br), by = cy + Math.sin(a) * (ry - br);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - bx) / br, dy = (y + 0.5 - by) / br; if (dx * dx + dy * dy > 1) continue;
      const l = dx * 0.7 + dy * 0.75; g.g[y][x] = l < -0.45 ? hi : l > 0.5 ? lo : mid;
    }
  }
  const irx = rx - br * 1.1, iry = ry - br * 1.1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const nx = (x + 0.5 - cx) / irx, ny = (y + 0.5 - cy) / iry, d = nx * nx + ny * ny; if (d > 1) continue;
    g.g[y][x] = nx * 0.55 + ny * 0.7 > 0.62 && d > 0.45 ? lo : mid;
  }
  if (lo2 && lo2 !== lo) { const c = g.g.map(r => r.slice()); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (c[y][x] === lo && (c[y + 1]?.[x] ?? '.') === '.' && (c[y][x + 1] ?? '.') === '.') g.g[y][x] = lo2; }
  if (outline) g.outline('0');
  return g;
}
/** Plain (shaved) limb or body segment: filled polygon, lit top / shaded bottom, outlined. */
function shaved(w, h, pts, base = '7', hi = '6', lo = '5') {
  const g = new Grid(w, h).poly(pts, base); g.relight(base, { hi, lo }); return g;
}
/** Selective outline: composite `top` over `g`; where `top` ends over other fur, the fur underneath gets a soft
 *  lavender seam instead of an ink line (ink is kept for the outer silhouette, drawn last). */
const SEAM = { '6': '5', '7': '5', '8': 'a', '5': '4', '4': '3', '9': 'a', 'a': 'b' };
function seam(g, top) {
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    if (top.g[y][x] !== '.') continue;
    if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => (top.g[y + b]?.[x + a] ?? '.') !== '.')) continue;
    const c = g.g[y][x]; if (SEAM[c]) g.g[y][x] = SEAM[c];
  }
  return g.over(top);
}
Grid.prototype.overS = function (top) { return seam(this, top); };
function thick(g, x0, y0, x1, y1, c, t = 2) { for (let k = 0; k < t; k++) g.line(x0, y0 + k, x1, y1 + k, c); }

// ---------------- Captain Pom, flying left (side view), 38x24, 2 frames ----------------
function pomFly(f) {
  const W = 38, H = 24, g = new Grid(W, H);
  // tail on a short stalk with its pompom (up and back)
  g.overS(shaved(W, H, [[29, 9], [31, 9], [34, 5], [33, 4]]));
  g.overS(curly(W, H, 34.5, 3.6 + f * 0.4, 3.2, 3, { n: 7, br: 1.3, phase: 0.3 }));
  // hind legs stretched back, ankle puffs
  for (const [dy, far] of [[0, true], [2, false]]) {
    const leg = shaved(W, H, [[27, 12 + dy], [36, 14 + dy + f * 0.5], [36, 16 + dy + f * 0.5], [27, 15 + dy]], far ? '5' : '7', far ? '7' : '6', far ? '4' : '5');
    g.overS(leg); g.overS(curly(W, H, 35.5, 15.2 + dy + f * 0.5, 2.2, 2, { n: 6, br: 1.1, phase: 0.4, tones: far ? EAR : FUR }));
  }
  // lean clipped body
  g.overS(shaved(W, H, [[13, 9], [28, 9], [30, 12], [28, 16], [14, 16]]));
  // hip puff
  g.overS(curly(W, H, 28, 11.6, 4.4, 4.2, { n: 8, br: 1.6, phase: 0.2 }));
  // jet pod on her back with a gold-capped nozzle
  for (let j = 0; j < 4; j++) for (let i = 0; i < 9; i++) g.px(17 + i, 6 + j, j === 0 ? 'o' : j === 3 ? 'q' : i === 8 ? 'q' : 'p');
  g.px(18, 7, 'l'); g.px(19, 7, 's'); g.rect(26, 7, 1, 2, 'f');
  // harness straps round the chest and belly
  for (let y = 9; y <= 16; y++) { g.px(22, y, 'l'); g.px(23, y, 'm'); }
  g.rect(22, 12, 2, 2, 'f');
  // front legs reaching forward (superman), ankle puffs at the front
  for (const [dy, far] of [[0, true], [2, false]]) {
    g.overS(shaved(W, H, [[14, 13 + dy], [4, 14 + dy - f * 0.5], [4, 16 + dy - f * 0.5], [14, 17 + dy]], far ? '5' : '7', far ? '7' : '6', far ? '4' : '5'));
    g.overS(curly(W, H, 3.6, 15.2 + dy - f * 0.5, 2.2, 2, { n: 6, br: 1.1, phase: 0.4, tones: far ? EAR : FUR }));
  }
  // chest mane
  g.overS(curly(W, H, 13.5, 11.5, 5.4, 5.2, { n: 10, br: 1.8, phase: 0.5 }));
  // scarf: a fat red band round the neck and one tail streaming back over her shoulders
  const sc = new Grid(W, H);
  for (let y = 8; y <= 12; y++) { sc.px(12, y, y < 9 ? 'c' : 'r'); sc.px(13, y, y > 11 ? 'e' : 'r'); }
  const wv = (x) => Math.round(Math.sin(x * 0.6 + f * 2.4) * 0.8);
  for (let x = 13; x <= 22; x++) { const y = 7 + wv(x) + (x > 18 ? 1 : 0); sc.px(x, y, 'r'); if (x < 20) sc.px(x, y + 1, 'e'); }
  sc.outline('0'); g.over(sc);
  // head: skull + topknot + long muzzle
  g.overS(curly(W, H, 8.5, 7.5, 4.8, 4.4, { n: 10, br: 1.6, phase: 0.6 }));
  g.overS(curly(W, H, 9.5, 3.2, 4, 3, { n: 8, br: 1.4, phase: 0.2 }));
  const mz = new Grid(W, H).poly([[1, 7], [6, 6.5], [7, 10.5], [2, 10.5], [1, 9.5]], '7');
  mz.relight('7', { hi: '6', lo: '8' }); mz.outline('0'); g.over(mz);
  g.rect(0, 7, 2, 2, '0'); g.px(1, 7, 'q');            // nose
  g.px(3, 10, '0'); g.px(4, 10, '0'); g.px(5, 9, 'c');  // smile + blush
  // flight goggles pushed up on the topknot: teal band, round cyan lens
  for (let x = 6; x <= 13; x++) g.px(x, 5, 'm');
  g.rect(6, 4, 3, 3, '0'); g.px(7, 5, 'l'); g.px(7, 4, 's'); g.px(8, 5, 'l');
  // happy closed eye arc
  g.px(5, 7, '0'); g.px(6, 8, '0'); g.px(7, 7, '0');
  // long floppy ear streaming back in the wind
  g.overS(curly(W, H, 12.2, 9.2 + f * 0.5, 2.8, 2, { n: 6, br: 1, tones: EAR, phase: 0 }));
  g.outline('0');
  return g;
}

// ---------------- Captain Pom sitting on the lawn (side view, facing right), 26x28, 2 frames (tail wag) -------------
function pomSit(f) {
  const W = 26, H = 28, g = new Grid(W, H);
  // tail pompom up behind
  g.overS(shaved(W, H, [[5, 16], [7, 16], [4, 10 + f], [3, 11 + f]]));
  g.overS(curly(W, H, 3.6, 8.5 + f, 3, 3, { n: 7, br: 1.3, phase: 0.3 }));
  // haunch puff (sitting) + back paw
  g.overS(curly(W, H, 9, 20.5, 6, 5.6, { n: 10, br: 1.8, phase: 0.4 }));
  g.overS(curly(W, H, 12, 25.5, 3, 1.8, { n: 6, br: 1, tones: FUR }));
  // shaved torso rising to the chest
  g.overS(shaved(W, H, [[9, 12], [15, 10], [17, 18], [10, 20]]));
  // harness strap
  for (let k = 0; k < 7; k++) { g.px(11 + Math.round(k * 0.5), 12 + k, 'l'); g.px(12 + Math.round(k * 0.5), 12 + k, 'm'); }
  // front leg straight down, ankle puff on the lawn
  g.overS(shaved(W, H, [[15, 15], [18, 15], [18, 24], [16, 24]]));
  g.overS(curly(W, H, 17.5, 25.2, 2.6, 2.2, { n: 6, br: 1.1, phase: 0.4 }));
  // chest mane
  g.overS(curly(W, H, 15.5, 12.5, 4.6, 4.8, { n: 9, br: 1.7, phase: 0.5 }));
  // scarf knot under the chin
  const sc = new Grid(W, H); for (let x = 13; x <= 19; x++) { sc.px(x, 8, 'r'); sc.px(x, 9, x > 17 ? 'e' : 'r'); }
  sc.rect(13, 10, 2, 4, 'r'); sc.px(14, 13, 'e'); sc.outline('0'); g.over(sc);
  // head, topknot, muzzle (facing right)
  g.overS(curly(W, H, 16.5, 5.5, 4.6, 4.2, { n: 10, br: 1.6, phase: 0.6 }));
  g.overS(curly(W, H, 15.5, 1.8 + 0.5, 3.8, 2.6, { n: 8, br: 1.3, phase: 0.2 }));
  const mz = new Grid(W, H).poly([[19, 4.5], [25, 5.5], [25, 8], [20, 8.5]], '7'); mz.relight('7', { hi: '6', lo: '8' }); mz.outline('0'); g.over(mz);
  g.rect(24, 5, 2, 2, '0'); g.px(24, 5, 'q');
  g.px(21, 8, '0'); g.px(22, 8, '0'); g.px(20, 7, 'c');
  // goggles on the topknot
  for (let x = 12; x <= 19; x++) g.px(x, 3, 'm');
  g.rect(17, 2, 3, 3, '0'); g.px(18, 3, 'l'); g.px(18, 2, 's');
  // eye: open (frame 0) / happy arc (frame 1)
  if (f) { g.px(19, 5, '0'); g.px(20, 4, '0'); g.px(21, 5, '0'); } else { g.rect(19, 4, 2, 2, '0'); g.px(19, 4, '6'); }
  // floppy ear hanging down the side of the head
  g.overS(curly(W, H, 13.6, 8.8, 2, 3.4, { n: 6, br: 1, tones: EAR, phase: 1.57 }));
  g.outline('0');
  return g;
}

// ---------------- a rescued pup sitting (side view, facing right), 16x16, 2 frames (tail wag / ear perk) -------------
function pupSit(f) {
  const W = 16, H = 16, g = new Grid(W, H);
  // little curled tail, wagging
  const tl = new Grid(W, H); if (f) { tl.px(2, 8, '9'); tl.px(2, 9, '9'); tl.px(3, 10, '9'); } else { tl.px(1, 9, '9'); tl.px(2, 10, '9'); tl.px(3, 10, '9'); }
  tl.outline('0'); g.over(tl);
  // round haunch
  g.overS(curly(W, H, 6.2, 11.6, 3.7, 3.4, { n: 8, br: 1.4, tones: PUPF, phase: 0.3 }));
  // chest + front leg
  g.overS(shaved(W, H, [[8, 8], [11.5, 8], [11.5, 14.5], [9, 14.5]], '9', '8', 'a'));
  g.rect(9, 14, 3, 1, '8');
  // collar with a gold tag
  const cl = new Grid(W, H); for (let x = 8; x <= 12; x++) cl.px(x, 8, 'r'); cl.px(12, 9, 'f'); g.over(cl);
  // head: round skull, short cream muzzle with a black nose
  const hd = new Grid(W, H).ellipse(10.6, 4.8, 3.4, 3.1, '9'); hd.relight('9', { hi: '8', lo: 'a' }); g.over(hd);
  const mz = new Grid(W, H).poly([[12.5, 4.5], [15.6, 5], [15.6, 7.4], [12.5, 7.6]], '7'); g.over(mz);
  g.px(15, 5, '0'); g.px(13, 7, 'a'); g.px(14, 7, 'a');
  g.rect(11, 3, 1, 2, '0'); g.px(12, 3, '6');           // eye with a glint
  // floppy ear down the back of the head
  const er = new Grid(W, H).poly([[8, 2 - f], [10.5, 2.5], [10, 7.5], [8, 7]], 'a'); er.px(9, 3, 'b'); g.over(er);
  g.outline('0');
  return g;
}

// ---------------- a rescued pup flying (side view, facing left), 20x12, 2 frames ----------------
function pupFly(f) {
  const W = 20, H = 12, g = new Grid(W, H);
  // tiny pink cape streaming back off the shoulders
  const cp = new Grid(W, H).poly([[8, 3], [16, 2 + f], [17, 4 + f], [9, 6]], 'c'); cp.relight('c', { lo: 'd' }); cp.outline('0'); g.over(cp);
  // legs: front pair reaching forward, hind pair stretched back
  g.overS(shaved(W, H, [[7, 7], [2, 8], [2, 9.6], [7, 9.6]], '9', '8', 'a'));
  g.overS(shaved(W, H, [[13, 7], [18.5, 8 - f], [18.5, 9.6 - f], [13, 9.6]], '9', '8', 'a'));
  // body
  const bd = new Grid(W, H).ellipse(10.5, 7, 5, 2.6, '9'); bd.relight('9', { hi: '8', lo: 'a' }); g.over(bd);
  // head with a cream muzzle pointing left, ear streaming back
  const hd = new Grid(W, H).ellipse(5.4, 4.6, 3.2, 3, '9'); hd.relight('9', { hi: '8', lo: 'a' }); g.over(hd);
  const mz = new Grid(W, H).poly([[0.6, 4.6], [3.4, 4.2], [3.4, 7.2], [0.6, 7]], '7'); g.over(mz);
  g.px(0, 5, '0'); g.px(4, 4, '0'); g.px(3, 3, '6');
  const er = new Grid(W, H).poly([[6, 2.4], [10, 2 + f], [10, 3.6 + f], [6.5, 5]], 'a'); g.over(er);
  // collar
  g.px(7, 6, 'r'); g.px(7, 7, 'r');
  g.outline('0');
  return g;
}

// ---------------- the Empress's hedgehog in a party hat, 12x10 ----------------
function hedgehog() {
  const W = 12, H = 10, g = new Grid(W, H);
  const b = new Grid(W, H).ellipse(5.5, 7, 4.6, 2.8, 'a'); b.relight('a', { hi: '9', lo: 'b' });
  for (let x = 2; x <= 9; x += 2) b.px(x, 5, 'b'); b.outline('0'); g.over(b);
  const f = new Grid(W, H).poly([[8, 6], [11.5, 7.5], [8, 9.5]], '8'); f.outline('0'); g.over(f);
  g.px(11, 7, '0'); g.px(9, 7, '0');
  const hat = new Grid(W, H).poly([[3, 4.5], [7, 4.5], [5, 0.5]], 'l'); hat.px(5, 3, 'c'); hat.px(4, 4, 'f'); hat.outline('0'); g.over(hat);
  return g;
}

const defs = { end_pom_fly: [pomFly(0), pomFly(1)], end_pom_sit: [pomSit(0), pomSit(1)], end_pup_sit: [pupSit(0), pupSit(1)], end_pup_fly: [pupFly(0), pupFly(1)], end_hedgehog: hedgehog() };
const out = ['// generated by src/ui/art/gen-ending.mjs: change the generator and re-run, do not hand-edit', "import type { SpriteDef } from '../art/sprite';", 'export const ENDING_ART: Record<string, SpriteDef> = {'];
for (const [k, fr] of Object.entries(defs)) {
  const fs = Array.isArray(fr) ? fr : [fr];
  out.push(`  ${k}: { rows: [`); out.push(...fs[0].rows().map(r => `    '${r}',`));
  if (fs.length > 1) { out.push('  ], frames: ['); for (const x of fs.slice(1)) { out.push('    ['); out.push(...x.rows().map(r => `      '${r}',`)); out.push('    ],'); } out.push('  ] },'); }
  else out.push('  ] },');
}
out.push('};');
console.log(out.join('\n'));
