import { describe, expect, it } from 'vitest';

import { buildOverrides } from '@/lib/client/download-bib';
import type { RowState } from '@/lib/client/run-verification';
import type { VerificationResult } from '@/lib/verification/types';

// Checkbox-export contract: a correction reaches the exported .bib ONLY when
// its key is checked (member of `accepted`).

const result = (key: string, corrected?: { year?: number }): VerificationResult => ({
  entryKey: key,
  verdict: corrected ? 'MISMATCH' : 'VERIFIED',
  evidence: { entryKey: key, tier3: { matches: [], searches: [] }, diffs: [], apiCalls: [] },
  explanation: 'x',
  correctedEntry: corrected,
});

const results: Record<string, RowState> = {
  a: result('a', { year: 2017 }),
  b: result('b', { year: 2019 }),
  c: result('c'), // no correction
  d: { status: 'PENDING' },
};

describe('buildOverrides', () => {
  it('includes a correction only for checked keys', () => {
    expect(buildOverrides(results, new Set(['a']))).toEqual({ a: { year: 2017 } });
  });

  it('empty accepted set exports no overrides', () => {
    expect(buildOverrides(results, new Set())).toEqual({});
  });

  it('all keys accepted equals apply-all', () => {
    expect(buildOverrides(results, new Set(['a', 'b', 'c', 'd']))).toEqual({
      a: { year: 2017 },
      b: { year: 2019 },
    });
  });

  it('checking a key without a correction contributes nothing', () => {
    expect(buildOverrides(results, new Set(['c', 'd']))).toEqual({});
  });
});
