import { Game } from './game';
import { ArtModule } from '../art/index';
import { makeWorld } from '../world/index';
import { makePlayer } from '../player/index';
import { makeInteraction } from '../interaction/index';
import { makeMemories } from '../memories/index';
import { makeMinigames } from '../minigames/index';
import { makeQuest } from '../quest/index';
import { makeSave } from '../save/index';
import { makeEffects } from '../effects/index';
import { makeAudio } from '../audio/index';
import { makeUI } from '../ui/index';
import { makeJournal } from '../journal/index';

/** Build a fully wired game. Each module is constructed inside its own isolation boundary. */
export function createGame(opts: { headless?: boolean; seed?: number; content?: Record<string, unknown> } = {}): Game {
  const g = new Game(opts);
  const factories: [string, () => any][] = [
    ['art', () => ArtModule], ['world', makeWorld], ['player', makePlayer], ['interaction', makeInteraction],
    ['memories', makeMemories], ['minigames', makeMinigames], ['quest', makeQuest], ['save', makeSave],
    ['effects', makeEffects], ['audio', makeAudio], ['ui', makeUI], ['journal', makeJournal],
  ];
  for (const [id, f] of factories) {
    try { g.register(f()); } catch (e) { g.reportError(id, e); }
  }
  g.init();
  return g;
}
