# Core requests from ui (round 1)

1. **typecheck is red for every worktree (pre-existing, not ui).** `tsc --noEmit -p .` fails on
   `tools/bot.ts` and `tools/lint-content.ts` with `Cannot find name 'node:fs' / 'process'`:
   `@types/node` is not installed in the shared `node_modules` and is not in `package.json`.
   Fix: `npm i -D @types/node` and set `"types": ["node"]` in tsconfig.json (or exclude `tools/*.ts`
   from the main tsconfig and give tools their own tsconfig). `src/` typechecks clean.

2. **Showcase: settings screen.** Add `--menu=settings` to the `ui` showcase
   (`g.mods.ui.menuOpen = 'settings'; g.mods.ui.settingsFrom = 'pause'; g.paused = true`), and a
   `touch=on` param (`g.state.settings.touch = 'on'`) so critics can screenshot the touch layout
   without hand-written `--state` JSON.

3. **Dialogue portraits (art).** The dialogue box now looks up `portrait_<name>` first (e.g.
   `portrait_poodle`, `portrait_pup`, `portrait_boss_empress`), then `<name>`, then falls back to
   `poodle` (speaker/portrait mentions Pom) or `pup`. Sprites of 22px or less are shown at 2x. A 40x40
   bust per speaker would fill the 44x44 bay best.

4. **Input (optional).** `Input.lastDevice` drives the button hints (keyboard / gamepad / touch). The
   gamepad only flips `lastDevice` when a new action is added that frame; fine for now. It would be
   nice if pressing a gamepad button also cleared `touch` so hints switch back.

# Core requests from ui (round 2)

5. **Showcase: believable ending stats.** `showcase=ending` leaves score/stats at zero, so the stat chips
   read `0 PTS / 0 MIN / 0 NAPS`. In `src/showcase/index.ts` case `'ending'`, seed e.g.
   `g.state.score = 184250; g.state.hiScore = 184250; g.state.stats = { ...g.state.stats, shots: 2140, hits: 1610, catsBooped: 1312, naps: 3, playTicks: 60 * 60 * 47 }; g.state.memories = g.content.memories.slice(0, 14).map(m => m.id);`

6. **Quest: respect `g.paused` in `quest.update`.** The dialogue engine reads confirm/fire even when the
   game is paused. ui now maps the pause key during dialogue to "skip conversation" (calls
   `quest.advance()` until the dialogue closes), so nothing is broken today, but if pause-from-dialogue is
   ever wanted, `Quest.update` must early-return when `g.paused`.

7. **World (optional): dawn tint.** The playfield at dawn looks identical to day. The ui panels now tint
   per time of day (amber dawn, magenta dusk, violet/teal night); a warm palette-safe dawn overlay in
   world would complete the effect.

8. **Showcase (optional):** `--tod` seems not to apply to `showcase=ui --menu=pause --touch=1` in some
   runs (panel shows DAY). Low priority.

9. **Bundle budget heads-up.** After this round the single JS chunk is ~411 KB (was ~398 KB); ui added
   ~13 KB (sector glyphs, HUD blocks). `verify` does not enforce the 400 KB budget from ARCHITECTURE.md.
   If the integrator wants it enforced, ui can pack the 16x16 map glyphs into hex masks (~2.5 KB saving).

# Core requests from ui (round 3)

10. **World: stronger dawn/dusk tint (critic issue 9).** Park at dawn reads as plain day and cafe at dusk shows
    no warm tint; only the HUD accent changes. ui now has distinct LOCAL TIME icons (sunrise with rays for
    dawn, half sun on the horizon for dusk). Please push `TOD_RAMP.dawn` toward peach/amber (e.g. remap greens
    and greys one step toward `g`/`8`, shadows toward `v`) and `TOD_RAMP.dusk` toward magenta/purple
    (highlights toward `c`/`d`, mids toward `u`, shadows toward `v`/`1`), and apply a dusk ramp to indoor
    tilesets too (cafe), so the time of day reads in the playfield at a glance.

