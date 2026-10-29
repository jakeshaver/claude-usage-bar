// Captain Pom art for the player module: node src/player/art/gen-pom.mjs > src/player/pom-art.ts
// Top-down, rear (tail) toward the top of the screen, face toward the player. Reading order, front to back:
// a big bright topknot head (largest, lightest mass) with darker tan ear lobes, a 1px ink gap, a cream mane,
// a pink harness carrying two jet pods, a smaller tan rear puff, a thin tail stalk and a small dark pompom.
// Shading ramps darken from head (white) to tail (brown), so the heading reads at 1x in a glance.
import { Grid } from '../../../tools/pixelgen.mjs';

const W = 32;
// shaded puff layer: fill an ellipse, light it from the top-left, curl marks on the shadow side, outline
function puff(cx, cy, rx, ry, [hi, mid, lo], { out = '0', bias = 0, curls = true, w = W, h = W } = {}) {
  const g = new Grid(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry, d = nx * nx + ny * ny;
    if (d > 1) continue;
    const l = nx * 0.6 + ny * 0.7 + nx * bias + (d > 0.6 ? 0.2 : 0);
    g.g[y][x] = l < -0.35 ? hi : l < 0.55 ? mid : lo;
  }
  if (curls && rx >= 3.5) for (const [mx, my] of [[0.5, 0.25], [0.05, 0.62], [-0.5, 0.4], [0.62, -0.3]]) {
    const x = Math.round(cx + mx * rx * 0.72 - 0.5), y = Math.round(cy + my * ry * 0.72 - 0.5);
    if (g.get(x, y) === mid) { g.px(x, y, lo); if (g.get(x + 1, y) === mid) g.px(x + 1, y, lo); }
  }
  if (out) g.outline(out);
  return g;
}

/** one jet pod (rounded capsule, lit from the left); returns nozzle [x, y, w] (first flame row) */
function pod(g, x, y, w, h) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const cap = (j === 0) && w > 2 && (i === 0 || i === w - 1);
    if (cap) continue;
    g.px(x + i, y + j, j === h - 1 ? 'q' : i === 0 && w > 2 ? '6' : i === w - 1 ? 'p' : 'o');
  }
  if (h > 3) g.px(x + Math.min(1, w - 1), y + 1, 'l');
  return [x, y + h, w];
}

