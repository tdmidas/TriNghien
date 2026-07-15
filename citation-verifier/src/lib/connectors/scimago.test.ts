import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { server } from '../../../vitest.setup';
import { journalKnown, resetScimagoCache, scimagoQuartile } from './scimago';

// The optional CSV is not present in the repo (gitignored, download-on-demand),
// so these tests exercise the degrade path plus the two primary signals.

describe('scimagoQuartile without the optional CSV', () => {
  beforeEach(() => resetScimagoCache());

  it('degrades to undefined', () => {
    expect(scimagoQuartile('Machine Learning')).toBeUndefined();
    expect(scimagoQuartile(undefined)).toBeUndefined();
  });
});

describe('journalKnown', () => {
  beforeEach(() => resetScimagoCache());

  it('true when bib venue agrees with the canonical venue (no network)', async () => {
    expect(
      await journalKnown(
        'Proc. of the 34th International Conference on Machine Learning',
        'Proceedings of the 34th International Conference on Machine Learning',
        undefined,
      ),
    ).toBe(true);
  });

  it('falls back to Crossref /journals/{issn} when venues disagree', async () => {
    server.use(
      http.get('https://api.crossref.org/journals/1063-6919', () => HttpResponse.json({})),
    );
    expect(await journalKnown('Some Journal', 'A Different Venue Entirely', '1063-6919')).toBe(
      true,
    );
  });

  it('false when Crossref does not know the ISSN', async () => {
    server.use(
      http.get('https://api.crossref.org/journals/0000-0000', () =>
        new HttpResponse(null, { status: 404 }),
      ),
    );
    expect(await journalKnown(undefined, 'Journal of Intelligent Cyber Security', '0000-0000')).toBe(
      false,
    );
  });

  it('null when no signal is available', async () => {
    expect(await journalKnown('Journal of Intelligent Cyber Security', undefined, undefined)).toBeNull();
  });
});
