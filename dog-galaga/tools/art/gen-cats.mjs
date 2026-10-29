import { Grid, hash2, emitModule } from '../pixelgen.mjs';
// Cat generator. Cats face the player (down the screen), flying "flying-squirrel" style:
// big head at the bottom, back and hind paws behind it, tail up top, front paws out to the
// sides flapping between two frames. Every breed has its own proportions (head, body, ears,
// tail, paw placement) and markings, not just a palette swap. Each body part is a layer:
// filled, lit from the top-left, outlined, then composited back-to-front, so overlaps stay
// readable. Faces use hand-drawn stamps.
// S=1 -> 32x32 enemy. S=2 -> 64x64 boss, which is NOT an upscale: bosses get forearms and
// haunches with toe beans, a 4-step ramp with a dithered transition band, a rim light on the
// shadow side, fur-stroke texture, a costume prop per breed and a bigger face with brows.
// Whiskers stay inside the silhouette (no stray pixels on sand).

// ---- hand-drawn stamps -------------------------------------------------------------
// I = iris, J = iris shadow, 0 = pupil/outline, 6 = glint
const EYE = {
  cat: ['.000.', '06II0', '0I0I0', '0J0J0', '.000.'],
  // big round copper eye, small round pupil (persian: sweet, not grumpy)
  round: ['.000.', '06II0', '0I0I0', '0IJJ0', '.000.'],
  owl: ['.0000.', '06III0', '0I00I0', '0J00J0', '0JJJJ0', '.0000.'],
  almond: ['000...', '06I00.', '0I00I0', '.0JJJ0', '..000.'],
  boss: ['.0000000.', '066IIIII0', '066I0III0', '0II000II0', '0II000II0', '0JJJ0J6J0', '0JJJJJJJ0', '.0000000.'],
  bossRound: ['..00000..', '.066III0.', '0666IIII0', '0II000II0', '0II000JI0', '0JJ000JJ0', '.0JJJJ60.', '..00000..'],
  bossOwl: ['..00000..', '.0666II0.', '06600III0', '0I0000II0', '0I0000JI0', '0J0000JJ0', '.0JJJJ60.', '..00000..'],
  bossAlmond: ['0000.....', '066II000.', '06II00II0', '0II000II0', '.0JJ0JJJ0', '..0JJJJ0.', '...0000..'],
};
const MOUTH = {
  cat: ['..cd..', '0.00.0', '.0..0.'],
  flat: ['.cd.', '.00.'],
  persian: ['.cd.', '0..0'], // squashed nose set high between the eyes, tiny frown under it
  siamese: ['......', '.0..0.', '..00..'],
  boss: ['...ccdd...', '...cddd...', '....dd....', '....00....', '.0..00..0.', '..00..00..'],
  bossFlat: ['..cdd..', '...d...', '..000..', '.0...0.'],
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
  '0ggggggggggggggggggg',
  '.0000000000000000000',
  '....................',
];
const TABBY_M = { // bold dark "M" on the forehead
  1: ['b...b', 'bb.bb', 'b.b.b'],
  2: ['bb.......bb', 'bbb.....bbb', 'bbbb...bbbb', 'bb.bb.bb.bb', 'bb..bbb..bb', 'bb...b...bb'],
};
const ROSETTE = { // broken C-shaped ring of dark brown around a burnt-orange centre (not a hole)
  1: ['bb.', 'bh.', '.bb'],
  2: ['.bb.b', 'bhhh.', 'bhhhb', '.hhhb', 'b.bb.'],
};

// ---- breeds --------------------------------------------------------------------------
// fur ramp: hi / base / lo / lo2. light: muzzle & chest. eye: iris/shadow.
// hw/hh head radii, bw/bh/by body, tw tail width, ty tail tip y, ts tail swing, px/py paw offset
const BREEDS = {
  tabby: { fur: ['f', 'g', 'h', 'b'], light: ['6', '7', '8'], eye: ['i', 'j'], ears: 'point', head: 'round', hw: 9.2, hh: 7.0, tail: 'ringed', tw: 1.7, marks: 'tabby', stripe: 'a', rim: 'f' },
  tuxedo: { fur: ['q', 'v', '1', '1'], light: ['6', '6', 'o'], eye: ['f', 'g'], ears: 'point', head: 'round', hw: 9.6, hh: 7.8, bw: 6.4, tail: 'thin', tw: 1.0, ty: 0.6, ts: 5, px: 9.6, py: 1, marks: 'tuxedo', rim: 'o', rimTL: 'p', rimBR: 'q' },
  siamese: { fur: ['7', '7', '8', '9'], light: ['6', '7', '8'], point: ['a', 'b', 'v'], eye: ['l', 'm'], ears: 'corner', head: 'wedge', hw: 7.4, hh: 7.4, bw: 5.4, bh: 6.4, px: 8.4, py: 1.2, tail: 'whip', tw: 1.0, ts: 4, marks: 'points', eyeType: 'almond', mouth: 'siamese', rim: '6' },
  persian: { fur: ['6', '7', '8', '9'], light: ['6', '6', '7'], eye: ['g', 'h'], ears: 'tiny', head: 'flat', hw: 10.2, hh: 7.0, body: 'puff', tail: 'plume', tw: 3.2, marks: 'persian', eyeType: 'round', mouth: 'persian', rim: '6', ring: '8' },
  sphynx: { fur: ['7', 'c', 'd', 'e'], light: ['7', 'c', 'd'], eye: ['i', 'j'], ears: 'bat', head: 'round', hw: 7.8, hh: 7.4, bw: 5.6, bh: 6.2, tail: 'rat', tw: 0.85, marks: 'wrinkles', noWhisk: 1, px: 9.2, rim: '7' },
  mainecoon: { fur: ['8', '9', 'a', 'b'], light: ['6', '7', '8'], eye: ['i', 'j'], ears: 'tuft', head: 'round', hw: 9.0, hh: 7.4, body: 'big', bw: 8.6, bh: 6.0, by: 14, px: 11.6, tail: 'bushy', tw: 2.7, ty: 8.5, ts: 12.2, tfix: 1, marks: 'mainecoon', ruff: 1, stripe: 'b', rim: '7' },
  calico: { fur: ['6', '6', '7', '8'], light: ['6', '6', '7'], eye: ['f', 'g'], ears: 'point', head: 'round', hw: 8.0, hh: 7.0, bw: 5.6, bh: 7.0, tail: 'banded', tw: 1.6, ty: 0.4, ts: 5, px: 8.4, py: 1.6, marks: 'calico', rim: '6' },
  russianblue: { fur: ['o', 'o', 'p', 'q'], light: ['o', 'o', 'p'], eye: ['i', 'j'], ears: 'tall', head: 'round', hw: 7.6, hh: 8.0, bw: 5.4, bh: 7.4, tail: 'stub', tw: 2.4, ty: 5.4, ts: 1.5, px: 7.4, py: 3.0, marks: 'sheen', rim: '6' },
  bengal: { fur: ['f', 'f', 'g', 'h'], light: ['7', '7', '8'], eye: ['i', 'j'], ears: 'small', head: 'round', hw: 7.2, hh: 7.0, bw: 5.2, bh: 7.8, by: 12.4, tail: 'spotted', tw: 1.3, ty: 0.6, ts: 4, px: 9.0, py: 0.6, marks: 'rosettes', rim: '7' },
  scottishfold: { fur: ['o', 'o', 'p', 'q'], light: ['6', '6', '7'], eye: ['g', 'h'], ears: 'fold', head: 'owl', hw: 9.6, hh: 8.4, tail: 'thin', tw: 1.3, marks: 'fold', eyeType: 'owl', yarn: 1, stripe: 'p', rim: '6' },
};
// boss costume props: shown only at S=2
const PROP = { tabby: 'helmet', tuxedo: 'bowtie', siamese: 'jewel', persian: 'pearls', sphynx: 'sweater', mainecoon: 'viking', calico: 'pirate', russianblue: 'ushanka', bengal: 'headband', scottishfold: 'glasses' };

