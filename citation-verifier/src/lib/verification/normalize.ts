// Accent-safe text normalization. The parser already converts LaTeX accent
// commands to Unicode (Path A), but canonical API records and any raw LaTeX
// that bypasses the parser still hit the accent-command regex as defense in depth.

export function normalizeTitle(s: string): string {
  return s
    .replace(/\\[`'"~^.=uvHtcdb]\s*\{?\s*([a-zA-Z])\s*\}?/g, '$1') // accent cmd -> base letter
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/\\[a-z]+\{?/gi, ' ') // remaining LaTeX commands
    .replace(/[{}$]/g, '') // protective braces vanish without splitting words ({MAML}, i{C}a{RL})
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extract + normalize the surname from "First Last" or "Last, First" shapes.
// Braces are dropped BEFORE splitting, but backslashes survive so the accent
// regex in normalizeTitle can still convert raw LaTeX accents.
// Comma form keeps the WHOLE pre-comma segment: multi-word surnames with
// particles ("del Campo-Ávila, José") would otherwise collapse to "del"
// (live-baseline 2026-07-14: eddm authors scored 0.67 from exactly this).
export function surname(fullName: string): string {
  const clean = fullName.replace(/[{}]/g, '').trim();
  if (!clean) return '';
  const commaIdx = clean.indexOf(',');
  if (commaIdx >= 0) return normalizeTitle(clean.slice(0, commaIdx));
  const parts = clean.split(/\s+/).filter(Boolean);
  return normalizeTitle(parts[parts.length - 1]);
}
