# quest: core requests

## Round 1 (builder)

1. **ui: use the engine's line layout in `dialogueBox`** (src/ui/index.ts, body lines).
   Replace `wrap(d.node.text.slice(0, Math.floor(d.chars)), 51).slice(0, 3)` with
   `g.mods.quest.visibleLines()` (falls back to the parked `heldDlg` itself). The old code re-wraps the
   *partial* string, so a word that is half typed at the end of a line jumps to the next line when it
   completes. `visibleLines()` wraps the full page first and reveals characters across those lines. The engine
   pages long text into boxes of `quest.cols` x `quest.rows` (51 x 3) so nothing is ever cut off; if ui changes
   the box width, read those two fields instead of hard-coding 51 / 3.
2. **ui: `skipDialogue` should call `g.mods.quest.skipAll()`** instead of its own 80-iteration loop of
   `chars = 1e9; advance()`. Long nodes are now paged, so a long conversation can need more than 80 advances;
   `skipAll()` is bounded internally. (The old loop still works for every node in content today.)
3. **integrator: run the quest check in verify.** `npx tsx src/quest/check.ts` (about 15 s) proves every quest
   in content/quests.json starts and completes on at least one sector path (with a perfect-bonus autopilot),
   that trigger events are really emitted, and the robustness cases (malformed quests, missing dialogue ids,
   next-cycles, nested conversations, pause parking). Either append it to `verify` or add a
   `tests/quest.test.ts` that spawns it and expects exit code 0.
4. **content: `boop_brigade` start trigger.** It starts on the first `wave:clear`, so the HUD shows
   "BOOP BRIGADE 0/1500" right after the player booped a whole wave. Suggest `"start": {"on": "area:enter",
   "match": {"areaId": "backyard"}}` so every boop counts (bot paths still finish it: ~1,500 is reached on all 8).
5. **ARCHITECTURE.md, section 5/4 additions:**
   - triggers: `{on, match?, when?}`; `match` compares payload fields (numbers and numeric strings compare
     loosely); `complete.count` defaults to 1; the start event also counts toward completion when it matches.
   - new event `quest:progress {questId, have, need}` (quest).
   - a quest's optional `dialogue` id plays when the quest starts (deferred until play/map, queued behind
     any open conversation).
   - quest API additions: `progress(q)`, `complete(q)`, `skipAll()`, `typing()`, `visibleLines()`, `cols`, `rows`.
   - `dialogue(id, done)`: if a conversation is open, one without a `done` callback is replaced, one with a
     callback (area outros) is never dropped: the new one queues. Missing ids show a friendly Pom line and are
     reported once via `g.errors`; malformed quest entries are skipped and reported the same way.

## Round 2 (builder)

Ranked by how much each one shows in the game. Everything the quest module could do alone is already done
(see "Done in src/quest" at the end); these are the pieces in other folders.

1. **tools/screenshot.mjs: `--skipDialogue` should call `skipAll()`** (blocking for the shim to go).
   Area briefings now wait for the sector title card (critic R1-1): for ~140 ticks the scene is `'dialogue'`
   but `quest.dlg` is still null (`quest.dlgEngine.staged` holds it), so the tool's loop
   `for (n < 60 && scene === 'dialogue' && quest.dlg) advance()` would skip nothing. Replace that loop with:
   ```js
   g.mods.quest?.skipAll?.();
   for (let n = 0; n < 60 && g.state.scene === 'dialogue' && g.mods.quest?.dlg; n++) g.mods.quest.advance();
   ```
   Until then `toolSkipLink()` in src/quest/dialogue.ts keeps old behavior for a boot-time `?area=` link with no
   `advance` param (exactly what the tool loads). Once the tool is patched, delete `toolSkipLink`.
2. **content/quests.json: `park_pals` must count the park's real waves.** It has `complete.count: 7`, but
   the park has 10 waves plus a boss, so the quest finished at wave 7 and its description was false.
   Preferred fix (matches the desc "Clear every wave"):
   ```json
   "complete": { "on": "area:clear", "match": { "areaId": "park" } }
   ```
   The engine already copes: `deriveQuest()` (src/quest/validate.ts) replaces a stale wave-clear count with the
   area's wave total (10), and the check fails if the effective count ever differs from the area's waves. It
   also prints a NOTE until the content is fixed.
3. **vitest: run the quest check in `npm run verify`.** `src/quest/quest.test.ts` wraps `runQuestCheck()`.
   Either change vite.config.ts `test.include` to `['tests/**/*.test.ts', 'src/**/*.test.ts']`, or copy the
   file to `tests/quest.test.ts` and change its import to `'../src/quest/check'`. It runs in about 35 s.
   It covers the 8 paths, bonus feasibility, content-vs-graph semantics, and the robustness and
   presentation cases.
