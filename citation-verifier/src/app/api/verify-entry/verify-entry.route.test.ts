import { HttpResponse, http } from 'msw';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getLlmClient } from '@/lib/llm-client';
import type { ParsedEntry } from '@/lib/verification/types';

import { server } from '../../../../vitest.setup';
import { POST } from './route';

vi.mock('@/lib/llm-client', () => ({ getLlmClient: vi.fn() }));
const mockedGetClient = vi.mocked(getLlmClient);

function cannedLlm(payload: unknown) {
  const create = vi.fn(async () => ({
    choices: [{ message: { content: JSON.stringify(payload) } }],
  }));
  mockedGetClient.mockReturnValue({
    chat: { completions: { create } },
  } as unknown as ReturnType<typeof getLlmClient>);
  return create;
}

const call = (body: unknown) =>
  POST(
    new NextRequest('http://localhost:3200/api/verify-entry', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

const entry = (over: Partial<ParsedEntry>): ParsedEntry => ({
  key: 'k',
  type: 'article',
  authors: [],
  fields: {},
  raw: '',
  ...over,
});

const emptySearchHandlers = () => [
  http.get('https://api.crossref.org/works', () => HttpResponse.json({ message: { items: [] } })),
  http.get('https://api.openalex.org/works', () => HttpResponse.json({ results: [] })),
  http.get('https://api.semanticscholar.org/graph/v1/paper/search/match', () =>
    new HttpResponse(null, { status: 404 }),
  ),
  http.get('https://dblp.org/search/publ/api', () => HttpResponse.json({ result: { hits: {} } })),
];

const ICARL_WORK = {
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
    'container-title': ['2017 IEEE Conference on Computer Vision and Pattern Recognition (CVPR)'],
    ISSN: ['1063-6919'],
  },
};

const icarlEntry = entry({
  key: 'icarl',
  title: 'iCaRL: Incremental Classifier and Representation Learning',
  authors: ['Rebuffi, Sylvestre-Alvise', 'Kolesnikov, Alexander', 'Sperl, Georg', 'Lampert, Christoph H.'],
  year: 2017,
  venue: '2017 IEEE Conference on Computer Vision and Pattern Recognition (CVPR)',
  doi: '10.1109/CVPR.2017.587',
});

beforeEach(() => {
  mockedGetClient.mockReset();
  mockedGetClient.mockReturnValue(null);
});

describe('POST /api/verify-entry — body validation', () => {
  it('rejects an oversized body with 413', async () => {
    const res = await call('x'.repeat(65_000));
    expect(res.status).toBe(413);
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await call('{not json');
    expect(res.status).toBe(400);
  });

  it('rejects an invalid entry with 400', async () => {
    const res = await call({ key: '', type: '' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/verify-entry — verdict paths (mocked network)', () => {
  it('fabricated DOI -> 200 NOT_FOUND with structured evidence and degraded explanation', async () => {
    server.use(
      http.get('https://doi.org/api/handles/*', () => HttpResponse.json({ responseCode: 100 })),
      http.get('https://api.crossref.org/works/*', () => new HttpResponse(null, { status: 404 })),
      ...emptySearchHandlers(),
    );
    const res = await call(
      entry({
        key: 'nguyen2026llmfuzzx',
        title: 'LLMFuzzX: Autonomous Smart Contract Fuzzing with Multi-Agent Reasoning',
        authors: ['Minh Anh Nguyen'],
        year: 2026,
        venue: 'Journal of Intelligent Cyber Security',
        doi: '10.5555/jics.2026.03145',
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.verdict).toBe('NOT_FOUND');
    expect(json.evidence.tier1.doiHandleExists).toBe(false);
    expect(json.explanation).toContain('no API key configured');
    expect(json.correctedEntry).toBeUndefined();
  });

  it('valid DOI -> 200 VERIFIED and the LLM IS called for clean VERIFIED', async () => {
    server.use(
      http.get('https://doi.org/api/handles/*', () => HttpResponse.json({ responseCode: 1 })),
      http.get('https://api.crossref.org/works/*', () => HttpResponse.json(ICARL_WORK)),
    );
    const create = cannedLlm({
      explanation: 'Bài báo được xác minh: Crossref khớp DOI và tiêu đề.',
    });
    const res = await call(icarlEntry);
    const json = await res.json();
    expect(json.verdict).toBe('VERIFIED');
    expect(create).toHaveBeenCalledTimes(1);
    expect(json.explanation).toContain('Crossref');
  });

  it('doctored year -> MISMATCH with diffs; sanitize keeps year, drops invented DOI', async () => {
    server.use(
      http.get('https://doi.org/api/handles/*', () => HttpResponse.json({ responseCode: 1 })),
      http.get('https://api.crossref.org/works/*', () => HttpResponse.json(ICARL_WORK)),
    );
    cannedLlm({
      explanation: 'Năm xuất bản không khớp: evidence ghi 2017.',
      correctedEntry: { year: 2017, doi: '10.9999/invented' },
    });
    const res = await call({ ...icarlEntry, year: 2020 });
    const json = await res.json();
    expect(json.verdict).toBe('MISMATCH');
    expect(json.evidence.diffs).toContainEqual({
      field: 'year',
      bibValue: '2020',
      canonicalValue: '2017',
    });
    expect(json.correctedEntry).toEqual({ year: 2017 });
  });

  it('no API key -> still returns verdict + evidence with the degraded explanation', async () => {
    server.use(
      http.get('https://doi.org/api/handles/*', () => HttpResponse.json({ responseCode: 1 })),
      http.get('https://api.crossref.org/works/*', () => HttpResponse.json(ICARL_WORK)),
    );
    const res = await call(icarlEntry);
    const json = await res.json();
    expect(json.verdict).toBe('VERIFIED');
    expect(json.explanation).toContain('no API key configured');
  });
});
