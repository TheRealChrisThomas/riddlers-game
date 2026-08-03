import { Context } from '@temporalio/activity';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Chamber 2 (saga): engaging/disengaging a trap mechanism. Disengage is the
// compensation that runs (in reverse order) when a step is done wrong.
export async function engageMechanism(id: string): Promise<void> {
  await sleep(250);
}

export async function disengageMechanism(id: string): Promise<void> {
  await sleep(250);
}

// Two-Face's coin gate. The flip is an ACTIVITY on purpose: workflow code has a
// seeded, replay-safe Math.random(), so flipping inline would be deterministic but
// would leave no trace — nothing in history for a player to point at. Running it as
// an activity records the result in the event history the instant it lands, before
// anyone has called it. That recording is the fairness proof: the coin cannot be
// re-rolled to suit the call, because a replay reuses the value from history.
export async function flipCoin(): Promise<{ face: 'heads' | 'tails' }> {
  return { face: Math.random() < 0.5 ? 'heads' : 'tails' };
}

// Chamber 3 (retries): the vault override is deliberately flaky. It fails the
// first few attempts so Temporal's automatic retry + backoff kicks in — visible
// live in the Temporal Web UI, and reported back as an attempt count on success.
export async function overrideVault(): Promise<{ attempts: number }> {
  const attempt = Context.current().info.attempt; // 1-based, increments per retry
  if (attempt < 4) {
    throw new Error(`Vault override rejected by the Riddler's lock (attempt ${attempt})`);
  }
  return { attempts: attempt };
}
