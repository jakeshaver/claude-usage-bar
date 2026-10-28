import { W, H, PF_X, PF_W, type Game, type Renderer } from './game';

interface Cmd { layer: number; y: number; seq: number; fn: (ctx: CanvasRenderingContext2D) => void }

/** Canvas renderer: integer scaling, nearest-neighbor, y-sorted playfield batch. */
export class CanvasRenderer implements Renderer {
  canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; scale = 1;
  private q: Cmd[] = []; private seq = 0;
  frames = 0; fpsValue = 60; private fpsT = 0; private fpsN = 0;
  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.canvas.id = 'game';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    this.ctx.imageSmoothingEnabled = false;
    addEventListener('resize', () => this.fit()); this.fit();
  }
  fit() {
    const s = Math.max(1, Math.floor(Math.min(innerWidth / W, innerHeight / H)));
    this.scale = s;
    this.canvas.style.width = W * s + 'px'; this.canvas.style.height = H * s + 'px';
  }
  push(layer: number, y: number, fn: (ctx: CanvasRenderingContext2D) => void) {
    this.q.push({ layer, y, seq: this.seq++, fn });
  }
  frame(g: Game, now: number) {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0b0a14'; ctx.fillRect(0, 0, W, H);
    this.q.length = 0; this.seq = 0;
    for (const m of g.modules) if (m.render) g.safe(m.id, () => m.render!(g, this));
    this.q.sort((a, b) => a.layer - b.layer || a.y - b.y || a.seq - b.seq);
    const camX = Math.round(g.mods.player?.camera?.x ?? 0);
    const shake = g.mods.effects?.shakeOffset?.() ?? { x: 0, y: 0 };
    ctx.save();
    ctx.beginPath(); ctx.rect(PF_X, 0, PF_W, H); ctx.clip();
    ctx.translate(PF_X - camX + Math.round(shake.x), Math.round(shake.y));
    for (const c of this.q) { try { c.fn(ctx); } catch (e) { g.reportError('render', e); } }
    ctx.restore();
    for (const m of g.modules) if (m.overlay) g.safe(m.id + ':overlay', () => m.overlay!(g, ctx));
    // fps
    this.fpsN++; if (now - this.fpsT >= 1000) { this.fpsValue = this.fpsN * 1000 / (now - this.fpsT || 1); this.fpsN = 0; this.fpsT = now; }
  }
}
