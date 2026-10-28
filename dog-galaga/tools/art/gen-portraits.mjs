import { Grid, emitModule } from '../pixelgen.mjs';
import { BREEDS, cat } from './gen-cats.mjs';
// 40x40 dialogue portraits: head-and-shoulders busts facing the viewer, lit from the top-left,
// built from outlined layers like the sprites. portrait_<breed> are the breeds'
// own busts (see bust()), drawn in the same palette and outline style as the bosses.
const N = 40;
const L = () => new Grid(N, N);
function stack(parts) { const g = L(); for (const p of parts) { p.outline('0'); g.over(p); } return g; }
function curls(G, base, lo, seed = 0) {
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
    if (G.get(x, y) !== base) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1]].some(([dx, dy]) => G.get(x + dx, y + dy) === '.')) continue;
    if ((x * 3 + y * 5 + seed) % 9 === 0) { G.px(x, y, lo); if (G.get(x + 1, y + 1) === base) G.px(x + 1, y + 1, lo); }
  }
}
const fluffy = (fn, deep = true, seed = 0, ramp = ['7', '8']) => { const G = L(); fn(G); G.relight('6', deep ? { lo: ramp[0], lo2: ramp[1], d: 2 } : { lo: ramp[0] }); curls(G, '6', ramp[0], seed); return G; };

