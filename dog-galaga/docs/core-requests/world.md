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