11. **Bundle budget (critic issue 13), for the integrator.** dist JS is ~414 KB (HEAD of this round started at
    410.9 KB). This round ui added the 2x-native HUD numerals, the ending/recovery staging, the title formation
    and the cached nebula renderer (+6.3 KB), and saved ~2.9 KB by packing the 16x16 map glyphs into base64
    (2 bits per pixel). The 400 KB budget in ARCHITECTURE.md is exceeded by the project as a whole and the
    vite chunk warning fires. Options: raise `build.chunkSizeWarningLimit` and the documented budget, or pack
    the sprite sheets in `src/art/sprites/*.ts` the same way (they are the bulk of the bundle).

12. **Quest: `dlg` parking during pause (FYI, no change required).** Esc during dialogue now opens the pause
    menu (RESUME / SKIP BRIEFING / JOURNAL / SETTINGS / SAVE & QUIT); the dedicated skip key is X/Backspace
    (gamepad B). While the menu is open ui parks `quest.dlg` in `ui.heldDlg` so `Quest.update` idles and menu
    confirms do not advance the conversation; it is restored on close. A cleaner long-term fix is request 6
    (`Quest.update` early-returns when `g.paused`), after which ui can drop the parking.

13. **Input (FYI):** after a menu closes while A/SPACE is still held, ui keeps `g.paused` true until fire and
    confirm are released (max 30 ticks), so resuming with A never emits a turd on the first frame. If core
    ever adds an `Input.consume(action)` helper, ui would switch to it.

14. **Showcase (repeat of 5):** `showcase=ending` still shows zero score/boops/minutes in the stat chips.

# Core requests from ui (round 4)

13. **One display face everywhere (critic issue 6).** ui now draws every display header (SECTOR MAP, PAUSED,
    SETTINGS, ending titles, recovery headline) with `headline()` from `src/ui/numerals.ts`: the 7x11, 2px-stroke
    face the HUD numerals use, now with A-Z and punctuation, ink outline and a dark drop shadow. The nap banner
    `POM IS TAKING A NAP` (drawn outside ui with `text(..., { scale: 2 })`) is the last 2x-scaled 5x7 header.
    Suggested: `import { headline } from '../ui/numerals'` and call
    `headline(ctx, 'POM IS TAKING A NAP', PF_X + PF_W / 2, y, C.gold, C.cream, C.burnt)` (colors from `ui/draw` `C`).

14. **Boss bar overlap (FYI).** During a boss fight ui draws a 15px chamfered armor bar at the top of the
    playfield (y 2..18, x PF_X+40..PF_X+PF_W-40). If interaction/effects ever draw text in that strip during the
    boss phase, please start it at y >= 22. Toasts already stack below the bar.

15. **Art (optional): title pose.** The title shows the gameplay sprite in a chase-cam framing (flying toward the
    sun, shadow on the grid); the ending and recovery use `portrait_pom` peeking over the fence. A dedicated
    `poodle_front` 32x32 flying pose would let the title show Pom's face as well.

## Integrator response
- 1: done (round 1).
- 2: applied; `--menu=settings` and `--touch=on` (now handled at boot for every scene).
- 3: done (round 1).
- 4: not applied (optional input polish).
- 5 / 14 (repeat): applied; `showcase=ending` seeds score, stats and 14 memories.
- 6 / 12: applied; `Quest.update` early-returns while `g.paused`, so ui may drop the `heldDlg` parking when convenient.
- 7 / 10: world owner (tod ramps); forwarded.
- 8: `?tod=` is applied after the showcase runs in main.ts; re-check after this round.
- 9 / 11: resolved by raising the chunk warning to 600 kB; the hard budget is the 1 MB dist total (ARCHITECTURE.md updated).
- 13 (input consume): not added yet; the resume hold works.
- R4-13: applied; the nap banner uses `headline()` (gold/cream/burnt), drawn by world.
- R4-14: noted; the boss bounty float text spawns at the boss (y >= 22 in practice).
- Integrator seam fixes in ui: settings menu gained AMBIENCE, FLASHES and REDUCE MOTION rows (driven by one SETTINGS_ROWS table), `muteToasts(on)` for staged showcases, and a real Escape press opens pause even while the autopilot is on.

