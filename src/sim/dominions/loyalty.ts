/**
 * Hamlet loyalty (10 section 5): the sum of the terms the sim has. Pure: no sim, no rng. The caller reads the facts
 * (adapter.ts loyaltyYearly). Terms the sim lacks are not here and are listed in DECISIONS.md "Culture founding close 6":
 * the loyalty stat and its readers (no rebellion), hamlet and dominion ages, the conquest and belonging ticks, ruler
 * tenure, the hamlet cap, the sea link, the custom, dialect, creed, lineage and strain matches, the leader's loyaltyMood,
 * and the gender customs.
 */
import { rankLoyalty } from './rank.ts';
import type { Rank } from './types.ts';

/** Loyalty of a capital hamlet (10 section 5: capital +1000). */
export const LOYALTY_CAPITAL = 1000;
/** Population term: clamp((pop - capitalPop) / 3, -30, 30). */
export const LOYALTY_POP_STEP = 3;
export const LOYALTY_POP_CLAMP = 30;
/** Parcel term: clamp((parcels - capitalParcels) / 20, -5, 5). */
export const LOYALTY_PARCEL_STEP = 20;
export const LOYALTY_PARCEL_CLAMP = 5;
/** Distance term: -dist / 10 (tiles). */
export const LOYALTY_DISTANCE_STEP = 10;
/** Adjacent-to-capital term (+20, not for the capital). */
export const LOYALTY_ADJACENT = 20;
/** Superior enemies term: clamp((enemy power - own power) / 2, 0, 50). */
export const LOYALTY_ENEMY_STEP = 2;
export const LOYALTY_ENEMY_CLAMP = 50;
/** Child ruler: a ruler under this age costs -50 (10 section 5). */
export const LOYALTY_CHILD_RULER_AGE = 18;
export const LOYALTY_CHILD_RULER = -50;

/** The facts of one hamlet's loyalty. A missing leader or ruler is left out (no term). */
export interface HamletLoyaltyFacts {
  /** Ruler skill: the ruler's rapport + 2 x husbandry (the spec's diplomacy + 2 x stewardship). 0 with no ruler. */
  ruler: number;
  /** Hamlet leader skill, the same formula. Undefined when the hamlet has no leader. */
  leader?: number | undefined;
  folk: number;
  parcels: number;
  capitalFolk: number;
  capitalParcels: number;
  isCapital: boolean;
  adjacentToCapital: boolean;
  /** Distance from the hamlet to the capital in tiles. */
  distance: number;
  /** Power of the dominion's enemies, and of the dominion itself (opinion.ts powerOf). */
  enemyPower: number;
  ownPower: number;
  /** Rank of the hamlet's dominion (rank.ts). */
  rank?: Rank | undefined;
  dominionCount: number;
  /** Age of the ruler in years. Undefined with no ruler. */
  rulerAge?: number | undefined;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Loyalty of a hamlet: the sum of its terms (10 section 5). `isHappy` is loyalty >= 0 (no reader yet). */
export function hamletLoyalty(f: HamletLoyaltyFacts): number {
  let sum = f.ruler;
  if (f.leader !== undefined) sum -= f.leader;
  if (f.isCapital) sum += LOYALTY_CAPITAL;
  sum += clamp((f.folk - f.capitalFolk) / LOYALTY_POP_STEP, -LOYALTY_POP_CLAMP, LOYALTY_POP_CLAMP);
  sum += clamp((f.parcels - f.capitalParcels) / LOYALTY_PARCEL_STEP, -LOYALTY_PARCEL_CLAMP, LOYALTY_PARCEL_CLAMP);
  sum -= f.distance / LOYALTY_DISTANCE_STEP;
  if (f.adjacentToCapital && !f.isCapital) sum += LOYALTY_ADJACENT;
  sum += clamp((f.enemyPower - f.ownPower) / LOYALTY_ENEMY_STEP, 0, LOYALTY_ENEMY_CLAMP);
  sum += rankLoyalty(f.rank, f.dominionCount);
  if (f.rulerAge !== undefined && f.rulerAge < LOYALTY_CHILD_RULER_AGE) sum += LOYALTY_CHILD_RULER;
  return sum;
}
