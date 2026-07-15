import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseBib } from '@/lib/bibtex/parse-bibtex';
import { computeVerdict } from '@/lib/verification/compute-verdict';
import { verifyEntry } from '@/lib/verification/pipeline';

import { server } from '../../../../vitest.setup';
import { fixtureHandlers } from '../__fixtures__/api-responses';
import { EXPECTED_VERDICTS, SUBSET_KEYS } from '../__fixtures__/expected-verdicts';

// Scoped acceptance: the full demo file is parsed only for count/keys; ONLY
// the representative subset is verified (mocking all 40 would need ~130
// handlers under onUnhandledRequest:'error').

vi.mock('node:dns/promises', () => ({
  default: {
    lookup: vi.fn(async (hostname: string) => {
      if (['proceedings.mlr.press', 'arxiv.org'].includes(hostname)) {
        return [{ address: '93.184.216.34', family: 4 }];
      }
      throw new Error('ENOTFOUND');
    }),
  },
}));

const demoBib = readFileSync(resolve(process.cwd(), 'public/demo-references.bib'), 'utf8');
const fixturePath = (name: string) =>
  resolve(process.cwd(), 'src/lib/verification/__fixtures__', name);

beforeEach(() => {
  server.use(...fixtureHandlers);
});

describe('demo references.bib shape', () => {
  it('parses ~40 entries and contains every subset key', () => {
    const { entries, parseErrors } = parseBib(demoBib);
    expect(parseErrors).toEqual([]);
    expect(entries).toHaveLength(40);
    const keys = new Set(entries.map((e) => e.key));
    for (const k of SUBSET_KEYS) expect(keys.has(k)).toBe(true);
  });
});

describe('subset acceptance verdicts (2026-07-14 live-baseline behavior)', () => {
  const { entries } = parseBib(demoBib);
  const byKey = new Map(entries.map((e) => [e.key, e]));

  for (const key of SUBSET_KEYS) {
    it(`${key} -> ${EXPECTED_VERDICTS[key]}`, async () => {
      const entry = byKey.get(key)!;
      const evidence = await verifyEntry(entry);
      const { verdict } = computeVerdict(entry, evidence);
      expect(verdict).toBe(EXPECTED_VERDICTS[key]);
    });
  }

  it('eddm is matched despite the year off-by-one and particled surnames', async () => {
    const entry = byKey.get('eddm')!;
    const evidence = await verifyEntry(entry);
    expect(evidence.bestMatch?.record.source).toBe('semantic-scholar');
    expect(evidence.bestMatch?.score.author).toBeGreaterThanOrEqual(0.8);
    expect(evidence.bestMatch?.score.year).toBe('off-by-one');
  });
});

describe('doctored MISMATCH fixture', () => {
  it('same paper with a doctored year -> MISMATCH + year FieldDiff', async () => {
    const { entries } = parseBib(readFileSync(fixturePath('doctored-mismatch.bib'), 'utf8'));
    const entry = entries[0];
    const evidence = await verifyEntry(entry);
    const { verdict, diffs } = computeVerdict(entry, evidence);
    expect(verdict).toBe('MISMATCH');
    expect(diffs).toContainEqual({ field: 'year', bibValue: '2020', canonicalValue: '2017' });
  });
});

describe('repurposed-DOI fixture', () => {
  it('resolving DOI that belongs to a different paper -> NOT_FOUND', async () => {
    const { entries } = parseBib(readFileSync(fixturePath('repurposed-doi.bib'), 'utf8'));
    const entry = entries[0];
    const evidence = await verifyEntry(entry);
    const { verdict } = computeVerdict(entry, evidence);
    expect(evidence.tier1?.doiHandleExists).toBe(true);
    expect(evidence.tier1?.record?.title).toContain('Mekong');
    expect(evidence.bestMatch).toBeUndefined();
    expect(verdict).toBe('NOT_FOUND');
  });
});
