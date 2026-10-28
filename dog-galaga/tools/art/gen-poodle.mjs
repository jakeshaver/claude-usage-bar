import { Grid, emitModule } from '../pixelgen.mjs';
// Captain Pom: a standard poodle in a continental show cut, seen from above, flying
// "superman" style with her rear toward the top of the screen (she toots upward).
// Hand-authored material map (left half, mirrored), then lit programmatically from the
// top-left. Read top to bottom: hind-leg pompom bracelets + tail pompom, hip rosettes on a
// shaved rump, rocket harness on the shaved waist, big curly mane, foreleg bracelets,
// long fluffy ears, topknot with hot-pink bow, shaved muzzle with button nose.
// Materials: W white curls, E ear curls (in shade), S shaved skin, T muzzle, G rocket body,
// F flame slot, K/Q/N eye black / eye glint / nose glint (applied after lighting).
const HALF = [
  '..............00', // 0
  '......00.....0WW', // 1  hind paws, tail pompom
  '.....0SS0...0WWW', // 2
  '....0WWWW0..0WWW', // 3  hind-leg bracelets
  '...0WWWWWW0.0WWW', // 4
  '...0WWWWWW0..0WW', // 5
  '....0WWWW0....0S', // 6  tail stem
  '.....00000000.0S', // 7
  '..00....0WWWW0SS', // 8  rocket tip, hip rosette, shaved rump
  '.0rr0..0WWWWWW0S', // 9
  '0GGGG0.0WWWWWW0S', // 10
  '0rrrr0000WWWW0SS', // 11
  '0GGGG0MMMMMMMMMf', // 12 harness + buckle
  '0GGGG00000000SSS', // 13 shaved waist
  '0GGGG0..00000SSS', // 14
  '.0qq0..0WWWWWWWW', // 15 nozzle, mane
  '..FF..0WWWWWWWWW', // 16
  '..FF..0WWWWWWWWW', // 17
  '...F0S0WWWWWWWWW', // 18 forearm
  '..00S00000WWWWWW', // 19
  '.0WWW0EEEE0WWWWW', // 20 foreleg bracelet, ear, topknot
  '0WWWW0EEEEE0WWWW', // 21
  '0WWWW0EEEEEE0WWW', // 22
  '.0WW00EEEEEE0SSS', // 23 face
  '.0SS0EEEEEE0SQKS', // 24 paw, eyes
  '..000EEEEEE0SKKS', // 25
  '....0EEEEEE0STTT', // 26 snout
  '.....0EEEEE0STTN', // 27 nose
  '.....0EEEEE0STTK', // 28
  '......0EEEEE0TTT', // 29
  '.......0EEEE00Tc', // 30 tongue
  '........0000..00', // 31
];
const BOW = [ // cols 11..20, rows 15..19 (asymmetric lighting, so not mirrored)
  '000....000',
  '0cd0000dd0',
  '0dddcddde0',
  '0de0000ee0',
  '000....000',
];
const edge = (c) => c === '.' || c === '0';
function base() {
  const g = new Grid(32, 32);
  HALF.forEach((r, y) => { const full = r + [...r].reverse().join(''); [...full].forEach((c, x) => g.px(x, y, c)); });
  // asymmetric fixes: right eye glint stays on the top-left, nose glint only on the left
  g.px(17, 24, 'Q').px(18, 24, 'K').px(16, 27, 'K');
  g.stamp(11, 16, BOW);
  // lighting from the top-left
  const src = g.clone();
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const c = src.get(x, y); const R = src.get(x + 1, y), D = src.get(x, y + 1), U = src.get(x, y - 1), L = src.get(x - 1, y), DR = src.get(x + 1, y + 1);
    if (c === 'W') {
      if (edge(D) || edge(R) || edge(DR)) g.px(x, y, (edge(D) && edge(R)) ? '4' : '5');
      else g.px(x, y, '6');
    } else if (c === 'E') { // ears hang lower: in shade, so they separate from mane and topknot
      g.px(x, y, (edge(D) || edge(R)) ? '4' : (edge(U) || edge(L)) ? '6' : '5');
    } else if (c === 'T') g.px(x, y, (edge(D) || edge(R)) ? '8' : '7');
    else if (c === 'S') g.px(x, y, (edge(D) || edge(R)) ? '9' : (edge(U) || edge(L)) ? '7' : '8');
    else if (c === 'G') g.px(x, y, edge(L) ? '6' : edge(R) ? 'p' : 'o');
    else if (c === 'M') g.px(x, y, 'm');
    else if (c === 'F') g.px(x, y, '.');
    else if (c === 'K') g.px(x, y, '0'); else if (c === 'Q') g.px(x, y, '6'); else if (c === 'N') g.px(x, y, 'q');
  }
  // curls: small lavender hooks scattered over the interior of the fluffy masses
  const lit = g.clone();
  for (let y = 1; y < 31; y++) for (let x = 1; x < 31; x++) {
    if (lit.get(x, y) !== '6') continue;
    const inner = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].every(([dx, dy]) => !edge(src.get(x + dx, y + dy)));
    if (inner && (x * 3 + y * 5) % 7 === 0) g.px(x, y, '5');
  }
  return g;
}
function poodle(flame) {
  const g = base();
  // rocket exhaust: white-hot core, yellow, orange, red tip, alternating length
  const F = flame === 0 ? [['6', '6'], ['f', 'f'], ['.', 'g']] : [['f', 'f'], ['g', 'g'], ['.', 'r']];
  for (const x0 of [2, 28]) F.forEach(([a, b], i) => { const y = 16 + i; const [l, r] = x0 === 2 ? [a, b] : [b, a]; if (l !== '.') g.px(x0, y, l); if (r !== '.') g.px(x0 + 1, y, r); });
  return g;
}
// banking: the far side foreshortens (a column drops out) and the body slides into the turn
function bank(g, dir) {
  const n = new Grid(32, 32);
  for (let y = 0; y < 32; y++) {
    const row = g.g[y].slice();
    if (dir < 0) { row.splice(7, 1); row.splice(16, 0, row[15]); } // drop a far-left column, widen the near side
    else { row.splice(24, 1); row.splice(16, 0, row[16]); }
    n.g[y] = row.slice(0, 32);
  }
  // the head leads into the turn: shift rows 23..31 one pixel toward the turn
  for (let y = 23; y < 32; y++) {
    const row = n.g[y]; const seg = row.slice(6, 26);
    if (dir < 0) { seg.push(seg.shift()); } else { seg.unshift(seg.pop()); }
    // keep a clean outline: never move transparent over the outer columns
    for (let i = 0; i < seg.length; i++) row[6 + i] = seg[i];
  }
  return n;
}
const f0 = poodle(0), f1 = poodle(1);
const defs = {
  poodle: [f0, f1],
  poodle_left: [bank(f0, -1), bank(f1, -1)],
  poodle_right: [bank(f0, 1), bank(f1, 1)],
};
console.log(emitModule('POODLE', 'tools/art/gen-poodle.mjs', defs));
