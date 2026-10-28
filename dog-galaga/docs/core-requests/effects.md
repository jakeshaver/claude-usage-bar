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
