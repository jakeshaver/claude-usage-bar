import { describe, it, expect } from 'vitest';
import { saveSelftest } from '../src/save/save.selftest';

describe('save selftest', () => {
  for (const c of saveSelftest()) it(c.name, () => expect(c.detail ?? 'ok').toBe('ok'));
});
