import { Grid, emitModule } from '../pixelgen.mjs';
const S = {};
// turd: a cute soft-serve swirl, 11x14. Three tiers that shrink upward to a curled tip, each
// with a diagonal swirl groove, a bright top-left highlight ramp (8 -> 9 -> a -> b), two tiny
// eyes and a blush on the bottom tier. Warm chocolate with a cream highlight so it pops on
// dark floors and reads differently from the brown maine coon.
{ const g = new Grid(11, 14);
  const tier = (cx, cy, rx, ry) => { const L = new Grid(11, 14); L.ellipse(cx, cy, rx, ry, 'a'); L.relight('a', { hi: '9', lo: 'b' });
    // swirl groove: a dark diagonal from lower-left to upper-right
    const y0 = Math.round(cy + ry * 0.5), x0 = Math.round(cx - rx + 1.2);
    for (let i = 0; i < Math.round(rx * 2 - 2); i++) { const x = x0 + i, y = y0 - Math.floor(i / 2); if (L.get(x, y) !== '.' && L.get(x, y + 1) !== '.') L.px(x, y, 'b'); }
    L.outline('0'); g.over(L); };
  { const L = new Grid(11, 14); L.px(6, 1, '9').px(7, 1, '9').px(7, 2, 'a').px(6, 3, 'a').px(5, 3, '9'); L.outline('0'); g.over(L); } // curled tip
  tier(5.5, 5.0, 2.4, 1.7); tier(5.5, 7.8, 3.6, 1.9); tier(5.5, 10.9, 4.8, 2.2);
  g.px(4, 4, '8').px(3, 7, '8').px(4, 7, '8').px(2, 10, '8').px(3, 10, '8').px(6, 1, '8'); // highlight ramp
  g.px(4, 11, '0').px(7, 11, '0').px(4, 10, '6').px(7, 10, '6'); // eyes with shine
  g.px(3, 12, 'c').px(8, 12, 'c'); // blush
  S.turd = g; }
// hairball: a fuzzy, irregular dark-magenta/grey-brown wad with stray hairs sticking out and a
// dark outline. Two wobble frames (tufts move). Reads as a threat, not a gem: no sparkle, no
// facets, no symmetric shape.
function hairball(f) {
  const g = new Grid(12, 12);
  g.fluff(6, 6, 4.2, 3.9, 'e', 9, 1.1, f ? 0.4 : 0);
  g.relight('e', { hi: 'd', lo: 'v', d: 1 });
  // matted grey-brown hair clumps
  for (const [x, y] of f ? [[4, 4], [7, 6], [5, 8], [8, 4]] : [[5, 4], [7, 7], [4, 7], [8, 5]]) { g.px(x, y, 'p'); if (g.get(x + 1, y) === 'e') g.px(x + 1, y, 'q'); }
  // stray hairs (1px, attached to the ball so they get outlined, never floating)
  g.outline('0');
  // stray hairs: short strands that grow out of the outline (always attached, never floating)
  for (const a of f ? [0.5, 2.2, 3.7, 5.3] : [0.9, 2.6, 4.1, 5.7]) {
    let x = 6, y = 6, n = 0;
    for (let r = 0; r < 8 && n < 2; r += 0.5) { const px = Math.round(6 + Math.cos(a) * r), py = Math.round(6 + Math.sin(a) * r); if (g.get(px, py) === '.' && (px !== x || py !== y)) { g.px(px, py, 'o'); n++; } x = px; y = py; }
  }
  return g;
}
S.hairball = [hairball(0), hairball(1)];
// yarn ball 12x12 with wound strands and a loose end
{ const g = new Grid(12, 12); g.ellipse(6, 6, 4.6, 4.6, 'd'); g.relight('d', { hi: 'c', lo: 'e' });
  for (const [a, b] of [[[3, 3], [9, 6]], [[2, 6], [8, 9]], [[4, 2], [9, 4]]]) g.line(a[0], a[1], b[0], b[1], 'c');
  g.line(3, 8, 7, 3, 'e'); g.ellipse(6, 6, 4.6, 4.6, 'd', ['.']); g.px(9, 9, 'd').px(10, 10, 'd'); g.outline('0'); S.yarn = g; }
