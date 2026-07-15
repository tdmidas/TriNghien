// Single source of truth for the verification data model (all phases).

export type EntryType = string;

export interface ParsedEntry {
  key: string;
  type: EntryType;
  title?: string;
  authors: string[];
  year?: number;
  venue?: string; // journal || booktitle || series
  doi?: string;
  arxivId?: string;
  url?: string;
  fields: Record<string, string>; // flattened field values (parser output, Unicode-converted)
  raw: string; // original BibTeX source of the entry, verbatim — the only true round-trip seam
}

export interface CanonicalRecord {
  source: 'crossref' | 'openalex' | 'semantic-scholar' | 'arxiv' | 'dblp';
  title?: string;
  authors: string[];
  year?: number;
  venue?: string;
  doi?: string;
  issn?: string; // comes from Crossref works, never from the bib file
  url?: string;
}

export interface MatchScore {
  title: number;
  author: number;
  year: 'match' | 'off-by-one' | 'mismatch' | 'unknown';
}

export type Verdict = 'VERIFIED' | 'MISMATCH' | 'NOT_FOUND' | 'UNVERIFIABLE';

export interface FieldDiff {
  field: string;
  bibValue: string;
  canonicalValue: string;
}

// status 0 = network error (empty-vs-error distinction)
export interface ApiCall {
  name: string;
  url: string;
  status: number;
  ok: boolean;
}

export type SearchStatus = {
  source: 'crossref' | 'openalex' | 's2';
  status: 'ok' | 'empty' | 'error';
};

export interface Evidence {
  entryKey: string;
  tier1?: {
    doiPresent: boolean;
    doiHandleExists: boolean | null;
    crossrefFound: boolean | null;
    record?: CanonicalRecord; // kept even when it fails the same-paper test
  };
  tier2?: {
    arxivId?: string;
    arxivFound: boolean | null;
    record?: CanonicalRecord;
  };
  tier3?: {
    matches: CanonicalRecord[];
    searches: SearchStatus[]; // per-source ok/empty/error
  };
  tier4?: {
    dblpFound: boolean | null;
    journalKnown: boolean | null;
    journalQuartile?: string | null;
    urlAlive: boolean | null;
  };
  bestMatch?: { record: CanonicalRecord; score: MatchScore }; // set ONLY when isSamePaper
  diffs: FieldDiff[]; // written by computeVerdict, never by the pipeline
  apiCalls: ApiCall[];
}

export interface VerificationResult {
  entryKey: string;
  verdict: Verdict;
  evidence: Evidence;
  explanation?: string;
  correctedEntry?: CorrectedEntry;
}

// Unified corrected-entry shape across prompt/schema/serializer.
export interface CorrectedEntry {
  title?: string;
  authors?: string[];
  year?: number;
  venue?: string;
  doi?: string;
}
