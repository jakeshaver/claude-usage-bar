import { Grid, emitModule } from '../pixelgen.mjs';
// Captain Pom: a standard poodle in a continental show cut, seen from above, flying
// "superman" style with her rear toward the top of the screen (she toots upward).
// One connected teardrop, read top to bottom:
//   pompom tail -> two hip rosettes on a shaved rump -> narrow shaved waist with a grey
//   harness -> wide curly mane -> head (topknot + hot-pink bow, shaved muzzle) with long
//   curly ears hanging down beside the face.
// Hand-authored material map (left half, mirrored), lit programmatically from the top-left.
// Materials: W white curls, E ear curls (one step darker), S shaved skin, T shaved muzzle,
// s soft seam where one fluffy part overlaps another (warm brown, not black), H harness.
// Fur ramp: white 6 -> cream 7 -> tan 8, seams 9. No lavender: she is warm, not icy.
const HALF = [
  '..............00', // 0  tail pompom
  '.............0WW', // 1
  '............0WwW', // 2
  '............0WWW', // 3
  '.........0000WWW', // 4  hip rosettes start
  '........0WWW0wWW', // 5
  '.......0WwWWWzzz', // 6
  '......0WWWWWwWWz', // 7
  '......0WWwWWWWWz', // 8  the two hip rosettes touch, a soft cleft between them
  '......0WWWWWWwW0', // 9
  '.......0WWwWWW0S', // 10
  '........0WWWW0SS', // 11 shaved waist (4px)
  '.....HHHHHHHHHHB', // 12 harness strap + gold buckle
  '.............0SS', // 13
  '..........0000SS', // 14
  '........0WWWWWWW', // 15 mane
  '......00WWwWWWwW', // 16
  '.....0WWWWWWWWWW', // 17
  '....0WWwWWWwWWWW', // 18
  '....0WWWWWWWWsss', // 19 topknot (bow goes here)
  '.....0WWwWWWsWWW', // 20
  '....0WWWWWsEsWWW', // 21 ears hang from under the topknot
  '....0WwWWsEEsWWW', // 22
  '.....0WWsExEsWWW', // 23
  '.....0WsEEEEsWWW', // 24
  '.....0sExEE0TTTT', // 25 face
  '......0EEEx0TTTT', // 26
  '......0ExEE0TTTT', // 27
  '......0EEExE0TTT', // 28 muzzle narrows
  '......0ExEEE0TTT', // 29
  '.......0EExE00TT', // 30
  '........0000..00', // 31
];
const BOOSTER = [ // 6 wide, rows 8..15
  '..00..',
  '.0RR0.',
  '0GGGG0',
  '0RRRR0',
  '0GGGG0',
  '0GGGG0',
  '0GGGG0',
  '.0NN0.',
];
const BOW = [ // bowtie: two triangular loops pinched at a centre knot
  '00....00',
  '0cd00dd0',
  '0cddcdde0'.slice(0, 8),
  '0dd00de0',
  '00....00',
];
const isEdge = (c) => c === '.' || c === '0' || c === 's' || c === 'z' || c === 'H' || c === 'B';
const same = (a, b) => a === b || (a === 'W' && b === 'w') || (a === 'w' && b === 'W') || (a === 'E' && b === 'x') || (a === 'x' && b === 'E');

function material(bank) {
  const g = new Grid(32, 32);
  HALF.forEach((r, y) => { const full = r + [...r].reverse().join(''); [...full].forEach((c, x) => g.px(x, y, c)); });
  if (bank !== 0) {
    // build the left bank, flip for the right bank. Far (right) side foreshortens by 3px,
    // near side widens by 1px, head + ears lean 1px into the turn.
    for (let y = 0; y < 32; y++) {
      const row = g.g[y];
      for (const c of [22, 20, 18]) row.splice(c, 1);
      row.push('.', '.', '.');
      if (y >= 15 && y <= 25) { row.splice(7, 0, row[7]); row.pop(); } // near mane side bulges
      if (y >= 19) { row.push(row.shift()); }
      g.g[y] = row;
    }
    if (bank > 0) g.flipX();
  }
  return g;
}