/** L: -1 full bank left .. 1 full bank right. squash: tail pompom squashed by a toot. stretch: wake-up stretch. */
function pom(L = 0, { squash = false, stretch = false } = {}) {
  const g = new Grid(W, W);
  const s = Math.sign(L), a = Math.abs(L);
  const narrow = 1 - 0.2 * a;                     // body foreshortens as she rolls
  const nozzles = [];
  // far pod first (tucked behind the body), then the body, then the near pod
  const podAt = (side, near) => {
    const full = a > 0.7;
    const w = near ? (full ? 5 : a > 0 ? 4 : 3) : full ? 3 : 3;
    const h = near && full ? 7 : 6;
    let x = side < 0 ? 4 : 28 - w;                 // idle: out on the harness arms, flames clear of the ears
    if (near && a > 0) x += side * (full ? 2 : 1);  // near pod swings out and down
    if (!near) x -= side * (full ? 6 : 3);          // far pod tucks under the body
    const y = 12 + (near && full ? 1 : near && a > 0 ? 1 : 0) - (!near && full ? 1 : 0);
    nozzles.push(pod(g, x, y, w, h));
    if (near) for (let j = 0; j < h; j++) { const ix = side < 0 ? x + w : x - 1; if (g.get(ix, y + j) === '.') g.px(ix, y + j, '0'); }
  };
  const farSide = s ? -s : 0;
  if (farSide) podAt(farSide, false);

  // harness straps to the pods (behind the fur)
  const cxB = 16 + L * 0.5;
  // --- tail pompom (small, darkest) on a visible stalk; swings opposite to the roll ---
  const tx = 16 - L * 1.2;
  const tail = squash ? puff(tx, 4.2, 3.4, 2.2, ['8', '9', 'a'], { curls: false }) : puff(tx, 3.6, 2.9, 2.8, ['8', '9', 'a'], { curls: false });
  g.over(tail);
  g.rect(Math.round(tx - 1), 6, 2, 3, '9'); g.px(Math.round(tx) , 7, 'a'); g.px(Math.round(tx), 8, 'a');
  g.px(Math.round(tx) - 2, 7, '0'); g.px(Math.round(tx) + 1, 7, '0'); g.px(Math.round(tx) - 2, 8, '0'); g.px(Math.round(tx) + 1, 8, '0');
  // --- rear puff (tan, mid tone) ---
  const rear = puff(cxB - L * 0.3, 11, 5.6 * narrow, 3.4, ['7', '8', '9'], { bias: L * 0.5 });
  g.over(rear);
  // --- shaved waist under the harness ---
  for (const [y, hw] of [[14, 4], [15, 4]]) for (let x = Math.round(cxB - hw * narrow); x < Math.round(cxB + hw * narrow); x++) g.px(x, y, '8');
  // straps from the waist to each pod
  // --- mane / chest (cream, lighter) ---
  const cxM = 16 + L * 1;
  const mane = puff(cxM, 17.2, 6.6 * narrow, 3.3, ['6', '7', '8'], { bias: L * 0.5 });
  g.over(mane);
  // harness: pink band across the waist + straps to the pods
  const hb = Math.round(cxB - 6 * narrow), he = Math.round(cxB + 6 * narrow);
  g.rect(hb, 14, he - hb, 1, 'd'); g.rect(Math.round(cxB) - 2, 14, 4, 1, 'e'); g.px(Math.round(cxB) - 1, 14, 'f'); g.px(Math.round(cxB), 14, 'f');
  if (s) podAt(s, true); else { podAt(-1, true); podAt(1, true); }
  // straps from the band out to each pod
  for (const [nx, , nw] of nozzles) {
    const [x0, x1] = nx < 16 ? [nx + nw, hb - 1] : [he, nx - 1];
    for (let x = x0; x <= x1; x++) if (g.get(x, 14) === '.' || g.get(x, 14) === '0') g.px(x, 14, 'd');
  }

  // --- head: the biggest, brightest mass; separated from the mane by a 1px ink gap ---
  const hx = 16 + L * 2, hy = 25.2 + (stretch ? 1.5 : 0);
  // ears first: darker tan lobes either side of the head, swinging toward the turn
  for (const side of [-1, 1]) {
    const near = s === side, far = s === -side;
    const ex = hx + side * (near ? 6.6 + a * 0.6 : far ? 5.4 : 6.3) + L * 0.8 + (stretch ? side * 1.5 : 0);
    const ey = 26.4 + (near ? a : far ? -a * 0.5 : 0) + (stretch ? 1 : 0);
    const ear = puff(ex, ey, far ? 1.8 : 2.3, near ? 4.0 : 3.5, ['8', '9', 'a'], { curls: false, bias: side * -0.3 });
    g.over(ear);
  }
  const head = puff(hx, hy, 6.9 * (1 - 0.06 * a), 5.1, ['6', '6', '7'], { curls: false, bias: L * 0.3 });
  // soft curls in the topknot (cream, not tan, so the head stays the lightest)
  for (const [mx, my] of [[-3, -2], [2, -3], [3, 0], [-1, 1], [-4, 1]]) { const x = Math.round(hx + mx - 0.5), y = Math.round(hy + my - 0.5); if (head.get(x, y) === '6') head.px(x, y, '7'); }
  g.over(head);
  // bow on the back of the head (pink, the only saturated mass on the body)
  const bx = Math.round(hx);
  g.stamp(bx - 3, Math.round(hy) - 5, ['cd.dc', 'dded d'.replace(' ', 'd').slice(0, 5), '.d.d.'].map(r => r), {});
  g.px(bx - 1, Math.round(hy) - 4, 'e'); g.px(bx - 1, Math.round(hy) - 5, 'e');
  // face at the front of the head: two eyes, blush, a cream muzzle and a black nose at the very front
  const fy = Math.round(hy) + 1, fx = bx + Math.round(L * 0.6);
  if (stretch) { for (const ex of [fx - 4, fx + 2]) { g.px(ex, fy + 1, '0'); g.px(ex + 1, fy, '0'); g.px(ex + 2, fy + 1, '0'); } } // ^ ^
  else for (const ex of [fx - 3, fx + 2]) { g.px(ex, fy, '0'); g.px(ex, fy + 1, '0'); }
  g.px(fx - 4, fy + 2, 'c'); g.px(fx + 3, fy + 2, 'c');
  g.rect(fx - 2, fy + 2, 4, 2, '7'); g.rect(fx - 1, fy + 2, 2, 1, '8');
  g.rect(fx - 1, fy + 3, 2, 1, '0');               // nose
  if (stretch) { g.rect(fx - 1, fy + 4, 2, 1, 'd'); g.px(fx - 2, fy + 4, '0'); g.px(fx + 1, fy + 4, '0'); } // yawn
  // final silhouette outline
  g.outline('0');
  return { g, nozzles: nozzles.map(([x, y, w]) => [x + w / 2 - 16, y - 16, w]) };
}

