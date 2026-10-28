import { Grid, hash2, emitModule } from '../pixelgen.mjs';
// Cat generator. Cats face the player (down the screen), flying "flying-squirrel" style:
// big head at the bottom, back and hind paws behind it, tail up top, front paws out to the
// sides flapping between two frames. Every breed has its own silhouette (ears, head, body,
// tail) not just a palette swap. Each body part is a layer: filled, lit from the top-left,
// outlined, then composited back-to-front, so overlaps stay readable. Faces use hand-drawn
// stamps. S=1 -> 32x32 enemy, S=2 -> 64x64 boss with extra detail passes (fur strokes,
// toe beans, brows, fangs, whiskers, collar bell).

// ---- hand-drawn stamps -------------------------------------------------------------
// I = iris, J = iris shadow, 0 = pupil/outline, 6 = glint
const EYE = { // 5x5 slit-pupil cat eye
  cat: ['.000.', '06II0', '0I0I0', '0J0J0', '.000.'],
  // grumpy flat-lidded persian eye
  flat: ['00000', '06II0', '0I00J', '.000.'],
  // round owl eye (scottish fold): big round pupil
  owl: ['.0000.', '06III0', '0I00I0', '0J00J0', '0JJJJ0', '.0000.'],
  // almond, tilted (siamese)
  almond: ['000...', '06I00.', '0I00I0', '.0JJJ0', '..000.'],
  // boss eye 9x8: big glint, lens pupil, second glint
  boss: ['.0000000.', '066IIIII0', '066I0III0', '0II000II0', '0II000II0', '0JJJ0J6J0', '0JJJJJJJ0', '.0000000.'],
  bossOwl: ['..00000..', '.0666II0.', '06600III0', '0I0000II0', '0I0000JI0', '0J0000JJ0', '.0JJJJ60.', '..00000..'],
  kitten: ['00', '60'],
};
const MOUTH = {
  cat: ['..cd..', '0.00.0', '.0..0.'],
  flat: ['.cd.', '0000'], // persian: squished, nose high, grumpy line
  boss: ['...ccdd...', '...cddd...', '....dd....', '....00....', '.0000000..'.replace(/./g, (c, i) => '0..0..0..0'[i] === '0' ? '0' : '.'), '.06....60.'],
};
const CROWN = [ // 20x11 empress crown
  '....0.....0.....0...',
  '...0f0...0f0...0f0..',
  '...0f0..0fff0..0f0..',
  '..0ff0.0ffrff0.0ff0.',
  '.0fffg00ffrff00fff0.',
  '.0ff6ffgfffffggff6f0',
  '0fflfffffdfffffflff0',
  '0ffffffffffffffffff0',
  '0ggggggggggggggggggg0'.slice(0, 20),
  '.0000000000000000000'.slice(0, 20),
  '....................',
];

// ---- breeds --------------------------------------------------------------------------
// fur ramp: hi / base / lo / lo2. light: muzzle & chest. eye: iris/shadow.
const BREEDS = {
  tabby: { fur: ['f', 'g', 'h', 'b'], light: ['6', '7', '8'], eye: ['i', 'j'], ears: 'point', head: 'round', tail: 'ringed', marks: 'tabby', stripe: 'h' },
  tuxedo: { fur: ['3', '2', '1', '0'], light: ['6', '6', '5'], eye: ['f', 'g'], ears: 'point', head: 'round', tail: 'thin', marks: 'tuxedo', slim: 0.92 },
  siamese: { fur: ['6', '7', '8', '9'], light: ['6', '7', '8'], point: ['a', 'b', 'v'], eye: ['l', 'm'], ears: 'big', head: 'wedge', tail: 'whip', marks: 'points', eyeType: 'almond', slim: 0.85 },
  persian: { fur: ['7', '8', '9', 'a'], light: ['6', '7', '8'], eye: ['g', 'h'], ears: 'tiny', head: 'flat', body: 'puff', tail: 'plume', marks: 'persian', eyeType: 'flat', mouth: 'flat' },
  sphynx: { fur: ['7', 'c', 'd', 'e'], light: ['7', 'c', 'd'], eye: ['i', 'j'], ears: 'bat', head: 'round', tail: 'rat', marks: 'wrinkles', slim: 0.8, noWhisk: 1 },
  mainecoon: { fur: ['9', 'a', 'b', 'v'], light: ['7', '8', '9'], eye: ['f', 'g'], ears: 'tuft', head: 'round', body: 'big', tail: 'bushy', marks: 'mainecoon', ruff: 1, stripe: 'b' },
  calico: { fur: ['6', '6', '5', '4'], light: ['6', '6', '5'], eye: ['f', 'g'], ears: 'point', head: 'round', tail: 'calico', marks: 'calico' },
  russianblue: { fur: ['5', '4', '3', '2'], light: ['5', '4', '3'], eye: ['i', 'j'], ears: 'tall', head: 'round', tail: 'thin', marks: 'sheen', slim: 0.95 },
  bengal: { fur: ['7', 'f', 'g', 'h'], light: ['6', '7', '8'], eye: ['i', 'j'], ears: 'round', head: 'round', tail: 'ringed', marks: 'rosettes', stripe: 'b' },
  scottishfold: { fur: ['6', 'o', 'p', 'q'], light: ['6', '6', '5'], eye: ['g', 'h'], ears: 'fold', head: 'owl', tail: 'thin', marks: 'fold', eyeType: 'owl', yarn: 1 },
};

