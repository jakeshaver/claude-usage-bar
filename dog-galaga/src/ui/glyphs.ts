// 16x16 sector glyphs for the holographic star chart, packed 2 bits per pixel (0 empty, 1 main, 2 shade),
// 16 rows of 32 bits each, base64. Drawn pixel by pixel (no scaling); unknown ids fall back to the planet.
const G: Record<string, string> = {
  backyard: 'AAAAAAABQAAABVBQABVUUABVVRABVVVABVVVUBVVVVQBVVWAAaWlgAGlpYABVaWAAVWlgAFVpYAFVVVQAAAAAA==', // house with a door and a window
  street: 'AAAAAABVUAABqqQAAFVQAAAFAAAABQAAAAUAAAAFAAAABQAAAAUAAAAVQAAAAAAAVVVVVQoAoApVVVVVAAAAAA==', // street lamp over a road
  park: 'ABVUAAFVVUAFWVVQFWlVlBVVVVgWVVVYGlVZWAVVVaABZVWAABVUAAABQAAAAUAAAAVQAAAWlAAKqqqgAAAAAA==', // round tree
  alley: 'AAAAAAAFUAABVVVABVVVUAAAAAABVVVAAZlmQAGZZkABmWZAAZlmQAGZZkABmWZAAVVVQABVVQAKoAqgAAAAAA==', // trash can with lid
  rooftops: 'AAEAAAABAAAABUAAAAVAAAAVUAAAGZBUFRVQZBkZkFQVFVFUGRmRlBUVUVQZGZGUFRVRVBUWUVRVVVVVAAAAAA==', // skyline
  cafe: 'ABAQAABAQAAAEBAAAEBAAAAAAAAFVVUABqqpVAVVVQQFVVUEBVVVFAVVVlABVVYAAFVYACqqqqgKqqqgAAAAAA==', // steaming cup
  docks: 'AAVQAAAEEAAABVAAAAFAAABVVQAAAUAAAAFAAAABQAAAAUAAEAFABBQBQBQFAUBQAVFFQAAVVAAAAUAAAAAAAA==', // anchor
  factory: 'CgCgACqCqAAKAKAAAAFAAAABQAAAAUAAEAFAABQBRAQVAVQUFUVUVBVVVVQZmZmYFVVVVBWlWlQVpVpUAAAAAA==', // sawtooth factory with smokestack
  sky: 'AAAAAAAABAAAABQAAABVAAAgFAAAqBAAAqoAAAAFVAAAVVVAAVVVUBVVVVRVVVVVVVVVVSqqqqgAAAAAAAAAAA==', // cloud with a jet streak
  moon: 'ABVUAAFVVUAFaVVQFWlVWBVVVahVVVqqValaqlapWqpVpVqqVVVaqhVaWqgVWmqoBVVqoAFWqoAAKqgAAAAAAA==', // cratered moon
  nebula: 'AAAAAAAVVAABQAFABAVQEBAQBAQQQoEEQEghAUBIoQFAQgQBEBAEBBAFUBAEAABAAUAFAAAVUAAAAAAAAAAAAA==', // spiral swirl
  station: 'AAAAAAABAAAAAQAAAAVAAKgVUKiYGpCYmVmVZpgakJioFVCoAAVAAAABAAAABUAAABAQAAAAAAAAAAAAAAAAAA==', // satellite with panels
  mothership: 'AAAAAABAAQAAUAUAAFVVAAFlWUABVVVAFVVVVFVVVVVmZmZmFVVVVAKAAoAIIAggAAAAAAAAAAAAAAAAAAAAAA==', // cat-eared saucer
  planet: 'AAAAAAAVVAABVVVABVpVUKqqqqoVVVVYFVVVqKqqqqoVVpWoBVVWoAFVaoAAKqgAAAAAAAAAAAAAAAAAAAAAAA==',
};

const cache = new Map<string, HTMLCanvasElement>();
/** Draw the 16x16 sector glyph centered on (cx, cy). Cached per id+colors. */
export function glyph(ctx: CanvasRenderingContext2D, id: string, cx: number, cy: number, main: string, shade: string) {
  const key = id + main + shade; let cv = cache.get(key);
  if (!cv) {
    const bin = atob(G[id] ?? G.planet); cv = document.createElement('canvas'); cv.width = 16; cv.height = 16;
    const x = cv.getContext('2d')!;
    for (let yy = 0; yy < 16; yy++) for (let xx = 0; xx < 16; xx++) { const v = (bin.charCodeAt(yy * 4 + (xx >> 2)) >> (6 - 2 * (xx & 3))) & 3; if (v) { x.fillStyle = v === 1 ? main : shade; x.fillRect(xx, yy, 1, 1); } }
    cache.set(key, cv);
  }
  ctx.drawImage(cv, Math.round(cx) - 8, Math.round(cy) - 8);
}
