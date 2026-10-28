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
