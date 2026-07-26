import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as activities from './activities';
import {
  BatcomputerState,
  ChamberAction,
  ChamberState,
  DeathtrapData,
  EscapeData,
  Player,
  RiddleData,
  TASK_QUEUE,
  batSignal,
  chamberActionSignal,
  getBatcomputerQuery,
  getChamberQuery,
  joinSignal,
} from './shared';
import { batcomputerWorkflow, chamberWorkflow } from './workflows';

// ============================================================================
// These run against Temporal's time-skipping test server: when every workflow
// is parked on a timer, the server jumps the clock instead of waiting. A
// 12-minute case deadline and the vault's retry backoff both resolve in
// milliseconds, so the durability behaviour is testable at unit-test speed.
//
// Nothing external is required — the test server is downloaded and run by
// @temporalio/testing itself.
// ============================================================================

let env: TestWorkflowEnvironment;
let worker: Worker;
let workerRun: Promise<void>;

const SOLO: Player[] = [{ operator: 'chris', role: 'batman' }];
let seq = 0;
const uniqueId = (prefix: string) => `${prefix}-${Date.now()}-${seq++}`;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
  worker = await Worker.create({
    connection: env.nativeConnection,
    namespace: env.client.options.namespace,
    taskQueue: TASK_QUEUE,
    // The worker bundles the workflow file itself; TypeScript is fine here.
    workflowsPath: path.resolve(process.cwd(), 'src/workflows.ts'),
    activities,
  });
  // A Worker can only be run once, so it runs for the whole file rather than
  // per test (worker.runUntil would shut it down after the first one).
  workerRun = worker.run();
});

afterAll(async () => {
  worker?.shutdown();
  await workerRun?.catch(() => undefined);
  await env?.teardown();
});

/** Deadline in the test server's clock, which is not the process clock. */
const deadlineIn = async (ms: number) => (await env.currentTimeMs()) + ms;

