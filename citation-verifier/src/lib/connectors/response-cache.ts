// Plain-Map cache of RAW connector results keyed by request (doi, normalized
// title, arXiv id, ISSN...). Null results are cached too (negative cache).
// Deliberately NOT an Evidence-by-entry-hash cache: editing an entry and
// re-verifying must recompute scores/diffs, never return a stale verdict.
// Module-level state — see the process-state contract in host-limiters.ts.

const cache = new Map<string, unknown>();

export async function cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  if (cache.has(key)) return cache.get(key) as T;
  const v = await fetcher();
  cache.set(key, v);
  return v;
}

// Test seam.
export function clearResponseCache(): void {
  cache.clear();
}
