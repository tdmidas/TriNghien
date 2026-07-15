import { normalizeTitle, surname } from './normalize';
import type { CanonicalRecord, MatchScore, ParsedEntry } from './types';

// Inputs are truncated before the O(n·m) Dice pass so oversized fields
// cannot blow up CPU (resource caps).
const CAP = 512;
const cut = (s?: string) => (s ?? '').slice(0, CAP);

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

// Sørensen–Dice coefficient over character bigrams — the single similarity
// metric for the whole app.
export function dice(a: string, b: string): number {
  if (a === b) return a ? 1 : 0;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  let tot = 0;
  for (const c of A.values()) tot += c;
  for (const c of B.values()) tot += c;
  for (const [g, c] of A) inter += Math.min(c, B.get(g) ?? 0);
  return tot ? (2 * inter) / tot : 0;
}

// Thresholds from the academic-APIs research report §7.
export const TITLE_MATCH = 0.85;
export const TITLE_STRONG = 0.9;
export const AUTHOR_MATCH = 0.8;

export function titleSim(a?: string, b?: string): number {
  if (!a || !b) return 0;
  return dice(normalizeTitle(cut(a)), normalizeTitle(cut(b)));
}

// Multi-word surnames are recorded inconsistently across sources
// ("Baena-García" vs "García", "del Campo-Ávila" vs "Ávila") — containment
// of a reasonably long fragment counts as the same surname.
function surnamesMatch(a: string, b: string): boolean {
  if (dice(a, b) >= AUTHOR_MATCH) return true;
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  return short.length >= 4 && long.includes(short);
}

// Fraction of bib authors whose surname matches some canonical surname.
export function authorSim(bib: string[], canon: string[]): number {
  if (!bib.length || !canon.length) return 0;
  const cs = canon.slice(0, 100).map(surname);
  const hits = bib
    .slice(0, 100)
    .map(surname)
    .filter((s) => cs.some((c) => surnamesMatch(s, c))).length;
  return hits / Math.min(bib.length, 100);
}

// Venue strings routinely differ by boilerplate ("Proceedings of the 34th X"
// vs "X"), so containment counts as agreement before the Dice threshold.
// null = cannot compare (a side is missing).
export function venueMatches(a?: string, b?: string): boolean | null {
  if (!a || !b) return null;
  const na = normalizeTitle(cut(a));
  const nb = normalizeTitle(cut(b));
  if (!na || !nb) return null;
  if (na.includes(nb) || nb.includes(na)) return true;
  return dice(na, nb) >= TITLE_MATCH;
}

export function yearStatus(bib?: number, canon?: number): MatchScore['year'] {
  if (bib == null || canon == null) return 'unknown';
  const d = Math.abs(bib - canon);
  return d === 0 ? 'match' : d === 1 ? 'off-by-one' : 'mismatch';
}

// Corroboration rule: a strong title alone is not enough — a second signal
// (author overlap or year) must agree before we claim the same paper.
export function isSamePaper(s: MatchScore): boolean {
  if (s.title >= TITLE_STRONG && (s.year === 'match' || s.year === 'off-by-one')) return true;
  if (s.title >= TITLE_MATCH && (s.author >= AUTHOR_MATCH || s.year === 'match')) return true;
  return false;
}

export function scoreAgainst(entry: ParsedEntry, r: CanonicalRecord): MatchScore {
  return {
    title: titleSim(entry.title, r.title),
    author: authorSim(entry.authors, r.authors),
    year: yearStatus(entry.year, r.year),
  };
}
