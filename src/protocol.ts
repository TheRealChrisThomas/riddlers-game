// ============================================================================
// The wire protocol: every shape the worker, the API and the web app agree on.
// This file is the single source of truth — the web app re-exports it from
// web/src/types.ts rather than keeping a copy, so a change here is a compile
// error on both sides instead of a silent drift.
//
// Nothing in here may import from @temporalio/* or from node: the browser
// bundles this file. Temporal signal/query definitions live in ./shared.
// ============================================================================

// --- Roles (Bat-Family) ---
export type Role = 'batman' | 'robin' | 'nightwing' | 'oracle';
export const ROLES: Role[] = ['batman', 'robin', 'nightwing', 'oracle'];
export const ROLE_LABEL: Record<Role, string> = {
  batman: 'Batman',
  robin: 'Robin',
  nightwing: 'Nightwing',
  oracle: 'Oracle',
};

export interface Player {
  operator: string;
  role: Role;
}

// ============================================================================
// Villains — the Bat-computer's case files. Each is (or will be) its own
// adventure workflow with a distinct Temporal concept as its headline lesson.
// Only the Riddler is unlocked today; the rest are sealed case files.
// ============================================================================
export type Villain = 'riddler' | 'twoface' | 'joker' | 'penguin';
export const VILLAINS: Villain[] = ['riddler', 'twoface', 'joker', 'penguin'];

export interface VillainMeta {
  id: Villain;
  name: string;
  tagline: string;
  concept: string; // the Temporal primitive this adventure teaches
  locked: boolean;
  glyph: string; // emoji shown on the case-file tile
}
export const VILLAIN_META: Record<Villain, VillainMeta> = {
  riddler: {
    id: 'riddler',
    name: 'The Riddler',
    tagline: 'Three chambers. One clock.',
    concept: 'Parent + child workflows · kill & recover',
    locked: false,
    glyph: '?',
  },
  twoface: {
    id: 'twoface',
    name: 'Two-Face',
    tagline: 'Heads you live. Tails you die.',
    concept: 'Determinism · side-effects',
    locked: true,
    glyph: '⚖',
  },
  joker: {
    id: 'joker',
    name: 'The Joker',
    tagline: 'Chaos, with a punchline.',
    concept: 'Retries · saga compensation',
    locked: true,
    glyph: '🃏',
  },
  penguin: {
    id: 'penguin',
    name: 'The Penguin',
    tagline: 'A heist on a timer.',
    concept: 'Durable timers · human-in-the-loop',
    locked: true,
    glyph: '🐧',
  },
};

// Per-villain progress tracked by the Bat-computer (grandparent workflow).
export type VillainStatus = 'idle' | 'running' | 'escaped' | 'failed';

// ============================================================================
// Chambers.
//
// A villain's adventure is a PLAN: an ordered list of *waves*, where every
// chamber inside a wave runs at the same time. So the shape of a case — children
// in sequence vs children in parallel — is data, not control flow:
//
//   riddler: [[riddle], [deathtrap], [escape]]   three waves of one → sequential
//   twoface: [[law, chaos]]                      one wave of two    → parallel
//
// `side` only matters when a wave holds more than one chamber of the same type:
// Two-Face's mirrored rooms are one chamber type seen from two sides.
// ============================================================================
export type ChamberType = 'riddle' | 'deathtrap' | 'escape' | 'switchboard';
export type ChamberSide = 'law' | 'chaos';
export const CHAMBER_SIDES: ChamberSide[] = ['law', 'chaos'];

export interface ChamberSlot {
  type: ChamberType;
  side?: ChamberSide;
}
export type ChamberPlan = ChamberSlot[][]; // waves, in order; each wave runs concurrently

export const CHAMBER_TITLES: Record<ChamberType, string> = {
  riddle: 'The Riddle Lock',
  deathtrap: 'The Deathtrap',
  escape: 'The Final Escape',
  switchboard: 'The Mirrored Switchboard',
};
// A sided chamber is titled by its side — the two rooms are not the same room.
export const CHAMBER_SIDE_TITLES: Record<ChamberSide, string> = {
  law: "Harvey's Ledger",
  chaos: 'The Scarred Switchboard',
};
export const chamberTitle = (slot: ChamberSlot): string =>
  slot.side ? CHAMBER_SIDE_TITLES[slot.side] : CHAMBER_TITLES[slot.type];

export const VILLAIN_CHAMBERS: Record<Villain, ChamberPlan> = {
  riddler: [[{ type: 'riddle' }], [{ type: 'deathtrap' }], [{ type: 'escape' }]],
  twoface: [[{ type: 'switchboard', side: 'law' }, { type: 'switchboard', side: 'chaos' }]],
  joker: [], // sealed
  penguin: [], // sealed
};

// ============================================================================
// Grandparent workflow: batcomputerWorkflow (workflowId = case code)
// Owns the team roster + cross-adventure score; launches one villain
// adventure at a time as a child, then Continue-As-News to stay alive with
// bounded history. Per team-session — the score belongs to the invite code.
// ============================================================================
export interface BatcomputerState {
  caseCode: string;
  roster: Player[];
  statuses: Record<Villain, VillainStatus>;
  activeVillain: Villain | null;
  activeAdventureId: string | null; // workflowId of the running/last adventure child
  score: number; // persists across adventures and Continue-As-New
  solved: Villain[];
  round: number; // increments each Continue-As-New (keeps child workflowIds unique)
  log: string[];
}

