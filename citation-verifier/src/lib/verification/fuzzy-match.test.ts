import { describe, expect, it } from 'vitest';

import {
  AUTHOR_MATCH,
  TITLE_MATCH,
  TITLE_STRONG,
  authorSim,
  dice,
  isSamePaper,
  scoreAgainst,
  titleSim,
  yearStatus,
} from './fuzzy-match';
import type { CanonicalRecord, ParsedEntry } from './types';

describe('dice', () => {
  it('identical strings score 1', () => {
    expect(dice('night', 'night')).toBe(1);
  });

  it('empty strings score 0', () => {
    expect(dice('', '')).toBe(0);
    expect(dice('a', 'ab')).toBe(0);
  });

  it('classic bigram case', () => {
    // night/nacht share the "ht" bigram: 2*1/(4+4) = 0.25
    expect(dice('night', 'nacht')).toBeCloseTo(0.25, 5);
  });
});

describe('titleSim', () => {
  it('same title scores >= 0.99', () => {
    const t = 'Model-Agnostic Meta-Learning for Fast Adaptation of Deep Networks';
    expect(titleSim(t, t)).toBeGreaterThanOrEqual(0.99);
  });

  it('casing/brace variants still match', () => {
    expect(
      titleSim('How to train your {MAML}', 'How to Train Your MAML'),
    ).toBeGreaterThanOrEqual(TITLE_MATCH);
  });

  it('unrelated titles score < 0.5', () => {
    expect(
      titleSim(
        'Model-Agnostic Meta-Learning for Fast Adaptation of Deep Networks',
        'A Study of Coral Reef Bleaching in the Pacific Ocean',
      ),
    ).toBeLessThan(0.5);
  });

  it('missing input scores 0', () => {
    expect(titleSim(undefined, 'x')).toBe(0);
    expect(titleSim('x', undefined)).toBe(0);
  });
});

describe('authorSim', () => {
  it('full overlap scores 1', () => {
    expect(
      authorSim(
        ['Chelsea Finn', 'Pieter Abbeel', 'Sergey Levine'],
        ['Finn, Chelsea', 'Abbeel, Pieter', 'Levine, Sergey'],
      ),
    ).toBe(1);
  });

  it('disjoint author sets score 0', () => {
    expect(authorSim(['Chelsea Finn'], ['Marie Curie'])).toBe(0);
  });

  it('empty lists score 0', () => {
    expect(authorSim([], ['x'])).toBe(0);
  });
});

describe('venueMatches', () => {
  it('containment counts as agreement (proceedings boilerplate)', async () => {
    const { venueMatches } = await import('./fuzzy-match');
    expect(
      venueMatches(
        'Proceedings of the 34th International Conference on Machine Learning',
        'International Conference on Machine Learning',
      ),
    ).toBe(true);
  });

  it('genuinely different venues do not match', async () => {
    const { venueMatches } = await import('./fuzzy-match');
    expect(venueMatches('Journal of Intelligent Cyber Security', 'Marine Biology')).toBe(false);
  });

  it('missing side is null (cannot compare)', async () => {
    const { venueMatches } = await import('./fuzzy-match');
    expect(venueMatches(undefined, 'ICML')).toBeNull();
    expect(venueMatches('ICML', undefined)).toBeNull();
  });
});

describe('yearStatus', () => {
  it('classifies match / off-by-one / mismatch / unknown', () => {
    expect(yearStatus(2017, 2017)).toBe('match');
    expect(yearStatus(2017, 2018)).toBe('off-by-one');
    expect(yearStatus(2017, 2020)).toBe('mismatch');
    expect(yearStatus(undefined, 2017)).toBe('unknown');
  });
});

describe('isSamePaper', () => {
  it('strong title + year corroboration passes', () => {
    expect(isSamePaper({ title: TITLE_STRONG, author: 0, year: 'match' })).toBe(true);
    expect(isSamePaper({ title: TITLE_STRONG, author: 0, year: 'off-by-one' })).toBe(true);
  });

  it('match-level title needs author or exact year', () => {
    expect(isSamePaper({ title: TITLE_MATCH, author: AUTHOR_MATCH, year: 'unknown' })).toBe(true);
    expect(isSamePaper({ title: TITLE_MATCH, author: 0, year: 'match' })).toBe(true);
    expect(isSamePaper({ title: TITLE_MATCH, author: 0, year: 'off-by-one' })).toBe(false);
  });

  it('strong title alone (no second signal) fails', () => {
    expect(isSamePaper({ title: 0.99, author: 0, year: 'unknown' })).toBe(false);
  });

  it('weak title always fails', () => {
    expect(isSamePaper({ title: 0.5, author: 1, year: 'match' })).toBe(false);
  });
});

describe('scoreAgainst', () => {
  it('scores an entry against a canonical record', () => {
    const entry: ParsedEntry = {
      key: 'maml',
      type: 'inproceedings',
      title: 'Model-Agnostic Meta-Learning for Fast Adaptation of Deep Networks',
      authors: ['Chelsea Finn', 'Pieter Abbeel', 'Sergey Levine'],
      year: 2017,
      fields: {},
      raw: '',
    };
    const record: CanonicalRecord = {
      source: 'crossref',
      title: 'Model-Agnostic Meta-Learning for Fast Adaptation of Deep Networks',
      authors: ['Finn, Chelsea', 'Abbeel, Pieter', 'Levine, Sergey'],
      year: 2017,
    };
    const s = scoreAgainst(entry, record);
    expect(s.title).toBeGreaterThanOrEqual(0.99);
    expect(s.author).toBe(1);
    expect(s.year).toBe('match');
    expect(isSamePaper(s)).toBe(true);
  });
});
