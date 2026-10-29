import { col } from '../core/palette';
// The POODLE PATROL logo: custom chunky 10x12 letterforms, rasterized once into a cached canvas with
// a bevel (outer top highlight, chrome horizon line, dark right edge), 3D extrusion, ink outline and a
// dithered neon glow. All colors are palette keys; every pixel is placed explicitly.
const GLYPHS: Record<string, string[]> = {
  P: ['########..', '#########.', '###...####', '###....###', '###....###', '###...####', '#########.', '########..', '###.......', '###.......', '###.......', '###.......'],
  O: ['..######..', '.########.', '####..####', '###....###', '###....###', '###....###', '###....###', '###....###', '###....###', '####..####', '.########.', '..######..'],
  D: ['#######...', '########..', '###..####.', '###...####', '###....###', '###....###', '###....###', '###....###', '###...####', '###..####.', '########..', '#######...'],
  L: ['###......', '###......', '###......', '###......', '###......', '###......', '###......', '###......', '###......', '###......', '#########', '#########'],
  E: ['#########', '#########', '###......', '###......', '###......', '#######..', '#######..', '###......', '###......', '###......', '#########', '#########'],
  A: ['..######..', '.########.', '####..####', '###....###', '###....###', '###....###', '##########', '##########', '###....###', '###....###', '###....###', '###....###'],
  T: ['##########', '##########', '...####...', '...####...', '...####...', '...####...', '...####...', '...####...', '...####...', '...####...', '...####...', '...####...'],
  R: ['########..', '#########.', '###...####', '###....###', '###....###', '###...####', '#########.', '########..', '###.####..', '###..####.', '###...####', '###....###'],
};
export interface Scheme { hi: string; light: string; mid: string; dark: string; ext: string; extLo: string; out: string; glow1: string; glow2: string }
export const PINK: Scheme = { hi: '6', light: 'c', mid: 'd', dark: 'e', ext: 'e', extLo: 'v', out: '0', glow1: 'v', glow2: 'e' };
export const CYAN: Scheme = { hi: 's', light: 'l', mid: 'm', dark: 'n', ext: 'n', extLo: '1', out: '0', glow1: '1', glow2: 'n' };
export const GOLD: Scheme = { hi: '7', light: 'f', mid: 'g', dark: 'h', ext: 'h', extLo: 'b', out: '0', glow1: 'v', glow2: 'h' };

export interface Logo { canvas: HTMLCanvasElement; w: number; h: number; pad: number; shine: Int16Array; shineN: number; shineColor: string }
const cache = new Map<string, Logo>();

