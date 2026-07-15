import type { Verdict } from '@/lib/verification/types';

// Expected verdicts for the representative acceptance subset, frozen against
// the 2026-07-14 live-baseline run (plans/.../reports/live-smoke-baseline-260714.md).
// Hard requirements: the 2 planted fakes -> NOT_FOUND; the 4 hard-asserted
// controls -> VERIFIED; eddm (no-DOI 2006 workshop edge) -> VERIFIED via the
// Semantic Scholar match (year off-by-one tolerated) — never NOT_FOUND.
export const EXPECTED_VERDICTS: Record<string, Verdict> = {
  nguyen2026llmfuzzx: 'NOT_FOUND', // planted fake (fabricated DOI)
  pham2025vulagent: 'NOT_FOUND', // planted fake (no DOI)
  icarl: 'VERIFIED', // tier-1 DOI control
  ewc: 'VERIFIED', // tier-1 DOI control
  fomaml: 'VERIFIED', // tier-2 arXiv control
  maml: 'VERIFIED', // tier-3 title-search control (OpenAlex)
  eddm: 'VERIFIED', // no-DOI edge (S2 match, year off-by-one)
};

export const SUBSET_KEYS = Object.keys(EXPECTED_VERDICTS);
