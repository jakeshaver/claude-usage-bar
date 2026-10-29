# Core requests from `audio`

(Round 4 requests first; rounds 3, 2 and 1 kept below for history.)

# Round 4

## R4-1. BLOCKING: set the per-area `music` ids in `content/areas.json` (content owner). Repeats R3-1 and R2-1.
Audio no longer overrides content. `SHARED` and the `AREA_MUSIC` fallback are deleted. `audio.areaTrack()` now
plays exactly `area.music` (and `'yard'` only if the id is missing or unknown), as ARCHITECTURE.md section 5 requires.
**Until this edit lands, 8 of the 13 new area loops cannot be heard in game** (street and park play `yard`, cafe and
factory play `city`, and so on), and the mothership's regular waves play `boss`. Exact edit, one line per area:
```
backyard   "music": "yard"        rooftops "music": "night"      sky        "music": "space"
street     "music": "street"      docks    "music": "docks"      moon       "music": "moon"
park       "music": "park"        station  "music": "station"    nebula     "music": "nebula"
alley      "music": "city"        cafe     "music": "cafe"       factory    "music": "factory"
mothership "music": "mothership"
```
All of these are keys of `TRACKS`, so the content lint already accepts them. The boss fight in the mothership
still escalates to `finale` (`bossTrack()`).

## R4-2. Give the boss wind-up and the dialogue their own sounds at the call sites (interaction, quest owners)
- `src/interaction/boss.ts:120` `beginTell()`: change `sfx('blip')` to `sfx('tell')` (repeats R3-2).
- `src/quest/index.ts:90` (dialogue advance): change `sfx('blip')` to `sfx('talk')` (new: soft vocal "bwip").
- Menus (`ui`, `journal`) should keep `blip` for cursor moves and `select` for confirm.
Audio already does this on its own as a stopgap: `Audio.remap()` turns a `blip` into `tell` when the boss has just
entered its `tell` state (`boss.st === 'tell' && boss.stT <= 1`), and into `talk` while `scene === 'dialogue'`.
Once the two call sites change, the remap is a no-op. New sfx ids this round: **`talk`** and **`toast`**.
- Toasts: the UI has no toast event, so audio polls `ui.toasts` and plays `toast` (a soft two-bell chime) for each
  new toast, unless a bigger cue (`quest memory pickup bossdown select bark`) played in the last 12 ticks (so
  QUEST COMPLETE still gets only its fanfare). If the UI owner prefers, `ui.toast()` can emit `bus 'toast'` and
  audio will listen to that instead.

## R4-3. Bundle warnings are still caused by the audio import graph (integrator). Repeats R3-4.4.
`vite build`: main chunk 429 kB (> 400) and "src/audio/index.ts is dynamically imported by showcase but also
statically imported by boot". Fix in `src/showcase/index.ts`: replace `await import('../audio/index')` with
`await import('../audio/offline')` (renderers) + static `TRACKS` / `SFX_IDS` / `AMBIENCE_IDS` from
`../audio/tracks`, `../audio/sfx` and `../audio/ambience`. To get under 400 kB, lazy-load the showcase from
`core/boot.ts` (`if (params.has('showcase')) (await import('../showcase/index')).run(g)`), or raise
`chunkSizeWarningLimit` to 450.

## R4-4. Audio showcase layout (integrator, `src/showcase/index.ts:57`). Repeats R3-4.1-3.
It now has 25 music ids + 7 beds + 18 sfx (50 rows), so it overflows even more. Please use 3 columns of 210 px,
or rows of 12 px. Draw `envRms` under `envelope` (peak in palette index of the pink, rms in the cyan, via
`col(i)` instead of hex), render loops for 48 s (`renderTrackOffline(id, 48)`) and stingers for 6 s, and add the
game-flow rows (`renderSequenceOffline(['stage','street'], 16)`, `(['boss','victory','map'], 16, 5)`,
`(['nap','stage','park'], 16)`). Without these, the A/B form and the bar-line handovers can't be checked visually.

