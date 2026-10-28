import { Grid } from '../pixelgen.mjs';
// Param-driven cat generator. Cats face the player (down), flying with paws out, tail up.
const BREEDS = {
  tabby:   { fur: 'g', dark: 'h', light: 'f', eye: 'i', marks: 'stripes' },
  tuxedo:  { fur: '1', dark: '0', light: '6', eye: 'f', marks: 'tux', outline: 'q' },
  siamese: { fur: '7', dark: 'b', light: '6', eye: 'm', marks: 'points' },
  persian: { fur: 'o', dark: 'p', light: '6', eye: 'g', marks: 'fluff', round: 1.2 },
  sphynx:  { fur: 'c', dark: 'd', light: '7', eye: 'i', marks: 'wrinkle', bigEars: 1, slim: 1 },
  mainecoon: { fur: 'a', dark: 'b', light: '8', eye: 'f', marks: 'ruff', tufts: 1, round: 1.1 },
  calico:  { fur: '6', dark: '1', light: '7', eye: 'i', marks: 'calico', patch: 'g' },
  russianblue: { fur: '3', dark: '2', light: '4', eye: 'i', marks: 'none' },
  bengal:  { fur: 'f', dark: 'b', light: '7', eye: 'i', marks: 'spots' },
  scottishfold: { fur: '8', dark: '9', light: '7', eye: 'g', marks: 'none', fold: 1, yarn: 1 },
};
function cat(b, frame, size = 32) {
  const s = size / 32; const g = new Grid(size, size); const cx = size / 2;
  const R = (b.round ?? 1) * (b.slim ? 0.85 : 1);
  // tail up behind (frame swings)
  const tx = cx + (frame ? 3 : -3) * s;
  g.ellipse(tx, 4 * s, 1.6 * s, 4.5 * s, b.fur).ellipse((cx + tx) / 2, 8 * s, 1.6 * s, 2 * s, b.fur);
  if (b.marks === 'points') g.ellipse(tx, 3 * s, 1.6 * s, 3 * s, b.dark);
  if (b.marks === 'stripes') g.px(tx, 2 * s, b.dark).px(tx, 5 * s, b.dark);
  // body
  g.ellipse(cx, 15 * s, 7 * s * R, 6 * s, b.fur);
  // paws out (flying), alternating
  const py = frame ? 1 : -1;
  g.ellipse(cx - 9 * s * R, (17 + py) * s, 2.4 * s, 2 * s, b.fur).ellipse(cx + 9 * s * R, (17 - py) * s, 2.4 * s, 2 * s, b.fur);
  g.ellipse(cx - 6 * s, 26 * s, 2 * s, 1.8 * s, b.fur).ellipse(cx + 6 * s, 26 * s, 2 * s, 1.8 * s, b.fur);
  // head
  const hy = 20 * s;
  // ears
  const ew = b.bigEars ? 4.5 : 3.5, eh = b.bigEars ? 7 : 5;
  if (b.fold) {
    g.ellipse(cx - 5 * s, hy - 5 * s, 3 * s, 2 * s, b.fur).ellipse(cx + 5 * s, hy - 5 * s, 3 * s, 2 * s, b.fur);
  } else {
    g.poly([[cx - 8.5 * s, hy - 1 * s], [cx - (8.5 - ew) * s, hy - eh * s - 3 * s], [cx - 1.5 * s, hy - 3 * s]], b.fur);
    g.poly([[cx + 8.5 * s, hy - 1 * s], [cx + (8.5 - ew) * s, hy - eh * s - 3 * s], [cx + 1.5 * s, hy - 3 * s]], b.fur);
    // inner ears
    g.poly([[cx - 7 * s, hy - 2 * s], [cx - (8 - ew) * s, hy - eh * s - 1.2 * s], [cx - 3.5 * s, hy - 3.5 * s]], b.marks === 'points' ? b.dark : 'c');
    g.poly([[cx + 7 * s, hy - 2 * s], [cx + (8 - ew) * s, hy - eh * s - 1.2 * s], [cx + 3.5 * s, hy - 3.5 * s]], b.marks === 'points' ? b.dark : 'c');
    if (b.tufts) g.px(cx - (8.5 - ew) * s, hy - eh * s - 4 * s, b.dark).px(cx + (8.5 - ew) * s - 1, hy - eh * s - 4 * s, b.dark);
  }
  g.ellipse(cx, hy + 1 * s, 8 * s * R, 6.2 * s, b.fur);
  // markings
  if (b.marks === 'stripes') { for (const dx of [-2, 0, 2]) g.rect(cx + dx * s - (dx > 0 ? 1 : 0), hy - 5 * s, 1, 2 * s, b.dark); g.rect(cx - 8 * s, hy + 1 * s, 2 * s, 1, b.dark).rect(cx + 6 * s, hy + 1 * s, 2 * s, 1, b.dark); for (const y of [12, 15]) { g.rect(cx - 5 * s, y * s, 3 * s, 1, b.dark); g.rect(cx + 2 * s, y * s, 3 * s, 1, b.dark); } }
  if (b.marks === 'tux') { g.ellipse(cx, hy + 4 * s, 4 * s, 3 * s, b.light).ellipse(cx, 14 * s, 3 * s, 3 * s, b.light); g.ellipse(cx - 6 * s, 26 * s, 1.5 * s, 1 * s, b.light).ellipse(cx + 6 * s, 26 * s, 1.5 * s, 1 * s, b.light); }
  if (b.marks === 'points') { g.ellipse(cx, hy + 3 * s, 4.5 * s, 3.5 * s, b.dark); g.ellipse(cx - 9 * s, (17 + py) * s, 2 * s, 1.6 * s, b.dark).ellipse(cx + 9 * s, (17 - py) * s, 2 * s, 1.6 * s, b.dark); }
  if (b.marks === 'fluff') { for (const [x, y] of [[-6, 12], [5, 13], [-3, 17], [4, 17], [-7, 21], [7, 22]]) g.px(cx + x * s, y * s, b.light); g.ellipse(cx, hy + 4 * s, 5 * s, 2 * s, b.light); }
  if (b.marks === 'wrinkle') { g.rect(cx - 2 * s, hy - 4 * s, 4 * s, 1, b.dark).rect(cx - 1 * s, hy - 3 * s, 2 * s, 1, b.dark); g.rect(cx - 4 * s, 13 * s, 2 * s, 1, b.dark).rect(cx + 2 * s, 13 * s, 2 * s, 1, b.dark); }
  if (b.marks === 'ruff') { g.ellipse(cx, hy + 5 * s, 7 * s, 2.5 * s, b.light); for (const dx of [-1, 1]) g.rect(cx + dx * 2 * s - (dx > 0 ? 1 : 0), hy - 5 * s, 1, 2 * s, b.dark); }
  if (b.marks === 'calico') { g.ellipse(cx - 4 * s, hy - 2 * s, 3.5 * s, 3 * s, b.patch).ellipse(cx + 4 * s, hy - 3 * s, 3 * s, 2.5 * s, b.dark).ellipse(cx + 3 * s, 14 * s, 3 * s, 2.5 * s, b.patch).ellipse(cx - 4 * s, 16 * s, 2.5 * s, 2 * s, b.dark); }
  if (b.marks === 'spots') { for (const [x, y] of [[-5, 12], [3, 11], [-1, 15], [5, 16], [-6, 18], [-3, 18], [-5, 22], [5, 21]]) { g.px(cx + x * s, y * s, b.dark); g.px(cx + x * s + 1, y * s, 'g'); } }
  // muzzle + face
  g.ellipse(cx, hy + 3.2 * s, 3.2 * s, 2.2 * s, b.light === '6' && b.marks === 'tux' ? '6' : b.light);
  if (b.marks === 'points') g.ellipse(cx, hy + 3.2 * s, 2.8 * s, 2 * s, b.dark);
  const eyY = hy - 0.5 * s;
  for (const sx of [-1, 1]) {
    const ex = cx + sx * 3.2 * s;
    g.rect(Math.round(ex - 1.5 * s), Math.round(eyY), Math.max(2, Math.round(3 * s)), Math.max(2, Math.round(2 * s)), b.eye);
    g.px(Math.round(ex - (sx > 0 ? 0 : 0)), Math.round(eyY), '0'); g.px(Math.round(ex), Math.round(eyY + 1), '0');
    g.px(Math.round(ex - 1.5 * s), Math.round(eyY), '6');
  }
  g.px(cx - 1, hy + 2 * s, 'd').px(cx, hy + 2 * s, 'd'); // nose
  g.px(cx - 2, hy + 4 * s, '0').px(cx + 1, hy + 4 * s, '0').px(cx - 1, hy + 4 * s + 1, '0').px(cx, hy + 4 * s + 1, '0');
  // whiskers
  g.rect(Math.round(cx - 10 * s), Math.round(hy + 3 * s), Math.round(3 * s), 1, '6').rect(Math.round(cx + 7 * s), Math.round(hy + 3 * s), Math.round(3 * s), 1, '6');
  if (b.yarn) g.ellipse(cx + 9 * s, (17 - py) * s + 3 * s, 2.8 * s, 2.8 * s, 'd').px(cx + 8 * s, (17 - py) * s + 2 * s, 'c').px(cx + 10 * s, (17 - py) * s + 4 * s, 'e');
  if (b.crown) { const y0 = Math.round(hy - 9 * s); g.rect(cx - 5 * s, y0, 10 * s, 3 * s, 'f'); for (const dx of [-5, -1, 3]) g.poly([[cx + dx * s, y0], [cx + (dx + 1) * s, y0 - 4 * s], [cx + (dx + 2) * s, y0]], 'f'); g.px(cx, y0 + 1 * s, 'd').px(cx - 3 * s, y0 + 1 * s, 'l').px(cx + 3 * s, y0 + 1 * s, 'l'); }
  g.shade(b.fur, b.dark, 1, 1, 1);
  g.outline(b.outline ?? '0');
  return g;
}
const out = [];
out.push('// generated by tools/art/gen-cats.mjs');
out.push("import type { SpriteDef } from '../sprite';");
out.push('export const CATS: Record<string, SpriteDef> = {');
const emit = (name, a, b) => { out.push(`  ${name}: { rows: [`); out.push(...a.rows().map(r => `    '${r}',`)); out.push('  ], frames: [['); out.push(...b.rows().map(r => `    '${r}',`)); out.push('  ]] },'); };
for (const [k, b] of Object.entries(BREEDS)) emit('cat_' + k, cat(b, 0), cat(b, 1));
emit('cat_kitten', cat(BREEDS.tabby, 0, 16), cat(BREEDS.tabby, 1, 16));
for (const [k, b] of Object.entries(BREEDS)) emit('boss_' + k, cat(b, 0, 64), cat(b, 1, 64));
const EMP = { fur: '6', dark: '5', light: '7', eye: 'u', marks: 'fluff', round: 1.2, crown: 1 };
emit('boss_empress', cat(EMP, 0, 64), cat(EMP, 1, 64));
out.push('};');
console.log(out.join('\n'));
