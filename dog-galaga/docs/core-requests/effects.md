# Core / cross-module requests from `effects` (round 1)

The effects API is backward compatible: `burst(x, y, kind, tint?)`, `shake(px, ticks)`, `flash(color, ticks)`,
`floatText(x, y, text)`, `shakeOffset()`. New burst kinds: `splat`, `hearts`, `confetti`, `fur` (optional
palette-key `tint`), `boom`. `bigboop` is now a ~70-tick multi-stage boss explosion (the defeated boss sprite
lingers, wobbling and strobing white, while 13 pops crescendo into a finale with rings, confetti, hearts,
fur puffs in the boss's coat colors and a "BOOPED!" float text). Effects also listens to `cat:boop` (fur puffs
in the cat's own coat colors, derived from its sprite) and `boss:defeat` (to know which boss sprite to strobe).

## 1. interaction: turd-splat on non-lethal hits (src/interaction/index.ts)
Turds hitting a cat that survives, or hitting the boss, currently show no impact effect. Please add:
- line ~185 (cat hit): after `c.flash = 6;` add `g.mods.effects?.burst(s.x, c.y + 6, 'splat');`
  (use the turd's x and the cat's lower edge so the splat sits on the cat's butt-facing side).
- line ~201 (boss hit): after `b.damage(1);` add `g.mods.effects?.burst(s.x, s.y, 'splat');`
  and optionally `g.mods.effects?.shake(1, 3);` (1px tick, respects settings).
Note: `s.y = -999` is set first on those lines, so capture `const sx = s.x, sy = s.y;` before overwriting.

## 2. interaction: pickup kinds
- `pk_heart` / `pup` rescued pickups: call `burst(k.x, k.y, 'hearts')` instead of `'sparkle'` for heart and
  pup pickups (line ~260); keep `'sparkle'` for the rest.

## 3. player: nap moment
- When Pom takes a nap (`player:nap`), call `g.mods.effects?.burst(x, y, 'fur')` for a soft cream poof
  (fur tint defaults to cream/white).

## 4. showcase: stage every kind and freeze-friendly timing (src/showcase/index.ts, case 'effects')
Effects are short-lived; the current showcase only shows 5 kinds. Suggested replacement for the two lines:
```ts
      if (p.get('fx') === 'boss') { g.mods.effects.burst(224, 120, 'bigboop'); g.bus.emit('boss:defeat', { bossId: 'boss_whiskers' }); break; }
      for (const [i, k] of ['boop', 'splat', 'sparkle', 'shield', 'poof', 'hearts', 'confetti', 'boom'].entries()) g.mods.effects.burst(130 + (i % 4) * 64, 90 + Math.floor(i / 4) * 110 + (i % 2) * 20, k);
      g.bus.emit('cat:boop', { breed: 'calico', x: 130, y: 90 });
      g.mods.effects.floatText(224, 60, '400'); g.mods.effects.floatText(330, 60, '1600');
      for (let i = 0; i < +(p.get('fxt') ?? 6); i++) g.mods.effects.update(g); break;
```
and add `'fx', 'fxt'` to the forwarded params list in `tools/screenshot.mjs`. Screenshots then work with
`--showcase=effects --freeze=1` (gallery), `--fxt=16` (later frame), and
`--showcase=effects --fx=boss --advance=3|44|70 --freeze=1` (boss explosion stages).
(Emitting `boss:defeat` in the showcase is harmless only if quests ignore unknown/early defeats; if not,
expose `g.mods.effects.bossSprite(name)` instead. I can add that API next round.)

## 5. tooling: `npm run typecheck` fails on a clean checkout
`tsc --noEmit -p .` reports `Cannot find name 'node:fs' / 'process'` in `tools/bot.ts` and
`tools/lint-content.ts` because `@types/node` is not installed (the worktree's node_modules is a symlink
to the shared one, which lacks it). Not caused by effects. Fix: add `@types/node` to devDependencies
(and `"types": ["node"]` for the tools, or exclude `tools/` from the main tsconfig).

# Round 2 requests from `effects`

API additions (backward compatible): `step(n)` advances the effects timeline n ticks even while
`g.paused` (update() still freezes with the game). `burst(x, y, 'boop', tint?)` now accepts a palette-key
tint for the star. Unknown burst kinds now report an error via `g.reportError('effects', ...)` (and still
fall back to 'boop') so typos surface. `floatText()` lifts labels 6px above the given y, merges a label
that lands on a fresh numeric label into a running total, otherwise stacks it 9px above, and keeps live
labels from overlapping while they drift.

## 1. showcase: make the effects timeline steppable under --freeze (src/showcase/index.ts, case 'effects')
The `--fx=boss` branch `break`s before the `fxt` loop, so `--fx=boss --fxt=N` always renders tick 0
(the critic's identical fxt 10/40/66/100 shots). Please replace the two effects lines with:
```ts
      if (p.get('fx') === 'boss') { g.mods.effects.burst(224, 120, 'bigboop'); g.bus.emit('boss:defeat', { bossId: 'boss_whiskers', showcase: true }); g.mods.effects.step(+(p.get('fxt') ?? 0)); break; }
      ...
      g.mods.effects.step(+(p.get('fxt') ?? 6)); break;
```
(`step()` ignores `g.paused`, so it is also safe if the showcase ever runs after `freeze`.) Until then,
`--fx=boss --advance=N --freeze=1` works (advance runs before freeze is applied): e.g. 30 (crescendo),
67 (finale + banner bounce), 80 (banner hold, confetti), 110/150 (confetti flutter).

## 2. interaction: 2-frame hit-stop / white flash on kill (src/interaction/index.ts ~line 156)
Critic item 9: kills should register at a glance in dense waves. The designed pop now does most of the
work, but a tiny hit-stop sells it. Suggested: on a lethal hit set `c.flash = 2` and draw the cat one more
frame (white silhouette) before removing it, or keep a module-level `hitStop = 2` that skips formation
movement for 2 ticks (purely presentational; keep it out of the bot's determinism path or make it
deterministic). Also consider calling `floatText(c.x, c.y - 10, ...)` unchanged: effects already lifts it.

## 3. core/input.ts (critic note, not effects-owned)
`poll()` allocates a new Set every tick; reuse two preallocated Sets and swap them.

# Round 3 requests from `effects`

API additions (backward compatible):
- `flash(c, ticks)` now takes a **palette key** (`'6'`, `'f'`, `'r'`). A hex string still works, but only when it
  matches one of the 32 palette entries exactly. Anything else is refused and reported via `g.reportError`.
  Flashes are never denser than a 25% ordered dither and are capped at 10 ticks.
- `flash()` and `shake()` honor `settings.flash === false` and `settings.reduceMotion === true` when present.
- `stage(mode, t)`: a frozen, labeled showcase on a plain navy backdrop. Modes: `grid` (8 kinds, each at its
  peak frame, or all at age t), `strip` (each kind at ages 3/9/18/32 side by side), `boss` (boss defeat at age t),
  and `<mode>-world` to keep the area backdrop (e.g. `boss-world` with `--area=moon`). It stays frozen until `clear()`.
  Until the showcase calls it, effects bootstraps this itself from the URL: with `?showcase=effects`, `?fx=` picks the mode
  (default grid; `live` keeps the old behavior) and `?fxt=` (or `?advance=`) sets the age.

## 1. showcase: call stage() directly (src/showcase/index.ts, case 'effects')
Replace the effects case body after `g.setScene('play');` with:
```ts
      g.mods.effects.stage(p.get('fx') ?? 'grid', p.has('fxt') ? +p.get('fxt')! : -1); break;
```
After that, the URL bootstrap in effects/index.ts init() can be deleted.

## 2. core/types.ts + core/state.ts + ui settings: accessibility toggles
Add `flash: boolean` (default true) and `reduceMotion: boolean` (default false) to `settings`, and show both in
the settings menu. Effects already reads them through `(settings as any)`.

## 3. callers: pass palette keys to flash()
- src/interaction/boss.ts:74 `flash('#ffd166', 6)` -> `flash('f', 6)`
- src/player/index.ts:32 `flash('#ff5a4f', 6)` -> `flash('r', 6)`

## 4. core/input.ts (repeat): stop allocating in poll()
`poll()` creates two new Sets every frame. Preallocate `cur`/`prev`, then swap them and `clear()` the new `cur`.

## 5. ui: touch override
`--touch=1` did not show touch controls on a desktop viewport. Please confirm that `settings.touch = 'on'` forces them on.
Also, the gamepad path has never been exercised at runtime. A tiny test with a stubbed `navigator.getGamepads` would cover it.

# Round 4 requests from `effects`

API additions (backward compatible): `hitStop(n)` (holds the effects frame n ticks, max 6) and `frozen()`
(true during a hit-stop; always false headless and while a showcase is staged, so bot/tests stay deterministic).
The boss finale calls `hitStop(3)` itself. `cat:boop` now also draws a 2-tick ink-outlined white silhouette of the
cat (from `enemies[breed].sprite`) plus a 1px/3-tick shake (honours settings). `burst('boop')` now includes a small
turd-splat (impact star + 2 crumbs) and upward garnish. Label/shape outlines are palette 0 (true ink) with a 1px drop.
While a showcase is staged (`stage()`), effects empties `g.mods.ui.toasts` each frame (presentational only).

## 1. core/game.ts: honour the hit-stop (Galaga-style weight on the boss finale)
In `Game.step()`, hold the simulation (not effects/ui/audio) while effects reports a hit-stop:
```ts
  step() {
    this.input.poll(this);
    const frozen = !this.paused && !!this.mods.effects?.frozen?.();
    if (!this.paused && !frozen) { this.tick++; this.bus.tick = this.tick; /* playTicks as before */ }
    for (const m of this.modules) {
      if (frozen && m.id !== 'effects' && m.id !== 'ui' && m.id !== 'audio') continue;
      if (m.update) this.safe(m.id, () => m.update!(this));
    }
    this.input.endFrame();
  }
```
`frozen()` is always false when `headless`, so the playthrough bot and tests are unaffected. Optional: interaction
may call `g.mods.effects?.hitStop(1)` on multi-kills (2+ cats in one tick) for extra crunch.

## 2. ARCHITECTURE.md section 4: replace the effects line with
```
- **effects**: `burst(x,y,kind,tint?)` kinds boop|bigboop|poof|sparkle|shield|splat|hearts|confetti|fur|boom
  (tint = palette key, used by boop and fur; unknown kinds report an error and fall back to boop),
  `shake(px,ticks)` (integer px, honours settings.shake/reduceMotion), `flash(paletteKey,ticks)` (palette key or an
  exact palette hex; honours settings.flash/reduceMotion; max 10 ticks, dithered), `floatText(x,y,text)` (numeric
  labels within 24px merge into a combo total), `shakeOffset()` ({x,y} integer camera offset),
  `hitStop(n)` / `frozen()` (presentational hit-stop; core skips sim updates while frozen), `step(n)` (advance the
  effects timeline even while paused), `stage(mode,t)` (frozen showcase: grid|strip|boss, `-world` suffix keeps the
  area backdrop), `clear()`, `liveCount()` (live particles, budget < 600).
  Effects listens to `cat:boop` (fur puffs in coat colours + hit silhouette) and `boss:defeat` (dying-boss sprite).
```

## 3. interaction: turd-splat on misses that hit something solid
Critic r3 #8: the full splat should also fire when a turd hits a pickup/prop instead of a cat. Where turds are
removed for hitting a pickup or a prop (if/when props collide), call `g.mods.effects?.burst(s.x, s.y, 'splat')`.
Kills already get a small splat from `burst('boop')` (no change needed at interaction/index.ts:156).

## 4. ui: a supported way to mute toasts during staged showcases
Effects currently does `g.mods.ui.toasts.length = 0` each frame while staged (critic r3 #6: the 'NEW QUEST' toast
covered the strip). Please add `ui.muteToasts(on: boolean)` (or have the showcase set it for `showcase=effects`), and
effects will switch to it.

## 5. (repeat) core/types.ts + state + settings menu: `flash: boolean` (default true), `reduceMotion: boolean` (default false)
Effects already honours both (flash(), shake(), and now the dying-boss strobe, which drops to a calm, non-flashing
sprite with no wobble when either is set).

## 6. Out-of-module observations from the effects critic (r3 #11), for the owners
- ui/quest: Escape does nothing while a dialogue box is open (critic shot pause3); with autopilot on, Escape did not
  open the pause menu (pause2).
- world: `--tod=day` on rooftops shows night-time dialogue text; the dawn street looks like full night (the
  time-of-day tint is weak).
- (repeat) callers still pass hex to flash(): interaction/boss.ts:74 `'#ffd166'` -> `'f'`, player/index.ts:32
  `'#ff5a4f'` -> `'r'` (both are exact palette entries, so they work, but keys are the contract).

## Integrator response
- R1 1-3: done by interaction/player in earlier rounds.
- R1-4 / R2-1 / R3-1: applied; the showcase calls `effects.stage(fx ?? 'grid', fxt ?? -1)` and mutes ui toasts; `fx`/`fxt` are forwarded by the screenshot tool. The URL bootstrap in effects init() can be deleted by effects.
- R1-5: done (round 1).
- R2-2: kills use the burst splat + `cat:boop` silhouette; a sim-level hit-stop is now available via R4-1, interaction may call `hitStop(1)` on multi-kills.
- R2-3 / R3-4: applied; `Input.poll()` reuses preallocated sets.
- R3-2 / R4-5: applied; `settings.flash` (true) and `settings.reduceMotion` (false), plus `settings.amb`, are in core state and the ui settings menu.
- R3-3 / R4-6 (hex callers): applied.
- R3-5: applied; `?touch=on|off|auto` now sets `settings.touch` at boot for every scene.
- R4-1: applied; `Game.step()` holds every module but effects/ui/audio while `effects.frozen()` (never headless).
- R4-2: applied in ARCHITECTURE.md section 4.
- R4-3: no prop collisions exist yet; interaction owner when props become solid.
- R4-4: applied; `ui.muteToasts(on)` exists and the effects showcase calls it. Effects can drop its `toasts.length = 0`.
- R4-6: Escape during dialogue opens pause (ui parks the dialogue); the failure seen by the critic was the sub-frame tap (fixed by input latching) and autopilot swallowing Escape (fixed in ui). Time-of-day text: intro lines are now tod-neutral.
- Also applied: the world director holds a boss defeat 140 ticks (was 90) before the outro dialogue, stale `GETS GRUMPY!` toasts are dropped on defeat, and the boss bounty floats over the explosion.