// ---- Captain Pom ----------------------------------------------------------------------
function pom() {
  const mane = fluffy(G => G.fluff(20, 38, 16, 7, '6', 16, 2, 0.2));
  const scarf = L(); scarf.ellipse(20, 32.4, 8.6, 2.4, 'r'); scarf.poly([[22, 32], [28, 33], [27, 38], [24, 37]], 'r'); scarf.relight('r', { hi: 'c', lo: 'e' });
  const earL = L(); earL.fluff(8, 26, 4.8, 10.5, '8', 10, 1.6, 0.4); earL.relight('8', { hi: '7', lo: '9', lo2: 'a', d: 2 }); curls(earL, '8', '9', 1); curls(earL, '7', '8', 3);
  const earR = earL.clone().flipX();
  const face = L(); face.ellipse(20, 21.6, 8.6, 8, '8'); face.relight('8', { hi: '7', lo: '9' });
  const snout = L(); snout.ellipse(20, 27, 5.2, 3.8, '7'); snout.relight('7', { lo: '8' });
  snout.stamp(18, 24, ['0000', '0q00', '.00.']); // nose with glint
  snout.stamp(17, 28, ['0.00.0', '.0cc0.', '..cc..']); // smile + tongue
  snout.px(15, 27, 'c').px(25, 27, 'c'); // blush
  const eyes = L();
  for (const x of [13, 23]) eyes.stamp(x, 18, ['.00.', '06a0', '0aa0', '0000', '.00.']);
  const top = fluffy(G => G.fluff(20, 10.4, 9.6, 7, '6', 12, 2, 0.1), true, 2);
  const bow = L(); bow.stamp(23, 1, [
    'dd.......dd',
    'dcdd...ddde',
    'dccdd.dddde',
    'dcdddcdddde',
    'dddddcdddde',
    'dddddddddee',
    'dddde.edeee',
    'dde.....eee',
  ]);
  const g = stack([mane, scarf, earL, earR, face, snout, top, bow]);
  g.over(eyes);
  return g;
}
// ---- Commander Biscuit: old bulldog, headset, medals ----------------------------------
function biscuit() {
  const coat = L(); coat.ellipse(20, 42, 19, 10, 'n'); coat.relight('n', { hi: 'm', lo: '1' });
  coat.poly([[14, 33], [20, 40], [26, 33]], '6'); coat.poly([[17, 34], [20, 40], [23, 34]], 'r'); // shirt + tie
  coat.line(14, 33, 18, 40, '1').line(26, 33, 22, 40, '1'); // lapels
  // medals on the left chest (viewer's right reads as his left): ribbons + gold discs
  coat.rect(5, 35, 6, 1, 'f'); // shoulder braid
  const ears = L(); ears.poly([[6, 10], [12, 7], [11, 14]], 'a').poly([[34, 10], [28, 7], [29, 14]], 'a'); ears.relight('a', { lo: 'b' });
  const head = L(); head.ellipse(20, 19, 13, 11, '9'); head.relight('9', { hi: '8', lo: 'a' });
  head.poly([[18, 9], [22, 9], [24, 24], [16, 24]], '7', ['9', '8', 'a']); // white blaze
  for (const [y, w] of [[12, 4], [14, 5]]) { head.line(20 - w - 4, y, 20 - 6, y + 1, 'a'); head.line(20 + w + 3, y, 20 + 5, y + 1, 'a'); } // brow wrinkles
  // droopy old eyes with heavy lids and bushy grey brows
  for (const [x, flip] of [[11, false], [24, true]]) {
    const e = ['oooo.', '00000', '0660.', '.000.'].map(r => flip ? [...r].reverse().join('') : r);
    head.stamp(x, 15, e);
    head.px(flip ? x + 3 : x + 1, 17, '6').px(flip ? x + 2 : x + 2, 17, '0');
  }
  // bulldog jowls: heavy flews painted INTO the head (one silhouette, soft inner folds, no black blob)
  head.ellipse(13, 27, 7, 4.8, '9').ellipse(27, 27, 7, 4.8, '9');
  head.relight('9', { hi: '8', lo: 'a', lo2: 'b', d: 2 });
  head.ellipse(20, 24, 4.6, 3.4, '7', ['9', '8', 'a', 'b']); // muzzle
  head.ellipse(16.5, 26.6, 3, 2, '7', ['9', '8', 'a']).ellipse(23.5, 26.6, 3, 2, '7', ['9', '8', 'a']);
  head.relight('7', { lo: '8' });
  head.stamp(17, 20, ['.0000.', '0q0000', '000000', '.0000.']); // squashed nose
  head.line(19, 24, 19, 25, '0').line(20, 24, 20, 25, '0');
  head.line(13, 27, 19, 26, 'b').line(20, 26, 26, 27, 'b'); // upper lip / flews line
  head.line(11, 29, 14, 31, 'a').line(28, 29, 25, 31, 'a'); // jowl folds
  // protruding lower jaw (underbite) with two little canines pointing up over the lip
  const jaw = L(); jaw.ellipse(20, 29.6, 4.8, 2.2, '8'); jaw.relight('8', { hi: '7', lo: '9' });
  jaw.px(17, 27, '6').px(17, 28, '6').px(22, 27, '6').px(22, 28, '6');
  // medals: three coloured ribbon bars with hanging gold discs
  const med = L();
  for (const [x, rib] of [[25, ['r', '6', 'r']], [29, ['m', 'f', 'm']], [33, ['j', '6', 'j']]]) {
    rib.forEach((c, i) => med.rect(x + i, 33, 1, 3, c));
    med.rect(x, 36, 3, 3, 'f'); med.px(x, 36, '6').px(x + 2, 38, 'g').px(x + 1, 38, 'g').px(x + 2, 37, 'g');
  }
  // headset: band over the head, ear cup, boom mic to the mouth
  const hs = L();
  for (let a = Math.PI * 1.05; a <= Math.PI * 1.95; a += 0.02) { hs.px(20 + Math.cos(a) * 14.2, 19 + Math.sin(a) * 12.4, 'q'); hs.px(20 + Math.cos(a) * 13.2, 19 + Math.sin(a) * 11.4, 'p'); }
  hs.rect(3, 15, 5, 8, 'q').rect(4, 16, 3, 6, 'p').px(4, 16, 'o');
  hs.line(6, 22, 10, 29, 'q').line(10, 29, 13, 30, 'q'); hs.rect(13, 29, 2, 2, 'r');
  return stack([coat, ears, head, jaw, hs, med]);
}
// ---- Empress Fluffington ------------------------------------------------------------
function empress() {
  const cape = L(); cape.poly([[2, 40], [8, 29], [32, 29], [38, 40]], 'u'); cape.relight('u', { hi: 't', lo: 'v' });
  for (let x = 6; x < 35; x++) for (const y of [30, 31]) if (cape.get(x, y) !== '.') cape.px(x, y, '6');
  for (const x of [9, 15, 21, 27, 32]) cape.px(x, 31, '0');
  const fur = fluffy(G => G.fluff(20, 23, 14, 11, '6', 18, 2, 0.15), true, 3, ['5', '4']);
  const ears = L(); ears.poly([[9, 15], [10, 9], [15, 13]], '6').poly([[31, 15], [30, 9], [25, 13]], '6'); ears.px(11, 12, 'c').px(29, 12, 'c'); ears.relight('6', { lo: '5' });
  const face = L(); face.ellipse(20, 24, 9, 7, '6'); face.relight('6', { lo: '5' });
  for (const x of [12, 23]) face.stamp(x, 21, ['00000', '06tt0', '0t0u0', '.000.']);
  face.stamp(18, 26, ['.cd.', '0dd0', '.00.']); // dainty nose
  face.stamp(16, 28, ['0......0', '.000000.']); // regal little smile
  face.px(13, 27, 'c').px(27, 27, 'c');
  const pearls = L(); for (let i = -4; i <= 4; i++) pearls.ellipse(20 + i * 2, 33 - Math.abs(i) * 0.4, 1, 1, i === 0 ? 'd' : '6'); pearls.relight('6', { lo: '5' });
  const crown = L(); crown.stamp(11, 5, [
    '....0....0....0...',
    '...0f0..0f0..0f0..',
    '..0fff00frf00fff0.',
    '.0ffgffffffffgfff0',
    '.0flfffdffffflfff0',
    '.0ffffffffffffff0.',
    '.0gggggggggggggg0.',
    '..00000000000000..',
  ]);
  // the face sits IN the fluff: no outline ring around it (it read as a helmet), just a soft
  // shadow tone along its lower edge
  const g = stack([cape, ears, fur]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const c = face.get(x, y); if (c !== '.') g.px(x, y, c); }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (face.get(x, y) === '.' && face.get(x, y - 1) !== '.' && g.get(x, y) !== '0' && y > 24) g.px(x, y, '5');
  pearls.outline('0'); g.over(pearls); g.over(crown); return g;
}
// ---- breed busts: their own drawings (NOT boss crops). Head-and-shoulders, head turned 3/4
// toward the viewer's left (where Pom's portrait sits), so the far ear and far eye are
// foreshortened; every breed has its own head shape, ears, markings and an expression.
const BUST = {
  tabby: { head: 'round', ears: 'point', marks: 'tabby', mouth: 'smirk', brow: 'raised' },
  tuxedo: { head: 'round', ears: 'point', marks: 'tuxedo', mouth: 'smile', brow: 'raised', monocle: 1, rimTL: '4' },
  siamese: { head: 'wedge', ears: 'upright', marks: 'points', mouth: 'flat', lids: 1, brow: 'stern' },
  persian: { head: 'flat', ears: 'tiny', marks: 'persian', mouth: 'persian', lids: 1 },
  sphynx: { head: 'round', ears: 'bat', marks: 'wrinkles', mouth: 'o', wide: 1 },
  mainecoon: { head: 'round', ears: 'tuft', marks: 'mainecoon', mouth: 'grin', ruff: 1 },
  calico: { head: 'round', ears: 'point', marks: 'calico', mouth: 'smile', wink: 1 },
  russianblue: { head: 'round', ears: 'upright', marks: 'sheen', mouth: 'flat', brow: 'calm' },
  bengal: { head: 'round', ears: 'small', marks: 'rosettes', mouth: 'fang', brow: 'stern' },
  scottishfold: { head: 'owl', ears: 'fold', marks: 'fold', mouth: 'o', wide: 1 },
};
const MOUTHS = {
  smile: ['0...0', '.000.'], smirk: ['....0', '0000.'], flat: ['.000.'], persian: ['.0.0.', '..0..'],
  o: ['.000.', '.0c0.', '.000.'], grin: ['0...0', '0ccc0', '.000.'], fang: ['0...0', '06c60', '.000.'],
};
function bust(key, b) {
  const v = BUST[key]; const [HI, BASE, LO, LO2] = b.fur; const [LHI, LBASE, LLO] = b.light; const [I, J] = b.eye;
  const FUR = [HI, BASE, LO, LO2];
  const lit = (G, c, hi = HI, lo = LO, lo2 = LO2) => G.relight(c, { hi, lo, lo2, d: 2 });
  const parts = [];
  const hx = 21, hy = 19, fx = 18; // head centre, face centre (shifted left: 3/4 turn)
  // shoulders + chest
  const body = L(); body.ellipse(20, 41, 15, 9.5, BASE); lit(body, BASE);
  body.ellipse(17, 39, 6, 6, LBASE, FUR); body.relight(LBASE, { lo: LLO });
  if (v.marks === 'tuxedo') body.poly([[11, 32], [24, 32], [18, 40]], '6', FUR.concat([LBASE, LLO]));
  if (v.marks === 'points') body.replace(LO2, b.point[2]);
  parts.push(body);
  if (v.ruff) { const R = L(); R.fluff(19, 29, 14, 6.5, LBASE, 16, 1.6, 0.2); R.relight(LBASE, { hi: LHI, lo: LLO, d: 1 }); parts.push(R); }
  // ears: far (left) foreshortened, near (right) full
  const E = L(); const inner = v.marks === 'points' ? b.point[1] : v.marks === 'wrinkles' ? 'd' : 'c';
  const tri = (P, sh = 0.5) => { E.poly(P, BASE); const c = P.reduce((a, p) => [a[0] + p[0] / 3, a[1] + p[1] / 3], [0, 0]); E.poly(P.map(([x, y]) => [c[0] + (x - c[0]) * sh, c[1] + (y - c[1]) * sh + 0.8]), inner); };
  const EARS = {
    point: [[[9, 14], [10, 3], [17, 9]], [[24, 9], [32, 2], [33, 14]]],
    upright: [[[10, 13], [10.5, 0.5], [17, 8]], [[24, 8], [32, 0], [33, 14]]],
    bat: [[[11, 14], [2, 0.5], [17, 9]], [[24, 9], [39.5, 0], [33, 16]]],
    tuft: [[[9, 14], [9.5, 1.5], [17, 9]], [[24, 9], [33, 0.5], [34, 14]]],
    tiny: [[[11, 12], [12, 7], [16, 10]], [[25, 9], [30, 5], [31, 12]]],
    small: [[[11, 12], [11, 6], [16, 9]], [[26, 8], [31, 4], [32, 12]]],
    fold: [[[11, 12], [11, 8], [16, 9]], [[26, 8], [31, 7], [31, 12]]],
  };
  for (const P of EARS[v.ears]) tri(P, v.ears === 'fold' ? 0 : 0.5);
  if (v.ears === 'tuft') { E.poly([[9, 4], [11, 4], [8.5, -1]], LO2); E.poly([[31, 3], [33.5, 3], [34, -1]], LO2); }
  lit(E, BASE);
  if (v.marks === 'points') for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const c = E.get(x, y); if (FUR.includes(c)) E.px(x, y, c === LO || c === LO2 ? b.point[2] : b.point[1]); }
  if (v.marks === 'calico') for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const c = E.get(x, y); if (FUR.includes(c)) E.px(x, y, x < 20 ? (c === LO || c === LO2 ? 'h' : 'g') : (c === LO || c === LO2 ? '1' : '2')); }
  if (v.ears === 'fold') E.replace(BASE, LO);
  parts.push(E);
  // head
  const H = L();
  if (v.head === 'wedge') H.poly([[hx - 10, hy - 6], [hx + 11, hy - 6], [hx + 10, hy + 2], [fx + 4, hy + 11], [fx - 2, hy + 11], [hx - 10, hy + 1]], BASE).ellipse(hx, hy - 3, 10.5, 6, BASE);
  else if (v.head === 'flat') H.fluff(hx, hy + 1, 14, 11, BASE, 18, 2, 0.15);
  else if (v.head === 'owl') H.ellipse(hx, hy + 1, 12.5, 11, BASE);
  else H.ellipse(hx, hy + 1, 11.5, 10, BASE);
  if (v.head === 'round' && (v.ruff || key === 'tabby' || key === 'bengal')) for (const [x, y] of [[hx - 11, hy + 5], [hx + 11, hy + 4]]) H.poly([[x - 2 * Math.sign(x - hx), y - 3], [x + 2.6 * Math.sign(x - hx), y + 1], [x - 2 * Math.sign(x - hx), y + 3]], BASE);
  lit(H, BASE);
  const on = FUR;
  if (v.marks === 'persian') { H.ellipse(fx + 1, hy + 3, 9.6, 7.6, b.ring ?? LO, on); H.ellipse(fx + 1, hy + 3, 8.4, 6.6, LBASE, [b.ring ?? LO]); }
  if (v.marks === 'tabby' || v.marks === 'mainecoon') {
    const sc = b.stripe ?? LO2; H.stamp(fx - 2, hy - 8, ['0...0..', '00.00..', '0.0.0..'].map(r => r.replace(/0/g, sc)));
    for (const y of [hy, hy + 3]) { H.line(hx + 7, y, hx + 11, y - 1, sc); H.line(hx - 11, y - 1, hx - 8, y, sc); }
  }
  if (v.marks === 'tuxedo') { H.poly([[fx + 1, hy - 7], [fx + 8, hy + 12], [fx - 6, hy + 12]], '6', on); H.relight('6', { lo: '5' }); }
  if (v.marks === 'points') { H.poly([[fx - 5, hy + 1], [fx + 7, hy + 1], [fx + 3, hy + 11], [fx - 1, hy + 11]], b.point[0], on); H.ellipse(fx + 1, hy + 6, 2.6, 3, b.point[1], [b.point[0]]); }
  if (v.marks === 'calico') { H.ellipse(hx - 7, hy - 4, 6, 5, 'g', on); H.ellipse(hx + 8, hy - 5, 5, 4.5, '2', on); H.relight('g', { lo: 'h' }); }
  if (v.marks === 'wrinkles') { H.line(fx - 3, hy - 6, fx + 4, hy - 6, LO); H.line(fx - 1, hy - 8, fx + 3, hy - 8, LO); H.line(hx + 7, hy + 5, hx + 9, hy + 8, LO); }
  if (v.marks === 'rosettes') for (const [x, y] of [[hx - 8, hy - 3], [hx + 6, hy - 6], [hx + 8, hy + 1]]) H.stamp(x, y, ['.bb.', 'bggb', '.bb.']);
  if (v.marks === 'sheen') { H.line(hx - 7, hy - 5, hx - 3, hy - 8, '6'); H.px(hx - 8, hy - 4, 's'); }
  if (v.marks !== 'points' && v.marks !== 'persian') { H.ellipse(fx + 1, hy + 6, 5, 3.4, LBASE, on.concat(['6'])); H.relight(LBASE, { lo: LLO }); }
  if (v.marks === 'fold') for (const [x, y, w] of [[10, 9, 6], [26, 7, 5]]) { H.rect(x, y, w, 3, LO); H.line(x, y + 2, x + w - 1, y + 2, LO2); }
  // eyes: near (right) eye full, far (left) eye narrower; pupils glance to the viewer's left
  const ey = hy - 1 + (v.head === 'owl' ? 0 : 0);
  const near = v.wide ? ['.0000.', '066II0', '06I0I0', '0II0J0', '0JJJJ0', '.0000.'] : ['.0000.', '06III0', '0I0II0', '0J0JJ0', '.0000.'];
  const far = v.wide ? ['.000.', '06II0', '0I0I0', '0I0J0', '0JJJ0', '.000.'] : ['.000.', '06II0', '00II0', '00JJ0', '.000.'];
  const map = { I, J };
  H.stamp(fx + 3, ey, near, map);
  if (v.wink) H.stamp(fx - 5, ey + 2, ['0...0', '.000.']);
  else H.stamp(fx - 5, ey, far, map);
  if (v.lids) { H.rect(fx + 4, ey + 1, 4, 1, LO2); H.rect(fx - 4, ey + 1, 3, 1, LO2); }
  if (v.brow === 'raised') { H.line(fx + 3, ey - 3, fx + 8, ey - 4, LO2); H.line(fx - 5, ey - 2, fx - 1, ey - 2, LO2); }
  if (v.brow === 'stern') { H.line(fx + 3, ey - 1, fx + 8, ey - 3, LO2); H.line(fx - 5, ey - 3, fx - 1, ey - 1, LO2); }
  if (v.brow === 'calm') { H.line(fx + 4, ey - 2, fx + 7, ey - 2, LO2); }
  if (v.marks === 'tuxedo') H.replace(LO2, '5');
  // nose + mouth
  const ny = v.marks === 'persian' ? ey + 3 : hy + 4;
  H.stamp(fx, ny, v.marks === 'persian' ? ['ee'] : ['cd', '.0']);
  const m = MOUTHS[v.mouth]; H.stamp(fx + 1 - Math.floor(m[0].length / 2), ny + (v.marks === 'persian' ? 2 : 2), m);
  H.px(fx + 9, hy + 5, 'c'); // near cheek blush
  if (v.marks !== 'wrinkles') for (const [x, y] of [[fx + 6, hy + 6], [fx + 7, hy + 7], [fx - 4, hy + 6]]) H.px(x, y, LLO);
  parts.push(H);
  const g = stack(parts);
  if (v.monocle) { for (let a = 0; a < Math.PI * 2; a += 0.05) g.px(Math.round(fx + 5.5 + Math.cos(a) * 3.6), Math.round(ey + 2 + Math.sin(a) * 3.6), 'f'); g.line(fx + 9, ey + 4, fx + 11, ey + 12, 'f'); }
  if (v.rimTL) { const c = g.clone(); for (let y = 1; y < N; y++) for (let x = 1; x < N; x++) if (FUR.includes(c.get(x, y)) && (c.get(x - 1, y) === '0' && c.get(x - 2, y) === '.' || c.get(x, y - 1) === '0' && c.get(x, y - 2) === '.')) g.px(x, y, v.rimTL); }
  return g;
}

const defs = { portrait_pom: pom(), portrait_biscuit: biscuit(), portrait_empress: empress() };
for (const [k, b] of Object.entries(BREEDS)) defs['portrait_' + k] = bust(k, b);
console.log(emitModule('PORTRAITS', 'tools/art/gen-portraits.mjs', defs));
