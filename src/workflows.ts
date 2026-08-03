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
  ActiveChamber,
  BatcomputerArgs,
  BatcomputerState,
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
  SwitchboardData,
  VILLAIN_CHAMBERS,
  VILLAIN_META,
  VILLAINS,
  Villain,
  VillainStatus,
  chamberTitle,
  batSignal,
  chamberActionSignal,
  getBatcomputerQuery,
  getChamberQuery,
  getShellQuery,
  joinSignal,
  setRoleSignal,
} from './shared';

const ADVENTURE_SCORE = 100; // points banked for clearing a villain (placeholder; time-scale later)

const { engageMechanism, disengageMechanism, overrideVault } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10s',
  retry: { initialInterval: '500ms', backoffCoefficient: 2, maximumAttempts: 10 },
});

const TAUNT_INTERVAL_MS = 22_000;

// Server-side villain voice: the opening line, the lockdown line, and the timed
// taunts a workflow timer drips into the shell state. Client-side flavour (chamber
// intros, defeat, concession) lives in the web app's own registry.
interface VillainVoice {
  opening: string;
  lockdown: (waves: number) => string;
  taunts: string[];
}
const VILLAIN_VOICE: Record<Villain, VillainVoice> = {
  riddler: {
    opening:
      'The Riddler: "Riddle me this, Bat-Family… can you escape my three chambers before the clock kills you all?"',
    lockdown: (waves) => `Lockdown engaged. ${waves} chambers stand between you and freedom.`,
    taunts: [
      'Tick-tock, Bat-Family. The clock is such an impatient little thing.',
      'Struggling already? I do so love to watch a hero sweat.',
      "You're cleverer than the last ones. They didn't make it out either.",
      'Every second you waste, my walls grow a little closer.',
      "Riddle me this: what's worth more than time, when you have so little of it left?",
    ],
  },
  twoface: {
    opening: 'Two-Face: "Two rooms. Two truths. Neither of you can see both. Let\'s let the coin decide."',
    lockdown: () => 'The scales tip. Two rooms seal at once — and they are wired to each other.',
    taunts: [
      "Talk to each other. It won't save you, but I do enjoy the noise.",
      'Half of what you know is a lie. Care to guess which half?',
      'Harvey would give you a fair chance. Harvey is not in charge tonight.',
      'One room is running out of time faster than the other. I flipped for it.',
    ],
  },
  joker: { opening: '', lockdown: () => '', taunts: [] }, // sealed
  penguin: { opening: '', lockdown: () => '', taunts: [] }, // sealed
};