function cat(b, frame, S = 1, opts = {}) {
  const N = 32 * S, cx = N / 2;
  const k = (v) => v * S; // 32-space -> pixels
  const [HI, BASE, LO, LO2] = b.fur;
  const [LHI, LBASE, LLO] = b.light;
  const isBoss = S > 1;
  const FURSET = [HI, BASE, LO, LO2];
  // light: 32px = hi edge + 1px shadow. 64px = hi edge, lo2 outer band, lo band, dithered band.
  const lit = (G, base, hi, lo, lo2) => {
    if (!isBoss) return G.relight(base, { hi, lo, d: 1 });
    G.relight(base, { hi, lo, lo2: lo2 ?? lo, d: 2 });
    const c = G.clone(); const empty = (x, y) => (c.get(x, y)) === '.';
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (c.get(x, y) !== base) continue;
      const near = empty(x + 3, y + 3) || empty(x, y + 3) || empty(x + 3, y);
      if (near && (x + y) % 2 === 0) G.px(x, y, lo); // dithered transition band
    }
    return G;
  };
  // rim light: a 1px highlight on the right-hand silhouette edge of each part
  const rim = (G, set) => {
    if (!isBoss || !b.rim) return;
    const c = G.clone();
    for (let y = 1; y < N - 1; y++) for (let x = 0; x < N - 1; x++) {
      if (!set.includes(c.get(x, y)) || c.get(x + 1, y) !== '.') continue;
      if (c.get(x, y + 1) === '.' || c.get(x, y - 1) === '.') continue;
      G.px(x, y, b.rim);
    }
  };
  const layer = () => new Grid(N, N);
  const out = layer();
  const add = (G) => { G.outline('0'); out.over(G); };
  const flap = frame ? 1 : -1;
  const hwv = b.hw ?? 8.6, hhv = b.hh ?? 7.2;

  // ---- cape (empress) behind everything
  if (opts.cape) {
    const C = layer();
    C.poly([[k(9), k(9)], [k(23), k(9)], [k(31), k(30)], [k(24), k(28)], [k(16), k(30)], [k(8), k(28)], [k(1), k(30)]], 'u');
    lit(C, 'u', 't', 'v', 'v');
    for (let x = 0; x < N; x++) for (let y = N - 1; y >= 0; y--) if (C.get(x, y) !== '.') { for (let d = 0; d < k(2); d++) if (C.get(x, y - d) !== '.') C.px(x, y - d, '6'); if (x % 7 === 3) C.px(x, y - 1, '0'); break; }
    add(C);
  }
  // ---- tail
  {
    const T = layer();
    const sw = b.tfix ? b.ts + (frame ? 0.8 : -0.8) : (frame ? 1 : -1) * (b.ts ?? 3);
    const ty = b.ty ?? 1.6;
    const p0 = [16, 11], p1 = [16 + sw * 0.4, (11 + ty) / 2], p2 = [16 + sw, ty + b.tw * 0.6];
    const at = (t) => [(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]];
    const fluffyT = b.tail === 'plume' || b.tail === 'bushy';
    for (let t = 0; t <= 1.0001; t += 0.04) {
      const [x, y] = at(t);
      const w = b.tw * (fluffyT ? (0.75 + 0.35 * Math.sin(t * 3)) : b.tail === 'rat' || b.tail === 'whip' || b.tail === 'spotted' ? 1.2 - t * 0.35 : b.tail === 'stub' ? 1.05 - t * 0.1 : 1);
      if (fluffyT) T.fluff(k(x), k(y), k(w), k(w), BASE, 6, k(0.8), t * 9); else T.ellipse(k(x), k(y), k(w), k(w), BASE);
    }
    lit(T, BASE, HI, LO, LO2);
    const on = FURSET;
    if (b.tail === 'ringed' || b.tail === 'bushy') for (const t of [0.2, 0.45, 0.7, 0.92]) { const [x, y] = at(t); T.ellipse(k(x), k(y), k(b.tw + 0.6), k(0.55), b.stripe ?? LO, on); }
    if (b.tail === 'banded') for (const [t, c] of [[0.22, 'g'], [0.52, '1'], [0.82, 'g']]) { const [x, y] = at(t); T.ellipse(k(x), k(y), k(b.tw + 0.6), k(1.2), c, on); }
    if (b.tail === 'spotted') { for (const t of [0.2, 0.42, 0.64]) { const [x, y] = at(t); T.ellipse(k(x) + (t * 10 % 2 > 1 ? S : -S) * 0.5, k(y), k(0.8), k(0.7), 'b', on); } const [x, y] = at(1); T.ellipse(k(x), k(y) + S * 0.5, k(b.tw + 0.2), k(1.2), '0', on); }
    if (b.marks === 'points') for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (T.get(x, y) !== '.' && y < k(8.5)) T.px(x, y, (x + y) % 5 === 0 ? b.point[0] : b.point[1]);
    if (b.tail === 'thin' && b.marks === 'tuxedo') { const [x, y] = at(1); T.ellipse(k(x), k(y + 0.4), k(1.3), k(1.6), '6', on); }
    if (b.marks === 'tabby') { const [x, y] = at(1); T.ellipse(k(x), k(y + 0.3), k(b.tw + 0.3), k(1.1), 'a', on); }
    if (b.tail === 'stub') { const [x, y] = at(0.5); T.ellipse(k(x) - S, k(y), k(0.6), k(1.6), HI, [BASE]); }
    rim(T, FURSET);
    add(T);
  }
  // ---- body (back + haunches, behind the head)
  const bw = (b.bw ?? (b.body === 'big' ? 8.4 : b.body === 'puff' ? 12.5 : 7)) + (isBoss && b.body !== 'puff' ? 2.4 : 0), bh = (b.bh ?? (b.body === 'puff' ? 10.5 : 6)) + (isBoss ? 1 : 0), by = b.by ?? (b.body === 'puff' ? 15 : 13);
  {
    const B = layer();
    if (b.body === 'puff') B.fluff(cx, k(by), k(bw), k(bh), BASE, 18, k(1.8), 0.2);
    else B.ellipse(cx, k(by), k(bw), k(bh), BASE);
    // hind legs: 32px = paws tucked at the hips; 64px = full haunches with feet
    if (b.body !== 'puff') for (const s of [-1, 1]) {
      if (isBoss) { B.ellipse(cx + s * k(bw - 1.2), k(by - 1.6), k(3), k(3.6), BASE); B.ellipse(cx + s * k(bw + 0.4), k(by - 4.6 + flap * 0.6), k(2.2), k(1.8), BASE); }
      else B.ellipse(cx + s * k(bw - 0.5), k(10 + flap * 0.8), k(2.1), k(1.8), BASE);
    }
    lit(B, BASE, HI, LO, LO2);
    if (isBoss && b.body !== 'puff') for (const s of [-1, 1]) { // haunch crease + toe beans on the hind feet
      const fx = cx + s * k(bw + 0.4), fy = k(by - 4.6 + flap * 0.6);
      B.line(cx + s * k(bw - 3.4) - (s > 0 ? 1 : 0), k(by - 3.2), cx + s * k(bw - 1.8) - (s > 0 ? 1 : 0), k(by + 0.6), LO);
    }
    const on = FURSET;
    if (b.marks === 'tabby' || b.marks === 'mainecoon') { for (const y of [-4, -1, 2]) for (const s of [-1, 1]) B.rect(cx + (s < 0 ? -k(4.4) : k(1.4)), k(by + y), k(3), S, b.stripe); if (b.marks === 'tabby') B.rect(cx - S, k(by - 5.5), k(2), k(8), b.stripe); }
    if (b.marks === 'rosettes') for (const [x, y] of [[-3.6, -4.6], [2, -5.4], [-1.5, -1.2], [2.6, 0.6], [-3.4, 2.4], [0.8, 4]]) B.stamp(Math.round(cx + k(x)), Math.round(k(by + y)), ROSETTE[S]);
    if (b.marks === 'calico') { B.ellipse(cx - k(3.5), k(11), k(3.6), k(3), 'g', on); B.ellipse(cx + k(2.6), k(14), k(2.6), k(2.4), 'v', on); B.relight('g', isBoss ? { lo: 'h', d: 2 } : { lo: 'h' }); }
    if (b.marks === 'wrinkles') for (const y of [10, 13]) B.line(cx - k(3), k(y), cx + k(3) - 1, k(y), LO);
    if (b.marks === 'points' && !isBoss) for (const s of [-1, 1]) B.ellipse(cx + s * k(bw - 0.5), k(10 + flap * 0.8), k(2.1), k(1.8), b.point[1]);
    if (b.marks === 'tuxedo' && !isBoss) for (const s of [-1, 1]) B.ellipse(cx + s * k(bw - 0.5), k(10.4 + flap * 0.8), k(2.1), k(1.6), '6');
    if (b.marks === 'tuxedo') B.ellipse(cx, k(by + 2), k(2.4), k(3), '6', on);
    if (b.marks === 'sheen') { B.line(cx - k(4), k(by - 3), cx - k(1), k(by - 4.2), '6'); B.px(cx - k(4), k(by - 2.4), 's'); }
    if (isBoss) furStrokes(B, BASE, LO, 3);
    rim(B, FURSET);
    add(B);
  }
  // ---- ears (behind head)
  const HX = cx, HY = k(b.head === 'owl' ? 19.6 : 20);
  const hrx = k(hwv), hry = k(hhv);
  {
    const E = layer(); const inner = b.marks === 'points' ? b.point[0] : b.marks === 'wrinkles' ? 'd' : 'c';
    const hs = hwv / 8.6; // ears follow the head width
    const tri = (s, base, tip, back, innerShrink, tuft) => {
      const P = [[HX + s * k(base[0] * hs), k(base[1])], [HX + s * k(tip[0] * hs), k(tip[1])], [HX + s * k(back[0] * hs), k(back[1])]];
      E.poly(P, BASE);
      if (tuft) { const tx = P[1][0], ty = P[1][1]; E.poly([[tx - k(1.2), ty + k(1.8)], [tx + k(1.2), ty + k(1.8)], [tx + s * k(1.4), ty - k(4.6)]], LO2); }
      if (innerShrink) { const c = [(P[0][0] + P[1][0] + P[2][0]) / 3, (P[0][1] + P[1][1] + P[2][1]) / 3]; E.poly(P.map(([x, y]) => [c[0] + (x - c[0]) * innerShrink, c[1] + (y - c[1]) * innerShrink + k(0.6)]), inner); }
    };
    for (const s of [-1, 1]) {
      if (b.ears === 'point') tri(s, [8.6, 18], [6.8, 8.4], [1.8, 13.6], 0.5);
      if (b.ears === 'tall') tri(s, [8.4, 16], [6.6, 5.6], [2.4, 12.6], 0.5);
      if (b.ears === 'big') tri(s, [9.4, 19], [9.6, 6.4], [1.6, 13.2], 0.55);
      if (b.ears === 'upright') tri(s, [8.6, 16.5], [7.4, 3.2], [2.0, 12.4], 0.5);
      if (b.ears === 'corner') tri(s, [8.4, 16.4], [8.0, 7.6], [2.6, 12.8], 0.45);
      if (b.ears === 'bat') tri(s, [9.2, 18], [12.4, 2.6], [1.6, 12.6], 0.62);
      if (b.ears === 'tuft') tri(s, [9.4, 17], [8.2, 5.6], [1.8, 13], 0.5, true);
      if (b.ears === 'small') { E.ellipse(HX + s * k(5.2), k(14.2), k(2.0), k(2.2), BASE); E.ellipse(HX + s * k(5.2), k(14.6), k(1.0), k(1.2), inner); }
      if (b.ears === 'tiny') tri(s, [7.4, 16], [6.4, 10.6], [3, 13.6], 0.4);
    }
    lit(E, BASE, HI, LO, LO2);
    if (b.marks === 'points') for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const c = E.get(x, y); if (c === BASE || c === HI || c === LO || c === LO2) E.px(x, y, b.point[c === LO || c === LO2 ? 2 : 1]); }
    if (b.marks === 'calico') for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const c = E.get(x, y); if ((c === BASE || c === HI || c === LO || c === LO2) && x < cx) E.px(x, y, c === LO || c === LO2 ? 'h' : 'g'); if ((c === BASE || c === HI || c === LO || c === LO2) && x >= cx) E.px(x, y, c === LO || c === LO2 ? '1' : 'v'); }
    if (b.ears === 'tuft') for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (E.get(x, y) === HI && y < k(7.4)) E.px(x, y, LO2);
    if (isBoss && ['point', 'tall', 'big', 'tuft'].includes(b.ears)) for (const s of [-1, 1]) for (let i = 0; i < 3; i++) E.line(HX + s * k(5 + i * 0.7), k(14.6 - i * 0.3), HX + s * k(5.6 + i * 0.6), k(12 - i * 0.6), LHI);
    add(E);
  }
  // ---- mane ruff (maine coon): scalloped cream collar framing the face, chest bib below
  if (b.ruff) { const R = layer(); R.fluff(HX, HY + k(2.6), hrx + k(3.8), hry + k(2.0), LBASE, 18, k(1.6), 0.1); lit(R, LBASE, LHI, LLO, LLO); add(R); }
  // ---- front legs + paws (flapping)
  const py = 21.5 + flap * 1.4 + (b.py ?? 0);
  // bosses: forearms reach out past the cheeks and the paws sit low, so the whole body reads
  const pxo = (b.body === 'puff' ? 10.6 : (b.px ?? 10.2)) + (isBoss ? 3.2 : 0);
  const pyy = py + (isBoss ? 3.4 : 0);
  const pawC = b.marks === 'points' ? b.point : b.marks === 'tuxedo' ? ['6', '6', 'o'] : null;
  {
    const P = layer();
    if (isBoss) for (const s of [-1, 1]) { // forearm from the shoulder to the paw
      for (let t = 0; t <= 1; t += 0.05) { const x = HX + s * k(6 + (pxo - 6) * t), y = k(17.5 + (pyy - 17.5) * t); P.ellipse(x, y, k(1.7), k(1.7), BASE); }
    }
    for (const s of [-1, 1]) P.ellipse(HX + s * k(pxo), k(pyy), k(isBoss ? 2.9 : 2.5), k(isBoss ? 2.4 : 2.1), BASE);
    lit(P, BASE, HI, LO, LO2);
    if (pawC) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const c = P.get(x, y); if (c !== '.' && (!isBoss || Math.abs(y - k(pyy)) < k(2.6) && Math.abs(Math.abs(x - HX) - k(pxo)) < k(2.8))) P.px(x, y, c === LO || c === LO2 ? pawC[2] : c === HI ? pawC[0] : pawC[1]); }
    for (const s of [-1, 1]) { const x0 = HX + s * k(pxo), y0 = k(pyy) + k(1.2); for (const d of [-0.8, 0.8]) P.px(x0 + k(d) - (isBoss ? 0 : 0.5), y0, b.marks === 'tuxedo' ? 'o' : pawC ? pawC[2] : LO2); }
    if (isBoss) for (const s of [-1, 1]) { const x0 = HX + s * k(pxo), y0 = k(pyy); P.ellipse(x0, y0 + k(0.4), k(0.8), k(0.6), 'c'); }
    if (isBoss) rim(P, FURSET);
    add(P);
  }
  // ---- head
  {
    const H = layer();
    if (b.head === 'wedge') H.poly([[HX - k(7), HY - k(4)], [HX + k(7), HY - k(4)], [HX + k(6.4), HY + k(0.6)], [HX + k(1.6), HY + k(8.2)], [HX - k(1.6), HY + k(8.2)], [HX - k(6.4), HY + k(0.6)]], BASE).ellipse(HX, HY - k(2.4), k(7), k(4.6), BASE);
    else if (b.head === 'flat') H.fluff(HX, HY, hrx, hry, BASE, 14, k(1.3), 0.15);
    else H.ellipse(HX, HY, hrx, hry, BASE);
    if (b.head !== 'wedge' && (isBoss || b.ruff || b.head === 'flat' || b.cheeks)) for (const s of [-1, 1]) for (const dy of [1, 3.2]) H.poly([[HX + s * (hrx - k(1.6)), HY + k(dy - 1.4)], [HX + s * (hrx + k(1.4)), HY + k(dy + 0.4)], [HX + s * (hrx - k(1.6)), HY + k(dy + 1.6)]], BASE);
    // scottish fold + siamese: no white crown highlight (it read as noise / a headband)
    lit(H, BASE, b.head === 'owl' || b.marks === 'points' ? null : HI, LO, LO2);
    const on = FURSET;
    if (b.ring) { // persian: dark ruff-shadow ring around a lighter flat face disc
      const cy = HY + k(0.5), rx1 = hrx - k(1.7), ry1 = hry - k(1.1), rx2 = rx1 - S * 1.1, ry2 = ry1 - S * 1.1;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        if (!on.includes(H.get(x, y))) continue;
        const d1 = ((x + 0.5 - HX) / rx1) ** 2 + ((y + 0.5 - cy) / ry1) ** 2, d2 = ((x + 0.5 - HX) / rx2) ** 2 + ((y + 0.5 - cy) / ry2) ** 2;
        if (d1 <= 1) H.px(x, y, d2 > 1 ? b.ring : (isBoss && d2 > 0.8 ? LO : LBASE));
      }
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (H.get(x, y) === LBASE && H.get(x - 1, y - 1) === b.ring && H.get(x, y - 1) === b.ring) H.px(x, y, LHI);
    }
    if (b.marks === 'tabby' || b.marks === 'mainecoon') {
      const m = TABBY_M[S]; const y0 = Math.round(HY - hry + k(1.4));
      H.stamp(Math.round(HX - m[0].length / 2), y0, m.map(r => r.replace(/b/g, b.marks === 'tabby' ? 'b' : '0')));
      for (const s of [-1, 1]) for (const dy of [0.5, 2.5]) H.rect(s < 0 ? HX - hrx : HX + hrx - k(2.4), HY + k(dy), k(2.4), S, b.stripe);
    }
    if (b.marks === 'tuxedo') {
      H.poly([[HX, HY - k(4.6)], [HX + k(6.4), HY + k(7.5)], [HX - k(6.4), HY + k(7.5)]], '6', on);
      H.ellipse(HX, HY + k(4), k(6.2), k(3.8), '6', on);
      H.relight('6', isBoss ? { lo: b.marks === 'tuxedo' ? 'o' : '5', d: 2 } : { lo: b.marks === 'tuxedo' ? 'o' : '5' });
    }
    if (b.marks === 'points') { // seal point: ONE diamond mask centred on the nose, cream all around it
      H.poly([[HX, HY - k(2.6)], [HX + k(4.6), HY + k(2.4)], [HX, HY + k(7.0)], [HX - k(4.6), HY + k(2.4)]], b.point[0], on);
      H.poly([[HX, HY + k(0.6)], [HX + k(2.6), HY + k(3.4)], [HX, HY + k(6.4)], [HX - k(2.6), HY + k(3.4)]], b.point[1], [b.point[0]]);
    }
    if (b.marks === 'calico') { H.ellipse(HX - k(4.5), HY - k(3), k(4), k(3.4), 'g', on); H.ellipse(HX + k(3.6), HY - k(3.2), k(2.8), k(2.6), 'v', on); H.relight('g', isBoss ? { lo: 'h', d: 2 } : { lo: 'h' }); }
    if (b.marks === 'wrinkles') { for (const [y, w] of [[-6, 2.0], [-4.8, 3.0], [-3.6, 1.6]]) H.line(HX - k(w), HY + k(y), HX + k(w) - 1, HY + k(y), LO); for (const s of [-1, 1]) H.line(HX + s * k(6.4) - (s > 0 ? 1 : 0), HY + k(2.5), HX + s * k(7.6) - (s > 0 ? 1 : 0), HY + k(4), LO); }
    if (b.marks === 'rosettes') { for (const [x, y] of [[-6.2, -2.6], [4.4, -3.4]]) H.stamp(Math.round(HX + k(x)), Math.round(HY + k(y)), ROSETTE[S]); for (const s of [-1, 1]) H.line(HX + s * k(2.2) - (s > 0 ? 1 : 0), HY - hry + k(1.4), HX + s * k(1.4) - (s > 0 ? 1 : 0), HY - k(3.6), 'b'); }
    if (b.marks === 'sheen') { H.line(HX - k(5.2), HY - k(4), HX - k(2.4), HY - k(5.4), '6'); H.px(HX - k(5.2), HY - k(3.4), 's'); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!isBoss && H.get(x, y) === BASE && hash2(x, y, 5) < 0.06 && y < HY) H.px(x, y, 's'); }
    // muzzle (light)
    const mzy = HY + k(b.head === 'flat' ? 2.6 : b.head === 'owl' ? 3.6 : 3.8);
    if (b.marks !== 'points' && b.marks !== 'wrinkles' && b.marks !== 'sheen') { H.ellipse(HX, mzy, k(b.head === 'owl' ? 4.6 : 3.8), k(2.6), LBASE, [...on, '6']); H.relight(LBASE, { lo: LLO }); }
    if (isBoss) furStrokes(H, BASE, LO, 7);
    // eyes
    const eyeT = isBoss ? ({ owl: 'bossOwl', round: 'bossRound', almond: 'bossAlmond' }[b.eyeType] ?? 'boss') : (b.eyeType ?? 'cat');
    const es = EYE[eyeT]; const ew = es[0].length;
    const gap = isBoss ? k(1.5) : 1;
    const ey = HY - k(b.head === 'flat' ? 2.2 : b.head === 'owl' ? 3 : 2.4) - (isBoss ? 2 : 0);
    const map = { I: b.eye[0], J: b.eye[1] };
    const lx = Math.round(HX - gap - ew), rxp = Math.round(HX + gap);
    H.stamp(lx, Math.round(ey), es, map);
    const mirrorEye = eyeT === 'almond' || eyeT === 'bossAlmond';
    H.stamp(rxp, Math.round(ey), mirrorEye ? es.map(r => [...r].reverse().join('')) : es, map);
    if (eyeT === 'almond') H.px(rxp + ew - 2, Math.round(ey) + 1, map.I).px(rxp + 1, Math.round(ey) + 1, '6');
    if (eyeT === 'bossAlmond') { for (const [x, y] of [[1, 1], [2, 1], [1, 2]]) H.px(rxp + ew - 1 - x, Math.round(ey) + y, map.I); H.px(rxp + 2, Math.round(ey) + 1, '6').px(rxp + 3, Math.round(ey) + 1, '6').px(rxp + 2, Math.round(ey) + 2, '6'); }
    if (isBoss && !opts.regal) for (const s of [-1, 1]) { const x0 = s < 0 ? lx - 1 : rxp + ew; const x1 = s < 0 ? lx + ew - 1 : rxp; H.line(x0, Math.round(ey) - 3, x1, Math.round(ey) - 1, '0'); H.line(x0, Math.round(ey) - 4, x1, Math.round(ey) - 2, '0'); }
    // nose + mouth
    const mt = isBoss ? (b.mouth === 'flat' ? 'bossFlat' : 'boss') : (b.mouth ?? 'cat'); const ms = MOUTH[mt];
    const my = isBoss ? mzy - k(2.2) : b.mouth === 'persian' ? Math.round(ey) + 3 : (b.mouth === 'flat' ? mzy - k(1) : mzy - k(1.6));
    H.stamp(Math.round(HX - ms[0].length / 2), Math.round(my), opts.regal ? ms.slice(0, 3) : ms);
    if (opts.regal) { H.px(HX - 3, Math.round(my) + 4, '0').px(HX + 2, Math.round(my) + 4, '0').rect(HX - 2, Math.round(my) + 5, 4, 1, '0'); }
    // whiskers: dots + short strokes kept inside the head silhouette
    if (!b.noWhisk) for (const s of [-1, 1]) {
      const pts = isBoss ? [[3, 0], [4, 1], [3, 2]] : [[2.4, 0.4]];
      for (const [dx, dy] of pts) H.px(HX + s * k(dx) - (s > 0 ? 1 : 0), mzy + k(dy * 0.5), LLO);
      if (isBoss) for (const [dy, d2] of [[-0.4, -1.2], [0.8, 1.2]]) H.line(HX + s * k(5) - (s > 0 ? 1 : 0), mzy + k(dy), HX + s * (hrx - k(0.8)) - (s > 0 ? 1 : 0), mzy + k(d2), b.fur[3] === '0' ? '5' : LO2);
    }
    rim(H, FURSET);
    add(H);
  }
  // ---- scottish fold ears: small flaps folded FORWARD over the crown, with a crease
  if (b.ears === 'fold') {
    const F = layer();
    for (const s of [-1, 1]) {
      const ex = HX + s * k(5.6), ey = HY - hry + k(1.0);
      F.poly([[ex - k(2.3), ey - k(1.4)], [ex + k(2.3), ey - k(1.4)], [ex + s * k(1.6), ey + k(2.4)], [ex - s * k(1.2), ey + k(1.8)]], BASE);
    }
    F.replace(BASE, LO); F.relight(LO, { hi: BASE, lo: LO2 });
    for (const s of [-1, 1]) { const ex = HX + s * k(5.6), ey = HY - hry + k(1.0); F.line(ex - k(2.0), Math.round(ey), ex + k(2.0) - 1, Math.round(ey), LO2); if (isBoss) F.line(ex - k(2.2), Math.round(ey) + 1, ex + k(2.2) - 1, Math.round(ey) + 1, LO); }
    F.outline('0'); out.over(F);
  }
  if (isBoss && !opts.cape) prop(out, PROP[b.key] ?? null, { HX, HY, hrx, hry, k, N, S, b, pxo, pyy, frame });
  if (opts.cape) { const C = layer(); for (let i = -3; i <= 3; i++) C.ellipse(HX + k(i * 1.6), HY + hry - k(0.4) + k(Math.abs(i) * -0.5), k(0.9), k(0.9), i === 0 ? 'd' : '6'); C.relight('6', { lo: '5' }); add(C); }
  // ---- yarn ball hugged against the right paw, out at the side (scottish fold): teal so it
  // never reads as a tongue, 3 dark wrap lines, a highlight and a 1px trailing strand
  if (b.yarn) {
    const Y = layer(); const yr = k(3.2), yx = HX + k(Math.min(pxo + 1.2, 12.4)), yy = k(Math.min(pyy + 3.2, 27.4));
    Y.ellipse(yx, yy, yr, yr, 'm'); Y.relight('m', { hi: 'l', lo: 'n' });
    for (const a of [-1.2, 0.3, 1.8]) Y.line(yx - yr + S, yy + k(a) + k(0.8), yx + yr - S, yy + k(a) - k(1.2), 'n');
    Y.line(yx - k(0.6), yy - yr + S, yx + k(1.6), yy + yr - 2 * S, 'n');
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const dx = (x + 0.5 - yx) / yr, dy = (y + 0.5 - yy) / yr; if (dx * dx + dy * dy > 1) Y.px(x, y, '.'); }
    Y.ellipse(yx - yr * 0.4, yy - yr * 0.45, Math.max(1, yr * 0.3), Math.max(1, yr * 0.25), 'l', ['m', 'n']);
    Y.outline('0');
    // trailing strand: 1px, curls down from the ball
    let tx = Math.round(yx - yr * 0.3), ty = Math.round(yy + yr) + 1;
    if (isBoss) for (let i = 0; i < k(3); i++) { if (ty < N - 1 && Y.get(tx, ty) === '.') Y.px(tx, ty, 'l'); ty += 1; if (i % 2) tx -= 1; }
    const P = layer(); P.ellipse(HX + k(pxo), k(pyy + 0.6), k(2.5), k(2.1), BASE); lit(P, BASE, HI, LO, LO2); P.outline('0');
    out.over(Y); out.over(P);
  }
  if (b.rimTL) { // very dark coats: 1px blue-grey rim on every top/left silhouette edge
    const c = out.clone(); const isSil = (x, y) => c.get(x, y) === '0' && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => c.get(x + dx, y + dy) === '.');
    for (let y = 1; y < N; y++) for (let x = 1; x < N; x++) {
      if (!FURSET.includes(c.get(x, y))) continue;
      if (isSil(x - 1, y) || isSil(x, y - 1)) out.px(x, y, b.rimTL);
      else if (b.rimBR && (isSil(x + 1, y) || isSil(x, y + 1))) out.px(x, y, b.rimBR);
    }
  }
  if (b.marks === 'calico') { // black patches: 1px dark-grey rim on the silhouette so they never bleed into dark ground
    const c = out.clone(); const isSil = (x, y) => c.get(x, y) === '0' && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => c.get(x + dx, y + dy) === '.');
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) if ((c.get(x, y) === 'v' || c.get(x, y) === '1') && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isSil(x + dx, y + dy))) out.px(x, y, 'q');
  }
  if (opts.crown) { const Cr = layer(); Cr.stamp(Math.round(HX - 10), Math.round(HY - hry - k(4.4)), CROWN); out.over(Cr); }
  return out;
}
function furStrokes(G, base, lo, seed) {
  for (let y = 2; y < G.h - 3; y++) for (let x = 2; x < G.w - 2; x++) {
    if (G.get(x, y) !== base || G.get(x, y + 1) !== base || G.get(x - 1, y) !== base || G.get(x + 1, y) !== base) continue;
    if (hash2(x, y, seed) < 0.05) { G.px(x, y, lo); if (G.get(x + 1, y + 1) === base) G.px(x + 1, y + 1, lo); }
  }
}