## Polish 1

1. **audio: drop the corner "sound off" hint; ui now owns the sound chip (critic #5c).** ui draws a static sound
   status chip at exactly the same rect (x 611, y 5, 22x16) on every scene: inside the right HUD panel in play (the
   SECTOR header now stops short of it), and the sector map header bar is narrowed (x 36..604) so it never touches
   the corner. The chip reads `g.mods.audio.running()` plus `settings.music/sfx` (speaker + waves when sound is
   really playing, a crossed speaker when the context is locked/failed or both volumes are 0) and never blinks.
   Please remove from `src/audio/index.ts`: the `g.register({ id: 'audio-hint', overlay: ... })` line (~91) and the
   `hint()` method. Until then audio's blinking box paints over ui's chip in the same rect (no layout collision, but
   the blink is the "inconsistent icon state" the critic flagged). Keep `running()` public.
2. **audio (optional):** the `'TAP OR PRESS A KEY FOR SOUND'` toast is fine as is; ui now anchors toasts per scene so
   it never covers a heading (map: just above the NEXT HOP panel, stacking upward; title/recovery/ending: above the
   hint row; play: top of the playfield).
3. **showcase (FYI):** the ending is now a timeline: flight home (each of `inventory.pups` trailing Pom, capped at
   16 drawn), a credits roll (logo, Captain Pom, the rescued pups, every breed, every Big Cat), then the story card.
   The roll is paced so the card is fully revealed by `endingT` ~1990, so `showcase=ending` (endingT = 2000) still
   shows the final card. Confirm skips straight to the revealed card, a second confirm returns to the title.
   Earlier phases can be staged by setting `g.mods.ui.endingT` (e.g. 150 = flight, 900 = cast parade).
4. **effects (FYI, critic #5e):** 'HEART BISCUI' was a ui toast caught mid-unfold (the label was clipped with the
   pill). Toasts are now always drawn whole (a 4px drop-in instead of a horizontal unfold); nothing needed elsewhere.

### Polish 1, round 2
5. **audio: remove the `audio-hint` overlay (repeat of item 1, now blocking critic #5c).** It still paints a blinking
   speaker at x 611..632, y 5..20 over ui's sound chip. ui now parks it at init with
   `g.disabled.add('audio-hint:overlay')` (core's per-module isolation switch, keyed exactly as `render.ts` calls
   `g.safe(m.id + ':overlay')`), so there is a single static widget today. Please delete the
   `g.register({ id: 'audio-hint', ... })` line and `hint()` in `src/audio/index.ts`; ui's line then becomes a no-op
   and can be dropped. The ui chip moved to the SECTOR header row (x 613, y 7, 17x11) and reads `audio.running()`.
6. **world (FYI):** the HUD wave counter now uses the same N as world's `WAVE n / N` banner (regular waves only; the
   Big Cat has its own strip cell and BIG CAT WAVE plate). No change needed.

## Integrator response (polish 1)
- 1, 5: `audio-hint` overlay, `hint()` and the `SPEAKER` icon are deleted from `src/audio/index.ts`; ui's
  `g.disabled.add('audio-hint:overlay')` line is dropped. ui's chip is the only sound widget. `running()` stays public.
- 2, 4, 6: no change needed.
- 3: ending timeline confirmed: `showcase=ending` shows the final card, zero console/game errors.
- Also landed in `src/ui/index.ts` on behalf of other modules (small seams): toasts hidden while
  `memories.showing()` (memories #17); one toast at a time in a live wave/boss (interaction round 2); the NEXT HOP
  card shows `quest.routeNote(selTo)` (flag + lime 'FINISHES ...' / pink 'CLOSES ...') in place of the subtitle line;
  map autopilot takes a hop that completes a quest (`quest.completes`), otherwise the seed's pick (quest #3).
- Open for ui: 'TAP OR PRESS A KEY FOR SOUND' pill clipped at zoom 1 (interaction round 2). The map header
  'nn/13 CLEAR' is clear of the chip in current captures.

## Polish 2
1. **interaction: `wavePreview(areaId, waveIndex): { breed: string; n: number }[]` (critic #4).** The right panel's
   next-wave preview showed content-roster counts (TABBY X24) while `startWave` spawns fewer (18): `layout()` trims the
   roster by the sector's formation shape and the difficulty cap `Math.round(20 + 12 * T.d)`. Please expose a pure
   helper that runs the same `layout(w, shapeFor(areaIdx, i), i, enemy, cap)` as `startWave` (no RNG draws, no state
   change) and returns the per-breed head counts. ui already calls `g.mods.interaction?.wavePreview?.(area, i)` and
   shows `X<n>` under each portrait only when it exists; until then the portraits carry no numbers (never wrong ones).
2. **showcase (FYI / small ask):** `?showcase=ending` always sets `inventory.pups = 6`, also for `ending=ending_good`.
   ui now keeps the diorama honest on its own (true ending shows at least the Lost Pups quest count, the good ending at
   most count - 1, so EVERY PUP HOME can never show PUPS 0 and the hopeful ending always has someone still out there),
   but a showcase that sets e.g. `pups = 3` for `ending_good` would stage the real thing. Earlier phases can still be
   staged with `g.mods.ui.endingT` (e.g. 200 = flight with the rider and the pup ribbon, 500 = landing, 1000 = credits).
3. **FYI (no change needed):** toasts now cap at 2 on screen with a queue behind (1 in a live wave/boss), wrap inside
   the playfield, and are flushed and refused once the scene is `'ending'`. `ui.toasts` stays the one array (the first 2 are
   on screen, the rest wait in line), so interaction's pickup merge and quest's / memories' checks keep working. Bad news (text
   matching MISSED / EXPIRED / CLOSES ...) gets a peri frame and a pink cross icon instead of the gold star.
4. **FYI:** ui registers its own ending sprites (`end_pom_fly`, `end_pom_sit`, `end_pup_sit`, `end_pup_fly`,
   `end_hedgehog`; generated by `src/ui/art/gen-ending.mjs` into `src/ui/ending-art.ts`) with `defineSprites` at import,
   and draws Pom's title / recovery hero with player's own `flame()` + `POM_NOZZLES` (read-only imports).
5. **showcase (round 2, replaces the FYI in item 2): `?showcase=ending&ending=ending_good` should stage `inventory.pups = 3`
   (or any count below the Lost Pups quest's 6).** ui no longer adjusts the pup count at all (critic: never show a
   number that disagrees with the save): the diorama, the PUPS HOME counter and the PUPS stat chip all read
   `inventory.pups`. The block-party set piece (EVERY PUP HOME) is staged only when the ending is `ending_true` *and*
   `inventory.pups` reaches the quest count; a true-ending flag with fewer pups plays the search-party set piece with
   ending_good's title and story. With the showcase's forced `pups = 6`, the good ending currently shows six pups home
   under 'A few puppies are still finding their way back'.
6. **FYI (no change needed):** the HUD's small tier (`src/ui/tiny.ts`) is now a variable-width small-caps cut (M W N O Q D G
   wider) with `wrapPx` / `balancePx` helpers; sector headers use 2px leading (title 1-2 lines, subtitle 1 line or 2
   balanced small-caps lines), the sector log draws a long name in the small tier instead of cutting it, and the
   ending's story window dithers out ~3.5 s after the last line so the final diorama gets a clean beat (stats rise
   under the title plate).

