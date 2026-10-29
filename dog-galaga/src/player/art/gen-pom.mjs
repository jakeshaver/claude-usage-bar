// Captain Pom art for the player module: node src/player/art/gen-pom.mjs > src/player/pom-art.ts
// (node src/player/art/gen-pom.mjs --json prints the raw rows, for previews)
//
// Top-down "superman" flying pose, rear (tail pompom) toward the top of the screen, face toward the player:
// hind legs stretched back beside the tail pompom, front paws reaching forward beside the snout, long floppy
// ears breaking the head's silhouette. Every fur mass is a cluster of 2-3px curls along a scalloped outline;
// each curl is lit from the upper left (1px white highlight on the top-facing curls, tan on the lower right),
// so the outline itself reads "poodle". Captain's kit is the signature accent no cat uses: a big red scarf
// (its fluttering tail is drawn at runtime by draw.ts scarfTail) and teal flight goggles on the topknot.
import { Grid } from '../../../tools/pixelgen.mjs';

const W = 32;
const FUR = ['6', '7', '8', '9'];        // highlight, coat, curl shadow, deep shadow (outline side only)
const EAR = ['7', '8', '9', 'a'];        // ears one step darker so they separate from the head

/** Curly fur mass: a ring of curl bumps (each lit from the upper left) under a slightly smaller body fill. */
function curly(cx, cy, rx, ry, { n = 10, br = 1.8, phase = 0, tones = FUR, w = W, h = W, tex = 0, bias = 0 } = {}) {
  const [hi, mid, lo, lo2] = tones;
  const g = new Grid(w, h);
  const bumps = [];
  for (let i = 0; i < n; i++) { const a = phase + (i / n) * Math.PI * 2; bumps.push([cx + Math.cos(a) * (rx - br), cy + Math.sin(a) * (ry - br)]); }
  for (const [bx, by] of bumps) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x + 0.5 - bx) / br, dy = (y + 0.5 - by) / br, d = dx * dx + dy * dy;
    if (d > 1) continue;
    const l = dx * 0.7 + dy * 0.75;
    g.g[y][x] = l < -0.45 ? hi : l > 0.5 ? lo : mid;
  }
  const irx = rx - br * 1.1, iry = ry - br * 1.1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const nx = (x + 0.5 - cx) / irx, ny = (y + 0.5 - cy) / iry, d = nx * nx + ny * ny;
    if (d > 1) continue;
    const l = nx * 0.55 + ny * 0.7 + bias * nx;
    g.g[y][x] = l > 0.62 && d > 0.45 ? lo : mid;
  }
  // deep shadow on the outermost lower-right pixels only (next to the ink line)
  if (lo2) {
    const c = g.g.map(r => r.slice());
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (c[y][x] === lo && (c[y + 1]?.[x] ?? '.') === '.' && (c[y][x + 1] ?? '.') === '.') g.g[y][x] = lo2;
  }
  // interior curls: tiny lit bumps on a staggered grid (regular, so they read as coat texture, not dirt)
  if (tex) for (let y = Math.floor(cy - iry); y <= cy + iry; y += tex) for (let x = Math.floor(cx - irx) + ((Math.round(y) / tex) & 1 ? tex >> 1 : 0); x <= cx + irx; x += tex) {
    const nx = (x + 0.5 - cx) / irx, ny = (y + 0.5 - cy) / iry;
    if (nx * nx + ny * ny > 0.5) continue;
    if (g.get(x, y) !== mid || g.get(x + 1, y + 1) !== mid || g.get(x - 1, y - 1) !== mid) continue;
    g.px(x - 1, y - 1, hi); g.px(x, y - 1, hi); g.px(x + 1, y, lo); g.px(x, y + 1, lo); g.px(x + 1, y + 1, lo);
  }
  g.outline('0');
  return g;
}

/** Small round paw (cream, 1px tan toe split, lit from the upper left). */
function paw(g, cx, cy, rx = 1.9, ry = 1.9, toes = 'down') {
  const p = curly(cx, cy, rx, ry, { n: 5, br: 1.1, phase: 0.5 });
  if (toes === 'down') p.px(Math.floor(cx), Math.floor(cy + ry - 0.6), '8');
  else p.px(Math.floor(cx), Math.floor(cy - ry + 0.4), '8');
  g.over(p);
}

