# Core requests from `world` (round 1)

## 1. [RESOLVED by integrator, round 1] `npm run verify` is red at baseline: typecheck of tools/*.ts (blocker, not caused by world)
`tsc --noEmit -p .` fails before any world change with
`tools/bot.ts` / `tools/lint-content.ts`: `Cannot find name 'node:fs' | 'node:path' | 'process'` (TS2591).
`tsconfig.json` has `"types": []` and `@types/node` is not installed (node_modules/@types only has `estree`).
Every other verify step passes on wave1/world (lint:content, bot, 7/7 tests, vite build).
Fix (pick one):
- add `"@types/node"` to devDependencies and a `tools/tsconfig.json` (extends root, `"types": ["node"]`, include `tools/*.ts`) and
  change the root `include` to `["src", "tests"]` plus `tsc -p tools` in `typecheck`; or
- simply set root `"types": ["node"]` once `@types/node` is installed.

## 2. [RESOLVED, round 1; world's AREA_TILESET workaround removed in round 2] content/areas.json: give the nebula its own tileset
`nebula` area uses `"tileset": "sky"`, but the schema enum already contains `nebula` and world now ships a dedicated
`nebula` tileset (dithered catnip gas clouds over a parallax starfield). Please change
`areas.json` -> `{ "id": "nebula", ..., "tileset": "nebula" }`.
Until then `src/world/bg.ts` maps area id `nebula` to the nebula tileset (`AREA_TILESET`); I will delete that map once content is updated.

## 3. ARCHITECTURE.md section 2 wording
"Time-of-day is a palette-safe overlay tint" is no longer accurate. Suggested text:
"Time of day is lighting, not a tint: each background segment is painted in day colours, then palette indices are
remapped through per-time-of-day ramps (`src/world/paint.ts`; ramps may ordered-dither two palette entries for
in-between tones; interiors, space and the sky tileset have their own ramps). Cast shadows change direction, length and
hue per time of day (cool at dawn, magenta at dusk); lamp pools, interior sunbeams and emissive windows/running lights
are applied in the same palette-exact pass. Backgrounds are 3 parallax layers (far / main / fg) of 448x256 segments,
painted once and cached in GPU-friendly canvases."

## 4. (optional) transitions above the HUD
World draws the paw-iris / dither-dissolve transition in its `overlay`, which runs before `ui`'s overlay, so the HUD side
panels stay visible during a transition. Looks fine (the iris is centred on the playfield), but if you want the transition to
cover the whole screen, add an optional `overlayTop?(g, ctx)` hook to `Module` called after all overlays, and world will move
the transition drawing there.

# Round 2

No new requests. Still optional: #4 (`overlayTop` hook so transitions can cover the HUD side panels).

# Round 3

## 5. (ui owner, verification only) `--touch=on` screenshot param does not show the touch controls
The critic's `--touch=on` play capture showed no on-screen controls: `tools/screenshot.mjs` forwards `?touch=on`, but
`src/ui/touch.ts` reads `settings.touch`. Please map the URL param to `state.settings.touch = 'on'` at boot (e.g. in
`core/boot.ts` next to the other `?area=/?tod=` params, or in ui init) so touch can be verified visually. Not a world defect.

## 6. ARCHITECTURE.md section 2 wording (update of request #3)
Replace "Time-of-day is a palette-safe overlay tint" with:
"Time of day is lighting, not a tint: segments are painted into a palette-index buffer in day colours, then remapped
through per-time-of-day ramps told apart by colour temperature (dawn: cool pale lift with pink-peach highlights and long
blue shadows; day: identity; dusk: amber/rust/rose mids and highs with purple kept in the shadows plus amber rim light on
west faces; night: blue, darker, lit windows and lamp pools). Ramps may ordered-dither two palette entries. Tilesets can
add a screen-fixed backdrop (sky gradient bands) and per-frame `fx` blits (conveyor belts, water swells). Layers are
far / main / fg 448x256 segments painted once (about 2-7 ms each) and cached as canvases; layers under an opaque layer are skipped."

# Round 4

