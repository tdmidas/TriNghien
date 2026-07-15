import { XMLParser } from 'fast-xml-parser';

import type { ApiCall, CanonicalRecord } from '@/lib/verification/types';

import { arxivSchedule } from './host-limiters';
import { politeFetch } from './http-client';
import { cached } from './response-cache';

interface AtomEntry {
  id?: string;
  title?: string;
  published?: string;
  author?: { name?: string } | Array<{ name?: string }>;
}

const parser = new XMLParser({ ignoreAttributes: true });

// arXiv export API (Atom XML). An error feed (no /abs/ id) means the id does
// not exist — a definitive negative, cached as null. HTTP/network failures
// throw inside the fetcher (never cached) and resolve to null here.
// All calls are serialized with >=3s spacing (arxivSchedule).
export async function arxivById(
  id: string,
  calls: ApiCall[] = [],
): Promise<CanonicalRecord | null> {
  return cached<CanonicalRecord | null>(`arxiv:${id}`, async () => {
    const res = await arxivSchedule(() =>
      politeFetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`, {
        name: 'arxiv-query',
        accept: 'application/atom+xml',
        apiCalls: calls,
      }),
    );
    if (!res.ok) throw new Error(`arxiv-query ${res.status}`);
    const xml = await res.text();
    const feed = parser.parse(xml)?.feed as { entry?: AtomEntry | AtomEntry[] } | undefined;
    const entry = Array.isArray(feed?.entry) ? feed.entry[0] : feed?.entry;
    // arXiv returns a feed with an error entry (no <id> with abs URL) for bad ids
    if (!entry?.title || !entry.id?.includes('/abs/')) return null;
    const authors = Array.isArray(entry.author) ? entry.author : entry.author ? [entry.author] : [];
    const year = entry.published ? parseInt(entry.published.slice(0, 4), 10) : undefined;
    return {
      source: 'arxiv',
      title: String(entry.title).replace(/\s+/g, ' ').trim(),
      authors: authors.map((a) => a.name).filter((n): n is string => Boolean(n)),
      year: Number.isNaN(year) ? undefined : year,
      url: entry.id,
    };
  }).catch(() => null);
}
