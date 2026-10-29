# Poodle Patrol: Architecture

A top-down vertical scrolling shooter in the spirit of Galaga. The player is
**Captain Pom**, a flying poodle who fires turds from her rear at waves of
invading cats. Cozy by design: there is no game over. Losing all hearts means
Pom "takes a nap" and the current wave restarts with score kept.

Stack: TypeScript + Vite, raw Canvas 2D, WebAudio synthesis. **Zero runtime
assets or network**: all pixel art is palette-indexed sprite data in source,
all audio is synthesized, the font is a built-in bitmap font. `vite build`
emits a static bundle that runs offline from any local server.

## 1. Folder layout (one folder per subsystem)

```
src/
  core/        INTEGRATOR-OWNED. loop, rng, bus, state model, content loader,
               conditions, isolation (safe()), public API, palette, input, renderer
  world/       areas, scrolling 32px tile backgrounds, time-of-day tint, area transitions
  player/      poodle movement, hitbox, buddy (rescued puppy wingman), camera follow
  interaction/ turds (projectiles), cats (enemies), formations, dives, damage, bosses, pickups
  save/        versioned save slots, checksum, backup, recovery
  ui/          HUD, title, sector map, pause, settings, dialogue box, ending, touch controls
  audio/       chiptune sequencer, per-area music + ambience, sfx
  effects/     particles, screen shake, flashes, floating score text
  quest/       quest engine (declarative triggers/conditions), dialogue engine
  art/         sprite sheets (palette-indexed strings), sprite cache, tile art, bitmap font
  memories/    collectible memories (polaroids of Pom's human) placed in areas
  minigames/   "Treat Bonanza" bonus stages (Galaga challenging stages)
  journal/     journal screen: quests, memories, cat bestiary
  showcase/    showcase scenes: ?showcase=<module> stages one module in isolation
content/       declarative JSON: areas, waves, enemies, quests, dialogue, items, memories
tools/         screenshot.mjs, bot.ts, lint-content.ts
tests/         vitest: quest graph, save/resume, determinism, sim smoke
docs/          STATUS.json, HANDOFF.md, core-requests/
```

**Ownership rule.** A builder only edits its own folder. Changes to `src/core/`
or to another module are written as a request in `docs/core-requests/<module>.md`
and applied by the integrator.

## 2. Units, rendering, determinism

- **Internal resolution** 640x360, integer-scaled to the largest multiple that fits
  the window (2x on a MacBook Air = 1280x720), `image-rendering: pixelated`,
  `imageSmoothingEnabled = false`. Never fractional scaling.
- **Grid**: 32px tiles for world backgrounds; sprites are 32x32 (cats, poodle,
  bosses 64x64) authored on a 16px half-grid. All positions snap to integer
  pixels at draw time.
- **Layout**: playfield viewport 384x360 centered (x 128..512); side panels 128px
  each hold the HUD. The world is 448px wide; the camera follows the player
  horizontally (lerped, clamped), so the view pans 64px.
- **Depth**: everything in the playfield is drawn in one list sorted by
  `(layer, y)`: Y-sorted depth. Layers: ground(0) shadows(1) actors(2) air(3) fx(4).
- **Palette**: one fixed 32-color palette (`core/palette.ts`). Sprites reference
  palette indices only. Shared integer-only pixel helpers (`pxRing`, `pxDisc`, `pxDither`, `pxShadow`,
  `pxDash`, `pxSpark`) live in `core/pixel.ts`; no `ctx.arc`/strokes/globalAlpha next to pixel art.
- **Determinism**: fixed 60 Hz timestep. All randomness goes through
  `core/rng.ts` (mulberry32), seeded from `hash(saveSeed, areaId, waveIndex)`.
  `Math.random` is banned in src/ (lint check). Same seed + same inputs = same run.
- **Time of day is lighting, not a tint**: segments are painted into a palette-index buffer in day
  colours, then remapped one palette entry to one palette entry per material (no dither on large areas,
  `src/world/paint.ts`). Day is the brightest key; dawn is cool with pink sky reflections, long lavender
  shadows cast down-left and peach rim light on top edges; dusk drops lights one step, with long plum
  shadows to the east and amber rim light on west faces; night is navy/indigo about 30% darker, with warm
  lit windows and small hard-edged sodium lamp cones. Backgrounds are far / main / fg layers of 448x256
  segments painted once and cached; rare fast foreground flyers (birds, leaves, steam) are drawn per frame.
- **Hit-stop**: `Game.step()` skips every module except effects, ui and audio while
  `g.mods.effects.frozen()` is true (a few ticks on big impacts). `frozen()` is always false headless,
  so the bot and tests never see it.

