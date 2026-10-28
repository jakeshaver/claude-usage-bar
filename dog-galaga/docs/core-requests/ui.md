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
