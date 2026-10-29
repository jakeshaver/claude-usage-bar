import type { Game } from '../core/game';

/**
 * A representative mid-game save for the journal showcase: two sectors cleared, a few quests running, five
 * polaroids found. Used when the page is opened with ?showcase=journal (and no ?state=), so the critic and the
 * screenshot tool see filled pages instead of an all-locked journal. Core may also call it from the showcase.
 */
export function seedJournalDemo(g: Game) {
  const s = g.state;
  s.memories = g.content.memories.slice(0, 5).map(m => m.id);
  s.areasCleared = ['backyard', 'street']; s.areaId = 'park'; s.waveIndex = 3;
  s.quests = { ...s.quests, first_flight: 'done', lost_pups: 'active', scrapbook: 'active', park_pals: 'active', boop_brigade: 'active', big_cats: 'active' };
  Object.assign(s.inventory, { _q_lost_pups: 4, _q_scrapbook: 5, _q_park_pals: 2, _q_boop_brigade: 312, _q_big_cats: 2 });
  Object.assign(s.stats, { shots: 2210, hits: 1460, naps: 3, playTicks: 151200, catsBooped: 312 });
  s.score = 48250; s.hiScore = 61200;
}

/** True once per page load when the journal showcase runs without an explicit ?state=. */
let used = false;
export function wantsDemo(): boolean {
  if (used || typeof location === 'undefined') return false;
  const p = new URLSearchParams(location.search);
  if (p.get('showcase') !== 'journal' || p.has('state') || p.has('nodemo')) return false;
  used = true; return true;
}