// ---- boss props (64px only). Each prop is an outlined layer composited on top. ----------
function prop(out, kind, P) {
  const { HX, HY, hrx, hry, k, N, frame } = P;
  const G = new Grid(N, N);
  const top = HY - hry;
  const clipBelow = (y0) => { for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (y > y0) G.px(x, y, '.'); };
  const done = () => { G.outline('0'); out.over(G); };
  if (kind === 'helmet') { // Sergeant Whiskers: army helmet with a star, chevrons on the chest
    G.ellipse(HX, top + k(2.6), hrx * 0.78, k(3.6), 'k'); clipBelow(top + k(3.4));
    G.rect(Math.round(HX - hrx * 0.86), Math.round(top + k(2.6)), Math.round(hrx * 1.72), k(1.2), 'k');
    G.relight('k', { hi: 'j', lo: '1' });
    G.stamp(HX - 3, Math.round(top + k(0.4)), ['..f..', '.fff.', 'fffff', '.f.f.']);
    done();
  }
  if (kind === 'bowtie') { // dapper red bow tie under the chin + gold monocle
    const y = HY + hry - k(0.6);
    G.poly([[HX - k(4), y - k(1.6)], [HX, y], [HX - k(4), y + k(1.6)]], 'r').poly([[HX + k(4), y - k(1.6)], [HX, y], [HX + k(4), y + k(1.6)]], 'r');
    G.relight('r', { hi: 'c', lo: 'e' });
    G.rect(HX - k(0.8), Math.round(y - k(0.9)), k(1.6), k(1.8), 'e');
    done();
    const M = new Grid(N, N); const ex = HX + k(4.2), ey = HY - k(2.4) - 2;
    for (let a = 0; a < Math.PI * 2; a += 0.05) M.px(ex + Math.cos(a) * k(3), ey + Math.sin(a) * k(3), 'f');
    M.line(ex + k(2.6), ey + k(2), ex + k(4.6), ey + k(8), 'f');
    out.over(M);
  }
  if (kind === 'jewel') { // golden circlet with a sapphire on the forehead
    const y = top + k(3.4);
    for (let x = Math.round(HX - hrx * 0.8); x < HX + hrx * 0.8; x++) { G.px(x, Math.round(y + Math.abs(x - HX) * 0.12), 'f'); G.px(x, Math.round(y + 1 + Math.abs(x - HX) * 0.12), 'g'); }
    done();
    const J = new Grid(N, N); J.stamp(HX - 3, Math.round(y - 2), ['.000.', '0mlm0', '0nmn0', '.0n0.', '..0..']); out.over(J);
  }
  if (kind === 'pearls') { // two strands of pearls
    for (const [r, n] of [[0, 9], [1.4, 11]]) for (let i = 0; i < n; i++) { const t = (i / (n - 1)) * 2 - 1; G.ellipse(HX + t * k(5 + r), HY + hry - k(0.6) + k(r) + (1 - t * t) * k(1.2), k(0.75), k(0.75), '6'); }
    G.relight('6', { lo: '5' });
    done();
  }
  if (kind === 'sweater') { // cozy knit turtleneck (sphynx gets cold)
    G.ellipse(HX, HY + hry + k(0.6), k(7.6), k(2.4), 'm');
    G.relight('m', { hi: 'l', lo: 'n' });
    for (let x = Math.round(HX - k(7)); x < HX + k(7); x += 3) G.line(x, HY + hry - k(1), x + 1, HY + hry + k(2.2), 'n');
    done();
  }
  if (kind === 'viking') { // horned helmet
    G.ellipse(HX, top + k(2.8), hrx * 0.7, k(3.4), 'p'); clipBelow(top + k(3.6));
    G.relight('p', { hi: 'o', lo: 'q' });
    G.rect(Math.round(HX - hrx * 0.74), Math.round(top + k(3)), Math.round(hrx * 1.48), k(1), 'f');
    done();
    const Hn = new Grid(N, N);
    for (const s of [-1, 1]) for (let t = 0; t <= 1; t += 0.04) { const x = HX + s * (hrx * 0.62 + k(3.6) * t), y = top + k(2.2) - k(4.4) * t * t - k(1) * t; Hn.ellipse(x, y, k(1.3 - t * 0.9), k(1.3 - t * 0.9), '7'); }
    Hn.relight('7', { hi: '6', lo: '8' }); Hn.outline('0'); out.over(Hn);
  }
  if (kind === 'pirate') { // red bandana and an eye patch
    G.ellipse(HX, top + k(2.4), hrx * 0.86, k(3.0), 'r'); clipBelow(top + k(3.4));
    G.poly([[HX + hrx * 0.7, top + k(2)], [HX + hrx + k(3), top + k(1 + frame)], [HX + hrx + k(2), top + k(4.4)]], 'r');
    G.relight('r', { hi: 'c', lo: 'e' });
    for (const [x, y] of [[-4, 1], [0, 0.6], [4, 1.2], [-2, 2.4], [2, 2.6]]) G.px(HX + k(x), top + k(y) + 2, '6');
    done();
    const E = new Grid(N, N); const ex = HX - k(1.5) - 5, ey = HY - k(2.4) - 2;
    E.ellipse(ex, ey + 4, k(2.6), k(2.4), '0'); E.line(ex - k(3), ey - k(1), ex + k(8), ey - k(4), '0');
    out.over(E);
  }
  if (kind === 'ushanka') { // fur trapper hat
    G.fluff(HX, top + k(2.2), hrx * 0.95, k(3.2), '9', 12, k(1), 0.2); clipBelow(top + k(4.2));
    G.ellipse(HX, top + k(0.6), hrx * 0.7, k(2.4), 'a');
    G.relight('9', { hi: '8', lo: 'a' }); G.relight('a', { hi: '9', lo: 'b' });
    G.stamp(HX - 2, Math.round(top - k(0.6)), ['.rr.', 'rffr', '.rr.']);
    done();
  }
  if (kind === 'headband') { // red sports headband with trailing ties
    const y = top + k(2.6);
    for (let x = Math.round(HX - hrx * 0.95); x < HX + hrx * 0.95; x++) { G.px(x, Math.round(y), 'r'); G.px(x, Math.round(y) + 1, 'r'); G.px(x, Math.round(y) + 2, 'e'); }
    G.poly([[HX + hrx * 0.8, y], [HX + hrx + k(4), y - k(1.8) + frame * 2], [HX + hrx + k(3.4), y + k(0.6)]], 'r');
    G.poly([[HX + hrx * 0.8, y + 2], [HX + hrx + k(3.6), y + k(2.6) + frame * 2], [HX + hrx + k(2), y + k(2.8)]], 'e');
    for (let yy = 0; yy < N; yy++) for (let x = 0; x < N; x++) if (out.get(x, yy) === '.' && G.get(x, yy) !== '.' && x < HX + hrx * 0.8) G.px(x, yy, '.');
    done();
  }
  if (kind === 'glasses') { // round reading glasses on the nose
    const ey = HY - k(3) - 2;
    for (const s of [-1, 1]) { const ex = HX + s * k(4.4); for (let a = 0; a < Math.PI * 2; a += 0.04) G.px(ex + Math.cos(a) * k(3.2), ey + 3 + Math.sin(a) * k(3.0), 'q'); }
    G.line(HX - k(1.2), ey + 2, HX + k(1.2) - 1, ey + 2, 'q');
    out.over(G);
  }
}

