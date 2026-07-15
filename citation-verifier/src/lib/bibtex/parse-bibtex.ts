import { parse } from '@retorquere/bibtex-parser';

import type { ParsedEntry } from '@/lib/verification/types';

export const MAX_ENTRIES = 200;

// Parser field values: strings, or (for author/editor) arrays of name objects.
// Particles land in `prefix` ("von", "del"), generational parts in `suffix`
// ("Jr.") — dropping them would silently corrupt exported scholarly names.
type NameObject = {
  name?: string;
  firstName?: string;
  lastName?: string;
  prefix?: string;
  suffix?: string;
  literal?: string;
};
type FieldValue = string | Array<string | NameObject>;

function nameToString(a: string | NameObject): string {
  if (typeof a === 'string') return a;
  if (a.name ?? a.literal) return (a.name ?? a.literal)!;
  const base = [a.firstName, a.prefix, a.lastName].filter(Boolean).join(' ');
  return a.suffix ? `${base} ${a.suffix}` : base;
}

// BibTeX "von Last, Suffix, First" form keeps the serializer output
// unambiguous for `and` joins.
function nameToBibString(a: string | NameObject): string {
  if (typeof a === 'string') return a;
  if (a.name ?? a.literal) return `{${a.name ?? a.literal}}`;
  const last = [a.prefix, a.lastName].filter(Boolean).join(' ');
  if (last && a.firstName) {
    return a.suffix ? `${last}, ${a.suffix}, ${a.firstName}` : `${last}, ${a.firstName}`;
  }
  return last || a.firstName || '';
}

function flattenField(value: FieldValue): string {
  if (Array.isArray(value)) return value.map(nameToBibString).join(' and ');
  return String(value);
}

/**
 * Parse adapter for @retorquere/bibtex-parser@9 (the single seam to the parser).
 * Confirmed API: parse(text, opts) -> { entries, errors, ... };
 * entry = { key, type, fields, mode, input }; fields.author = name objects;
 * accent commands are converted to Unicode; sentenceCase:false keeps casing.
 * Runs client-side (phase 5); there is NO /api/parse-bib route.
 */
export function parseBib(text: string): { entries: ParsedEntry[]; parseErrors: string[] } {
  const bib = parse(text, { sentenceCase: false });
  const parseErrors: string[] = (bib.errors ?? []).map((e) => e.error);

  const seen = new Map<string, number>();
  const entries: ParsedEntry[] = bib.entries.slice(0, MAX_ENTRIES).map((e) => {
    const rawFields = e.fields as Record<string, FieldValue>;
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawFields)) flat[k] = flattenField(v);

    // Duplicate keys get a __dup suffix so client rows stay addressable;
    // the serializer strips it on export.
    let key = e.key;
    if (seen.has(key)) {
      const n = seen.get(key)! + 1;
      seen.set(key, n);
      key = `${e.key}__dup${n}`;
    } else {
      seen.set(key, 0);
    }

    const authorField = rawFields.author;
    const authors = Array.isArray(authorField) ? authorField.map(nameToString) : [];

    const year = flat.year ? parseInt(flat.year, 10) : undefined;
    const archivePrefix = flat.archiveprefix ?? '';
    const arxivId =
      flat.eprint && /arxiv/i.test(archivePrefix)
        ? flat.eprint
        : flat.eprint && !archivePrefix
          ? flat.eprint
          : undefined;

    return {
      key,
      type: e.type,
      title: flat.title,
      authors,
      year: Number.isNaN(year) ? undefined : year,
      venue: flat.journal ?? flat.booktitle ?? flat.series,
      doi: flat.doi?.replace(/^https?:\/\/(dx\.)?doi\.org\//i, ''),
      arxivId,
      url: flat.url,
      fields: flat,
      raw: e.input.trim(),
    };
  });

  if (bib.entries.length > MAX_ENTRIES) {
    parseErrors.push(`Only first ${MAX_ENTRIES} of ${bib.entries.length} entries processed.`);
  }

  return { entries, parseErrors };
}
