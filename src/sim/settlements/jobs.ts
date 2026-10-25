import type { JobId } from './catalogue.ts';
import type { Hamlet } from './hamlet.ts';

/**
 * Citizen jobs (09 section 8, reduced). Workers are not saved: each growth step the job slots are rebuilt from the
 * hamlet's buildings, territory and stock (assignJobs), so a save-and-load run assigns the same workers. The slots are
 * handed out round-robin in QUOTA_ORDER, each job up to its cap (09 section 8 quota rebuild). Output goes to the hamlet
 * store (food, wood, stone, iron and gold); the territory jobs take their targets from the realm in hamlet.ts. The builder
 * and roadwright work the hamlet's site and road queue, which are saved (hamlet.ts, adapter.ts); the soldier line is in the
 * round, with its limit from the garrison rule (garrison-adapter.ts hamletSoldierLimit).
 */

/**
 * Every job the hamlet staffs: the building jobs of the catalogue plus the territory jobs (herbalist, prospector,
 * honey gatherer, tiller, cleaner, manure collector), the construction and road jobs, and the soldier posting.
 */
export type WorkerJob = JobId | 'herbalist' | 'prospector' | 'honey_gatherer' | 'tiller' | 'cleaner' | 'manure_collector' | 'builder' | 'roadwright' | 'soldier';

export interface JobDef {
  id: WorkerJob;
  /** Units per worker per growth step, before the mood multiplier (TUNE). Herbs picked or nodes broken for node jobs. */
  perWorker: number;
  /** Job priority (09 section 8 `priority`); higher fills first. 0: no priority, the job keeps its quota place. */
  priority: number;
  /** Priority used while the hamlet has no food in stock (09 section 8 `priorityNoFood`). 0: none. */
  priorityNoFood: number;
  /** False: a ruler may not take this job (09 section 8 `okForRuler`). */
  okForRuler: boolean;
  /** False: a leader may not take this job (09 section 8 `okForLeader`). The sim has no hamlet leader apart from the ruler. */
  okForLeader: boolean;
}

/** The folk of a hamlet, split for the job pass (09 section 8 `canWork`). Children (Being baby flag) do not work unless childLabour. */
export interface Workforce {
  /** Beings in the hamlet's parcels with the baby flag clear. */
  adults: number;
  /** Beings in the hamlet's parcels with the baby flag set. */
  children: number;
  /** The hamlet leader (adapter census: the oldest adult Folk in the hamlet), 0 or 1. Restricted by okForRuler and okForLeader. */
  leaders: number;
  /** The hamlet's custom lets children work (trait childLabour; 11 section 9.1). */
  childLabour: boolean;
}

/**
 * Site progress one builder adds per growth step (09 section 6 buildSpeed 2 x 25 work hits; TUNE). With the default
 * SITE_PROGRESS of 50, one builder finishes a site in two growth steps and three builders in one.
 */
export const BUILD_PER_BUILDER = 25;

/** Builders one site may take at once (09 section 8 builder cap 3). */
export const SITE_BUILDERS = 3;

/** Roadwrights a hamlet may staff at once (09 section 8 cap 1). */
export const ROADWRIGHT_CAP = 1;

/** Soldier slots a round adds (09 section 8 quota step 7: "soldier +2 up to floor(adults x armyFactor)"). */
export const SOLDIER_PER_ROUND = 2;

/** Coins a roadwright earns for each road tile laid (09 section 8 roadwright "1 coin"). */
export const ROAD_COINS = 1;

/**
 * Jobs with their unit yields and flags (09 section 8 table). Priorities: builder 9; forager, herbalist and honey gatherer
 * priorityNoFood 10. okForRuler and okForLeader are false for tiller, miner, iron miner and prospector. The soldier is not
 * in this list: its slots come from the round (assignJobs, SOLDIER_PER_ROUND). The quota order is QUOTA_ORDER below.
 */
