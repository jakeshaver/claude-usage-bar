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

## Round 3 (wave 2)

7. **vite.config.ts (tests): run the minigames watchdog tests.** New file `src/minigames/minigames.test.ts`
   (6 tests: throwing `interaction.startBonus`, no-op start, a flight that never reports (fly limit), the scene
   switched to 'play' underneath, the real flight + double-start guard, unknown id). Module owners can only write
   inside their folder, so please widen the include:
   `test: { ..., include: ['tests/**/*.test.ts', 'src/**/*.test.ts'] }`. Verified green with that include
   (`npx vitest run --config <cfg with that include>`: 6/6 pass, ~1.4 s). It typechecks under `tsc --noEmit -p .`.
8. **ui (right panel during `scene === 'bonus'`): no duplicate counter, show the stage instead.** Supersedes
   requests 1, 4 and 5. The live counter now lives only in the playfield (frameless `HITS 07/40` + pip row at
   y 3..17, owned by minigames). Two labels ('HITS' vs 'TREATS CAUGHT') counting the same thing is the critic's
   #2, and an empty BONANZA body during intro/results is #4. Please, whenever `g.state.scene === 'bonus'`:
   - WAVE slot: `BONUS STAGE 01` (index = `g.content.bonus.indexOf(g.mods.minigames.def) + 1`, 2 digits) in
     place of `WAVE 1/11`, the stage name (`def.name`, upper case, e.g. `MAILBOX BONANZA`) on the next line,
     and no wave progress bar.
   - Threat slot (`src/ui/index.ts` ~line 457): header `BONUS STAGE` (not BONANZA), body = the breed mugshot
     plus `NO RETURN FIRE` / `BOOP THEM ALL`, i.e. static stage info, not a second tally. If you prefer to keep a
     number there, use exactly `HITS 07/40` from `g.mods.minigames.liveHits()` / `total()` (always defined while
     `g.mods.minigames.active()`), never interaction's tally (it is empty during the intro and results).
9. **interaction (owner of `bonusPath` / `startBonus`): clean single-file trains (critic #5).** Today each
   squadron flies as 4 side-by-side pairs (`lat: k % 2 ? -8 : 8`, `delay: gi * 140 + Math.floor(k / 2) * 16`), so
   two 32 px cats share a spot 16 px apart and read as clumps. Galaga's challenging stages are single-file trains
   of evenly spaced sprites. Suggested in `src/interaction/index.ts` `startBonus`:
   `lat: 0, delay: gi * 150 + k * 14` (14 ticks x speed 2.5 = 35 px between cats, so no two overlap by more
   than ~0 px on a straight; <= 8 px on the tightest curve), and let consecutive squadrons start >= 150 ticks
   apart so trains of mirrored paths cross rather than stack. Minigames' fly limit (`groups*140 + 1800`) still
   covers it (`groups*150` adds 10 ticks per group, well inside the 1800 slack).
10. **ARCHITECTURE.md (events table + minigames API).**
    - `bonus:start` `{id}`; `bonus:end` `{id, hits, total}` (minigames, always exactly once per start).
    - Add a row: `bonus:result` | `{id, hits, total, synthetic?}` | interaction (flight finished), or minigames
      with `synthetic: true` when its watchdog / a throw opened the board. Audio plays the results stinger on it.
    - Intro: fire / confirm after 40 ticks skips the briefing straight to the 3-2-1. After the first stage the
      flag `bonus_seen` is set (in `finish`), and later stages play a short intro (title at once, no rules line,
      countdown at tick 34, 136 ticks total instead of 168).

## Round 4 (wave 2)

11. **interaction (`startBonus` in `src/interaction/index.ts`, `bonusPath` in `paths.ts`): one clean ribbon per
    squadron (critic r3 #1, still open: request 9 was not applied).** Today's code is still
    `lat: k % 2 ? -8 : 8, delay: gi * 140 + Math.floor(k / 2) * 16`, so cats 2k and 2k+1 launch on the same tick
    16 px apart and two or three 32 px sprites stack into blobs (screenshot `shots/m4-fly.png`, pairs at x ~350-430).
    Please:
    - `lat: 0, delay: gi * 150 + k * 8` at `speed: 2.5` (8 ticks x 2.5 = 20 px of arc between consecutive cats,
      the 18-20 px gap the critic asked for; use `k * 9` for 22 px if the tight curves still overlap outlines).
      Spacing is along the curve (time offset), never lateral, so each squadron is one single-file chain.
    - Keep every lane inside the playfield minus a 16 px margin: today's control points use x = -30 / 480 / 330
      and y up to 330 (`figure8`, `cross`, `default`), which carries whole squadrons over the sidewalks and under the
      right HUD edge. Entry/exit points may stay off-screen, but all *visible* turns should satisfy
      `16 <= x <= 368` (playfield-local, 384 wide) — e.g. clamp interior points to that range, or scale the paths
      `x' = 16 + (x / 448) * 352`.
    - Consecutive squadrons 150 ticks apart so mirrored chains cross instead of stacking. Minigames' fly limit
      (`groups*140 + 1800`) still covers it.
12. **interaction: add the squadron index to the bonus `cat:boop` payload** — `{ ..., bonus: true, group: gi }`
    (store `gi` on the cat in `startBonus`). Minigames already reads `p.group` when present: the live counter then
    fills the real squadron's strip and flashes it white with a `+8` tick when all 8 of *that* squadron are hit.
    Without it, strips fill in hit order (a strip completes every 8 hits).
13. **ui (right panel, `scene === 'bonus'`): no duplicate tally, no empty section (critic r3 #6; supersedes 1/4/5/8).**
    The panel still shows `BONANZA` + `0 / 40` + `TREATS CAUGHT` during the flight (a second counter next to the
    playfield one) and an empty header during intro and results. Please either
    (a) collapse the BONANZA section entirely while `g.mods.minigames?.active?.()`, or
    (b) mirror exactly the playfield number in all three phases: `HITS ${String(m.liveHits()).padStart(2,'0')}/${m.total()}`
        with `m = g.mods.minigames` (both defined from `startBonus` until `bonus:end`), never interaction's tally.
    (a) is preferred: the playfield counter is now a 2x-legible display numeral on an ink plate.
14. **showcase help text:** the bonus showcase also accepts `&hits=N` (fly: the tally is pinned 3 ticks before
    `at`, so `at` shows the squadron-complete flash; results: N hits instead of 70%). The screenshot tool doesn't
    forward `hits`, but it can ride on `--url=http://127.0.0.1:4214/?hits=19`. Note: the capture happens ~140
    ticks into the phase, so `at` values beyond that are not reached.
