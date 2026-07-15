import { contactEmail } from '@/lib/env';
import type { ApiCall } from '@/lib/verification/types';

// Single outbound seam: URL construction via new URL, polite-pool mailto,
// hard timeout, and an ApiCall record for every attempt — including failures
// (status 0), so the verdict layer can tell empty from error.

export interface PoliteFetchOptions {
  method?: string;
  timeoutMs?: number;
  accept?: string;
  redirect?: RequestRedirect;
  apiCalls?: ApiCall[];
  name?: string;
}

export async function politeFetch(
  rawUrl: string,
  opts: PoliteFetchOptions = {},
): Promise<Response> {
  const u = new URL(rawUrl);
  // Label-anchored host match ("evilcrossref.org" must not qualify).
  const isPoliteHost = (host: string, domain: string) =>
    host === domain || host.endsWith(`.${domain}`);
  if (isPoliteHost(u.hostname, 'crossref.org') || isPoliteHost(u.hostname, 'openalex.org')) {
    u.searchParams.set('mailto', contactEmail());
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 5000);
  const rec = (status: number, ok: boolean) =>
    opts.apiCalls?.push({ name: opts.name ?? u.hostname, url: u.toString(), status, ok });
  try {
    const res = await fetch(u, {
      method: opts.method ?? 'GET',
      redirect: opts.redirect ?? 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent': `bibtex-verifier (mailto:${contactEmail()})`,
        ...(opts.accept ? { Accept: opts.accept } : {}),
      },
    });
    rec(res.status, res.ok);
    return res;
  } catch (e) {
    rec(0, false); // error ApiCall, then rethrow — callers .catch(() => null)
    throw e;
  } finally {
    clearTimeout(t);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Retry on 429/503 with exponential delay. Search-tier callers pass tries=1
// (a single retry) to hold the per-entry latency budget.
export async function withBackoff(
  fn: () => Promise<Response>,
  tries = 2,
): Promise<Response> {
  let attempt = 0;
  for (;;) {
    const res = await fn();
    if ((res.status === 429 || res.status === 503) && attempt < tries) {
      await sleep(500 * 2 ** attempt);
      attempt += 1;
      continue;
    }
    return res;
  }
}