/** Poll a query until it satisfies `ok`, tolerating "workflow not started yet". */
async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, label: string, tries = 200): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const v = await read();
      if (ok(v)) return v;
      last = v;
    } catch (e) {
      last = e; // the workflow may not exist yet
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for ${label}; last saw ${JSON.stringify(last)?.slice(0, 200)}`);
}

// --------------------------------------------------------------------------
describe('chamber 1 — the riddle lock (signals in, query out)', () => {
  it('opens when the code is guessed', async () => {
    const handle = await env.client.workflow.start(chamberWorkflow, {
      taskQueue: TASK_QUEUE,
      workflowId: uniqueId('riddle-solve'),
      args: [
        {
          type: 'riddle',
          caseCode: 'TEST1',
          deadlineEpochMs: await deadlineIn(10 * 60_000),
          roster: SOLO,
          reveal: true, // dev flag: the answer comes back on the query
        },
      ],
    });

    const state = await until(() => handle.query(getChamberQuery), () => true, 'riddle state');
    const answer = (state.data as RiddleData).answer;
    expect(answer).toHaveLength(4);

    await handle.signal(chamberActionSignal, { operator: 'chris', action: 'guess', value: answer });
    await expect(handle.result()).resolves.toEqual({ cleared: true });
  });

  it('scores a near-miss as three exact and no solve', async () => {
    const handle = await env.client.workflow.start(chamberWorkflow, {
      taskQueue: TASK_QUEUE,
      workflowId: uniqueId('riddle-score'),
      args: [
        {
          type: 'riddle',
          caseCode: 'TEST1',
          deadlineEpochMs: await deadlineIn(10 * 60_000),
          roster: SOLO,
          reveal: true,
        },
      ],
    });

    const state = await until(() => handle.query(getChamberQuery), () => true, 'riddle state');
    const answer = [...(state.data as RiddleData).answer!];
    // Change exactly one digit to something it definitely is not.
    const nearMiss = [...answer];
    nearMiss[0] = (answer[0] % 6) + 1;

    await handle.signal(chamberActionSignal, { operator: 'chris', action: 'guess', value: nearMiss });
    const after = await until(
      () => handle.query(getChamberQuery),
      (s) => (s.data as RiddleData).guesses.length === 1,
      'the guess to register',
    );

    const [guess] = (after.data as RiddleData).guesses;
    expect(guess.exact).toBe(3); // the three untouched digits
    expect((after.data as RiddleData).solved).toBe(false);
    await handle.terminate();
  });

  it('fails when the deadline passes — the clock is skipped, not waited out', async () => {
    const handle = await env.client.workflow.start(chamberWorkflow, {
      taskQueue: TASK_QUEUE,
      workflowId: uniqueId('riddle-timeout'),
      args: [
        {
          type: 'riddle',
          caseCode: 'TEST1',
          deadlineEpochMs: await deadlineIn(12 * 60_000), // twelve minutes...
          roster: SOLO,
        },
      ],
    });
    // ...resolved in milliseconds, because nobody is holding the clock open.
    await expect(handle.result()).resolves.toEqual({ cleared: false });
  });
});

// --------------------------------------------------------------------------
describe('chamber 2 — the deathtrap (saga compensation)', () => {
  const ORDER = ['coolant', 'servo', 'core', 'uplink'];

  const startDeathtrap = async () =>
    env.client.workflow.start(chamberWorkflow, {
      taskQueue: TASK_QUEUE,
      workflowId: uniqueId('deathtrap'),
      args: [
        {
          type: 'deathtrap',
          caseCode: 'TEST1',
          deadlineEpochMs: await deadlineIn(10 * 60_000),
          roster: SOLO,
        },
      ],
    });

  it('disarms when the wires are cut in order', async () => {
    const handle = await startDeathtrap();
    for (const stepId of ORDER) {
      await handle.signal(chamberActionSignal, { operator: 'chris', action: 'disarm', value: stepId });
      await until(
        () => handle.query(getChamberQuery),
        (s) => (s.data as DeathtrapData).steps.find((x) => x.id === stepId)?.engaged === true,
        `${stepId} to engage`,
      );
    }
    await expect(handle.result()).resolves.toEqual({ cleared: true });
  });

  it('walks the last wire back when one is cut out of sequence', async () => {
    const handle = await startDeathtrap();

    // One correct cut...
    await handle.signal(chamberActionSignal, { operator: 'chris', action: 'disarm', value: 'coolant' });
    await until(
      () => handle.query(getChamberQuery),
      (s) => (s.data as DeathtrapData).nextIndex === 1,
      'the first wire to engage',
    );

    // ...then a wrong one. Compensation reverses the last step, not the lot.
    await handle.signal(chamberActionSignal, { operator: 'chris', action: 'disarm', value: 'uplink' });
    const after = await until(
      () => handle.query(getChamberQuery),
      (s) => (s.data as DeathtrapData).nextIndex === 0 && !(s.data as DeathtrapData).compensating,
      'compensation to run',
    );

    const data = after.data as DeathtrapData;
    expect(data.steps.find((s) => s.id === 'coolant')?.engaged).toBe(false);
    expect(data.disarmed).toBe(false);

    // Still solvable afterwards — the saga rewound, it didn't break the room.
    for (const stepId of ORDER) {
      await handle.signal(chamberActionSignal, { operator: 'chris', action: 'disarm', value: stepId });
      await until(
        () => handle.query(getChamberQuery),
        (s) => (s.data as DeathtrapData).steps.find((x) => x.id === stepId)?.engaged === true,
        `${stepId} to re-engage`,
      );
    }
    await expect(handle.result()).resolves.toEqual({ cleared: true });
  });
});

// --------------------------------------------------------------------------
describe('chamber 3 — the vault (activity retries, then a co-op hold)', () => {
  it('lets Temporal retry the flaky override, then opens on a full hold', async () => {
    const handle = await env.client.workflow.start(chamberWorkflow, {
      taskQueue: TASK_QUEUE,
      workflowId: uniqueId('vault'),
      args: [
        {
          type: 'escape',
          caseCode: 'TEST1',
          deadlineEpochMs: await deadlineIn(10 * 60_000),
          roster: SOLO,
        },
      ],
    });

    await until(() => handle.query(getChamberQuery), () => true, 'vault state');
    await handle.signal(chamberActionSignal, { operator: 'chris', action: 'reboot' });

    // The activity throws on attempts 1-3; the retries and their backoff are
    // Temporal's, and the attempt count is reported back on success.
    const held = await until(
      () => handle.query(getChamberQuery),
      (s) => (s.data as EscapeData).phase === 'hold',
      'the override to succeed',
    );
    expect((held.data as EscapeData).overrideAttempts).toBe(4);

    await handle.signal(chamberActionSignal, { operator: 'chris', action: 'hold', value: true });
    await expect(handle.result()).resolves.toEqual({ cleared: true });
  });
});

// --------------------------------------------------------------------------
describe('the Bat-computer (grandparent: score, Continue-As-New)', () => {
  it('restores team, score and record from its seed args', async () => {
    const handle = await env.client.workflow.start(batcomputerWorkflow, {
      taskQueue: TASK_QUEUE,
      workflowId: uniqueId('hub-seed'),
      args: [
        {
          caseCode: 'SEED1',
          durationMs: 60_000,
          seedRoster: SOLO,
          seedScore: 300,
          seedSolved: ['riddler'],
          seedStatuses: { riddler: 'escaped', twoface: 'idle', joker: 'idle', penguin: 'idle' },
          round: 4,
        },
      ],
    });

    const state = await until(() => handle.query(getBatcomputerQuery), () => true, 'hub state');
    expect(state.score).toBe(300);
    expect(state.solved).toEqual(['riddler']);
    expect(state.statuses.riddler).toBe('escaped');
    expect(state.round).toBe(4);
    expect(state.roster).toEqual(SOLO);
    await handle.terminate();
  });

  it('refuses to light the signal for a sealed case file', async () => {
    const handle = await env.client.workflow.start(batcomputerWorkflow, {
      taskQueue: TASK_QUEUE,
      workflowId: uniqueId('hub-locked'),
      args: [{ caseCode: 'LOCK1', durationMs: 60_000, seedRoster: SOLO }],
    });

    await until(() => handle.query(getBatcomputerQuery), () => true, 'hub state');
    await handle.signal(batSignal, 'joker'); // locked

    const state = await until(
      () => handle.query(getBatcomputerQuery),
      (s) => s.log.some((l) => /sealed/i.test(l)),
      'the refusal to be logged',
    );
    expect(state.activeVillain).toBeNull();
    expect(state.statuses.joker).toBe('idle');
    await handle.terminate();
  });

  it('banks the score and Continue-As-News after a won case', async () => {
    const caseCode = uniqueId('WIN').toUpperCase();
    const handle = await env.client.workflow.start(batcomputerWorkflow, {
      taskQueue: TASK_QUEUE,
      workflowId: caseCode,
      args: [{ caseCode, durationMs: 20 * 60_000, reveal: true }],
    });

    await handle.signal(joinSignal, 'chris');
    await until(
      () => handle.query(getBatcomputerQuery),
      (s) => s.roster.length === 1,
      'the roster to fill',
    );
    await handle.signal(batSignal, 'riddler');

    // The hub starts the adventure, which starts one chamber child at a time.
    const chamber = (n: number) => env.client.workflow.getHandle(`${caseCode}#r1c${n}`);
    const chamberState = (n: number) => chamber(n).query(getChamberQuery);
    const act = (n: number, action: ChamberAction['action'], value?: unknown) =>
      chamber(n).signal(chamberActionSignal, { operator: 'chris', action, value });

    // Chamber 1: read the answer (reveal) and guess it.
    const riddle = await until(() => chamberState(1), (s) => s.type === 'riddle', 'the riddle chamber');
    await act(1, 'guess', (riddle.data as RiddleData).answer);

    // Chamber 2: cut the wires in order.
    await until(() => chamberState(2), (s) => s.type === 'deathtrap', 'the deathtrap chamber');
    for (const stepId of ['coolant', 'servo', 'core', 'uplink']) {
      await act(2, 'disarm', stepId);
      await until(
        () => chamberState(2),
        (s) => (s.data as DeathtrapData).steps.find((x) => x.id === stepId)?.engaged === true,
        `${stepId} to engage`,
      );
    }

    // Chamber 3: override the vault, then hold the exit.
    await until(() => chamberState(3), (s) => s.type === 'escape', 'the vault chamber');
    await act(3, 'reboot');
    await until(
      () => chamberState(3),
      (s) => (s.data as EscapeData).phase === 'hold',
      'the vault to open',
    );
    await act(3, 'hold', true);

    // The adventure reports up; the hub banks the win and Continue-As-News.
    const banked = await until(
      () => handle.query(getBatcomputerQuery),
      (s) => s.score > 0,
      'the score to be banked',
    );
    expect(banked.score).toBe(100);
    expect(banked.solved).toEqual(['riddler']);
    expect(banked.statuses.riddler).toBe('escaped');
    // Fresh run, same workflowId (the invite link never changes), history reset.
    expect(banked.round).toBe(2);
    expect(banked.roster).toEqual(SOLO);
    await handle.terminate();
  });
});
