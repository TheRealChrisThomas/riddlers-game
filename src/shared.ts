// Types + Temporal signal/query definitions shared by the worker and the API.
// The web app keeps its own copy of these shapes in web/src/types.ts (synced by hand).
import { defineSignal, defineQuery } from '@temporalio/workflow';

export const TASK_QUEUE = 'gotham';

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

// --- Chambers ---
export type ChamberType = 'riddle' | 'deathtrap' | 'escape';
export const CHAMBER_SEQUENCE: ChamberType[] = ['riddle', 'deathtrap', 'escape'];
export const CHAMBER_TITLES: Record<ChamberType, string> = {
  riddle: 'The Riddle Lock',
  deathtrap: 'The Deathtrap',
  escape: 'The Final Escape',
};

// ============================================================================
// Parent workflow: escapeWorkflow (workflowId = case code)
// ============================================================================
export type EscapeStatus = 'lobby' | 'in_chamber' | 'escaped' | 'failed';

export interface ShellState {
  status: EscapeStatus;
  caseCode: string;
  deadlineEpochMs: number | null; // null until the escape actually starts
  chamberIndex: number; // 0-based index of the active/next chamber
  chamberTotal: number;
  chamberType: ChamberType | null;
  chamberTitle: string | null;
  activeChamberId: string | null; // workflowId of the running child chamber
  roster: Player[];
  taunt: { id: number; text: string } | null; // latest timed taunt from the Riddler
  log: string[];
}

export interface EscapeArgs {
  caseCode: string;
  durationMs: number;
  reveal?: boolean; // dev only: expose puzzle answers in queries
  seedRoster?: Player[]; // carried across Continue-As-New so "play again" keeps the team
  autoStart?: boolean; // skip the lobby on a rematch
  round?: number; // increments each Continue-As-New (keeps child workflowIds unique)
}

export const joinSignal = defineSignal<[string]>('join');
export const setRoleSignal = defineSignal<[{ operator: string; role: Role }]>('setRole');
export const startSignal = defineSignal<[]>('start');
export const playAgainSignal = defineSignal<[]>('playAgain');
export const getShellQuery = defineQuery<ShellState>('getShell');

// ============================================================================
// Child workflow: chamberWorkflow (one per room, spawned by the parent)
// ============================================================================
export interface ChamberArgs {
  type: ChamberType;
  caseCode: string;
  deadlineEpochMs: number; // shared absolute deadline across all chambers
  roster: Player[];
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

export type ChamberData = RiddleData | DeathtrapData | EscapeData;

export interface ChamberState {
  type: ChamberType;
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

export const chamberActionSignal = defineSignal<[ChamberAction]>('action');
export const getChamberQuery = defineQuery<ChamberState>('getChamber');
