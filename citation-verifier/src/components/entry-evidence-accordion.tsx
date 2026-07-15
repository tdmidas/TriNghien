'use client';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Checkbox } from '@/components/ui/checkbox';
import type { CanonicalRecord, VerificationResult } from '@/lib/verification/types';

import { SafeLink } from './safe-link';

function boolLabel(v: boolean | null | undefined): string {
  return v === true ? 'yes' : v === false ? 'no' : 'inconclusive';
}

function RecordFields({ record }: { record: CanonicalRecord }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-muted-foreground">source</dt>
      <dd>{record.source}</dd>
      <dt className="text-muted-foreground">title</dt>
      <dd>{record.title}</dd>
      <dt className="text-muted-foreground">authors</dt>
      <dd>{record.authors.join('; ')}</dd>
      {record.year != null && (
        <>
          <dt className="text-muted-foreground">year</dt>
          <dd>{record.year}</dd>
        </>
      )}
      {record.venue && (
        <>
          <dt className="text-muted-foreground">venue</dt>
          <dd>{record.venue}</dd>
        </>
      )}
      {record.doi && (
        <>
          <dt className="text-muted-foreground">doi</dt>
          <dd>
            <SafeLink href={`https://doi.org/${record.doi}`}>{record.doi}</SafeLink>
          </dd>
        </>
      )}
      {record.url && (
        <>
          <dt className="text-muted-foreground">url</dt>
          <dd>
            <SafeLink href={record.url}>{record.url}</SafeLink>
          </dd>
        </>
      )}
    </dl>
  );
}

interface Props {
  result: VerificationResult;
  accepted: boolean;
  onToggleAccept: (key: string) => void;
}

export function EntryEvidenceAccordion({ result, accepted, onToggleAccept }: Props) {
  const ev = result.evidence;
  const tier4 = ev.tier4;

  return (
    <Accordion type="multiple" className="w-full">
      <AccordionItem value="explanation">
        <AccordionTrigger>AI Explanation</AccordionTrigger>
        <AccordionContent>
          {/* Vietnamese LLM text, rendered verbatim; UI chrome stays English */}
          <p className="text-sm whitespace-pre-wrap">{result.explanation ?? 'No explanation.'}</p>
        </AccordionContent>
      </AccordionItem>

      {result.correctedEntry && (
        <AccordionItem value="correction">
          <AccordionTrigger>Suggested correction</AccordionTrigger>
          <AccordionContent className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={accepted}
                onCheckedChange={() => onToggleAccept(result.entryKey)}
              />
              Include this correction in export
            </label>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              {Object.entries(result.correctedEntry).map(([field, value]) => (
                <div key={field} className="contents">
                  <dt className="text-muted-foreground">{field}</dt>
                  <dd>{Array.isArray(value) ? value.join('; ') : String(value)}</dd>
                </div>
              ))}
            </dl>
          </AccordionContent>
        </AccordionItem>
      )}

      {ev.diffs.length > 0 && (
        <AccordionItem value="diffs">
          <AccordionTrigger>Field diffs ({ev.diffs.length})</AccordionTrigger>
          <AccordionContent>
            <dl className="flex flex-col gap-2 text-sm">
              {ev.diffs.map((d) => (
                <div key={d.field}>
                  <dt className="font-medium">{d.field}</dt>
                  <dd className="text-red-600 line-through">{d.bibValue}</dd>
                  <dd className="text-green-700">{d.canonicalValue}</dd>
                </div>
              ))}
            </dl>
          </AccordionContent>
        </AccordionItem>
      )}

      {ev.bestMatch && (
        <AccordionItem value="matched">
          <AccordionTrigger>Matched record</AccordionTrigger>
          <AccordionContent>
            <RecordFields record={ev.bestMatch.record} />
            <p className="text-muted-foreground mt-2 text-xs">
              title similarity {ev.bestMatch.score.title.toFixed(2)} · author overlap{' '}
              {ev.bestMatch.score.author.toFixed(2)} · year {ev.bestMatch.score.year}
            </p>
          </AccordionContent>
        </AccordionItem>
      )}

      {tier4 && (
        <AccordionItem value="tier4">
          <AccordionTrigger>Venue &amp; URL checks</AccordionTrigger>
          <AccordionContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">DBLP hit</dt>
              <dd>{ev.bestMatch ? 'not needed (matched above)' : boolLabel(tier4.dblpFound)}</dd>
              <dt className="text-muted-foreground">journal known</dt>
              <dd>{boolLabel(tier4.journalKnown)}</dd>
              <dt className="text-muted-foreground">Scimago quartile</dt>
              <dd>{tier4.journalQuartile ?? 'n/a'}</dd>
              <dt className="text-muted-foreground">URL alive</dt>
              <dd>{boolLabel(tier4.urlAlive)}</dd>
            </dl>
          </AccordionContent>
        </AccordionItem>
      )}

      <AccordionItem value="api-calls">
        <AccordionTrigger>API calls ({ev.apiCalls.length})</AccordionTrigger>
        <AccordionContent>
          <ul className="flex flex-col gap-1 text-sm">
            {ev.apiCalls.map((c, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="text-muted-foreground w-32 shrink-0">{c.name}</span>
                <span className={c.ok ? 'text-green-700' : 'text-red-600'}>
                  {c.status === 0 ? 'network error' : c.status}
                </span>
                <span className="truncate">
                  <SafeLink href={c.url}>{c.url}</SafeLink>
                </span>
              </li>
            ))}
            {ev.apiCalls.length === 0 && (
              <li className="text-muted-foreground">No API calls recorded.</li>
            )}
          </ul>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
