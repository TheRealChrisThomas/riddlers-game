// Mirror of the client-relevant shapes in ../../src/shared.ts (synced by hand).
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

// --- Villains / Bat-computer (mirror of src/shared.ts) ---
export type Villain = 'riddler' | 'twoface' | 'joker' | 'penguin';
export const VILLAINS: Villain[] = ['riddler', 'twoface', 'joker', 'penguin'];

export interface VillainMeta {
  id: Villain;
  name: string;
  tagline: string;
  concept: string;
  locked: boolean;
  glyph: string; // emoji shown on the case-file tile
  intro: string; // taunt spoken when the Bat-Signal fires (client-side flourish)
}
export const VILLAIN_META: Record<Villain, VillainMeta> = {
  riddler: {
    id: 'riddler',
    name: 'The Riddler',
    tagline: 'Three chambers. One clock.',
    concept: 'Parent + child workflows · kill & recover',
    locked: false,
    glyph: '?',
    intro: 'Riddle me this, Bat-Family… can you escape my three chambers before the clock kills you all?',
  },
  twoface: {
    id: 'twoface',
    name: 'Two-Face',
    tagline: 'Heads you live. Tails you die.',
    concept: 'Determinism · side-effects',
    locked: true,
    glyph: '⚖',
    intro: 'Let the coin decide, Bat-Family.',
  },
  joker: {
    id: 'joker',
    name: 'The Joker',
    tagline: 'Chaos, with a punchline.',
    concept: 'Retries · saga compensation',
    locked: true,
    glyph: '🃏',
    intro: 'Why so serious?',
  },
  penguin: {
    id: 'penguin',
    name: 'The Penguin',
    tagline: 'A heist on a timer.',
    concept: 'Durable timers · human-in-the-loop',
    locked: true,
    glyph: '🐧',
    intro: 'Right on schedule, Bat-Family. Waugh, waugh!',
  },
};

export type VillainStatus = 'idle' | 'running' | 'escaped' | 'failed';

export interface BatcomputerState {
  caseCode: string;
  roster: Player[];
  statuses: Record<Villain, VillainStatus>;
  activeVillain: Villain | null;
  activeAdventureId: string | null;
  score: number;
  solved: Villain[];
  round: number;
  log: string[];
}

export interface HubResponse {
  workerReachable: boolean;
  hub: BatcomputerState;
}

export type ChamberType = 'riddle' | 'deathtrap' | 'escape';
export type EscapeStatus = 'lobby' | 'in_chamber' | 'escaped' | 'failed';

export interface ShellState {
  status: EscapeStatus;
  caseCode: string;
  deadlineEpochMs: number | null;
  chamberIndex: number;
  chamberTotal: number;
  chamberType: ChamberType | null;
  chamberTitle: string | null;
  activeChamberId: string | null;
  roster: Player[];
  taunt: { id: number; text: string } | null;
  log: string[];
}

export interface Guess {
  by: string;
  digits: number[];
  exact: number;
  partial: number;
}
export interface RiddleData {
  kind: 'riddle';
  prompt: string;
  codeLength: number;
  digitMax: number;
  guesses: Guess[];
  solved: boolean;
  answer?: number[]; // dev only
}

export interface DeathtrapStep {
  id: string;
  label: string;
  role: Role;
  engaged: boolean;
}
export interface DeathtrapData {
  kind: 'deathtrap';
  steps: DeathtrapStep[];
  nextIndex: number;
  compensating: boolean;
  disarmed: boolean;
}

export interface EscapeData {
  kind: 'escape';
  phase: 'override' | 'hold' | 'open';
  overrideStarted: boolean;
  overrideAttempts: number | null;
  attempt?: number; // live retry attempt (API-injected)
  holders: Record<string, boolean>;
  operators: string[];
}

export type ChamberData = RiddleData | DeathtrapData | EscapeData;

export interface ChamberState {
  type: ChamberType;
  title: string;
  cleared: boolean;
  deadlineEpochMs: number;
  data: ChamberData;
  log: string[];
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
