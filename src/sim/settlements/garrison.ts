/**
 * Garrison soldiers (09 section 8 soldier gate, 10 section 8 army). A hamlet with a built `garrison` keeps a company of
 * soldiers drawn from its dominion's strength. This file holds the constants and the timer rule only: no sim, no RNG.
 * The sim-touching part is garrison-adapter.ts.
 */

import { YEAR_TICKS } from '../../shared/constants.ts';

/** Soldiers a garrison holds at most (TUNE: the spec gives no company size). */
export const GARRISON_COMPANY = 5;
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

/** One hamlet's garrison: its owner when it last drew, the soldiers it holds, and the ticks until the next recruit. */
export interface GarrisonRecord {
  /** Hamlet index (hamlets are never removed, so the index is stable). */
  hamlet: number;
  /** Dominion the soldiers were drawn from (0 when the hamlet had no owner). */
  dominion: number;
  /** Soldiers held, 0 to GARRISON_COMPANY. */
  soldiers: number;
  /** Ticks until the next recruit may be drawn; at or below 0 the draw is attempted each second. */
  timer: number;
  /** Ticks until the next wage day (WAGE_PERIOD). Absent in saves written before wages: loads with a full period. */
  wage: number;
}

/** A garrison record as saved: `wage` is absent in saves written before wages. */
export type GarrisonSave = Omit<GarrisonRecord, 'wage'> & { wage?: number };
