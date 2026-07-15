import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { server } from '../../../vitest.setup';
import { computeVerdict } from './compute-verdict';
import { verifyEntry } from './pipeline';
import type { ParsedEntry } from './types';

vi.mock('node:dns/promises', () => ({
  default: {
    lookup: vi.fn(async (hostname: string) => {
      if (hostname === 'proceedings.mlr.press') return [{ address: '93.184.216.34', family: 4 }];
      throw new Error('ENOTFOUND');
    }),
  },
}));

const entry = (over: Partial<ParsedEntry>): ParsedEntry => ({
  key: 'k',
  type: 'article',
  authors: [],
  fields: {},
  raw: '',
  ...over,
});

const emptySearchHandlers = () => [
  http.get('https://api.crossref.org/works', () =>
    HttpResponse.json({ message: { items: [] } }),
  ),
  http.get('https://api.openalex.org/works', () => HttpResponse.json({ results: [] })),
  http.get('https://api.semanticscholar.org/graph/v1/paper/search/match', () =>
    new HttpResponse(null, { status: 404 }),
  ),
  http.get('https://dblp.org/search/publ/api', () =>
    HttpResponse.json({ result: { hits: {} } }),
  ),
];

describe('verifyEntry — fabricated DOI (nguyen2026llmfuzzx shape)', () => {
  it('collects hard negatives on every signal -> NOT_FOUND-ready', async () => {
    server.use(
      http.get('https://doi.org/api/handles/*', () =>
        HttpResponse.json({ responseCode: 100 }),
      ),
      http.get('https://api.crossref.org/works/*', () => new HttpResponse(null, { status: 404 })),
      ...emptySearchHandlers(),
    );
    const ev = await verifyEntry(
      entry({
        key: 'nguyen2026llmfuzzx',
        title: 'LLMFuzzX: Autonomous Smart Contract Fuzzing with Multi-Agent Reasoning',
        authors: ['Minh Anh Nguyen'],
        year: 2026,
        venue: 'Journal of Intelligent Cyber Security',
        doi: '10.5555/jics.2026.03145',
      }),
    );
    expect(ev.tier1).toMatchObject({ doiHandleExists: false, crossrefFound: false });
    expect(ev.tier3!.searches.map((s) => s.status)).toEqual(['empty', 'empty', 'empty']);
    expect(ev.bestMatch).toBeUndefined();
    expect(ev.tier4).toMatchObject({ dblpFound: false });
    expect(computeVerdict(entry({ doi: '10.5555/jics.2026.03145' }), ev).verdict).toBe(
      'NOT_FOUND',
    );
  });
});

describe('verifyEntry — valid DOI (icarl shape)', () => {
  it('tier-1 record passes the same-paper gate -> VERIFIED-ready', async () => {
    server.use(
      http.get('https://doi.org/api/handles/*', () => HttpResponse.json({ responseCode: 1 })),
      http.get('https://api.crossref.org/works/*', () =>
        HttpResponse.json({
          message: {
            DOI: '10.1109/cvpr.2017.587',
            title: ['iCaRL: Incremental Classifier and Representation Learning'],
            author: [
              { given: 'Sylvestre-Alvise', family: 'Rebuffi' },
              { given: 'Alexander', family: 'Kolesnikov' },
              { given: 'Georg', family: 'Sperl' },
              { given: 'Christoph H.', family: 'Lampert' },
            ],
            issued: { 'date-parts': [[2017]] },
            'container-title': [
              '2017 IEEE Conference on Computer Vision and Pattern Recognition (CVPR)',
            ],
            ISSN: ['1063-6919'],
          },
        }),
      ),
    );
    const e = entry({
      key: 'icarl',
      title: 'i{C}a{RL}: Incremental Classifier and Representation Learning',
      authors: [
        'Rebuffi, Sylvestre-Alvise',
        'Kolesnikov, Alexander',
        'Sperl, Georg',
        'Lampert, Christoph H.',
      ],
      year: 2017,
      venue: '2017 IEEE Conference on Computer Vision and Pattern Recognition (CVPR)',
      doi: '10.1109/CVPR.2017.587',
    });
    const ev = await verifyEntry(e);
    expect(ev.bestMatch).toBeDefined();
    expect(ev.tier4).toMatchObject({ dblpFound: null, journalKnown: true });
    expect(computeVerdict(e, ev).verdict).toBe('VERIFIED');
  });
});