function cat(b, frame, S = 1, opts = {}) {
  const N = 32 * S, cx = N / 2;
  const k = (v) => v * S; // 32-space -> pixels
  const [HI, BASE, LO, LO2] = b.fur;
  const [LHI, LBASE, LLO] = b.light;
  const lit = (G, base, hi, lo, lo2) => G.relight(base, S > 1 ? { hi, lo, lo2: lo2 ?? lo, d: 2 } : { hi, lo, d: 1 });
  const layer = () => new Grid(N, N);
  const out = layer();
  const add = (G) => { G.outline('0'); out.over(G); };
  const slim = b.slim ?? 1;
  const flap = frame ? 1 : -1; // paws: up on frame 0, down on frame 1
  const isBoss = S > 1;

  // ---- cape (empress) behind everything
  if (opts.cape) {
    const C = layer();
    C.poly([[k(9), k(9)], [k(23), k(9)], [k(31), k(30)], [k(24), k(28)], [k(16), k(30)], [k(8), k(28)], [k(1), k(30)]], 'u');
    lit(C, 'u', 't', 'v', 'v');
    // ermine trim along the bottom hem: white with black tail-tips
    for (let x = 0; x < N; x++) for (let y = N - 1; y >= 0; y--) if (C.get(x, y) !== '.') { for (let d = 0; d < k(2); d++) if (C.get(x, y - d) !== '.') C.px(x, y - d, '6'); if (x % 7 === 3) C.px(x, y - 1, '0'); break; }
    add(C);
  }
  // ---- tail
  {
    const T = layer();
    const sw = (frame ? 1 : -1) * (b.tail === 'whip' ? 4 : 3);
    const p0 = [16, 11], p1 = [16 + sw * 0.4, 6], p2 = [16 + sw, 1.6];
    const at = (t) => [(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]];
    const wid = { ringed: 1.7, thin: 1.25, whip: 1.0, plume: 3.2, rat: 0.85, bushy: 2.6, calico: 1.7 }[b.tail];
    for (let t = 0; t <= 1.0001; t += 0.04) {
      const [x, y] = at(t); const w = wid * (b.tail === 'plume' || b.tail === 'bushy' ? (0.75 + 0.35 * Math.sin(t * 3)) : b.tail === 'rat' || b.tail === 'whip' ? 1.2 - t * 0.35 : 1);
      if (b.tail === 'plume' || b.tail === 'bushy') T.fluff(k(x), k(y), k(w), k(w), BASE, 6, k(0.8), t * 9); else T.ellipse(k(x), k(y), k(w), k(w), BASE);
    }
    lit(T, BASE, HI, LO, LO2);
    // rings / tip colour
    const ringC = b.tail === 'calico' ? null : b.stripe;
    if (b.tail === 'ringed' || b.tail === 'bushy') for (const t of [0.2, 0.45, 0.7, 0.92]) { const [x, y] = at(t); T.ellipse(k(x), k(y), k(wid + 0.6), k(0.55), ringC ?? LO, [BASE, HI, LO, LO2]); }
    if (b.tail === 'calico') { for (const [t, c] of [[0.3, 'g'], [0.75, '2']]) { const [x, y] = at(t); T.ellipse(k(x), k(y), k(wid + 0.6), k(1.4), c, [BASE, HI, LO, LO2]); } }
    if (b.marks === 'points') for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (T.get(x, y) !== '.' && y < k(8.5)) T.px(x, y, (x + y) % 5 === 0 ? b.point[0] : b.point[1]);
    if (b.marks === 'tuxedo') { const [x, y] = at(1); T.ellipse(k(x), k(y), k(1.4), k(1.4), '6', [BASE, HI, LO, LO2]); }
    if (b.marks === 'rosettes' || b.marks === 'tabby') { const [x, y] = at(1); T.ellipse(k(x), k(y + 0.3), k(wid + 0.3), k(1.1), b.marks === 'rosettes' ? '0' : LO, [BASE, HI, LO, LO2]); }
    add(T);
  }
  // ---- body (back + haunches, behind the head)
  {
    const B = layer();
    const bw = (b.body === 'big' ? 8.4 : b.body === 'puff' ? 12.5 : 7) * slim, bh = b.body === 'puff' ? 10.5 : b.body === 'big' ? 6.6 : 6;
    if (b.body === 'puff') B.fluff(cx, k(15), k(bw), k(bh), BASE, 18, k(1.8), 0.2);
    else B.ellipse(cx, k(13), k(bw), k(bh), BASE);
    // hind paws tucked at the hips (flap opposite to the front paws)
    if (b.body !== 'puff') for (const s of [-1, 1]) B.ellipse(cx + s * k(bw - 0.5), k(10 + flap * 0.8), k(2.1), k(1.8), BASE);
    lit(B, BASE, HI, LO, LO2);
    if (b.marks === 'tabby' || b.marks === 'mainecoon') for (const y of [9, 12, 15]) for (const s of [-1, 1]) B.rect(cx + (s < 0 ? -k(4) : k(1)), k(y), k(3), S, b.stripe);
    if (b.marks === 'tabby' || b.marks === 'mainecoon') B.rect(cx - S, k(7.5), k(2), k(8), b.stripe);
    if (b.marks === 'rosettes') for (const [x, y] of [[-5, 10], [3, 9], [-1, 13], [5, 13], [-3, 16], [2, 16]]) { B.ellipse(cx + k(x), k(y), k(1.4), k(1.1), '0', [BASE, HI, LO, LO2]); B.ellipse(cx + k(x), k(y), k(0.7), k(0.5), 'h', ['0']); }
    if (b.marks === 'calico') { B.ellipse(cx - k(3.5), k(11), k(3.6), k(3), 'g', [BASE, HI, LO, LO2]); B.ellipse(cx + k(4), k(14), k(3.2), k(2.6), '2', [BASE, HI, LO, LO2]); B.relight('g', S > 1 ? { lo: 'h', d: 2 } : { lo: 'h' }); }
    if (b.marks === 'wrinkles') for (const y of [10, 13]) B.line(cx - k(3), k(y), cx + k(3) - 1, k(y), LO);
    if (b.marks === 'points') for (const s of [-1, 1]) B.ellipse(cx + s * k(bw - 0.5), k(10 + flap * 0.8), k(2.1), k(1.8), b.point[1]);
    if (b.marks === 'tuxedo') for (const s of [-1, 1]) B.ellipse(cx + s * k(bw - 0.5), k(10.6 + flap * 0.8), k(1.6), k(1.1), '6');
    if (b.marks === 'sheen') B.ellipse(cx - k(2.5), k(10), k(2.5), k(1.2), HI, [BASE]);
    if (isBoss) furStrokes(B, BASE, LO, 3);
    add(B);
  }
  // ---- ears (behind head)
  const HX = cx, HY = k(b.head === 'owl' ? 19.6 : 20);
  const hrx = k((b.head === 'flat' ? 9.6 : b.head === 'owl' ? 9.6 : b.head === 'wedge' ? 8.4 : 8.6) * (b.head === 'round' ? Math.max(slim, 0.92) : 1));
  const hry = k(b.head === 'flat' ? 6.6 : b.head === 'owl' ? 8.4 : 7.2);
  {
    const E = layer(); const inner = b.marks === 'points' ? b.point[0] : b.marks === 'sphynx' ? 'd' : 'c';
    const tri = (s, base, tip, back, innerShrink) => {
      const P = [[HX + s * k(base[0]), k(base[1])], [HX + s * k(tip[0]), k(tip[1])], [HX + s * k(back[0]), k(back[1])]];
      E.poly(P, BASE);
      if (innerShrink) { const c = [(P[0][0] + P[1][0] + P[2][0]) / 3, (P[0][1] + P[1][1] + P[2][1]) / 3]; E.poly(P.map(([x, y]) => [c[0] + (x - c[0]) * innerShrink, c[1] + (y - c[1]) * innerShrink + k(0.6)]), inner); }
    };
    for (const s of [-1, 1]) {
      if (b.ears === 'point') tri(s, [8.6, 18], [6.8, 8.4], [1.8, 13.6], 0.5);
      if (b.ears === 'tall') tri(s, [8.4, 17], [6.4, 6.6], [2, 13.4], 0.5);
      if (b.ears === 'big') tri(s, [9.4, 19], [9.6, 6.4], [1.6, 13.2], 0.55);
      if (b.ears === 'bat') tri(s, [8, 19], [14.6, 5.4], [2, 13], 0.6);
      if (b.ears === 'tuft') { tri(s, [9, 17], [7.4, 6.6], [1.8, 13], 0.5); }
      if (b.ears === 'round') { E.ellipse(HX + s * k(6.2), k(13.6), k(2.6), k(2.8), BASE); E.ellipse(HX + s * k(6.2), k(14), k(1.3), k(1.5), inner); }
      if (b.ears === 'tiny') tri(s, [7.4, 16], [6.4, 10.6], [3, 13.6], 0.4);
      if (b.ears === 'fold') { E.ellipse(HX + s * k(5.4), k(12.4), k(3.3), k(2.1), BASE); }
    }
    lit(E, BASE, HI, LO, LO2);
    if (b.ears === 'fold') for (const s of [-1, 1]) E.line(HX + s * k(3.4) - (s > 0 ? 1 : 0), k(12.8), HX + s * k(7.8) - (s > 0 ? 1 : 0), k(12.8), LO); // crease
    if (b.marks === 'points') for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const c = E.get(x, y); if (c === BASE || c === HI || c === LO || c === LO2) E.px(x, y, b.point[c === LO || c === LO2 ? 2 : 1]); }
    if (b.marks === 'calico') for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const c = E.get(x, y); if ((c === BASE || c === HI || c === LO) && x < cx) E.px(x, y, c === LO ? 'h' : 'g'); if ((c === BASE || c === HI || c === LO) && x >= cx) E.px(x, y, c === LO ? '1' : '2'); }
    if (b.marks === 'tuxedo' || b.marks === 'tabby' || b.marks === 'mainecoon' || b.marks === 'rosettes') {} // fur coloured
    if (isBoss && b.ears !== 'fold' && b.ears !== 'round') for (const s of [-1, 1]) for (let i = 0; i < 3; i++) E.line(HX + s * k(5 + i * 0.7), k(14.6 - i * 0.3), HX + s * k(5.6 + i * 0.6), k(12 - i * 0.6), LHI); // inner ear fur
    add(E);
    if (b.ears === 'tuft') { const Tf = layer(); for (const s of [-1, 1]) { Tf.line(HX + s * k(7.4) - (s > 0 ? 1 : 0), k(6.8), HX + s * k(7.2) - (s > 0 ? 1 : 0), k(3.4), LO2 === 'v' ? '0' : LO2); if (isBoss) Tf.line(HX + s * k(7.4), k(6.8), HX + s * k(7.4), k(3.4), '0'); } out.over(Tf); }
  }
  // ---- mane ruff (maine coon): scalloped collar framing the face
  if (b.ruff) { const R = layer(); R.fluff(HX, HY + k(2), hrx + k(2.6), hry + k(1.2), LBASE, 16, k(1.4), 0.1); lit(R, LBASE, LHI, LLO, LLO); add(R); }
  // ---- front paws (flapping)
  {
    const P = layer(); const py = 21.5 + flap * 1.4;
    const pxo = b.yarn ? 5.2 : (b.body === 'puff' ? 10.6 : 10.2 * Math.max(slim, 0.9));
    const pyy = b.yarn ? 26 + flap * 0.6 : py;
    for (const s of [-1, 1]) P.ellipse(HX + s * k(pxo), k(pyy), k(2.5), k(2.1), BASE);
    lit(P, BASE, HI, LO, LO2);
    const pawC = b.marks === 'points' ? b.point : b.marks === 'tuxedo' ? ['6', '6', '5'] : null;
    if (pawC) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const c = P.get(x, y); if (c !== '.') P.px(x, y, c === LO || c === LO2 ? pawC[2] : c === HI ? pawC[0] : pawC[1]); }
    // toes
    for (const s of [-1, 1]) { const x0 = HX + s * k(pxo), y0 = k(pyy) + k(1.2); for (const d of [-0.8, 0.8]) P.px(x0 + k(d) - (S > 1 ? 0 : 0.5), y0, b.marks === 'tuxedo' ? '5' : pawC ? pawC[2] : LO2); }
    if (isBoss) for (const s of [-1, 1]) { const x0 = HX + s * k(pxo), y0 = k(pyy); P.ellipse(x0, y0 + k(0.4), k(0.8), k(0.6), 'c'); }
    add(P);
  }
  // ---- head
  {
    const H = layer();
    if (b.head === 'wedge') H.poly([[HX - k(8.6), HY - k(6)], [HX + k(8.6), HY - k(6)], [HX + k(8.2), HY + k(1)], [HX + k(3), HY + k(8)], [HX - k(3), HY + k(8)], [HX - k(8.2), HY + k(1)]], BASE).ellipse(HX, HY - k(2), k(8.6), k(4.6), BASE);
    else if (b.head === 'flat') H.fluff(HX, HY, hrx, hry, BASE, 14, k(1.3), 0.15);
    else H.ellipse(HX, HY, hrx, hry, BASE);
    // cheek fluff tufts (fluffy breeds + bosses)
    if (b.head !== 'wedge' && (isBoss || b.ruff || b.head === 'flat')) for (const s of [-1, 1]) for (const dy of [1, 3.2]) H.poly([[HX + s * (hrx - k(1.6)), HY + k(dy - 1.4)], [HX + s * (hrx + k(1.4)), HY + k(dy + 0.4)], [HX + s * (hrx - k(1.6)), HY + k(dy + 1.6)]], BASE);
    lit(H, BASE, HI, LO, LO2);
    // markings on the head
    if (b.marks === 'tabby' || b.marks === 'mainecoon') { // the classic "M" on the forehead + cheek stripes
      const y0 = HY - hry + k(1.6);
      for (const x of [-2.5, 0, 2.5]) H.rect(HX + k(x) - (x === 0 ? S : 0) - (x > 0 ? S : 0), y0, x === 0 ? k(2) : S, k(2.4), b.stripe);
      H.px(HX - k(2), y0, b.stripe).px(HX + k(2) - 1, y0, b.stripe);
      if (isBoss) { H.rect(HX - k(1.5), y0, S, k(1), b.stripe); H.rect(HX + k(1.5) - 1, y0, S, k(1), b.stripe); }
      for (const s of [-1, 1]) for (const dy of [0.5, 2.5]) H.rect(s < 0 ? HX - hrx : HX + hrx - k(2.4), HY + k(dy), k(2.4), S, b.stripe);
    }
    if (b.marks === 'tuxedo') { // white mask: inverted V blaze + muzzle + chin
      H.poly([[HX, HY - k(3.5)], [HX + k(5), HY + k(7.5)], [HX - k(5), HY + k(7.5)]], '6', [BASE, HI, LO, LO2]);
      H.ellipse(HX, HY + k(4), k(5.2), k(3.4), '6', [BASE, HI, LO, LO2]);
      H.relight('6', S > 1 ? { lo: '5', d: 2 } : { lo: '5' });
    }
    if (b.marks === 'points') { // seal-point mask, darkest at the nose
      H.ellipse(HX, HY + k(3), k(5), k(4.8), b.point[1], [BASE, HI, LO, LO2]);
      H.ellipse(HX, HY + k(4), k(3), k(3), b.point[2], [b.point[1]]);
      H.ellipse(HX - k(1.5), HY + k(1), k(1.5), k(1), b.point[0], [b.point[1]]);
    }
    if (b.marks === 'calico') { H.ellipse(HX - k(4.5), HY - k(3), k(4), k(3.4), 'g', [BASE, HI, LO, LO2]); H.ellipse(HX + k(5), HY - k(3.4), k(3.4), k(3), '2', [BASE, HI, LO, LO2]); H.relight('g', S > 1 ? { lo: 'h', d: 2 } : { lo: 'h' }); }
    if (b.marks === 'wrinkles') { for (const [y, w] of [[-5, 2.6], [-3.8, 1.6]]) H.line(HX - k(w), HY + k(y), HX + k(w) - 1, HY + k(y), LO); for (const s of [-1, 1]) H.line(HX + s * k(6.4) - (s > 0 ? 1 : 0), HY + k(2.5), HX + s * k(7.6) - (s > 0 ? 1 : 0), HY + k(4), LO); }
    if (b.marks === 'rosettes') { for (const [x, y] of [[-5, -3], [4.6, -3.6], [-6.4, 1.2], [6, 1]]) { H.ellipse(HX + k(x), HY + k(y), k(1.1), k(0.9), '0', [BASE, HI, LO, LO2]); H.px(HX + k(x), HY + k(y), 'h'); } for (const s of [-1, 1]) H.line(HX + s * k(5.6) - (s > 0 ? 1 : 0), HY + k(1.6), HX + s * k(7.4) - (s > 0 ? 1 : 0), HY + k(2.2), '0'); }
    if (b.marks === 'sheen') H.ellipse(HX - k(3.6), HY - k(4.2), k(2.6), k(1), HI, [BASE]);
    if (b.marks === 'fold' || b.marks === 'persian' || b.marks === 'calico') {}
    // muzzle (light)
    const mzy = HY + k(b.head === 'flat' ? 2.6 : b.head === 'owl' ? 3.6 : 3.8);
    if (b.marks !== 'points' && b.marks !== 'wrinkles') { H.ellipse(HX, mzy, k(b.head === 'owl' ? 4.6 : 3.8), k(2.6), LBASE, [BASE, HI, LO, LO2, '6']); H.relight(LBASE, S > 1 ? { lo: LLO, d: 1 } : { lo: LLO }); }
    if (isBoss) furStrokes(H, BASE, LO, 7);
    // eyes
    const eyeT = isBoss ? (b.eyeType === 'owl' ? 'bossOwl' : 'boss') : (b.eyeType ?? 'cat');
    const es = EYE[eyeT]; const ew = es[0].length, eh = es.length;
    const gap = isBoss ? k(1.5) : (eyeT === 'owl' ? 1 : 1);
    const ey = HY - k(b.head === 'flat' ? 2.2 : b.head === 'owl' ? 3 : 2.4) - (isBoss ? 2 : 0);
    const map = { I: b.eye[0], J: b.eye[1] };
    const lx = Math.round(HX - gap - ew), rxp = Math.round(HX + gap);
    H.stamp(lx, Math.round(ey), es, map);
    H.stamp(rxp, Math.round(ey), eyeT === 'almond' ? es.map(r => [...r].reverse().join('')) : es, map);
    if (eyeT === 'almond') { /* mirrored almond keeps the glint on the left of each eye */ H.px(rxp + ew - 2, Math.round(ey) + 1, map.I).px(rxp + 1, Math.round(ey) + 1, '6'); }
    // angry brows on bosses
    if (isBoss && !opts.regal) for (const s of [-1, 1]) { const x0 = s < 0 ? lx - 1 : rxp + ew; const x1 = s < 0 ? lx + ew - 1 : rxp; H.line(x0, Math.round(ey) - 3, x1, Math.round(ey) - 1, '0'); H.line(x0, Math.round(ey) - 4, x1, Math.round(ey) - 2, '0'); }
    // nose + mouth
    const mt = isBoss ? 'boss' : (b.mouth ?? 'cat'); const ms = MOUTH[mt];
    const my = isBoss ? mzy - k(2.2) : (b.mouth === 'flat' ? mzy - k(1) : mzy - k(1.6));
    H.stamp(Math.round(HX - ms[0].length / 2), Math.round(my), opts.regal ? ms.slice(0, 4) : ms);
    if (opts.regal) { H.px(HX - 3, Math.round(my) + 4, '0').px(HX + 2, Math.round(my) + 4, '0').rect(HX - 2, Math.round(my) + 5, 4, 1, '0'); }
    // whisker dots on the muzzle
    if (!b.noWhisk) for (const s of [-1, 1]) for (const [dx, dy] of isBoss ? [[3, 0], [4, 1], [3, 2]] : [[2.4, 0.4]]) H.px(HX + s * k(dx) - (s > 0 ? 1 : 0), mzy + k(dy * 0.5), LLO);
    add(H);
    // whiskers (bosses only: at 32px they read as stray pixels)
    if (isBoss && !b.noWhisk) { const Wk = layer(); for (const s of [-1, 1]) for (const [dy, ey2] of [[-0.6, -1.8], [0.6, 0.8]]) Wk.line(HX + s * (hrx - k(1)) - (s > 0 ? 1 : 0), mzy + k(dy), HX + s * (hrx + k(3.4)) - (s > 0 ? 1 : 0), mzy + k(ey2), '6'); out.over(Wk); }
  }
  // ---- collar + bell (bosses), necklace (empress)
  if (isBoss && !opts.cape) {
    const C = layer(); C.ellipse(HX, HY + hry - k(0.9), k(5.4), k(1.5), 'r'); C.relight('r', { lo: 'e', d: 1 }); C.outline('0');
    // only the part peeking under the chin shows: mask it behind the head silhouette
    const keep = layer(); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (out.get(x, y) === '.' || y > HY + hry - k(1.2)) keep.px(x, y, C.get(x, y));
    out.over(keep);
    const Bl = layer(); Bl.ellipse(HX, HY + hry + k(0.9), k(1.6), k(1.5), 'f'); lit(Bl, 'f', '6', 'g', 'h'); Bl.px(HX - 1, HY + hry + k(1.6), '0').px(HX, HY + hry + k(1.6), '0'); add(Bl);
  }
  if (opts.cape) { const C = layer(); for (let i = -3; i <= 3; i++) C.ellipse(HX + k(i * 1.6), HY + hry - k(0.4) + k(Math.abs(i) * -0.5), k(0.9), k(0.9), i === 0 ? 'd' : '6'); lit(C, '6', null, '5'); add(C); }
  // ---- yarn ball held under the chin (scottish fold)
  if (b.yarn) {
    const Y = layer(); const yx = HX + k(0.5), yy = k(27.6 + flap * 0.4);
    Y.ellipse(yx, yy, k(3.6), k(3.4), 'd'); lit(Y, 'd', 'c', 'e', 'e');
    for (const [a, c] of [[-1.2, 'c'], [0.4, 'e'], [1.8, 'c']]) Y.line(yx - k(3), yy + k(a) - k(1), yx + k(2.6), yy + k(a) + k(1), c);
    Y.ellipse(yx, yy, k(3.6), k(3.4), 'd', ['.']); // keep silhouette
    Y.outline('0');
    // trailing strand
    Y.line(yx + k(3.4), yy + k(1), yx + k(6), yy + k(2.2) + flap * S, 'd').line(yx + k(6), yy + k(2.2) + flap * S, yx + k(7.5), yy + k(1) + flap * S, 'd');
    // re-tuck paws in front of the yarn
    const P = layer(); for (const s of [-1, 1]) P.ellipse(HX + s * k(4.6), k(26 + flap * 0.6), k(2.1), k(1.9), BASE); lit(P, BASE, HI, LO, LO2); P.outline('0');
    out.over(Y); out.over(P);
  }
  // ---- crown (empress)
  if (opts.crown) { const Cr = layer(); Cr.stamp(Math.round(HX - 10), Math.round(HY - hry - k(4.4)), CROWN); out.over(Cr); }
  return out;
}
// short fur strokes in the shadow colour over a base area (bosses: texture, not noise)
function furStrokes(G, base, lo, seed) {
  for (let y = 2; y < G.h - 3; y++) for (let x = 2; x < G.w - 2; x++) {
    if (G.get(x, y) !== base || G.get(x, y + 1) !== base || G.get(x - 1, y) !== base || G.get(x + 1, y) !== base) continue;
    if (hash2(x, y, seed) < 0.035) { G.px(x, y, lo); if (G.get(x + 1, y + 1) === base) G.px(x + 1, y + 1, lo); }
  }
}

