# Core requests from memories (round 3; round 2 items below still open)

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


## Round 3 additions

8. **ui (critic issue #6, please do)**: hold toasts while `g.mods.memories.revealing()` is true (don't age them, don't
   show new ones) and play them after the card leaves. Until then memories wraps `ui.toast` at runtime: calls made while
   a reveal card is up are queued (max 4) and replayed the tick the last card leaves. Exposing
   `holdToasts(on: boolean)` on ui (or checking `revealing()` in `toast()`/`update()`) makes memories skip the shim
   automatically (`typeof ui.holdToasts === 'function'`). memories pushes the card before `ops.addMemory`, so a quest
   reacting to `memory:get` already sees `revealing() === true`.

9. **ui (critic issue #11, not memories-specific)**: (a) the right panel truncates area subtitles to one line
   ("WHERE EVERY...", "THE DUCHESS HAS..."): wrap them to two lines or scroll them as a marquee; (b) the pause screen
   shows the "TAP OR PRESS A KEY FOR SOUND" toast stacked under the quest toast: suppress that toast while a menu is
   open (or drop it once any key has been pressed, since that press unlocks audio anyway).

10. **interaction (repeat of #2, now more visible)**: please delete the legacy `if (c.glow) { pxDither(...); pxRing(...) }`
    block (~line 586 of src/interaction/index.ts). The carrier look is now memories' 2px gold/orange silhouette rim with
    walking shimmer plus a pixel crown; memories still lowers `c.glow` for the carrier's own draw call to hide the old disc.
    Also expose `grounded()` as part of the public API (memories calls `g.mods.interaction.grounded?.()` to decide whether the
    falling polaroid casts a ground shadow; it falls back to true).

11. **ARCHITECTURE.md, memories line (replaces #6)**: "The memory carrier wears a 2px gold rim with walking shimmer and a
    pixel crown. Booping it pops a polaroid (8-ray star burst, shutter + music box) that drifts to Pom inside a warm dithered
    glow with a heart pin, drawn on render layer 5 (above projectiles). Catching it starts a ~2.2 s cozy beat: memories holds
    `g.paused`, the playfield dims one palette step through 25%/50% dither frames (50% max at night), the card slides in, and
    a fresh FIRE skips once the photo has mostly developed. Toasts and Pom's hearts burst wait until the card leaves."


## Round 4 additions

12. **ARCHITECTURE.md, memories line (replaces #11)**: "The memory carrier wears a 2px gold silhouette rim (drawn right
    after the cat, replacing interaction's dusk/night readability rim; solid gold at night) with walking shimmer, plus a
    pixel crown and the polaroid in its mouth drawn above all cats. Booping it is a beat: 4-tick hit-stop
    (`effects.hitStop`), a 2-frame white silhouette flash, then a 2px 8-ray star. The photo (14x16 card, 10x8 window with
    Maya in her pink shirt) sways down to Pom inside a 1px gold outline and a sparse dither glint (teal for a recovered
    photo). Catching it starts a ~2.2 s cozy beat (g.paused held, playfield dimmed one palette step, grass kept green);
    3+ photos at once (the final-sector backlog) become one 'N LOST MEMORIES' card with a fanned stack (~3 s,
    'TOOT TO CONTINUE'). Recovered photos get a periwinkle frame, a RECOVERED stamp, teal card trim and their own chime."

13. **showcase (optional)**: memories now also stages `stage=boop` (the carrier flash + star, tick 1) and
    `stage=bundle:N` (5 lost photos from #N caught at once) through the same `?showcase=memories&stage=` self-staging.

14. **interaction (repeat of #10)**: the legacy `if (c.glow) { pxDither(...); pxRing(...) }` disc is still drawn; memories
    keeps lowering `c.glow` for the carrier's own draw call. Removing it would let memories drop that render-time toggle.

## Integrator response (wave 2)
- 1 applied: showcase calls `memories.stage(k, n, at)` (no pickup any more), so `selfStage()` is now dormant and can be deleted.
- 2 / 10 / 14 applied: interaction's legacy `c.glow` halo block is gone; the render-time `c.glow` toggle can go too. `grounded()` is documented in ARCHITECTURE.
- 3 applied: vitest includes `src/**/*.test.ts` (11 memories tests run in verify).
- 4 declined for now: the drop cue stays in src/memories (it already follows the SFX slider); owner audio may move it as `memdrop` later.
- 5 superseded by 8. 8 applied: ui has `holdToasts(on)` and holds toasts by itself while `revealing()` in play/bonus (no ageing, held ones play when the card leaves), so your wrapper now skips itself.
- 6 / 11 / 12 applied: ARCHITECTURE memories line uses the round 4 wording.
- 7: owner journal.
- 9a forwarded to ui (subtitle wrap/marquee). 9b applied: the sound hint only appears on calm play/map screens with no menu open.
- 13 applied: stages listed in ARCHITECTURE section 9 and in the showcase comment.

## Polish 1

Fairness fix for the reveal card (whole-game critic issue #1). No core change is required; these are doc updates.

15. **ARCHITECTURE.md, memories line**: after "Catching it starts a ~2.2 s cozy beat (`g.paused` held, ..." add:
    "The card docks to the top edge of the playfield (y 4..68; y 22.. under the boss armor bar), so the field around
    Pom stays readable, and it waits for a calm moment: never over a sector title card, in the first 90 ticks of a
    wave, or while a boss is in `enter` / `tell` / `attack` / `phase` (the photo is in the album at once; play goes
    on until the card goes up)." And add `showing()` (card on screen) and `calm()` to the memories API list.
    `revealing()` is unchanged (true while a card is up or waiting), so ui keeps holding toasts for the whole span.
16. **ui (optional)**: if the ui toast hold should only cover the card while it is on screen, switch
    `toastsHeld()` from `memories.revealing()` to `memories.showing()`.
