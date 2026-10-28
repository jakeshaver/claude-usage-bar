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
const fluffy = (fn, deep = true, seed = 0) => { const G = L(); fn(G); G.relight('6', deep ? { lo: '5', lo2: '4', d: 2 } : { lo: '5' }); curls(G, '6', '5', seed); return G; };

// ---- Captain Pom ----------------------------------------------------------------------
function pom() {
  const mane = fluffy(G => G.fluff(20, 38, 16, 7, '6', 16, 2, 0.2));
  const scarf = L(); scarf.ellipse(20, 32.4, 8.6, 2.4, 'r'); scarf.poly([[22, 32], [28, 33], [27, 38], [24, 37]], 'r'); scarf.relight('r', { hi: 'c', lo: 'e' });
  const earL = L(); earL.fluff(8, 25, 4.8, 10.5, '6', 10, 1.6, 0.4); earL.relight('6', { hi: '6', lo: '4' }); earL.replace('6', '5'); earL.relight('5', { lo: '4' }); curls(earL, '5', '4', 1);
  const earR = earL.clone().flipX();
  const face = L(); face.ellipse(20, 21.6, 8.6, 8, '8'); face.relight('8', { hi: '7', lo: '9' });
  const snout = L(); snout.ellipse(20, 27, 5.2, 3.8, '7'); snout.relight('7', { lo: '8' });
  snout.stamp(18, 24, ['0000', '0q00', '.00.']); // nose with glint
  snout.stamp(17, 28, ['0.00.0', '.0cc0.', '..cc..']); // smile + tongue
  snout.px(15, 27, 'c').px(25, 27, 'c'); // blush
  const eyes = L();
  for (const x of [13, 23]) eyes.stamp(x, 18, ['.00.', '06a0', '0aa0', '0000', '.00.']);
  const top = fluffy(G => G.fluff(20, 10.4, 9.6, 7, '6', 12, 2, 0.1), true, 2);
  const bow = L(); bow.stamp(25, 2, ['.ddd...ddd.', 'dccdd.ddded', 'dcdddeddddd', 'ddddde dded'.replace(' ', 'd'), '.dde...edd.']);
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
  for (const [x, c1, c2] of [[27, 'r', '6'], [30, 'm', 'f'], [33, 'j', 'f']]) { coat.rect(x, 34, 2, 2, c1).px(x + 1, 34, c2); coat.rect(x, 36, 2, 2, 'f').px(x + 1, 37, 'g'); coat.px(x, 36, '6'); }
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
  const jowl = L(); jowl.ellipse(13.5, 27.5, 6.6, 4.8, '9').ellipse(26.5, 27.5, 6.6, 4.8, '9'); jowl.relight('9', { hi: '8', lo: 'a' });
  jowl.ellipse(20, 26, 5, 3.2, '7', ['9', '8', 'a']);
  jowl.stamp(16, 21, ['.000000.', '00q00000', '00000000', '.000000.']); // big squashed nose
  jowl.stamp(14, 29, ['0..........0'.slice(0, 12), '.0000000000.']); // mouth
  jowl.stamp(16, 28, ['6....6', '6....6'].map(r => r.replace(/6/g, '6'))); // underbite teeth
  // headset: band over the head, ear cup, boom mic to the mouth
  const hs = L();
  for (let a = Math.PI * 1.05; a <= Math.PI * 1.95; a += 0.02) { hs.px(20 + Math.cos(a) * 14.2, 19 + Math.sin(a) * 12.4, 'q'); hs.px(20 + Math.cos(a) * 13.2, 19 + Math.sin(a) * 11.4, 'p'); }
  hs.rect(3, 15, 5, 8, 'q').rect(4, 16, 3, 6, 'p').px(4, 16, 'o');
  hs.line(6, 22, 10, 29, 'q').line(10, 29, 13, 30, 'q'); hs.rect(13, 29, 2, 2, 'r');
  return stack([coat, ears, head, jowl, hs]);
}
// ---- Empress Fluffington ------------------------------------------------------------
function empress() {
  const cape = L(); cape.poly([[2, 40], [8, 29], [32, 29], [38, 40]], 'u'); cape.relight('u', { hi: 't', lo: 'v' });
  for (let x = 6; x < 35; x++) for (const y of [30, 31]) if (cape.get(x, y) !== '.') cape.px(x, y, '6');
  for (const x of [9, 15, 21, 27, 32]) cape.px(x, 31, '0');
  const fur = fluffy(G => G.fluff(20, 23, 14, 11, '6', 18, 2, 0.15), true, 3);
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
  const g = stack([cape, ears, fur, face, pearls]); g.over(crown); return g;
}
function crop(src, x0, y0) { const g = L(); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) g.px(x, y, src.get(x0 + x, y0 + y)); return g; }

const defs = { portrait_pom: pom(), portrait_biscuit: biscuit(), portrait_empress: empress() };
for (const [k, b] of Object.entries(BREEDS)) defs['portrait_' + k] = crop(cat(b, 0, 2), 12, 15);
console.log(emitModule('PORTRAITS', 'tools/art/gen-portraits.mjs', defs));
