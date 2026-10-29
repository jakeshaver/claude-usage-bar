// Ending diorama art (side views, drawn at 2x by ui): node src/ui/art/gen-ending.mjs > src/ui/ending-art.ts
// Same rules as Pom's in-game sheet (src/player/art/gen-pom.mjs): cool cream coat shaded pale lavender / lavender,
// curly scalloped fur masses lit from the upper left, teal flight harness + jet pod, red captain's scarf, 1px ink line.
import { Grid } from '../../../tools/pixelgen.mjs';

const FUR = ['6', '7', '5', '4'];
const EAR = ['6', '7', '5', '4'];   // ears: same coat, their own ink line separates them from the head
const PUPF = ['8', '9', 'a', 'a'];       // apricot pup coat (ui recolours it per pup)
const PUPE = ['9', 'a', 'b', 'b'];

function curly(w, h, cx, cy, rx, ry, { n = 10, br = 1.8, phase = 0, tones = FUR, outline = false } = {}) {
  const [hi, mid, lo, lo2] = tones; const g = new Grid(w, h);
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2; const bx = cx + Math.cos(a) * (rx - br), by = cy + Math.sin(a) * (ry - br);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - bx) / br, dy = (y + 0.5 - by) / br; if (dx * dx + dy * dy > 1) continue;
      const l = dx * 0.7 + dy * 0.75; g.g[y][x] = l < -0.45 ? hi : l > 0.5 ? lo : mid;
    }
  }
  const irx = rx - br * 1.1, iry = ry - br * 1.1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const nx = (x + 0.5 - cx) / irx, ny = (y + 0.5 - cy) / iry, d = nx * nx + ny * ny; if (d > 1) continue;
    g.g[y][x] = nx * 0.55 + ny * 0.7 > 0.62 && d > 0.45 ? lo : mid;
  }
  if (lo2 && lo2 !== lo) { const c = g.g.map(r => r.slice()); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (c[y][x] === lo && (c[y + 1]?.[x] ?? '.') === '.' && (c[y][x + 1] ?? '.') === '.') g.g[y][x] = lo2; }
  if (outline) g.outline('0');
  return g;
}
/** Plain (shaved) limb or body segment: filled polygon, lit top / shaded bottom, outlined. */
function shaved(w, h, pts, base = '7', hi = '6', lo = '5') {
  const g = new Grid(w, h).poly(pts, base); g.relight(base, { hi, lo }); return g;
}
/** Selective outline: composite `top` over `g`; where `top` ends over other fur, the fur underneath gets a soft
 *  lavender seam instead of an ink line (ink is kept for the outer silhouette, drawn last). */
const SEAM = { '6': '5', '7': '5', '8': 'a', '5': '4', '4': '3', '9': 'a', 'a': 'b' };
function seam(g, top) {
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    if (top.g[y][x] !== '.') continue;
    if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => (top.g[y + b]?.[x + a] ?? '.') !== '.')) continue;
    const c = g.g[y][x]; if (SEAM[c]) g.g[y][x] = SEAM[c];
  }
  return g.over(top);
}
Grid.prototype.overS = function (top) { return seam(this, top); };
function thick(g, x0, y0, x1, y1, c, t = 2) { for (let k = 0; k < t; k++) g.line(x0, y0 + k, x1, y1 + k, c); }

