// Frame gallery for the 'player' showcase (?showcase=player&filter=gallery): every Pom frame at 2x on a neutral
// background (bank set, toot squash, stretch, white hit-flash, blink off-phase, nap breathing frames with Zzz,
// wingpup frames), each time-of-day lighting variant, and an in-context composite per time of day.
import type { Game, Module } from '../core/game';
import { W, H } from '../core/game';
import { spriteCanvas, drawSprite } from '../art/sprite';
import { text } from '../art/font';
import { col } from '../core/palette';
import { flame, scarfTail, shieldRing, shadowOval, ribbon, drawNapPose } from './draw';
import { POM_NOZZLES, POM_KNOT, PUP_NOZZLES } from './pom-art';

type Ctx = CanvasRenderingContext2D;

/** Sprite scaled by an integer factor, centred on (cx, cy) (nearest neighbour: smoothing is off on the canvas). */
function big(ctx: Ctx, name: string, cx: number, cy: number, s: number, frame = 0, flash = false) {
  const c = spriteCanvas(name, frame, flash); if (!c) return;
  ctx.drawImage(c, Math.round(cx - (c.width * s) / 2), Math.round(cy - (c.height * s) / 2), c.width * s, c.height * s);
}
/** Draw a 1x scene into an offscreen and blit it at 2x, so runtime decorations (flames, scarf) scale too. */
const tmp = typeof document !== 'undefined' ? document.createElement('canvas') : null;
function at2x(ctx: Ctx, cx: number, cy: number, w: number, h: number, draw: (c: Ctx) => void) {
  if (!tmp) return;   // the offscreen is the cell: anything drawn outside w x h (e.g. a rising Z) is clipped
  tmp.width = w; tmp.height = h;
  const c = tmp.getContext('2d')!; c.imageSmoothingEnabled = false; c.clearRect(0, 0, w, h);
  draw(c);
  ctx.drawImage(tmp, Math.round(cx - w), Math.round(cy - h), w * 2, h * 2);
}
function pomKit(c: Ctx, base: string, name: string, x: number, y: number, t: number, frame = 0, flen = 5) {
  for (const [ox, oy, w] of POM_NOZZLES[base] ?? []) if (w > 2) ribbon(c, [[x + ox, y + oy + 1 + flen], [x + ox, y + oy + 4 + flen], [x + ox, y + oy + 7 + flen], [x + ox, y + oy + 9 + flen], [x + ox, y + oy + 11 + flen]], 2, t);
  drawSprite(c, name, x, y, { frame });
  for (const [ox, oy, w] of POM_NOZZLES[base] ?? []) flame(c, x + ox - w / 2, y + oy + 1, w, w <= 2 ? flen - 2 : flen);
  const kn = POM_KNOT[base];
  if (kn) {
    // the idle hang (in play the tail streams opposite to her sideways motion, see Player.scarfPts);
    // bank frames show the tail blown away from the turn
    const dir = (base.includes('bank') ? 0.6 : base.includes('lean') ? 0.4 : 0.25) * kn[2];
    const pts: [number, number][] = [];
    for (let i = 0; i <= 10; i += 2) { const f = Math.sin(i * 0.6 - t * 0.28) * 1.4 * (i / 10); pts.push([x + kn[0] + dir * i + f, y + kn[1] + i * 0.9]); }
    scarfTail(c, pts);
  }
}
function label(ctx: Ctx, s: string, x: number, y: number) { text(ctx, s, x, y, col('5'), { align: 'center' }); }

