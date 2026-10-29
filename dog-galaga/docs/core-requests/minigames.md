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

## Round 2 (wave 2)

4. **ui (right panel during a bonus): align naming with the live counter.** The minigames counter now reads
   one format only: `HITS 07/40`. Please make the right-panel BONANZA slot (`src/ui/index.ts` ~line 457) use
   the same words and format (`HITS 07/40`, not `0 / 40` + `TREATS CAUGHT`), and keep the request-1 fallback
   so the slot is filled during the intro and after the results open (interaction's tally is cleared or
   stale then): `const b = g.mods.interaction?.bonus ?? (g.mods.minigames?.active?.() ? { hits: g.mods.minigames.liveHits(), total: g.mods.minigames.total() } : null);`
5. **ui (wave label during a bonus).** While `g.state.scene === 'bonus'` the WAVE block still shows `WAVE 1/11`
   and the wave progress bar. Please show `BONUS` (or `BONUS 01`, index = `content.bonus.indexOf(def)+1`,
   available as `g.mods.minigames.def`) and hide/replace the wave bar for the duration.
6. **ARCHITECTURE.md, minigames API (updates to request 2).**
   - `startBonus(id)` is ignored while a stage is running (`active()`), and an unknown id only emits
     `bonus:end` when idle.
   - HUD toasts are muted (`ui.muteToasts(true)`) from `startBonus` until the BONUS line is revealed on the
     results board, then restored (only if minigames muted them itself). New toasts during that window are dropped.
   - Score: the bonus is added step by step as the BONUS row counts (perfect: in one go at the reveal);
     `setFlag('perfect_bonus')` happens at the reveal, not when the board opens. Skipping still pays in full.
   - Watchdog: results open if `interaction.mode !== 'bonus'` for 90 fly ticks (no flight running), else after
     `groups*140 + 1800` fly ticks, hard cap 90 s. When minigames opens the board itself it emits
     `bonus:result {id, hits, total, synthetic: true}` so audio plays the results stinger.
   - Results accept fire / confirm (keyboard, gamepad A, touch TOOT) to skip the tail once counting is done.
