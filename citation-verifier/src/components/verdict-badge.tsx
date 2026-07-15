import { Badge } from '@/components/ui/badge';
import type { Verdict } from '@/lib/verification/types';

const STYLES: Record<Verdict, string> = {
  VERIFIED: 'bg-green-600 text-white border-transparent',
  MISMATCH: 'bg-amber-500 text-white border-transparent',
  NOT_FOUND: 'bg-red-600 text-white border-transparent',
  UNVERIFIABLE: 'bg-gray-400 text-white border-transparent',
};

export function VerdictBadge({ verdict }: { verdict: Verdict | 'PENDING' }) {
  if (verdict === 'PENDING') {
    return (
      <Badge variant="outline" className="text-muted-foreground gap-1.5">
        <span
          aria-hidden
          className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
        Verifying…
      </Badge>
    );
  }
  return <Badge className={STYLES[verdict]}>{verdict}</Badge>;
}
