'use client';

import { useRef } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  bibText: string;
  onChange: (text: string) => void;
  onVerify: () => void;
  running: boolean;
}

export function BibInputPanel({ bibText, onChange, onVerify, running }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  const loadDemo = async () => {
    try {
      const r = await fetch('/demo-references.bib');
      if (!r.ok) {
        toast.error('Demo file not found — run `npm run sync:demo` first.');
        return;
      }
      onChange(await r.text());
    } catch {
      toast.error('Could not load the demo file.');
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      onChange(await file.text());
    } catch {
      toast.error('Could not read the selected file.');
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Textarea
        value={bibText}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Paste your references.bib content here…"
        className="min-h-56 font-mono text-sm"
        disabled={running}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onVerify} disabled={running || !bibText.trim()}>
          {running ? 'Verifying…' : 'Verify'}
        </Button>
        <Button variant="outline" disabled={running} onClick={() => fileRef.current?.click()}>
          Upload .bib file
        </Button>
        <Button variant="outline" disabled={running} onClick={loadDemo}>
          Load demo
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".bib,.txt"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </div>
    </div>
  );
}
