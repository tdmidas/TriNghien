import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { server } from '../../../vitest.setup';
import { urlLiveness } from './url-liveness';

// DNS is mocked: public.example resolves publicly, private.example to loopback.
// MSW's onUnhandledRequest:'error' guarantees the "no request issued" cases.
vi.mock('node:dns/promises', () => ({
  default: {
    lookup: vi.fn(async (hostname: string) => {
      if (hostname === 'public.example') return [{ address: '93.184.216.34', family: 4 }];
      if (hostname === 'private.example') return [{ address: '127.0.0.1', family: 4 }];
      if (hostname === 'internal.example') return [{ address: '10.0.0.5', family: 4 }];
      if (hostname === '127.0.0.1') return [{ address: '127.0.0.1', family: 4 }];
      throw new Error('ENOTFOUND');
    }),
  },
}));

describe('urlLiveness SSRF hardening (no request issued)', () => {
  it('rejects non-http(s) schemes', async () => {
    expect(await urlLiveness('file:///etc/passwd')).toBeNull();
    expect(await urlLiveness('ftp://example.com/x')).toBeNull();
  });

  it('rejects non-80/443 ports (blocks the sibling apps on 3100/8100)', async () => {
    expect(await urlLiveness('http://127.0.0.1:8100/')).toBeNull();
    expect(await urlLiveness('http://public.example:3100/')).toBeNull();
  });

  it('rejects hosts resolving to loopback or RFC1918 targets', async () => {
    expect(await urlLiveness('http://127.0.0.1/')).toBeNull();
    expect(await urlLiveness('https://private.example/paper')).toBeNull();
    expect(await urlLiveness('https://internal.example/paper')).toBeNull();
  });

  it('rejects unresolvable hosts and malformed URLs', async () => {
    expect(await urlLiveness('https://no-such-host.example/x')).toBeNull();
    expect(await urlLiveness('not a url')).toBeNull();
    expect(await urlLiveness(undefined)).toBeNull();
  });
});

describe('urlLiveness probing (public host)', () => {
  it('2xx HEAD means alive', async () => {
    server.use(http.head('https://public.example/paper', () => new HttpResponse(null, { status: 200 })));
    expect(await urlLiveness('https://public.example/paper')).toBe(true);
  });

  it('3xx means alive without following the redirect', async () => {
    server.use(
      http.head('https://public.example/moved', () =>
        new HttpResponse(null, { status: 301, headers: { Location: 'http://127.0.0.1:8100/' } }),
      ),
    );
    expect(await urlLiveness('https://public.example/moved')).toBe(true);
  });

  it('4xx/5xx is inconclusive (null), not dead', async () => {
    server.use(http.head('https://public.example/gone', () => new HttpResponse(null, { status: 404 })));
    expect(await urlLiveness('https://public.example/gone')).toBeNull();
  });
});
