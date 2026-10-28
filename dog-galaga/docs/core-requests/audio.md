# Core requests from `audio` (round 1)

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
