import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    // Property-based tests (fast-check) can run longer than the default.
    testTimeout: 30_000,
  },
});
