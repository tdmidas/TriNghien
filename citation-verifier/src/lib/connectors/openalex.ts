import { normalizeTitle } from '@/lib/verification/normalize';
import type { ApiCall, CanonicalRecord } from '@/lib/verification/types';

import { politeFetch, withBackoff } from './http-client';
import { cached } from './response-cache';

interface OpenAlexWork {
  display_name?: string;
  publication_year?: number;
  doi?: string;
  authorships?: Array<{ author?: { display_name?: string } }>;
  primary_location?: { source?: { display_name?: string; issn_l?: string } };
}

// title.search filter = precision search (NOT the `search=` fulltext param).
// Commas are filter separators in OpenAlex syntax, so they are stripped.
// Throws on failure so the pipeline records status 'error'.
export async function openalexSearch(
  title: string,
  calls: ApiCall[] = [],
): Promise<CanonicalRecord[]> {
  return cached(`openalex:${normalizeTitle(title)}`, async () => {
    const u = new URL('https://api.openalex.org/works');
    u.searchParams.set('filter', `title.search:${title.replace(/,/g, ' ')}`);
    u.searchParams.set('per_page', '3');
    const res = await withBackoff(
      () => politeFetch(u.toString(), { name: 'openalex-search', apiCalls: calls }),
      1,
    );
    if (!res.ok) throw new Error(`openalex-search ${res.status}`);
    const json = (await res.json()) as { results?: OpenAlexWork[] };
    return (json.results ?? []).map((w) => ({
      source: 'openalex' as const,
      title: w.display_name,
      authors: (w.authorships ?? [])
        .map((a) => a.author?.display_name)
        .filter((n): n is string => Boolean(n)),
      year: w.publication_year,
      venue: w.primary_location?.source?.display_name,
      doi: w.doi?.replace(/^https?:\/\/(dx\.)?doi\.org\//i, ''),
      issn: w.primary_location?.source?.issn_l,
    }));
  });
}
