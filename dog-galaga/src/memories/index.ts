import type { Game, Module } from '../core/game';
/** Memories: polaroids of Pom's human, carried by a glowing cat in specific waves. */
class Memories implements Module {
  id = 'memories';
  api = this;
  g!: Game;
  pending: string | null = null;
  init(g: Game) {
    this.g = g;
    g.bus.on('wave:start', (p: any) => {
      const m = this.placedAt(p.areaId, p.waveIndex);
      this.pending = m && !g.state.memories.includes(m.id) ? m.id : null;
      if (this.pending) g.mods.interaction?.markGlow();
    });
    g.bus.on('cat:boop', (p: any) => {
      if (p.glow && this.pending) { g.mods.interaction?.spawnPickup('memory:' + this.pending, p.x, p.y); this.pending = null; }
    });
  }
  placed(areaId: string) { return this.g.content.memories.filter(m => m.area === areaId); }
  placedAt(areaId: string, wave: number) { return this.g.content.memories.find(m => m.area === areaId && m.wave === wave); }
  collect(id: string) {
    const m = this.g.content.memories.find(x => x.id === id); if (!m) return;
    this.g.ops.addMemory(id);
    this.g.mods.ui?.toast('MEMORY FOUND: ' + m.title.toUpperCase());
    this.g.mods.audio?.sfx('memory');
  }
}
export const makeMemories = (): Module => new Memories();
