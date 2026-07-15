import { normalizeTitle } from '@/lib/verification/normalize';
import type { ApiCall, CanonicalRecord } from '@/lib/verification/types';

import { s2Schedule } from './host-limiters';
import { politeFetch, withBackoff } from './http-client';
import { cached } from './response-cache';

interface S2Match {
  title?: string;
  year?: number;
  venue?: string;
  authors?: Array<{ name?: string }>;
  externalIds?: { DOI?: string };
}

// /paper/search/match ONLY — no /paper/search fallback. The endpoint 404s
// when no title match exists; that is 'empty', not an error.
// Any other failure throws so the pipeline records status 'error'.
export async function s2Match(
  title: string,
  calls: ApiCall[] = [],
): Promise<CanonicalRecord | null> {
  return cached(`s2:${normalizeTitle(title)}`, async () => {
    const u = new URL('https://api.semanticscholar.org/graph/v1/paper/search/match');
    u.searchParams.set('query', title);
    u.searchParams.set('fields', 'title,authors,year,venue,externalIds');
    const res = await s2Schedule(() =>
      withBackoff(() => politeFetch(u.toString(), { name: 's2-match', apiCalls: calls }), 1),
    );
    if (res.status === 404) return null; // no match found
    if (!res.ok) throw new Error(`s2-match ${res.status}`);
    const json = (await res.json()) as { data?: S2Match[] };
    const m = json.data?.[0];
    if (!m?.title) return null; // unexpected shape -> inconclusive, not error
    return {
      source: 'semantic-scholar',
      title: m.title,
      authors: (m.authors ?? []).map((a) => a.name).filter((n): n is string => Boolean(n)),
      year: m.year,
      venue: m.venue,
      doi: m.externalIds?.DOI,
    };
  });
}
