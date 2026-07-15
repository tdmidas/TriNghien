import { describe, expect, it } from 'vitest';

import { computeVerdict } from './compute-verdict';
import type { CanonicalRecord, Evidence, ParsedEntry } from './types';

const entry = (over: Partial<ParsedEntry> = {}): ParsedEntry => ({
  key: 'test',
  type: 'article',
  title: 'Model-Agnostic Meta-Learning for Fast Adaptation of Deep Networks',
  authors: ['Chelsea Finn', 'Pieter Abbeel', 'Sergey Levine'],
  year: 2017,
  venue: 'ICML',
  fields: {},
  raw: '',
  ...over,
});

const record = (over: Partial<CanonicalRecord> = {}): CanonicalRecord => ({
  source: 'crossref',
  title: 'Model-Agnostic Meta-Learning for Fast Adaptation of Deep Networks',
  authors: ['Finn, Chelsea', 'Abbeel, Pieter', 'Levine, Sergey'],
  year: 2017,
  venue: 'ICML',
  ...over,
});

const evidence = (over: Partial<Evidence> = {}): Evidence => ({
  entryKey: 'test',
  diffs: [],
  apiCalls: [],
  ...over,
});

describe('computeVerdict', () => {
  it('VERIFIED when best match agrees on all fields', () => {
    const ev = evidence({
      bestMatch: { record: record(), score: { title: 1, author: 1, year: 'match' } },
    });
    const r = computeVerdict(entry(), ev);
    expect(r.verdict).toBe('VERIFIED');
    expect(r.diffs).toEqual([]);
  });

  it('MISMATCH with a year FieldDiff for a doctored entry (year off by 3)', () => {
    const ev = evidence({
      bestMatch: {
        record: record({ year: 2017 }),
        score: { title: 1, author: 1, year: 'mismatch' },
      },
    });
    const r = computeVerdict(entry({ year: 2020 }), ev);
    expect(r.verdict).toBe('MISMATCH');
    expect(r.diffs).toContainEqual({ field: 'year', bibValue: '2020', canonicalValue: '2017' });
  });

  it('MISMATCH with a venue FieldDiff when venues genuinely differ', () => {
    const ev = evidence({
      bestMatch: {
        record: record({ venue: 'NeurIPS' }),
        score: { title: 1, author: 1, year: 'match' },
      },
    });
    const r = computeVerdict(entry({ venue: 'Journal of Theoretical Chemistry' }), ev);
    expect(r.verdict).toBe('MISMATCH');
    expect(r.diffs.map((d) => d.field)).toContain('venue');
  });

  it('VERIFIED when venue differs only by proceedings boilerplate', () => {
    const ev = evidence({
      bestMatch: {
        record: record({ venue: 'International Conference on Machine Learning' }),
        score: { title: 1, author: 1, year: 'match' },
      },
    });
    const r = computeVerdict(
      entry({ venue: 'Proceedings of the 34th International Conference on Machine Learning' }),
      ev,
    );
    expect(r.verdict).toBe('VERIFIED');
  });

  it('NOT_FOUND: fabricated DOI (handle 404 + Crossref 404 + all searches empty, no DBLP)', () => {
    const ev = evidence({
      tier1: { doiPresent: true, doiHandleExists: false, crossrefFound: false },
      tier3: {
        matches: [],
        searches: [
          { source: 'crossref', status: 'empty' },
          { source: 'openalex', status: 'empty' },
          { source: 's2', status: 'empty' },
        ],
      },
      tier4: { dblpFound: false, journalKnown: null, urlAlive: null },
    });
    expect(computeVerdict(entry({ doi: '10.5555/fake' }), ev).verdict).toBe('NOT_FOUND');
  });

  it('UNVERIFIABLE when any search errored (empty-vs-error)', () => {
    const ev = evidence({
      tier1: { doiPresent: true, doiHandleExists: false, crossrefFound: false },
      tier3: {
        matches: [],
        searches: [
          { source: 'crossref', status: 'empty' },
          { source: 'openalex', status: 'error' },
          { source: 's2', status: 'empty' },
        ],
      },
      tier4: { dblpFound: false, journalKnown: null, urlAlive: null },
    });
    expect(computeVerdict(entry({ doi: '10.5555/fake' }), ev).verdict).toBe('UNVERIFIABLE');
  });

  it('NOT_FOUND: repurposed DOI (handle resolves, Crossref record is a different paper)', () => {
    const ev = evidence({
      tier1: {
        doiPresent: true,
        doiHandleExists: true,
        crossrefFound: true,
        record: record({ title: 'A Completely Different Paper About Fish' }),
      },
      tier3: {
        matches: [],
        searches: [
          { source: 'crossref', status: 'empty' },
          { source: 'openalex', status: 'empty' },
          { source: 's2', status: 'empty' },
        ],
      },
      tier4: { dblpFound: false, journalKnown: null, urlAlive: null },
    });
    // bestMatch is unset because the record failed the same-paper gate
    expect(computeVerdict(entry({ doi: '10.1109/real.but.other' }), ev).verdict).toBe(
      'NOT_FOUND',
    );
  });

  it('NOT_FOUND: no DOI + all searches clean-empty', () => {
    const ev = evidence({
      tier3: {
        matches: [],
        searches: [
          { source: 'crossref', status: 'empty' },
          { source: 'openalex', status: 'empty' },
          { source: 's2', status: 'empty' },
        ],
      },
      tier4: { dblpFound: false, journalKnown: null, urlAlive: null },
    });
    expect(computeVerdict(entry({ doi: undefined }), ev).verdict).toBe('NOT_FOUND');
  });

  it('DBLP hit blocks NOT_FOUND (degrades to UNVERIFIABLE)', () => {
    const ev = evidence({
      tier3: {
        matches: [],
        searches: [
          { source: 'crossref', status: 'empty' },
          { source: 'openalex', status: 'empty' },
          { source: 's2', status: 'empty' },
        ],
      },
      tier4: { dblpFound: true, journalKnown: null, urlAlive: null },
    });
    expect(computeVerdict(entry({ doi: undefined }), ev).verdict).toBe('UNVERIFIABLE');
  });

  it('UNVERIFIABLE when searches never ran', () => {
    expect(computeVerdict(entry(), evidence()).verdict).toBe('UNVERIFIABLE');
  });

  it('NOT_FOUND when searches answered with candidates but none passed the same-paper gate', () => {
    // Live Crossref/OpenAlex relevance search always returns something;
    // "answered, nothing matched" is the real hallmark of a hallucinated entry.
    const ev = evidence({
      tier3: {
        matches: [record({ title: 'Some Unrelated Candidate Paper' })],
        searches: [
          { source: 'crossref', status: 'ok' },
          { source: 'openalex', status: 'ok' },
          { source: 's2', status: 'empty' },
        ],
      },
      tier4: { dblpFound: false, journalKnown: null, urlAlive: null },
    });
    expect(computeVerdict(entry({ doi: undefined }), ev).verdict).toBe('NOT_FOUND');
  });

  it('no venue diff for non-Crossref matched records (OpenAlex venue vocabulary)', () => {
    const ev = evidence({
      bestMatch: {
        record: record({ source: 'openalex', venue: 'Proceedings of Machine Learning Research' }),
        score: { title: 1, author: 1, year: 'match' },
      },
    });
    const r = computeVerdict(
      entry({ venue: 'Proceedings of the 34th International Conference on Machine Learning' }),
      ev,
    );
    expect(r.verdict).toBe('VERIFIED');
  });
});
