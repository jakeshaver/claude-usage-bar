// Captain Pom's sprites (generated rows in pom-art.ts) plus time-of-day lighting variants built at load:
// dusk adds a warm 1px rim on the sunset (right) side, night swaps the white highlight for pale lavender
// and adds a cool moonlit rim on the top-left. Only fur tones are touched, so pods and bow stay readable.
import { defineSprites, type SpriteDef } from '../art/sprite';
import { POM_ART } from './pom-art';

const FUR = '6789a';
type Light = { map: Record<string, string>; rim: string; dirs: [number, number][] };
/** Pom's head starts at row 19: the night highlight swap stays off the head so her face keeps full contrast. */
const HEAD_ROW = 19;
export const LIGHTS: Record<string, Light> = {
  dusk: { map: {}, rim: 'g', dirs: [[1, 0]] },
  night: { map: { '6': '5' }, rim: 'm', dirs: [[-1, 0], [0, -1]] },
};

function relit(rows: string[], L: Light, mapRows = Infinity): string[] {
  const at = (x: number, y: number) => rows[y]?.[x] ?? '.';
  return rows.map((r, y) => [...r].map((ch, x) => {
    if (!FUR.includes(ch)) return ch;
    for (const [dx, dy] of L.dirs) if (at(x + dx, y + dy) === '0' && at(x + 2 * dx, y + 2 * dy) === '.') return L.rim;
    return y < mapRows ? L.map[ch] ?? ch : ch;
  }).join(''));
}

const defs: Record<string, SpriteDef> = { ...POM_ART, poodle_nap: POM_ART.pom_nap };
for (const [name, d] of Object.entries(POM_ART)) for (const [tod, L] of Object.entries(LIGHTS)) {
  const mr = name.startsWith('pom_pup') || name === 'pom_nap' ? Infinity : HEAD_ROW;
  defs[`${name}@${tod}`] = { rows: relit(d.rows, L, mr), frames: d.frames?.map(f => relit(f, L, mr)) };
}
defineSprites(defs);
