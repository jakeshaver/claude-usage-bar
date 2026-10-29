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
