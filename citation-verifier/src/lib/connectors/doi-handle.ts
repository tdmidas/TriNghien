import type { ApiCall } from '@/lib/verification/types';

import { politeFetch } from './http-client';
import { cached } from './response-cache';

// doi.org handle API: responseCode 1 = handle exists, 100 = not found.
// A missing handle is HTTP 404 WITH a JSON body carrying responseCode 100
// (verified live 2026-07-14), so the body is parsed regardless of HTTP
// status. Only definitive answers are cached — transient failures (network,
// unparseable body, unexpected shape) THROW inside the fetcher so cached()
// never stores them, and resolve to null (uncached) here.
export async function doiHandleExists(
  doi: string,
  calls: ApiCall[] = [],
): Promise<boolean | null> {
  return cached(`doi-handle:${doi.toLowerCase()}`, async () => {
    const res = await politeFetch(`https://doi.org/api/handles/${encodeURIComponent(doi)}`, {
      name: 'doi-handle',
      apiCalls: calls,
    });
    const json = (await res.json()) as { responseCode?: number };
    if (json.responseCode === 1) return true;
    if (json.responseCode === 100) return false;
    throw new Error(`doi-handle unexpected responseCode ${json.responseCode}`);
  }).catch(() => null);
}
