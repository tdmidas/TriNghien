import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../../../vitest.setup';
import { s2Match } from './semantic-scholar';

const MATCH_URL = 'https://api.semanticscholar.org/graph/v1/paper/search/match';

describe('s2Match', () => {
  it('maps the best match to a CanonicalRecord', async () => {
    server.use(
      http.get(MATCH_URL, () =>
        HttpResponse.json({
          data: [
            {
              title: 'Model-Agnostic Meta-Learning for Fast Adaptation of Deep Networks',
              year: 2017,
              venue: 'International Conference on Machine Learning',
              authors: [{ name: 'Chelsea Finn' }, { name: 'Pieter Abbeel' }],
              externalIds: { DOI: '10.5555/3305381.3305498' },
            },
          ],
        }),
      ),
    );
    const r = await s2Match('Model-Agnostic Meta-Learning');
    expect(r).toMatchObject({
      source: 'semantic-scholar',
      year: 2017,
      doi: '10.5555/3305381.3305498',
      authors: ['Chelsea Finn', 'Pieter Abbeel'],
    });
  });

  it('404 means no title match (empty, not error)', async () => {
    server.use(http.get(MATCH_URL, () => new HttpResponse(null, { status: 404 })));
    expect(await s2Match('unknown paper title')).toBeNull();
  });

  it('unexpected shape is inconclusive null', async () => {
    server.use(http.get(MATCH_URL, () => HttpResponse.json({ something: 'else' })));
    expect(await s2Match('weird shape')).toBeNull();
  });

  it('throws on 5xx so the pipeline records a search error', async () => {
    server.use(http.get(MATCH_URL, () => new HttpResponse(null, { status: 500 })));
    await expect(s2Match('boom')).rejects.toThrow('s2-match 500');
  });
});