// ---------------- Captain Pom, flying left (side view), 38x24, 2 frames ----------------
function pomFly(f) {
  const W = 38, H = 24, g = new Grid(W, H);
  // tail on a short stalk with its pompom (up and back)
  g.overS(shaved(W, H, [[29, 9], [31, 9], [34, 5], [33, 4]]));
  g.overS(curly(W, H, 34.5, 3.6 + f * 0.4, 3.2, 3, { n: 7, br: 1.3, phase: 0.3 }));
  // hind legs stretched back, ankle puffs
  for (const [dy, far] of [[0, true], [2, false]]) {
    const leg = shaved(W, H, [[27, 12 + dy], [36, 14 + dy + f * 0.5], [36, 16 + dy + f * 0.5], [27, 15 + dy]], far ? '5' : '7', far ? '7' : '6', far ? '4' : '5');
    g.overS(leg); g.overS(curly(W, H, 35.5, 15.2 + dy + f * 0.5, 2.2, 2, { n: 6, br: 1.1, phase: 0.4, tones: far ? EAR : FUR }));
  }
  // lean clipped body
  g.overS(shaved(W, H, [[13, 9], [28, 9], [30, 12], [28, 16], [14, 16]]));
  // hip puff
  g.overS(curly(W, H, 28, 11.6, 4.4, 4.2, { n: 8, br: 1.6, phase: 0.2 }));
  // jet pod on her back with a gold-capped nozzle
  for (let j = 0; j < 4; j++) for (let i = 0; i < 9; i++) g.px(17 + i, 6 + j, j === 0 ? 'o' : j === 3 ? 'q' : i === 8 ? 'q' : 'p');
  g.px(18, 7, 'l'); g.px(19, 7, 's'); g.rect(26, 7, 1, 2, 'f');
  // harness straps round the chest and belly
  for (let y = 9; y <= 16; y++) { g.px(22, y, 'l'); g.px(23, y, 'm'); }
  g.rect(22, 12, 2, 2, 'f');
  // front legs reaching forward (superman), ankle puffs at the front
  for (const [dy, far] of [[0, true], [2, false]]) {
    g.overS(shaved(W, H, [[14, 13 + dy], [4, 14 + dy - f * 0.5], [4, 16 + dy - f * 0.5], [14, 17 + dy]], far ? '5' : '7', far ? '7' : '6', far ? '4' : '5'));
    g.overS(curly(W, H, 3.6, 15.2 + dy - f * 0.5, 2.2, 2, { n: 6, br: 1.1, phase: 0.4, tones: far ? EAR : FUR }));
  }
  // chest mane
  g.overS(curly(W, H, 13.5, 11.5, 5.4, 5.2, { n: 10, br: 1.8, phase: 0.5 }));
  // scarf: a fat red band round the neck and one tail streaming back over her shoulders
  const sc = new Grid(W, H);
  for (let y = 8; y <= 12; y++) { sc.px(12, y, y < 9 ? 'c' : 'r'); sc.px(13, y, y > 11 ? 'e' : 'r'); }
  const wv = (x) => Math.round(Math.sin(x * 0.6 + f * 2.4) * 0.8);
  for (let x = 13; x <= 22; x++) { const y = 7 + wv(x) + (x > 18 ? 1 : 0); sc.px(x, y, 'r'); if (x < 20) sc.px(x, y + 1, 'e'); }
  sc.outline('0'); g.over(sc);
  // head: skull + topknot + long muzzle
  g.overS(curly(W, H, 8.5, 7.5, 4.8, 4.4, { n: 10, br: 1.6, phase: 0.6 }));
  g.overS(curly(W, H, 9.5, 3.2, 4, 3, { n: 8, br: 1.4, phase: 0.2 }));
  const mz = new Grid(W, H).poly([[1, 7], [6, 6.5], [7, 10.5], [2, 10.5], [1, 9.5]], '7');
  mz.relight('7', { hi: '6', lo: '8' }); mz.outline('0'); g.over(mz);
  g.rect(0, 7, 2, 2, '0'); g.px(1, 7, 'q');            // nose
  g.px(3, 10, '0'); g.px(4, 10, '0'); g.px(5, 9, 'c');  // smile + blush
  // flight goggles pushed up on the topknot: teal band, round cyan lens
  for (let x = 6; x <= 13; x++) g.px(x, 5, 'm');
  g.rect(6, 4, 3, 3, '0'); g.px(7, 5, 'l'); g.px(7, 4, 's'); g.px(8, 5, 'l');
  // happy closed eye arc
  g.px(5, 7, '0'); g.px(6, 8, '0'); g.px(7, 7, '0');
  // long floppy ear streaming back in the wind
  g.overS(curly(W, H, 12.2, 9.2 + f * 0.5, 2.8, 2, { n: 6, br: 1, tones: EAR, phase: 0 }));
  g.outline('0');
  return g;
}

