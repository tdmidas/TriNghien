import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../../../vitest.setup';
import { openalexSearch } from './openalex';

describe('openalexSearch', () => {
  it('maps results and strips the doi.org prefix', async () => {
    let seenUrl = '';
    server.use(
      http.get('https://api.openalex.org/works', ({ request }) => {
        seenUrl = request.url;
        return HttpResponse.json({
          results: [
            {
              display_name: 'How to train your MAML',
              publication_year: 2019,
              doi: 'https://doi.org/10.48550/arxiv.1810.09502',
              authorships: [{ author: { display_name: 'Antreas Antoniou' } }],
              primary_location: {
                source: { display_name: 'ICLR', issn_l: '1234-5678' },
              },
            },
          ],
        });
      }),
    );
    const out = await openalexSearch('How to train your MAML, revised');
    expect(out[0]).toMatchObject({
      source: 'openalex',
      title: 'How to train your MAML',
      year: 2019,
      doi: '10.48550/arxiv.1810.09502',
      venue: 'ICLR',
      issn: '1234-5678',
    });
    // commas are stripped from the filter value (OpenAlex separator syntax)
    expect(new URL(seenUrl).searchParams.get('filter')).not.toContain(',');
  });

  it('returns [] for an empty result set', async () => {
    server.use(http.get('https://api.openalex.org/works', () => HttpResponse.json({ results: [] })));
    expect(await openalexSearch('nothing')).toEqual([]);
  });

  it('throws on 5xx so the pipeline records a search error', async () => {
    server.use(
      http.get('https://api.openalex.org/works', () => new HttpResponse(null, { status: 500 })),
    );
    await expect(openalexSearch('boom')).rejects.toThrow('openalex-search 500');
  });
});