// ---- kitten: hand-drawn 16x16, chubby orange-and-white, huge eyes --------------------
function kitten(frame) {
  const g = new Grid(16, 16);
  const rows = [
    '................',
    '.0..........0...',
    '0g0........0g0..',
    '0cg0000000.0cg0.',
    '0ccgggggggg0cg0.',
    '.0ggghggggggg0..',
    '0ggg0hghg0gggg0.',
    '0gg06hhhg06gggg0',
    '0gg000ggg000ggg0',
    '0ggggg7d7ggggg0.',
    '.0gg77000777gg0.',
    '..0g7777777gg0..',
    '...00000000000..',
    '................',
    '................',
    '................',
  ];
  g.stamp(0, 0, rows);
  return g;
}

function kittenSprite(frame) {
  // procedural 16x16: same construction as the big cats, big head, tiny body
  const g = new Grid(16, 16);
  const L = () => new Grid(16, 16);
  const add = (G) => { G.outline('0'); g.over(G); };
  const flap = frame ? 1 : -1;
  { const T = L(); T.line(8, 5, 8 + flap * 2, 1, 'g').line(9, 5, 9 + flap * 2, 1, 'g'); T.px(8 + flap * 2, 1, 'h').px(9 + flap * 2, 1, 'h'); add(T); }
  { const B = L(); B.ellipse(8.5, 6.5, 4, 3, 'g'); B.relight('g', { lo: 'h' }); add(B); }
  { const E = L(); E.poly([[2.5, 8], [3.5, 1.5], [7, 5]], 'g').poly([[14.5, 8], [13.5, 1.5], [10, 5]], 'g'); E.px(4, 4, 'c').px(12, 4, 'c'); E.relight('g', { lo: 'h' }); add(E); }
  { const P = L(); P.ellipse(2.6, 10 + flap, 1.7, 1.5, '6').ellipse(14.4, 10 + flap, 1.7, 1.5, '6'); P.relight('6', { lo: '5' }); add(P); }
  { const H = L(); H.ellipse(8.5, 9.2, 5.6, 4.6, 'g'); H.relight('g', { hi: 'f', lo: 'h' });
    H.px(8, 5, 'h').px(9, 5, 'h').px(7, 5, 'h').px(10, 5, 'h');
    H.ellipse(8.5, 11, 2.6, 1.7, '7', ['g', 'f', 'h']);
    H.stamp(5, 8, ['60', '00']).stamp(10, 8, ['60', '00']);
    H.px(8, 10, 'd'); H.px(7, 11, '0').px(9, 11, '0').px(8, 11, '0');
    add(H); }
  return g;
}

const defs = {};
for (const [k, b] of Object.entries(BREEDS)) defs['cat_' + k] = [cat(b, 0), cat(b, 1)];
defs.cat_kitten = [kittenSprite(0), kittenSprite(1)];
for (const [k, b] of Object.entries(BREEDS)) defs['boss_' + k] = [cat(b, 0, 2), cat(b, 1, 2)];
const EMP = { fur: ['6', '6', '5', '4'], light: ['6', '6', '5'], eye: ['t', 'u'], ears: 'tiny', head: 'flat', body: 'puff', tail: 'plume', marks: 'persian', eyeType: 'flat' };
defs.boss_empress = [cat(EMP, 0, 2, { crown: 1, cape: 1, regal: 1 }), cat(EMP, 1, 2, { crown: 1, cape: 1, regal: 1 })];
export { BREEDS, cat, EYE };
if (process.argv[1]?.endsWith('gen-cats.mjs')) console.log(emitModule('CATS', 'tools/art/gen-cats.mjs', defs));
