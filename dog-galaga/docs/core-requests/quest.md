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