export function galleryModule(): Module {
  let t = 0;
  return {
    id: 'player-gallery',
    update() { t++; },
    overlay(_g: Game, ctx: Ctx) {
      ctx.fillStyle = col('q'); ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = col('0'); ctx.fillRect(0, 0, W, 11);
      text(ctx, 'CAPTAIN POM - PLAYER FRAMES (2X)', 6, 2, col('f'));
      // row 1: flight frames with flames + scarf, toot squash, stretch, hit flash, blink off-phase
      const r1: [string, string, number][] = [['pom', 'POM', 0], ['pom', 'TOOT', 1], ['pom_lean_l', 'LEAN L', 0], ['pom_lean_r', 'LEAN R', 0],
        ['pom_bank_l', 'BANK L', 0], ['pom_bank_r', 'BANK R', 0], ['pom_stretch', 'STRETCH', 0]];
      r1.forEach(([n, lab, f], i) => {
        const cx = 40 + i * 72;
        at2x(ctx, cx, 54, 36, 34, c => pomKit(c, n, n, 18, 15, t, f, n === 'pom_lean_l' ? 7 : n === 'pom_bank_r' ? 3 : 5));
        label(ctx, lab, cx, 92);
      });
      big(ctx, 'pom!w', 40 + 7 * 72, 52, 2); label(ctx, 'HIT FLASH', 40 + 7 * 72, 92);
      // blink: off-phase is fully hidden (an empty dashed slot marks where she is)
      ctx.fillStyle = col('p'); for (let i = 0; i < 64; i += 4) { ctx.fillRect(40 + 8 * 72 - 32 + i, 20, 2, 1); ctx.fillRect(40 + 8 * 72 - 32 + i, 84, 2, 1); }
      label(ctx, 'BLINK OFF', 40 + 8 * 72, 92);
      // row 2: nap breathing frames with Zzz, then the wingpup frames (ear flap) with flames
      for (let i = 0; i < 3; i++) {
        const cx = 44 + i * 80;
        at2x(ctx, cx, 140, 40, 44, c => drawNapPose(c, 20, 30, [26, 38, 50][i], false));
        label(ctx, 'NAP ' + i, cx, 190);
      }
      const pups: [string, number, string][] = [['pom_pup', 0, 'PUP'], ['pom_pup', 1, 'PUP FLAP'], ['pom_pup_l', 0, 'PUP L'], ['pom_pup_r', 0, 'PUP R']];
      pups.forEach(([n, f, lab], i) => {
        const cx = 290 + i * 54;
        at2x(ctx, cx, 150, 16, 22, c => { drawSprite(c, n, 8, 8, { frame: f }); for (const [ox, oy, w] of PUP_NOZZLES[n] ?? []) flame(c, 8 + ox - w / 2, 8 + oy + 1, w, 4, t); });
        label(ctx, lab, cx, 190);
      });
      big(ctx, 'pom_pup', 290 + 4 * 54 + 20, 150, 3); label(ctx, 'PUP 3X', 290 + 4 * 54 + 20, 190);
      // row 3: time-of-day variants (2x) and in-context composites (1x: shadow, ribbon, shield, pup)
      const tods: [string, string, string][] = [['', 'DAY', 'j'], ['@dusk', 'DUSK', 'h'], ['@night', 'NIGHT', '1']];
      tods.forEach(([sfx, lab, bg], i) => {
        const cx = 40 + i * 72;
        ctx.fillStyle = col(bg); ctx.fillRect(cx - 34, 206, 68, 130);
        at2x(ctx, cx, 246, 36, 34, c => pomKit(c, 'pom', 'pom' + sfx, 18, 15, t));
        label(ctx, lab, cx, 342);
        // 1x composite below
        const x = cx - 4, y = 300;
        if (i < 2) shadowOval(ctx, x + (i === 1 ? 9 : 4), y + 19, i === 1 ? 22 : 20, 4, 'v'); else shadowOval(ctx, x + 2, y + 19, 14, 3, '0', true);
        pomKit(ctx, 'pom', 'pom' + sfx, x, y, t);
        drawSprite(ctx, 'pom_pup' + sfx, x + 20, y + 6, { frame: (t >> 3) & 1 });
        shieldRing(ctx, x, y + 1, 19, t);
      });
      // flame lengths: backing off / idle / climbing
      [3, 5, 7].forEach((len, i) => {
        const cx = 300 + i * 60;
        at2x(ctx, cx, 262, 36, 40, c => pomKit(c, 'pom', 'pom', 18, 15, t, 0, len));
        label(ctx, ['BACK', 'IDLE', 'CLIMB'][i], cx, 312);
      });
    },
  };
}
