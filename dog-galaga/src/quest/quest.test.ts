import { describe, it, expect } from 'vitest';
import { runQuestCheck } from './check';

// Wired into `npm run verify` through vitest (see docs/core-requests/quest.md: include src/**/*.test.ts,
// or copy this file to tests/quest.test.ts with the import path '../src/quest/check').
describe('quest + dialogue engine', () => {
  it('every quest starts and completes on some path; content agrees with the sector graph; robustness holds', () => {
    const r = runQuestCheck();
    if (r.notes.length) console.log(r.notes.join('\n'));
    expect(r.problems).toEqual([]);
  });
});
