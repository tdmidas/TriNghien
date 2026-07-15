import { TITLE_MATCH, titleSim } from '@/lib/verification/fuzzy-match';
import { normalizeTitle } from '@/lib/verification/normalize';
import type { ApiCall } from '@/lib/verification/types';

import { politeFetch, withBackoff } from './http-client';
import { cached } from './response-cache';

interface DblpHit {
  info?: { title?: string };
}

// DBLP corroboration: does a plausibly same-titled CS publication exist?
// Its only job is to block a false NOT_FOUND. true = plausible hit,
// false = clean miss (both cached); transient failures throw inside the
// fetcher (never cached) and resolve to null (inconclusive) here.
export async function dblpHasPlausibleHit(
  title: string,
  calls: ApiCall[] = [],
): Promise<boolean | null> {
  return cached(`dblp:${normalizeTitle(title)}`, async () => {
    const u = new URL('https://dblp.org/search/publ/api');
    u.searchParams.set('q', title);
    u.searchParams.set('format', 'json');
    u.searchParams.set('h', '3');
    const res = await withBackoff(
      () => politeFetch(u.toString(), { name: 'dblp-search', apiCalls: calls }),
      1,
    );
    if (!res.ok) throw new Error(`dblp-search ${res.status}`);
    const json = (await res.json()) as { result?: { hits?: { hit?: DblpHit[] } } };
    const hits = json.result?.hits?.hit ?? [];
    return hits.some((h) => titleSim(title, h.info?.title) >= TITLE_MATCH);
  }).catch(() => null);
}
