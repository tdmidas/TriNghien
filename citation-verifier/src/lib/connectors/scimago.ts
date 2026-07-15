import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { venueMatches } from '@/lib/verification/fuzzy-match';
import { normalizeTitle } from '@/lib/verification/normalize';
import type { ApiCall } from '@/lib/verification/types';

import { crossrefJournalExists } from './crossref';

// Optional Scimago Journal Rank data: semicolon-separated CSV downloaded to a
// gitignored path (command documented in README). Absent file -> every lookup
// degrades to undefined; venue-agreement and Crossref ISSN stay the primary
// journal-legitimacy signals.

const SCIMAGO_PATH = resolve(process.cwd(), 'src/data/scimago-journal-rank.csv');

let quartiles: Map<string, string> | null | undefined; // undefined = not loaded yet

function loadQuartiles(): Map<string, string> | null {
  if (quartiles !== undefined) return quartiles;
  try {
    if (!existsSync(SCIMAGO_PATH)) {
      quartiles = null;
      return quartiles;
    }
    const lines = readFileSync(SCIMAGO_PATH, 'utf8').split('\n');
    const header = lines[0]?.split(';').map((h) => h.replace(/"/g, '').trim().toLowerCase()) ?? [];
    const titleIdx = header.indexOf('title');
    const quartileIdx = header.indexOf('sjr best quartile');
    if (titleIdx < 0 || quartileIdx < 0) {
      quartiles = null;
      return quartiles;
    }
    const map = new Map<string, string>();
    for (const line of lines.slice(1)) {
      const cols = line.split(';').map((c) => c.replace(/"/g, '').trim());
      const t = cols[titleIdx];
      const q = cols[quartileIdx];
      if (t && q && q !== '-') map.set(normalizeTitle(t), q);
    }
    quartiles = map;
  } catch {
    quartiles = null;
  }
  return quartiles;
}

export function scimagoQuartile(venue?: string): string | undefined {
  if (!venue) return undefined;
  return loadQuartiles()?.get(normalizeTitle(venue));
}

// Journal legitimacy, in priority order:
// 1. bib venue agrees with the canonical record's venue (fuzzy >= 0.85)
// 2. Crossref /journals/{issn} with the ISSN from the Crossref works response
// 3. Scimago quartile table (optional local file)
// Otherwise inconclusive (null) — never a standalone verdict driver.
export async function journalKnown(
  bibVenue: string | undefined,
  canonicalVenue: string | undefined,
  issn: string | undefined,
  calls: ApiCall[] = [],
): Promise<boolean | null> {
  if (venueMatches(bibVenue, canonicalVenue) === true) return true;
  if (issn) return crossrefJournalExists(issn, calls);
  if (scimagoQuartile(canonicalVenue ?? bibVenue)) return true;
  return null;
}

// Test seam: force a reload of the optional CSV.
export function resetScimagoCache(): void {
  quartiles = undefined;
}