4. **player: Pom is invisible during every dialogue.** `respawn()` sets `invuln = 120`, but `update()` returns
   early outside play/bonus, so during a briefing `invuln` never counts down and `render()` keeps her on the
   "blink off" frame (`floor(120 / 4) % 2 === 0`). This is the real cause of critic R1-8 ("only her toot smoke
   shows"): with the box moved, she would still be missing. Fix in render:
   `const blink = sc !== 'dialogue' && this.invuln > 0 && ...` (or count `invuln` down in dialogue too).
5. **ui: dock the dialogue box away from Pom** (critic R1-8). `g.mods.quest.dock(DLG_H)` returns `'top'` when
   Pom is in the bottom band the box covers, otherwise `'bottom'`. In `dialogueBox` use
   `y = dock === 'top' ? 4 : H - h - 1`. Pom spawns at y=316, so area briefings will dock to the top, where no
   cats are flying yet.
6. **ui: HUD quest panel reads `tracked()` and `goal()`** (critic R1-10). In `hud()` (ui index.ts ~446):
   ```ts
   const q = g.mods.quest?.tracked?.() ?? g.content.quests.find(q => s.quests[q.id] === 'active');
   ...
   else { text(ctx, g.mods.quest?.goal?.(q) || 'IN PROGRESS', x1 + 10, 128, C.dim); }  // instead of the generic dots
   ```
   `tracked()` puts quests tied to the current sector first, then the most recently started or milestoned one,
   and skips missed quests. `goal(q, 16)` returns a line of 16 chars or fewer, such as `CLEAR 1 WAVE`,
   `CLEAR ROOFTOPS`, `BOOP BIG SAL`, `MEMORIES 2/4`, `ROUTE OPEN: MAP`, `PERFECT BONANZA`. `progress(q)` now
   reports the memory gate for `secret_route`, so the segment bar shows x/4 there too.
7. **ui: `skipDialogue` must call `g.mods.quest.skipAll()`** (critic R1-9, repeated from round 1). Replace the
   80-iteration loop with `g.mods.quest?.skipAll(); g.mods.audio?.sfx('blip');`. `skipAll()` also handles a
   briefing that is still waiting on the title card, and a closing press that is still held. The ui loop
   handles neither.
8. **audio: speaker voices for `talk`** (critic R1-7). The engine now calls
   `audio.sfx('talk', { voice, pitch })`. `voice` is one of `'gruff' | 'bright' | 'meow' | 'regal' | 'plain'`
   (Biscuit gruff at 0.62, Pom bright at 1.26, Empress regal at 0.9, cats meow at 1.08, pups bright at 1.5).
   `pitch` is a frequency multiplier that already includes a small per-letter wobble. Suggested audio change:
   `sfx(id: string, o?: { voice?: string; pitch?: number })`, passed through `SfxVoices.play(..., o)` to
   `playSfx`, and in `case 'talk'` scale both tones by `o.pitch ?? 1`, with per-voice timbre:
   gruff = `wave 'saw'`, `lp 900`, slower slide (0.06 s); bright = `duty 0.25`, `lp 2600`;
   meow = slide up then down (`slideTo 1.35x`, then a second tone at `0.8x`); regal = `tri` with `vib 6`.
   Rhythm is already fixed in the engine: no blip on spaces, punctuation or a doubled letter, and a per-voice gap
   (gruff 6 ticks, bright 4, others 5).
9. **showcase: `?showcase=dialogue&at=N` should show the typewriter** (critic R1-6). Replace
   `g.mods.quest.dialogue(node); g.mods.quest.dlg.chars = 999;` in src/showcase/index.ts with:
   ```ts
   const at = p.get('at'); g.mods.quest.stage(node, at === null ? undefined : +at);
   ```
   `stage(id, at)` plays `at` ticks of a reader who lets each page finish and presses confirm 45 ticks later,
   with no blips. `--at=30` shows mid-sentence typing with the cursor, `--at=60` stops on a punctuation pause,
   and `--at=260` lands on the second node. No `at` keeps today's fully typed page. The screenshot tool
   already forwards `at`.
10. **ui: the 'TAP OR PRESS A KEY FOR SOUND' toast** joins the stack in critic R1-1. Quest toasts now wait for
   the briefing and the title card. Ui's own sound hint should wait for `g.mods.world.titleCard === 0` and
   `g.state.scene !== 'dialogue'` as well, or move to the title screen.
11. **ui: use `visibleLines()` in `dialogueBox`** (repeated from round 1, item 1). A half-typed word still jumps
   to the next line when it completes.
12. **journal/ui: show missed quests.** `quest.status(id)` returns `'missed'` for an active quest whose route
   was passed by (secret_route after taking the Litter Moon branch). The journal could draw it dimmed with
   "NEXT FLIGHT!" (`goal()` already returns that) instead of "in progress".
13. **content (optional) + core/schema.ts: explicit `track` / `expire` on quests.** The engine derives both for
    `secret_route` from areas.json (memory gate 4 on sky -> nebula, missed on entering moon). Content can also
    state them, and explicit values win:
    `"track": {"memories": 4}, "expire": {"on": "area:enter", "match": {"areaId": "moon"}}` (`expire` may also
    be a list). If added, schema.ts needs `track: 'object?', expire: 'object?'` for quests.
14. **ARCHITECTURE.md section 4/5 additions:** quest API `tracked()`, `focus()`, `goal(q, max?)`, `status(id)`,
    `missed(id)`, `dock(boxH?)`, `stage(id, at?)`, `heldToasts()`; quest toasts are held while a dialogue or
    title card is on screen and released one at a time (36 ticks apart); area briefings wait for the title
    card; the press that closes a conversation is held back from play until released (max 40 ticks).
    `quest:progress` may carry `missed: true`. Quests may declare `track` and `expire`.

### Done in src/quest (round 2)
- Briefings wait for the sector title card. The scene goes to `'dialogue'` at once, so the world holds its intro
  timer, but nothing is drawn until the card is down to 8 ticks. The autopilot never waits.
- NEW QUEST, QUEST COMPLETE, REWARD and progress toasts are held while a conversation or title card is up, then
  released one at a time.
- The closing press never toots: the scene stays in dialogue until fire/confirm is released (max 40 ticks).
- `secret_route` shows memory progress x/4 and closes as missed on the moon branch. The check asserts that
  every sector-bound quest ends done or missed on every path.
- Wave-count quests are kept equal to the area's wave total, and the check flags any mismatch.
- Bonanza feasibility: a fair pilot (real input path, player speed, cooldown, turd cap) clears all 3 layouts
  40/40, so `bonus:result` is no longer rewritten. The shortest cat window is 182 ticks (bonus_clouds).
