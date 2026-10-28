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
