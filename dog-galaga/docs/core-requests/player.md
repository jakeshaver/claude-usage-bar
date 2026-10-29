# Player module: requests to the integrator

## Round 1 (wave2/player)

1. **core/input.ts: analog stick values (nice to have).** Gamepad sticks are currently thresholded to digital
   actions at 0.35. Please expose the raw, dead-zoned stick as `input.axis: { x: number; y: number }` (-1..1,
   dead zone 0.2, 0 when no pad / keyboard / touch), filled in `poll()`. The player would then scale its
   acceleration target by `|axis|` for fine steering. Digital `held('left')` etc. must stay as they are
   (the autopilot, touch and keyboard use them).

2. **Module order (keep as is, documentation only).** `player.overlay()` draws Pom's nap pose and the
   floating Zzz *above* the world's nap dim (`world.overlay`), so she reads "spotlit" in the darkened field.
   This relies on `player` coming after `world` in `core/boot.ts` (it does today). Please keep that order,
   and mention it in ARCHITECTURE.md section 4 (player API: `overlay` draws the nap pose).

3. **ARCHITECTURE.md, player API line (documentation only).** Suggested wording:
   `player: pos(), respawn(), setInvuln(ticks), camera: {x} (float; render rounds it), hitbox(), power(kind, ticks),
   buddy (wingpup flag), pupX/pupY (wingpup position, lags Pom by ~9 ticks), overlay (nap pose above the nap dim)`.
   New sprite `poodle_nap` (32x24, 2 breathing frames) is registered by `src/player/sprites.ts`.

## Round 2 (wave2/player)

1. **Adopt the new Captain Pom art everywhere (art/ui/journal owners).** The player module now draws Pom from its
   own generated sprites (`src/player/pom-art.ts`, generator `src/player/art/gen-pom.mjs`): `pom`,
   `pom_lean_l/r` (|bank| 0.35-0.75), `pom_bank_l/r` (full bank), `pom_stretch` (wake-up yawn), `pom_nap`
   (top-down curl, 2 breathing frames), and the wingman `pom_pup`, `pom_pup_l/r`. Each Pom sprite has 2 frames
   (frame 1 = tail pompom squashed by a toot) and `@dusk` / `@night` lighting variants. The old
   `poodle`, `poodle_left`, `poodle_right` in `src/art/sprites/poodle.ts` still have the misread silhouette
   (tail pompom reads as a head) and are still used by `ui` (title screen line 737, dialogue fallback 605/998)
   and `journal` (line 52). Please either point those calls at `pom`, or replace the three entries in
   `src/art/sprites/poodle.ts` with aliases: `poodle: POM_ART.pom, poodle_left: POM_ART.pom_bank_l,
   poodle_right: POM_ART.pom_bank_r` (import from `../../player/pom-art`), and retire `tools/art/gen-poodle.mjs`.
   The `pup` prop can stay as the caged-pup pickup, but the HUD wingman icon (`ui` 375/441) would match better
   as `pom_pup`.
2. **ARCHITECTURE.md, player API line (documentation).** Suggested wording:
   `player: pos(), respawn(), setInvuln(ticks), camera: {x} (float; render rounds it), hitbox() (10x10 around
   the mane), power(kind, ticks), buddy, pupX/pupY (wingpup, lags ~9 ticks), overlay (nap pose above the nap
   dim), wakeT (ticks left of the post-nap wake-up; no control meanwhile)`. Add: "Hitbox marker rule: the dot is
   shown while a threat is within 44x52 px of Pom and during the whole invulnerability window (it stays visible
   while she blinks); it is hidden during the wake-up and the white hit-flash." `poodle_nap` is kept as an alias
   of `pom_nap`.
3. **Respawn after a nap (behaviour note, no change needed).** `respawn()` called while Pom is napping now plays
   a 31-tick wake-up (stretch + yawn in place, drop below the screen, eased fly-in to (224, 316), camera eased)
   before control returns; invulnerability covers it. A non-nap `respawn()` (area entry) still places her at
   once and now also snaps the camera, so there is no 32px slide after entering an area.
