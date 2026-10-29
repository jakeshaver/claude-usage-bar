# Player module: requests to the integrator

## Round 1 (wave2/player)

1. **core/input.ts: analog stick values (nice to have).** Gamepad sticks are currently thresholded to digital
   actions at 0.35. Please expose the raw, dead-zoned stick as `input.axis: { x: number; y: number }` (-1..1,
   dead zone 0.2, 0 when no pad / keyboard / touch), filled in `poll()`. The player would then scale its
   acceleration target by `|axis|` for fine steering. Digital `held('left')` etc. must stay as they are
   (the autopilot, touch and keyboard use them).

2. **Module order (keep as is, documentation only).** `player.overlay()` draws Pom's nap pose and the
   floating Zzz *above* the world's nap dim (`world.overlay`), so she reads "spotlit" in the darkened field.
   This relies on `player` coming after `world` in `core/boot.ts` (it does today). Please keep that order,
   and mention it in ARCHITECTURE.md section 4 (player API: `overlay` draws the nap pose).

3. **ARCHITECTURE.md, player API line (documentation only).** Suggested wording:
   `player: pos(), respawn(), setInvuln(ticks), camera: {x} (float; render rounds it), hitbox(), power(kind, ticks),
   buddy (wingpup flag), pupX/pupY (wingpup position, lags Pom by ~9 ticks), overlay (nap pose above the nap dim)`.
   New sprite `poodle_nap` (32x24, 2 breathing frames) is registered by `src/player/sprites.ts`.
