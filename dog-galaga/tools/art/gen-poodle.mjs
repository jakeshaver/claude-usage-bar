import { Grid, emitModule } from '../pixelgen.mjs';
// Captain Pom: a standard poodle in a continental show cut, seen from above, flying with her
// rear toward the top of the screen (she toots upward) and her face toward the player.
// Silhouette, top to bottom, each step clearly wider or narrower:
//   pompom tail (narrow) > two hip pompoms (wide) > pinched shaved waist (narrow, hourglass
//   outline, pale pink-tan skin) > big curly mane (widest) > head: curly topknot with the
//   hot-pink bow, eyes peeking out under it, tan muzzle with a dark nose (narrow).
// Every curly part is a scalloped "fluff" blob filled with a clustered curl texture in
// white/cream/tan, lit from the top-left, with its own 1px dark outline, so the outline breaks
// into scallops. Ears are drooping teardrops in tan curls that overlap the mane.
// Rocket boosters are small 3x5 nozzles tucked under the outer edge of the hip pompoms.
// Bank frames: parts shift toward the bank side (tail/hips 1px, mane 1px, head 2px), the far
// ear is foreshortened to a sliver and the far booster tucks behind the hip.

const TONES = ['6', '7', '8', '9', 'a'];
// curly blob layer: fluff silhouette + curl texture + top-left light + outline
function curly(cx, cy, rx, ry, { n = 10, br = 1.5, phase = 0, base = 0, bias = 0, pat = 0, outline = true } = {}) {
  const L = new Grid(32, 32);
  L.fluff(cx, cy, rx, ry, 'x', n, br, phase);
  const C = L.clone();
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    if (C.get(x, y) !== 'x') continue;
    const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
    const l = (dx * 0.8 + dy) / 1.8 + bias;
    let t = l < -0.3 ? 0 : l < 0.2 ? 1 : l < 0.48 ? 2 : 3;
    // clustered curls: 4x3 cells, rows offset by 2; each curl = lit cap + shadowed underside
    const u = (x + pat + 2 * (Math.floor((y + pat) / 3) % 2)) % 4, v = (y + pat) % 3;
    const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => C.get(x + a, y + b) === '.');
    if (!edge) {
      if (v === 2 && (u === 1 || u === 2)) t += 1;
      else if (u === 3 && v === 1) t += 1;
      else if (v === 0 && u === 1 && t > 0) t -= 1;
    } else if (t < 1 && (dx > 0.3 || dy > 0.3)) t = 1;
    L.px(x, y, TONES[Math.min(TONES.length - 1, base + t)]);
  }
  if (outline) L.outline('0');
  return L;
}

const BOW = [ // 8x5 at x 12-19: two hot-pink loops pinched at a centre knot, lit top-left
  '000..000',
  '0cd00de0',
  '0cdddde0',
  '0dd00ee0',
  '000..000',
];
const BOW_TILT = [ // 7x6 hot-pink bow, jauntily tilted, lit top-left
  '00.....',
  '0c60.00',
  '0ccd0c0',
  '0cdddd0',
  '.00dde0',
  '...0000',
];
const FACE = [ // 10x7, top row sits under the topknot: eyes, blush, tan snout, dark nose tip
  '0777777780',
  '0760776080',
  '0700770080',
  '0c778878c0',
  '.07888890.',
  '..08p090..',
  '...0000...',
];
const NOZZLE = [ // 5x6 incl. outline: red rim, grey nozzle lit left
  '.000.',
  '0rre0',
  '06op0',
  '06op0',
  '0qqq0',
  '.000.',
];
const FLAME = [
  [ // long narrow jet
    '.66.',
    '.6f.',
    'ffff',
    'fggf',
    '.gg.',
    '.gr.',
    '..r.',
  ],
  [ // short wide flicker, leaning the other way
    '6ff6',
    'f66f',
    'fffg',
    'gggr',
    'rgr.',
    'r...',
  ],
];

