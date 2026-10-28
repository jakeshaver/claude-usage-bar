import { Grid, emitModule } from '../pixelgen.mjs';
// Captain Pom: a standard poodle in a continental show cut, seen from above, flying with her
// rear toward the top of the screen (she toots upward) and her face toward the player.
// Hand-drawn part stamps (no procedural shading noise), composited back to front so every
// show-cut part keeps its own 1px outline:
//   pompom tail (own circle) -> two separate hip rosettes (1px gap to the tail, shaved rump
//   between them) -> narrow 6px shaved pink waist -> big curly mane (shoulders) -> long tan
//   ears hanging below the mane -> shaved face with a long muzzle (chin on row 28) -> curly
//   white topknot with a bumpy edge -> hot-pink bow on top of the topknot.
// Rocket boosters bolt onto the mane's shoulders; flames are 6-7px with a white/yellow/
// orange-red gradient and a clearly different shape per frame.
// Light comes from the top-left: every pompom has one clustered white highlight top-left and
// a tan shadow band bottom-right. Bank frames squeeze the far side 3px, drop the far booster
// 2px behind the body, lean the head 1px into the turn and tilt the bow.

const TAIL = [ // 8x6 at (12,0): round pompom
  '..0000..',
  '.066670.',
  '06667780',
  '06677880',
  '.078880.',
  '..0000..',
];
const HIP = [ // 8x8 at (6,4) and (18,4)
  '..0000..',
  '.066670.',
  '06667770',
  '06677780',
  '07777780',
  '07777880',
  '.078880.',
  '..0000..',
];
const BODY = [ // shaved rump + waist, 8 wide at (12,4): pink skin lit from the left
  '00000000',
  '07ccccd0',
  '07ccccd0',
  '07ccccd0',
  '07ccccd0',
  '07ccccd0',
  '07ccccd0',
  '07ccccd0',
  '07ccccd0',
];
const MANE = [ // 22x10 at (5,14): wide curly shoulders, top-left highlight, bottom-right shade
  '...0000000000000000...',
  '.06666777777777777880.',
  '0666677777777777777880',
  '0666777777777777777880',
  '0777777777777777777880',
  '0777777777777777777880',
  '0777777777777777777880',
  '0777777777777777777880',
  '.08887777777777888880.',
  '...0000000000000000...',
];
const EAR = [ // 6x10 at (6,22) and (20,22): long curly lobes, darker tan, bumpy edges
  '.0000.',
  '078880',
  '088890',
  '.08890',
  '078890',
  '088990',
  '.08890',
  '078990',
  '.08990',
  '..000.',
];
const FACE = [ // 10x10 at (11,20): big eyes, blush, long muzzle, nose at the tip (chin row 28)
  '0777777770',
  '0777777770',
  '0706770680',
  '0700770080',
  '0700770080',
  '07c7777c80',
  '.07777780.',
  '..070080..',
  '..080080..',
  '...0000...',
];
const TOPKNOT = [ // 12x8 at (10,14): curly white pompom with bumpy sides
  '..00000000..',
  '.0666666670.',
  '066666666770',
  '066666666770',
  '066666667770',
  '.0666667770.',
  '..07777770..',
  '...000000...',
];
const BOW = [ // 8x5 at (12,15): two loops pinched at a dark knot
  '000..000',
  '0cd00de0',
  '0c6eede0',
  '0dd00ee0',
  '000..000',
];
const BOW_TILT = [ // 9x6: tilted ~20deg into a left bank (mirrored for the right bank)
  '000......',
  '0cd0..000',
  '0c6d00de0',
  '0ddeedde0',
  '.000dd0e0',
  '....00000',
];
const BOOSTER = [ // 6x8: red nose cone, grey body lit from the left, nozzle
  '.0000.',
  '0crre0',
  '06oop0',
  '06oop0',
  '06oop0',
  '0crre0',
  '.0qq0.',
  '.0000.',
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

// mirror-stamp: the right hip/ear reuse the left drawing but keep top-left light
const stampRows = (G, x, y, rows) => G.stamp(x, y, rows);

function torso() {
  const T = new Grid(32, 32);
  stampRows(T, 12, 5, BODY.concat(BODY.slice(1, 2)));
  stampRows(T, 12, 0, TAIL);
  stampRows(T, 7, 6, HIP);
  stampRows(T, 17, 6, HIP);
  stampRows(T, 5, 14, MANE);
  return T;
}
function head(bank) {
  const H = new Grid(32, 32);
  stampRows(H, 6, 21, EAR);
  stampRows(H, 20, 21, EAR);
  stampRows(H, 11, 20, FACE);
  stampRows(H, 10, 14, TOPKNOT);
  // bow clipped to the top-left of the topknot so the white curls show around it
  if (!bank) stampRows(H, 9, 14, BOW);
  else { const b = new Grid(9, 6); b.stamp(0, 0, BOW_TILT); if (bank > 0) b.flipX(); H.over(b, bank < 0 ? 8 : 11, 13); }
  return H;
}
// remove columns (foreshortening) and re-centre
function squeeze(G, cols, side) {
  for (let y = 0; y < 32; y++) {
    const row = G.g[y];
    for (const c of [...cols].sort((a, b) => b - a)) row.splice(c, 1);
    if (side < 0) row.push(...cols.map(() => '.')); else row.unshift(...cols.map(() => '.'));
  }
  return G;
}
function shift(G, dx) {
  const N = new Grid(32, 32); N.over(G, dx, 0); return N;
}

function poodle(flame, bank = 0) {
  const s = Math.sign(bank);
  let T = torso(), H = head(s);
  if (s < 0) { squeeze(T, [20, 22, 24], -1); squeeze(H, [20, 22, 24], -1); T = shift(T, 1); H = shift(H, 0); }
  if (s > 0) { squeeze(T, [7, 9, 11], 1); squeeze(H, [7, 9, 11], 1); T = shift(T, -1); H = shift(H, 0); }
  const G = new Grid(32, 32);
  const bodyMask = new Grid(32, 32); bodyMask.over(T); bodyMask.over(H);
  const boost = (x, y, behind) => {
    const B = new Grid(32, 32);
    B.stamp(x, y, BOOSTER);
    B.stamp(x + 1, y + 8, FLAME[flame]);
    if (behind) for (let j = 0; j < 32; j++) for (let i = 0; i < 32; i++) if (bodyMask.get(i, j) !== '.') B.px(i, j, '.');
    return B;
  };
  // far booster first (behind the body), then body, then near booster
  if (s < 0) { G.over(boost(22, 17, true)); G.over(T); G.over(H); G.over(boost(1, 15, false)); }
  else if (s > 0) { G.over(boost(4, 17, true)); G.over(T); G.over(H); G.over(boost(25, 15, false)); }
  else { G.over(T); G.over(H); G.over(boost(0, 15, false)); G.over(boost(26, 15, false)); }
  return G;
}

const defs = {
  poodle: [poodle(0), poodle(1)],
  poodle_left: [poodle(0, -1), poodle(1, -1)],
  poodle_right: [poodle(0, 1), poodle(1, 1)],
};
if (process.argv[1]?.endsWith('gen-poodle.mjs')) console.log(emitModule('POODLE', 'tools/art/gen-poodle.mjs', defs));
export { poodle };
