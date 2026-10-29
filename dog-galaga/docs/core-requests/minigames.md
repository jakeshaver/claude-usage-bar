# minigames: core requests

## Round 1 (wave 2)

1. **ui (right panel BONANZA slot during the intro countdown).** `src/ui/index.ts` ~line 459 reads
   `g.mods.interaction?.bonus` for the tally; during the new 168-tick intro (banner + 3-2-1) interaction has not
   started the flight yet, so the slot shows only the header. Suggested fallback:
   `const b = g.mods.interaction?.bonus ?? (g.mods.minigames?.active?.() ? { hits: 0, total: g.mods.minigames.total() } : null);`
   (`minigames.active()` and `minigames.total()` are public now.)
2. **ARCHITECTURE.md, minigames API.** Document: `startBonus(id)` (sets scene 'bonus', emits `bonus:start`, runs an
   intro, then calls `interaction.startBonus(def)`), `active()`, `total()`, `liveHits()`. `bonus:end` payload is
   now `{id, hits, total}` and is ALWAYS emitted (watchdog: `groups*140 + 1800` fly ticks, hard cap 90 s), and
   also when the scene is switched back to 'play' by someone else mid-stage. Score bonus (hits x 100, or 10000
   on a perfect) is added when the results board opens.
3. **showcase (optional).** The bonus showcase can pin presentation states with
   `?showcase=bonus&phase=intro|fly|results|perfect&at=<tick>` (read by the minigames module itself; the
   screenshot tool already forwards `phase` and `at`). Worth listing in the showcase help text.