// ---- kitten: procedural 16x16, chubby orange-and-white, huge eyes ----------------------
function kittenSprite(frame) {
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

for (const [key, b] of Object.entries(BREEDS)) b.key = key;
const defs = {};
for (const [k, b] of Object.entries(BREEDS)) defs['cat_' + k] = [cat(b, 0), cat(b, 1)];
defs.cat_kitten = [kittenSprite(0), kittenSprite(1)];
for (const [k, b] of Object.entries(BREEDS)) defs['boss_' + k] = [cat(b, 0, 2), cat(b, 1, 2)];
const EMP = { key: 'empress', fur: ['6', '6', '5', '4'], light: ['6', '6', '5'], eye: ['t', 'u'], ears: 'tiny', head: 'flat', hw: 9.8, hh: 6.6, body: 'puff', tail: 'plume', tw: 3.2, marks: 'persian', eyeType: 'round', mouth: 'flat', rim: null };
defs.boss_empress = [cat(EMP, 0, 2, { crown: 1, cape: 1, regal: 1 }), cat(EMP, 1, 2, { crown: 1, cape: 1, regal: 1 })];
export { BREEDS, cat, EYE };
if (process.argv[1]?.endsWith('gen-cats.mjs')) console.log(emitModule('CATS', 'tools/art/gen-cats.mjs', defs));
