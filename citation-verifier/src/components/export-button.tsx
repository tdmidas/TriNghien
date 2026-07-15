'use client';

import { Button } from '@/components/ui/button';
import { downloadCorrectedBib } from '@/lib/client/download-bib';
import type { RowState } from '@/lib/client/run-verification';
import type { ParsedEntry } from '@/lib/verification/types';

interface Props {
  entries: ParsedEntry[];
  results: Record<string, RowState>;
  accepted: Set<string>;
  enabled: boolean;
}

export function ExportButton({ entries, results, accepted, enabled }: Props) {
  return (
    <div className="flex items-center gap-3">
      <Button
        disabled={!enabled}
        onClick={() => downloadCorrectedBib(entries, results, accepted)}
      >
        Export corrected .bib
      </Button>
      <span className="text-muted-foreground text-sm">
        {accepted.size} correction(s) selected
      </span>
    </div>
  );
}