export const JOBS: readonly JobDef[] = [
  { id: 'builder', perWorker: BUILD_PER_BUILDER, priority: 9, priorityNoFood: 0, okForRuler: true, okForLeader: true },
  { id: 'forager', perWorker: 2, priority: 0, priorityNoFood: 10, okForRuler: true, okForLeader: true },
  { id: 'herbalist', perWorker: 2, priority: 0, priorityNoFood: 10, okForRuler: true, okForLeader: true },
  { id: 'honey_gatherer', perWorker: 1, priority: 0, priorityNoFood: 10, okForRuler: true, okForLeader: true },
  { id: 'tiller', perWorker: 1, priority: 0, priorityNoFood: 0, okForRuler: false, okForLeader: false },
  { id: 'prospector', perWorker: 1, priority: 0, priorityNoFood: 0, okForRuler: false, okForLeader: false },
  { id: 'woodcutter', perWorker: 3, priority: 0, priorityNoFood: 0, okForRuler: true, okForLeader: true },
  { id: 'miner', perWorker: 2, priority: 0, priorityNoFood: 0, okForRuler: false, okForLeader: false },
  // The mine's job: one unit breaks one iron deposit node (DEPOSIT_YIELD iron) into the hamlet iron store.
  { id: 'iron_miner', perWorker: 1, priority: 0, priorityNoFood: 0, okForRuler: false, okForLeader: false },
  { id: 'roadwright', perWorker: 1, priority: 0, priorityNoFood: 0, okForRuler: true, okForLeader: true },
  { id: 'cleaner', perWorker: 1, priority: 0, priorityNoFood: 0, okForRuler: true, okForLeader: true },
  { id: 'manure_collector', perWorker: 1, priority: 0, priorityNoFood: 0, okForRuler: true, okForLeader: true },
];

/**
 * The round-robin order of the quota rebuild (09 section 8, "per-round order"): builder; forager, herbalist and honey
 * gatherer; tiller; prospector; woodcutter; miner (and the mine's iron miner); soldier; roadwright, cleaner, manure
 * collector. Each round adds one slot per folk job in this order while the job is under its cap. The soldier adds
 * SOLDIER_PER_ROUND slots and takes no folk (its soldiers come from dominion strength, see assignJobs).
 */
export const QUOTA_ORDER: readonly WorkerJob[] = [
  'builder',
  'forager',
  'herbalist',
  'honey_gatherer',
  'tiller',
  'prospector',
  'woodcutter',
  'miner',
  'iron_miner',
  'soldier',
  'roadwright',
  'cleaner',
  'manure_collector',
];

const JOB_BY_ID: ReadonlyMap<WorkerJob, JobDef> = new Map(JOBS.map((j) => [j.id, j]));

/** Effective priority of a job for a hamlet with `food` in stock: priorityNoFood while it has none, else priority. */
export function jobPriority(job: JobDef, food: number): number {
  return food > 0 ? job.priority : job.priorityNoFood || job.priority;
}

/**
 * Jobs in fill order for a hamlet with `food` in stock: highest effective priority first, then the quota order of
 * JOBS for equal priority (the sort is stable). The job pass and the yields both use this order.
 */
export function jobOrder(food: number): readonly JobDef[] {
  return JOBS.map((job, i) => ({ job, i, p: jobPriority(job, food) }))
    .sort((a, b) => b.p - a.p || a.i - b.i)
    .map((e) => e.job);
}

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
 * What a broken surface deposit gives the hamlet store (09 section 8 prospector, 10.1; TUNE). An iron deposit
 * gives 2 iron (10.1 "deposits (2)", read as the per-deposit yield; TUNE) into the hamlet iron store. Gem nodes
 * have no store in the sim, so prospectors leave them alone. Mines (iron_miner) break the same iron nodes.
 */
