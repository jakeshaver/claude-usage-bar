import { Grid, emitModule } from '../pixelgen.mjs';
// Captain Pom: a standard poodle in a continental show cut, seen from above with her rear toward
// the top of the screen (she toots upward) and her face toward the player.
// Built as separate shaded "balls" drawn back-to-front, each with a dark-tan rim where it overlaps
// fur, then one closed ink outline around the whole silhouette. Light comes from the top-left.
// Silhouette top to bottom: tail pompom > two hip pompoms > narrow shaved pink waist with a pink
// harness carrying two rocket boosters > wide mane > head with topknot + bow, long ears, face.

const W = 32;
// 3-tone ball: white highlight top-left, cream body, tan shadow bottom-right, rim '9'.
function ball(g, cx, cy, rx, ry, { rim = true, tones = ['6', '7', '8'], curls = true } = {}) {
  if (rim) g.ellipse(cx, cy, rx + 0.75, ry + 0.75, '9');
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, d = dx * dx + dy * dy;
    if (d > 1) continue;
    const l = dx * 0.7 + dy * 0.7 + (d > 0.55 ? 0.25 : 0);
    g.g[y][x] = l < -0.25 ? tones[0] : l < 0.62 ? tones[1] : tones[2];
  }
  if (curls) {
    // a few hand-placed curl "C" marks along the shadow side and a sparkle on the lit side
    const marks = [[0.55, 0.15], [0.2, 0.6], [-0.45, 0.45], [0.6, -0.35]];
    for (const [mx, my] of marks) {
      const x = Math.round(cx + mx * rx * 0.75), y = Math.round(cy + my * ry * 0.75);
      if (rx < 3) continue;
      g.px(x, y, tones[2]); g.px(x + 1, y, tones[2]);
    }
    g.px(Math.round(cx - rx * 0.35), Math.round(cy - ry * 0.45), '6');
  }
}

function pom(lean = 0, flame = 0) {
  const g = new Grid(W, W);
  const L = lean; // -1 bank left, 1 bank right
  // --- rocket boosters on a pink harness (behind hips and mane) ---
  for (const s of [-1, 1]) {
    if (L && s === -L) continue; // far booster hides behind the body when banking
    const bx = s < 0 ? 4 + (L > 0 ? 1 : 0) : 25 - (L < 0 ? 1 : 0);
    g.rect(bx, 13, 3, 6, 'o'); g.rect(bx + 2, 13, 1, 6, 'p'); g.px(bx, 13, '6'); g.rect(bx, 12, 3, 1, 'p'); g.px(bx + 1, 14, 'l'); g.rect(bx, 18, 3, 1, 'q');
    // flame pointing down (thrust), 2 lengths
    const len = flame ? 5 : 3;
    g.rect(bx, 19, 3, len, 'g'); g.rect(bx, 19, 3, Math.max(1, len - 2), 'f'); g.px(bx + 1, 19, '6'); g.px(bx + 1, 20, '6');
    g.px(bx + 1, 19 + len, 'r'); if (flame) g.px(bx + 1, 20 + len, 'h');
    // harness strap to the waist
    const sx0 = s < 0 ? bx + 3 : 19, sx1 = s < 0 ? 13 : bx;
    g.rect(Math.min(sx0, sx1), 16, Math.abs(sx1 - sx0), 1, 'd');
  }
  const o = Math.round(L * 0.5);
  // --- shaved waist (pink skin), narrow and clearly visible ---
  g.ellipse(15.5 + L * 0.5, 16.8, 6.2, 3.6, '9');
  g.ellipse(15.5 + L * 0.5, 16.8, 5.4, 2.9, '8');
  g.rect(8 + o, 15, 16, 3, '9');
  g.ellipse(15.5 + L * 0.5, 16.6, 2.4, 3.4, '8');
  g.rect(14 + o, 14, 1, 3, '7');
  // thin harness band
  // --- tail stub + tail pompom ---
  g.rect(15, 5, 2, 3, '8'); g.px(15, 5, '7');
  ball(g, 15.5, 3.6, 3.2, 3.1);
  // --- hip pompoms ---
  ball(g, 10.8 + L * 0.5, 10.2, 4.4, 3.8);
  ball(g, 20.2 + L * 0.5, 10.2, 4.4, 3.8);
  // --- mane (widest, shorter so the head separates) ---
  ball(g, 15.5 + L, 21.2, 8.2, 3.7);
  // harness band drawn over the fur so it stays readable
  g.rect(9 + o, 16, 14, 1, 'd'); g.rect(13 + o, 15, 6, 1, 'e'); g.px(15 + o, 16, 'f'); g.px(16 + o, 16, 'f');
  // --- ears: long apricot drops that hang past the head on both sides ---
  for (const s2 of [-1, 1]) {
    const far = L && s2 === -L;
    const ex = 15.5 + L * 2 + s2 * (far ? 4.4 : 5.4);
    ball(g, ex + s2 * 0.4, 27.2, far ? 1.4 : 1.9, 3.9, { tones: ['7', '8', '9'], curls: false });
    g.px(Math.round(ex + s2 * 0.4), 29, '9');
  }
  // --- head ---
  const hx = 15.5 + L * 2;
  ball(g, hx, 27.8, 3.5, 3.4, { curls: false, rim: false });
  // topknot pompom + bow sitting where head meets mane
  ball(g, hx, 24.4, 2.6, 1.8, { curls: false, rim: false });
  const bx = Math.round(hx - 0.5);
  g.rect(bx - 2, 23, 2, 3, 'd'); g.rect(bx + 2, 23, 2, 3, 'd'); g.rect(bx, 23, 2, 2, 'e');
  g.px(bx - 2, 23, 'c'); g.px(bx + 2, 23, 'c'); g.px(bx + 3, 25, 'e');
  // face: open eyes with shine, muzzle, nose, smile
  g.px(bx - 2, 28, '0'); g.px(bx + 3, 28, '0'); g.px(bx - 2, 27, '1'); g.px(bx + 3, 27, '1');
  g.rect(bx - 1, 29, 4, 2, '6'); g.px(bx, 29, '0'); g.px(bx + 1, 29, '0'); g.px(bx, 30, 'd'); g.px(bx + 1, 30, 'd');
  g.outline('0');
  // trim anything that fell off the bottom row
  return g;
}

console.log(emitModule('POODLE', 'tools/art/gen-poodle.mjs', {
  poodle: [pom(0, 0), pom(0, 1)],
  poodle_left: [pom(-1, 0), pom(-1, 1)],
  poodle_right: [pom(1, 0), pom(1, 1)],
}));
