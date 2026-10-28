# Core requests from `interaction` (builder round 1)

1. **Typecheck is red at baseline (not caused by interaction).** `tsconfig.json` sets `"types": []` and includes
   `tools/*.ts`, but `tools/bot.ts` and `tools/lint-content.ts` use `node:fs`, `node:path` and `process`, and
   `@types/node` is not installed in the shared `node_modules`. `npm run typecheck` therefore fails with TS2591 on
   tools/ only (src/ and tests/ are clean). Fix: add `@types/node` to devDependencies and `"types": ["node"]`
   (or give tools/ its own tsconfig), so `npm run verify` can be green end to end.
2. **Audio sfx ids** used by interaction that `audio.sfx()` does not know yet (they are silently ignored today):
   - `hack`: a cat coughs a hairball (short, soft "hk!" noise burst; fires often, keep it quiet).
   - `blip` is used as the boss wind-up tell; a dedicated `tell` sound (rising two-note chirp, ~0.3s) would read better.
3. **New event** `boss:phase` `{bossId, phase}` (phase 1 or 2) is emitted when a Big Cat passes 2/3 and 1/3 hp.
   Please add it (and the existing `boss:hp` `{hp, max}`) to the events table in ARCHITECTURE.md. Optional: ui could
   flash the boss bar / audio could speed up the boss track on `boss:phase`.
4. **Remaining anti-aliased primitives outside interaction** (the quality bar bans ctx.arc/strokes):
   - `src/player/index.ts` shield bubble: `ctx.arc` + `ctx.stroke`.
   - `src/effects/index.ts` `ring` particles: `ctx.arc` + `ctx.stroke` with alpha.
   `src/interaction/pixel.ts` exports `pxRing`, `pxDisc`, `pxDither`, `pxShadow`, `pxDash`, `pxSpark` (integer
   fillRect only, palette keys); those modules are welcome to import them, or the integrator can move the file to
   `src/core/` or `src/art/` as a shared helper.
5. **Autopilot hint (player module, optional):** `interaction.threats()` now returns `{x, y, vx, vy, st}` for every
   threat, including diving cats (real velocities) and a charging boss (`st: 'charge'`, three points across its
   width, plus `st: 'lane'` points during the charge telegraph). The autopilot already uses vx/vy, so nothing is
   required; weighting `st === 'lane'` higher would make the bot step out of a telegraphed charge earlier.
6. **Bot coverage race (ui + tools, pre-existing).** `ui.autopilotNav()` auto-picks a map exit whenever
   `ui.t % 30 === 0`, and it runs in the same tick in which world's fade sets `scene = 'map'`, before
   `tools/bot-core.ts` gets to choose. When that 1-in-30 timing hits, the bot never records the choice, so a branch
   is silently skipped (with this round's new combat timing, seed 1337 now reports `paths: 7` instead of 8:
   `street > alley > rooftops > cafe > factory > sky > moon` is the one lost, still `allReachEnding: true`).
   Fix: have bot-core set a flag that disables `ui.autopilotNav` map picks (e.g. `g.mods.ui.botDrivesMap = true`),
   or have autopilotNav wait ~20 ticks after the map scene opens.

# Core requests from `interaction` (builder round 2)

1. **`pxShadow` in `src/core/pixel.ts` still uses `ctx.globalAlpha`** (breaks the fixed palette: muddy tints that change
   with the floor). Interaction no longer calls it (it uses its own `ditherShadow` in `src/interaction/art.ts`, a 50%
   checkerboard of ink `0`). Please switch `pxShadow` to the same checkerboard (or re-export `ditherShadow` from core)
   for any other caller.
2. **`effects.flash(color, ticks)` takes a raw CSS colour.** Interaction now passes `col('f')` (palette-derived). Nicer:
   let `flash` accept a palette key (`'f'`) and resolve it with `col()` inside effects.
3. **Bigger Big Cats (art).** Boss sprites are 64x64 canvases but the drawn cat fills only ~48-52px. Interaction now
   adds a per-tier craft around them (tier 1 hover jets for alley..factory, tier 2 saucer for sky..station, tier 3 a
   winged throne for the Empress: see `bossRig` in `src/interaction/art.ts`), a playfield HP bar, bandage/sweat damage
   marks and a 1px hit recoil. What only art can do: redraw `boss_*` so the cat fills 64-72px of its canvas (Empress
   80px, needs an 80x80 canvas; interaction centers by canvas size so nothing else changes), and give every boss 3 idle
   frames (interaction already cycles `frameCount(sprite)` frames). Keep each boss's face roughly centered in the upper
   half: interaction draws bandages at (+17,-19) and (-22,+9) from the sprite center.
4. **Showcase stages (showcase + tools).** `?showcase=interaction&stage=<name>` is handled inside interaction (it reads
   `location.search` in `init` as a fallback): stages `capturer | rescue | splitter | tank | dive | tell | boss | bullets
   | play` (default `play` = autopilot flies and shoots), `&at=<ticks>` overrides the freeze tick, `&phase=1|2` stages a
   bruised boss. Please (a) call `g.mods.interaction.stage(p.get('stage') ?? 'play')` explicitly from the `interaction`
   showcase case after the wave starts, and (b) add `stage`, `at`, `phase` to the forwarded keys in
   `tools/screenshot.mjs` (today they only work through `--url=http://127.0.0.1:4206/?stage=tank`).
5. **Content mismatch (quest/content, from the critic):** the docks intro dialogue says "FISH MARKET DOCKS AT DAWN" even
   when `tod=dusk`. Either drop the time of day from the line or add per-tod variants with `when` conditions.
6. **Formation size in `content/waves.json` (optional):** interaction now caps every formation at 8 columns x 5 rows
   (38px columns, 34-36px rows) and drops columns >= 8, so the 10-column waves (cafe onward) lose columns 8-9. Content
   could be re-authored to 8 columns so the data matches what is flown.
7. **Audio (optional):** the capturer's tractor beam plays `blip`; a dedicated `beam` sfx (a soft rising warble, ~1.4s)
   would sell the Galaga capture moment.