// drooping teardrop ear in tan curls (narrow at the top, round lobe below)
function ear(cx, top, w = 1, flip = false) {
  const L = new Grid(32, 32);
  L.ellipse(cx, top + 5.8, 2.6 * w, 3.8, 'x');
  L.ellipse(cx + (flip ? -0.4 : 0.4) * w, top + 2.2, 1.6 * w, 2.4, 'x');
  const C = L.clone();
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    if (C.get(x, y) !== 'x') continue;
    const dx = (x + 0.5 - cx) / (2.6 * w), dy = (y - top - 4) / 4;
    let t = (dx + dy * 0.6) < -0.2 ? 0 : (dx + dy * 0.6) < 0.5 ? 1 : 2;
    const u = (x + 2 * (Math.floor(y / 2) % 2)) % 3, v = y % 2;
    const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => C.get(x + a, y + b) === '.');
    if (!edge && v === 1 && u === 2) t += 1;
    L.px(x, y, ['7', '7', '8', '9'][Math.min(3, t)]);
  }
  L.outline('0');
  return L;
}

function waist(dx = 0) {
  // shaved band: pale pink-tan skin, hourglass pinch (6 wide at its narrowest)
  const L = new Grid(32, 32);
  L.poly([[12 + dx, 8], [20 + dx, 8], [18.5 + dx, 13], [19.5 + dx, 16], [12.5 + dx, 16], [13.5 + dx, 13]], 'x');
  const C = L.clone();
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    if (C.get(x, y) !== 'x') continue;
    const left = C.get(x - 1, y) === '.', right = C.get(x + 1, y) === '.' || C.get(x + 2, y) === '.';
    L.px(x, y, left ? 'c' : right ? '9' : '8');
  }
  L.outline('0');
  return L;
}

function nozzle(x, y, flame) {
  const B = new Grid(32, 32);
  B.stamp(x + 1, y + 6, FLAME[flame]);
  B.stamp(x, y, NOZZLE);
  return B;
}

// Selective-outline compositor: parts are flat colour fills with a z order. Where a part
// touches a part in front of it, its edge pixels take the part's `contour` tone (a darker
// tone of itself, not black), so internal edges read as folds of fur instead of a cage of
// black lines. Only the outer silhouette gets the 1px ink outline.
function compose(parts) {
  const C = new Grid(32, 32), Z = Array.from({ length: 32 }, () => Array(32).fill(-1));
  parts.forEach((p, i) => { for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { const c = p.g.get(x, y); if (c !== '.' && c !== '0') { C.px(x, y, c); Z[y][x] = i; } } });
  const out = C.clone();
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const i = Z[y][x]; if (i < 0 || !parts[i].contour) continue;
    const front = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => (Z[y + b]?.[x + a] ?? -1) > i && !parts[Z[y + b][x + a]].noCut);
    if (front) out.px(x, y, parts[i].contour);
  }
  out.outline('0');
  return out;
}
function fill(fn) { const L = new Grid(32, 32); fn(L); return L; }

// hand-drawn fills (no outline: the compositor adds ink on the silhouette and fur-tone
// contours where parts overlap). Curls are clustered lit-cap / shadowed-underside pairs.
const EAR_L = [ // 6x10 drooping teardrop: narrow at the head, round curly lobe below
  '.67...',
  '.677..',
  '67787.',
  '678777',
  '787877',
  '678878',
  '787887',
  '778898',
  '.78898',
  '..889.',
];
const EAR_R = [ // mirrored shape, one tone darker (away from the top-left light)
  '...77.',
  '..7787',
  '.77887',
  '778878',
  '788789',
  '788898',
  '889898',
  '788999',
  '88999.',
  '.999..',
];
const TOPKNOT = [ // 10x7 white curly pompom on the crown
  '..666776..',
  '.66676777.',
  '6667677787',
  '6676677788',
  '7667778788',
  '.77787888.',
  '..778878..',
];
const FACE_FILL = [ // 8x8 shaved face + long tan snout (eyes, nose stamped after)
  '.777777.',
  '77777777',
  '77777778',
  '77777778',
  '77788778',
  '.778889.',
  '..7889..',
  '...88...',
];
const narrow = (rows, drop) => rows.map(r => [...r].filter((_, i) => !drop.includes(i)).join(''));
const mirrorRows = (rows) => rows.map(r => [...r].reverse().join(''));

