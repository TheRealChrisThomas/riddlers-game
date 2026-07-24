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
  shell: ShellState;
}
export interface ChamberResponse {
  workerReachable: boolean;
  chamber: ChamberState | null;
}

export interface TraceEvent {
  t: number;
  wf: 'case' | 'chamber';
  kind: string;
  detail: string;
}
