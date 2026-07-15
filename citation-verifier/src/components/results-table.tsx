'use client';

import { Fragment } from 'react';

import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { isPending, type RowState } from '@/lib/client/run-verification';
import type { ParsedEntry, VerificationResult } from '@/lib/verification/types';

import { EntryEvidenceAccordion } from './entry-evidence-accordion';
import { VerdictBadge } from './verdict-badge';

interface Props {
  entries: ParsedEntry[];
  results: Record<string, RowState>;
  accepted: Set<string>;
  onToggleAccept: (key: string) => void;
  onRetry: (entry: ParsedEntry) => void;
  running: boolean;
}

export function ResultsTable({
  entries,
  results,
  accepted,
  onToggleAccept,
  onRetry,
  running,
}: Props) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-48">Key</TableHead>
          <TableHead>Title</TableHead>
          <TableHead className="w-36">Verdict</TableHead>
          <TableHead className="w-20" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => {
          const row = results[entry.key];
          const done = row && !isPending(row);
          const result = done ? (row as VerificationResult) : undefined;
          return (
            <Fragment key={entry.key}>
              <TableRow>
                <TableCell className="font-mono text-xs">{entry.key}</TableCell>
                <TableCell className="max-w-md truncate" title={entry.title}>
                  {entry.title ?? <span className="text-muted-foreground">(no title)</span>}
                </TableCell>
                <TableCell>
                  <VerdictBadge verdict={result ? result.verdict : 'PENDING'} />
                </TableCell>
                <TableCell>
                  {result && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={running}
                      onClick={() => onRetry(entry)}
                    >
                      Retry
                    </Button>
                  )}
                </TableCell>
              </TableRow>
              {result && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4} className="bg-muted/30 px-6 py-2">
                    <EntryEvidenceAccordion
                      result={result}
                      accepted={accepted.has(entry.key)}
                      onToggleAccept={onToggleAccept}
                    />
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}