// ---------------- Captain Pom sitting on the lawn (side view, facing right), 34x36, 2 frames (tail wag + blink) -------
// Built from separately inked parts (tail pom, haunch, foot poms, clipped leg + bracelet, chest mane, scarf, head, long
// muzzle, topknot, ear, goggles) so the poodle silhouette reads at 1x and 2x: clean rim light, no interior banding.
function part(W, H, inside, { hi = '6', mid = '7', lo = '5', lo2 = '4', ink = true } = {}) {
  // rim light: flat coat, a white rim where the part faces the upper left, a lavender rim (and a deeper corner) where it
  // turns away to the lower right: clean reads at 1x, no noisy interior banding
  const p = new Grid(W, H); const In = (x, y) => x >= 0 && y >= 0 && x < W && y < H && inside(x + 0.5, y + 0.5);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!In(x, y)) continue;
    const up = !In(x, y - 1), lf = !In(x - 1, y), dn = !In(x, y + 1), rt = !In(x + 1, y), dn2 = !In(x, y + 2), rt2 = !In(x + 1, y + 1);
    p.g[y][x] = (dn && rt) ? lo2 : (dn || (rt && !up)) ? lo : (dn2 && rt2) ? lo : (up || lf) ? hi : mid;
  }
  if (ink) p.outline('0');
  return p;
}
const puff = (cx, cy, rx, ry, n = 8, amp = 0.45, ph = 0) => (x, y) => { const dx = (x - cx) / rx, dy = (y - cy) / ry; const a = Math.atan2(dy, dx); return Math.hypot(dx, dy) < 1 + amp / Math.max(rx, ry) * Math.cos(a * n + ph); };
const polyIn = (pts) => (x, y) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
function pomSit(f) {
  const W = 34, H = 36, g = new Grid(W, H); const add = (p) => g.over(p);
  // tail stalk + pom-pom (wags)
  add(part(W, H, polyIn([[7, 23], [9.5, 23], [5.6, 12.5 + f], [3.6, 13.5 + f]])));
  add(part(W, H, puff(4.2, 9.8 + f, 3.7, 3.5, 7, 0.5)));
  // haunch
  add(part(W, H, puff(11.5, 26.2, 7.2, 6.8, 10, 0.5, 0.3)));
  // hind foot pom
  add(part(W, H, puff(15.5, 33.2, 3.8, 2.4, 6, 0.4)));
  // clipped front leg + bracelet pom
  add(part(W, H, polyIn([[20.6, 21], [23.8, 21], [23.6, 31], [21, 31]])));
  add(part(W, H, puff(22.5, 32.4, 3.3, 2.4, 6, 0.4, 1)));
  // chest mane (one big puff from the scarf down to the leg)
  add(part(W, H, puff(20.5, 20.2, 5, 5.2, 9, 0.5, 0.6)));
  // scarf band + tail flapping back
  const sc = new Grid(W, H);
  for (let x = 16; x <= 24; x++) { sc.px(x, 15, 'r'); sc.px(x, 16, 'r'); sc.px(x, 17, x > 21 ? 'e' : 'r'); }
  const wv = (x) => Math.round(Math.sin(x * 0.9 + f * 2.2) * 0.6);
  for (let x = 10; x <= 16; x++) { const y = 16 + wv(x) + (x < 13 ? 1 : 0); sc.px(x, y, 'r'); sc.px(x, y + 1, x < 13 ? 'e' : 'r'); }
  for (let x = 17; x <= 21; x++) sc.px(x, 15, 'c');
  sc.outline('0'); add(sc);
  // head (round skull)
  add(part(W, H, puff(19.6, 11.2, 4.8, 4.2, 9, 0.35, 0.4)));
  // long tapered muzzle
  add(part(W, H, polyIn([[24, 9.6], [31.6, 10.8], [31.6, 13.6], [24.5, 14.8]]), { lo: '5', lo2: '5' }));
  // topknot pom-pom (tall)
  add(part(W, H, puff(18.2, 4.2, 5, 4, 9, 0.45, 0.1)));
  // ear hanging down the side of the head
  add(part(W, H, puff(16.4, 14, 2.5, 4.6, 7, 0.4, 1.2)));
  // goggles on the topknot: teal strap, cyan lens on the brow
  for (let x = 13; x <= 21; x++) { g.px(x, 7, 'm'); g.px(x, 8, 'n'); }
  g.rect(20, 5, 4, 4, '0'); g.rect(21, 6, 2, 2, 'l'); g.px(21, 6, 's');
  g.outline('0');
  // face: nose, eye, smile, blush
  g.rect(30, 10, 2, 2, '0'); g.px(31, 10, 'q');
  if (f) { g.px(21, 11, '0'); g.px(22, 10, '0'); g.px(23, 11, '0'); } else { g.rect(21, 10, 2, 2, '0'); g.px(21, 10, '6'); }
  g.px(27, 14, '0'); g.px(28, 14, '0'); g.px(29, 13, '0');
  g.px(25, 13, 'c');
  const o = new Grid(W, H); o.over(g, 1, 0); return o;
}

