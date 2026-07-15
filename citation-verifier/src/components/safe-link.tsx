import type { ReactNode } from 'react';

function isSafeHttpUrl(href: string): boolean {
  try {
    const u = new URL(href);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Renders an anchor ONLY for http/https values; anything else (javascript:,
// data:, malformed) falls back to plain text. Bib fields are untrusted.
export function SafeLink({ href, children }: { href?: string; children: ReactNode }) {
  if (!href) return <>{children}</>;
  if (!isSafeHttpUrl(href)) return <span>{children}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2 hover:text-primary"
    >
      {children}
    </a>
  );
}
