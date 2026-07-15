import { llmModel } from '@/lib/env';
import { getLlmClient } from '@/lib/llm-client';
import { LlmOutputSchema } from '@/lib/verification/schemas';
import { sanitizeCorrection } from '@/lib/verification/sanitize-correction';
import type { CorrectedEntry, Evidence, ParsedEntry, Verdict } from '@/lib/verification/types';

import { SYSTEM, userPrompt } from './build-prompt';

export interface ExplainResult {
  explanation: string;
  correctedEntry?: CorrectedEntry;
}

// Some models wrap JSON in markdown fences despite instructions.
function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
}

// Called for EVERY entry, including clean VERIFIED (user decision, sticky):
// each row shows AI reasoning. The only no-LLM path is graceful degradation.
// Split-catch keeps the two failure modes distinguishable for the UI.
export async function explainEntry(
  entry: ParsedEntry,
  evidence: Evidence,
  verdict: Verdict,
): Promise<ExplainResult> {
  const client = getLlmClient();
  if (!client) {
    return { explanation: 'LLM explanation unavailable (no API key configured).' };
  }

  let text: string;
  try {
    // (a) API-call failure
    const resp = await client.chat.completions.create(
      {
        model: llmModel(),
        max_tokens: 400,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: userPrompt(entry, evidence, verdict) },
        ],
      },
      { timeout: 8000 }, // a slow LLM never blows the per-entry latency budget
    );
    text = resp.choices[0]?.message?.content ?? '';
  } catch (e) {
    const reason =
      (e as { status?: number }).status ?? (e as { name?: string }).name ?? 'error';
    return { explanation: `LLM explanation unavailable (LLM call failed: ${reason}).` };
  }

  try {
    // (b) parse/validation failure
    const out = LlmOutputSchema.parse(JSON.parse(stripFences(text)));
    const corrected = out.correctedEntry
      ? sanitizeCorrection(out.correctedEntry, evidence)
      : undefined;
    return {
      explanation: out.explanation,
      correctedEntry: corrected && Object.keys(corrected).length ? corrected : undefined,
    };
  } catch {
    return { explanation: 'LLM explanation unavailable (response could not be parsed).' };
  }
}
