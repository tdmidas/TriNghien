import { NextRequest } from 'next/server';

import { explainEntry } from '@/lib/llm/explain-entry';
import { computeVerdict } from '@/lib/verification/compute-verdict';
import { verifyEntry } from '@/lib/verification/pipeline';
import { ParsedEntrySchema } from '@/lib/verification/schemas';

// The single backend route: bare ParsedEntry JSON in, VerificationResult out.
// Parsing happens client-side — there is deliberately no /api/parse-bib.
export const maxDuration = 20; // localhost budget: <=12s pipeline + <=8s LLM

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > 64_000) {
    return Response.json({ error: 'entry too large' }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }

  const parsed = ParsedEntrySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'invalid entry' }, { status: 400 });
  }
  const entry = parsed.data;

  try {
    const evidence = await verifyEntry(entry); // never throws (fail-soft pipeline)
    const { verdict, diffs } = computeVerdict(entry, evidence); // the ONLY diffs writer
    evidence.diffs = diffs;
    const { explanation, correctedEntry } = await explainEntry(entry, evidence, verdict);
    return Response.json({ entryKey: entry.key, verdict, evidence, explanation, correctedEntry });
  } catch {
    // Defensive: a structured 200 keeps the client loop alive; the row shows
    // UNVERIFIABLE instead of the whole run dying on one entry.
    return Response.json({
      entryKey: entry.key,
      verdict: 'UNVERIFIABLE',
      evidence: {
        entryKey: entry.key,
        tier3: { matches: [], searches: [] },
        diffs: [],
        apiCalls: [],
      },
      explanation: 'Verification failed unexpectedly.',
    });
  }
}