// ---------------- a rescued pup sitting (side view, facing right), 16x16, 2 frames (tail wag / ear perk) -------------
function pupSit(f) {
  const W = 16, H = 16, g = new Grid(W, H);
  // little curled tail, wagging
  const tl = new Grid(W, H); if (f) { tl.px(2, 8, '9'); tl.px(2, 9, '9'); tl.px(3, 10, '9'); } else { tl.px(1, 9, '9'); tl.px(2, 10, '9'); tl.px(3, 10, '9'); }
  tl.outline('0'); g.over(tl);
  // round haunch
  g.overS(curly(W, H, 6.2, 11.6, 3.7, 3.4, { n: 8, br: 1.4, tones: PUPF, phase: 0.3 }));
  // chest + front leg
  g.overS(shaved(W, H, [[8, 8], [11.5, 8], [11.5, 14.5], [9, 14.5]], '9', '8', 'a'));
  g.rect(9, 14, 3, 1, '8');
  // collar with a gold tag
  const cl = new Grid(W, H); for (let x = 8; x <= 12; x++) cl.px(x, 8, 'r'); cl.px(12, 9, 'f'); g.over(cl);
  // head: round skull, short cream muzzle with a black nose
  const hd = new Grid(W, H).ellipse(10.6, 4.8, 3.4, 3.1, '9'); hd.relight('9', { hi: '8', lo: 'a' }); g.over(hd);
  const mz = new Grid(W, H).poly([[12.5, 4.5], [15.6, 5], [15.6, 7.4], [12.5, 7.6]], '7'); g.over(mz);
  g.px(15, 5, '0'); g.px(13, 7, 'a'); g.px(14, 7, 'a');
  g.rect(11, 3, 1, 2, '0'); g.px(12, 3, '6');           // eye with a glint
  // floppy ear down the back of the head
  const er = new Grid(W, H).poly([[8, 2 - f], [10.5, 2.5], [10, 7.5], [8, 7]], 'a'); er.px(9, 3, 'b'); g.over(er);
  g.outline('0');
  return g;
}

// ---------------- a rescued pup flying (side view, facing left), 20x12, 2 frames ----------------
function pupFly(f) {
  const W = 20, H = 12, g = new Grid(W, H);
  // tiny pink cape streaming back off the shoulders
  const cp = new Grid(W, H).poly([[8, 3], [16, 2 + f], [17, 4 + f], [9, 6]], 'c'); cp.relight('c', { lo: 'd' }); cp.outline('0'); g.over(cp);
  // legs: front pair reaching forward, hind pair stretched back
  g.overS(shaved(W, H, [[7, 7], [2, 8], [2, 9.6], [7, 9.6]], '9', '8', 'a'));
  g.overS(shaved(W, H, [[13, 7], [18.5, 8 - f], [18.5, 9.6 - f], [13, 9.6]], '9', '8', 'a'));
  // body
  const bd = new Grid(W, H).ellipse(10.5, 7, 5, 2.6, '9'); bd.relight('9', { hi: '8', lo: 'a' }); g.over(bd);
  // head with a cream muzzle pointing left, ear streaming back
  const hd = new Grid(W, H).ellipse(5.4, 4.6, 3.2, 3, '9'); hd.relight('9', { hi: '8', lo: 'a' }); g.over(hd);
  const mz = new Grid(W, H).poly([[0.6, 4.6], [3.4, 4.2], [3.4, 7.2], [0.6, 7]], '7'); g.over(mz);
  g.px(0, 5, '0'); g.px(4, 4, '0'); g.px(3, 3, '6');
  const er = new Grid(W, H).poly([[6, 2.4], [10, 2 + f], [10, 3.6 + f], [6.5, 5]], 'a'); g.over(er);
  // collar
  g.px(7, 6, 'r'); g.px(7, 7, 'r');
  g.outline('0');
  return g;
}

