import fs from 'node:fs';
import path from 'node:path';
import { exploreAll } from './bot-core';
import { loadContent } from '../src/core/content';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const seed = +(process.argv.find(a => a.startsWith('--seed='))?.slice(7) ?? 1337);
const results = exploreAll(seed, s => console.log(s));
const { content } = loadContent();
const visited = new Set(results.flatMap(r => r.route).concat(content.start));
const questsSeen = new Set(results.flatMap(r => Object.keys(r.quests)));
const report = {
  seed, paths: results.length,
  allReachEnding: results.every(r => r.ending && !r.softlock),
  softlocks: results.filter(r => r.softlock).map(r => ({ route: r.route, why: r.softlock })),
  endings: [...new Set(results.map(r => r.ending))],
  minutes: { min: Math.min(...results.map(r => r.minutes)), max: Math.max(...results.map(r => r.minutes)) },
  unvisitedAreas: content.areas.map(a => a.id).filter(a => !visited.has(a)),
  questsNeverStarted: content.quests.map(q => q.id).filter(q => !questsSeen.has(q)),
  errors: [...new Set(results.flatMap(r => r.errors))],
  results: results.map(({ branches, ...r }) => r),
};
fs.mkdirSync(path.join(root, 'tools/out'), { recursive: true });
fs.writeFileSync(path.join(root, 'tools/out/bot.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ paths: report.paths, allReachEnding: report.allReachEnding, softlocks: report.softlocks.length, endings: report.endings, minutes: report.minutes, unvisitedAreas: report.unvisitedAreas, questsNeverStarted: report.questsNeverStarted, errors: report.errors.length }));
process.exit(report.allReachEnding && !report.errors.length ? 0 : 1);
