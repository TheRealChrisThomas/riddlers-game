import {
  condition,
  continueAsNew,
  proxyActivities,
  setHandler,
  sleep,
  startChild,
  workflowInfo,
} from '@temporalio/workflow';
import type * as activities from './activities';
import {
  CHAMBER_SEQUENCE,
  CHAMBER_TITLES,
  ChamberArgs,
  ChamberResult,
  ChamberState,
  DeathtrapData,
  DeathtrapStep,
  EscapeArgs,
  EscapeData,
  Guess,
  Player,
  ROLE_LABEL,
  ROLES,
  RiddleData,
  Role,
  ShellState,
  chamberActionSignal,
  getChamberQuery,
  getShellQuery,
  joinSignal,
  playAgainSignal,
  setRoleSignal,
  startSignal,
} from './shared';

const { engageMechanism, disengageMechanism, overrideVault } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10s',
  retry: { initialInterval: '500ms', backoffCoefficient: 2, maximumAttempts: 10 },
});

const TAUNT_INTERVAL_MS = 22_000;
const TAUNTS = [
  'Tick-tock, Bat-Family. The clock is such an impatient little thing.',
  'Struggling already? I do so love to watch a hero sweat.',
  "You're cleverer than the last ones. They didn't make it out either.",
  'Every second you waste, my walls grow a little closer.',
  "Riddle me this: what's worth more than time, when you have so little of it left?",
];

// ============================================================================
// PARENT: the whole escape. Spawns one child workflow per chamber, in order,
// sharing a single absolute deadline. Escape = all chambers cleared in time.
// ============================================================================
export async function escapeWorkflow(args: EscapeArgs): Promise<ShellState> {
  const players = new Map<string, Role>();
  for (const p of args.seedRoster ?? []) players.set(p.operator, p.role); // rematch keeps the team
  const round = args.round ?? 1;
  let started = args.autoStart === true;
  let playAgain = false;
  let status: ShellState['status'] = 'lobby';
  let deadlineEpochMs: number | null = null;
  let chamberIndex = 0;
  let activeChamberId: string | null = null;
  let taunt: ShellState['taunt'] = null;
  let tauntSeq = 0;
  const log: string[] = [
    'The Riddler: "Riddle me this, Bat-Family… can you escape my three chambers before the clock kills you all?"',
  ];

  const roster = (): Player[] => [...players].map(([operator, role]) => ({ operator, role }));
  const activeType = () => (status === 'in_chamber' ? CHAMBER_SEQUENCE[chamberIndex] : null);
  const shell = (): ShellState => {
    const type = activeType();
    return {
      status,
      caseCode: args.caseCode,
      deadlineEpochMs,
      chamberIndex,
      chamberTotal: CHAMBER_SEQUENCE.length,
      chamberType: type,
      chamberTitle: type ? CHAMBER_TITLES[type] : null,
      activeChamberId,
      roster: roster(),
      taunt,
      log,
    };
  };

  setHandler(getShellQuery, shell);
  setHandler(joinSignal, (operator) => {
    if (!players.has(operator)) {
      const role = ROLES[players.size % ROLES.length]; // auto-assign, round-robin
      players.set(operator, role);
      log.push(`${operator} joins as ${ROLE_LABEL[role]}.`);
    }
  });
  setHandler(setRoleSignal, ({ operator, role }) => {
    players.set(operator, role);
    log.push(`${operator} takes the role of ${ROLE_LABEL[role]}.`);
  });
  setHandler(startSignal, () => {
    started = true;
  });
  setHandler(playAgainSignal, () => {
    playAgain = true;
  });

  await condition(() => started && players.size > 0);
  deadlineEpochMs = Date.now() + args.durationMs;
  status = 'in_chamber';
  log.push('Lockdown engaged. Three chambers stand between you and freedom.');

  // Timed taunts: while a chamber runs, we race its completion against a recurring timer,
  // dripping new taunts into the shell state (which the client turns into pop-up dialogs).
  // Pure Temporal — no cron, no external scheduler. Keeping this in the main coroutine (rather
  // than a detached one) keeps command ordering deterministic alongside the child starts.
  let tauntIdx = 0;
  const emitTaunt = () => {
    taunt = { id: ++tauntSeq, text: TAUNTS[tauntIdx++ % TAUNTS.length] };
    log.push(`The Riddler: "${taunt.text}"`);
  };

  let failedType: (typeof CHAMBER_SEQUENCE)[number] | null = null;
  for (let i = 0; i < CHAMBER_SEQUENCE.length; i++) {
    chamberIndex = i;
    const type = CHAMBER_SEQUENCE[i];
    activeChamberId = `${args.caseCode}#r${round}c${i + 1}`;
    log.push(`Entering ${CHAMBER_TITLES[type]}…`);
    const handle = await startChild(chamberWorkflow, {
      workflowId: activeChamberId,
      args: [{ type, caseCode: args.caseCode, deadlineEpochMs, roster: roster(), reveal: args.reveal }],
    });
    const completion = handle.result();

    let result: ChamberResult | undefined;
    while (result === undefined) {
      const outcome = await Promise.race([
        completion.then((r) => ({ kind: 'done' as const, r })),
        sleep(TAUNT_INTERVAL_MS).then(() => ({ kind: 'taunt' as const })),
      ]);
      if (outcome.kind === 'done') result = outcome.r;
      else emitTaunt();
    }

    if (!result.cleared) {
      failedType = type;
      break;
    }
    log.push(`${CHAMBER_TITLES[type]} cleared.`);
  }

  activeChamberId = null;
  if (failedType) {
    status = 'failed';
    log.push(`${CHAMBER_TITLES[failedType]} was not cleared in time. The trap springs. ☠️`);
  } else {
    status = 'escaped';
    log.push('The final door slides open. The Bat-Family escapes into the Gotham night. 🦇');
  }

  // Offer a rematch. Wait for a play-again signal, then Continue-As-New: same workflowId
  // (case code / invite link unchanged), fresh event history, team carried over.
  const rematch = await condition(() => playAgain, '15m');
  if (rematch) {
    await continueAsNew<typeof escapeWorkflow>({
      caseCode: args.caseCode,
      durationMs: args.durationMs,
      reveal: args.reveal,
      seedRoster: roster(),
      autoStart: true,
      round: round + 1,
    });
  }
  return shell();
}

