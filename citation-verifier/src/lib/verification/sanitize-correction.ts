import { authorSim, titleSim } from './fuzzy-match';
import type { CorrectedEntry, Evidence } from './types';

// Trust boundary for untrusted LLM output: only corrected fields that
// near-exactly match a record already present in the evidence survive.
// Invented fields (especially DOIs) are silently dropped before serialize.
const FIELD_MATCH = 0.95;

export function sanitizeCorrection(c: CorrectedEntry, ev: Evidence): CorrectedEntry {
  const rec =
    ev.bestMatch?.record ?? ev.tier1?.record ?? ev.tier2?.record ?? ev.tier3?.matches[0];
  if (!rec) return {};

  const out: CorrectedEntry = {};
  if (c.title && rec.title && titleSim(c.title, rec.title) >= FIELD_MATCH) out.title = c.title;
  if (c.year && rec.year && c.year === rec.year) out.year = c.year;
  if (c.venue && rec.venue && titleSim(c.venue, rec.venue) >= FIELD_MATCH) out.venue = c.venue;
  if (c.doi && rec.doi && c.doi.toLowerCase() === rec.doi.toLowerCase()) out.doi = c.doi;
  if (
    c.authors?.length &&
    rec.authors.length &&
    authorSim(c.authors, rec.authors) >= FIELD_MATCH
  ) {
    out.authors = c.authors;
  }
  return out;
}
