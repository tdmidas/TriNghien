import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../../../vitest.setup';
import { dblpHasPlausibleHit } from './dblp';

const API = 'https://dblp.org/search/publ/api';
const TITLE = 'Model-Agnostic Meta-Learning for Fast Adaptation of Deep Networks';

describe('dblpHasPlausibleHit', () => {
  it('true when a hit plausibly matches the title', async () => {
    server.use(
      http.get(API, () =>
        HttpResponse.json({ result: { hits: { hit: [{ info: { title: TITLE } }] } } }),
      ),
    );
    expect(await dblpHasPlausibleHit(TITLE)).toBe(true);
  });

  it('false when hits exist but none matches', async () => {
    server.use(
      http.get(API, () =>
        HttpResponse.json({
          result: { hits: { hit: [{ info: { title: 'A Totally Unrelated Database Paper' } }] } },
        }),
      ),
    );
    expect(await dblpHasPlausibleHit(TITLE)).toBe(false);
  });

  it('false when there are zero hits', async () => {
    server.use(http.get(API, () => HttpResponse.json({ result: { hits: {} } })));
    expect(await dblpHasPlausibleHit(TITLE)).toBe(false);
  });

  it('null (inconclusive) on HTTP failure', async () => {
    server.use(http.get(API, () => new HttpResponse(null, { status: 500 })));
    expect(await dblpHasPlausibleHit(TITLE)).toBeNull();
  });
});
