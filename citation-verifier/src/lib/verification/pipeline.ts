import { arxivById } from '@/lib/connectors/arxiv';
import { crossrefByDoi, crossrefSearch } from '@/lib/connectors/crossref';
import { dblpHasPlausibleHit } from '@/lib/connectors/dblp';
import { doiHandleExists } from '@/lib/connectors/doi-handle';
import { openalexSearch } from '@/lib/connectors/openalex';
import { scimagoQuartile, journalKnown } from '@/lib/connectors/scimago';
import { s2Match } from '@/lib/connectors/semantic-scholar';
import { urlLiveness } from '@/lib/connectors/url-liveness';

import { isSamePaper, scoreAgainst } from './fuzzy-match';
import type {
  ApiCall,
  CanonicalRecord,
  Evidence,
  ParsedEntry,
  SearchStatus,
} from './types';

// Tiered dispatcher: assembles Evidence for one entry. Scores candidates via
// scoreAgainst/isSamePaper but NEVER writes ev.diffs — that belongs to
// computeVerdict. Fail-soft: no connector rejection may escape this function.

function tryBestMatch(ev: Evidence, entry: ParsedEntry, record?: CanonicalRecord): void {
  if (ev.bestMatch || !record) return;
  const score = scoreAgainst(entry, record);
  if (isSamePaper(score)) ev.bestMatch = { record, score };
}

export async function verifyEntry(entry: ParsedEntry): Promise<Evidence> {
  const apiCalls: ApiCall[] = [];
  const ev: Evidence = {
    entryKey: entry.key,
    tier3: { matches: [], searches: [] },
    diffs: [],
    apiCalls,
  };

  try {
    // TIER 1 — DOI handle + Crossref lookup in parallel
    if (entry.doi) {
      const [handle, cr] = await Promise.all([
        doiHandleExists(entry.doi, apiCalls),
        crossrefByDoi(entry.doi, apiCalls),
      ]);
      ev.tier1 = {
        doiPresent: true,
        doiHandleExists: handle,
        crossrefFound: cr.found,
        record: cr.record, // kept even when it fails the same-paper gate
      };
      tryBestMatch(ev, entry, cr.record);
    }

    // TIER 2 — arXiv id (only when tier 1 did not settle it)
    if (!ev.bestMatch && entry.arxivId) {
      const ax = await arxivById(entry.arxivId, apiCalls);
      ev.tier2 = { arxivId: entry.arxivId, arxivFound: !!ax, record: ax ?? undefined };
      tryBestMatch(ev, entry, ax ?? undefined);
    }

    // TIER 3 — title search across three sources, runs whenever there is no
    // bestMatch (including the tier-1 "record found but different paper" case)
    if (!ev.bestMatch && entry.title) {
      const results = await Promise.allSettled([
        crossrefSearch(entry.title, apiCalls),
        openalexSearch(entry.title, apiCalls),
        s2Match(entry.title, apiCalls),
      ]);
      const sources: SearchStatus['source'][] = ['crossref', 'openalex', 's2'];
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          ev.tier3!.searches.push({ source: sources[i], status: 'error' });
          return;
        }
        const records = (Array.isArray(r.value) ? r.value : r.value ? [r.value] : []).filter(
          Boolean,
        ) as CanonicalRecord[];
        ev.tier3!.searches.push({ source: sources[i], status: records.length ? 'ok' : 'empty' });
        ev.tier3!.matches.push(...records);
      });
      // pick the highest-scoring same-paper candidate
      let best: Evidence['bestMatch'];
      for (const rec of ev.tier3!.matches) {
        const score = scoreAgainst(entry, rec);
        if (!isSamePaper(score)) continue;
        if (!best || score.title > best.score.title) best = { record: rec, score };
      }
      if (best) ev.bestMatch = best;
    }

    // TIER 4 — corroboration (runs always; DBLP only matters without bestMatch)
    const canonVenue = ev.bestMatch?.record.venue ?? ev.tier1?.record?.venue;
    const issn = ev.bestMatch?.record.issn ?? ev.tier1?.record?.issn;
    const [dblpFound, jk, urlAlive] = await Promise.all([
      ev.bestMatch || !entry.title
        ? Promise.resolve(null)
        : dblpHasPlausibleHit(entry.title, apiCalls).catch(() => null),
      journalKnown(entry.venue, canonVenue, issn, apiCalls).catch(() => null),
      urlLiveness(entry.url, apiCalls).catch(() => null),
    ]);
    ev.tier4 = {
      dblpFound,
      journalKnown: jk,
      journalQuartile: scimagoQuartile(canonVenue ?? entry.venue) ?? null,
      urlAlive,
    };
  } catch {
    // Fail-soft: partial evidence is still evidence; computeVerdict maps the
    // gaps to UNVERIFIABLE rather than the route throwing a 500.
  }

  return ev;
}