function light(m, flame, bank) {
  const out = new Grid(32, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const c = m.get(x, y);
    const U = m.get(x, y - 1), D = m.get(x, y + 1), Lf = m.get(x - 1, y), R = m.get(x + 1, y), DR = m.get(x + 1, y + 1);
    const tl = (c !== U && isEdge(U)) || (c !== Lf && isEdge(Lf)) || U !== c && U !== '.' && !isEdge(U) && false;
    const br = (D !== c) || (R !== c);
    const br2 = D !== c && R !== c;
    let o = c;
    const sd = !same(c, D), sr = !same(c, R);
    if (c === 'W' || c === 'w') {
      o = (sd && sr) ? '8' : (sd || sr || !same(c, DR)) ? '7' : c === 'w' ? '7' : '6';
    } else if (c === 'E' || c === 'x') {
      o = (sd || sr) ? '9' : c === 'x' ? '9' : tl ? '7' : '8';
    } else if (c === 'S') o = br ? 'a' : tl ? '8' : '9';
    else if (c === 'T') o = br ? '8' : tl ? '6' : '7';
    else if (c === 's') o = '9';
    else if (c === 'z') o = '8';
    else if (c === 'H') o = 'q';
    else if (c === 'B') o = 'f';
    out.px(x, y, o);
  }
  // boosters (behind the body on the far side when banking)
  const boost = (x0, behind) => {
    const B = new Grid(32, 32);
    B.stamp(x0, 8, BOOSTER);
    for (let y = 8; y < 16; y++) for (let x = x0; x < x0 + 6; x++) {
      const c = B.get(x, y); const lft = B.get(x - 1, y) === '0', rgt = B.get(x + 1, y) === '0';
      if (c === 'G') B.px(x, y, lft ? '6' : rgt ? 'p' : 'o');
      if (c === 'R') B.px(x, y, rgt ? 'e' : lft ? 'c' : 'r');
      if (c === 'N') B.px(x, y, 'q');
    }
    // exhaust: white-hot core, yellow, orange, red tip. Frame 0 long (5px), frame 1 short (3px).
    const fl = flame === 0 ? ['66', 'ff', 'fg', 'gr', 'r.'] : ['6f', 'gg', '.r'];
    fl.forEach((p, i) => [...p].forEach((c, j) => { if (c !== '.') B.px(x0 + 2 + j, 16 + i, c); }));
    if (flame === 0) B.px(x0 + 1, 17, 'g').px(x0 + 4, 17, 'g');
    if (behind) { for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (out.get(x, y) !== '.') B.px(x, y, '.'); }
    out.over(B);
  };
  if (bank === 0) { boost(0, false); boost(26, false); }
  else if (bank < 0) { boost(0, false); boost(21, true); }
  else { boost(11 - 6 + 0, true); boost(26, false); }
  // the strap must reach the near booster
  return out;
}

function poodle(flame, bank = 0) {
  const m = material(bank);
  const g = light(m, flame, bank);
  // face details, placed relative to the face's centre column
  let cx = 16; // centre of the muzzle (between cols 15|16)
  if (bank < 0) cx = 15 - 1 + 1 - 1 + 1; // leaned left by 1 (after column surgery)
  if (bank < 0) cx = 15; if (bank > 0) cx = 17;
  const eye = (x) => { g.px(x, 25, '6').px(x + 1, 25, '0').px(x, 26, '0').px(x + 1, 26, '0'); };
  eye(cx - 3); eye(cx + 1);
  g.px(cx - 1, 28, 'q').px(cx, 28, '0'); // nose with glint
  g.px(cx - 2, 29, '0').px(cx - 1, 29, '8').px(cx, 29, '8').px(cx + 1, 29, '0'); // smile corners
  g.px(cx - 1, 30, 'd').px(cx, 30, 'c'); // tongue out
  g.px(cx - 1, 31, '0').px(cx, 31, '0');
  g.px(cx - 3, 27, 'c').px(cx + 2, 27, 'c'); // blush
  g.stamp(cx - 4, 18, BOW);
  return g;
}

const defs = {
  poodle: [poodle(0), poodle(1)],
  poodle_left: [poodle(0, -1), poodle(1, -1)],
  poodle_right: [poodle(0, 1), poodle(1, 1)],
};
if (process.argv[1]?.endsWith('gen-poodle.mjs')) console.log(emitModule('POODLE', 'tools/art/gen-poodle.mjs', defs));
export { poodle };
