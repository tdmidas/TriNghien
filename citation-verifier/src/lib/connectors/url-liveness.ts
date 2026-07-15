import dns from 'node:dns/promises';

import type { ApiCall } from '@/lib/verification/types';

import { politeFetch } from './http-client';

// SSRF-hardened liveness probe for the attacker-controlled `url` bib field.
// The demo host also runs apps on ports 3100/8100, hence: scheme allowlist,
// port allowlist (80/443 only), private-IP denial after DNS resolution,
// manual redirect handling, and no body/header echo.
// Known limitation (documented, accepted for the localhost single-user demo):
// the DNS-lookup-then-fetch sequence is a rebinding TOCTOU.

function isPrivateV4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true; // fail closed
  const [a, b] = parts;
  return (
    a === 0 || // 0.0.0.0/8
    a === 127 || // loopback
    a === 10 || // RFC1918
    (a === 172 && b >= 16 && b <= 31) || // RFC1918
    (a === 192 && b === 168) || // RFC1918
    (a === 169 && b === 254) || // link-local
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64/10
    (a === 198 && (b === 18 || b === 19)) || // benchmarking 198.18/15
    a >= 224 // multicast/reserved
  );
}

function isPrivate(ip: string): boolean {
  if (ip.includes(':')) {
    const low = ip.toLowerCase();
    if (low === '::1' || low === '::') return true;
    if (low.startsWith('fe8') || low.startsWith('fe9') || low.startsWith('fea') || low.startsWith('feb')) {
      return true; // link-local fe80::/10
    }
    if (low.startsWith('fc') || low.startsWith('fd')) return true; // ULA fc00::/7
    const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
    if (mapped) return isPrivateV4(mapped[1]);
    return false;
  }
  return isPrivateV4(ip);
}

export async function urlLiveness(
  raw?: string,
  calls: ApiCall[] = [],
): Promise<boolean | null> {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null; // scheme allowlist
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  if (port !== '80' && port !== '443') return null; // port allowlist

  const addrs = await dns.lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length || addrs.some((a) => isPrivate(a.address))) return null;

  const res = await politeFetch(u.toString(), {
    method: 'HEAD',
    timeoutMs: 4000,
    redirect: 'manual',
    name: 'url-head',
    apiCalls: calls,
  }).catch(() => null);
  if (!res) return null;
  if (res.status >= 300 && res.status < 400) return true; // 3xx = alive, never follow
  return res.ok ? true : null; // no body/header echo anywhere
}
