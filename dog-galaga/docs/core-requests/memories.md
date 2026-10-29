# Core requests from memories (round 2)

Context: memories owns the whole memory loop (carrier look, drop, drift, reveal card, lost-memory recovery).
Public API unchanged (`placed(areaId)`, `collect(id)`) plus `offer(areaId, wave)`, `missed(areaId, wave)`,
`revealing()`, `stage(kind, index, at)`, fields `pending` / `drops` / `reveals` / `holding`.
Art helpers in `src/memories/art.ts`: `photo(id, blink?)` (56x44 canvas),
`polaroid(ctx, id, x, y, dev = 1, scale = 1, blink = false)`.

1. **showcase (`src/showcase/index.ts`, case `'memories'`)** (still open from round 1, now with a new signature):
   replace the trailing `g.mods.interaction.spawnPickup('memory:' + m.id, 224, 200)` with
   ```ts
   const [k, n] = (p.get('stage') ?? 'carrier').split(':');
   g.mods.memories.stage(k, +(n ?? p.get('phase') ?? 0) || 0, p.get('at') !== null ? +p.get('at')! : -1);
   ```
   Stages: `carrier` (default), `drop`, `reveal`, `lost`. Memory index = `stage=reveal:5` or `--phase=5`;
   `--at=T` = ticks into the moment (defaults carrier 40, drop 88, reveal/lost 80 = photo developed).
   Every stage now FREEZES on its key frame (g.paused), so the default `--wait=1200` captures it.
   Until then memories self-stages from the URL once the showcase's pickup appears (same parameters).

2. **interaction (please do, issue #1 of the critic)**: remove the legacy glow halo in the cat draw
   (`if (c.glow) { pxDither(ctx, x, y, 17, 'f', ...); pxRing(ctx, x, y, 18, ...) }`, ~line 586). memories now
   draws the carrier's halo, silhouette rim and held polaroid. Until it is removed, memories lowers `c.glow` for
   the duration of that one cat's draw call (render-time only, raised again right after), which hides the disc;
   that workaround becomes a no-op once the block is gone. The `memory:` branch of the pickup renderer /
   `collect` stays unused (memories removes any `memory:<id>` pickup from `pickups` and drops its own polaroid).

3. **vitest config (`vite.config.ts`)**: add `'src/**/*.test.ts'` to `test.include` so
   `src/memories/memories.test.ts` runs in `npm test` (missed/offer across branch skips, the final-sector
   bundle, the reveal freeze releasing on scene change, an alley/docks/nebula bot route reaching 18/18).
   Or move the file to `tests/memories.test.ts` and fix its two relative imports (`../src/core/boot`,
   `../tools/bot-core`). It passes today with a config that includes it (8 tests, ~1.5 s).

4. **audio (optional)**: the drop cue is now its own sound (shutter click + rising music-box arpeggio,
   `src/memories/sound.ts`), played through `audio.kit` into `audio.mix.sfx` so it follows the SFX slider. If
   you prefer every cue in the audio module, move that recipe into `sfx.ts` as `memdrop` (SFX_LEN ~0.9) and
   memories will call `sfx('memdrop')`.

5. **ui (optional)**: the reveal card is now centred in the playfield (y 141..211) during a cozy freeze, far below
   the toast stack, so no overlap today. If toasts ever stack past ~7 rows, hold them while
   `g.mods.memories.revealing()`.

6. **ARCHITECTURE.md, memories line**: "Catching a polaroid starts a ~2.4 s cozy beat: memories holds
   `g.paused` (playfield dimmed one step, cats go 'aww', reveal card slides in from the left; a fresh FIRE skips
   after the photo develops) and always releases it on scene change; the pause menu still works on top. A missed
   memory (its sector was on the route not taken) returns as a LOST MEMORY carried by the glowing cat of the next
   wave without a memory of its own; in the final sector the first carrier brings the whole backlog as a bundle,
   so 18/18 is reachable on every route. Derived from content + state, no save data."

7. **journal**: `polaroid(ctx, m.id, x, y, 1, 2)` still draws a 128x124 polaroid (now with a solid 1px shadow);
   pass `blink = (t % 120) > 112` as the 7th argument for the same little idle the reveal card has.
