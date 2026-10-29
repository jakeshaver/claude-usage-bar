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

## Round 3 (builder)

Ranked by what the player sees. The quest module did everything it could alone (see "Done in src/quest (round 3)").

1. **tools/screenshot.mjs `--skipDialogue` must call `skipAll()` (now blocking; requested in rounds 1 and 2).**
   `toolSkipLink()` (the URL check in production code, critic R2-4) is deleted, so a deep link plays exactly like
   normal play: the briefing waits for the sector title card. During that wait `quest.dlg` is null
   (the briefing is staged), so the tool's current loop skips nothing and `--skipDialogue --advance=60` shots
   show the briefing box. One-line fix at tools/screenshot.mjs:38, inside the `page.evaluate`:
   ```js
   g.mods.quest?.skipAll?.();
   for (let n = 0; n < 60 && g.state.scene === 'dialogue' && g.mods.quest?.dlg; n++) g.mods.quest.advance();
   ```
2. **vite.config.ts: run the quest check in `npm run verify`** (critic R2-3). `test.include` is
   `['tests/**/*.test.ts']`, so `src/quest/quest.test.ts` never runs. Either
   `include: ['tests/**/*.test.ts', 'src/**/*.test.ts']`, or copy it to `tests/quest.test.ts` with
   `import { runQuestCheck } from '../src/quest/check';`. About 35 s. It now also covers: no crash toast for
   content misses, stage progress equal to the HUD's wave count, a press finishing the page at once, and the
   dialogue review sheet.