// ============================================================================
// CHILD: one chamber. Dispatches on type; each chamber teaches one primitive.
// ============================================================================
export async function chamberWorkflow(args: ChamberArgs): Promise<ChamberResult> {
  switch (args.type) {
    case 'riddle':
      return riddleChamber(args);
    case 'deathtrap':
      return deathtrapChamber(args);
    case 'escape':
      return escapeChamber(args);
  }
}

// --- Chamber 1: signals in / query out; the workflow holds a secret code ---
async function riddleChamber(args: ChamberArgs): Promise<ChamberResult> {
  const codeLength = 4;
  const digitMax = 6;
  const rng = mulberry32(hashSeed(workflowInfo().runId)); // deterministic, replay-safe
  const secret = Array.from({ length: codeLength }, () => 1 + Math.floor(rng() * digitMax));
  const guesses: Guess[] = [];
  let solved = false;
  const prompt =
    'Crack the 4-digit code (each digit 1–6). After each guess: ● = right digit in the right spot, ○ = right digit in the wrong spot.';
  const log: string[] = [
    'The Riddler: "A four-digit truth, each digit one to six. Guess, and I shall tell you how close you dance to death."',
  ];

  const state = (): ChamberState => ({
    type: 'riddle',
    title: CHAMBER_TITLES.riddle,
    cleared: solved,
    deadlineEpochMs: args.deadlineEpochMs,
    data: {
      kind: 'riddle',
      prompt,
      codeLength,
      digitMax,
      guesses,
      solved,
      answer: args.reveal ? secret : undefined,
    } as RiddleData,
    log,
  });
  setHandler(getChamberQuery, state);

  setHandler(chamberActionSignal, ({ operator, action, value }) => {
    if (solved || action !== 'guess') return;
    const digits = normalizeGuess(value, codeLength, digitMax);
    if (!digits) return;
    const { exact, partial } = scoreGuess(secret, digits);
    guesses.push({ by: operator, digits, exact, partial });
    log.push(`${operator} tried ${digits.join(' ')} → ${exact}● ${partial}○`);
    if (exact === codeLength) {
      solved = true;
      log.push(`${operator} cracked the code! The lock clicks open.`);
    }
  });

  const cleared = await condition(() => solved, args.deadlineEpochMs - Date.now());
  return { cleared };
}

