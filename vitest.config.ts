import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'server/test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    setupFiles: ['server/test/setup.ts'],
    fileParallelism: false,
    silent: 'passed-only',
  },
});