// ---- wingpup: 16x16, same language (tail up, harness, one jet pod, face toward the player) ----
function pup(L = 0) {
  const g = new Grid(16, 16);
  const s = Math.sign(L), a = Math.abs(L);
  const tx = 8 - L;
  // tail: a little wagging stalk + tuft
  g.rect(Math.round(tx) - 1, 1, 2, 2, '9'); g.px(Math.round(tx) - 1, 1, '8');
  g.rect(Math.round(tx) - 1, 3, 1, 2, 'a'); g.rect(Math.round(tx), 3, 1, 2, 'b');
  // body
  g.over(puff(8 + L * 0.4, 7, 3.6 * (1 - 0.15 * a), 2.6, ['9', 'a', 'b'], { curls: false, out: '0', w: 16, h: 16 }));
  // red harness band
  for (let x = 4; x < 12; x++) if (g.get(x, 8) !== '.' && g.get(x, 8) !== '0') g.px(x, 8, 'r');
  // jet pod on the right flank (moves under the body on a right roll)
  const px = 12 - (s > 0 ? 1 : 0) + (s < 0 ? 1 : 0), pw = s > 0 ? 2 : 3;
  const noz = pod(g, px, 5, pw, 4);
  g.px(px - 1, 8, 'r');
  // head: lighter brown, big for a puppy, floppy dark ears
  const hx = 8 + L * 1;
  for (const side of [-1, 1]) g.over(puff(hx + side * 4 + L * 0.4, 11.4 + (s === side ? 0.5 : 0), 1.5, 2.6, ['a', 'b', 'b'], { curls: false, w: 16, h: 16 }));
  g.over(puff(hx, 11.2, 3.6, 3, ['8', '9', '9'], { curls: false, w: 16, h: 16 }));
  const bx = Math.round(hx);
  g.px(bx - 2, 11, '0'); g.px(bx + 1, 11, '0');
  g.rect(bx - 1, 12, 2, 2, '7'); g.px(bx - 1, 13, '0'); g.px(bx, 13, '0');
  g.px(bx - 1, 9, '8'); g.px(bx, 9, '7');
  g.outline('0');
  return { g, nozzle: [noz[0] + noz[2] / 2 - 8, noz[1] - 8, noz[2]] };
}