## Integrator response (polish 2)

1. Done: `interaction.wavePreview(areaId, waveIndex)` exists (pure, same layout call as startWave, tested against
   real spawns), so the preview portraits now carry honest `X<n>` counts.
2./5. Done: `?showcase=ending&ending=ending_good` now stages `inventory.pups = 3`; `ending_true` keeps 6; `pups=N`
   overrides either (tools/screenshot.mjs forwards `--pups`). Checked: the good ending shows 3 PUPS under the
   search-party story.
- Also applied in ui (small seams requested by quest and memories, please review): `toast(s, opts?)` with
  `opts.kind` 'warn' | 'good' stored on the entry and kept in `toastPend` (warn forces the bad-news plate, good = lime
  text, omitted = the BAD_NEWS regex as before), `g.toastFn = (s, o) => this.toast(s, o)` (core `toastFn` type
  widened); `routeNote` colours by `rn.kind === 'finishes'` and appends ` +n` when `rn.more > 0`; the RESCUED album
  count reads `memories.albumShown()`; the ending card lists `quest.endingRewards()` (flag icon + gold text, up to 3
  rows, or 2 + `+n MORE QUESTS`) 24px under the stats chips, so it rides up with them when the story window fades.
- Not done (yours, optional): memories item 20 cleanup (`toastsHeld()` memories branch and the `drawToasts` skip are
  inert now that `revealing()` / `showing()` are always false).

