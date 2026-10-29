# Core requests from journal (round 1)

1. **Showcase (`src/showcase/index.ts`, case 'journal'): richer staged state.** The showcase only seeds 3 memories,
   so QUESTS and BESTIARY render almost empty. Suggested replacement for the case body:
   ```ts
   case 'journal': {
     const s = g.state;
     s.memories = g.content.memories.slice(0, 5).map(m => m.id);
     s.areasCleared = ['backyard', 'street']; s.areaId = 'park'; s.waveIndex = 3;
     s.quests = { first_flight: 'done', lost_pups: 'active', scrapbook: 'active', park_pals: 'active', boop_brigade: 'active', big_cats: 'active' };
     Object.assign(s.inventory, { _q_lost_pups: 4, _q_scrapbook: 5, _q_park_pals: 2, _q_boop_brigade: 312, _q_big_cats: 2 });
     Object.assign(s.stats, { shots: 2210, hits: 1460, naps: 3, playTicks: 151200, catsBooped: 312 }); s.score = 48250; s.hiScore = 61200;
     g.mods.ui.menuOpen = 'journal'; g.mods.ui.settingsFrom = 'title';
     g.mods.journal.tab = +(p.get('tab') ?? 1); g.mods.journal.open();
     if (p.get('viewer')) g.mods.journal.viewer = +p.get('viewer')!; // memory index shown in the photo viewer
     break;
   }
   ```
   Notes: `settingsFrom = 'title'` makes ESC return to the title instead of an orphan PAUSED panel (currently the
   showcase leaves `settingsFrom` unset). Set `tab` BEFORE `open()`: `open()` now restores the remembered
   selection of the current tab. `tools/screenshot.mjs` would need to forward `--tab` and `--viewer`
   (today `--tab` already reaches the page only because the tool forwards unknown params; please confirm).

2. **FYI, input:** the journal adds its own listeners while it is open (guarded by `ui.menuOpen === 'journal'`,
   skipped headless): `touchstart` / `mousedown` on window for tapping tabs, items and the close button
   (mapped through `#game`'s bounding rect, same math as `ui/touch.ts`), and `keydown` for Q/E, Tab/Shift+Tab and
   PageUp/PageDown page flips (Tab's default focus move is prevented only while the journal is open). Gamepad
   shoulders (buttons 4/5) are polled in `update2`. If core ever adds `Input` actions for page left/right or a
   pointer queue, the journal would switch to them.

3. **FYI, ui:** the journal uses `g.mods.ui.dev()` and `g.mods.ui.touch.visible(g)` (both exist today) to pick hint
   glyphs and the touch layout (grid on top, detail card bottom-centre between the on-screen pad and OK button).
   Please keep those two names stable.