// ---------------- the Empress's hedgehog (side view, facing right), 16x14, 2 frames (sniff) ----------------
// A readable hedgehog silhouette at 2x: a saw-toothed crown of spines, a pale pointed snout, little feet, party hat.
function hedgehog(f, hat = true) {
  const W = 18, H = 14, g = new Grid(W, H);
  // spiny back: a dome of dark quills with spikes fanning out from the body (alternating long / short, lit tips), so
  // the silhouette is saw-toothed at 1x and 2x
  // quills: a dome whose top edge is a back-leaning saw (period 3), lit tips, darker shafts raked toward the tail
  const sp = new Grid(W, H);
  for (let x = 0; x <= 12; x++) {
    const dome = 9.5 - Math.sqrt(Math.max(0, 1 - ((x - 6.5) / 6.8) ** 2)) * 5.2;
    const top = Math.round(dome - [2.6, 1.3, 0][x % 3]);
    for (let y = Math.max(0, top); y <= 12; y++) {
      if (x < y - 10 || (x === 0 && y % 3 !== 1)) continue; // rounded rump, quill tips along the back edge too
      const d = y - top; sp.px(x, y, d === 0 ? '9' : d === 1 && x % 3 === 0 ? '9' : (x + y) % 3 === 0 && d < 5 ? 'a' : 'b');
    }
  }
  sp.outline('0'); g.over(sp);
  // pale face + pointed snout tipped with a black nose; eye, blush, two feet
  const sn = new Grid(W, H).poly([[10, 7.4], [17.6, 10 - f * 0.5], [16.4, 11.6], [10, 13]], '8'); sn.relight('8', { hi: '7', lo: '9' }); sn.outline('0'); g.over(sn);
  g.px(17, 10 - f, '0'); g.px(12, 9, '0'); g.px(13, 11, 'c');
  g.rect(5, 13, 2, 1, '0'); g.rect(10, 13, 2, 1, '0');
  if (hat) { const ht = new Grid(W, H).poly([[8.6, 5.6], [12.6, 5.6], [10.6, 0.6]], 'l'); ht.px(10, 4, 'c'); ht.px(11, 5, 'f'); ht.px(9, 5, 'c'); ht.outline('0'); g.over(ht); g.px(10, 0, 'f'); }
  return g;
}

// ---------------- Empress Fluffington sitting (side view, facing right), 32x36, 2 frames (tail flick + blink) -------
// A white Persian in her purple cape and gold crown: same part() rim light as Pom, but warm cream shading (never Pom's
// cool lavender), a huge flat-faced head and a plume tail wrapped round her paws.
function empressSit(f) {
  const W = 32, H = 36, g = new Grid(W, H); const add = (p) => g.over(p);
  const COAT = { hi: '6', mid: '6', lo: '7', lo2: '8' };
  // plume tail curled forward along the ground (flicks its tip)
  add(part(W, H, puff(10, 32.4, 8.4, 3, 10, 0.5, 0.2), COAT));
  add(part(W, H, puff(19.5, 31.6 - f, 3.4, 2.6, 6, 0.5), COAT));
  // haunch
  add(part(W, H, puff(11.5, 24.5, 7.6, 7.4, 11, 0.6, 0.4), COAT));
  // cape over the back: purple with a gold hem
  const cp = part(W, H, polyIn([[12, 12.5], [21, 13.5], [15, 29], [3.5, 29], [4.5, 21]]), { hi: 't', mid: 'u', lo: '2', lo2: '1' });
  for (let x = 3; x <= 16; x++) for (let y = 26; y <= 29; y++) if (cp.g[y][x] !== '.' && cp.g[y][x] !== '0' && (cp.g[y + 1]?.[x] === '0' || cp.g[y + 1]?.[x] === '.')) cp.g[y][x] = 'f';
  add(cp);
  // front legs + paws
  add(part(W, H, polyIn([[19.6, 23], [23.8, 23], [23.8, 32], [19.6, 32]]), COAT));
  add(part(W, H, puff(22.2, 32.6, 3.2, 1.9, 6, 0.3), COAT));
  // chest ruff
  add(part(W, H, puff(21, 20.5, 5, 6, 10, 0.7, 0.3), COAT));
  // head: big round Persian head, ear, flat face
  add(part(W, H, puff(21.6, 11.6, 6.4, 5.6, 12, 0.6, 0.2), COAT));
  const ear = part(W, H, polyIn([[16, 8.5], [17.2, 3.4], [21.4, 6.8]]), COAT); ear.px(18, 6, 'c'); ear.px(18, 7, 'c'); add(ear);
  // crown: gold band with three points and a red jewel
  const cr = new Grid(W, H);
  cr.rect(18, 4, 7, 2, 'f'); cr.rect(18, 5, 7, 1, 'g');
  for (const x of [18, 21, 24]) { cr.px(x, 3, 'f'); cr.px(x, 2, 'f'); } cr.px(21, 1, 'f'); cr.px(21, 4, 'r');
  cr.outline('0'); add(cr);
  g.outline('0');
  // face: violet eye (blinks), pink nose, a small satisfied mouth, whisker dots
  if (f) { g.px(24, 11, '0'); g.px(25, 11, '0'); } else { g.rect(24, 10, 2, 2, 't'); g.px(25, 11, '0'); g.px(24, 10, '6'); }
  g.rect(27, 12, 2, 1, 'c'); g.px(28, 13, '0'); g.px(27, 14, '0');
  g.px(26, 14, '8'); g.px(25, 13, '8');
  return g;
}

