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
