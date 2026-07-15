import { describe, expect, it } from 'vitest';

import { LlmOutputSchema } from '@/lib/verification/schemas';
import { sanitizeCorrection } from '@/lib/verification/sanitize-correction';
import type { Evidence } from '@/lib/verification/types';

// The LLM-output trust boundary: schema validation + evidence cross-check.

const evidence: Evidence = {
  entryKey: 'icarl_doctored',
  bestMatch: {
    record: {
      source: 'crossref',
      title: 'iCaRL: Incremental Classifier and Representation Learning',
      authors: ['Sylvestre-Alvise Rebuffi', 'Alexander Kolesnikov'],
      year: 2017,
      venue: '2017 IEEE Conference on Computer Vision and Pattern Recognition (CVPR)',
      doi: '10.1109/cvpr.2017.587',
    },
    score: { title: 1, author: 1, year: 'mismatch' },
  },
  diffs: [],
  apiCalls: [],
};

describe('LLM output sanitization (trust boundary)', () => {
  it('keeps the evidence-backed year, drops an out-of-evidence DOI', () => {
    const llmOutput = LlmOutputSchema.parse({
      explanation: 'Năm xuất bản không khớp: nguồn Crossref ghi 2017.',
      correctedEntry: { year: 2017, doi: '10.9999/hallucinated.by.model' },
    });
    const sanitized = sanitizeCorrection(llmOutput.correctedEntry!, evidence);
    expect(sanitized).toEqual({ year: 2017 });
  });

  it('strips braces/newlines from LLM strings via the schema transform', () => {
    const out = LlmOutputSchema.parse({
      explanation: 'ok',
      correctedEntry: { title: 'iCaRL: {Incremental}\nClassifier' },
    });
    expect(out.correctedEntry!.title).toBe('iCaRL: Incremental Classifier');
  });

  it('truncates an over-long explanation instead of failing the parse', () => {
    const out = LlmOutputSchema.parse({ explanation: 'x'.repeat(900) });
    expect(out.explanation).toHaveLength(500);
  });

  it('cleans braces/newlines from corrected author strings', () => {
    const out = LlmOutputSchema.parse({
      explanation: 'ok',
      correctedEntry: { authors: ['{Finn},\nChelsea'] },
    });
    expect(out.correctedEntry!.authors).toEqual(['Finn, Chelsea']);
  });

  it('rejects a malformed DOI at the schema layer', () => {
    expect(() =>
      LlmOutputSchema.parse({
        explanation: 'x',
        correctedEntry: { doi: 'not-a-doi' },
      }),
    ).toThrow();
  });

  it('the documented prompt JSON example round-trips the schema', () => {
    // Mirrors the response contract stated in build-prompt SYSTEM.
    const example = {
      explanation: 'Bài báo được xác minh qua Crossref.',
      correctedEntry: {
        title: 'Some Title',
        authors: ['Finn, Chelsea'],
        year: 2017,
        venue: 'ICML',
        doi: '10.5555/3305381.3305498',
      },
    };
    expect(() => LlmOutputSchema.parse(example)).not.toThrow();
  });
});
