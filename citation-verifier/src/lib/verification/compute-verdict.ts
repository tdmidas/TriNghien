import { AUTHOR_MATCH, authorSim, venueMatches, yearStatus } from './fuzzy-match';
import type { CanonicalRecord, Evidence, FieldDiff, ParsedEntry, Verdict } from './types';

// Compares author/year/venue only — same-paper gating already implies a close
// title, and title diffs would be noise (casing/punctuation variants).
function buildDiffs(entry: ParsedEntry, record: CanonicalRecord): FieldDiff[] {
  const diffs: FieldDiff[] = [];

  if (entry.authors.length && record.authors.length) {
    if (authorSim(entry.authors, record.authors) < AUTHOR_MATCH) {
      diffs.push({
        field: 'author',
        bibValue: entry.authors.join(' and '),
        canonicalValue: record.authors.join(' and '),
      });
    }
  }

  if (yearStatus(entry.year, record.year) === 'mismatch') {
    diffs.push({
      field: 'year',
      bibValue: String(entry.year),
      canonicalValue: String(record.year),
    });
  }

  // Venue diffs only against Crossref records: OpenAlex/S2 venue vocabulary
  // ("Proceedings of Machine Learning Research", host-venue variants) differs
  // structurally from bib booktitles and produced 7/40 false MISMATCHes in the
  // 2026-07-14 live baseline.
  if (record.source === 'crossref' && venueMatches(entry.venue, record.venue) === false) {
    diffs.push({ field: 'venue', bibValue: entry.venue!, canonicalValue: record.venue! });
  }

  return diffs;
}

/**
 * Evidence -> {verdict, diffs}. Pure decision function; the pipeline (phase 3)
 * fills Evidence, this function alone writes diffs.
 *
 * NOT_FOUND requires clean negatives on every attempted signal: every search
 * answered without error, none of the candidates passed the same-paper gate,
 * and DBLP did not hit. Any search error or corroborating tier-4 signal
 * degrades to UNVERIFIABLE instead.
 */
export function computeVerdict(
  entry: ParsedEntry,
  ev: Evidence,
): { verdict: Verdict; diffs: FieldDiff[] } {
  const best = ev.bestMatch; // set ONLY when isSamePaper (pipeline invariant)
  const t3 = ev.tier3;
  const searchRan = !!t3 && t3.searches.length > 0;
  const searchErr = !!t3 && t3.searches.some((s) => s.status === 'error');
  // Every search answered (ok-with-candidates or empty, never error). Live
  // Crossref/OpenAlex relevance search returns SOME candidates for any query,
  // so "all empty" never happens in practice (2026-07-14 baseline) — the
  // negative signal is "answered but nothing passed the same-paper gate".
  const allAnswered = searchRan && !searchErr;
  const dblpHit = ev.tier4?.dblpFound === true;
  const handleFalse = ev.tier1?.doiHandleExists === false;
  const handleTrue = ev.tier1?.doiHandleExists === true;
  const crossref404 = ev.tier1?.crossrefFound === false;
  const tier1Rec = ev.tier1?.record; // present but NOT same-paper when best is unset

  // A/B) same paper found: metadata agrees -> VERIFIED, disagrees -> MISMATCH
  if (best) {
    const diffs = buildDiffs(entry, best.record);
    return diffs.length ? { verdict: 'MISMATCH', diffs } : { verdict: 'VERIFIED', diffs: [] };
  }

  const cleanNegative = allAnswered && !dblpHit;

  // C) fabricated DOI: handle 404s, Crossref 404s, nothing else anywhere
  if (entry.doi && handleFalse && crossref404 && cleanNegative) {
    return { verdict: 'NOT_FOUND', diffs: [] };
  }

  // E) repurposed DOI: DOI resolves but to a DIFFERENT paper, searches clean-empty
  if (entry.doi && handleTrue && tier1Rec && cleanNegative) {
    return { verdict: 'NOT_FOUND', diffs: [] };
  }

  // D) no usable DOI + clean empty searches -> likely hallucinated
  if ((!entry.doi || handleFalse) && cleanNegative) {
    return { verdict: 'NOT_FOUND', diffs: [] };
  }

  // Everything else is inconclusive: search error, DBLP-venue-only hit,
  // DOI resolves but no record data, searches never ran, ...
  return { verdict: 'UNVERIFIABLE', diffs: [] };
}
