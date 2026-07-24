import cors from 'cors';
import express from 'express';
import { Connection, Client } from '@temporalio/client';
import {
  ChamberState,
  EscapeArgs,
  Role,
  ROLES,
  ShellState,
  TASK_QUEUE,
  chamberActionSignal,
  getChamberQuery,
  getShellQuery,
  joinSignal,
  playAgainSignal,
  setRoleSignal,
  startSignal,
} from './shared';
import { escapeWorkflow } from './workflows';

const PORT = Number(process.env.PORT ?? 3001);
const ADDRESS = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';

const isNotFound = (err: unknown) => err instanceof Error && err.name === 'WorkflowNotFoundError';

// Last successful reads per case, so a downed worker still serves a frozen board
// (workerReachable:false) while the browser keeps its countdown ticking.
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

  // --- create a case (start the parent workflow) ---
  app.post('/api/cases', async (req, res) => {
    const durationMinutes = clampInt(req.body?.durationMinutes, 1, 60, 12);
    const code = caseCode();
    const args: EscapeArgs = {
      caseCode: code,
      durationMs: durationMinutes * 60_000,
      reveal: process.env.REVEAL_CODE === '1', // dev flag
    };
    await client.workflow.start(escapeWorkflow, { taskQueue: TASK_QUEUE, workflowId: code, args: [args] });
    res.json({ code });
  });

  // --- lobby signals (all go to the parent) ---
  app.post('/api/cases/:code/join', (req, res) => signalParent(req, res, joinSignal, str(req.body?.operator)));
  app.post('/api/cases/:code/start', (req, res) => signalParent(req, res, startSignal, undefined));
  app.post('/api/cases/:code/replay', (req, res) => signalParent(req, res, playAgainSignal, undefined));
  app.post('/api/cases/:code/role', (req, res) => {
    const operator = str(req.body?.operator);
    const role = req.body?.role as Role;
    if (!operator || !ROLES.includes(role)) return res.status(400).json({ error: 'operator and valid role required' });
    return signalParent(req, res, setRoleSignal, { operator, role });
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

  // --- parent shell state ---
  app.get('/api/cases/:code/shell', async (req, res) => {
    const code = req.params.code;
    try {
      const shell = await withTimeout(client.workflow.getHandle(code).query(getShellQuery), 2000);
      lastShell.set(code, shell);
      res.json({ workerReachable: true, shell });
    } catch (err) {
      if (isNotFound(err)) return res.status(404).json({ error: 'case not found' });
      const cached = lastShell.get(code);
      if (cached) return res.json({ workerReachable: false, shell: cached });
      res.status(503).json({ workerReachable: false, error: 'worker unreachable and no cached state' });
    }
  });

  // --- active chamber state (child workflow) ---
  app.get('/api/cases/:code/chamber', async (req, res) => {
    const code = req.params.code;
    const activeId = await activeChamberId(code);
    if (!activeId) return res.json({ workerReachable: true, chamber: null });
    try {
      const chamber = await withTimeout(client.workflow.getHandle(activeId).query(getChamberQuery), 2000);
      lastChamber.set(code, chamber);
      res.json({ workerReachable: true, chamber });
    } catch (err) {
      if (isNotFound(err)) return res.json({ workerReachable: true, chamber: null });
      const cached = lastChamber.get(code);
      if (cached) return res.json({ workerReachable: false, chamber: cached });
      res.status(503).json({ workerReachable: false, error: 'worker unreachable and no cached chamber' });
    }
  });

  // --- in-chamber action (signal the active child directly) ---
  app.post('/api/cases/:code/chamber/action', async (req, res) => {
    const code = req.params.code;
    const operator = str(req.body?.operator);
    const action = str(req.body?.action);
    if (!operator || !action) return res.status(400).json({ error: 'operator and action required' });
    const activeId = await activeChamberId(code);
    if (!activeId) return res.status(409).json({ error: 'no active chamber' });
    try {
      await client.workflow.getHandle(activeId).signal(chamberActionSignal, {
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

  // --- live workflow trace: digested event history of the parent + active child ---
  app.get('/api/cases/:code/trace', async (req, res) => {
    const code = req.params.code;
    try {
      const items: TraceItem[] = [];
      const parentHist = await withTimeout(client.workflow.getHandle(code).fetchHistory(), 3000);
      collectEvents(parentHist, 'case', items);
      const activeId = await activeChamberId(code);
      if (activeId) {
        try {
          const childHist = await withTimeout(client.workflow.getHandle(activeId).fetchHistory(), 3000);
          collectEvents(childHist, 'chamber', items);
        } catch {
          /* child may be mid-transition */
        }
        // Live retries live in the pending-activity state, not in history — surface them.
        await collectPendingActivities(client, activeId, items);
      }
      items.sort((a, b) => a.t - b.t);
      res.json({ events: items.slice(-60) });
    } catch (err) {
      if (isNotFound(err)) return res.status(404).json({ error: 'case not found' });
      res.json({ events: [] });
    }
  });

  // Resolve the active child workflowId from the parent. Query fresh so we never target a
  // just-completed chamber; fall back to cache only when the worker is unreachable.
  async function activeChamberId(code: string): Promise<string | null> {
    try {
      const shell = await withTimeout(client.workflow.getHandle(code).query(getShellQuery), 2000);
      lastShell.set(code, shell);
      return shell.activeChamberId;
    } catch {
      return lastShell.get(code)?.activeChamberId ?? null;
    }
  }

  app.listen(PORT, () => console.log(`🌐 API on http://localhost:${PORT} (Temporal @ ${ADDRESS})`));
}

// --- workflow-history → readable trace ---
interface TraceItem {
  t: number;
  wf: 'case' | 'chamber';
  kind: string;
  detail: string;
}

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

function collectEvents(hist: any, wf: 'case' | 'chamber', out: TraceItem[]) {
  for (const e of hist?.events ?? []) {
    const d = describeEvent(e);
    if (d) out.push({ t: eventMs(e), wf, kind: d.kind, detail: d.detail });
  }
}

async function collectPendingActivities(client: Client, workflowId: string, out: TraceItem[]) {
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
        out.push({ t: Date.now(), wf: 'chamber', kind: 'activity-fail', detail: `${name}: attempt ${attempt}, retrying${last ? ` — ${last}` : ''}` });
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
