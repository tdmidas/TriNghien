import type { CorrectedEntry, ParsedEntry } from '@/lib/verification/types';

function bracesBalanced(s: string): boolean {
  let depth = 0;
  for (const ch of s) {
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

// Balanced braces are meaningful BibTeX (case protection, literal/corporate
// names like {OpenAI}) and must survive; only an UNBALANCED value has its
// braces stripped so the output stays parseable.
const safeValue = (v: string) => (bracesBalanced(v) ? v : v.replace(/[{}]/g, ''));

// Untouched entries are exported verbatim (entry.raw) — the parser converts
// LaTeX to Unicode, so rebuilding from parsed fields would lose the original
// markup. Only entries with accepted corrections are rebuilt.
export function serializeEntry(e: ParsedEntry, o: CorrectedEntry = {}): string {
  if (!Object.keys(o).length) return e.raw;

  const fields = { ...e.fields };
  if (o.title) fields.title = o.title;
  if (o.year) fields.year = String(o.year);
  if (o.authors) fields.author = o.authors.join(' and ');
  if (o.venue) fields[e.fields.journal != null ? 'journal' : 'booktitle'] = o.venue;
  if (o.doi) fields.doi = o.doi;

  const body = Object.entries(fields)
    .map(([k, v]) => `  ${k} = {${safeValue(String(v))}}`)
    .join(',\n');
  return `@${e.type}{${e.key.replace(/__dup\d+$/, '')},\n${body}\n}`;
}

export function serializeBib(
  entries: ParsedEntry[],
  overrides: Record<string, CorrectedEntry> = {},
): string {
  return entries.map((e) => serializeEntry(e, overrides[e.key] ?? {})).join('\n\n') + '\n';
}