// --- Chamber 2: saga — disarm in the right order, or compensation reverses it ---
async function deathtrapChamber(args: ChamberArgs): Promise<ChamberResult> {
  // All four wires are always live. Each is assigned to a hero; in a full party only that
  // hero may cut it, but if their role isn't present anyone may (keeps it solvable 1–4 players).
  const baseSteps: DeathtrapStep[] = [
    { id: 'coolant', label: 'Vent the coolant line', role: 'nightwing', engaged: false },
    { id: 'servo', label: 'Lock the servo arm', role: 'robin', engaged: false },
    { id: 'core', label: 'Ground the core capacitor', role: 'batman', engaged: false },
    { id: 'uplink', label: 'Sever the uplink', role: 'oracle', engaged: false },
  ];
  const present = new Set(args.roster.map((p) => p.role));
  const canAct = (operator: string, step: DeathtrapStep) => {
    const role = rosterRole(args.roster, operator);
    return role === step.role || !present.has(step.role);
  };

  const engaged = new Set<string>(); // insertion order == engage order
  let nextIndex = 0;
  let compensating = false;
  let disarmed = false;
  const pending: { operator: string; kind: 'disarm' | 'surge'; stepId?: string }[] = [];
  const log: string[] = [
    'The Riddler: "Cut my wires in order, in rhythm. One clumsy hand and the whole circuit surges back to life."',
  ];

  const steps = (): DeathtrapStep[] => baseSteps.map((s) => ({ ...s, engaged: engaged.has(s.id) }));
  const state = (): ChamberState => ({
    type: 'deathtrap',
    title: CHAMBER_TITLES.deathtrap,
    cleared: disarmed,
    deadlineEpochMs: args.deadlineEpochMs,
    data: { kind: 'deathtrap', steps: steps(), nextIndex, compensating, disarmed } as DeathtrapData,
    log,
  });
  setHandler(getChamberQuery, state);

  setHandler(chamberActionSignal, ({ operator, action, value }) => {
    if (disarmed || compensating) return;
    if (action === 'surge') {
      pending.push({ operator, kind: 'surge' });
    } else if (action === 'disarm') {
      const stepId = typeof value === 'string' ? value : (value as { stepId?: string })?.stepId;
      if (stepId) pending.push({ operator, kind: 'disarm', stepId });
    }
  });

  // Saga compensation: a mistake re-arms just the LAST wire you cut (one step back),
  // not the whole sequence — repeated mistakes walk you back toward the start.
  const compensate = async (reason: string) => {
    compensating = true;
    const last = [...engaged].pop();
    if (last) {
      await disengageMechanism(last);
      engaged.delete(last);
      nextIndex = engaged.size;
      log.push(`${reason} ${baseSteps.find((s) => s.id === last)?.label} snaps back — one step lost.`);
    } else {
      log.push(`${reason} You're still at the first wire.`);
    }
    pending.length = 0;
    await sleep('1200ms'); // brief beat, then resume
    compensating = false;
  };

  while (!disarmed) {
    const got = await condition(() => pending.length > 0, args.deadlineEpochMs - Date.now());
    if (!got) return { cleared: false }; // timed out
    const item = pending.shift()!;

    if (item.kind === 'surge') {
      await compensate(`${item.operator}'s hand slipped — the wire surged!`);
      continue;
    }

    const expected = baseSteps[nextIndex];
    const step = baseSteps.find((s) => s.id === item.stepId);
    if (!step) continue;

    if (step.id === expected.id && canAct(item.operator, expected)) {
      await engageMechanism(step.id);
      engaged.add(step.id);
      nextIndex++;
      log.push(`${item.operator} (${ROLE_LABEL[expected.role]}): ${expected.label}. [${nextIndex}/${baseSteps.length}]`);
      if (nextIndex === baseSteps.length) {
        disarmed = true;
        log.push('The deathtrap powers down. 🟢');
      }
    } else {
      const reason =
        step.id === expected.id && !canAct(item.operator, expected)
          ? `${item.operator} grabbed ${ROLE_LABEL[expected.role]}'s wire —`
          : `${item.operator} cut out of sequence —`;
      await compensate(reason);
    }
  }
  return { cleared: true };
}