/** One jet pod (rounded capsule, lit from the left); returns nozzle [x, y, w] (first flame row). */
function pod(g, x, y, w, h) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (j === 0 && w > 2 && (i === 0 || i === w - 1)) continue;
    g.px(x + i, y + j, j === h - 1 ? 'q' : i === 0 && w > 2 ? 'o' : i === w - 1 ? 'q' : 'p');
  }
  if (h > 3 && w > 2) g.px(x + 1, y + 1, 'l');
  const c = g.g.map(r => r.slice());
  for (let j = -1; j <= h; j++) for (let i = -1; i <= w; i++) {
    const X = x + i, Y = y + j; if ((c[Y]?.[X] ?? '.') !== '.') continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => X + a >= x && X + a < x + w && Y + b >= y && Y + b < y + h && (c[Y + b]?.[X + a] ?? '.') !== '.')) g.px(X, Y, '0');
  }
  return [x, y + h, w];
}

/** L: -1 full bank left .. 1 full bank right. squash: tail pompom squashed by a toot. stretch: wake-up stretch. */
function pom(L = 0, { squash = false, stretch = false } = {}) {
  const g = new Grid(W, W);
  const s = Math.sign(L), a = Math.abs(L);
  const nar = 1 - 0.14 * a;
  const bodyX = 16 + L * 0.5, headX = 16 + L * 1.5, tailX = 16 - L * 1.5;
  const nozzles = [];
  const ext = stretch ? 1.5 : 0;
  const podAt = (side, near) => {
    const full = a > 0.7;
    const w = near ? (full ? 4 : 3) : 2;
    const h = near && full ? 6 : 5;
    let x = side < 0 ? 3 : 29 - w;
    if (near && a > 0) x += side * (full ? 1 : 0);
    if (!near) x -= side * (full ? 4 : 2);
    const y = 12 + (near && a > 0 ? 1 : 0);
    nozzles.push(pod(g, x, y, w, h));
    const sx = side < 0 ? x + w + 1 : x - 2;
    for (let k = 0; k < 3; k++) g.px(sx + (side < 0 ? k : -k), y + 2, 'q');
  };
  const farSide = s ? -s : 0;
  if (farSide) podAt(farSide, false);

  // hind paws stretched back (up) at the body's rear corners; the far one tucks under as she rolls
  for (const side of [-1, 1]) {
    const near = s === side, far = s === -side;
    paw(g, bodyX + side * (6.2 + (near ? a * 0.8 : 0) - (far ? a * 1.8 : 0) + ext * 0.3), 6.4 - ext + (far ? a : 0), 1.8, 1.9, 'up');
  }
  // tail pompom on a short shaved stalk (swings opposite to the roll)
  const tr = Math.round(tailX);
  g.rect(tr - 1, 5, 2, 3, '8'); g.px(tr, 6, '9'); g.px(tr, 7, '9');
  g.px(tr - 2, 6, '0'); g.px(tr + 1, 6, '0'); g.px(tr - 2, 7, '0'); g.px(tr + 1, 7, '0');
  g.over(squash ? curly(tailX, 3.9, 3.9, 2.6, { n: 7, br: 1.3, phase: 0.3 }) : curly(tailX, 3.5, 3.4, 3.2, { n: 7, br: 1.4, phase: 0.3 }));
  // body: the big curly coat
  g.over(curly(bodyX, 13.0, 8.0 * nar, 6.0, { n: 12, br: 2.0, phase: 0.26, tex: 4, bias: L * 0.4 }));
  if (s) podAt(s, true); else { podAt(-1, true); podAt(1, true); }

  // floppy ears (curly, one step darker) hanging out past the head; the near ear swings wide on a roll
  for (const side of [-1, 1]) {
    const near = s === side, far = s === -side;
    const ex = headX + side * (6.3 + (near ? a * 0.7 : 0) - (far ? a * 1.6 : 0) + ext * 0.6) + L * 0.4;
    const ey = 26.2 + (near ? a * 0.6 : 0) + ext * 0.4;
    g.over(curly(ex, ey, far ? 2.2 : 2.6, 5.0, { n: 7, br: 1.3, tones: EAR, phase: 1.57 }));
  }
  // head (topknot seen from above, face at the front)
  const hy = 25.4 + ext * 0.3;
  g.over(curly(headX, hy, 5.7 * (1 - 0.05 * a), 5.4, { n: 11, br: 1.7, phase: 0.6, bias: L * 0.3 }));
  const fx = Math.round(headX + L * 0.6), fy = Math.round(hy);
  // muzzle: a bright cream snout bump with a black nose at the very front
  for (const [x, y, c] of [[-2, 2, '6'], [-1, 2, '6'], [0, 2, '7'], [1, 2, '7'], [-2, 3, '7'], [-1, 3, '7'], [0, 3, '7'], [1, 3, '8']]) g.px(fx + x, fy + y, c);
  g.rect(fx - 1, fy + 3, 2, 1, '0');
  if (stretch) {
    g.rect(fx - 1, fy + 4, 2, 1, 'd'); g.px(fx - 2, fy + 4, '0'); g.px(fx + 1, fy + 4, '0');   // yawn
    for (const ex of [fx - 4, fx + 2]) { g.px(ex, fy, '0'); g.px(ex + 1, fy - 1, '0'); g.px(ex + 2, fy, '0'); }
  } else for (const ex of [fx - 4, fx + 2]) { g.rect(ex, fy - 1, 2, 2, '0'); g.px(ex, fy - 1, '6'); }
  g.px(fx - 5, fy + 1, 'c'); g.px(fx + 4, fy + 1, 'c');      // blush
  // the captain's scarf: a fat red band round the neck with a knot on the right (its tail flutters at runtime)
  for (let x = Math.round(headX - 6); x <= Math.round(headX + 5); x++) {
    const y = 19 + (Math.abs(x + 0.5 - headX) > 4.5 ? 1 : 0);
    g.px(x, y - 1, '0'); g.px(x, y, x < headX - 2 ? 'c' : 'r'); g.px(x, y + 1, 'r'); g.px(x, y + 2, 'e'); if (g.get(x, y + 3) === '.') g.px(x, y + 3, '0');
  }
  const kx = Math.round(headX + 5);
  g.rect(kx - 1, 18, 4, 5, '0'); g.rect(kx, 19, 2, 3, 'r'); g.px(kx, 19, 'c'); g.px(kx + 1, 21, 'e');
  g.outline('0');
  return { g, nozzles: nozzles.map(([x, y, w]) => [x + w / 2 - 16, y - 16, w]), knot: [kx + 1 - 16, 21 - 16] };
}

