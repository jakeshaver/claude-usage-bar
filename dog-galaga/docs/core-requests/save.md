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