function poodle(flame, bank = 0) {
  const s = Math.sign(bank);
  const sh = (k) => s * k;
  const tex = (o) => curly(o.cx, o.cy, o.rx, o.ry, { ...o, outline: false });
  const tail = tex({ cx: 16 + sh(1), cy: 3.4, rx: 3.6, ry: 2.6, n: 7, br: 1.1, phase: 0.4 });
  const hipL = tex({ cx: 10.9 + sh(1) + (s > 0 ? 0.6 : 0), cy: 8.4, rx: 4.9 * (s > 0 ? 0.85 : 1), ry: 3.7, n: 9, br: 1.3, phase: 0.2, pat: 1 });
  const hipR = tex({ cx: 21.1 + sh(1) - (s < 0 ? 0.6 : 0), cy: 8.4, rx: 4.9 * (s < 0 ? 0.85 : 1), ry: 3.7, n: 9, br: 1.3, phase: 0.5, pat: 2 });
  const waistL = fill(L => {
    const d = sh(1);
    L.poly([[12.5 + d, 10], [19.5 + d, 10], [18.2 + d, 13.4], [19.6 + d, 16], [12.4 + d, 16], [13.8 + d, 13.4]], 'x');
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (L.get(x, y) === 'x') L.px(x, y, L.get(x - 1, y) === '.' ? 'c' : (L.get(x + 1, y) === '.' ? '9' : '8'));
  });
  const mane = tex({ cx: 16 + sh(1), cy: 19, rx: 10, ry: 4.3, n: 13, br: 1.5, phase: 0.1, bias: 0.25 });
  const hx = 11 + sh(2);
  // far ear foreshortened (2 columns dropped) and tucked toward the face
  const earL = fill(L => L.stamp(hx - 4 + (s > 0 ? 3 : 0), 20, s > 0 ? narrow(EAR_L, [0, 2, 4]) : EAR_L));
  const earR = fill(L => L.stamp(hx + 8, 20, s < 0 ? narrow(EAR_R, [1, 3, 5]) : EAR_R));
  const face = fill(L => L.stamp(hx + 1, 22, FACE_FILL));
  const top = fill(L => L.stamp(hx, 17, TOPKNOT));
  const body = compose([
    { g: waistL, contour: '9' }, { g: tail, contour: '8' }, { g: hipL, contour: '8' }, { g: hipR, contour: '8' },
    { g: mane, contour: 'a' }, { g: earL, contour: 'a' }, { g: earR, contour: 'a' }, { g: face, contour: '9' }, { g: top, contour: '8' },
  ]);
  // face details: 2x2 eyes with a top-left glint, blush, dark nose at the snout tip
  body.stamp(hx + 2, 24, ['60..60', '00..00']);
  body.px(hx + 1, 26, 'c'); body.px(hx + 8, 26, 'c'); body.px(hx + 4, 27, '9');
  body.stamp(hx + 4, 28, ['p0', '00']);
  const G = new Grid(32, 32);
  // boosters under the outer hip edge; in a bank the far one is tucked behind the hip
  const nz = (x, y) => { G.stamp(x + 1, y + 6, FLAME[flame]); G.stamp(x, y, NOZZLE); };
  if (s >= 0) nz(26 + sh(1), 8); else nz(23, 9);
  if (s <= 0) nz(1 + sh(1), 8); else nz(4, 9);
  G.over(body);
  // bow perched on the top-left of the topknot (curls stay visible on its right)
  { const b = new Grid(7, 6); b.stamp(0, 0, BOW_TILT); if (s > 0) b.flipX(); G.over(b, hx - 1 + (s > 0 ? 4 : 0), 15); }
  return G;
}

const defs = {
  poodle: [poodle(0), poodle(1)],
  poodle_left: [poodle(0, -1), poodle(1, -1)],
  poodle_right: [poodle(0, 1), poodle(1, 1)],
};
if (process.argv[1]?.endsWith('gen-poodle.mjs')) console.log(emitModule('POODLE', 'tools/art/gen-poodle.mjs', defs));
export { poodle };
