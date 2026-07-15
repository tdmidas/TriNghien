// Per-host, MODULE-LEVEL limiters. Valid only for the single long-lived local
// dev process (approved demo scope) — on stateless serverless every invocation
// gets fresh module state and these do not bind (documented future work).
// Both hosts use a promise-chain mutex: serialize calls, no check-then-act
// race, spacing appended after each run (p-limit was dropped — its v5 build
// pulls #async_hooks, which Turbopack cannot resolve in route bundles).

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Spacing is env-tunable so the mocked test suite can run without real delays.
// Garbage env values fall back to the polite defaults, never NaN.
function spacingFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
const ARXIV_SPACING_MS = spacingFromEnv('ARXIV_SPACING_MS', 3000);
const S2_SPACING_MS = spacingFromEnv('S2_SPACING_MS', 1200);

function makeGate(spacingMs: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let gate: Promise<unknown> = Promise.resolve();
  return function schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = gate.then(fn);
    gate = run.then(
      () => sleep(spacingMs),
      () => sleep(spacingMs),
    );
    return run;
  };
}

// arXiv politeness: one call at a time with >=3s spacing.
export const arxivSchedule = makeGate(ARXIV_SPACING_MS);

// Semantic Scholar unauthenticated pool is aggressively throttled at peak:
// one call at a time plus small spacing; 429 backoff lives in withBackoff.
export const s2Schedule = makeGate(S2_SPACING_MS);
