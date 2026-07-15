import { describe, expect, it } from 'vitest';

import { cached, clearResponseCache } from './response-cache';

describe('cached', () => {
  it('fetches once and serves the cached value afterwards', async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return 'value';
    };
    expect(await cached('k1', fetcher)).toBe('value');
    expect(await cached('k1', fetcher)).toBe('value');
    expect(calls).toBe(1);
  });

  it('caches null results too (negative cache)', async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return null;
    };
    expect(await cached('k2', fetcher)).toBeNull();
    expect(await cached('k2', fetcher)).toBeNull();
    expect(calls).toBe(1);
  });

  it('does not cache rejected fetches', async () => {
    let calls = 0;
    const failing = async () => {
      calls += 1;
      throw new Error('boom');
    };
    await expect(cached('k3', failing)).rejects.toThrow('boom');
    await expect(cached('k3', failing)).rejects.toThrow('boom');
    expect(calls).toBe(2);
  });

  it('clearResponseCache forces a refetch', async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return calls;
    };
    expect(await cached('k4', fetcher)).toBe(1);
    clearResponseCache();
    expect(await cached('k4', fetcher)).toBe(2);
  });
});