## 3. Shared game state (`core/state.ts`)

```ts
interface GameState {
  version: number; seed: number;
  scene: 'boot'|'title'|'map'|'play'|'dialogue'|'bonus'|'ending'|'recovery';
  areaId: string; waveIndex: number; tod: 'dawn'|'day'|'dusk'|'night';
  score: number; hiScore: number; hearts: number; maxHearts: number;
  flags: Record<string, boolean>;
  quests: Record<string, 'locked'|'active'|'done'>;
  inventory: Record<string, number>;
  memories: string[];               // collected memory ids
  areasCleared: string[];
  stats: { shots: number; hits: number; naps: number; playTicks: number; catsBooped: number };
  settings: { music: number; sfx: number; amb: number; shake: boolean; flash: boolean;
              reduceMotion: boolean; touch: 'auto'|'on'|'off' };
}
```
Only `core/state.ts` mutates state structurally; modules call `state.setFlag`,
`state.addItem`, `state.addScore`, etc., which emit events.

## 4. Event bus and module APIs

`core/bus.ts`: typed `on(evt, fn)`, `emit(evt, payload)`. Listener exceptions are
caught (isolation). Core events:

| event | payload | emitted by |
|---|---|---|
| `area:enter` / `area:clear` | `{areaId}` | world |
| `wave:start` / `wave:clear` | `{areaId, waveIndex}` | interaction |
| `boss:start` / `boss:defeat` | `{bossId}` (defeat also `napped`) | interaction |
| `boss:hp` | `{hp, max}` | interaction |
| `boss:phase` | `{bossId, phase}` (1 at 2/3 hp, 2 at 1/3 hp) | interaction |
| `cat:boop` | `{breed, x, y, points}` | interaction |
| `player:hit` / `player:nap` | `{hearts}` | player |
| `item:get` | `{itemId, count}` | interaction / state |
| `memory:get` | `{memoryId}` | memories |
| `flag:set` | `{flag, value}` | state |
| `quest:update` | `{questId, state}` | quest |
| `dialogue:open` / `dialogue:close` | `{nodeId}` | quest |
| `scene:change` | `{from, to}` | core |
| `bonus:start` / `bonus:end` | `{id, hits}` | minigames |
| `save:written` / `save:recovered` | `{slot}` | save |
| `ending` | `{endingId}` | world |
| `error` | `{module, message}` | core/safe |

Each module exports a `Module` object:

```ts
interface Module { id: string; init?(g: Game): void; update?(g: Game): void;
                   render?(g: Game, r: Renderer): void; showcase?(g: Game): void }
```
The loop calls `update`/`render` through `safe(moduleId, fn)`.

Module public APIs (what other modules may call via `g.mods.<id>`):

- **world**: `enterArea(id)`, `currentArea()`, `setTod(tod)`, `transition(kind, cb)`, `exitsFrom(id)`
- **player**: `pos()`, `respawn()`, `setInvuln(ticks)`, `camera: {x}`, `hitbox()`
- **interaction**: `startWave(areaId, i)`, `startBoss(id)`, `liveCats()`, `clearAll()`, `spawnPickup(id,x,y)`
- **save**: `save()`, `load(slot)`, `hasSave()`, `wipe()`, `exportString()`, `importString(s)`
- **ui**: `toast(text)`, `muteToasts(on)`, `openPause()`, `openMap()`, `showDialogue(nodeId)`.
  Escape opens the pause menu in play, bonus, map and dialogue (the conversation is parked while it is open,
  and `quest.update` idles while `g.paused`)
- **audio**: `music(trackId)`, `ambience(id)`, `sfx(id)`, `setVolumes()`. Each area plays exactly its
  `music` id from content (a key of `TRACKS`); sfx ids are linted against `SFX_IDS`. Window-free offline
  renderers live in `audio/offline.ts` (lazy chunk, used by `?showcase=audio`)
- **effects**: `burst(x,y,kind,tint?)` kinds boop|bigboop|poof|sparkle|shield|splat|hearts|confetti|fur|boom
  (tint = palette key, used by boop and fur; unknown kinds report an error and fall back to boop),
  `shake(px,ticks)` (integer px, honours settings.shake/reduceMotion), `flash(paletteKey,ticks)` (palette key or an
  exact palette hex; honours settings.flash/reduceMotion; max 10 ticks, dithered), `floatText(x,y,text)` (numeric
  labels within 24px merge into a combo total), `shakeOffset()` ({x,y} integer camera offset),
  `hitStop(n)` / `frozen()` (presentational hit-stop; core skips sim updates while frozen), `step(n)` (advance the
  effects timeline even while paused), `stage(mode,t)` (frozen showcase: grid|strip|boss, `-world` suffix keeps the
  area backdrop), `clear()`, `liveCount()` (live particles, budget < 600).
  Effects listens to `cat:boop` (fur puffs in coat colours + hit silhouette) and `boss:defeat` (dying-boss sprite).
  The world director holds a boss defeat ~140 ticks before the outro dialogue so the finale plays out