describe('verifyEntry — repurposed DOI', () => {
  it('keeps tier1.record but not bestMatch -> NOT_FOUND-ready', async () => {
    server.use(
      http.get('https://doi.org/api/handles/*', () => HttpResponse.json({ responseCode: 1 })),
      http.get('https://api.crossref.org/works/*', () =>
        HttpResponse.json({
          message: {
            DOI: '10.1234/real.paper',
            title: ['A Completely Different Paper About Coral Reefs'],
            author: [{ given: 'Marie', family: 'Curie' }],
            issued: { 'date-parts': [[1998]] },
            'container-title': ['Marine Biology'],
          },
        }),
      ),
      ...emptySearchHandlers(),
      http.get('https://api.crossref.org/journals/*', () => new HttpResponse(null, { status: 404 })),
    );
    const e = entry({
      key: 'fake',
      title: 'Quantum Blockchain Consensus via Deep Reinforcement Learning',
      authors: ['Some Author'],
      year: 2025,
      venue: 'Journal of Advanced Everything',
      doi: '10.1234/real.paper',
    });
    const ev = await verifyEntry(e);
    expect(ev.tier1?.record?.title).toContain('Coral Reefs');
    expect(ev.bestMatch).toBeUndefined();
    expect(ev.tier3!.searches).toHaveLength(3);
    expect(computeVerdict(e, ev).verdict).toBe('NOT_FOUND');
  });
});

describe('verifyEntry — arXiv id (fomaml shape)', () => {
  it('tier-2 match -> VERIFIED-ready', async () => {
    server.use(
      http.get('https://export.arxiv.org/api/query', () =>
        HttpResponse.text(
          `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry>
            <id>http://arxiv.org/abs/1803.02999v3</id>
            <title>On First-Order Meta-Learning Algorithms</title>
            <published>2018-03-08T17:58:48Z</published>
            <author><name>Alex Nichol</name></author>
            <author><name>Joshua Achiam</name></author>
            <author><name>John Schulman</name></author>
          </entry></feed>`,
          { headers: { 'Content-Type': 'application/atom+xml' } },
        ),
      ),
    );
    const e = entry({
      key: 'fomaml',
      title: 'On First-Order Meta-Learning Algorithms',
      authors: ['Alex Nichol', 'Joshua Achiam', 'John Schulman'],
      year: 2018,
      arxivId: '1803.02999',
    });
    const ev = await verifyEntry(e);
    expect(ev.tier2).toMatchObject({ arxivId: '1803.02999', arxivFound: true });
    expect(ev.bestMatch?.record.source).toBe('arxiv');
    expect(computeVerdict(e, ev).verdict).toBe('VERIFIED');
  });
});

describe('verifyEntry — title-search path with URL (maml shape)', () => {
  it('tier-3 match + tier-4 urlAlive -> VERIFIED-ready', async () => {
    server.use(
      http.get('https://api.crossref.org/works', () =>
        HttpResponse.json({
          message: {
            items: [
              {
                DOI: '10.5555/3305381.3305498',
                title: ['Model-Agnostic Meta-Learning for Fast Adaptation of Deep Networks'],
                author: [
                  { given: 'Chelsea', family: 'Finn' },
                  { given: 'Pieter', family: 'Abbeel' },
                  { given: 'Sergey', family: 'Levine' },
                ],
                issued: { 'date-parts': [[2017]] },
                'container-title': ['International Conference on Machine Learning'],
              },
            ],
          },
        }),
      ),
      http.get('https://api.openalex.org/works', () => HttpResponse.json({ results: [] })),
      http.get('https://api.semanticscholar.org/graph/v1/paper/search/match', () =>
        new HttpResponse(null, { status: 404 }),
      ),
      http.head('https://proceedings.mlr.press/v70/finn17a.html', () =>
        new HttpResponse(null, { status: 200 }),
      ),
    );
    const e = entry({
      key: 'maml',
      title: 'Model-Agnostic Meta-Learning for Fast Adaptation of Deep Networks',
      authors: ['Chelsea Finn', 'Pieter Abbeel', 'Sergey Levine'],
      year: 2017,
      venue: 'Proceedings of the 34th International Conference on Machine Learning',
      url: 'https://proceedings.mlr.press/v70/finn17a.html',
    });
    const ev = await verifyEntry(e);
    expect(ev.tier3!.searches).toContainEqual({ source: 'crossref', status: 'ok' });
    expect(ev.bestMatch?.record.source).toBe('crossref');
    expect(ev.tier4?.urlAlive).toBe(true);
    expect(computeVerdict(e, ev).verdict).toBe('VERIFIED');
  });
});

describe('verifyEntry — search failure resilience', () => {
  it('a 500 search becomes status error; pipeline never throws', async () => {
    server.use(
      http.get('https://api.crossref.org/works', () => new HttpResponse(null, { status: 500 })),
      http.get('https://api.openalex.org/works', () => HttpResponse.json({ results: [] })),
      http.get('https://api.semanticscholar.org/graph/v1/paper/search/match', () =>
        new HttpResponse(null, { status: 404 }),
      ),
      http.get('https://dblp.org/search/publ/api', () =>
        HttpResponse.json({ result: { hits: {} } }),
      ),
    );
    const e = entry({ key: 'flaky', title: 'Some Unfindable Paper', year: 2020 });
    const ev = await verifyEntry(e);
    expect(ev.tier3!.searches).toContainEqual({ source: 'crossref', status: 'error' });
    expect(ev.tier3!.searches).toContainEqual({ source: 'openalex', status: 'empty' });
    // an errored search must block NOT_FOUND
    expect(computeVerdict(e, ev).verdict).toBe('UNVERIFIABLE');
  });
});
