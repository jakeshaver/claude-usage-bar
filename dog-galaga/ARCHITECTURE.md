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
- **Palette**: one fixed 32-color palette (`core/palette.ts`). Captain Pom's signature: cool cream fur shaded
  pale-lavender/lavender plus a teal flight harness; keep those off the cat roster. Sprites reference
  palette indices only. Shared integer-only pixel helpers (`pxRing`, `pxDisc`, `pxDither`, `pxShadow`,
  `pxDash`, `pxSpark`) live in `core/pixel.ts`; no `ctx.arc`/strokes/globalAlpha next to pixel art.
- **Determinism**: fixed 60 Hz timestep. All randomness goes through
  `core/rng.ts` (mulberry32), seeded from `hash(saveSeed, areaId, waveIndex)`.
  `Math.random` is banned in src/ (lint check). Same seed + same inputs = same run.
- **Time of day is a palette remap**: segments are painted into a palette-index buffer in day colours, then each
  time of day applies a hand-authored palette index -> palette index table (`world/paint.ts` `TOD_RAMP`,
  `INDOOR_RAMP`, `SPACE_RAMP`, plus per-tileset `ramps` in `world/tiles.ts`) when the segment is cached. Every
  time-of-day table maps each palette index to exactly ONE palette index (`remap()` in `world/paint.ts` refuses
  two-entry mixes), so no pixel of the playfield is a two-colour checkerboard at any hour; dither is only allowed for
  small local light falloff (lamp pool rings, beam edges). `src/world/tools/checker-share.mjs` measures the strict
  1px checker share for all 13 areas x 4 times of day against a running preview (target < 5%). Shadows cast onto a
  lower parallax layer are one solid deep tone. Low-light lawns keep one index per pixel: the ground remaps to one
  colour per hour and, at dawn/dusk only, a carpet of short vertical grass blades (remapping to dark green) sits on
  it, so lawns read teal-green at dawn and olive at dusk. Space tilesets have their own milder remaps (metal never
  turns brown); sky gradients are stepped solid bands. Day is brightest and most neutral; dawn is
  cooler and a little lower (grey-green lawns, slate stone, peach-pink highlights and top edges); dusk is warm and
  15-20% lower (olive lawns with ochre/orange tips, warm taupe stone, deeper woods, plum shadows cast long to the
  east); night is dark but keeps material hues (teal-green grass, brown wood, slate stone, blue water) with lit
  windows, lanterns and lamps. Lamp pools are centred under a visible lamp head: one solid lit colour per material
  with a 2px falloff ring (1px solid, 1px 50%), never clipped to a path or tile edge. All background layers, fg
  included, are drawn in the world's z -10 pass, so scenery never covers Pom. Backgrounds are far / main / fg layers
  of 448x256 segments painted once and cached; rare fast foreground flyers (birds, leaves, steam) are drawn per frame.
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
  quests: Record<string, 'locked'|'active'|'done'|'missed'>;   // 'missed': closed, terminal, no reward
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
| `cat:boop` | `{breed, x, y, points, glow, bonus, group?}` (`group` = bonus squadron index) | interaction |
| `player:hit` / `player:nap` | `{hearts}` | player |
| `item:get` | `{itemId, count}` | interaction / state |
| `memory:get` | `{memoryId}` | memories |
| `flag:set` | `{flag, value}` | state |
| `quest:update` | `{questId, state}` | quest |
| `quest:progress` | `{questId, have, need, missed?}` | quest |
| `dialogue:open` / `dialogue:close` | `{nodeId}` | quest |
| `scene:change` | `{from, to}` | core |
| `bonus:start` / `bonus:end` | `{id}` / `{id, hits, total}` (end: always exactly once per start) | minigames |
| `bonus:result` | `{id, hits, total, synthetic?}` (audio plays the results stinger) | interaction (flight finished), or minigames with `synthetic: true` when its watchdog opened the board |
| `save:written` / `save:recovered` | `{slot}` | save |
| `ending` | `{endingId}` | world |
| `error` | `{module, message}` | core/safe |

Each module exports a `Module` object:

```ts
interface Module { id: string; init?(g: Game): void; update?(g: Game): void;
                   render?(g: Game, r: Renderer): void; overlay?(g: Game, ctx): void;
                   overlayZ?: number /* overlay order, default 0, higher on top */ }
```
The loop calls `update`/`render` through `safe(moduleId, fn)`.

