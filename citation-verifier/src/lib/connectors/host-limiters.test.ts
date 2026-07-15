import { afterEach, describe, expect, it, vi } from 'vitest';

describe('arxivSchedule', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('serializes calls and enforces the configured spacing', async () => {
    vi.resetModules();
    vi.stubEnv('ARXIV_SPACING_MS', '3000');
    vi.useFakeTimers();
    const { arxivSchedule } = await import('./host-limiters');

    const order: number[] = [];
    const p1 = arxivSchedule(async () => {
      order.push(1);
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual([1]);

    const p2 = arxivSchedule(async () => {
      order.push(2);
    });
    // second call must wait out the 3s politeness window
    await vi.advanceTimersByTimeAsync(2999);
    expect(order).toEqual([1]);
    await vi.advanceTimersByTimeAsync(2);
    expect(order).toEqual([1, 2]);
    await Promise.all([p1, p2]);
  });

  it('keeps spacing even when a call rejects', async () => {
    vi.resetModules();
    vi.stubEnv('ARXIV_SPACING_MS', '3000');
    vi.useFakeTimers();
    const { arxivSchedule } = await import('./host-limiters');

    const order: string[] = [];
    const p1 = arxivSchedule(async () => {
      order.push('fail');
      throw new Error('boom');
    });
    p1.catch(() => {}); // observed below
    await vi.advanceTimersByTimeAsync(0);

    const p2 = arxivSchedule(async () => {
      order.push('ok');
    });
    await vi.advanceTimersByTimeAsync(2999);
    expect(order).toEqual(['fail']);
    await vi.advanceTimersByTimeAsync(2);
    expect(order).toEqual(['fail', 'ok']);
    await expect(p1).rejects.toThrow('boom');
    await p2;
  });
});

describe('s2Schedule', () => {
  it('runs calls one at a time in submission order', async () => {
    const { s2Schedule } = await import('./host-limiters');
    const order: number[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((r) => {
      releaseFirst = r;
    });

    const p1 = s2Schedule(async () => {
      await firstGate;
      order.push(1);
    });
    const p2 = s2Schedule(async () => {
      order.push(2);
    });

    // second call cannot start while the first is in flight
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([]);
    releaseFirst();
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });
});
