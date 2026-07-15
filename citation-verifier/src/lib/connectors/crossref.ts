import { normalizeTitle } from '@/lib/verification/normalize';
import type { ApiCall, CanonicalRecord } from '@/lib/verification/types';

import { politeFetch, withBackoff } from './http-client';
import { cached } from './response-cache';

interface CrossrefWork {
  DOI?: string;
  title?: string[];
  author?: Array<{ given?: string; family?: string; name?: string }>;
  published?: { 'date-parts'?: number[][] };
  issued?: { 'date-parts'?: number[][] };
  'container-title'?: string[];
  ISSN?: string[];
  URL?: string;
}

function mapWork(m: CrossrefWork): CanonicalRecord {
  return {
    source: 'crossref',
    title: m.title?.[0],
    authors: (m.author ?? []).map((a) => a.name ?? [a.given, a.family].filter(Boolean).join(' ')),
    year: m.published?.['date-parts']?.[0]?.[0] ?? m.issued?.['date-parts']?.[0]?.[0],
    venue: m['container-title']?.[0],
    doi: m.DOI,
    issn: m.ISSN?.[0], // feeds the journal-legitimacy check — never taken from the bib
    url: m.URL,
  };
}

// GET /works/{doi} — no `select` param (unsupported on this endpoint).
// 404 = Crossref does not know the DOI (hard negative, cached). Transient
// failures throw inside the fetcher (never cached) and resolve to found:null.
export async function crossrefByDoi(
  doi: string,
  calls: ApiCall[] = [],
): Promise<{ found: boolean | null; record?: CanonicalRecord }> {
  return cached(`crossref-doi:${doi.toLowerCase()}`, async () => {
    const res = await politeFetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      name: 'crossref-works',
      apiCalls: calls,
    });
    if (res.status === 404) return { found: false as const };
    if (!res.ok) throw new Error(`crossref-works ${res.status}`);
    const json = (await res.json()) as { message?: CrossrefWork };
    if (!json.message) throw new Error('crossref-works unexpected shape');
    return { found: true as const, record: mapWork(json.message) };
  }).catch(() => ({ found: null }));
}

// Bibliographic search; returns up to 3 candidates for the fuzzy matcher —
// Crossref's own relevance score is deliberately not trusted.
// Throws on failure so the pipeline can record a search status of 'error'.
export async function crossrefSearch(
  title: string,
  calls: ApiCall[] = [],
): Promise<CanonicalRecord[]> {
  return cached(`crossref-search:${normalizeTitle(title)}`, async () => {
    const u = new URL('https://api.crossref.org/works');
    u.searchParams.set('query.bibliographic', title);
    u.searchParams.set('rows', '3');
    const res = await withBackoff(
      () => politeFetch(u.toString(), { name: 'crossref-search', apiCalls: calls }),
      1,
    );
    if (!res.ok) throw new Error(`crossref-search ${res.status}`);
    const json = (await res.json()) as { message?: { items?: CrossrefWork[] } };
    return (json.message?.items ?? []).map(mapWork);
  });
}

// GET /journals/{issn}: 200 = known journal, 404 = unknown (both cached);
// anything else throws inside the fetcher (uncached) -> null.
export async function crossrefJournalExists(
  issn: string,
  calls: ApiCall[] = [],
): Promise<boolean | null> {
  return cached(`journals:${issn}`, async () => {
    const res = await politeFetch(
      `https://api.crossref.org/journals/${encodeURIComponent(issn)}`,
      { name: 'crossref-journals', apiCalls: calls },
    );
    if (res.status === 404) return false;
    if (res.ok) return true;
    throw new Error(`crossref-journals ${res.status}`);
  }).catch(() => null);
}
