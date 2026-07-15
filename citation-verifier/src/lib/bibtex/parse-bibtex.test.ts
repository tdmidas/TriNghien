import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MAX_ENTRIES, parseBib } from './parse-bibtex';

// Synced from repo-root references.bib by the sync:demo script.
const demoBib = readFileSync(resolve(process.cwd(), 'public/demo-references.bib'), 'utf8');

describe('parseBib on the demo references.bib', () => {
  const { entries, parseErrors } = parseBib(demoBib);
  const byKey = new Map(entries.map((e) => [e.key, e]));

  it('parses all 40 entries with no errors', () => {
    expect(entries).toHaveLength(40);
    expect(parseErrors).toEqual([]);
  });

  it('extracts the fabricated DOI of nguyen2026llmfuzzx', () => {
    expect(byKey.get('nguyen2026llmfuzzx')?.doi).toBe('10.5555/jics.2026.03145');
  });

  it('extracts fomaml arXiv id from eprint + archivePrefix', () => {
    expect(byKey.get('fomaml')?.arxivId).toBe('1803.02999');
  });

  it('extracts maml url and venue (mixed-case @InProceedings)', () => {
    const maml = byKey.get('maml');
    expect(maml?.url).toBe('https://proceedings.mlr.press/v70/finn17a.html');
    expect(maml?.venue).toContain('34th International Conference on Machine Learning');
    expect(maml?.type.toLowerCase()).toBe('inproceedings');
  });

  it('extracts icarl DOI', () => {
    expect(byKey.get('icarl')?.doi).toBe('10.1109/CVPR.2017.587');
  });

  it('converts accent commands to Unicode in author names (Path A)', () => {
    // Parser emits decomposed Unicode (NFD) — normalize before comparing.
    const all = entries.flatMap((e) => e.authors).join(' | ').normalize('NFC');
    expect(all).toContain('João');
    expect(all).toContain('Schölkopf');
  });

  it('preserves raw source per entry', () => {
    expect(byKey.get('maml')?.raw).toContain('@InProceedings{maml');
  });
});

describe('parseBib edge cases', () => {
  it('reports parseErrors for malformed input while keeping good entries', () => {
    const { entries, parseErrors } = parseBib(
      '@article{good, title={Fine}, year={2020}}\n@article{bad, title={Unterminated',
    );
    expect(entries.some((e) => e.key === 'good')).toBe(true);
    expect(parseErrors.length).toBeGreaterThan(0);
  });

  it('dedupes duplicate keys with a __dup suffix', () => {
    const { entries } = parseBib(
      '@article{same, title={A}, year={2020}}\n@article{same, title={B}, year={2021}}',
    );
    expect(entries.map((e) => e.key)).toEqual(['same', 'same__dup1']);
  });

  it('caps at MAX_ENTRIES and reports the truncation', () => {
    const many = Array.from(
      { length: MAX_ENTRIES + 1 },
      (_, i) => `@misc{e${i}, title={Entry ${i}}, year={2020}}`,
    ).join('\n');
    const { entries, parseErrors } = parseBib(many);
    expect(entries).toHaveLength(MAX_ENTRIES);
    expect(parseErrors.some((m) => m.includes(`first ${MAX_ENTRIES}`))).toBe(true);
  });

  it('strips doi.org URL prefix from doi field', () => {
    const { entries } = parseBib(
      '@article{d, title={X}, doi={https://doi.org/10.1109/CVPR.2017.587}}',
    );
    expect(entries[0].doi).toBe('10.1109/CVPR.2017.587');
  });

  it('handles corporate (literal) authors', () => {
    const { entries } = parseBib('@misc{c, title={X}, author={{OpenAI Research Team}}}');
    expect(entries[0].authors).toEqual(['OpenAI Research Team']);
  });

  it('keeps name particles (prefix) instead of dropping them', () => {
    const { entries } = parseBib('@misc{v, title={X}, author={von Neumann, John}}');
    expect(entries[0].authors).toEqual(['John von Neumann']);
    expect(entries[0].fields.author).toContain('von Neumann, John');
  });
});
