import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../../../vitest.setup';
import { crossrefByDoi, crossrefJournalExists, crossrefSearch } from './crossref';

const WORK = {
  message: {
    DOI: '10.1109/cvpr.2017.587',
    title: ['iCaRL: Incremental Classifier and Representation Learning'],
    author: [
      { given: 'Sylvestre-Alvise', family: 'Rebuffi' },
      { given: 'Alexander', family: 'Kolesnikov' },
    ],
    issued: { 'date-parts': [[2017, 7]] },
    'container-title': ['2017 IEEE Conference on Computer Vision and Pattern Recognition (CVPR)'],
    ISSN: ['1063-6919'],
    URL: 'https://doi.org/10.1109/cvpr.2017.587',
  },
};

describe('crossrefByDoi', () => {
  it('maps a 200 works response to a CanonicalRecord', async () => {
    server.use(http.get('https://api.crossref.org/works/*', () => HttpResponse.json(WORK)));
    const r = await crossrefByDoi('10.1109/CVPR.2017.587');
    expect(r.found).toBe(true);
    expect(r.record).toMatchObject({
      source: 'crossref',
      title: 'iCaRL: Incremental Classifier and Representation Learning',
      authors: ['Sylvestre-Alvise Rebuffi', 'Alexander Kolesnikov'],
      year: 2017,
      issn: '1063-6919',
      doi: '10.1109/cvpr.2017.587',
    });
  });

  it('404 means the DOI is unknown to Crossref (hard negative)', async () => {
    server.use(
      http.get('https://api.crossref.org/works/*', () => new HttpResponse(null, { status: 404 })),
    );
    expect(await crossrefByDoi('10.5555/jics.2026.03145')).toEqual({ found: false });
  });

  it('5xx is inconclusive, not negative', async () => {
    server.use(
      http.get('https://api.crossref.org/works/*', () => new HttpResponse(null, { status: 500 })),
    );
    expect((await crossrefByDoi('10.1109/CVPR.2017.587')).found).toBeNull();
  });

  it('network error is inconclusive', async () => {
    server.use(http.get('https://api.crossref.org/works/*', () => HttpResponse.error()));
    expect((await crossrefByDoi('10.1109/CVPR.2017.587')).found).toBeNull();
  });

  it('does not poison the cache with a transient failure (Retry can heal)', async () => {
    let calls = 0;
    server.use(
      http.get('https://api.crossref.org/works/*', () => {
        calls += 1;
        return calls === 1 ? new HttpResponse(null, { status: 500 }) : HttpResponse.json(WORK);
      }),
    );
    expect((await crossrefByDoi('10.1109/CVPR.2017.587')).found).toBeNull();
    expect((await crossrefByDoi('10.1109/CVPR.2017.587')).found).toBe(true);
    expect(calls).toBe(2);
  });
});

describe('crossrefSearch', () => {
  it('returns mapped candidates', async () => {
    server.use(
      http.get('https://api.crossref.org/works', () =>
        HttpResponse.json({ message: { items: [WORK.message] } }),
      ),
    );
    const out = await crossrefSearch('iCaRL');
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('crossref');
  });

  it('returns [] when there are no items (empty, not error)', async () => {
    server.use(
      http.get('https://api.crossref.org/works', () =>
        HttpResponse.json({ message: { items: [] } }),
      ),
    );
    expect(await crossrefSearch('nothing matches this')).toEqual([]);
  });

  it('throws on 5xx so the pipeline can record a search error', async () => {
    server.use(
      http.get('https://api.crossref.org/works', () => new HttpResponse(null, { status: 500 })),
    );
    await expect(crossrefSearch('boom')).rejects.toThrow('crossref-search 500');
  });
});

describe('crossrefJournalExists', () => {
  it('200 -> true, 404 -> false, error -> null', async () => {
    server.use(
      http.get('https://api.crossref.org/journals/1063-6919', () => HttpResponse.json({})),
      http.get('https://api.crossref.org/journals/0000-0000', () =>
        new HttpResponse(null, { status: 404 }),
      ),
      http.get('https://api.crossref.org/journals/9999-9999', () => HttpResponse.error()),
    );
    expect(await crossrefJournalExists('1063-6919')).toBe(true);
    expect(await crossrefJournalExists('0000-0000')).toBe(false);
    expect(await crossrefJournalExists('9999-9999')).toBeNull();
  });
});
