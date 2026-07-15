'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  isPending,
  parseLocal,
  runPool,
  unverifiable,
  verifyOne,
  type RowState,
} from '@/lib/client/run-verification';
import type { ParsedEntry, VerificationResult } from '@/lib/verification/types';

import { BibInputPanel } from './bib-input-panel';
import { ExportButton } from './export-button';
import { ResultsTable } from './results-table';

const POOL_SIZE = 4;

type Phase = 'input' | 'running' | 'done';

export function VerifierApp() {
  const [phase, setPhase] = useState<Phase>('input');
  const [bibText, setBibText] = useState('');
  const [entries, setEntries] = useState<ParsedEntry[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [results, setResults] = useState<Record<string, RowState>>({});
  const [accepted, setAccepted] = useState<Set<string>>(new Set());

  const applyResult = useCallback((r: VerificationResult) => {
    setResults((prev) => ({ ...prev, [r.entryKey]: r }));
    setAccepted((prev) => {
      const next = new Set(prev);
      // arriving corrections are checked for export by default; a retry that
      // comes back without a correction must also drop its stale checkmark
      if (r.correctedEntry) next.add(r.entryKey);
      else next.delete(r.entryKey);
      return next;
    });
  }, []);

  const verify = useCallback(async () => {
    const { entries: parsed, parseErrors: errors } = parseLocal(bibText);
    setParseErrors(errors);
    if (errors.length) toast.warning(`${errors.length} entr${errors.length > 1 ? 'ies' : 'y'} skipped (parse errors).`);
    if (!parsed.length) {
      toast.error('No parseable BibTeX entries found.');
      return;
    }
    setEntries(parsed);
    setResults(Object.fromEntries(parsed.map((e) => [e.key, { status: 'PENDING' as const }])));
    setAccepted(new Set());
    setPhase('running');
    await runPool(parsed, POOL_SIZE, applyResult);
    setPhase('done');
  }, [bibText, applyResult]);

  const retry = useCallback(
    (entry: ParsedEntry) => {
      setResults((prev) => ({ ...prev, [entry.key]: { status: 'PENDING' } }));
      verifyOne(entry)
        .then(applyResult)
        .catch(() => applyResult(unverifiable(entry, 'Verification request failed — click Retry.')));
    },
    [applyResult],
  );

  const toggleAccept = useCallback((key: string) => {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const doneCount = Object.values(results).filter((r) => !isPending(r)).length;
  const running = phase === 'running';

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>BibTeX Reference Verifier</CardTitle>
          <CardDescription>
            Paste or upload a references.bib file — each entry is checked against Crossref,
            OpenAlex, Semantic Scholar, arXiv and DBLP, and flagged if it looks hallucinated.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BibInputPanel
            bibText={bibText}
            onChange={setBibText}
            onVerify={verify}
            running={running}
          />
        </CardContent>
      </Card>

      {parseErrors.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">{parseErrors.length} parse problem(s):</p>
          <ul className="mt-1 list-disc pl-5">
            {parseErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {phase !== 'input' && entries.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>
                Verified {doneCount} of {entries.length} parsed
                {parseErrors.length > 0 ? ` (${parseErrors.length} skipped)` : ''}
              </CardTitle>
              <CardDescription>
                Expand a row for evidence, the AI explanation, and suggested corrections.
              </CardDescription>
            </div>
            <ExportButton
              entries={entries}
              results={results}
              accepted={accepted}
              enabled={phase === 'done' && doneCount === entries.length}
            />
          </CardHeader>
          <CardContent>
            <ResultsTable
              entries={entries}
              results={results}
              accepted={accepted}
              onToggleAccept={toggleAccept}
              onRetry={retry}
              running={running}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
