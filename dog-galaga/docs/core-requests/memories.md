# Core requests from memories (round 1)

Context: the memories module now owns the whole memory loop (carrier look, drop, drift, reveal card, lost-memory
recovery). Public API is unchanged (`placed(areaId)`, `collect(id)`) plus: `offer(areaId, wave)`,
`missed(areaId, wave)`, `revealing()`, `stage(kind, index)`, and fields `drops` / `reveals`.
Art helpers in `src/memories/art.ts`: `photo(id)` (56x44 canvas), `polaroid(ctx, id, x, y, dev = 1, scale = 1)`.

1. **showcase (`src/showcase/index.ts`, case `'memories'`)**: replace the trailing
   `g.mods.interaction.spawnPickup('memory:' + m.id, 224, 200)` with
   `g.mods.memories.stage(p.get('stage') ?? 'drop', +(p.get('at') ?? 0))`.
   Stages: `carrier` (glowing cat with its polaroid), `drop` (polaroid drifting down), `reveal` (card),
   `lost` (LOST MEMORY card); `at=N` picks memory N (0..17). Until then memories self-stages from the URL
   (`?showcase=memories&stage=...&at=N`) once the showcase's pickup appears; that fallback can be deleted after.

2. **interaction (optional, nicer)**: in the completion check (`holding`, ~line 410) also wait for a photo
   still in the air: `|| (g.mods.memories?.drops?.length ?? 0) > 0`. Today memories makes an airborne photo
   swoop to Pom as soon as the cats are gone (and hands it over on area/scene change), so nothing is lost,
   but the wave clear banner can appear a beat before the photo lands.

3. **interaction (optional)**: the memory carrier halo is now drawn by memories (outer turning ring, rolling
   pulse, orbiting twinkles, rising gold motes, polaroid in the cat's mouth). The inner dithered disc + ring in
   interaction's cat draw (`if (c.glow) { pxDither(...); pxRing(...) }`, ~line 586) still sits under it and
   reads fine; keep it or drop it, both look right. The `memory:` branch of the pickup renderer / `collect` is
   now unused (memories converts any `memory:<id>` pickup into its own drifting polaroid).

4. **journal**: the memories tab can show the real photo: `import { polaroid } from '../memories/art'` and
   `polaroid(ctx, m.id, x, y, 1, 2)` draws a 128x124 polaroid (scale 2) of an unlocked memory.

5. **ARCHITECTURE.md, memories line**: add "a missed memory (napped, timed out, or on the sector route not
   taken) returns as a LOST MEMORY carried by the glowing cat of the next wave without a memory of its own;
   derived from content + state, no save data". Bot now ends every route with mem=18 (was 15).

6. **ui**: memories no longer calls `ui.toast('MEMORY FOUND ...')` (the reveal card replaces it). The card sits
   at y 30..100 of the playfield, so a toast at y 8 (e.g. the quest toast fired by `memory:get`) stacks above
   it without overlap. If toasts ever grow past two rows, `g.mods.memories.revealing()` says the card is up.