## R4-5. `tools/screenshot.mjs --skipDialogue` (tools owner). Repeats R3-5 and R2-5, 3rd time.
Every `--area` deep link stops in `scene=dialogue`, so pause ducking, stingers and the new bed events can't be
screenshotted during play. Close dialogue (press confirm) until `scene === 'play'` before `--advance`/`--keys`.

## API contract: `renderTrackOffline` is async (FYI for integrators)
`renderTrackOffline(trackId, seconds): Promise<RenderStats>`. `OfflineAudioContext.startRendering()` is async, so the
function returns a promise. **It never rejects.** It resolves `{ ok:false, error, peak:0, rms:0, durationSec:0, ... }`
when WebAudio is missing, the id is unknown, or rendering fails. On success it resolves
`{ ok:true, peak, rms, durationSec, sampleRate, clipped, activity, envelope, envRms }`. Always `await` it.
`renderAmbienceOffline`, `renderSfxOffline`, `renderMixOffline`, `renderFireHoldOffline` and
`renderSequenceOffline` follow the same contract. The `src/audio/index.ts` exports are lazy wrappers around
`./offline` with identical signatures.

## Round 4 behaviour notes (no action required)
- **Every area loop has its own hook now.** `variant()` takes `chordsA/leadA` + `chordsB/leadB` (all four required),
  so a variant can no longer inherit the parent's melody. New A sections: street (mixolydian funk, blue-third glide),
  park (lilting turn on the IV chord), cafe (dorian i7-IV7 shuffle, off-beat pickup), factory (stamping 16th riff),
  docks (dotted shanty roll over i-bVII-bVI-V), station (staccato octave alarm), moon (slow octave-leap float),
  nebula (falling 16th sparkle cascade). The family link is only voice, tempo feel and drum/bass DNA.
- **Loudness:** `Track.gain` (per-song trim on a new `mix.trim` node). 16 s offline RMS of the 13 area loops is
  now 0.082-0.094 (round 3: 0.064-0.111). Boss 0.097, finale 0.099, title 0.093, bonus 0.091. Deliberately
  quieter: map 0.058, ending 0.082 (was 0.102), nap 0.083 (short), stingers 0.066-0.077.
- **Ambience foreground events:** each bed now plays one recognisable event every 3-6 s (was 3-8 s) on its own
  panned bus (pan -0.6 / +0.55, mostly alternating), boosted so event peaks are 0.27-0.32 (space 0.27, was 0.11).
  The continuous bed floor is unchanged (bed RMS 0.030-0.040).
