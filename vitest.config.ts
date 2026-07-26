import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Workflow tests boot a real Temporal test server and run a worker against
    // it, so they are slower than ordinary unit tests. The first run also
    // downloads the test-server binary (~30MB), which is what hookTimeout buys.
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // The SDK's native bindings behave better in a forked process than in a
    // worker thread, and one test server at a time keeps the runs predictable.
    pool: 'forks',
    fileParallelism: false,
  },
});