## 7. (ui owner) Long sector names wrap into the WAVE label in the right HUD panel
In the cafe pause capture, `THE PURRFECT CUP CAFE` wraps over the `WAVE` label in the right side panel. Please clip or
ellipsize the sector name to the panel width (128px minus padding), or switch to a 2-line layout that pushes the WAVE
block down, in `src/ui/`. Not a world defect (world's own title card centres the name on the playfield and fits).

## 8. (content owner, verification only) time of day vs intro dialogue
World sets `state.tod = area.tod` on every `enterArea`, so the default time of day always comes from `content/areas.json`
(rooftops: night, docks: dawn, matching their intro lines). The mismatch the critic saw came from `--tod=` overrides in the
screenshot tool, not from the director. If the content owner wants different defaults, change `tod` in areas.json; no
world change is needed.

## 9. ARCHITECTURE.md section 2 wording (supersedes #3 and #6)
Replace "Time-of-day is a palette-safe overlay tint" with:
"Time of day is lighting, not a tint: segments are painted into a palette-index buffer in day colours, then remapped one
palette entry to one palette entry per material (no dither on large areas). Day is the brightest key; dawn is cool with
pink sky reflections, long lavender shadows cast down-left and peach rim light on the top edges of objects; dusk drops
lights one step, with long plum shadows to the east and amber rim light on west faces; night is navy/indigo about 30%
darker, with warm lit windows and small hard-edged sodium lamp cones (solid core + 2-step dither falloff, clippable to a
surface). Rare fast foreground flyers (birds, leaves, steam, cloud wisps, debris) are drawn per frame with the background."

## Integrator response
- 3 / 6 / 9: applied; ARCHITECTURE.md section 2 now describes time of day as lighting (round 4 wording).
- 4: declined for now; transitions under the HUD look fine, an `overlayTop` hook can come with a concrete need.
- 5: applied; `?touch=` is read at boot in main.ts.
- 7: already handled by ui (two reserved name lines + clipped subtitle in the right panel); verified on the cafe capture.
- 8: noted; intro lines were made tod-neutral anyway.
- Integrator seam fixes in world: boss defeat holds 140 ticks before the outro, nap banner uses ui `headline()`, banners/title cards hide while a ui menu is open.

## Polish 1

### P1-1 (showcase owner) world showcase: Pom shows up in some frames and not others
`src/showcase/index.ts` case `'world'` hides Pom with a one-off `g.mods.player.y = 999`, but the player module clamps /
eases her back into the playfield, so whether she is in the shot depends on how long the page ran before the capture
(the critic saw her missing in moon dawn/day/dusk but present at night; my own captures show the opposite mix). For
comparable review shots, please make it deterministic: either keep her out every frame (e.g. re-apply the offscreen
position in a per-step hook, or a `player.hidden = true` flag the player renderer honours), or always show her at her
spawn point (x224, y300). Not a world defect: the background is identical either way.

### P1-2 ARCHITECTURE.md section 2 wording (supersedes #9)
Replace the time-of-day paragraph with:
"Time of day is light, not a recolour: segments are painted into a palette-index buffer in day colours, then every
palette entry is lit by a coloured light (multiply + ambient in linear RGB, `paint.ts` `lightRamp`) and matched back to
the palette by hue-weighted OKLab distance, so each material keeps its hue family and only value and temperature move.
Where the lit colour falls between two entries, a 25/50/75% ordered dither of two neighbouring entries is used; a few
big ground materials are pinned per time of day (dewy lawn at dawn, olive lawn with amber tufts at dusk, blue-green lawn
at night). Dawn: cool slate neutrals, pink highlights, lavender shadows cast down-left, peach rim light; dusk: darker,
amber, plum shadows cast east, amber rim light on west faces; night: navy, warm windows and sodium lamp pools (solid core
+ 2-step dither falloff). Lamp pools never get cut by a segment edge: a pool from a world-spaced lamp spills into the
neighbouring segment, any other pool shrinks to fit. Interiors use their own lights (pale peach dawn, amber dusk, dim
night with day-coloured pendant pools); sky and space tilesets keep their own backdrops/ramps."

## Integrator response (polish 1)
- P1-1: `?showcase=world` now parks Pom offscreen and switches the player module off through core's isolation switch
  (`g.disabled` 'player' and 'player:overlay'), so she is absent from every world showcase frame.
- P1-2: ARCHITECTURE.md section 2 time-of-day paragraph replaced with your wording.
- Forwarded from interaction: check the 1px light line near y=140 in park/cafe night and moon (segment seam, the
  dissolve's `fillRect(0, edge - 1, W, 2)`, or the cafe-night floor rectangle's light outline).

## Polish 2

- ARCHITECTURE.md section 2, "Time of day is light, not a recolour": please replace that paragraph. The world no
  longer computes lit colours with OKLab matching or dithers between two entries across the playfield. New text:
  "**Time of day is a palette remap**: segments are painted into a palette-index buffer in day colours, then each
  time of day applies a hand-authored palette index -> palette index table (`world/paint.ts` `TOD_RAMP`,
  `INDOOR_RAMP`, `SPACE_RAMP`, plus per-tileset `ramps` in `world/tiles.ts`) when the segment is cached. Every pixel
  maps to exactly one entry, so there is no global dither and the band behind the formation stays flat and calm.
  Day is brightest and most neutral; dawn is a little lower and cool (slate neutrals, whites to pale lavender,
  creams/yellows to peach-pink, dew-teal grass tips); dusk is lower and warm (woods a step deeper, greys into plum,
  amber grass tips, amber rim light on west faces, long plum shadows cast east); night is navy with lit windows and
  lamps. Dither is only used for small local light: lamp pools are centred on their source with a solid core that
  BRIGHTENS the pixels (day colours, not a tint) and an ordered falloff (50% core/edge, solid edge, 50% and 25%
  edge/dark rings); sunbeam and rim edges. Foreground canopies (`fg`) stay within ~36px of the world edges."

### Polish 2, round 2 (supersedes the round 1 text above)

- ARCHITECTURE.md section 2, time-of-day paragraph: please use this text instead of the round 1 request.
  "**Time of day is a palette remap**: segments are painted into a palette-index buffer in day colours, then each
  time of day applies a hand-authored palette index -> palette index table (`world/paint.ts` `TOD_RAMP`,
  `INDOOR_RAMP`, `SPACE_RAMP`, plus per-tileset `ramps` in `world/tiles.ts`) when the segment is cached. A large
  material can map to a fixed 50% mix of two entries of nearly equal lightness (for example dark green + dark brown
  for the olive dusk lawn, or dark green + plum for the night lawn), which reads as one in-between colour, so every
  material keeps its hue and at least two value steps at every hour. Day is brightest and most neutral; dawn is
  cooler and a little lower (grey-green lawns, slate stone, peach-pink highlights and top edges); dusk is warm and
  15-20% lower (olive lawns with ochre/orange tips, warm taupe stone, deeper woods, plum shadows cast long to the
  east); night is dark but keeps material hues (teal-green grass, brown wood, slate stone, blue water) with lit
  windows, lanterns and lamps. Lamp pools are centred under a visible lamp head, clipped to the floor they light,
  and brighten the pixels toward sodium cream (solid core, ordered falloff rings). All background layers, fg
  included, are drawn in the world's z -10 pass, so scenery never covers Pom."

## Integrator response (polish 2)

- Done: ARCHITECTURE.md section 2 time-of-day paragraph replaced with the round 2 text (palette remap, 50% two-entry
  material mixes, per-hour character, lamp pools under a visible head, all layers incl. fg in the z -10 pass).
- Verified: npm run verify green after the merge; title / map / docks autopilot / memories / ending shots have zero
  console, page or game errors.

## Polish 3

- ARCHITECTURE.md section 2, time-of-day paragraph: please replace the sentence "A large material can map to a fixed
  50% mix of two entries of nearly equal lightness (for example dark green + dark brown for the olive dusk lawn, or
  dark green + plum for the night lawn), which reads as one in-between colour, so every material keeps its hue and at
  least two value steps at every hour." with: "Every time-of-day table maps each palette index to exactly ONE palette
  index (`remap()` in `world/paint.ts` refuses two-entry mixes), so no pixel of the playfield is a two-colour
  checkerboard at any hour; dither is only allowed for small local light falloff (lamp pool rings, beam edges).
  `src/world/tools/checker-share.mjs` measures the strict 1px checker share for all 13 areas x 4 times of day
  against a running preview (target < 5%)." Also: "shadows cast onto a lower parallax layer are one solid deep tone".
