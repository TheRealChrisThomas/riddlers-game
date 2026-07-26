import { MockActivityEnvironment } from '@temporalio/testing';
import { describe, expect, it } from 'vitest';
import { disengageMechanism, engageMechanism, overrideVault } from './activities';

// MockActivityEnvironment runs an activity function with a fake Activity Context,
// so we can dictate what Temporal would have told it — here, which retry attempt
// this is. No server, no worker.
describe('overrideVault (chamber 3: the flaky vault)', () => {
  it('rejects the first three attempts, so Temporal has something to retry', async () => {
    for (const attempt of [1, 2, 3]) {
      const env = new MockActivityEnvironment({ attempt });
      await expect(env.run(overrideVault)).rejects.toThrow(/rejected/i);
    }
  });

  it('succeeds on the fourth attempt and reports the count back', async () => {
    const env = new MockActivityEnvironment({ attempt: 4 });
    await expect(env.run(overrideVault)).resolves.toEqual({ attempts: 4 });
  });

  // The demo's whole point is that the retry is Temporal's, not ours: the
  // activity itself has no retry loop, it just fails and trusts the platform.
  it('has no internal retry loop — one call is one attempt', async () => {
    const env = new MockActivityEnvironment({ attempt: 1 });
    const started = Date.now();
    await expect(env.run(overrideVault)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1000); // it failed fast, it didn't sit and retry
  });
});

describe('trap mechanisms (chamber 2: the saga)', () => {
  it('engages and disengages without complaint', async () => {
    const env = new MockActivityEnvironment();
    await expect(env.run(() => engageMechanism('coolant'))).resolves.toBeUndefined();
    await expect(env.run(() => disengageMechanism('coolant'))).resolves.toBeUndefined();
  });
});