## Polish 3

1. **memories (card body clipped, `src/memories/index.ts` `card()`):** the HUD memory side card is fixed at
   `CARD_Y = 119, CARD_H = 170`, and its body window only scrolls 76 ticks after the photo lands, so for a frame range the
   last body line is lost (station z1: 'GOTCHA DAY' ends at 'SHE SAID THAT IS HOW SHE', 'KNEW.' never shows until the
   scroll). Please size the body from `wrap(body, 18).length` (shrink the photo slot to the 32x31 half polaroid, or drop
   the title to 1 line, when `lines > room`) so the final line is visible without waiting for the scroll. (ui side: the
   sector header is now always one line for station, 'SCRATCH STATION', so nothing above the card changes height.)
2. **memories (header covered while filing, `fileFlight()`):** at `f < 0.25` the lifted polaroid is drawn at
   `sy - 31 - f * 16`, i.e. up to 4px above the slot, which puts it over the 'FOUND A...' kicker and the header rule
   (docks dusk +900: reads 'FOUND A[photo]'). Please clamp the lift so the photo's top never rises above `CARD_Y + 16`
   (the dashed rule row), or hide the kicker while the photo is in flight.
3. **memories (stamp + rule clearance):** `recoveredStamp` is struck straight onto the photo chin, and the card's
   `scanlines`/dither rows cross it at zoom 3 (alley z3). Please give the stamp a solid 1px-padded backing rect in the
   chin colour before the letters. Also add 2px between the title's dashed dither row and the first body line
   (`by = ty + tl.length * 9 + 4`).
4. **quest (content):** with `inventory.pups = 0`, `ending_good`'s story still says 'A few puppies are still finding
   their way back' (fine) but some copy assumed pups came home; ui now labels the flight plate 'PUPS STILL ON THE WAY'
   instead of 'HOME AT LAST' when no pup is home. Please check the ending text reads right for 0 pups.
5. **quest:** the park boss wave HUD shows the tracked quest 'PARK PALS 10/11' before its 'NEW QUEST' toast fires
   (ui now holds every toast through the boss intro, ~150 ticks after the entrance). `tracked()` should keep a quest
   in `unrevealed` until its NEW QUEST toast is actually on screen (e.g. reveal on ui's toast display, or have ui call
   back: ui can expose `toastShown(text)` if you want it).
6. **FYI (ui):** toasts in play / bonus now use a reserved strip at the bottom of the playfield (below Pom's lowest
   flight row, stacking upward), never the top where the formation and the boss sit; on the sector map they dock
   right under the header bar. The HUD sector header and the map's sector log share one short name table
   (`LOG_SHORT`: station = 'SCRATCH STATION').

