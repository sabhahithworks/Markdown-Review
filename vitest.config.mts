import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/test/**/*.test.ts'],
    // The performance test (src/test/perf.test.ts) asserts wall-clock time. Running suites in
    // parallel across worker processes makes those numbers depend on what else happens to be
    // scheduled, which is the single biggest source of flakiness in a timing assertion.
    fileParallelism: false,
    // The 5 MB corpus for the performance test is generated in a beforeAll.
    hookTimeout: 180_000,
    testTimeout: 60_000,
  },
});
