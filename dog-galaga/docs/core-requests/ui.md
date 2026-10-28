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