// ---- nap: top-down curl, a fur donut with the head tucked onto the tail, harness and pods kept ----
function nap(breath = 0) {
  const g = new Grid(32, 24);
  const b = breath * 0.5;
  // pods lying on her back-right, behind the curl
  pod(g, 25, 4, 3, 5); pod(g, 3, 13, 3, 5);
  // body ring (darker toward the tail end at upper right)
  g.over(puff(16, 12, 11.5 + b, 8.6 + b, ['7', '8', '9'], { w: 32, h: 24 }));
  // inner hollow where the curl closes (shadowed fur)
  const hollow = puff(17, 12.5, 4.6, 3.2, ['9', '9', 'a'], { curls: false, out: 'a', w: 32, h: 24 });
  g.over(hollow);
  // harness band arcs over the back
  for (let x = 8; x < 26; x++) { const y = Math.round(5.2 + Math.pow((x - 17) / 9, 2) * 3.2 - b); if (g.get(x, y) !== '.' && g.get(x, y) !== '0') g.px(x, y, 'd'); }
  // tail pompom curled round to the front-right, head resting on it
  g.over(puff(21.5, 17.2, 3, 2.6, ['8', '9', 'a'], { curls: false, w: 32, h: 24 }));
  // ear draped over the body
  g.over(puff(8.2, 15.6, 2.2, 3.8, ['8', '9', 'a'], { curls: false, w: 32, h: 24 }));
  // head (brightest), tucked onto the tail
  g.over(puff(14.5, 15.8 + b * 0.5, 5.6, 4.4, ['6', '6', '7'], { curls: false, w: 32, h: 24 }));
  g.over(puff(19.6, 16.6, 1.8, 3, ['8', '9', 'a'], { curls: false, w: 32, h: 24 }));
  // bow, closed eyes, nose on the tail
  g.stamp(12, 11, ['cd.dc', 'ddedd', '.d.d.']);
  g.px(12, 16, '0'); g.px(13, 17, '0'); g.px(16, 17, '0'); g.px(17, 16, '0');
  g.rect(13, 18, 4, 2, '7'); g.rect(14, 19, 2, 1, '0'); g.px(12, 18, 'c'); g.px(17, 18, 'c');
  g.outline('0');
  return g;
}

const rowsOf = g => g.rows();
const out = [];
out.push('// generated by src/player/art/gen-pom.mjs: change the generator and re-run, do not hand-edit');
out.push("import type { SpriteDef } from '../art/sprite';");
const defs = {}, nozz = {};
const bankSet = { pom: 0, pom_lean_l: -0.55, pom_lean_r: 0.55, pom_bank_l: -1, pom_bank_r: 1 };
for (const [name, L] of Object.entries(bankSet)) {
  const n = pom(L), q = pom(L, { squash: true });
  defs[name] = [rowsOf(n.g), rowsOf(q.g)]; nozz[name] = n.nozzles;
}
const st = pom(0, { stretch: true }); defs.pom_stretch = [rowsOf(st.g)]; nozz.pom_stretch = st.nozzles;
const pupSet = { pom_pup: 0, pom_pup_l: -1, pom_pup_r: 1 };
const pupN = {};
for (const [name, L] of Object.entries(pupSet)) { const p = pup(L); defs[name] = [rowsOf(p.g)]; pupN[name] = p.nozzle; }
defs.pom_nap = [rowsOf(nap(0)), rowsOf(nap(1))];
out.push('export const POM_ART: Record<string, SpriteDef> = {');
for (const [k, fr] of Object.entries(defs)) {
  out.push(`  ${k}: { rows: [`); out.push(...fr[0].map(r => `    '${r}',`));
  if (fr.length > 1) { out.push('  ], frames: ['); for (const f of fr.slice(1)) { out.push('    ['); out.push(...f.map(r => `      '${r}',`)); out.push('    ],'); } out.push('  ] },'); }
  else out.push('  ] },');
}
out.push('};');
out.push('/** jet-pod nozzles per Pom frame, relative to the sprite centre: [x centre, y of the first flame row, width] */');
out.push(`export const POM_NOZZLES: Record<string, [number, number, number][]> = ${JSON.stringify(nozz)};`);
out.push('/** wingpup nozzle per frame, relative to the sprite centre */');
out.push(`export const PUP_NOZZLE: Record<string, [number, number, number]> = ${JSON.stringify(pupN)};`);
console.log(out.join('\n'));