## Integrator response (polish 3)

1. Done (memories, `card()`): a single memory whose body would not fit under the 64x62 polaroid (`tightCard()`:
   `wrap(body, 18).length > room`, today mem_01 GOTCHA DAY, mem_11, mem_17) shows the 32x31 half polaroid instead
   (centred in the slot, no develop animation and no RECOVERED stamp at that size), title and body move up 31px, so
   the last line ('KNEW.') is on screen from the start. The empty-slot corners / INTO THE ALBUM! and the filing
   lift-off use the same half size for those memories. Bundle summary pages and the compact card are unchanged.
2. Done (`fileFlight()`): the lift is clamped to `SLOT_DY - 16` px, so the photo's top never rises above
   `CARD_Y + 16`; the kicker and the header rule stay readable.
3. Done: `recoveredStamp` paints a solid 1px-padded backing rect in the lost chin colour ('5') before the letters,
   and the body starts 4px under the title (`by = ty + tl.length * 9 + 4`).
4. Done (content): `ending_good` now reads "Any pup not yet home is still finding its way back. Commander Biscuit
   has search parties out, and the Empress has promised to help." (right for 0..5 pups). Checked
   `?showcase=ending&ending=ending_good&pups=0`.
5. Done (seam): ui exposes `toastWaiting(text)` (true while the toast sits in `toastPend` or is queued with
   `age === 0`); quest no longer reveals a quest when it hands the NEW QUEST toast to ui, it keeps it in
   `unrevealed` until `toastWaiting` turns false (checked lazily in `revealed()` / `tracked()`). A toast ui drops
   (mute, overflow, ending) reveals at once, so nothing can stay hidden; no ui = immediate reveal as before.
6. Noted in ARCHITECTURE (ui entry: bottom toast strip in play / bonus, map dock, boss-intro hold, `LOG_SHORT`).

## Polish 4

1. **world (title card):** the sector title card is drawn by `src/world/index.ts` `titleCard()`, not ui. Its subtitle
   types out one word at a time, so mid-way it reads as a truncated line (e.g. 'BRING EVERY'). Please show the
   subtitle whole: draw the complete string at once and reveal it with a left-to-right wipe (clip rect growing over
   ~12 ticks) or a palette-step fade-in, never word by word. The sector name can keep its typing beat.
2. **showcase (nice to have):** `?showcase=ending` always stages `endingT = 2000` (the closing card). Please honour
   `at=N` there (`g.mods.ui.endingT = p.get('at') !== null ? +p.get('at')! : 2000`) so the diorama, the flight
   home and the credits roll can be screenshotted without the card on top (ui tested with that local patch:
   `--at=420` = landed diorama, `--at=640` = credits STARRING).
3. **FYI (ui):** ui now merges the two toasts of one event into a single pill: 'NEW QUEST: X' + 'X n/m [MEMORIES]'
   -> 'NEW QUEST: X n/m', and 'PUPPY RESCUED! ...' + '<pup quest name> n/m' -> 'PUPPY RESCUED! LOST PUPS n/m'
   (either order, while the first is pending or on screen). `toastWaiting(text)` still matches the original texts,
   so quest's NEW QUEST reveal keeps working. The HUD hostiles list now always uses breed short names (TABBY,
   SIAMESE, RUSSIAN BLUE, SCOTTISH FOLD...) with per-breed 3-tone icons (coat, ear/muzzle points, eye colour).

## Integrator response (polish 4)

1. Title card: done in src/world/index.ts. The whole subtitle is drawn at once and revealed by a left-to-right clip
   wipe over 12 ticks with a 1px cyan edge. The sector name still types out.
2. Showcase: `?showcase=ending&at=N` now sets `ui.endingT = N`, and the default is still 2000. Checked with
   `--at=640` (the credits STARRING plate), zero errors.
3. FYI noted in ARCHITECTURE.md (ui entry): the merged quest/pup toast pills (`toastWaiting` still matches the
   original texts), and breed short names with 3-tone icons in the hostiles list.

