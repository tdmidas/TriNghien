import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';

import { clearResponseCache } from '@/lib/connectors/response-cache';

// Zero out politeness spacing so mocked suites run fast; the default-spacing
// behavior itself is covered by host-limiters.test.ts with fake timers.
process.env.ARXIV_SPACING_MS = '0';
process.env.S2_SPACING_MS = '0';

// Shared MSW server; tests register handlers via server.use(...).
// onUnhandledRequest: 'error' enforces the no-real-network rule.
export const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  clearResponseCache();
});
afterAll(() => server.close());
