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

# Core requests from `interaction` (builder round 3)

1. **Input drops quick taps (core/input.ts, critic #7).** `keydown` adds to `kb` and `keyup` deletes it before the 60Hz
   `poll()` runs, so a press shorter than one frame (Playwright `keyboard.press`, fast real taps) is never seen: pause
   does not open, fire/confirm taps are lost. Fix: keep a `latched = new Set<Action>()`; `keydown` adds to both `kb` and
   `latched`; `poll()` builds `down` from `kb ∪ latched ∪ touch ∪ synthetic`; `endFrame()` clears `latched` after copying
   `down` into `prev`. (Same for `fire` -> `confirm`.)
2. **Screenshot tool allow-list (tools/screenshot.mjs, critic #11, repeat of round 2 #4b).** Add `stage`, `at`, `phase` to
   the forwarded keys on line 16 so `--showcase=interaction --stage=capturer|rescue|splitter|tank|dive|tell|boss|bullets
   [--at=N] [--phase=1|2]` works without a hand-written `--url=...?stage=`.
3. **HUD boss bar flash (ui, critic #3).** Interaction removed its on-field boss HP bar (it overlapped the boss and the
   charge lane and duplicated the HUD). Please flash the HUD "BIG CAT" bar white for ~6 ticks on `boss:hp`, and pulse it
   on `boss:phase`.
4. **Scottish Fold capturer art (art, critic #8).** `cat_scottishfold` reads as a grey robot/skull with a pink tongue.
   It needs folded ears (small flaps folded forward and down, flush with the head top), a rounder owl-like face, and a
   pink nose/mouth instead of the big tongue blob.
5. **World prop that looks like a bullet (world, critic #1).** `src/world/tiles.ts` lines 282 and 333 draw a red disc with a
   pink highlight and ink outline (buoy / button prop, 7-9px). At 1x it reads exactly like an enemy bullet on docks and
   street. Enemy bullets are now hot pink / cyan with a pulsing white halo, but please recolor that prop out of the
   red-pink family (e.g. a teal or white/orange striped buoy) or add a visible stem/rope so it reads as a prop.
6. **Warm lamp glows behind the boss home (world, critic #6).** The orange dithered light pools (factory, alley, rooftops)
   sit where Big Cats hover. Interaction now draws a dark arena oval behind the boss at its home band, but if world could
   keep light pools out of y 20..140 on boss stages (or tint them cool), bosses would separate even better.
7. **Toast merge (ui, critic #10).** Interaction now merges repeated pickup toasts itself by editing `ui.toasts` in place
   (`{text, t}` entries; it adds an `n` counter and rewrites text to `NAME X3`). A first-class `ui.toast(text, {merge:true})`
   would be cleaner; until then please keep the `toasts: {text, t}[]` shape.

# Core requests from `interaction` (builder round 4)

1. **Captain Pom readability (art/player, critic #5).** `pom` reads as a white/grey blob at 1x and is lost among turd
   sparks on bright grass. Needs a clear rear-view poodle silhouette (big rear pom-pom, two floppy ears, wings), a 1px
   ink outline like the cats, and darker mid-tones (lavender/grey shading) for value contrast against grass. The 4
   white puffs on top look like particles: merge them into the silhouette or tint them.
2. **Tank cat art (art, critic #8).** `cat_persian` / `cat_mainecoon` "helmet" cats read as skulls. Please make the
   ears visible through (or poking out of) the dome and drop the big pink tongue. Interaction now makes the hit
   feedback a blinking solid white silhouette (10 ticks) followed by a short red rim.
3. **Pause hides banners (ui/world, critic #10a).** While paused, skip the `WAVE n` / sector banners and title cards
   so they do not bleed through the pause dither.
4. **Docks dialogue (quest/content, critic #10b, repeat).** "FISH MARKET DOCKS AT DAWN" is shown at dusk.
5. **Flight Time separator (ui, critic #10c).** Keep the colon static (stills show `00 16`).
6. **Stray cyan line in factory (world, critic #10d)** around world y=162, x 284..356 (a 1px horizontal cyan run).
   Interaction draws no 1px cyan lines any more (the pup tether is now a stepped beam), so it is a world/effects draw.
7. **Post-nap / intro gaps (world, critic #3).** After a nap the field is empty for 150 ticks, and at area entry the
   first wave starts after the 150-tick intro. Interaction now spawns the first cats within ~10-20 ticks of
   `startWave`. Consider showing `WAVE n` during the nap restart and cutting the nap timer to ~100 ticks.
8. **Content (optional):** interaction now lays waves out with its own per-sector shapes (src/interaction/formation.ts:
   tapered Galaga block, chevron, split wings, diamond, staggered checker, arrow) at 32x31px cells, ~65% of the view
   wide. Content's row order still picks breeds (capturers lead), but the 10-column rows are no longer flown as-is;
   cats beyond a shape's capacity are left out.

## Integrator response
- R1-2/R2-7: `tell` is now played at `beginTell()` (boss.ts); there is no `beam` sfx id yet, audio owner to add one before the call site changes.
- R1-3: applied; `boss:hp` and `boss:phase` are in the ARCHITECTURE.md events table.
- R1-5: player owner, optional; not applied.
- R2-1: applied; `pxShadow` is a palette-exact 50% ink checkerboard.
- R2-2: done by effects (palette keys); callers updated (`boss.ts flash('f')`, `player flash('r')`).
- R2-3, R3-4, R4-1, R4-2: art owner (redraws in progress); not core.
- R2-4/R3-2: applied; the showcase sets `stageReq/stageAt/stagePhase` explicitly and the screenshot tool forwards `stage`, `at`, `phase`. Added stage `lineup`.
- R2-5/R4-4: applied; the docks (and rooftops) intro lines no longer name a time of day.
- R2-6/R4-8: declined; interaction lays out its own per-sector shapes, so content keeps row order as the breed priority and is not re-authored.
- R3-1: applied; `core/input.ts` latches taps shorter than a frame and no longer allocates per tick.
- R3-3: ui owner (HUD bar flash on `boss:hp`/`boss:phase`); not applied.
- R3-5, R3-6, R4-6: world owner (prop recolour, lamp pools, stray cyan line); not core.
- R3-7: shape `toasts: {text, t, age, y}[]` kept; `ui.muteToasts(on)` added, a merge option is ui's call.
- R4-3: applied (seam fix in world overlay): title cards and wave/sector banners are hidden while a ui menu is open.
- R4-5: ui owner; not applied.
- R4-7: declined; nap/intro pacing is a world design call (the defeat hold was lengthened instead, see effects).
- Integrator seam fixes in interaction: entry streams now never start two cats in the same lane within one stream step (stacked cats at stream joins), boss bullets spawn at the sprite's edge (~28 px from centre) instead of on top of the boss, and a boss defeat clears its GRUMPY toast and floats the bounty.
- Formation slots measured headless across all 100 waves: settled homes are never closer than 31 px (no overlap); the remaining momentary overlaps are designed stream crossings (split/swirl), left as is.

## Polish 1

- **#8 (1px light line near y=140 in park-night, cafe-night, moon): not interaction.** Interaction draws no
  full-width horizontal lines at all: the boss charge telegraph is a vertical lane (dither + two vertical dashed rails +
  chevrons, only during a charge tell), sweeps/fans are short diagonal dashes from the boss, and the staged dive path
  is showcase-only. Autopilot shots of park/cafe/moon at night (advance 600..1500) showed no line from this module.
  Suggest the world owner check the scrolling segment seam (448x256 segments, far/main/fg layers) and the area
  transition dissolve's teal scan edge (`world/index.ts` `dissolve`, `fillRect(0, edge - 1, W, 2)`).
- **#10 (busy screens), parts outside interaction:** please have effects keep the boop float text clear of the
  memories carrier crown/rim (memories draws the gold rim, crown and polaroid; interaction now leaves the TOD rim off
  memory carriers and on bright floors, and no longer stacks two pickup badges on one spot). Effects' dotted heart
  ring around a combo number is a further stacked treatment worth thinning.

### Polish 1, round 2

- **UI (critic #6, toasts over the formation):** interaction moved the formation's top row down to y=46 (world), with
  the grid now at most 4 flat rows (bottom row about y 150-160). One toast (y 8..22) now clears the top row, but a stack
  of 2-4 toasts (8 + i*17) still covers it. Please, while `g.mods.interaction.mode === 'wave'` or `'boss'`, show at most
  one toast at a time (queue the rest, or merge them into one 'SCRAPBOOK 7/8 +2' pill), or stack extra toasts down the
  side of the playfield instead of downward over the top rows.
- **UI (critic #8 regression):** at zoom 1 the 'TAP OR PRESS A KEY FOR SOUND' toast text is clipped by its pill.
- **#8 (1px light line near y=140):** still not interaction (see above). Round-2 shots of park/cafe/moon at night show
  no full-width line from this module; the cafe-night floor rectangle's 1px light outline is world art.
- **Effects (#10):** interaction no longer floats a score label for a boop inside the formation (Galaga only labels
  kills in flight) or for memory carriers, so the combo-merge labels now only appear for divers. Effects' dotted heart
  ring around combo numbers and the carrier sparkle burst are still stacked treatments worth thinning.
- **Note (#9, formation left of centre):** the formation centre now rides with the panning camera (eased, <= 1 px/tick),
  so the convoy stays centred and whole in the 384px view wherever Pom flies.

## Integrator response (polish 1)
- Toasts over the formation (round 2): done in ui. While `interaction.mode` is `'wave'` or `'boss'` in play, toasts
  play one at a time at the top slot (the rest wait their turn, the front one is cut to 110 ticks when others are
  queued, queue cap 6). Outside combat the 4-deep stack is unchanged.
- #8 (1px light line near y=140): agreed, not interaction; forwarded to world (segment seam / dissolve edge).
- #10 effects (float text clear of the carrier crown, thinner heart ring around combo numbers, carrier sparkle):
  forwarded to effects, not applied this round.
- 'TAP OR PRESS A KEY FOR SOUND' clipped at zoom 1: forwarded to ui (zoom-2 captures show the pill whole).

## Polish 2

Round 1 (interaction only, no core changes needed). Notes for the integrator and other owners:
- **Formation lattice:** at most 8 columns (252px incl. sprites) x 3-5 flat rows, all on one half-step lattice centred on
  the formation centre (which rides the camera at <= 2px/tick, so the block always sits whole inside the 384px view;
  headless sweep of all 13 areas x 3 waves: settled cats never closer than a cell, never within 14px of a view edge).
  Survivors close ranks in a short lull after boops (rows pack and re-centre, empty rows close up, the last <= 8
  regroup into one tight block via a sideways-then-vertical move that never slides two cats through each other).
- **Two-shot limit in waves (Galaga):** `fireTurds` now allows 2 turds on screen against a formation (spread powers
  still add their extra lanes); bosses and bonus stages keep 4. Player: shots that hit the cap simply do not fire,
  the same as before at 4. This keeps the bot at 32-34 min now that the grid stays tight (it fell to 27-31 without).
- **Bonus HUD stats:** real bonus flights already count every hit in `stats.catsBooped/hits` (checked headless).
  Interaction now also credits any hits `minigames.hits` holds that interaction did not count (the showcase's pinned
  tally), so BOOPS/AIM never trail the bonus board. Minigames: if the bonus showcase should show non-zero BOOPS,
  pin the tally after interaction's flight has started (`--at` beyond the intro), or set `stats` in the showcase.
