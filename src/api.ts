import cors from 'cors';
import express from 'express';
import { Connection, Client } from '@temporalio/client';
import {
  ActiveChamber,
  BatcomputerArgs,
  BatcomputerState,
  ChamberResponse,
  ChamberState,
  HubResponse,
  Role,
  ROLES,
  ShellResponse,
  ShellState,
  TASK_QUEUE,
  TraceEvent,
  TraceResponse,
  VILLAINS,
  Villain,
  batSignal,
  chamberActionSignal,
  getBatcomputerQuery,
  getChamberQuery,
  getShellQuery,
  joinSignal,
  setRoleSignal,
} from './shared';
import { batcomputerWorkflow } from './workflows';

const PORT = Number(process.env.PORT ?? 3001);
const ADDRESS = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';

const isNotFound = (err: unknown) => err instanceof Error && err.name === 'WorkflowNotFoundError';

// Last successful reads per case, so a downed worker still serves a frozen board
// (workerReachable:false) while the browser keeps its countdown ticking.
const lastHub = new Map<string, BatcomputerState>();
const lastShell = new Map<string, ShellState>();
const lastChamber = new Map<string, ChamberState>();

function caseCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('query timed out')), ms)),
  ]);
}

async function main() {
  const connection = await Connection.connect({ address: ADDRESS });
  const client = new Client({ connection });
  const app = express();
  app.use(cors());
  app.use(express.json());

  // --- create a case (start the Bat-computer grandparent workflow) ---
  app.post('/api/cases', async (req, res) => {
    const durationMinutes = clampInt(req.body?.durationMinutes, 1, 60, 12);
    const code = caseCode();
    const args: BatcomputerArgs = {
      caseCode: code,
      durationMs: durationMinutes * 60_000,
      reveal: process.env.REVEAL_CODE === '1', // dev flag
    };
    await client.workflow.start(batcomputerWorkflow, { taskQueue: TASK_QUEUE, workflowId: code, args: [args] });
    res.json({ code });
  });

  // --- hub signals (all go to the Bat-computer, keyed on the case code) ---
  app.post('/api/cases/:code/join', (req, res) => signalParent(req, res, joinSignal, str(req.body?.operator)));
  app.post('/api/cases/:code/role', (req, res) => {
    const operator = str(req.body?.operator);
    const role = req.body?.role as Role;
    if (!operator || !ROLES.includes(role)) return res.status(400).json({ error: 'operator and valid role required' });
    return signalParent(req, res, setRoleSignal, { operator, role });
  });
  // The Bat-Signal: name a villain, launch that adventure. Replay re-lights the same signal.
  app.post('/api/cases/:code/batsignal', (req, res) => {
    const villain = str(req.body?.villain) as Villain;
    if (!VILLAINS.includes(villain)) return res.status(400).json({ error: 'valid villain required' });
    return signalParent(req, res, batSignal, villain);
  });

  async function signalParent(
    req: express.Request,
    res: express.Response,
    signal: Parameters<ReturnType<typeof client.workflow.getHandle>['signal']>[0],
    arg: unknown,
  ) {
    try {
      const handle = client.workflow.getHandle(req.params.code);
      await (arg === undefined ? handle.signal(signal) : handle.signal(signal, arg as never));
      res.json({ ok: true });
    } catch (err) {
      if (isNotFound(err)) return res.status(404).json({ error: 'case not found' });
      res.status(503).json({ error: 'could not deliver signal', detail: String(err) });
    }
  }

  // --- Bat-computer hub state (grandparent) ---
  app.get('/api/cases/:code/hub', async (req, res) => {
    const code = req.params.code;
    try {
      const hub = await withTimeout(client.workflow.getHandle(code).query(getBatcomputerQuery), 2000);
      lastHub.set(code, hub);
      res.json({ workerReachable: true, hub } satisfies HubResponse);
    } catch (err) {
      if (isNotFound(err)) return res.status(404).json({ error: 'case not found' });
      const cached = lastHub.get(code);
      if (cached) return res.json({ workerReachable: false, hub: cached } satisfies HubResponse);
      res.status(503).json({ workerReachable: false, error: 'worker unreachable and no cached state' });
    }
  });

  // --- active adventure shell state (the child launched by the Bat-computer) ---
  app.get('/api/cases/:code/shell', async (req, res) => {
    const code = req.params.code;
    const advId = await activeAdventureId(code);
    if (!advId) return res.json({ workerReachable: true, shell: null } satisfies ShellResponse);
    try {
      const shell = await withTimeout(client.workflow.getHandle(advId).query(getShellQuery), 2000);
      lastShell.set(code, shell);
      res.json({ workerReachable: true, shell } satisfies ShellResponse);
    } catch (err) {
      if (isNotFound(err)) return res.json({ workerReachable: true, shell: null } satisfies ShellResponse);
      const cached = lastShell.get(code);
      if (cached) return res.json({ workerReachable: false, shell: cached } satisfies ShellResponse);
      res.status(503).json({ workerReachable: false, error: 'worker unreachable and no cached state' });
    }
  });

  // --- active chamber state (child workflow) ---
  app.get('/api/cases/:code/chamber', async (req, res) => {
    const code = req.params.code;
    const target = await resolveChamber(code, req.query.side);
    if (!target) return res.json({ workerReachable: true, chamber: null } satisfies ChamberResponse);
    const activeId = target.id;
    // Cache key is per-side so two mirrored rooms don't overwrite each other's board.
    const cacheKey = `${code}:${target.side ?? '-'}`;
    try {
      const chamber = await withTimeout(client.workflow.getHandle(activeId).query(getChamberQuery), 2000);
      // Sync the vault fight to Temporal's real retries: inject the live attempt number.
      if (chamber.type === 'escape' && chamber.data.kind === 'escape' && chamber.data.phase === 'override' && chamber.data.overrideStarted) {
        const attempt = await overrideAttempt(client, activeId);
        if (attempt) chamber.data.attempt = attempt;
      }
      lastChamber.set(cacheKey, chamber);
      res.json({ workerReachable: true, chamber } satisfies ChamberResponse);
    } catch (err) {
      if (isNotFound(err)) return res.json({ workerReachable: true, chamber: null } satisfies ChamberResponse);
      const cached = lastChamber.get(cacheKey);
      if (cached) return res.json({ workerReachable: false, chamber: cached } satisfies ChamberResponse);
      res.status(503).json({ workerReachable: false, error: 'worker unreachable and no cached chamber' });
    }
  });

  // --- in-chamber action (signal the active child directly) ---
  app.post('/api/cases/:code/chamber/action', async (req, res) => {
    const code = req.params.code;
    const operator = str(req.body?.operator);
    const action = str(req.body?.action);
    if (!operator || !action) return res.status(400).json({ error: 'operator and action required' });
    const target = await resolveChamber(code, req.body?.side);
    if (!target) return res.status(409).json({ error: 'no active chamber' });
    try {
      await client.workflow.getHandle(target.id).signal(chamberActionSignal, {
        operator,
        action: action as never,
        value: req.body?.value,
      });
      res.json({ ok: true });
    } catch (err) {
      if (isNotFound(err)) return res.status(409).json({ error: 'chamber already closed' });
      res.status(503).json({ error: 'could not deliver action', detail: String(err) });
    }
  });

  // --- live workflow trace: digested history across all three levels ---
  // Bat-computer (hub) → active adventure (case) → active chamber (chamber).
  app.get('/api/cases/:code/trace', async (req, res) => {
    const code = req.params.code;
    try {
      const items: TraceEvent[] = [];
      const hubHist = await withTimeout(client.workflow.getHandle(code).fetchHistory(), 3000);
      collectEvents(hubHist, 'hub', items);
      const advId = await activeAdventureId(code);
      if (advId) {
        try {
          const advHist = await withTimeout(client.workflow.getHandle(advId).fetchHistory(), 3000);
          collectEvents(advHist, 'case', items);
        } catch {
          /* adventure may be mid-transition */
        }
        // A mirrored wave has two live chambers; trace both so the panel shows the
        // parallelism rather than arbitrarily picking one room.
        for (const c of await activeChambers(code)) {
          const label = c.side ? `${c.side}: ` : '';
          try {
            const childHist = await withTimeout(client.workflow.getHandle(c.id).fetchHistory(), 3000);
            collectEvents(childHist, 'chamber', items, label);
          } catch {
            /* child may be mid-transition */
          }
          // Live retries live in the pending-activity state, not in history — surface them.
          await collectPendingActivities(client, c.id, items, label);
        }
      }
      items.sort((a, b) => a.t - b.t);
      res.json({ events: items.slice(-60) } satisfies TraceResponse);
    } catch (err) {
      if (isNotFound(err)) return res.status(404).json({ error: 'case not found' });
      res.json({ events: [] } satisfies TraceResponse);
    }
  });

  // Resolve the active adventure workflowId from the Bat-computer grandparent.
  async function activeAdventureId(code: string): Promise<string | null> {
    try {
      const hub = await withTimeout(client.workflow.getHandle(code).query(getBatcomputerQuery), 2000);
      lastHub.set(code, hub);
      return hub.activeAdventureId;
    } catch {
      return lastHub.get(code)?.activeAdventureId ?? null;
    }
  }

  // Resolve the live chambers (grandchildren) of the current wave via the active adventure.
  // Query fresh so we never target a just-completed chamber; fall back to cache only when
  // the worker is unreachable.
  async function activeChambers(code: string): Promise<ActiveChamber[]> {
    const advId = await activeAdventureId(code);
    if (!advId) return [];
    try {
      const shell = await withTimeout(client.workflow.getHandle(advId).query(getShellQuery), 2000);
      lastShell.set(code, shell);
      return shell.chambers;
    } catch {
      return lastShell.get(code)?.chambers ?? [];
    }
  }

  // Pick the chamber a request is about. A single-chamber wave ignores `side`
  // entirely; a mirrored wave needs it, and defaults to the first room so a
  // side-unaware client still gets something coherent.
  async function resolveChamber(code: string, side: unknown): Promise<ActiveChamber | null> {
    const chambers = await activeChambers(code);
    if (chambers.length === 0) return null;
    if (chambers.length === 1) return chambers[0];
    const want = str(side);
    return chambers.find((c) => c.side === want) ?? chambers[0];
  }

  app.listen(PORT, () => console.log(`🌐 API on http://localhost:${PORT} (Temporal @ ${ADDRESS})`));
}

