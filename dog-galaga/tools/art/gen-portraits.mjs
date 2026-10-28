import { Grid, emitModule } from '../pixelgen.mjs';
import { BREEDS, cat } from './gen-cats.mjs';
// 40x40 dialogue portraits: head-and-shoulders busts facing the viewer, lit from the top-left,
// built from outlined layers like the sprites. portrait_<breed> are crops of the 64px bosses'
// heads, so speaking cats match the bosses on screen.
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
function crop(src, x0, y0) { const g = L(); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) g.px(x, y, src.get(x0 + x, y0 + y)); return g; }

const defs = { portrait_pom: pom(), portrait_biscuit: biscuit(), portrait_empress: empress() };
for (const [k, b] of Object.entries(BREEDS)) defs['portrait_' + k] = crop(cat(b, 0, 2), 12, 15);
console.log(emitModule('PORTRAITS', 'tools/art/gen-portraits.mjs', defs));