// ---- wingpup: 16x16, same language: apricot curls, red neckerchief and teal goggles echoing Pom ----
function pup(L = 0, flap = 0) {
  const g = new Grid(16, 16);
  const s = Math.sign(L), a = Math.abs(L);
  const PUPC = ['7', '8', '9', 'a'];
  const tx = 8 - L;
  const noz = [];
  for (const side of [-1, 1]) { const far = s === -side; const x = side < 0 ? 1 + (far ? 1 : 0) : 13 - (far ? 1 : 0); noz.push(pod(g, x, 6, 2, 2)); }
  g.over(curly(tx, 1.8, 1.8, 1.7, { n: 5, br: 1, tones: PUPC, w: 16, h: 16 }));
  g.over(curly(8 + L * 0.4, 6.4, 4.4 * (1 - 0.12 * a), 3.2, { n: 8, br: 1.3, tones: PUPC, w: 16, h: 16 }));
  const hx = 8 + L;
  // ears: down (frame 0) / flapped up and out (frame 1)
  for (const side of [-1, 1]) g.over(curly(hx + side * (3.9 + flap * 0.9), 11.2 - flap * 1.2, 1.5, 2.4 - flap * 0.4, { n: 4, br: 1, tones: ['8', '9', 'a', 'b'], w: 16, h: 16 }));
  g.over(curly(hx, 11.4, 3.5, 3.1, { n: 7, br: 1.2, tones: PUPC, w: 16, h: 16 }));
  const bx = Math.round(hx);
  g.rect(bx - 2, 11, 4, 3, '6');                         // bright white face mask
  g.px(bx - 2, 11, '0'); g.px(bx + 1, 11, '0');           // eyes
  g.rect(bx - 1, 13, 2, 1, '0');                         // nose
  g.px(bx - 3, 12, 'c'); g.px(bx + 2, 12, 'c');
  for (const lx of [bx - 3, bx + 1]) { g.rect(lx, 9, 2, 1, 'm'); g.px(lx, 9, 'l'); }   // goggles
  for (let x = bx - 3; x <= bx + 2; x++) g.px(x, 8, 'r');                               // neckerchief
  g.px(bx + 3, 8, 'r'); g.px(bx + 3, 9, 'e');
  g.outline('0');
  return { g, nozzle: noz.map(([x, y, w]) => [x + w / 2 - 8, y - 8, w]) };
}

