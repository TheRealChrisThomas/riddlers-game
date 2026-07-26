// Temporal signal/query definitions for the worker and the API, layered on the
// wire protocol in ./protocol. The shapes themselves live there because the web
// app re-exports them (see web/src/types.ts) and must not pull in the Temporal
// SDK; everything in this file is server-side only.
//
// Server code can keep importing shapes from './shared' — they're re-exported.
import { defineSignal, defineQuery } from '@temporalio/workflow';
import type { BatcomputerState, ChamberAction, ChamberState, Role, ShellState, Villain } from './protocol';

export * from './protocol';

export const TASK_QUEUE = 'gotham';

// --- Bat-computer (grandparent): workflowId = case code ---
export const batSignal = defineSignal<[Villain]>('batSignal');
export const getBatcomputerQuery = defineQuery<BatcomputerState>('getBatcomputer');

// --- Adventure (parent): workflowId = <case>-<villain>-r<round> ---
export const joinSignal = defineSignal<[string]>('join');
export const setRoleSignal = defineSignal<[{ operator: string; role: Role }]>('setRole');
export const startSignal = defineSignal<[]>('start');
export const playAgainSignal = defineSignal<[]>('playAgain');
export const getShellQuery = defineQuery<ShellState>('getShell');

// --- Chamber (child): one per room ---
export const chamberActionSignal = defineSignal<[ChamberAction]>('action');
export const getChamberQuery = defineQuery<ChamberState>('getChamber');
