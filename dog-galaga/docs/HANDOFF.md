# Handoff

Project lives in `dog-galaga/` inside this repo. Read `ARCHITECTURE.md` first.

## Commands
- `npm run verify`: typecheck, content lint, playthrough bot, tests, build.
- `npm run build && npm run preview` then `node tools/screenshot.mjs --showcase=<module>` (see header of tools/screenshot.mjs).
- Art is authored with generators in `tools/art/*.mjs` (run with node, output into `src/art/sprites/*.ts`).

## Gotchas
- Modules are constructed per game in `src/core/boot.ts` (tests create many games).
- Headless mode (`createGame({headless:true})`) never touches DOM; render/overlay are browser-only.
- Math.random and network calls are banned in src/ (linter enforces).
- Pushing to the cloud branch is allowed (user updated the rule); GitHub App access is currently missing (403).

## State (2026-10-29): final gate passed
- Whole-game critic 8.5 (history 7.3, 7.6, 8.0, 8.2, 8.3, 8.4, 8.5), blind judges 14/18 (78%) vs Galaga/Galaga '88/Gaplus snaps,
  release verifier green (8 paths, 0 softlocks, both endings, browser save/resume, offline build, 57 tests).
- Play locally: `npm run build:single` -> dist/PoodlePatrol.html (double-click, works offline from file://).
- Open polish items are listed in docs/STATUS.json openIssues; per-module gauntlet scores are honest and several are below 8.5.
- Workflow scripts used for the gauntlets/polish loops are not in the repo; the pattern is: one worktree per module
  (branch <wave>/<module>), builder + critic rounds, integrator merges, whole-game critic.
