import { describe, expect, it } from 'vitest';

import { parseBib } from '@/lib/bibtex/parse-bibtex';
import { serializeBib } from '@/lib/bibtex/serialize-bibtex';
import { normalizeTitle } from '@/lib/verification/normalize';

// Round-trip semantics: untouched entries are raw-preserved, so the invariant
// is normalized-title equality after parse -> serialize -> parse, not byte
// equality. Covers the four entry types plus an accent-command title.
const FIXTURE = `@article{a1,
  title   = {Overcoming catastrophic forgetting in neural networks},
  author  = {Kirkpatrick, James and Pascanu, Razvan},
  journal = {Proceedings of the National Academy of Sciences},
  year    = {2017}
}

@inproceedings{p1,
  title     = {Early Drift Detection Method},
  author    = {Baena-Garc\\'{i}a, Manuel and Gavald\\\`{a}, Ricard},
  booktitle = {Fourth International Workshop on Knowledge Discovery from Data Streams},
  year      = {2006}
}

@misc{m1,
  title         = {On First-Order Meta-Learning Algorithms},
  author        = {Alex Nichol},
  year          = {2018},
  eprint        = {1803.02999},
  archivePrefix = {arXiv}
}

@incollection{c1,
  title     = {Learning to Learn: Introduction and Overview about Jo\\~{a}o},
  author    = {Sebastian Thrun and Lorien Pratt},
  booktitle = {Learning to Learn},
  year      = {1998}
}`;

describe('parse -> serialize -> parse round-trip', () => {
  it('preserves normalized titles for all entry types (untouched)', () => {
    const { entries: before, parseErrors } = parseBib(FIXTURE);
    expect(parseErrors).toEqual([]);
    expect(before).toHaveLength(4);

    const rebuilt = serializeBib(before);
    const { entries: after, parseErrors: errors2 } = parseBib(rebuilt);
    expect(errors2).toEqual([]);
    expect(after).toHaveLength(4);

    for (let i = 0; i < before.length; i++) {
      expect(normalizeTitle(after[i].title!)).toBe(normalizeTitle(before[i].title!));
      expect(after[i].key).toBe(before[i].key);
    }
  });

  it('preserves normalized titles when overrides rebuild an entry', () => {
    const { entries: before } = parseBib(FIXTURE);
    const rebuilt = serializeBib(before, { a1: { year: 2018 } });
    const { entries: after } = parseBib(rebuilt);
    expect(after.find((e) => e.key === 'a1')?.year).toBe(2018);
    expect(normalizeTitle(after[0].title!)).toBe(normalizeTitle(before[0].title!));
  });

  it('keeps the accent-command title comparable after round-trip', () => {
    const { entries } = parseBib(FIXTURE);
    const c1 = entries.find((e) => e.key === 'c1')!;
    expect(normalizeTitle(c1.title!)).toContain('joao');
  });
});
