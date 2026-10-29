# Core requests from save (round 1)

## 1. tests: wire the save self-test (integrator-owned `tests/`)
`src/save/save.selftest.ts` exports `saveSelftest(only?: string): { name, ok, detail? }[]` (never throws, headless,
~0.3 s). 10 cases: save mid-wave -> quit -> resume (area/wave/score/hi/quests/memories/flags/stats), write throttle,
corrupt main -> backup, both corrupt -> recovery + salvage + start fresh, fuzz (truncated/random saves never throw),
localStorage unavailable -> memory + toast, quota exceeded -> free backup, then memory + toast, migrations
(chain, legacy v0, newer build), export/import string, title-screen settings never overwrite progress.
Suggested `tests/save.selftest.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { saveSelftest } from '../src/save/save.selftest';
describe('save selftest', () => {
  for (const c of saveSelftest()) it(c.name, () => expect(c.detail ?? 'ok').toBe('ok'));
});
```

## 2. boot.ts: register `save` last (overlay order)
Overlays draw in module order and ui's full-screen HUD/title comes after save, so the autosave floppy was hidden.
Please move `['save', makeSave]` to the end of the factory list in `src/core/boot.ts` (after `journal`).
Until then `save.update()` moves its own entry to the end of `g.modules` once (outside `g.init()`'s loop; a no-op
when already last). I will remove that shim once boot.ts is changed. (Alternative: an `overlayZ` on Module,
sorted in `render.ts`.) save's update only touches storage/toasts, so the order change does not affect the sim.

## 3. ui: recovery screen (scene 'recovery') can show what is actually left
`g.mods.save.info()` returns `{ main, backup: 'ok'|'damaged'|'corrupt'|'missing', persistent, pending, writes,
lastStatus, version }`. Calling `save.load()` while the scene is `recovery` (the "TRY BACKUP SAVE" row) now also
salvages a save whose checksum fails but whose data still parses, returns `'recovered'` and resumes play.
Suggestions:
- Label row 0 from info: any slot `'damaged'` -> `PATCH UP MY SAVE`; backup `'ok'` -> `TRY BACKUP SAVE`;
  else `TRY AGAIN` (it will fail, then the existing "STARTING FRESH" path runs).
- One small status line under the subtitle, e.g. `MAIN: CHEWED   BACKUP: CHEWED` / `BACKUP: SAFE`.
- "START FRESH" is safe now: the unreadable data is copied to `poodle-patrol:quarantine` before anything is wiped.
- The `save:recovered` payload now carries `slot: 'backup' | 'salvage'`; for `'salvage'` a better toast is
  `SAVE PATCHED UP. GOOD AS NEW` (the current `...FROM BACKUP` is wrong in that case).

## 4. ui: export / import save code (settings or journal)
API: `g.mods.save.exportString()` -> `"POODLE1:<base64url>"` (live game if one is running, else the stored save;
`''` if none). `g.mods.save.importString(code)` -> `'ok'|'recovered'` loads it (old main rotates to backup), or
`'corrupt'` and changes nothing (no recovery screen). Whitespace/newlines in pasted codes are ignored, and older
plain-base64 codes are accepted. Suggested settings rows: `COPY SAVE CODE` (`navigator.clipboard.writeText`, toast
`SAVE CODE COPIED`) and `PASTE SAVE CODE` (`navigator.clipboard.readText()` or `prompt()` fallback; toast
`SAVE CODE LOADED` / `THAT CODE LOOKS CHEWED`).

## 5. api.ts: expose export/import for tools
In `makeApi`: `exportSave: () => g.mods.save?.exportString()`, `importSave: (s: string) => g.mods.save?.importString(s)`.

## 6. Notes for other modules (no action needed)
- `save()` is now throttled: a burst of 4 writes is immediate, then one per 60 frames; queued writes land on a later
  frame, on scene change to title/ending, or on `pagehide`/tab hidden. `flush()` forces it.
- Before any game exists (title screen, no game:new/area:enter/load yet), `save()` only patches settings into the
  stored save (or `poodle-patrol:settings`). This fixes a real bug: TITLE -> SETTINGS -> back used to overwrite the
  player's save with an empty game. Stored settings are applied on boot, before CONTINUE.
- To change the state shape: bump `STATE_VERSION` in core/state.ts and add `MIGRATIONS[oldVersion]` in
  `src/save/codec.ts`. Saves from a newer build load best effort; the original is kept under `poodle-patrol:future`.
- Storage failures (blocked, private mode, quota) switch to an in-memory store and toast once
  (`STORAGE IS OFF. SAVING IN MEMORY` / `SAVE SPACE FULL. SAVING IN MEMORY`); they never call `reportError`.

# Core requests from save (round 2)

Status of round 1: none of #1-#5 is applied in this branch yet. #1 and #2 are now **blocking**.

## R2-1 (BLOCKING, integrator, tests/): run the save self-test in `npm run verify`
Critic: "prove reliability is not met until it runs in CI". It now has **12 cases** (~0.3 s, headless, never throws).
New this round: START FRESH / corrupt saves keep the high score and settings; recovery-screen options; save never
reorders `g.modules` mid-step and runs exactly once per step; notices never stack; indicator grid placement.
Create `tests/save.selftest.test.ts`, exactly:
```ts
import { describe, it, expect } from 'vitest';
import { saveSelftest } from '../src/save/save.selftest';
describe('save selftest', () => {
  for (const c of saveSelftest()) it(c.name, () => expect(c.detail ?? 'ok').toBe('ok'));
});
```
(Local check today: `npx tsx -e "import {saveSelftest} from './src/save/save.selftest'; console.log(saveSelftest())"`: 12/12.)

