import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { parseBib } from '@/lib/bibtex/parse-bibtex';
import { explainEntry } from '@/lib/llm/explain-entry';
import type { Evidence } from '@/lib/verification/types';

import { server } from '../../../../vitest.setup';

// Opt-in real-LLM smoke test (never part of the default suite):
//   CUSTOM_API_KEY=... npx vitest run src/lib/llm/__tests__/real-llm-smoke.test.ts
// Asserts a non-empty explanation and that sanitizeCorrection kept only
// evidence-backed fields.
const hasKey = Boolean(process.env.CUSTOM_API_KEY?.trim());

describe.skipIf(!hasKey)('real LLM smoke (opt-in)', () => {
  beforeAll(() => {
    // this file intentionally talks to the real proxy — lift MSW interception
    server.close();
  });

  it('explains the doctored MISMATCH entry with a sanitized correction', async () => {
    const bib = readFileSync(
      resolve(process.cwd(), 'src/lib/verification/__fixtures__/doctored-mismatch.bib'),
      'utf8',
    );
    const { entries } = parseBib(bib);
    const entry = entries[0];

    const evidence: Evidence = {
      entryKey: entry.key,
      tier1: {
        doiPresent: true,
        doiHandleExists: true,
        crossrefFound: true,
      },
      bestMatch: {
        record: {
          source: 'crossref',
          title: 'iCaRL: Incremental Classifier and Representation Learning',
          authors: [
            'Sylvestre-Alvise Rebuffi',
            'Alexander Kolesnikov',
            'Georg Sperl',
            'Christoph H. Lampert',
          ],
          year: 2017,
          venue: '2017 IEEE Conference on Computer Vision and Pattern Recognition (CVPR)',
          doi: '10.1109/cvpr.2017.587',
        },
        score: { title: 1, author: 1, year: 'mismatch' },
      },
      diffs: [{ field: 'year', bibValue: '2020', canonicalValue: '2017' }],
      apiCalls: [],
    };

    const r = await explainEntry(entry, evidence, 'MISMATCH');
    expect(r.explanation.length).toBeGreaterThan(0);
    expect(r.explanation).not.toContain('LLM explanation unavailable');
    if (r.correctedEntry) {
      // every surviving field must be evidence-backed
      if (r.correctedEntry.year) expect(r.correctedEntry.year).toBe(2017);
      if (r.correctedEntry.doi) expect(r.correctedEntry.doi.toLowerCase()).toBe('10.1109/cvpr.2017.587');
    }
  }, 30_000);
});
