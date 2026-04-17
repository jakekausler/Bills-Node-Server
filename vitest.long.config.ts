import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Long-horizon test runner. Executes only `*.long.test.ts` files.
 * Invoked via `npm run test:long`.
 *
 * Short-horizon default config (`vitest.config.ts`) excludes this pattern.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.long.test.ts', 'test/**/*.long.test.ts'],
    exclude: ['node_modules', 'dist'],
    // Long tests can legitimately take 60+ s each — raise timeout.
    testTimeout: 120000,
    hookTimeout: 120000,
    coverage: {
      enabled: false,
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
