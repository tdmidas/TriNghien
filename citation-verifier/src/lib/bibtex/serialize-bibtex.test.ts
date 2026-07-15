import { describe, expect, it } from 'vitest';

import { normalizeTitle } from '@/lib/verification/normalize';

import { parseBib } from './parse-bibtex';
import { serializeBib, serializeEntry } from './serialize-bibtex';

const SRC = `@InProceedings{maml,
  title     = {Model-Agnostic Meta-Learning for Fast Adaptation of Deep Networks},
  author    = {Chelsea Finn and Pieter Abbeel and Sergey Levine},
  booktitle = {Proceedings of the 34th International Conference on Machine Learning},
  year      = {2017},
  url       = {https://proceedings.mlr.press/v70/finn17a.html}
}`;

describe('serializeEntry', () => {
  const { entries } = parseBib(SRC);
  const maml = entries[0];

  it('returns raw source verbatim for untouched entries', () => {
    expect(serializeEntry(maml)).toBe(SRC);
  });

  it('rebuilds the entry when corrections are applied', () => {
    const out = serializeEntry(maml, { year: 2018 });
    expect(out).toContain('year = {2018}');
    // Parser lowercases entry types; BibTeX types are case-insensitive.
    expect(out).toContain('@inproceedings{maml,');
    expect(out).toContain('title = {Model-Agnostic Meta-Learning');
  });

  it('joins corrected authors with " and "', () => {
    const out = serializeEntry(maml, { authors: ['Finn, Chelsea', 'Abbeel, Pieter'] });
    expect(out).toContain('author = {Finn, Chelsea and Abbeel, Pieter}');
  });

  it('writes venue into booktitle when the entry has no journal', () => {
    const out = serializeEntry(maml, { venue: 'ICML 2017' });
    expect(out).toContain('booktitle = {ICML 2017}');
  });

  it('strips the __dup suffix from the key on output', () => {
    const { entries: dups } = parseBib(
      '@article{same, title={A}}\n@article{same, title={B}}',
    );
    const out = serializeEntry(dups[1], { year: 2020 });
    expect(out).toContain('@article{same,');
    expect(out).not.toContain('__dup');
  });

  it('strips braces only from UNBALANCED corrected values', () => {
    const out = serializeEntry(maml, { title: 'Bad } Title' });
    expect(out).toContain('title = {Bad  Title}');
  });

  it('corporate (literal) authors survive a rebuild with balanced braces', () => {
    const { entries } = parseBib(
      '@techreport{gpt4, title={GPT-4 Technical Report}, author={{OpenAI} and Smith, John}, year={2023}}\n' +
        '@misc{next, title={Following Entry}, year={2024}}',
    );
    const rebuilt = serializeEntry(entries[0], { year: 2023 });
    // braces stay balanced and the re-parse keeps BOTH entries intact
    const { entries: again, parseErrors } = parseBib(`${rebuilt}\n\n@misc{next, title={Following Entry}, year={2024}}`);
    expect(parseErrors).toEqual([]);
    expect(again).toHaveLength(2);
    expect(again[0].authors).toContain('OpenAI');
    expect(again[0].authors).toContain('John Smith');
  });
});

describe('serializeBib round-trip', () => {
  it('re-parse of serialized output preserves normalized titles', () => {
    const { entries } = parseBib(SRC);
    const rebuilt = serializeBib(entries, { maml: { year: 2017 } });
    const { entries: again } = parseBib(rebuilt);
    expect(again).toHaveLength(1);
    expect(normalizeTitle(again[0].title!)).toBe(normalizeTitle(entries[0].title!));
  });

  it('joins multiple entries with blank lines and trailing newline', () => {
    const { entries } = parseBib('@misc{a, title={A}}\n@misc{b, title={B}}');
    const out = serializeBib(entries);
    expect(out).toContain('@misc{a');
    expect(out).toContain('@misc{b');
    expect(out.endsWith('\n')).toBe(true);
  });
});