// ---------------- Commander Biscuit sitting (side view, facing right), 32x34, 2 frames (radio blink) -------------
// The bulldog in his navy coat with gold epaulettes and a radio headset, holding a flashlight up and ahead (the beam is
// drawn by ui from the lens at the top right).
function biscuitSit(f) {
  const W = 32, H = 34, g = new Grid(W, H); const add = (p) => g.over(p);
  const BR = { hi: '9', mid: 'a', lo: 'b', lo2: 'b' }, WH = { hi: '6', mid: '7', lo: '8', lo2: '8' }, NAVY = { hi: 'm', mid: 'n', lo: '2', lo2: '1' };
  // stubby tail, brown haunch
  add(part(W, H, polyIn([[3, 27], [6, 26], [6, 28.6], [3, 29]]), BR));
  add(part(W, H, puff(10.5, 27, 7, 5.6, 9, 0.3, 0.4), BR));
  // navy coat on the torso, gold buttons
  const coat = part(W, H, polyIn([[10, 13.5], [21, 13.5], [23.5, 28], [8, 28.5]]), NAVY);
  for (const y of [18, 21, 24]) coat.px(20, y, 'f');
  add(coat);
  // front leg + white paw
  add(part(W, H, polyIn([[17.5, 26], [22, 26], [22, 31], [17.5, 31]]), BR));
  add(part(W, H, puff(20.2, 32, 3, 1.8, 6, 0.3), WH));
  // gold epaulette on the shoulder
  const ep = new Grid(W, H); ep.rect(11, 13, 7, 2, 'f'); for (let x = 11; x <= 17; x += 2) ep.px(x, 15, 'g'); ep.outline('0'); add(ep);
  // raised sleeve + paw holding the flashlight up and ahead
  add(part(W, H, polyIn([[15, 17], [18, 16], [25, 12.5], [26.4, 15.4], [19, 20.5], [15.5, 20.5]]), NAVY));
  add(part(W, H, puff(26.2, 13.6, 2.4, 2.4, 6, 0.2), WH));
  const fl = new Grid(W, H); fl.poly([[25.5, 11], [29, 8], [30.6, 9.8], [27, 13]], 'p'); fl.px(27, 11, 'o'); fl.px(28, 10, 'o'); fl.px(30, 8, '7'); fl.px(31, 9, '7'); fl.px(30, 9, '6'); fl.outline('0'); add(fl);
  // head: broad skull, white blaze + jowly muzzle, folded ear
  add(part(W, H, puff(16.6, 8.4, 6.2, 5.4, 9, 0.3, 0.3), BR));
  add(part(W, H, polyIn([[19.5, 8], [25, 8.6], [25.4, 13.4], [21, 14.6], [18.6, 12.4]]), WH));
  add(part(W, H, polyIn([[11.6, 4], [15.4, 3.4], [14.6, 7.4], [11.4, 6.6]]), { hi: 'a', mid: 'b', lo: 'b', lo2: 'b' }));
  // headset: band over the skull, ear cup, mic boom to the jowls (tip blinks on air)
  const hs = new Grid(W, H);
  for (let x = 12; x <= 19; x++) hs.px(x, x < 14 || x > 17 ? 3 : 2, 'q');
  hs.rect(12, 7, 3, 4, 'q'); hs.px(13, 8, 'p');
  for (let x = 15; x <= 20; x++) hs.px(x, 11 + (x > 17 ? 1 : 0), 'q');
  hs.px(21, 12, f ? 'r' : 'q');
  add(hs);
  g.outline('0');
  // face: eye under a heavy brow, nose, underbite tooth
  g.rect(19, 6, 3, 1, 'b'); g.rect(20, 7, 2, 2, '0'); g.px(20, 7, '6');
  g.rect(24, 8, 2, 2, '0'); g.px(24, 8, 'q');
  g.px(23, 13, '6'); g.rect(21, 12, 3, 1, '0');
  return g;
}

