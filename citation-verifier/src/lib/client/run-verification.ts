import { parseBib } from '@/lib/bibtex/parse-bibtex';
import type { ParsedEntry, VerificationResult } from '@/lib/verification/types';

// Client-side verification driver: local parse (no parse route exists) plus a
// resilient worker pool over POST /api/verify-entry.

export type RowState = VerificationResult | { status: 'PENDING' };

export function isPending(r: RowState | undefined): r is { status: 'PENDING' } {
  return !!r && 'status' in r && r.status === 'PENDING';
}

export const parseLocal = (bibText: string) => parseBib(bibText);

export async function verifyOne(entry: ParsedEntry): Promise<VerificationResult> {
  // fields/raw are client-side export state the server never reads; omitting
  // them keeps long abstracts in real bib files from tripping the body caps.
  // (JSON.stringify drops undefined-valued keys.)
  const slim = { ...entry, fields: undefined, raw: undefined };
  const r = await fetch('/api/verify-entry', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(slim),
  });
  if (!r.ok) throw new Error(`verify ${r.status}`);
  return r.json();
}

export const unverifiable = (entry: ParsedEntry, reason: string): VerificationResult => ({
  entryKey: entry.key,
  verdict: 'UNVERIFIABLE',
  evidence: { entryKey: entry.key, tier3: { matches: [], searches: [] }, diffs: [], apiCalls: [] },
  explanation: reason,
});

// Worker pool (n workers, shared cursor). Any throw — fetch reject, non-2xx,
// bad JSON — becomes a synthetic UNVERIFIABLE so no row is ever stranded
// PENDING and one entry's failure never stalls the run.
export async function runPool(
  items: ParsedEntry[],
  n: number,
  onEach: (r: VerificationResult) => void,
): Promise<void> {
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const e = items[i++];
      try {
        onEach(await verifyOne(e));
      } catch {
        onEach(unverifiable(e, 'Verification request failed — click Retry.'));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}