- **Sound-off hint on every scene:** the speaker icon with the red slash now draws in the top-right corner on every
  scene (title, play HUD corner, map...) until the AudioContext runs. Once, ~1.5 s into the first non-title scene
  without sound, a toast says `TAP OR PRESS A KEY FOR SOUND` (a gamepad press can't unlock audio in Chrome).
- Worst-case mix (boss + space + plop/thud/meow spam + bossdown): peak 0.91, RMS 0.168, 0 clipped.
- New sfx peaks: talk 0.18 (dialogue), toast 0.22 (notification). Others unchanged.

# Round 3

## R3-1. One loop per area: set these `music` ids in `content/areas.json` (content owner)
`TRACKS` now has 13 area loops. Neighbours share a song family but differ in key, tempo, lead voice, drum and bass
patterns, and the B section (bars 9-16) has new chords and a new melody.
| area | music | | area | music | | area | music |
|---|---|---|---|---|---|---|---|
| backyard | `yard` (G, 132) | | rooftops | `night` (Em, 120) | | sky | `space` (Dm, 144) |
| street | `street` (A, 140) | | docks | `docks` (Dm, 112) | | moon | `moon` (Bm, 136) |
| park | `park` (F, 124) | | station | `station` (Gm, 128) | | nebula | `nebula` (Fm, 152) |
| alley | `city` (Am, 138) | | cafe | `cafe` (Gm, 128 shuffle) | | factory | `factory` (Bbm, 146) |
| mothership | `mothership` (F#m, 126) (same as R2-1) | | | | | | |

The content lint already accepts them, because they are keys of `TRACKS`. Until content changes, `audio.areaTrack()`
picks the loop from `AREA_MUSIC[area.id]` (exported from `src/audio/index.ts`) whenever the content still names a
shared id (`yard city night space boss`), so it works today, and once content is updated the shim does nothing.

## R3-2. Boss wind-up is silent: call `sfx('tell')` in the boss `tell` state (interaction owner)
`src/interaction/boss.ts:117-121` `beginTell()` plays `sfx('blip')` (the menu blip, 0.03 s). The boss wind-up
warning sound `tell` (a rising two-note chirp, ~0.3 s) is in `SFX_IDS` and is never played. Change line 120 to
`this.g.mods.audio?.sfx('tell');`. If `go('tell')` is ever entered somewhere other than `beginTell`, the call should
go into `go()` (`if (s === 'tell') this.g.mods.audio?.sfx('tell')`) instead.

## R3-3. Ambience volume slider (ui owner + core `types.ts` / `state.ts`)
Ambience no longer follows the music slider. `setVolumes()` now uses `settings.amb` when it is a number, otherwise
`max(settings.music, settings.sfx)`, so turning music off keeps the birds, water and city beds. Suggest:
`settings: { music, sfx, amb: 0.8, ... }` in `core/state.ts` + `core/types.ts` (sanitize clamps 0..1), and an
`AMBIENCE` row in the Settings menu (`ui/index.ts`) that calls `g.mods.audio?.setVolumes()` the way music/sfx do.

## R3-4. Showcase `?showcase=audio` (integrator, `src/showcase/index.ts`)
1. **Rows overflow.** There are now 23 music ids (13 area loops, 4 one-shot stingers `stage victory nap results`,
   `bonus`, `map`, plus title/boss/finale/ending/mothership), so 47 rows in total. Only 42 fit at 21 rows x 2 columns.
   Use 3 columns of 210 px (envelope 80 px) or rows of 12 px.
2. **Song form (critic R2 #8).** Draw `r.envRms` as a second colour under the peak bars (e.g. peak `#7a4fd1`,
   rms `#e8578f`) and render the loops for 48 s (`renderTrackOffline(id, 48)`, ~0.4 s each). The stingers are short;
   render them for `6` s so their shape fills the strip.
3. **New: game-flow rows** (shows the bar-line handovers): `renderSequenceOffline(['stage','yard'], 16)`,
   `renderSequenceOffline(['boss','victory','map'], 16, 5)`, `renderSequenceOffline(['nap','stage','park'], 16)`.
4. **Bundle (critic R2 #9).** Import the renderers from `'../audio/offline'` (plus `TRACKS` from `'../audio/tracks'`,
   `SFX_IDS` from `'../audio/sfx'`, `AMBIENCE_IDS` from `'../audio/ambience'`) instead of `'../audio/index'`. That
   removes the "dynamically imported but also statically imported" warning. `audio/index.ts` no longer re-exports
   `./offline` statically: its `render*Offline` exports are lazy wrappers (`offline` is already its own 2.8 kB
   chunk), so the existing showcase keeps working unchanged. The main chunk is 425 kB (+12 kB for the new songs).
   To get under 400 kB, lazy-load `src/showcase` from `core/boot.ts` (`if (params.has('showcase')) await import(...)`)
   or raise `chunkSizeWarningLimit` to 450.

## R3-5. Still blocking review (tools owner), repeats R2-5
Every `--area` deep link opens in a dialogue scene, so pause ducking during play cannot be screenshotted.
`tools/screenshot.mjs --skipDialogue` (close dialogue until `scene === 'play'`) is still needed.

## Round 3 behaviour notes (no action required)
- **Galaga cues** (all internal to audio, driven by existing bus events):
  `wave:start` (first wave of an area visit, or the first wave after a nap) -> 2-bar **stage** fanfare, then the area loop;
  `boss:defeat` -> **victory** stinger (3 bars) on the first bar line at least 0.7 s after the bossdown sfx, then the area loop;
  `player:nap` -> **nap** music-box lullaby (Brahms' Wiegenlied, ~3.8 s, the length of the nap), then the stage fanfare
  when the wave restarts; scene `bonus` / `bonus:start` -> **bonus** loop (Treat Bonanza);
  `bonus:result` -> **results** jingle; scene `map` -> **map** loop (no longer the title theme); `ending` -> ending.
- **Bar-line switching:** every song change is quantized to the next bar line of the playing song (a half bar or a
  beat if the bar line is more than 1.1 s away), and the old song fades to 50 % into the switch. A playing stinger
  always finishes: a loop requested meanwhile (e.g. scene -> map right after the victory stinger) is queued after it.
- **Levels:** music bus +4 dB (`LEVELS.music` 0.44 -> 0.7). `hurt`, `bossdown` and `memory` dip the music by 2 dB
  for 150 ms (sidechain feel). Limiter threshold -4 -> -3 dB. `ending` is normalized (peak 0.25 -> 0.51).
- **Hooks:** each song has a rhythmic hook at bars 1/5, answered at 9/13: yard and title use a dotted figure with
  a pickup, space uses a repeated-note stutter, night uses a dotted sigh.
  `night` is now 120 bpm with 16th-note hats and an 8th-note bass ostinato. Its whole-bar drop is gone.
- **Title hint:** the boxed text is gone. A 20x14 px pixel speaker with a blinking red slash sits in the top-right corner
  (612,6) until the AudioContext runs.

## Round 3 reference numbers (Chromium, 22.05 kHz offline, default volumes, 30 s renders, real mixer + limiter)
- Area loops peak 0.49-0.70, RMS 0.067-0.112 (round 2: 0.25-0.46 / 0.053-0.075). Title 0.65/0.087,
  boss 0.69/0.111, finale 0.68/0.107, ending 0.51/0.102, map 0.47/0.058 (calm by design), bonus 0.60/0.097.
- Worst-case mix (boss + space + plop/thud/meow spam + bossdown with dip): peak 0.89, RMS 0.176, 0 clipped.
- Sfx peaks are unchanged relative to each other (plop 0.30, thud 0.32, meow 0.32, bossdown 0.49). 0 clipped samples everywhere.


# Round 2

## R2-1. Mothership regular waves: set `music: "mothership"` - content owner (`content/areas.json`)
The mothership area currently has `"music": "boss"`, so its ordinary waves used the boss theme and the real boss
fight had nowhere to escalate to. There is now a dedicated `mothership` track (ominous F#-minor march, 16 bars,
A/B form). Until content changes, `src/audio/index.ts areaTrack()` maps an area music of `'boss'` to
`'mothership'` as a shim, and the boss fight there plays `finale`. Please change the mothership entry to
`"music": "mothership"` (the content lint already accepts it: it is a key of `TRACKS`) so the shim becomes a no-op.

## R2-2. sfx-id lint is live, no action needed (FYI for every module)
`validateTracks()` (already called by `tools/lint-content.ts`) now also scans `src/**/*.ts` (outside `src/audio`)
for `sfx(...)` calls and reports every string literal inside them that is not in `SFX_IDS`, e.g.
`audio: sfx id "nope" used in interaction/index.ts:377 is not in SFX_IDS`. A new sound needs a voice in
`src/audio/sfx.ts` first (or a request here). Ids now: plop thud meow dive hurt whimper shield pickup memory
quest bossdown blip select bark **hack tell**. Ternaries like `sfx(ok ? 'quest' : 'pickup')` are checked too.
Pure helper for tests: `findUnknownSfx(files: {path, src}[], ids?)` exported from `src/audio/index.ts`.

## R2-3. Showcase (`?showcase=audio`) - optional additions - integrator-owned `src/showcase/index.ts`
- `RenderStats` now also has `envRms: number[]` (per-bin RMS, same bins as `envelope`). Drawing it instead of
  (or under) `envelope` shows the song form: B sections, drum drops, the boss intro sting. Peaks hide this.
- Render tracks for 48 s instead of 16 s so the A/B form and the repeat-pass variations are on screen
  (`renderTrackOffline(id, 48)`, ~0.5 s each; offline scheduling is no longer capped at 512 steps).
- New row worth adding: `renderFireHoldOffline('yard', 'birds', 8, false)` vs `(..., true)`: music+bed with and
  without plop autofire at the player's real rate. Current numbers: rms 0.064 -> 0.077 (+1.6 dB; was +5 dB).

## R2-4. Bundle size warning (FYI)
`vite build` now reports the single chunk at ~413 kB (> `chunkSizeWarningLimit: 400`), +15 kB from audio
(longer songs, mothership track, ambience events). It is a warning, verify stays green. If the integrator wants
it quiet: raise the limit to 450 or lazy-load `src/showcase` (it is the only dynamic importer of audio).

## R2-5. Forwarded from the audio critic (not audio's) - world / content / tools owners
- Docks dialogue says "AT DAWN" while the scene renders `--tod=dusk`; dusk docks look almost like night.
- Every `--area` deep link opens in a blocking dialogue scene, so `--advance` alone never reaches gameplay;
  `tools/screenshot.mjs` could accept `--skipDialogue` (or the deep link could skip the intro dialogue).

## Round 2 reference numbers (Chromium, 22.05 kHz offline, default volumes, through the real mixer + limiter)
- Music alone peaks 0.25-0.46, RMS 0.053-0.075 (music bus -3 dB; limiter threshold -4 dB, ratio 12, so it only
  catches transients). 0 clipped samples everywhere.
- Ambience beds RMS 0.028-0.036 (+6..9 dB vs round 1), each with a foreground event every 3-8 s.
  Pause: music ducks to 35% + low-pass 1.1 kHz, ambience comes *up* to 125% on its own node (`ambDuck`).
- Sfx peaks: plop 0.32, thud 0.34, meow 0.34, dive 0.36, hack 0.26, bark 0.34, tell 0.34, hurt 0.42,
  whimper/shield/pickup 0.29-0.30, blip 0.17, select 0.19, memory 0.50, quest 0.50, bossdown 0.52.
- Worst-case mix (boss + space + constant plop/thud/meow spam + bossdown): peak 0.85, 0 clipped.

## Round 2 behaviour notes (no action required)
- Gamepad-only players: `update()` calls `ensure()` on the first pad input (via `input.lastDevice === 'gamepad'`
  or any pressed button) and retries resume every ~0.5 s while a pad is used. Browsers don't count pad presses as
  activation, so the title shows a boxed `PRESS ANY KEY / TAP FOR SOUND` hint until the context is running.
  The hint is drawn by a tiny module (`audio-hint`) that `audio.init()` registers last, so it sits above the UI.
- The first sfx requested while the context is still starting (the unlocking press) is queued and played on
  `ctx.onstatechange` -> running (dropped if older than 1.5 s).
- Songs: A/B form (second bass + drum pattern from bar 9, drum drop / half-time bars, fills), boss is 16 bars
  plus a 2-bar intro sting that is never looped, and every second pass varies: key lift (boss +1, space +2),
  auto counter-melody (triangle), echo-arp doubling, lead duty change. Lead articulation: mid-note duty switch
  on held notes, PWM-swept lead (night, mothership), portamento on `~` notes. Kick is now a chip tri dive + noise.
- Plop autofire: 4 rotating pitch/formant variants, 0.10 s when fire is held, -2 dB per overlapping voice and
  -4.5 dB while held. Thud/meow/hack rotate 3 variants and drop 1.5 dB per overlap when spammed.

# Round 1

## 1. Wire an audio showcase (`?showcase=audio`) - integrator-owned `src/showcase/index.ts`
Critics cannot listen, so the showcase should *draw* the audio. `src/audio/index.ts` now re-exports
window-free offline renderers (they use `globalThis.OfflineAudioContext` only, never throw, and resolve
`{ ok:false, error }` when WebAudio is missing):

```ts
import { renderTrackOffline, renderAmbienceOffline, renderSfxOffline, renderMixOffline,
         TRACKS, AMBIENCE_IDS, SFX_IDS, type RenderStats } from '../audio/index';
// RenderStats = { ok, error?, peak, rms, durationSec, sampleRate, clipped, activity, envelope:number[] }
const r = await renderTrackOffline('yard', 12);   // 12 s through the real mixer + limiter
```

Suggested showcase (currently `case 'audio': g.setScene('title')`):
1. Set a flag (`g.showcaseAudio = { rows: [] }`) and kick off, sequentially (each render takes ~50-300 ms):
   - every id of `Object.keys(TRACKS)` with `renderTrackOffline(id, 16)`
   - every id of `AMBIENCE_IDS` with `renderAmbienceOffline(id, 10)`
   - every id of `SFX_IDS` with `renderSfxOffline(id)`
   - `renderMixOffline('boss', 'space', 8)` (worst case: music + ambience + plop/meow/thud spam + bossdown)
2. In `render`, for each finished row draw: the id, `peak`, `rms`, `clipped` as text with the bitmap font,
   and `envelope` (200 bins for music/ambience, 100 for sfx; values 0..1) as 1px-wide palette bars
   (`fillRect`, no strokes). Colour the row red if `clipped > 0` or `peak >= 0.99`.
3. Expose the results for tools: `window.__game.audioReport = rows` so `tools/screenshot.mjs` json can include it.
`?showcase=audio` must wait for the promises before `ready`-dependent screenshots; e.g. set `--wait=4000`.

Reference numbers at settings volume 1.0 (Chromium, 22.05 kHz): every track peaks 0.66-0.78 with
0 clipped samples; worst-case mix peaks ~0.80, 0 clipped. Ambience beds peak 0.045-0.1 (deliberately subtle).

## 2. `npm run verify` is red at baseline (same as world's request #1)
`tsc --noEmit -p .` fails before any audio change in `tools/bot.ts` / `tools/lint-content.ts`
(TS2591 `node:fs`, `node:path`, `process`) because `tsconfig.json` has `"types": []` and `@types/node`
is not installed. `src/audio` itself typechecks clean (no errors outside `tools/`). Fix: install
`@types/node` and add `"types": ["node"]` (or a separate `tools/tsconfig.json`).

## 3. Optional: a test for track well-formedness
`validateTracks()` (exported from `src/audio/tracks.ts`, pure, node-safe) returns a list of problems
(bad chord symbols, lead lines whose length != bars*16). Suggest adding to `tests/` or `tools/lint-content.ts`:
`for (const e of validateTracks()) errors.push('audio: ' + e);`

## Notes for other modules (no action required)
- Track ids kept: title, yard, city, night, space, boss, finale, ending. `finale` now plays for the boss of the
  final area (an area with `ending`, i.e. mothership); other bosses use `boss`.
- Ambience ids handled: birds, city, wind, cafe, water, factory, space ('none' = silence).
- Sfx ids: plop, thud, meow, dive, hurt, whimper, shield, pickup, memory, quest, bossdown, blip, select, bark.
  Repeated calls are voice-limited per id (plop/thud/meow max 3 overlapping, dupes within 25 ms dropped),
  so callers can fire freely.
- Pause ducking reads `g.paused` (music -9 dB and low-passed to 1.1 kHz, ambience to 40%).
- The AudioContext is created on the first keydown/pointerdown/touchstart; suspended while the tab is hidden.