// ---------------- party pups (true ending): play-bow, standing (tail chase), lying on its back; all face right --------
function pupHead(g, W, H, hx, hy, f, { closed = false } = {}) {
  const hd = new Grid(W, H).ellipse(hx, hy, 3.3, 3, '9'); hd.relight('9', { hi: '8', lo: 'a' }); g.over(hd);
  const mz = new Grid(W, H).poly([[hx + 1.9, hy - 0.3], [hx + 5, hy + 0.2], [hx + 5, hy + 2.6], [hx + 1.9, hy + 2.8]], '7'); g.over(mz);
  g.px(hx + 4.4, hy + 0.2, '0'); g.px(hx + 2.4, hy + 2.2, 'a'); g.px(hx + 3.4, hy + 2.2, 'a');
  if (closed) { g.px(hx, hy - 1.4, '0'); g.px(hx + 1, hy - 1.4, '0'); } else { g.rect(Math.round(hx + 0.4), Math.round(hy - 1.8), 1, 2, '0'); g.px(hx + 1.4, hy - 1.8, '6'); }
  const er = new Grid(W, H).poly([[hx - 2.6, hy - 2.8 - f], [hx - 0.1, hy - 2.3], [hx - 0.6, hy + 2.7], [hx - 2.6, hy + 2.2]], 'a'); er.px(hx - 1.6, hy - 1.8, 'b'); g.over(er);
}
function pupBow(f) {
  const W = 20, H = 14, g = new Grid(W, H);
  const tl = new Grid(W, H); if (f) { tl.px(3, 3, '9'); tl.px(2, 2, '9'); tl.px(2, 1, '9'); } else { tl.px(3, 3, '9'); tl.px(3, 2, '9'); tl.px(4, 1, '9'); } tl.outline('0'); g.over(tl);
  g.overS(shaved(W, H, [[4, 7], [7.2, 7], [7.2, 13.5], [4.4, 13.5]], '9', '8', 'a'));        // hind legs, standing tall
  g.overS(curly(W, H, 6, 5.4, 3.4, 2.9, { n: 8, br: 1.3, tones: PUPF, phase: 0.2 }));      // rump up in the air
  g.overS(shaved(W, H, [[6, 3.6], [9.5, 4], [14, 8.4], [14, 11.4], [7.5, 8.6]], '9', '8', 'a')); // back sloping down
  g.overS(shaved(W, H, [[11.5, 11], [19.6, 11.6], [19.6, 13.5], [11.5, 13.5]], '9', '8', 'a')); // front legs flat out
  const cl = new Grid(W, H); cl.px(13, 9, 'r'); cl.px(13, 10, 'r'); cl.px(14, 11, 'f'); g.over(cl);
  pupHead(g, W, H, 14.2, 8.2, f);
  g.outline('0');
  return g;
}
function pupStand(f) {
  const W = 18, H = 14, g = new Grid(W, H);
  const tl = new Grid(W, H); if (f) { tl.px(3, 5, '9'); tl.px(2, 4, '9'); tl.px(2, 3, '9'); tl.px(3, 2, '9'); } else { tl.px(3, 5, '9'); tl.px(2, 5, '9'); tl.px(1, 4, '9'); tl.px(1, 3, '9'); } tl.outline('0'); g.over(tl);
  for (const [x, dy] of [[4.2, f], [11, 1 - f]]) g.overS(shaved(W, H, [[x, 8], [x + 2, 8], [x + 2, 13.5 - dy], [x, 13.5 - dy]], 'a', '9', 'b'));  // far legs
  g.overS(curly(W, H, 7.6, 7.6, 4.8, 2.9, { n: 9, br: 1.3, tones: PUPF, phase: 0.1 }));
  for (const [x, dy] of [[5.6, 1 - f], [12.2, f]]) g.overS(shaved(W, H, [[x, 8.5], [x + 2, 8.5], [x + 2, 13.5 - dy], [x, 13.5 - dy]], '9', '8', 'a'));
  const cl = new Grid(W, H); cl.px(11, 6, 'r'); cl.px(11, 7, 'r'); cl.px(12, 8, 'f'); g.over(cl);
  pupHead(g, W, H, 12.4, 4.4, f);
  g.outline('0');
  return g;
}
/** Lying on its back (hand-placed: at 22x13 a generated pose read as a crate): paws flopped over toward the head,
 *  round pink belly with a cream fluff rim, head tipped on its cheek (shut eye, nose up, tongue lolling), ear on the
 *  grass. Frame 1 kicks the hind paw and flicks the tongue. */
