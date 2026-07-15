import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
    passWithNoTests: true,
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      // Floor applies to the pure domain core only; UI and network connectors
      // are covered by integration tests without a numeric gate.
      include: ['src/lib/verification/**', 'src/lib/bibtex/**'],
      exclude: ['**/__fixtures__/**', '**/__tests__/**', '**/*.test.ts'],
      thresholds: { lines: 80 },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