// ============================================================================
// GRANDPARENT: the Bat-computer. A long-lived, durable hub keyed on the case
// code. It gathers the Bat-Family, waits for a Bat-Signal (a Temporal signal!)
// naming a villain, launches that villain's adventure as a CHILD, banks the
// outcome into a score that survives forever, then Continue-As-News so its
// history stays bounded no matter how many adventures the team plays.
// ============================================================================
export async function batcomputerWorkflow(args: BatcomputerArgs): Promise<BatcomputerState> {
  const players = new Map<string, Role>();
  for (const p of args.seedRoster ?? []) players.set(p.operator, p.role);
  const statuses: Record<Villain, VillainStatus> =
    args.seedStatuses ?? { riddler: 'idle', twoface: 'idle', joker: 'idle', penguin: 'idle' };
  let score = args.seedScore ?? 0;
  const solved: Villain[] = [...(args.seedSolved ?? [])];
  const round = args.round ?? 1;
  // activeVillain / activeAdventureId track the running-OR-last adventure; both are carried
  // across Continue-As-New so the win/lose screen survives the fresh run.
  let activeVillain: Villain | null = args.activeVillain ?? null;
  let activeAdventureId: string | null = args.activeAdventureId ?? null;
  let pending: Villain | null = null; // a Bat-Signal waiting to be launched
  let launching = false; // guards against a second signal firing during the same run
  const log: string[] = args.seedLog ?? ['Bat-Computer online. Gather the Bat-Family, then light the signal.'];

  const roster = (): Player[] => [...players].map(([operator, role]) => ({ operator, role }));
  const state = (): BatcomputerState => ({
    caseCode: args.caseCode,
    roster: roster(),
    statuses,
    activeVillain,
    activeAdventureId,
    score,
    solved,
    round,
    log,
  });

  setHandler(getBatcomputerQuery, state);
  setHandler(joinSignal, (operator) => {
    if (!players.has(operator)) {
      const role = ROLES[players.size % ROLES.length]; // auto-assign, round-robin
      players.set(operator, role);
      log.push(`${operator} joins the Bat-Family as ${ROLE_LABEL[role]}.`);
    }
  });
  setHandler(setRoleSignal, ({ operator, role }) => {
    players.set(operator, role);
    log.push(`${operator} takes the role of ${ROLE_LABEL[role]}.`);
  });
  // The Bat-Signal itself: a Temporal signal that names the villain to face.
  setHandler(batSignal, (villain) => {
    if (launching) return; // this run already committed to an adventure
    if (!VILLAINS.includes(villain) || VILLAIN_META[villain].locked) {
      log.push(`That case file is sealed. ${VILLAIN_META[villain]?.name ?? villain} is not ready.`);
      return;
    }
    if (players.size === 0) {
      log.push('Assemble the Bat-Family before you light the signal.');
      return;
    }
    pending = villain;
  });

  // Wait (durably, indefinitely) for a Bat-Signal, then run exactly one adventure.
  await condition(() => pending !== null);
  const villain = pending!;
  pending = null;
  launching = true;
  activeVillain = villain;
  statuses[villain] = 'running';
  activeAdventureId = `${args.caseCode}-${villain}-r${round}`;
  log.push(`🦇 The Bat-Signal cuts the Gotham sky — the Bat-Family answers the call. Target: ${VILLAIN_META[villain].name}.`);

  const handle = await startChild(escapeWorkflow, {
    workflowId: activeAdventureId,
    args: [
      {
        villain,
        caseCode: args.caseCode,
        durationMs: args.durationMs,
        reveal: args.reveal,
        seedRoster: roster(),
        autoStart: true,
        round,
      },
    ],
  });
  const result = await handle.result(); // the adventure runs to a terminal state, then reports back

  if (result.status === 'escaped') {
    statuses[villain] = 'escaped';
    score += ADVENTURE_SCORE;
    if (!solved.includes(villain)) solved.push(villain);
    log.push(`${VILLAIN_META[villain].name} defeated. +${ADVENTURE_SCORE} to the Bat-Family. Total: ${score}.`);
  } else {
    statuses[villain] = 'failed';
    log.push(`${VILLAIN_META[villain].name} won this round. The case stays open.`);
  }

  // Continue-As-New: same caseCode (invite link unchanged), fresh history, everything
  // that matters — team, score, record, last adventure — carried forward.
  await continueAsNew<typeof batcomputerWorkflow>({
    caseCode: args.caseCode,
    durationMs: args.durationMs,
    reveal: args.reveal,
    seedRoster: roster(),
    seedStatuses: statuses,
    seedScore: score,
    seedSolved: solved,
    seedLog: log.slice(-12),
    activeAdventureId, // keep the finished adventure so its win/lose screen still shows
    activeVillain, // ditto — the villain that adventure belonged to
    round: round + 1,
  });
  return state(); // unreachable; satisfies the type checker
}