3. **content/quests.json `park_pals`** (critic R2-2): change `complete` to
   `{ "on": "area:clear", "match": { "areaId": "park" } }` (drop `count: 7`). The engine already treats it that
   way (`deriveQuest`: "every wave" / a count above half the sector's waves becomes `area:clear`) and prints a
   NOTE until content matches. The HUD now reads PARK PALS 0/11 next to WAVE 1/11 (see item 5).
4. **player: keep Captain Pom visible during briefings** (critic R2-6, repeat of round 2 item 4).
   `respawn()` sets `invuln = 120`, but `update()` returns early outside play/bonus, so during the opening
   briefing `invuln` never counts down and src/player/index.ts:86 keeps her on the blink-off frame: Biscuit's
   "WAKE UP!" plays over an empty lawn. Fix: `const blink = g.state.scene !== 'dialogue' && this.invuln > 0 && ...`
   (or count `invuln` down in dialogue too). Optional: a slow 2-frame idle bob while the scene is 'dialogue'.
5. **ui HUD quest panel: use the engine's `goal()` and `tracked()`** (critic R2-5, repeat of round 2 item 6).
   src/ui/index.ts ~446-452:
   ```ts
   const q = g.mods.quest?.tracked?.() ?? g.content.quests.find(q => s.quests[q.id] === 'active');
   ...
   else { text(ctx, g.mods.quest?.goal?.(q) || 'IN PROGRESS', x1 + 10, 128, C.dim); }
   ```
   With round 3, sector quests (NIGHT OWL, BIG SAL'S RESPECT, PARK PALS) already report stage progress
   (cleared stages / waves + boss, the same total as WAVE n/N), so they get the segment bar. The remaining
   'IN PROGRESS...' line is FIRST FLIGHT (count 1, no sector): `goal()` returns `CLEAR 1 WAVE`.
6. **showcase: `?showcase=dialogue` should show the review sheet** (critic R2-7). Replace the `case 'quest':
   case 'dialogue':` line in src/showcase/index.ts with:
   ```ts
   case 'quest': case 'dialogue': W_.enterArea(area, 0); W_.titleCard = 0; quiet();
     if (p.get('node') || p.get('at')) { const at = p.get('at'); g.mods.quest.stage(p.get('node') ?? W_.area(area).intro ?? 'intro-backyard-1', at === null ? undefined : +at); }
     else g.mods.quest.showSheet();
     break;
   ```
   `showSheet()` draws 5 states with ui's own comm panel, stacked over the playfield, each tagged: gruff
   Biscuit typing (cursor), bright Pom page done (NEXT arrow), regal Empress on a punctuation beat, the second
   page of a long line, and the friendly fallback for a missing id. `--node=` / `--at=` keep the single-box view.
   (Verified with a playwright eval: shots/q3-sheet.png.) The parked-under-pause state is ui's pause menu
   ('BRIEFING ON HOLD'), which `--showcase=ui --menu=pause` already covers if the showcase opens a briefing first.
7. **ui `skipDialogue` should call `g.mods.quest.skipAll()`** (repeat of round 2 item 7): the ui loop does
   nothing while a briefing is staged behind the title card.
8. **content: a local objective for sectors 5-13** (critic R2-8). Only park, alley and rooftops have one;
   after them the panel reads NO ACTIVE QUEST. Suggested short ones (all events exist, the engine already
   shows stage progress n/N and a goal line for these shapes):
   ```json
   { "id": "cafe_rush", "name": "Morning Rush", "desc": "Close down the Purrfect Cup Cafe.", "start": {"on":"area:enter","match":{"areaId":"cafe"}}, "complete": {"on":"area:clear","match":{"areaId":"cafe"}}, "reward": {"score": 3000} },
   { "id": "docks_catch", "name": "Catch of the Day", "desc": "Send Captain Mainsail back to sea.", "start": {"on":"area:enter","match":{"areaId":"docks"}}, "complete": {"on":"boss:defeat","match":{"bossId":"boss_mainsail"}}, "reward": {"score": 3000} },
   { "id": "factory_unravel", "name": "Unravel It", "desc": "Shut down the Yarn Factory.", "start": {"on":"area:enter","match":{"areaId":"factory"}}, "complete": {"on":"area:clear","match":{"areaId":"factory"}}, "reward": {"score": 3000} },
   { "id": "moon_litter", "name": "Scoop Duty", "desc": "Clear the Litter Moon.", "start": {"on":"area:enter","match":{"areaId":"moon"}}, "complete": {"on":"area:clear","match":{"areaId":"moon"}}, "reward": {"score": 3000} },
   { "id": "nebula_sober", "name": "Clear Heads", "desc": "Boop the Catnip Kingpin.", "start": {"on":"area:enter","match":{"areaId":"nebula"}}, "complete": {"on":"boss:defeat","match":{"bossId":"boss_kingpin"}}, "reward": {"score": 3000} },
   { "id": "station_dock", "name": "Docking Clearance", "desc": "Take Scratching-Post Station.", "start": {"on":"area:enter","match":{"areaId":"station"}}, "complete": {"on":"area:clear","match":{"areaId":"station"}}, "reward": {"score": 3000} },
   { "id": "empress_audience", "name": "An Audience", "desc": "Face Empress Fluffington.", "start": {"on":"area:enter","match":{"areaId":"mothership"}}, "complete": {"on":"boss:defeat","match":{"bossId":"boss_empress"}}, "reward": {"score": 5000} }
   ```
   (sky already has `secret_route`.) The check will prove each is reachable and finished on every path that enters it.
9. **ARCHITECTURE.md (quest section):** content problems (malformed quest entries, missing dialogue ids,
   unknown quest ids, bad conditions, event storms) go to `g.contentIssues` as `{file, msg: '[quest] ...'}` and a
   dev `console.warn`, never to `g.errors` (whose entries become the "A CAT KNOCKED OVER ..." toast). Exceptions
   caught inside the engine still use `reportError`. New API: `issue(file, msg)`, `stages(q)`, `showSheet(on?)`,
   `overlay()` (draws the sheet only); `stage(idOrNode, at?)` also accepts an inline node.
10. **Forwarded from the critic (outside quest):** docks at 2x: Siamese and Persian formations overlap (32px sprites
    spaced under one sprite width; interaction/content waves); moon at `--tod=night` has no night grade (world);
    the HUD sector subtitle is clipped to 'WHERE EVERY...' (ui: wrap it into the second line or a ticker).

### Done in src/quest (round 3)
- Content misses never show the crash toast: `quest.dialogue('does_not_exist_zz')` opens Pom's fallback line and
  `quest.start('nope_quest')` is ignored, both logged in contentIssues only (shots/q3-missing.png). Malformed
  quests at boot are reported the same way (the check asserts no `g.errors` and no crash toast).
- `toolSkipLink()` deleted: no production code reads the URL.
- Sector quests show stage progress equal to the HUD's count: PARK PALS 0/11 next to WAVE 1/11, BIG SAL'S
  RESPECT 3/11 next to WAVE 4/11 (shots/q3-park.png, shots/q3-alley.png). `park_pals` finishes on clearing the park.
- One press finishes a typing page at once; holding stays x4 (asserted in the check).
- Dialogue review sheet (`showSheet()`, src/quest/sheet.ts).

## Round 4 (builder)

Ranked by what the player and the critics see. "Done in src/quest (round 4)" at the end lists what the quest
module fixed on its own.

1. **player (BLOCKING, 4th request): Pom is invisible during every briefing.** Not one dialogue capture shows the
   poodle. `respawn()` sets `invuln = 120`; `update()` returns early outside play/bonus, so in `'dialogue'` the
   counter never drops and `render()` stays on the blink-off frame. src/player/index.ts render:
   `const blink = g.state.scene !== 'dialogue' && this.invuln > 0 && Math.floor(this.invuln / 4) % 2 === 0;`
   (or decrement `invuln` while the scene is `'dialogue'`). Galaga never hides the ship.
2. **ui (BLOCKING, 3rd request): dock the comm box away from Pom.** The box covers y 296-360, exactly Pom's spawn
   band (y=316). In `dialogueBox`: `const y = g.mods.quest?.dock?.(h + 3) === 'top' ? 4 : H - h - 1;`.
   `dock()` returns `'top'` while Pom is in the band the box covers. Items 1 and 2 are both needed: either alone
   still shows no poodle.
3. **vite.config.ts / verify (4th request): the quest check never runs in CI.** `test.include` is
   `['tests/**/*.test.ts']`, so `src/quest/quest.test.ts` is ignored (`npx vitest run src/quest`: "No test
   files found"). One-line fix: `include: ['tests/**/*.test.ts', 'src/**/*.test.ts']`, or copy the file to
   `tests/quest.test.ts` with `import { runQuestCheck } from '../src/quest/check';`. About 35 s. `npx tsx
   src/quest/check.ts` passes on this branch (round 4 added staged-briefing input, the tool's skip loop,
   deep-link seeding, HUD reveal timing, boss banter and field-level fallback cases).
4. **content/quests.json `park_pals` (4th request):** still `count: 7`. Replace its `complete` with
   `{ "on": "area:clear", "match": { "areaId": "park" } }`. The engine already behaves that way and prints a NOTE
   until the content matches.
5. **ui HUD quest panel (4th request): read `tracked()` and `goal()`.** src/ui/index.ts ~446:
   ```ts
   const Q = g.mods.quest;
   const q = Q?.tracked ? Q.tracked() : g.content.quests.find(q => s.quests[q.id] === 'active');
   ...
   else { text(ctx, Q?.goal?.(q) || 'IN PROGRESS', x1 + 10, 128, C.dim); }
   ```
   Do NOT fall back to the `find()` when `tracked()` returns null: null is how the engine holds back a quest
   whose NEW QUEST toast has not landed yet (critic R3-6; `revealed(id)` is also exposed). Deep links now seed
   the route's quests (`seedRoute`, automatic), so docks/cafe/moon/factory links show LOST PUPS 0/6, BIG CAT
   TAMER 5/10 etc. instead of NO ACTIVE QUEST.
6. **content: boss banter, the engine path is ready** (critic R3-7). The engine now plays, when present:
   `taunt-<bossId>` when the boss arrives (`boss:start`), and `defeat-<bossId>` as the first word of the
   sector outro (before Biscuit's outro line, so it never cuts the boss explosion). Missing ids are silently
   skipped. Voices already map to these names (Duchess/Madame regal, the rest meow). Suggested nodes for
   content/dialogue.json (portraits exist for every breed):
   ```json
   { "id": "taunt-boss_whiskers", "speaker": "Sergeant Whiskers", "portrait": "portrait_tabby", "text": "This yard is Armada turf now, poodle. Ten-hut!" },
   { "id": "defeat-boss_whiskers", "speaker": "Sergeant Whiskers", "portrait": "portrait_tabby", "text": "Retreat! Regroup! ...Is that a sunbeam?" },
   { "id": "taunt-boss_tom", "speaker": "Tuxedo Tom", "portrait": "portrait_tuxedo", "text": "Black tie only, Captain. You are underdressed." },
   { "id": "defeat-boss_tom", "speaker": "Tuxedo Tom", "portrait": "portrait_tuxedo", "text": "My cummerbund! You will pay for the dry cleaning." },
   { "id": "taunt-boss_duchess", "speaker": "Duchess Fluffbottom", "portrait": "portrait_persian", "text": "A commoner. In MY park. How perfectly ghastly." },
   { "id": "defeat-boss_duchess", "speaker": "Duchess Fluffbottom", "portrait": "portrait_persian", "text": "Fetch my groomer. And my fainting couch." },
   { "id": "taunt-boss_sal", "speaker": "Big Sal", "portrait": "portrait_bengal", "text": "Nobody flies through my alley without paying the tuna tax." },
   { "id": "defeat-boss_sal", "speaker": "Big Sal", "portrait": "portrait_bengal", "text": "Okay, okay. You got moxie, kid. Sal respects moxie." },
   { "id": "taunt-boss_mau", "speaker": "Madame Mau", "portrait": "portrait_siamese", "text": "The rooftops belong to the night, darling. And the night is mine." },
   { "id": "defeat-boss_mau", "speaker": "Madame Mau", "portrait": "portrait_siamese", "text": "Hmph. The moon will remember this, little poodle." },
   { "id": "taunt-boss_patches", "speaker": "Barista Patches", "portrait": "portrait_calico", "text": "One extra-hot latte, coming right at your face!" },
   { "id": "defeat-boss_patches", "speaker": "Barista Patches", "portrait": "portrait_calico", "text": "We are closed! CLOSED! ...Tip jar is by the door." },
   { "id": "taunt-boss_mainsail", "speaker": "Captain Mainsail", "portrait": "portrait_mainecoon", "text": "Arr! This catch is mine, ye soggy little mop!" },
   { "id": "defeat-boss_mainsail", "speaker": "Captain Mainsail", "portrait": "portrait_mainecoon", "text": "Abandon ship! Save the sardines first!" },
   { "id": "taunt-boss_fold", "speaker": "Foreman Fold", "portrait": "portrait_scottishfold", "text": "Shift starts now. Every ball of yarn rolls for the Empress." },
   { "id": "defeat-boss_fold", "speaker": "Foreman Fold", "portrait": "portrait_scottishfold", "text": "I am clocking out. Forever. Tell the union." },
   { "id": "taunt-boss_ace", "speaker": "Ace Pilot Sphynx", "portrait": "portrait_sphynx", "text": "No fur, no drag, no mercy. Try to keep up, fluffball." },
   { "id": "defeat-boss_ace", "speaker": "Ace Pilot Sphynx", "portrait": "portrait_sphynx", "text": "Mayday! Mayday! Somebody get me a sweater!" },
   { "id": "taunt-boss_blue", "speaker": "Commodore Blue", "portrait": "portrait_russianblue", "text": "Welcome to the Litter Moon. Mind the craters. They are not craters." },
   { "id": "defeat-boss_blue", "speaker": "Commodore Blue", "portrait": "portrait_russianblue", "text": "Tactical withdrawal. Very tactical. Extremely withdrawn." },
   { "id": "taunt-boss_kingpin", "speaker": "The Catnip Kingpin", "portrait": "portrait_tabby", "text": "Whoa, duuude. Have you ever, like, really looked at a toy mouse?" },
   { "id": "defeat-boss_kingpin", "speaker": "The Catnip Kingpin", "portrait": "portrait_tabby", "text": "Bummer, man. I am gonna go stare at a wall for a while." },
   { "id": "taunt-boss_admiral", "speaker": "Admiral Floof", "portrait": "portrait_persian", "text": "Battle stations! And someone brush my tail, it is a mess." },
   { "id": "defeat-boss_admiral", "speaker": "Admiral Floof", "portrait": "portrait_persian", "text": "The station is yours. The hairballs in the vents are a gift." },
   { "id": "taunt-boss_empress", "speaker": "Empress Fluffington", "portrait": "portrait_empress", "text": "So the poodle finally comes to kneel. How adorable." },
   { "id": "defeat-boss_empress", "speaker": "Empress Fluffington", "portrait": "portrait_empress", "text": "Fine. FINE. Take your silly pups. I wanted a nap anyway." }
   ```
   `npx tsx src/quest/check.ts` covers the taunt on `boss:start` and the defeat line opening the outro (with
   the outro callback kept).
7. **'Night Owl' and time of day** (critic R3-10): no change needed in quests. content/areas.json already sets
   rooftops `"tod": "night"` and `enterArea` applies it, so in play the quest always runs at night; the critic's
   'DAY' capture came from the tool's `--tod=day` override. (The navy palette at an overridden 'DAY'/'DAWN' is
   a world bug, already forwarded.) Conditions have no time-of-day key, so a `when` gate is not possible anyway.
8. **content: outro-sky-1 says "Ace is out of the fight."** The player never met Ace by name. Change to
   "The Sky Ace is out of the fight." (with item 6, Ace introduces itself with the taunt).
9. **showcase (3rd request): `?showcase=dialogue` should reach the typewriter and the review sheet.** Replace the
   `case 'quest': case 'dialogue':` line in src/showcase/index.ts with:
   ```ts
   case 'quest': case 'dialogue': W_.enterArea(area, 0); W_.titleCard = 0; quiet();
     if (p.get('sheet')) g.mods.quest.showSheet();
     else { const at = p.get('at') ?? p.get('advance'); g.mods.quest.stage(p.get('node') ?? W_.area(area).intro ?? 'intro-backyard-1', at === null ? undefined : +at); }
     break;
   ```
   and `if (g.mods.quest?.overlay) ...` is already called by the renderer. `--at=30` shows typing with the cursor,
   `--at=60` a punctuation beat, `--sheet=1` the 5-state review sheet (the screenshot tool must forward `sheet`:
   add it to the param list at tools/screenshot.mjs:22).
10. **tools/screenshot.mjs `--skipDialogue`**: works again on this branch with no tool change (see Done). The
    one-liner `g.mods.quest?.skipAll?.();` before the loop is still the clearer fix.
11. **ui: 'TAP OR PRESS A KEY FOR SOUND'** (repeat): show it on the title screen or in the side panel, or wait
    until `!g.mods.quest?.briefingPending?.() && !g.mods.world.titleCard`.
12. **ui pause menu (optional):** `pauseItems()` and the 'BRIEFING ON HOLD' line already work for a staged
    briefing (reading `quest.dlg` promotes it). If ui ever stops reading `dlg` before pausing, use
    `g.mods.quest.briefingPending()` instead.
13. **ARCHITECTURE.md quest section:** `dlg` read outside the frame painter promotes a briefing waiting on the
    title card; staged briefings answer confirm/fire/tap (open now, card cut) and back (skip); new API
    `briefingPending()`, `revealed(id)`, `seedRoute(areaId)` (runs automatically on a deep-link
    `area:enter`: nothing cleared and not the start sector), `routeTo(areaId)`, `hasNode(id)`; boss banter ids
    `taunt-<bossId>` / `defeat-<bossId>`; quest validation falls back field by field (only unusable start /
    complete triggers skip an entry).

### Done in src/quest (round 4)
- `--skipDialogue` captures gameplay again (critic R3-1): the `dlg` getter promotes a staged briefing for any
  caller except the frame painter (render-phase flag), so the tool's `advance()` loop and ui's skip loop close
  it. `--area=docks --skipDialogue --advance=600` gives scene=play, Flight Time 00:11 (shots/q4-docks.png).
  No production code reads the URL.
- Staged briefing input (critic R3-2): Enter / Space / tap opens the briefing at once and cuts the title card
  (shots/q4-enter-staged.png), X / gamepad B skips it, Esc pauses with SKIP BRIEFING and BRIEFING ON HOLD
  (shots/q4-pause-staged.png).
- Deep links seed the route (critic R3-5): `seedRoute(areaId)` starts or finishes the quests the shortest flight
  would have (quietly: no toasts, no score). Docks shows LOST PUPS 0/6.
- `tracked()` hides a quest until its NEW QUEST toast is shown (critic R3-6), `revealed(id)` exposed.
- Field-level quest validation (critic R3-9): `reward.score: 'abc'` becomes 0, bad item counts and flags are
  dropped one by one, a bad count becomes 1, bad expire/track/dialogue fields are dropped; each is reported.
- Boss banter hooks (critic R3-7) waiting on content item 6.

## Integrator response (wave 2)
Round 4 (earlier rounds' repeats are covered by the same changes):
- 1 applied: player render skips the blink while scene is 'dialogue'.
- 2 applied: `dialogueBox` docks via `quest.dock(h + 3)`; new optional 3rd arg `dock` so src/quest/sheet.ts (one-line seam) passes 'bottom' and the review sheet keeps its five stacked boxes.
- 3 applied: vitest include is now `['tests/**/*.test.ts', 'src/**/*.test.ts']`; quest check runs in verify (~33 s).
- 4 applied: `park_pals` completes on `area:clear` park (the NOTE is gone).
- 5 applied: HUD reads `tracked()` (no find() fallback when the engine has it) and `goal()`.
- 6 applied: 26 taunt-/defeat- nodes in content/dialogue.json; tools/lint-content.ts counts them as reachable for every area boss.
- 7 noted. 8 applied ("The Sky Ace is out of the fight.").
- 9 applied, with `at` only (not `advance`, which the boot path also reads); tools/screenshot.mjs forwards `sheet`.
- 10 applied: tool calls `quest.skipAll?.()` before its advance loop.
- 11 applied (in audio, small seam): the sound hint waits for play/map with no title card, no pending briefing and no open menu.
- 12 no action. 13 applied in ARCHITECTURE (quest API line + quest schema).
Earlier rounds still open before this wave:
- R1-1/R2-11 visibleLines, R1-2/R2-7/R3-7 skipAll in ui: applied. R1-4 boop_brigade starts on `area:enter` backyard: applied. R1-5/R2-14/R3-9: ARCHITECTURE applied.
- R2-8 speaker voices: declined here, owner audio (sfx's extra `{voice, pitch}` arg is ignored safely today).
- R2-12 missed quests in the journal: owner journal (`status(id)` / `goal()` available).
- R2-13 explicit `track`/`expire` in schema: declined for now; the engine derives both and content does not use them.
- R3-8 sector quests: applied (cafe_rush, docks_catch, factory_unravel, moon_litter, nebula_sober, station_dock); `empress_audience` declined as a duplicate of `home_again`.
- R3-10: forwarded (docks formation overlap: interaction/content; moon night grade: world; subtitle clipping: ui).
