# Art module: requests for other owners

## 1. content/dialogue.json: use the new portrait sprites (owner: content/integrator)
New 40x40 portraits exist in `src/art/sprites/portraits.ts`:
`portrait_pom`, `portrait_biscuit`, `portrait_empress`, and `portrait_<breed>` for all ten breeds.
- Every node with `"speaker": "Commander Biscuit"`: `"portrait": "pup"` -> `"portrait_biscuit"` (28 nodes)
- Every node with `"speaker": "Captain Pom"`: `"portrait": "poodle"` -> `"portrait_pom"` (28 nodes)
- `"speaker": "Empress Fluffington"`: `"portrait": "boss_empress"` -> `"portrait_empress"` (2 nodes)
- Any future boss-cat lines: `portrait_<breed>` (e.g. `portrait_tabby` for Sergeant Whiskers).
The 64px sprites currently used are clipped by the 44px portrait box in ui (src/ui/index.ts:194).

## 2. src/player/index.ts: bank frames (owner: player)
`poodle_left` / `poodle_right` exist (2 flame frames each, same size/anchor as `poodle`).
In the render at src/player/index.ts:89, choose the sprite by horizontal velocity, e.g.
`const spr = vx < -0.5 ? 'poodle_left' : vx > 0.5 ? 'poodle_right' : 'poodle';`
keeping `frame: Math.floor(this.anim / 6) % 2` (the flame flicker).

## 3. src/ui/index.ts title/ending (owner: ui), optional
Title (line 214) and ending (line 294) could show `portrait_pom` scaled 2x instead of the
top-down flight sprite, which is designed for gameplay readability rather than a hero shot.

## 4. Tooling: `npm run verify` typecheck is red independent of art (owner: integrator)
`tsc --noEmit -p .` reports 7 errors in tools/bot.ts and tools/lint-content.ts
("Cannot find name 'node:fs' / 'process'"): `@types/node` is not in package.json devDependencies
and the worktree's node_modules is a symlink to a shared install without it. Same 7 errors on the
base commit 482427a. Fix: `npm i -D @types/node` and add `"types": ["node"]` for tools (or a
tools/tsconfig). All other verify steps (lint, bot, tests, build) are green with the new art.