export const DEPOSIT_YIELD: ReadonlyMap<string, { stone: number; gold: number; iron: number }> = new Map([
  ['stone_outcrop', { stone: 2, gold: 0, iron: 0 }],
  ['gold_outcrop', { stone: 0, gold: 3, iron: 0 }],
  ['iron_outcrop', { stone: 0, gold: 0, iron: 2 }],
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
  /**
   * Soldier slots the garrison rule allows this hamlet now (garrison-adapter.ts hamletSoldierLimit: floor(adults x armyFactor)
   * plus the building bonus, 0 without `standing_armies` or at 15 adults or fewer). The soldier line of the round fills up to it.
   */
  soldierLimit: number;
  /** Herb plants in the hamlet's parcels. */
  herbs: number;
  /** Deposit nodes with a store (DEPOSIT_YIELD) in the hamlet's parcels. */
  deposits: number;
  /** Iron deposit nodes in the hamlet's parcels (the mine's iron miners break these). */
  ironDeposits: number;
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
 * Workers per job for the hamlet's current buildings, territory and stock. The slots come from the round-robin quota
 * (QUOTA_ORDER, each job up to its cap); the folk then fill them in QUOTA_ORDER, and nobody is assigned twice. Slots no
 * eligible folk fill stay empty and the rest of the folk stay idle (they still eat). Children join the pool only when the
 * custom allows it. The hamlet leader (leaders) fills only the jobs both okForRuler and okForLeader allow; other folk fill
 * any job.
 *
 * The soldier line (09 section 8 quota step 7) is part of the round: each round adds SOLDIER_PER_ROUND soldier slots up to
 * `targets.soldierLimit`. Soldiers are not folk: they come from the owner's dominion strength (garrison-adapter.ts), so the
 * soldier slots take nothing from `left`. The garrison pass reads the same limit (hamletSoldierLimit), so the round and the
 * ledger agree on how many soldiers the hamlet may keep.
 */
export function assignJobs(h: Hamlet, targets: JobTargetCounts, work: Workforce): Map<WorkerJob, number> {
  const capacity = new Map<WorkerJob, number>();
  for (const b of h.buildings) {
    for (const s of b.def.jobs ?? []) capacity.set(s.job, (capacity.get(s.job) ?? 0) + s.slots);
  }
  const food = foragerCap(h.food);
  // Quota caps (09 section 8): each job's cap, from its buildings, territory targets and stock.
  const cap: Record<WorkerJob, number> = {
    builder: h.site ? SITE_BUILDERS : 0,
    roadwright: h.road.length > 0 ? ROADWRIGHT_CAP : 0,
    soldier: Math.max(0, targets.soldierLimit),
    forager: Math.min(capacity.get('forager') ?? 0, food),
    herbalist: Math.min(targets.herbs, food),
    honey_gatherer: Math.min(targets.hives, food),
    tiller: Math.min(TILLER_CAP, targets.tillWork),
    miner: capacity.get('miner') ?? 0,
    iron_miner: Math.min(capacity.get('iron_miner') ?? 0, targets.ironDeposits),
    prospector: targets.deposits,
    woodcutter: Math.min(capacity.get('woodcutter') ?? 0, h.wood > WOOD_RICH ? 1 : 3),
    cleaner: targets.ruins,
    manure_collector: Math.min(MANURE_CAP, targets.manure),
  };
  const workers = new Map<WorkerJob, number>();
  // The census ran before this step's births and starvation, so folk beyond the adults are children (new births).
  const adults = Math.min(work.adults, h.folk);
  const children = h.folk - adults;
  const leaders = Math.min(work.leaders, adults);
  // Folk who can fill a slot: the adults, and the children when the custom lets children work (09 section 8 canWork).
  const pool = adults + (work.childLabour ? children : 0);
  // Quota rebuild (09 section 8): round-robin. Each round adds one slot to each folk job in QUOTA_ORDER that is under its cap
  // (while folk are left), and SOLDIER_PER_ROUND soldier slots at the soldier's place in the order (up to its limit). The
  // rounds run until a round adds nothing. Each folk slot takes one of `left`, so folk rounds stop after `pool` slots; the
  // soldier rounds stop at the limit, so the loop is bounded by pool + ceil(limit / SOLDIER_PER_ROUND) + 1 rounds.
  const slots = new Map<WorkerJob, number>();
  let left = pool;
  const maxRounds = pool + 1 + Math.ceil(cap.soldier / SOLDIER_PER_ROUND);
  for (let round = 0; round < maxRounds; round++) {
    let added = false;
    for (const id of QUOTA_ORDER) {
      const have = slots.get(id) ?? 0;
      if (id === 'soldier') {
        const n = Math.min(SOLDIER_PER_ROUND, cap.soldier - have);
        if (n > 0) {
          slots.set(id, have + n);
          added = true;
        }
        continue;
      }
      if (left <= 0 || have >= cap[id]) continue;
      slots.set(id, have + 1);
      left -= 1;
      added = true;
    }
    if (!added) break;
  }
  // Slots are filled from the common folk first; leaders (the hamlet leader, 1 at most) take only jobs both okForRuler and
  // okForLeader allow. A slot nobody eligible fills stays empty. The soldier slots are posted as they are: no folk fill them.
  let common = pool - leaders;
  let leaderPool = leaders;
  for (const id of QUOTA_ORDER) {
    const want = slots.get(id) ?? 0;
    if (want === 0) continue;
    if (id === 'soldier') {
      workers.set(id, want);
      continue;
    }
    const job = JOB_BY_ID.get(id);
    const restricted = !job || !(job.okForRuler && job.okForLeader);
    const fromCommon = Math.min(want, common);
    const fromLeaders = restricted ? 0 : Math.min(want - fromCommon, leaderPool);
    common -= fromCommon;
    leaderPool -= fromLeaders;
    const n = fromCommon + fromLeaders;
    if (n > 0) workers.set(id, n);
  }
  return workers;
}

/** Work-speed multiplier from hamlet mood (09 section 9 `0.9 + 0.2 x ratio`, ratio = (mood+100)/200). */
export function workMultiplier(mood: number): number {
  return 0.9 + 0.2 * ((mood + 100) / 200);
}