// --- workflow-history → readable trace ---
function eventMs(e: any): number {
  const s = e?.eventTime?.seconds;
  const n = e?.eventTime?.nanos ?? 0;
  return Number(s ?? 0) * 1000 + Number(n) / 1e6;
}

function describeEvent(e: any): { kind: string; detail: string } | null {
  const key = Object.keys(e).find((k) => k.endsWith('EventAttributes') && e[k]);
  if (!key) return null;
  const a = e[key] as any;
  switch (key) {
    case 'workflowExecutionStartedEventAttributes':
      return { kind: 'start', detail: 'Workflow execution started' };
    case 'workflowExecutionSignaledEventAttributes':
      return { kind: 'signal', detail: `Signal received: ${a.signalName}` };
    case 'timerStartedEventAttributes':
      return { kind: 'timer', detail: 'Durable timer started' };
    case 'timerFiredEventAttributes':
      return { kind: 'timer', detail: 'Timer fired' };
    case 'timerCanceledEventAttributes':
      return { kind: 'timer', detail: 'Timer canceled' };
    case 'startChildWorkflowExecutionInitiatedEventAttributes':
      return { kind: 'child', detail: `Child workflow requested: ${a.workflowId}` };
    case 'childWorkflowExecutionStartedEventAttributes':
      return { kind: 'child', detail: 'Child workflow started' };
    case 'childWorkflowExecutionCompletedEventAttributes':
      return { kind: 'child', detail: 'Child workflow completed' };
    case 'activityTaskScheduledEventAttributes':
      return { kind: 'activity', detail: `Activity scheduled: ${a.activityType?.name}` };
    case 'activityTaskStartedEventAttributes':
      return { kind: 'activity', detail: `Activity started (attempt ${a.attempt})` };
    case 'activityTaskCompletedEventAttributes':
      return { kind: 'activity-ok', detail: 'Activity completed' };
    case 'activityTaskFailedEventAttributes':
      return { kind: 'activity-fail', detail: 'Activity failed — Temporal will retry' };
    case 'workflowExecutionCompletedEventAttributes':
      return { kind: 'end', detail: 'Workflow completed' };
    case 'workflowExecutionContinuedAsNewEventAttributes':
      return { kind: 'can', detail: 'Continued-as-new (fresh history)' };
    default:
      return null; // skip workflowTask*, markers, and other noise
  }
}

