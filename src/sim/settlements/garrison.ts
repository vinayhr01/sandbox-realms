/**
 * Garrison soldiers (09 section 8 soldier gate, 10 section 8 army). A hamlet with a built `garrison` keeps a company of
 * soldiers drawn from its dominion's strength. This file holds the constants and the timer rule only: no sim, no RNG.
 * The sim-touching part is garrison-adapter.ts.
 */

import { YEAR_TICKS } from '../../shared/constants.ts';

/** Adults a hamlet needs before it has any soldier slot (09 section 8 acceptance: slots 0 while adults <= 15). */
export const ARMY_ADULTS_MIN = 15;
/** Base share of adults that may serve (09 section 8: `lineage.armyBase(0.35)`; the lineage default is the spec value). */
export const ARMY_BASE = 0.35;
/** Leader army bonus in `armyFactor` (09 section 8). The sim has no hamlet leader entity, so the term is 0 (TUNE). */
export const LEADER_ARMY_BONUS = 0;
/** Soldier timer after a release over the soldier limit, in ticks (09 section 8: `timers.soldier = 600`, not halved). */
export const SOLDIER_OVER_LIMIT_TIMER = 600;
/** Hamlet gold above which a soldier may be recruited (09 section 8 soldier gate: gold > 10). */
export const SOLDIER_GOLD_GATE = 10;
/** Soldier timer before a recruit, in ticks (09 section 8: 300 - leader.warfare x 10). */
export const SOLDIER_TIMER_BASE = 300;
/** Lowest soldier timer after the warfare term (09 section 8: floor 20). */
export const SOLDIER_TIMER_FLOOR = 20;
/** Leader warfare used in the timer. The sim has no leader model, so the term is 0 (TUNE). */
export const LEADER_WARFARE = 0;
/** Gold a recruit costs, paid from the hamlet purse when the soldier is drawn (TUNE: the spec gives no recruit cost). */
export const RECRUIT_COST_GOLD = 4;
/** Gold per garrisoned soldier per year, paid from the hamlet purse (TUNE: the spec gives no wage). */
export const SOLDIER_WAGE_GOLD = 2;
/** Ticks between wage days: one sim year (TUNE: the spec gives no pay period). */
export const WAGE_PERIOD = YEAR_TICKS;

/**
 * Soldier timer in ticks (09 section 8): `300 - warfare x 10`, floor 20, and halved while the hamlet has a garrison.
 * The halving is the spec's garrison rule; the floor applies before it.
 */
export function soldierTimer(warfare: number, garrison: boolean): number {
  const base = Math.max(SOLDIER_TIMER_FLOOR, SOLDIER_TIMER_BASE - warfare * 10);
  return garrison ? Math.floor(base / 2) : base;
}

/** Army slots a built garrison adds to its hamlet (18c garrison row "Raises army slots"; the number is not in the spec, TUNE). */
export const GARRISON_SLOT_BONUS = 2;
/** Army slots a built bastion adds to its hamlet (18e bastion row: +10 army slots). Spec value. */
export const BASTION_SLOT_BONUS = 10;

/**
 * Army slots that the buildings of a hamlet add (18c garrison, 18e bastion). Both are one per hamlet, so presence is the test.
 * `buildingIds` are the ids of the hamlet's finished buildings.
 */
export function buildingSlotBonus(buildingIds: readonly string[]): number {
  let bonus = 0;
  if (buildingIds.includes('garrison')) bonus += GARRISON_SLOT_BONUS;
  if (buildingIds.includes('bastion')) bonus += BASTION_SLOT_BONUS;
  return bonus;
}

/**
 * Soldier slots of a hamlet (09 section 8 quota, acceptance 6): `floor(adults x armyFactor)` with
 * `armyFactor = ARMY_BASE + leader.armyBonus + leader.warfare x 0.02`, plus `buildingSlots` (buildingSlotBonus), and 0 while
 * adults <= ARMY_ADULTS_MIN (the spec's "0 slots" rule covers the building bonuses too). The rule `standing_armies` is
 * checked by the caller. Pure: no sim, no RNG.
 */
export function soldierSlots(adults: number, warfare: number, armyBonus: number, buildingSlots = 0): number {
  if (adults <= ARMY_ADULTS_MIN) return 0;
  return Math.floor(adults * (ARMY_BASE + armyBonus + warfare * 0.02)) + buildingSlots;
}

/** One hamlet's garrison: its owner when it last drew, the soldiers it holds, and the ticks until the next recruit. */
export interface GarrisonRecord {
  /** Hamlet index (hamlets are never removed, so the index is stable). */
  hamlet: number;
  /** Dominion the soldiers were drawn from (0 when the hamlet had no owner). */
  dominion: number;
  /** Soldiers held, 0 up to the hamlet's soldier slots (soldierSlots). A save over the limit is released by the next pass. */
  soldiers: number;
  /** Ticks until the next recruit may be drawn; at or below 0 the draw is attempted each second. */
  timer: number;
  /** Ticks until the next wage day (WAGE_PERIOD). Absent in saves written before wages: loads with a full period. */
  wage: number;
}

/** A garrison record as saved: `wage` is absent in saves written before wages. */
export type GarrisonSave = Omit<GarrisonRecord, 'wage'> & { wage?: number };