export interface BatcomputerArgs {
  caseCode: string;
  durationMs: number;
  reveal?: boolean;
  // carried across Continue-As-New so score/record/team survive:
  seedRoster?: Player[];
  seedStatuses?: Record<Villain, VillainStatus>;
  seedScore?: number;
  seedSolved?: Villain[];
  seedLog?: string[];
  activeAdventureId?: string | null;
  activeVillain?: Villain | null; // carried so the win/lose screen survives Continue-As-New
  round?: number;
}

// ============================================================================
// Parent workflow: adventureWorkflow (workflowId = <case>-<villain>-r<round>)
// Launched as a child of the Bat-computer. Runs the villain's chambers.
// ============================================================================
export type EscapeStatus = 'lobby' | 'in_chamber' | 'escaped' | 'failed';

// One live chamber inside the current wave. A single-chamber wave (the Riddler)
// has exactly one of these; Two-Face's mirrored wave has two.
export interface ActiveChamber {
  id: string; // workflowId of the running child chamber
  type: ChamberType;
  title: string;
  side: ChamberSide | null;
}

export interface ShellState {
  status: EscapeStatus;
  caseCode: string;
  villain: Villain; // which case this is, so the client doesn't need telling out of band
  deadlineEpochMs: number | null; // null until the escape actually starts
  chamberIndex: number; // 0-based index of the active/next WAVE
  chamberTotal: number; // number of waves in this villain's plan
  chambers: ActiveChamber[]; // live chambers in the current wave (empty between waves)
  roster: Player[];
  taunt: { id: number; text: string } | null; // latest timed taunt from the villain
  scoreAward?: number; // set on a terminal state to override the hub's default award
  log: string[];
}

export interface EscapeArgs {
  villain: Villain; // which adventure this is (chamber content is Riddler-only for now)
  caseCode: string;
  durationMs: number;
  reveal?: boolean; // dev only: expose puzzle answers in queries
  seedRoster?: Player[]; // team seeded by the Bat-computer at launch
  autoStart?: boolean; // hub-launched adventures skip the lobby
  round?: number; // keeps child chamber workflowIds unique across replays
}

// ============================================================================
// Child workflow: chamberWorkflow (one per room, spawned by the parent)
// ============================================================================
export interface ChamberArgs {
  type: ChamberType;
  side?: ChamberSide; // set for sided chambers (Two-Face's mirrored rooms)
  caseCode: string;
  deadlineEpochMs: number; // shared absolute deadline across all chambers
  roster: Player[];
  // The sibling sharing this wave, if any. Coupled chambers signal each other
  // directly through an external workflow handle rather than via the parent.
  peerWorkflowId?: string;
  reveal?: boolean; // dev only
}

export interface ChamberResult {
  cleared: boolean;
}

// Chamber 1 — riddle / code-cracker
export interface Guess {
  by: string;
  digits: number[];
  exact: number; // right digit, right position
  partial: number; // right digit, wrong position
}
export interface RiddleData {
  kind: 'riddle';
  prompt: string;
  codeLength: number;
  digitMax: number;
  guesses: Guess[];
  solved: boolean;
  answer?: number[]; // dev only: present when REVEAL_CODE is set
}

// Chamber 2 — deathtrap / saga + compensation
export interface DeathtrapStep {
  id: string;
  label: string;
  role: Role;
  engaged: boolean;
}
export interface DeathtrapData {
  kind: 'deathtrap';
  steps: DeathtrapStep[]; // in required order
  nextIndex: number;
  compensating: boolean;
  disarmed: boolean;
}

// Chamber 3 — final escape / activity retries + co-op hold
export interface EscapeData {
  kind: 'escape';
  phase: 'override' | 'hold' | 'open';
  overrideStarted: boolean;
  overrideAttempts: number | null;
  attempt?: number; // live retry attempt, injected by the API from pending-activity state
  holders: Record<string, boolean>;
  operators: string[];
}

// Two-Face chamber — one side of the mirrored switchboard. Fleshed out with the
// switch/constraint board when the case itself is built; this is the shape the
// sealed placeholder answers with today.
export interface SwitchboardData {
  kind: 'switchboard';
  side: ChamberSide;
  solved: boolean;
}

export type ChamberData = RiddleData | DeathtrapData | EscapeData | SwitchboardData;

export interface ChamberState {
  type: ChamberType;
  side: ChamberSide | null;
  title: string;
  cleared: boolean;
  deadlineEpochMs: number;
  data: ChamberData;
  log: string[];
}

export interface ChamberAction {
  operator: string;
  action: 'guess' | 'disarm' | 'surge' | 'reboot' | 'hold';
  value?: unknown;
}

// ============================================================================
// HTTP envelopes. `workerReachable: false` means the API answered from its own
// cache because the Temporal worker was down — the board is stale but the
// workflow is untouched, which is the whole point of the demo.
// ============================================================================
export interface HubResponse {
  workerReachable: boolean;
  hub: BatcomputerState;
}

export interface ShellResponse {
  workerReachable: boolean;
  shell: ShellState | null; // null when no adventure is active on the Bat-computer
}

export interface ChamberResponse {
  workerReachable: boolean;
  chamber: ChamberState | null;
}

export interface TraceEvent {
  t: number;
  wf: 'hub' | 'case' | 'chamber';
  kind: string;
  detail: string;
}

export interface TraceResponse {
  events: TraceEvent[];
}