- **quest**: `check()`, `start(id)`, `dialogue(nodeId)`, `available()`
- **memories**: `placed(areaId)`, `collect(id)`
- **minigames**: `startBonus(id)`
- **journal**: `open()`

The **public game API** is `window.__game` (used by tools, tests and the bot):
`ready`, `getState()`, `setState(partial)`, `goto(scene, opts)`, `enterArea(id)`,
`setTod(tod)`, `step(n)` (advance n fixed ticks, works while paused), `input(keys)`,
`autopilot(on)`, `questGraph()`, `errors()`, `fps()`, `save()`, `load()`.

## 5. Content schema (declarative, never hardcoded)

All in `content/*.json`, validated by `core/schema.ts` at load time and by
`tools/lint-content.ts` in CI.

- `areas.json`: `{id, name, tileset, music, ambience, tod, waves:[waveId], boss, exits:[{to, when?}], intro?, outro?, bonus?, ending?}`
- `waves.json`: `{id, formation:{cols, rows, spacing}, cats:[{breed, row}], entry:'swirl-left'|..., diveRate, fireRate}`
- `enemies.json`: `{id, name, sprite, hp, points, diver, shooter, behavior, bestiary}`
- `quests.json`: `{id, name, desc, start:{on, when?}, complete:{on, when?, count?}, reward:{flags?, items?, score?}}`
- `dialogue.json`: `{id, speaker, portrait, text, next?, when?}`
- `items.json`: `{id, name, sprite, effect:{kind, value, ticks?}}`
- `memories.json`: `{id, area, wave, title, text}`

**Conditions** (`core/conditions.ts`): `{flag}`, `{notFlag}`, `{quest, is}`,
`{item, min}`, `{cleared}`, `{memories, min}`, `{all:[...]}`, `{any:[...]}`, `{not}`.
**Triggers** are an event name plus optional condition.

## 6. Quest graph and no-softlock guarantees

Areas form a DAG from `backyard` to `mothership`. Every area has at least one
unconditional exit or is an ending. Gating conditions only add *optional*
exits. Waves cannot stall: a wave that runs longer than 75s makes remaining cats
"lose interest" and fly off. Naps restart the wave, never the run.
`tests/questgraph.test.ts` enumerates every path through the graph and runs the
headless sim along each to prove each reaches an ending.

## 7. Isolation

- `safe(module, fn)`: catches, logs to `g.errors`, shows an in-game toast
  ("The cat knocked something off the table: <module>"), disables a module's
  render/update after 30 consecutive failures, game continues.
- Content: each file is validated independently; invalid entries are dropped,
  a malformed file falls back to built-in defaults (`core/fallback.ts`), and a
  friendly banner is shown.
- Saves: JSON + checksum + backup slot. Corrupt → recovery screen offering
  "Load backup" or "Start fresh". Never crashes, never silently loses a run.

## 8. Performance budget

- Steady 60 fps on a mid-range laptop (<4 ms update+render per frame typical).
- Load to interactive under 5 s (target <1 s: no assets to fetch).
- Bundle: total `dist/` under **1 MB** (the hard budget). The main JS chunk is ~515 KB uncompressed
  (~145 KB gzip), mostly palette-indexed sprite sheets and song data; vite warns above 600 KB
  (`chunkSizeWarningLimit`). The offline audio renderer is a separate lazy chunk.
- No allocations in hot loops where avoidable; sprite canvases cached once.

## 9. Verification loop

- `npm run lint:content`: schema + reference + reachability lint.
- `npm run bot`: headless playthrough bot over every quest-graph path (Node, imports the sim).
- `npm run shot -- --area=x --tod=night --state=...`: headless Chromium PNG + JSON log.
- `npm test`: vitest (quest graph, save/resume, determinism).
- `?showcase=<module>` stages a single module for screenshots. Useful params (forwarded by
  `tools/screenshot.mjs`): interaction `--stage=lineup|capturer|rescue|splitter|tank|dive|tell|boss|bullets|play
  --at=N --phase=1|2`; effects `--fx=grid|strip|boss[-world] --fxt=N`; ui `--menu=pause|settings --touch=on`;
  audio (the tool waits for every offline render). `--skipDialogue` closes the intro dialogue of an `--area`
  deep link before `--advance` runs.