// ---- nap: top-down curl, a fur donut: tail pompom tucked over the nose, closed-eye smile, scarf kept ----
function nap(b = 0) {
  const g = new Grid(32, 24);
  pod(g, 25, 3, 3, 4);
  g.over(curly(16, 12 - b * 0.5, 11.6 + b * 0.5, 8.4 + b * 0.5, { n: 16, br: 2, w: 32, h: 24, tex: 4, phase: 0.2 }));
  paw(g, 24.5, 6.6 - b * 0.5, 1.8, 1.7, 'up');
  for (let y = 9; y <= 16; y++) { const x = Math.round(7.5 + Math.pow((y - 13) / 4, 2) * 1.5); g.px(x, y, 'r'); g.px(x + 1, y, 'r'); g.px(x + 2, y, y > 13 ? 'e' : 'r'); }
  g.rect(5, 10, 2, 3, 'r'); g.px(5, 10, 'c'); g.px(4, 13, 'r'); g.px(4, 14, 'e');
  g.over(curly(9.4, 16.2, 2.6, 4.4, { n: 6, br: 1.3, tones: EAR, w: 32, h: 24, phase: 1.57 }));
  g.over(curly(15, 14.5, 5.6, 4.6, { n: 9, br: 1.6, w: 32, h: 24, phase: 0.4 }));
  for (const ex of [11, 16]) { g.px(ex, 13, '0'); g.px(ex + 1, 14, '0'); g.px(ex + 2, 14, '0'); g.px(ex + 3, 13, '0'); }
  g.px(10, 15, 'c'); g.px(19, 15, 'c');
  g.rect(14, 16, 2, 1, '0'); g.px(13, 17, '0'); g.px(16, 17, '0'); g.px(14, 18, 'c');
  g.over(curly(20.2, 18.4, 3.3, 3.0, { n: 7, br: 1.4, w: 32, h: 24, phase: 0.3 }));
  g.outline('0');
  return g;
}

const rowsOf = g => g.rows();
const defs = {}, nozz = {}, knots = {};
const bankSet = { pom: 0, pom_lean_l: -0.55, pom_lean_r: 0.55, pom_bank_l: -1, pom_bank_r: 1 };
for (const [name, L] of Object.entries(bankSet)) {
  const n = pom(L), q = pom(L, { squash: true });
  defs[name] = [rowsOf(n.g), rowsOf(q.g)]; nozz[name] = n.nozzles; knots[name] = n.knot;
}
const st = pom(0, { stretch: true }); defs.pom_stretch = [rowsOf(st.g)]; nozz.pom_stretch = st.nozzles; knots.pom_stretch = st.knot;
const pupSet = { pom_pup: 0, pom_pup_l: -1, pom_pup_r: 1 };
const pupN = {};
for (const [name, L] of Object.entries(pupSet)) { const p = pup(L, 0); defs[name] = [rowsOf(p.g), rowsOf(pup(L, 1).g)]; pupN[name] = p.nozzle; }
defs.pom_nap = [rowsOf(nap(0)), rowsOf(nap(0.5)), rowsOf(nap(1))];

if (process.argv.includes('--json')) {
  const j = {};
  for (const [k, fr] of Object.entries(defs)) fr.forEach((f, i) => { j[i ? `${k}#${i}` : k] = f; });
  console.log(JSON.stringify(j));
} else {
  const out = [];
  out.push('// generated by src/player/art/gen-pom.mjs: change the generator and re-run, do not hand-edit');
  out.push("import type { SpriteDef } from '../art/sprite';");
  out.push('export const POM_ART: Record<string, SpriteDef> = {');
  for (const [k, fr] of Object.entries(defs)) {
    out.push(`  ${k}: { rows: [`); out.push(...fr[0].map(r => `    '${r}',`));
    if (fr.length > 1) { out.push('  ], frames: ['); for (const f of fr.slice(1)) { out.push('    ['); out.push(...f.map(r => `      '${r}',`)); out.push('    ],'); } out.push('  ] },'); }
    else out.push('  ] },');
  }
  out.push('};');
  out.push('/** jet-pod nozzles per Pom frame, relative to the sprite centre: [x centre, y of the first flame row, width] */');
  out.push(`export const POM_NOZZLES: Record<string, [number, number, number][]> = ${JSON.stringify(nozz)};`);
  out.push('/** scarf knot per Pom frame, relative to the sprite centre: where the runtime scarf tail is tied on */');
  out.push(`export const POM_KNOT: Record<string, [number, number]> = ${JSON.stringify(knots)};`);
  out.push('/** wingpup nozzles per frame, relative to the sprite centre: [x centre, y of the first flame row, width] */');
  out.push(`export const PUP_NOZZLES: Record<string, [number, number, number][]> = ${JSON.stringify(pupN)};`);
  console.log(out.join('\n'));
}
