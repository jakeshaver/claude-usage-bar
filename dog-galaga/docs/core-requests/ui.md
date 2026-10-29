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