// heart pickup 11x10: classic symmetric pixel heart, top-left highlight
const HEART11 = [
  '.000...000.',
  '0rrr0.0rrr0',
  '0r66r0rrrr0'.slice(0, 11),
  '0r6rrrrrre0',
  '0rrrrrrrre0',
  '.0rrrrrre0.',
  '..0rrrre0..',
  '...0rre0...',
  '....0e0....',
  '.....0.....',
];
{ const g = new Grid(11, 10); g.stamp(0, 0, HEART11); S.pk_heart = g; }
// bone (double shot) 14x8
{ const g = new Grid(14, 8); g.rect(3, 3, 8, 2, '7'); for (const [x, y] of [[2.5, 2.5], [2.5, 5.5], [11.5, 2.5], [11.5, 5.5]]) g.ellipse(x, y, 2, 2, '7'); g.shade('7', '8', 1, 1, 1); g.outline('0'); S.pk_bone = g; }
// chili (spread) 10x14
{ const g = new Grid(10, 14); g.ellipse(5, 8, 3, 5, 'r').rect(4, 1, 2, 3, 'j').px(6, 1, 'j'); g.shade('r', 'e', 1, 1, 1); g.px(4, 6, 'c'); g.outline('0'); S.pk_chili = g; }
// bandana (shield) 14x10
{ const g = new Grid(14, 10); g.poly([[0.5, 1], [13.5, 1], [7, 9.5]], 'm'); g.shade('m', 'n', 1, 1, 1); g.px(4, 3, '6').px(8, 3, '6').px(6, 5, '6'); g.outline('0'); S.pk_bandana = g; }
// sneaker (speed) 12x10
{ const g = new Grid(14, 10); g.ellipse(8, 6, 5.5, 3, 'l').rect(2, 7, 12, 2, '6'); g.px(6, 4, '6').px(8, 4, '6'); g.shade('l', 'm', 1, 1, 1); g.outline('0'); S.pk_sneaker = g; }
// treat (score) 10x10
{ const g = new Grid(10, 10); g.ellipse(5, 5, 4.2, 4.2, '9'); g.shade('9', 'a', 1, 1, 1); g.px(3, 3, 'b').px(6, 4, 'b').px(4, 6, 'b'); g.outline('0'); S.pk_treat = g; }
// memory polaroid 12x14
{ const g = new Grid(12, 14); g.rect(1, 1, 10, 12, '6'); g.rect(2, 2, 8, 7, 'm'); g.ellipse(6, 7, 2.2, 1.6, '7').ellipse(4.5, 4.5, 1.2, 1.2, 'f'); g.rect(2, 8, 8, 1, 'j'); g.outline('0'); S.pk_memory = g; }
// puppy (rescued) 16x16
{ const g = new Grid(16, 16); g.ellipse(8, 10, 4.5, 4, '9').ellipse(8, 6, 4, 3.5, '9').ellipse(3.5, 6.5, 1.6, 3, 'a').ellipse(12.5, 6.5, 1.6, 3, 'a'); g.ellipse(8, 8, 2, 1.4, '7'); g.px(6, 5, '0').px(10, 5, '0').px(7, 7, '0').px(8, 7, '0'); g.shade('9', 'a', 1, 1, 1); g.rect(5, 11, 6, 1, 'r'); g.outline('0'); S.pup = g; }
// tiny heart icons 9x8 (HUD): symmetric lobes, top-left highlight
const HEART9 = [
  '.00...00.',
  '0dd0.0dd0',
  '0cdd0ddd0',
  '0dddddde0',
  '.0dddde0.',
  '..0dde0..',
  '...0e0...',
  '....0....',
];
{ const g = new Grid(9, 8); g.stamp(0, 0, HEART9); S.hud_heart = g; }
{ const g = new Grid(9, 8); g.stamp(0, 0, HEART9.map(r => r.replace(/[cde]/g, 'q'))); S.hud_heart_empty = g; }
// paw print icon: four toe beans + pad
{ const g = new Grid(12, 11); for (const [x, y] of [[1, 4], [3, 1], [7, 1], [9, 4]]) g.rect(x, y, 2, 2, 'l'); g.ellipse(6, 7.6, 3.2, 2.4, 'l'); g.relight('l', { lo: 'm' }); g.outline('0'); S.hud_paw = g; }
console.log(emitModule('PROPS', 'tools/art/gen-props.mjs', S));
