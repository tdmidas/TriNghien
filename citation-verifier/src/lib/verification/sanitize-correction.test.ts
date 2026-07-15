import { describe, expect, it } from 'vitest';

import { sanitizeCorrection } from './sanitize-correction';
import type { CanonicalRecord, Evidence } from './types';

const record: CanonicalRecord = {
  source: 'crossref',
  title: 'Model-Agnostic Meta-Learning for Fast Adaptation of Deep Networks',
  authors: ['Finn, Chelsea', 'Abbeel, Pieter', 'Levine, Sergey'],
  year: 2017,
  venue: 'International Conference on Machine Learning',
  doi: '10.5555/3305381.3305498',
};

const evidence = (over: Partial<Evidence> = {}): Evidence => ({
  entryKey: 'test',
  diffs: [],
  apiCalls: [],
  ...over,
});

describe('sanitizeCorrection', () => {
  const evWithBest = evidence({
    bestMatch: { record, score: { title: 1, author: 1, year: 'match' } },
  });

  it('keeps a year that matches the evidence record', () => {
    expect(sanitizeCorrection({ year: 2017 }, evWithBest)).toEqual({ year: 2017 });
  });

  it('drops an LLM-invented DOI absent from evidence', () => {
    const out = sanitizeCorrection({ doi: '10.9999/invented.doi', year: 2017 }, evWithBest);
    expect(out.doi).toBeUndefined();
    expect(out.year).toBe(2017);
  });

  it('keeps a DOI that exactly matches evidence (case-insensitive)', () => {
    expect(sanitizeCorrection({ doi: '10.5555/3305381.3305498' }, evWithBest).doi).toBe(
      '10.5555/3305381.3305498',
    );
  });

  it('drops a title that does not near-exactly match evidence', () => {
    expect(sanitizeCorrection({ title: 'Some Other Paper Title' }, evWithBest).title).toBeUndefined();
  });

  it('keeps a near-exact title', () => {
    const t = 'Model-Agnostic Meta-Learning for Fast Adaptation of Deep Networks';
    expect(sanitizeCorrection({ title: t }, evWithBest).title).toBe(t);
  });

  it('returns {} when evidence has no record at all', () => {
    expect(sanitizeCorrection({ year: 2017, title: 'x' }, evidence())).toEqual({});
  });

  it('falls back to tier1 record when bestMatch is unset', () => {
    const ev = evidence({
      tier1: { doiPresent: true, doiHandleExists: true, crossrefFound: true, record },
    });
    expect(sanitizeCorrection({ year: 2017 }, ev)).toEqual({ year: 2017 });
  });
});
