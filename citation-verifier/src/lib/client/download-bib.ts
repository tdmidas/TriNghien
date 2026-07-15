import { serializeBib } from '@/lib/bibtex/serialize-bibtex';
import type { CorrectedEntry, ParsedEntry, VerificationResult } from '@/lib/verification/types';

import type { RowState } from './run-verification';

// Export builds overrides ONLY from corrections the user left checked;
// unchecked corrections keep the original bib fields (per-correction review).
export function buildOverrides(
  results: Record<string, RowState>,
  accepted: Set<string>,
): Record<string, CorrectedEntry> {
  const overrides: Record<string, CorrectedEntry> = {};
  for (const [k, r] of Object.entries(results)) {
    const res = r as VerificationResult;
    if (res.correctedEntry && accepted.has(k)) overrides[k] = res.correctedEntry;
  }
  return overrides;
}

export function downloadCorrectedBib(
  entries: ParsedEntry[],
  results: Record<string, RowState>,
  accepted: Set<string>,
): void {
  const bib = serializeBib(entries, buildOverrides(results, accepted));
  const url = URL.createObjectURL(new Blob([bib], { type: 'application/x-bibtex' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'references-corrected.bib';
  a.click();
  URL.revokeObjectURL(url);
}