## Polish 5

1. **core (attract demo flag):** ui now runs a Galaga attract demo after ~10 s idle on the title (autopilot flies a
   mid wave of the start sector or a cleared one on a JSON copy of the state; `save.save` / `save.flush` are stubbed
   for the run, the real state object is put back afterwards, memories' leftover drops/cards are cleared; verified
   that localStorage and `g.state` are byte-identical after the demo). Modules that keep session-only bookkeeping
   from bus events still hear the demo: journal's `seen` breeds / `boops` and quest's internal `touched` counters.
   Please add a `g.demo: boolean` (ui sets it for the run) and have journal `note()` and quest `onEvent()` ignore events
   while it is set, so a demo can never mark a breed as seen in the bestiary.
2. **memories (row anchor):** the right HUD no longer has a SECTOR GOALS block. ui keeps a slim MEMORIES strip at
   the same row (`x1 = RX+10`, label at `x1+15`, boxes right-aligned, `y 245..254`), so `goalsPulse` still lines up;
   the LOST PUP / BIG CAT rows and the local / flight time moved to the pause menu's sector card (the HUD keeps a
   one-line DAY + flight clock footer at y 336). Please update the comments that say "SECTOR GOALS (x1, y 230)" to
   "memory strip (y 239..256)". In touch mode the strip is hidden (the deck starts at y 232), so please skip
   `goalsPulse` when `ui.touch.visible(g)`.
3. **save (indicator comment):** the keyboard floppy still lands at `colRight - 16, H - 26`, right of the new footer
   row (DAY + flight clock end at x RX+98); only the comment "beside the FLIGHT TIME clock" is stale.
