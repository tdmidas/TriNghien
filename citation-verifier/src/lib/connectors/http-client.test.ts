import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import type { ApiCall } from '@/lib/verification/types';

import { server } from '../../../vitest.setup';
import { politeFetch, withBackoff } from './http-client';

describe('politeFetch', () => {
  it('appends mailto for crossref/openalex polite pools', async () => {
    let seen = '';
    server.use(
      http.get('https://api.crossref.org/test', ({ request }) => {
        seen = request.url;
        return HttpResponse.json({});
      }),
    );
    await politeFetch('https://api.crossref.org/test');
    expect(new URL(seen).searchParams.get('mailto')).toBe('demo@example.com');
  });

  it('does not append mailto for other hosts', async () => {
    let seen = '';
    server.use(
      http.get('https://dblp.org/test', ({ request }) => {
        seen = request.url;
        return HttpResponse.json({});
      }),
    );
    await politeFetch('https://dblp.org/test');
    expect(new URL(seen).searchParams.has('mailto')).toBe(false);
  });

  it('records an ApiCall on success', async () => {
    server.use(http.get('https://dblp.org/ok', () => HttpResponse.json({})));
    const calls: ApiCall[] = [];
    await politeFetch('https://dblp.org/ok', { apiCalls: calls, name: 'test-call' });
    expect(calls).toEqual([
      { name: 'test-call', url: 'https://dblp.org/ok', status: 200, ok: true },
    ]);
  });

  it('records a status-0 ApiCall on network error, then rethrows', async () => {
    server.use(http.get('https://dblp.org/down', () => HttpResponse.error()));
    const calls: ApiCall[] = [];
    await expect(
      politeFetch('https://dblp.org/down', { apiCalls: calls }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ status: 0, ok: false });
  });
});

describe('withBackoff', () => {
  it('retries a 429 then returns the success response', async () => {
    let attempts = 0;
    server.use(
      http.get('https://dblp.org/flaky', () => {
        attempts += 1;
        return attempts === 1
          ? new HttpResponse(null, { status: 429 })
          : HttpResponse.json({ ok: true });
      }),
    );
    const res = await withBackoff(() => politeFetch('https://dblp.org/flaky'), 1);
    expect(res.status).toBe(200);
    expect(attempts).toBe(2);
  });

  it('gives up after the allotted retries', async () => {
    server.use(http.get('https://dblp.org/busy', () => new HttpResponse(null, { status: 429 })));
    const res = await withBackoff(() => politeFetch('https://dblp.org/busy'), 1);
    expect(res.status).toBe(429);
  });
});
