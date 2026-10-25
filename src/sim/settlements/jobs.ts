import type { JobId } from './catalogue.ts';
import type { Hamlet } from './hamlet.ts';

/**
 * Citizen jobs (09 section 8, reduced). Workers are not saved: each growth step the hamlet's folk fill
 * the job slots of its buildings in JOBS order, so a save-and-load run assigns the same workers.
 * Output goes to the hamlet store fields (food, wood, stone and gold).
 */
export interface JobDef {
  id: JobId;
  /** Store field the job's output goes to. */
  resource: 'food' | 'wood' | 'stone';
  /** Units per worker per growth step, before the mood multiplier (TUNE). */
  perWorker: number;
}

/** Priority order: food first, then stone, then wood (09 section 8 quota order, reduced). */
export const JOBS: readonly JobDef[] = [
  { id: 'forager', resource: 'food', perWorker: 2 },
  { id: 'miner', resource: 'stone', perWorker: 2 },
  { id: 'woodcutter', resource: 'wood', perWorker: 3 },
];

/** A miner pays one coin into the hamlet purse every this many growth steps (09 section 8 "+1 coin"; TUNE). */
export const MINER_COIN_STEPS = 5;

/** Woodcutter cap: one while the hamlet has more than this much wood, else three (09 section 8 quota). */
const WOOD_RICH = 15;

/** Forager cap by food stock (09 section 8 foodCap): more food, fewer foragers. */
export function foragerCap(food: number): number {
  if (food > 100) return 1;
  if (food > 60) return 4;
  if (food > 40) return 5;
  if (food <= 20) return 10;
  return 7;
}

/**
 * Workers per job for the hamlet's current buildings and stock. Folk fill slots in JOBS order and
 * nobody is assigned twice; the rest stay idle (they still eat).
 */
export function assignJobs(h: Hamlet): Map<JobId, number> {
  const capacity = new Map<JobId, number>();
  for (const b of h.buildings) {
    for (const s of b.def.jobs ?? []) capacity.set(s.job, (capacity.get(s.job) ?? 0) + s.slots);
  }
  const cap: Record<JobId, number> = {
    forager: Math.min(capacity.get('forager') ?? 0, foragerCap(h.food)),
    miner: capacity.get('miner') ?? 0,
    woodcutter: Math.min(capacity.get('woodcutter') ?? 0, h.wood > WOOD_RICH ? 1 : 3),
  };
  const workers = new Map<JobId, number>();
  let left = h.folk;
  for (const job of JOBS) {
    const n = Math.min(cap[job.id], left);
    if (n > 0) workers.set(job.id, n);
    left -= n;
  }
  return workers;
}

/** Work-speed multiplier from hamlet mood (09 section 9 `0.9 + 0.2 x ratio`, ratio = (mood+100)/200). */
export function workMultiplier(mood: number): number {
  return 0.9 + 0.2 * ((mood + 100) / 200);
}