// ============================================================================
// PARENT (per adventure): spawns one child workflow per chamber, in order,
// sharing a single absolute deadline. Escape = all chambers cleared in time.
// Launched — seeded and auto-started — by the Bat-computer grandparent.
// ============================================================================
export async function escapeWorkflow(args: EscapeArgs): Promise<ShellState> {
  const players = new Map<string, Role>();
  for (const p of args.seedRoster ?? []) players.set(p.operator, p.role); // seeded by the Bat-computer
  const round = args.round ?? 1;
  const plan = VILLAIN_CHAMBERS[args.villain];
  const voice = VILLAIN_VOICE[args.villain];
  let status: ShellState['status'] = 'lobby';
  let deadlineEpochMs: number | null = null;
  let chamberIndex = 0; // wave index
  let chambers: ActiveChamber[] = [];
  let taunt: ShellState['taunt'] = null;
  let tauntSeq = 0;
  const log: string[] = [voice.opening];

  const roster = (): Player[] => [...players].map(([operator, role]) => ({ operator, role }));
  const shell = (): ShellState => ({
    status,
    caseCode: args.caseCode,
    villain: args.villain,
    deadlineEpochMs,
    chamberIndex,
    chamberTotal: plan.length,
    chambers,
    roster: roster(),
    taunt,
    log,
  });

  setHandler(getShellQuery, shell);

  // A sealed case file has no plan — refuse rather than "escape" for free.
  if (plan.length === 0) {
    status = 'failed';
    log.push('That case file is sealed. There is nothing here to escape.');
    return shell();
  }

  // Hub-launched: the roster is already seeded and the signal has been lit, so the
  // clock starts immediately. (Role assembly + replay both live on the Bat-computer.)
  deadlineEpochMs = Date.now() + args.durationMs;
  status = 'in_chamber';
  log.push(voice.lockdown(plan.length));

  // Timed taunts: while a chamber runs, we race its completion against a recurring timer,
  // dripping new taunts into the shell state (which the client turns into pop-up dialogs).
  // Pure Temporal — no cron, no external scheduler. Keeping this in the main coroutine (rather
  // than a detached one) keeps command ordering deterministic alongside the child starts.
  let tauntIdx = 0;
  const emitTaunt = () => {
    taunt = { id: ++tauntSeq, text: voice.taunts[tauntIdx++ % voice.taunts.length] };
    log.push(`${VILLAIN_META[args.villain].name}: "${taunt.text}"`);
  };

  let failedTitle: string | null = null;
  for (let wave = 0; wave < plan.length; wave++) {
    chamberIndex = wave;
    const slots = plan[wave];
    // Single-slot waves keep the original `CODE#r1c1` id shape; a mirrored wave
    // suffixes the side so both children get distinct, deterministic ids.
    const ids = slots.map(
      (s, j) => `${args.caseCode}#r${round}c${wave + 1}${slots.length > 1 ? `-${s.side ?? j + 1}` : ''}`,
    );
    chambers = slots.map((s, j) => ({
      id: ids[j],
      type: s.type,
      title: chamberTitle(s),
      side: s.side ?? null,
    }));
    log.push(`Entering ${chambers.map((c) => c.title).join(' and ')}…`);

    // startChild is awaited one at a time so command order stays deterministic;
    // the children still run concurrently once started.
    const handles = [];
    for (let j = 0; j < slots.length; j++) {
      handles.push(
        await startChild(chamberWorkflow, {
          workflowId: ids[j],
          args: [
            {
              type: slots[j].type,
              side: slots[j].side,
              caseCode: args.caseCode,
              deadlineEpochMs,
              roster: roster(),
              peerWorkflowId: slots.length === 2 ? ids[1 - j] : undefined,
              reveal: args.reveal,
            },
          ],
        }),
      );
    }
    // NOTE: Promise.all rejects if any child is cancelled rather than completing.
    // Nothing cancels a chamber yet; when something does, this needs to treat a
    // cancelled sibling as "sealed" instead of letting the rejection escape.
    const completion = Promise.all(handles.map((h) => h.result()));

    let results: ChamberResult[] | undefined;
    while (results === undefined) {
      const outcome = await Promise.race([
        completion.then((r) => ({ kind: 'done' as const, r })),
        sleep(TAUNT_INTERVAL_MS).then(() => ({ kind: 'taunt' as const })),
      ]);
      if (outcome.kind === 'done') results = outcome.r;
      else emitTaunt();
    }

    const missed = results.findIndex((r) => !r.cleared);
    if (missed >= 0) {
      failedTitle = chambers[missed].title;
      break;
    }
    log.push(`${chambers.map((c) => c.title).join(' and ')} cleared.`);
  }

  chambers = [];
  if (failedTitle) {
    status = 'failed';
    log.push(`${failedTitle} was not cleared in time. The trap springs. ☠️`);
  } else {
    status = 'escaped';
    log.push('The final door slides open. The Bat-Family escapes into the Gotham night. 🦇');
  }

  // Report the terminal state up to the Bat-computer, which banks the score and
  // owns replay (re-lighting the signal launches a fresh adventure run).
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
    case 'switchboard':
      return switchboardChamber(args);
  }
}

// --- Two-Face's mirrored rooms: placeholder until the case itself is built. ---
// Answers queries with a well-formed sealed board so the plumbing (parallel
// children, sided ids, per-side queries) can be exercised end to end.
async function switchboardChamber(args: ChamberArgs): Promise<ChamberResult> {
  const side = args.side ?? 'law';
  const log: string[] = ['This room is still sealed. Two-Face has not finished wiring it.'];
  setHandler(getChamberQuery, () => ({
    type: 'switchboard',
    side,
    title: chamberTitle({ type: 'switchboard', side }),
    cleared: false,
    deadlineEpochMs: args.deadlineEpochMs,
    data: { kind: 'switchboard', side, solved: false } as SwitchboardData,
    log,
  }));
  await condition(() => false, args.deadlineEpochMs - Date.now());
  return { cleared: false };
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
    side: null,
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
    side: null,
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
    side: null,
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