/** Build (once) a logo word. s = pixel scale of the letterforms, depth = extrusion px, glow = glow radius (0..3). */
export function logoWord(word: string, s: number, sc: Scheme, depth = s + 1, glow = 3, gap = s + 1): Logo {
  const key = `${word}|${s}|${sc.light}|${depth}|${glow}|${gap}`;
  const hit = cache.get(key); if (hit) return hit;
  const letters = [...word].map(ch => GLYPHS[ch] ?? GLYPHS.O);
  const widths = letters.map(g => Math.max(...g.map(r => r.lastIndexOf('#') + 1)));
  const gh = 12 * s; const pad = glow + 2;
  const textW = widths.reduce((a, w) => a + w * s, 0) + gap * (letters.length - 1);
  const Wd = textW + pad * 2, Hd = gh + depth + pad * 2;
  const M = new Uint8Array(Wd * Hd);
  let ox = pad;
  letters.forEach((g, li) => {
    g.forEach((row, ry) => { for (let rx = 0; rx < row.length; rx++) if (row[rx] === '#') for (let yy = 0; yy < s; yy++) for (let xx = 0; xx < s; xx++) M[(pad + ry * s + yy) * Wd + ox + rx * s + xx] = 1; });
    ox += widths[li] * s + gap;
  });
  const at = (a: Uint8Array, x: number, y: number) => x >= 0 && y >= 0 && x < Wd && y < Hd ? a[y * Wd + x] : 0;
  // extrusion: pixels below the face within depth
  const S = new Uint8Array(Wd * Hd);
  for (let y = 0; y < Hd; y++) for (let x = 0; x < Wd; x++) {
    if (M[y * Wd + x]) { S[y * Wd + x] = 1; continue; }
    for (let k = 1; k <= depth; k++) if (at(M, x, y - k)) { S[y * Wd + x] = 2; break; }
  }
  // manhattan distance from the solid shape, up to glow + 1
  const D = new Uint8Array(Wd * Hd).fill(255);
  let frontier: number[] = [];
  for (let i = 0; i < S.length; i++) if (S[i]) { D[i] = 0; frontier.push(i); }
  for (let d = 1; d <= glow + 1; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % Wd, y = (i / Wd) | 0;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= Wd || ny >= Hd) continue; const j = ny * Wd + nx;
        if (D[j] === 255) { D[j] = d; next.push(j); }
      }
    }
    frontier = next;
  }
  // outside = background reachable from the border; enclosed counters get a flat ink fill, no glow
  const O = new Uint8Array(Wd * Hd); const st: number[] = [];
  for (let x = 0; x < Wd; x++) { st.push(x, (Hd - 1) * Wd + x); } for (let y = 0; y < Hd; y++) { st.push(y * Wd, y * Wd + Wd - 1); }
  while (st.length) { const i = st.pop()!; if (O[i] || S[i]) continue; O[i] = 1; const x = i % Wd, y = (i / Wd) | 0;
    if (x > 0) st.push(i - 1); if (x < Wd - 1) st.push(i + 1); if (y > 0) st.push(i - Wd); if (y < Hd - 1) st.push(i + Wd); }
  const cv = document.createElement('canvas'); cv.width = Wd; cv.height = Hd;
  const x2 = cv.getContext('2d')!;
  const put = (x: number, y: number, k: string) => { x2.fillStyle = col(k); x2.fillRect(x, y, 1, 1); };
  const horizon = pad + Math.floor(gh * 0.5);
  const shine: number[] = [];
  for (let y = 0; y < Hd; y++) for (let x = 0; x < Wd; x++) {
    const i = y * Wd + x; const d = D[i];
    if (S[i] === 1) {
      const f = (y - pad) / gh;
      let k = f < 0.5 ? sc.light : sc.mid;
      if (y === horizon) k = sc.dark;
      else if (f > 0.84) k = sc.light;
      if (!at(M, x + 1, y) || (!at(M, x, y + 1) && f < 0.84)) k = sc.dark;
      // bevel highlight only on outer top/left edges (never inside the counters of O, D, P, A, R)
      const outU = y > 0 && O[i - Wd] === 1, outL = x > 0 && O[i - 1] === 1;
      if (outU || (outL && f < 0.5)) k = sc.hi;
      put(x, y, k); shine.push(x, y);
    } else if (S[i] === 2) {
      put(x, y, at(S, x, y + 1) ? (at(S, x - 1, y) ? sc.ext : sc.dark) : sc.extLo);
    } else if (!O[i]) put(x, y, sc.out);
    else if (d === 1) put(x, y, sc.out);
    else if (d === 2 && glow >= 1) put(x, y, sc.glow1);
    else if (d === 3 && glow >= 2 && (x + y) % 2 === 0) put(x, y, sc.glow2);
    else if (d === 4 && glow >= 3 && x % 2 === 0 && y % 2 === 0) put(x, y, sc.glow2);
  }
  const L: Logo = { canvas: cv, w: Wd, h: Hd, pad, shine: Int16Array.from(shine), shineN: shine.length / 2, shineColor: col(sc.hi) };
  cache.set(key, L); return L;
}
/** Draw a logo word centered at cx with its face top at y. shinePos sweeps a diagonal highlight band. */
export function drawLogo(ctx: CanvasRenderingContext2D, L: Logo, cx: number, y: number, shinePos = -999, band = 5) {
  const x = Math.round(cx - L.w / 2), yy = Math.round(y - L.pad);
  ctx.drawImage(L.canvas, x, yy);
  if (shinePos < -50) return;
  ctx.fillStyle = L.shineColor;
  for (let i = 0; i < L.shineN; i++) {
    const px = L.shine[i * 2], py = L.shine[i * 2 + 1];
    const d = px + py * 0.5 - shinePos;
    if (d >= 0 && d < band && !(d >= band - 2 && (px + py) % 2)) ctx.fillRect(x + px, yy + py, 1, 1);
  }
}