Module public APIs (what other modules may call via `g.mods.<id>`):

- **world**: `enterArea(id)`, `currentArea()`, `setTod(tod)`, `transition(kind, cb)`, `exitsFrom(id)`
- **player**: `pos()`, `respawn()`, `setInvuln(ticks)`, `camera: {x}` (float; render rounds it), `hitbox()` (10x10
  around the mane), `power(kind, ticks)`, `buddy` (wingpup flag), `pupX/pupY` (wingpup, lags ~9 ticks), `autoFire`
  (touch tap toggle), `wakeT` (ticks left of the post-nap wake-up; no control meanwhile), `overlay` (nap pose and Zzz
  above the world's nap dim: relies on `player` coming after `world` in `core/boot.ts`). `MIN_Y`/`MAX_Y` = 196/316,
  start/respawn at (224, 300). Pom never blinks during `'dialogue'` (invulnerability only counts down in play/bonus).
  Steering reads the digital actions plus `input.axis` (analog stick). Hitbox marker: shown while a threat is within
  44x52 px (lingers 24 ticks); invulnerability = 10-tick white flash, then a clean 4-on/4-off blink. Sprites `pom*`
  (bank set, stretch, nap, wingpup `pom_pup*`, `@dusk`/`@night` variants, `!w` flash) come from `src/player/pom-art.ts`;
  `poodle_nap` is an alias of `pom_nap`. `?showcase=player&filter=gallery` draws the frame gallery
- **interaction**: `startWave(areaId, i)`, `startBoss(id)`, `liveCats()`, `clearAll()`, `spawnPickup(id,x,y)`,
  `startBonus(def)` (one single-file train of 8 per squadron: 9 ticks apart along the curve, squadrons 150 ticks
  apart), `markGlow()`, `grounded()` (false in airborne sectors: no ground shadows), `wavePreview(areaId, i)`
  (pure: per-breed `{breed, n}` head counts startWave would spawn; feeds ui's next-wave preview). Formations are a
  true Galaga lattice: every cat owns one 32x32 cell for the whole wave (holes stay holes; a fully booped row lets the
  rows below move up), at most 8 columns, centred on the area's lane walls (`LANES` in `interaction/formation.ts`;
  world owners: tell interaction if a stage's walls move; street `[112, 336]`, alley `[98, 350]`). The outermost
  cat keeps 16 px of air to the lane walls at the far end of its sway (`WALL_GAP`). Waves allow 2 player turds on
  screen (bosses and bonus stages 4). Memory carriers' look is drawn by memories, not here.
  Wave variety: 10 formation shapes in a ring (`galaga flanks block vee diamond barrel pillars arrow wings chevron`),
  one step per wave from `areaIdx * 3` (`formation.shapeFor`; the lattice-like family galaga/block/barrel/arrow never
  appears twice in a row), and 9 entries (content's five plus `convoy`, `drop`, `flank`, `escort`; `formation.entryFor`
  never repeats an entry on consecutive waves). Streams loop in the open field under the rack (or down the side
  gutters), then rise straight into their column; every column fills top cell first, so no entering cat crosses a
  parked one (`src/interaction/waves.test.ts`). The caged pup rides one row pitch above a top-row capturer.
  Dives: a diver leaves through an empty column beside it, straight down to just under the rack, and only there
  turns toward Pom; wingmates are locked to the leader's arc position (32 px beside or 44 px behind), separate dive
  groups yield to each other, and capturer beams start only well below the rack.
  Big Cats: hp is content's `hp` with a floor of `max(230, 160 + 8 * areaIndex)` (content now carries those values).
  Every fight has an escort squad of the sector's own breeds (minus capturers): 4 (two pairs) through sector 10, 6
  after, +2 once grumpy (max 6), streaming in with the entrance swoop in a wedge under the boss (shoulders +-34, wings
  +-66, rear guard), peeling off in Galaga dives and topped up 60 ticks after the squad drops to one. Escorts are
  ordinary cats (normal `cat:boop`, breed points) and fly off on `boss:defeat`; the boss's drift and charges keep
  inside `interaction.bossRange()`. Each hit scores `10 + 10*phase + 5*tier`; a phase change pays
  `250 * phase * (1 + tier)` with 3 frames of a white-hot palette swap (outline and shading kept), then a red/gold
  palette cycle, hit-stop, boom burst, shockwave ring and reinforcements
- **save**: `save()` (throttled), `flush()`, `load(slot = 'main')` (`'main'` | `'backup'`: the slot tried
  first; returns `'ok'` | `'recovered'` | `'corrupt'` | `'none'`; legacy `load(false)` = load without resuming),
  `hasSave()`, `wipe()` (keeps hi score + settings), `info()` (slot health, `persistent`), `recoveryOptions()`
  (recovery card wording: `rows`, `status`, `doomed`, toasts), `exportString()` / `importString(s)`
  (`POODLE1:` save codes), `stage(name)` (showcase: `recovery` | `recovery-backup` | `recovery-nibbled` |
  `indicator` | `indicator-touch` | `indicator-memory`). Draw helpers: `drawFloppy` (16x16 master floppy;
  `chewed`, `memory`, `mono`, `plate`), `FLOPPY7` (7x7 menu glyph), `drawRecoveryCard`, `drawChewMedallion`.
  Overlay draws at `overlayZ = 100` (on top of ui). Ctrl/Cmd+C / Ctrl/Cmd+V copy / paste a save code on the
  title, map, pause menu and recovery screen.
- **ui**: `toast(text, opts?)` (`opts.kind`: `'warn'` = bad news, peri frame + pink cross; `'good'` = lime text;
  omitted = bad news matched from the text; `g.toastFn` forwards opts), `muteToasts(on)`, `holdToasts(on)` (at most 2
  toasts on screen, 1 in a live wave / boss fight, the rest queue; none once the scene is `'ending'`). In play and
  bonus toasts sit in a reserved strip at the bottom of the playfield (below Pom's lowest flight row, stacking
  upward), never over the formation or the boss; on the sector map they dock under the header bar; news waits through
  a Big Cat's intro. `toastWaiting(text)` (queued here but not on screen yet) lets quest reveal a NEW QUEST only once
  its toast is up. The HUD sector header and the map's sector log share one short name table (`LOG_SHORT`). The RESCUED
  album count reads `memories.albumShown()`; the ending card lists `quest.endingRewards()` under the stats,
  a static sound chip on the header row (reads `audio.running()` + volumes; the only sound widget), `openPause()`, `openMap()`, `showDialogue(nodeId)`,
  `dialogueBox(g, ctx, dock?)` (docks to the top while `quest.dock()` says Pom is under it; body lines from
  `quest.visibleLines()`), `dev()`, `touch.visible(g)`, `bestChain`. The HUD quest slot reads `quest.tracked()` /
  `goal()`; during `'bonus'` the wave slot reads `BONUS STAGE nn` + the stage name and the threat slot shows static
  stage info (the only live counter is minigames' playfield `HITS nn/40`). While the journal is open ui draws only
  the journal. On title/recovery toasts sit just above the hint row.
  Escape opens the pause menu in play, bonus, map and dialogue (the conversation is parked while it is open,
  and `quest.update` idles while `g.paused`)
- **audio**: `music(trackId)`, `ambience(id)`, `sfx(id)`, `setVolumes()`. Each area plays exactly its
  `music` id from content (a key of `TRACKS`); sfx ids are linted against `SFX_IDS`. Window-free offline
  renderers live in `audio/offline.ts` (lazy chunk, used by `?showcase=audio`). `running()` (true once sound is
  audible) feeds ui's sound chip; audio draws no overlay of its own
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
- **quest**: `check()`, `start(id)`, `dialogue(nodeId, done?)`, `available()`, `advance()`, `skipAll()` (bounded;
  also opens-and-skips a briefing staged behind the title card), `typing()`, `visibleLines()`, `cols`/`rows` (51x3,
  long text is paged), `progress(q)`, `complete(q)`, `stages(q)`, `tracked()` (hides a quest until its NEW QUEST toast is on
  screen: quest's own queue and ui's, via `ui.toastWaiting`), `focus()`, `goal(q, max?)`, `status(id)` (`'missed'` for a passed-by route), `missed(id)`,
  `revealed(id)`, `dock(boxH?)`, `stage(idOrNode, at?)`, `showSheet(on?)` (review sheet, drawn by quest's
  `overlay`), `heldToasts()`, `briefingPending()`, `seedRoute(areaId)` (automatic on a deep-link `area:enter`),
  `routeTo(areaId)`, `hasNode(id)`, `issue(file, msg)`. Reading `dlg` outside the frame painter promotes a briefing
  waiting on the title card. Area briefings wait for the sector title card; quest toasts are held while a dialogue or
  title card is up and released one at a time; the press that closes a conversation is held back from play (max 40
  ticks). `dialogue(id, done)` while a conversation is open: one without `done` is replaced, one with `done` queues.
  Boss banter: `taunt-<bossId>` plays on `boss:start`, `defeat-<bossId>` opens the sector outro (missing ids are
  skipped). Content problems go to `g.contentIssues` (`[quest] ...`), never to `g.errors`. A quest whose window
  passes is stored as `'missed'`: an `expire` trigger fired (route forfeit) or the `ending` event closed every quest
  still active (quietly). Presentation: `look(id)` (`{state, tone: locked|active|done|missed|expired, pill, tag,
  note, dimReward}`), `closedBy(id)` ('route' | 'run' | null), `flightMax()` (most quests one flight can reach),
  `routeNote(areaId)` (NEXT HOP line: `{kind: finishes|closes, questName, text, good, more}` or null),
  `completes(areaId)` / `forfeits(areaId)`, `preferredExit(exits)`, `endingRewards()` (`{questId, name, score, items,
  text}[]` paid quietly during the finale; cleared on `game:new`). Quest toasts carry `{kind: 'warn'|'good'}` for
  route news, and go quiet once the final Big Cat is defeated (queued toasts, on-screen toasts and ui's `toastPend`
  are dropped)
- **memories**: `placed(areaId)`, `collect(id)`, `offer(areaId, wave)`, `missed(areaId, wave)`, `panelCard()`,
  `albumShown()`, `revealing()` / `showing()` / `frozen()` (kept, always false), `calm()`,
  `stage(kind, index, at)` (carrier|drop|boop|reveal|lost|bundle|file, frozen). The memory carrier wears a 2px gold
  silhouette rim (solid gold at night) with walking shimmer, a pixel crown and the polaroid in its mouth drawn above
  all cats. Booping it is a beat: 4-tick hit-stop, a 2-frame white silhouette flash, a 2px 8-ray star. The photo
  sways down to Pom inside a 1px gold outline and a sparse dither glint (teal when recovered). Catching it never
  pauses play: a sparkle and a rising '+1 MEMORY' (full 1px ink outline) pop at the pickup point. The memory card
  slides over the right HUD panel (y 119..289; compact 119..230; overlayZ 50, hidden while a menu is open or outside
  play/bonus, its clock parked) for ~3.8 s: one title size (1x), the whole memory text (scrolls 1px at a time if one
  or two lines long), no N/18 number on the card. A memory whose body would not fit under the 64x62 polaroid shows the 32x31 half
  polaroid instead, so its last line is on screen without waiting for the scroll; the lifted photo never rises above
  the header's dashed rule. The polaroid hops into the album counter, which holds the old count
  (`albumShown()`) until it lands, then the SECTOR GOALS MEMORIES row pulses. A bundle (2+ photos) pages by itself at
  >= 110 ticks a page: up to 4 photos, or 3 plus a '+N MORE PHOTOS' page; its pager dots sit on the header row. Lost
  photos get a 'RECOVERED' rubber-stamp print on a solid chin-coloured backing. `panelCard()` = side card up or parked. A missed memory (route not taken) returns
  as a LOST MEMORY on the next wave's carrier; the final sector brings the whole backlog, so 18/18 is reachable on
  every route. Derived from content + state, no save data
- **minigames**: `startBonus(id)` (sets scene 'bonus', emits `bonus:start`, intro, then `interaction.startBonus`;
  ignored while `active()`), `active()`, `total()`, `liveHits()`, `def`. Toasts are muted from start until the BONUS
  row is revealed. Watchdog: results open after `groups*140 + 1800` fly ticks (hard cap 90 s, or 90 ticks with no
  flight); `bonus:end` is always emitted, also when the scene is switched away mid-stage. Score is paid as the BONUS
  row counts; `perfect_bonus` is set at the reveal; `bonus_seen` after the first stage (later intros are short)
- **journal**: `open()`, `seedDemo()` (showcase demo save, restored on close), `tab`, `viewer`, `draw(g, ctx)`,
  `update2(g, close)`. Pages flip on the `pageL`/`pageR` actions (Tab/Shift+Tab journal-local). Reads `wave:start`
  `{areaId, waveIndex}`, `boss:defeat` `{bossId}`, `cat:boop` `{breed}` and `ui.bestChain`

**Input** (`core/input.ts`): actions `left right up down fire pause confirm back pageL pageR` (keyboard, gamepad,
touch, synthetic; `pageL` = Q / PageUp / LB, `pageR` = E / PageDown / RB), `held(a)`, `pressed(a)`,
`lastDevice`, and `axis: {x, y}` (left stick, radial dead zone 0.2, magnitude remapped to 0..1; 0 with no pad).
- **memories**: `placed(areaId)`, `collect(id)`
- **minigames**: `startBonus(id)`
- **journal**: `open()`

The **public game API** is `window.__game` (used by tools, tests and the bot):
`ready`, `getState()`, `setState(partial)`, `goto(scene, opts)`, `enterArea(id)`,
`setTod(tod)`, `step(n)` (advance n fixed ticks, works while paused), `input(keys)`,
`autopilot(on)`, `questGraph()`, `errors()`, `fps()`, `save()`, `load()`, `exportSave()`, `importSave(code)`.

## 5. Content schema (declarative, never hardcoded)

All in `content/*.json`, validated by `core/schema.ts` at load time and by
`tools/lint-content.ts` in CI.

- `areas.json`: `{id, name, tileset, music, ambience, tod, waves:[waveId], boss, exits:[{to, when?}], intro?, outro?, bonus?, ending?}`
- `waves.json`: `{id, formation:{cols, rows, spacing}, cats:[{breed, row}], entry:'swirl-left'|..., diveRate, fireRate}`
- `enemies.json`: `{id, name, sprite, hp, points, diver, shooter, behavior, bestiary}`
- `quests.json`: `{id, name, desc, start:{on, match?, when?}, complete:{on, match?, when?, count?}, reward:{flags?, items?, score?}, dialogue?, track?, expire?}`
  (`expire?: Trigger | Trigger[]` closes the quest as 'missed' when any trigger matches; derived from gated exits
  when absent. `match` compares payload fields loosely; `count` defaults to 1 and the start event counts when it matches; a
  quest's `dialogue` plays when it starts; validation falls back field by field, only unusable triggers skip a quest)
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
- Bundle: total `dist/` under **1 MB** (the hard budget). The main JS chunk is ~735 KB uncompressed
  (~220 KB gzip), mostly palette-indexed sprite sheets, tile painters and song data; vite warns above 800 KB
  (`chunkSizeWarningLimit`). The offline audio renderer is a separate lazy chunk.
- No allocations in hot loops where avoidable; sprite canvases cached once.

## 9. Verification loop

- `npm run lint:content`: schema + reference + reachability lint.
- `npm run bot`: headless playthrough bot over every quest-graph path (Node, imports the sim).
- `npm run shot -- --area=x --tod=night --state=...`: headless Chromium PNG + JSON log.
- `npm test`: vitest over `tests/**` and `src/**/*.test.ts` (quest graph, save/resume, save self-test,
  determinism, quest engine check, memories, minigames watchdog).
- `?showcase=<module>` stages a single module for screenshots. Useful params (forwarded by
  `tools/screenshot.mjs`): interaction `--stage=lineup|capturer|rescue|splitter|tank|dive|tell|boss|bullets|play
  --at=N --phase=1|2`; effects `--fx=grid|strip|boss[-world] --fxt=N`; ui `--menu=pause|settings --touch=on`;
  audio (the tool waits for every offline render); dialogue `--node --at=N` or `--sheet=1`; journal `--tab --viewer`;
  memories `--stage=carrier|drop|boop|reveal|lost|bundle[:N] --at=T`; bonus `--phase=intro|fly|results|perfect
  --at=N --hits=N`; save `--stage=recovery|recovery-backup|recovery-nibbled|indicator|indicator-touch|indicator-memory`;
  player `--filter=gallery`. `--skipDialogue` closes the intro dialogue of an `--area`
  deep link before `--advance` runs.