function collectEvents(hist: any, wf: 'hub' | 'case' | 'chamber', out: TraceEvent[], label = '') {
  for (const e of hist?.events ?? []) {
    const d = describeEvent(e);
    if (d) out.push({ t: eventMs(e), wf, kind: d.kind, detail: `${label}${d.detail}` });
  }
}

async function overrideAttempt(client: Client, workflowId: string): Promise<number | undefined> {
  try {
    const desc: any = await withTimeout(
      client.workflowService.describeWorkflowExecution({ namespace: 'default', execution: { workflowId } }),
      2000,
    );
    const pa = (desc.pendingActivities ?? []).find((p: any) => p.activityType?.name === 'overrideVault');
    if (pa) return Number(pa.attempt ?? 1);
  } catch {
    /* describe unavailable */
  }
  return undefined;
}

async function collectPendingActivities(client: Client, workflowId: string, out: TraceEvent[], label = '') {
  try {
    const desc: any = await withTimeout(
      client.workflowService.describeWorkflowExecution({ namespace: 'default', execution: { workflowId } }),
      2500,
    );
    for (const pa of desc.pendingActivities ?? []) {
      const attempt = Number(pa.attempt ?? 1);
      const last = pa.lastFailure?.message;
      if (attempt > 1 || last) {
        const name = pa.activityType?.name ?? 'activity';
        out.push({ t: Date.now(), wf: 'chamber', kind: 'activity-fail', detail: `${label}${name}: attempt ${attempt}, retrying${last ? ` — ${last}` : ''}` });
      }
    }
  } catch {
    /* describe may be unavailable mid-transition */
  }
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const str = (v: unknown) => String(v ?? '').trim();

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