const PUP_BACK = [[
    '......................',
    '...00.....00..........',
    '..0880...0880.........',
    '.09a90..09a90.000..00.',
    '.0990...0990.088900700',
    '..09900000990089997770',
    '.0897cccc7790090099770',
    '.0a97ccccc790099990dd0',
    '09a997cccc7900a99a00d0',
    '0a0a99777799a0baa0..0.',
    '.0.0aa9999aabbba0.....',
    '....0aaaaaa0bbb0......',
    '.....000000.000.......',
  ], [
    '...00.................',
    '..0880....00..........',
    '.09a90...0880.........',
    '.0990...09a90.000..00.',
    '.0990...0990.088900700',
    '..09900000990089997770',
    '.0897cccc7790090099770',
    '.0a97ccccc790099990dd0',
    '09a997cccc7900a99a0d00',
    '0a0a99777799a0baa0..0.',
    '.0.0aa9999aabbba0.....',
    '....0aaaaaa0bbb0......',
    '.....000000.000.......',
  ]];
function pupBack(f) {
  const rows = PUP_BACK[f], g = new Grid(rows[0].length, rows.length);
  g.stamp(0, 0, rows);
  return g;
}

const defs = { end_pom_fly: [pomFly(0), pomFly(1)], end_pom_sit: [pomSit(0), pomSit(1)], end_pup_sit: [pupSit(0), pupSit(1)], end_pup_fly: [pupFly(0), pupFly(1)], end_pup_bow: [pupBow(0), pupBow(1)], end_pup_stand: [pupStand(0), pupStand(1)], end_pup_back: [pupBack(0), pupBack(1)], end_hedgehog: [hedgehog(0), hedgehog(1)], end_empress_sit: [empressSit(0), empressSit(1)], end_biscuit_sit: [biscuitSit(0), biscuitSit(1)] };
const out = ['// generated by src/ui/art/gen-ending.mjs: change the generator and re-run, do not hand-edit', "import type { SpriteDef } from '../art/sprite';", 'export const ENDING_ART: Record<string, SpriteDef> = {'];
for (const [k, fr] of Object.entries(defs)) {
  const fs = Array.isArray(fr) ? fr : [fr];
  out.push(`  ${k}: { rows: [`); out.push(...fs[0].rows().map(r => `    '${r}',`));
  if (fs.length > 1) { out.push('  ], frames: ['); for (const x of fs.slice(1)) { out.push('    ['); out.push(...x.rows().map(r => `      '${r}',`)); out.push('    ],'); } out.push('  ] },'); }
  else out.push('  ] },');
}
out.push('};');
console.log(out.join('\n'));