// --- Chamber 3: activity retries/backoff, then a co-op simultaneous hold ---
async function escapeChamber(args: ChamberArgs): Promise<ChamberResult> {
  let phase: EscapeData['phase'] = 'override';
  let overrideStarted = false;
  let startOverride = false;
  let overrideAttempts: number | null = null;
  const holders = new Map<string, boolean>();
  const operators = [...new Set(args.roster.map((p) => p.operator))];
  const log: string[] = [
    'The Riddler: "The vault answers only to my machine. Override it — if it lets you — then hold the exit together, or die apart."',
  ];

  const state = (): ChamberState => ({
    type: 'escape',
    title: CHAMBER_TITLES.escape,
    cleared: phase === 'open',
    deadlineEpochMs: args.deadlineEpochMs,
    data: {
      kind: 'escape',
      phase,
      overrideStarted,
      overrideAttempts,
      holders: Object.fromEntries(holders),
      operators,
    } as EscapeData,
    log,
  });
  setHandler(getChamberQuery, state);

  setHandler(chamberActionSignal, ({ operator, action, value }) => {
    if (action === 'reboot' && !overrideStarted) {
      overrideStarted = true;
      startOverride = true;
      log.push(`${operator} initiates the vault override…`);
    }
    if (action === 'hold' && phase === 'hold') {
      holders.set(operator, Boolean(value));
    }
  });

  const started = await condition(() => startOverride, args.deadlineEpochMs - Date.now());
  if (!started) return { cleared: false };

  try {
    const res = await overrideVault(); // Temporal auto-retries the flaky activity
    overrideAttempts = res.attempts;
    log.push(`Vault override succeeded after ${res.attempts} attempts.`);
  } catch {
    log.push('Override permanently failed.');
    return { cleared: false };
  }

  phase = 'hold';
  log.push('Vault unlocked. All heroes: hold the exit together!');
  const allHold = () => operators.length > 0 && operators.every((op) => holders.get(op) === true);
  const escaped = await condition(allHold, args.deadlineEpochMs - Date.now());
  if (!escaped) return { cleared: false };

  phase = 'open';
  log.push('The exit seals behind you. Freedom. 🦇');
  return { cleared: true };
}

// --- pure helpers (deterministic; safe inside workflows) ---
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function scoreGuess(secret: number[], guess: number[]): { exact: number; partial: number } {
  let exact = 0;
  const sRem: number[] = [];
  const gRem: number[] = [];
  for (let i = 0; i < secret.length; i++) {
    if (secret[i] === guess[i]) exact++;
    else {
      sRem.push(secret[i]);
      gRem.push(guess[i]);
    }
  }
  let partial = 0;
  const used = new Array(sRem.length).fill(false);
  for (const g of gRem) {
    const idx = sRem.findIndex((s, j) => !used[j] && s === g);
    if (idx >= 0) {
      used[idx] = true;
      partial++;
    }
  }
  return { exact, partial };
}

function normalizeGuess(value: unknown, len: number, max: number): number[] | null {
  if (!Array.isArray(value) || value.length !== len) return null;
  const digits = value.map(Number);
  if (digits.some((d) => !Number.isInteger(d) || d < 1 || d > max)) return null;
  return digits;
}

function rosterRole(roster: Player[], operator: string): Role | undefined {
  return roster.find((p) => p.operator === operator)?.role;
}