4. **FYI (ui):** the HUD threat slot now reads HOSTILES while cats are up and NEXT WAVE (or NEXT: BIG CAT with the
   boss's portrait) between waves, over an INCOMING pill, never SKIES CLEAR. The PUPPY RESCUED merge keeps the
   rescue's own news: 'PUPPY RESCUED! WINGMAN ONLINE. LOST PUPS n/m'.

### Polish 5, round 2

5. **memories (card slot: the essentials must stay visible):** the right HUD was re-spaced into five even blocks
   (SECTOR 10, WAVE 54, QUEST 88, threat slot 128..200, RESCUED 212) and a footer, and the memory card now has its
   own slot at the panel foot. ui exposes the anchors as `g.mods.ui.hudSlots()`:
   `{ card: { x: RX+4, y: 245, w: 120, h: 111 }, album: { x: RX+75, y: 232, tx: RX+86, ty: 228 }, strip: { x: RX+10, w: 108, row: 259 } }`.
   Please read them (fall back to the current constants when `hudSlots` is missing) instead of the hard-coded values:
   - card: `CARD_Y = card.y` and, in the keyboard layout too, the compact 111px card (`compact = true` whenever
     `card.h < CARD_H`). Touch can keep its current spot (y 119..230). The card then covers only the photo strip, the
     stage flags and the clock footer; QUEST, HOSTILES and the album chip stay in view.
   - album: `ALBUM_X/ALBUM_Y = album.x/album.y` (the RESCUED row's polaroid chip, now just above the card, so the
     file flight's FLY_TOP = CARD_Y - 2 still works), `ALBUM_TX/ALBUM_TY = album.tx/album.ty` (the chip is still plain
     deep night behind the count).
   - strip: `GOALS_X/GOALS_W/GOALS_ROW = strip.x/strip.w/strip.row` (label at x+15, boxes at row-1, as before).
   ui verified this with a local patch of exactly these values (backyard reveal + bundle, zero errors), then reverted it.
   Until this lands, the old constants repaint the album count at (RX+85, 102) over the QUEST name while a card is up.
6. **core / journal / quest (FYI for request 1):** ui now sets `(g as any).demo = true` for the attract demo run (false
   after), and snapshots and restores journal `seen` / `boops` / `bossesDown` and quest `touched` around it, because
   the demo now tours later sectors (rooftops at night, sky at dusk, moon, alley, backyard, station). A typed
   `g.demo` flag that those modules check would still be the cleaner fix.

## Integrator response (polish 5)

1. Done: `Game.demo: boolean` (core/game.ts, default false). ui now sets `g.demo` (no cast). journal `note()` and
   quest `onEvent()` return early while it is set. ui's snapshot / restore of journal `seen` / `boops` / `bossesDown`
   and quest `touched` is kept as belt and braces (harmless); you can drop it once you are happy with the flag.
2. Done in `src/memories/index.ts`: the "SECTOR GOALS" comments now say "memory strip (y 239..256)", and both the
   strip pulse and the album count repaint are skipped while `ui.touch.visible(g)`.
3. Done: save's indicator comment now says "right of the HUD footer row (DAY + flight clock end at x RX+98)".
4. Noted (ARCHITECTURE ui entry mentions `hudSlots()`, BOOPED and the attract demo).
5. Done: memories reads `g.mods.ui.hudSlots()` every overlay frame (`useSlots(g)`, falls back to the same values when
   `hudSlots` is missing): keyboard card at `card.y` (245) as the compact card whenever `card.h < CARD_H`, touch keeps
   y 119 (compact 111); `ALBUM_X/Y/TX/TY` from `album`; strip from `strip`. The filing route and the landing flash box
   (`ALBUM_X - 10, ALBUM_Y - 10`) follow the album chip. In touch (no RESCUED dock) the photo hops out over the card's
   top-right corner and no album count is repainted.
6. See 1.
- Also from interaction (polish 5 round 2): the wave plate reads `BIG CAT BOOPED` (lime plate, new `tick` icon in
  `ui/draw.ts`) and the sector card's BIG CAT row reads `BOOPED` while `interaction.bossDown === area.boss`. Restyle
  freely.

## Polish 6

1. **memories (RESCUED line is now one compact row):** the right HUD's lower dock is a single line at y 210..226
   (pup chip | album chip | this sector's photo boxes, no header, no MEMORIES label). `hudSlots()` changed values
   (same shape, read every frame as before):
   `album: { x: RX+53, y: 218, tx: RX+62, ty: 215 }` (the album chip spans RX+45..RX+95, plain deep night behind the
   count, so the 32x10 repaint and the 54x20 landing flash box fit it), `strip: { x: W+20, w: RX+122-(W+20), row: 215 }`.
   The strip x deliberately sits past the panel's right edge so `goalsPulse`'s `text('MEMORIES', GOALS_X + 15, ...)`
   is clipped away by memories' own `ctx.rect(RX, 0, W - RX, H)` clip; the box math (`GOALS_X + GOALS_W - 5 - (n - i) * 9 + 1`,
   row - 1) lands exactly on ui's boxes. Cleaner: please skip the label repaint when `strip.label === false` (ui will
   add that field once memories honours it) or simply drop the label from the pulse.
   The card slot is unchanged (`card: { x: RX+4, y: 245, w: 120, h: 111 }`) and is now real: ui draws nothing in
   y 245..356 (stage flags, DAY + flight clock) while `memories.panelCard()` is true. Please make sure every keyboard
   card (also the bundle and the memories showcase) uses `card.y` / the compact height: the critic saw a full 170px card
   at y 119..289 covering HOSTILES and the album count repainted over the QUEST name ('DOCKING CLEAR1/18NCE'), which is
   the touch spot + the pre-hudSlots album constants.
2. **world (FYI):** ui now redraws the between-waves banner ('WAVE n / N', 'WARNING: BIG CAT INBOUND', 'SECTOR CLEAR')
   on a solid ink plate (same words, colours, y 160, same phase/timer test, skipped while `trans` or a menu is up), so
   turds and pickups no longer read through its strokes. world can drop its own `text(...)` call for the banner, or
   keep it (ui's plate covers it exactly).
