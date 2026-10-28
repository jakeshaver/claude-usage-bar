import type { Content } from './types';
// Minimal built-in content so a broken content file never stops the game.
export const FALLBACK: Content = {
  start: 'backyard',
  areas: [{ id: 'backyard', name: 'The Backyard', tileset: 'backyard', music: 'yard', ambience: 'birds', tod: 'day', waves: ['fb-w1'], exits: [], ending: 'fb-end' }],
  waves: [{ id: 'fb-w1', formation: { cols: 6, rows: 2 }, cats: [{ breed: 'tabby', row: 0 }, { breed: 'tabby', row: 1 }], entry: 'swirl-left', diveRate: 0.004, fireRate: 0.002 }],
  enemies: [{ id: 'tabby', name: 'Tabby Grunt', sprite: 'cat_tabby', hp: 1, points: 50, behavior: 'basic', bestiary: 'An orange troublemaker.' }],
  quests: [], dialogue: [], items: [], memories: [], bonus: [],
  endings: [{ id: 'fb-end', title: 'Safe and Sound', text: ['The yard is quiet again.'] }],
};
