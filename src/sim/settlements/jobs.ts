import type { JobId } from './catalogue.ts';
import type { Hamlet } from './hamlet.ts';

/**
 * Citizen jobs (09 section 8, reduced). Workers are not saved: each growth step the hamlet's folk fill
 * the job slots of its buildings and of its territory in JOBS order, so a save-and-load run assigns the
 * same workers. Output goes to the hamlet store (food, wood, stone and gold); the territory jobs take
 * their targets from the realm in hamlet.ts.
 */

/**
 * Every job the hamlet staffs: the building jobs of the catalogue plus the territory jobs (herbalist, prospector,
 * honey gatherer, tiller, cleaner, manure collector).
 */
export type WorkerJob = JobId | 'herbalist' | 'prospector' | 'honey_gatherer' | 'tiller' | 'cleaner' | 'manure_collector';

export interface JobDef {
  id: WorkerJob;
  /** Units per worker per growth step, before the mood multiplier (TUNE). Herbs picked or nodes broken for node jobs. */
  perWorker: number;
}

/**
 * Priority order (09 section 8 quota order, reduced): food first (forager, herbalist, honey), then the fields, then
 * stone (miner, prospector), wood, and the upkeep jobs (cleaner, manure collector).
 */
export const JOBS: readonly JobDef[] = [
  { id: 'forager', perWorker: 2 },
  { id: 'herbalist', perWorker: 2 },
  { id: 'honey_gatherer', perWorker: 1 },
  { id: 'tiller', perWorker: 1 },
  { id: 'miner', perWorker: 2 },
  { id: 'prospector', perWorker: 1 },
  { id: 'woodcutter', perWorker: 3 },
  { id: 'cleaner', perWorker: 1 },
  { id: 'manure_collector', perWorker: 1 },
];

/** A miner pays one coin into the hamlet purse every this many growth steps (09 section 8 "+1 coin"; TUNE). */
export const MINER_COIN_STEPS = 5;

/** Food a picked herb adds to the store (09 section 10.1: herbs are a food, half a grain's nutrition; TUNE). */
export const HERB_FOOD = 1;

/** Food a taken honey adds to the store (09 section 8 honey gatherer: 1 honey; TUNE). */
export const HONEY_FOOD = 1;

/** Food a harvested grain adds to the store (09 section 10.1: grain 50 nutrition, TUNE). */
export const GRAIN_FOOD = 2;

/** Coins a tiller earns for each field made, planted or fertilised (09 section 8 "1 coin"). */
export const FIELD_COINS = 1;

/** Coins a cleaner earns per ruin removed (09 section 8 "1 coin"). */
export const CLEAN_COINS = 1;

/** Tillers the hamlet may staff at once (TUNE; 09 says one, a second when the age flag cropsGrow is set). */
export const TILLER_CAP = 2;

/** Manure collectors the hamlet may staff at once (09 section 8 cap 3). */
export const MANURE_CAP = 3;

/** Tilled tiles a hamlet may hold before its tillers stop making new fields (TUNE; the spec gives no field count). */
export const FIELD_MAX = 12;

/**
 * What a broken surface deposit gives the hamlet store (09 section 8 prospector, 10.1; TUNE). Iron and gem
 * nodes have no store in the sim (the hamlet holds no iron or gems), so prospectors leave them alone.
 */
export const DEPOSIT_YIELD: ReadonlyMap<string, { stone: number; gold: number }> = new Map([
  ['stone_outcrop', { stone: 2, gold: 0 }],
  ['gold_outcrop', { stone: 0, gold: 3 }],
]);

/** Woodcutter cap: one while the hamlet has more than this much wood, else three (09 section 8 quota). */
const WOOD_RICH = 15;

/** Forager cap by food stock (09 section 8 foodCap): more food, fewer foragers. Herbalists and honey gatherers share it. */
export function foragerCap(food: number): number {
  if (food > 100) return 1;
  if (food > 60) return 4;
  if (food > 40) return 5;
  if (food <= 20) return 10;
  return 7;
}

/** Territory targets counted for the job quotas (09 section 8 "up to the number of targets"). */
export interface JobTargetCounts {
  /** Herb plants in the hamlet's parcels. */
  herbs: number;
  /** Deposit nodes with a store (DEPOSIT_YIELD) in the hamlet's parcels. */
  deposits: number;
  /** Hives with honey built up in the hamlet's parcels. */
  hives: number;
  /** Tiller steps waiting: crops to harvest, empty tilled tiles to plant, and open ground to till. */
  tillWork: number;
  /** Ruins to clear in the hamlet's parcels. */
  ruins: number;
  /** Manure piles in the hamlet's parcels. */
  manure: number;
}

/**
 * Workers per job for the hamlet's current buildings, territory and stock. Folk fill slots in JOBS order and
 * nobody is assigned twice; the rest stay idle (they still eat).
 */
export function assignJobs(h: Hamlet, targets: JobTargetCounts): Map<WorkerJob, number> {
  const capacity = new Map<WorkerJob, number>();
  for (const b of h.buildings) {
    for (const s of b.def.jobs ?? []) capacity.set(s.job, (capacity.get(s.job) ?? 0) + s.slots);
  }
  const food = foragerCap(h.food);
  const cap: Record<WorkerJob, number> = {
    forager: Math.min(capacity.get('forager') ?? 0, food),
    herbalist: Math.min(targets.herbs, food),
    honey_gatherer: Math.min(targets.hives, food),
    tiller: Math.min(TILLER_CAP, targets.tillWork),
    miner: capacity.get('miner') ?? 0,
    prospector: targets.deposits,
    woodcutter: Math.min(capacity.get('woodcutter') ?? 0, h.wood > WOOD_RICH ? 1 : 3),
    cleaner: targets.ruins,
    manure_collector: Math.min(MANURE_CAP, targets.manure),
  };
  const workers = new Map<WorkerJob, number>();
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
