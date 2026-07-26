import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Workflow tests boot a real Temporal test server and run a worker against
    // it, so they are slower than ordinary unit tests: the end-to-end case test
    // drives three chambers through real signal round-trips, and shared CI
    // runners are a lot slower than a laptop. hookTimeout also covers the
    // one-off download of the test-server binary (~30MB) on a cold machine.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // The SDK's native bindings behave better in a forked process than in a
    // worker thread, and one test server at a time keeps the runs predictable.
    pool: 'forks',
    fileParallelism: false,
  },
});