## R2-2 (BLOCKING, core): overlay order without save touching `g.modules`
The round-1 shim in `save.update()` is **gone** (it spliced `g.modules` inside `Game.step()`'s loop: skipped
effects for a tick and ran save twice). save now declares `overlayZ = 100`. Pick one:
- (preferred) `src/core/render.ts`: draw overlays sorted by `overlayZ` (default 0, stable):
  `const ov = g.modules.filter(m => m.overlay).sort((a, b) => ((a as any).overlayZ ?? 0) - ((b as any).overlayZ ?? 0));`
  `for (const m of ov) g.safe(m.id + ':overlay', () => m.overlay!(g, ctx));` and add `overlayZ?: number` to `Module`.
- or `src/core/boot.ts`: move `['save', makeSave]` to the end of `factories` (after `journal`).
Interim (until then): in the browser only, save moves its own entry to the end **once**, from a `queueMicrotask`
scheduled in `init()`, i.e. after `createGame()` returned, outside every loop over `g.modules`; never in headless
runs. Once either fix lands it is a no-op, and I will delete it.

## R2-3 (core, showcase): `?showcase=save&stage=...`
`g.mods.save.stage(name)` stages save's own work, frozen and deterministic: `'indicator'` (play scene, floppy held
solid at its first-frame phase, the storage-fallback toast up), `'indicator-touch'` (same with the touch deck),
`'recovery'` (default: the recovery screen). In `src/showcase/index.ts` replace
`case 'save': g.setScene('recovery'); break;` with
`case 'save': g.mods.save?.stage ? g.mods.save.stage(p.get('stage') ?? 'recovery') : g.setScene('recovery'); break;`
Use with `--area=street` for a busy HUD: `--showcase=save --stage=indicator --area=street`.

## R2-4 (ui, recovery screen; repeat of #3 with a ready-made helper) -- critic issue 3, HIGH
Nothing changed on screen last round. `g.mods.save.recoveryOptions()` now returns all the wording:
`{ primary, status, doomed, confirm, recoveredToast(slot), freshToast }`.
In `src/ui/index.ts`:
- `recovery()` draw: row 0 label = `o.primary` (`PATCH UP MY SAVE` / `TRY BACKUP SAVE` / `TRY AGAIN`); draw `o.status`
  (e.g. `MAIN: CHEWED  BACKUP: SAFE`) as one dim line under the subtitle.
- `recoveryNav()` row 0: `if (o.doomed)` do not call `load()`/`wipe()`; open a yes/no confirm with `o.confirm`
  (`NOTHING LEFT TO FETCH. START FRESH?`), YES -> `save.wipe(); setScene('title'); toast(o.freshToast)`, NO -> stay.
  Otherwise keep today's `load()` path.
- line 110: `g.bus.on('save:recovered', (p) => this.toast(this.g.mods.save?.recoveryOptions?.().recoveredToast(p.slot) ?? 'SAVE PATCHED UP FROM BACKUP'))`
  (salvage now reads `SAVE PATCHED UP. GOOD AS NEW`).
- START FRESH toast: `o.freshToast` (`STARTING FRESH. HI-SCORE KEPT!`). `wipe()` now keeps hiScore + settings
  (verified in browser: title shows `HI-SCORE 00048200` after START FRESH from two chewed slots).

## R2-5 (ui, art consistency) -- critic issue 5: one floppy everywhere
save's master sprite is exported: `import { drawFloppy, FLOPPY_W, FLOPPY_H } from '../save/index'` (16x16, paw label,
`drawFloppy(ctx, x, y, { chewed?: boolean, paw?: paletteKey, mono?: cssColor })`).
- recovery medallion badge (`icon(ctx, 'disk', bx + 4, by + 4, C.pale)`, ui/index.ts ~1072):
  `drawFloppy(ctx, bx, by, { chewed: true })` (a jagged bite out of the top-right corner).
- pause menu SAVE & QUIT glyph (ui/index.ts ~924, 7x7 `disk` icon): either a 7x7 reduction that keeps the
  silhouette (`'#####..', '#.#.##.', '#####.#', '#######', '#.....#', '#.#.#.#', '#######'` reads as the same
  floppy with the shutter + paw dots) or draw `drawFloppy` at 16x16 if the row height allows. Then delete `disk`.
  (If art prefers to own it, moving `FLOPPY` into `src/art/` is fine; save will import it from there.)

## R2-6 (ui) -- critic issue 9: toasts on title/recovery cover the POODLE logo
On `title` and `recovery`, anchor toasts below the logo (y ~ 236, under `OPERATION: GOOD GIRL`) or just above the
hint row (y ~ 328). Screenshot: shots/s2-e2e-after.png in the save worktree (toast over the P-O-O of the logo).

## R2-7 (ui) -- critic issue 12: empty pill during toast collapse
Hide the pill while its text is not drawn, or shrink the pill together with the text.

## R2-8 (api.ts, repeat of #5) and ui export/import rows (repeat of #4)
Unchanged; see #4/#5 above.

## Notes (no action)
- New key `poodle-patrol:keep` = `{ hi, settings }` (tiny, written only on change, never forces the memory fallback).
  Boot, CONTINUE failure and START FRESH all read the best hi score from it or from any slot, even a nibbled one.
- Storage-fallback toasts are now cozy (`CAN'T SAVE ON THIS BROWSER. PROGRESS KEPT THIS SESSION` /
  `NO ROOM IN THE TOY BOX. PROGRESS KEPT THIS SESSION`), wait until the intro dialogue and the sector title card
  are gone (no menus open), and save's notices are spaced >= 2 s apart so they never stack with each other.
- Autosave floppy is 16x16, right-aligned to the right panel's text column: beside the FLIGHT TIME clock with
  keyboard/gamepad, in the free slot above the ACTION deck when touch controls show, bottom-right on title/map.
