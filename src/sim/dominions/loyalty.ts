/**
 * Hamlet loyalty (10 section 5): the sum of the terms the sim has. Pure: no sim, no rng. The caller reads the facts
 * (adapter.ts loyaltyStep). The cache and isHappy are here too (10 section 5, 09 section 4 checkLoyalty). Terms the sim
 * lacks are not here and are listed in DECISIONS.md "Loyalty terms close 8" and "Loyalty reader close 9": the rebellion
 * reader and uprising, the hamlet cap, the sea link, the leader's loyaltyMood and trait mod, the Age loyalty bonus, and
 * the strain `bond` modifier.
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
/** Young hamlet: age <= 15 years, (15 - age) x 5 (10 section 5). */
export const LOYALTY_YOUNG_HAMLET_YEARS = 15;
/** Young dominion: age <= 5 years, (5 - age) x 5 (10 section 5). */
export const LOYALTY_YOUNG_DOMINION_YEARS = 5;
export const LOYALTY_YOUNG_STEP = 5;
/** New conquest: years since the dominion's last capture <= 10, (10 - y) x 30 (10 section 5). */
export const LOYALTY_CONQUEST_YEARS = 10;
export const LOYALTY_CONQUEST_STEP = 30;
/** Belonging: years since the hamlet joined its dominion <= 10, (10 - y) x 10 (10 section 5). */
export const LOYALTY_BELONG_YEARS = 10;
export const LOYALTY_BELONG_STEP = 10;
/** Ruler tenure: 0 below 5 years, then the years, capped at 40 (10 section 5). */
export const LOYALTY_TENURE_MIN = 5;
export const LOYALTY_TENURE_CAP = 40;
/** Custom, dialect, creed and strain matches, same / different (10 section 5). */
export const LOYALTY_CUSTOM_SAME = 15;
export const LOYALTY_CUSTOM_DIFF = -25;
export const LOYALTY_DIALECT_SAME = 15;
export const LOYALTY_DIALECT_DIFF = -20;
export const LOYALTY_CREED_SAME = 15;
export const LOYALTY_CREED_DIFF = -30;
export const LOYALTY_STRAIN_SAME = 15;
export const LOYALTY_STRAIN_DIFF = -15;
/** Different lineage: -25, -5 under `welcoming`, -50 under `insular` (10 section 5). */
export const LOYALTY_LINEAGE_DIFF = -25;
export const LOYALTY_LINEAGE_WELCOMING = -5;
export const LOYALTY_LINEAGE_INSULAR = -50;
/** Clan of leader and ruler: same +30, else -20 (10 section 5). */
export const LOYALTY_CLAN_SAME = 30;
export const LOYALTY_CLAN_DIFF = -20;
/** Gender customs: a ruler of the wrong sex under patriarchy or matriarchy (10 section 5, 11 section 9.1). */
export const LOYALTY_RULER_SEX = -50;

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
  /** Whole years since the hamlet was founded (settlements foundedTick). Undefined in saves without it: no term. */
  hamletAge?: number | undefined;
  /** Whole years since the dominion was founded (foundedTick). Undefined in saves without it: no term. */
  dominionAge?: number | undefined;
  /** Whole years since the ruler was installed (rulerSinceTick). Undefined with no ruler or no record. */
  tenureYears?: number | undefined;
  /** Whole years since the dominion last took a hamlet (newConquestTick). Undefined until a capture. */
  conquestYears?: number | undefined;
  /** Whole years since this hamlet joined its dominion (dominionSinceTick). Undefined when not recorded. */
  belongYears?: number | undefined;
  /**
   * Matches against the hamlet's folk (the group each folk follows): true same, false different, undefined not compared
   * (the dominion has no custom, dialect or creed to compare, or the hamlet has no folk).
   */
  custom?: boolean | undefined;
  dialect?: boolean | undefined;
  creed?: boolean | undefined;
  /** Lineage (species) and main strain of the hamlet's folk against the dominion's folk. Undefined when a side has none. */
  lineage?: boolean | undefined;
  strain?: boolean | undefined;
  /** Custom trait ids of the dominion, read by the lineage term (`welcoming`, `insular`). */
  customTraits?: readonly string[] | undefined;
  /** Clan: true when the leader and the ruler share a strain that has a live clan, false when they share a strain with none. Undefined otherwise. */
  clan?: boolean | undefined;
  /** The ruler's sex is the wrong one for the dominion's succession rule (patriarchy or matriarchy). Undefined with no rule or no ruler. */
  rulerSexMismatch?: boolean | undefined;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Loyalty of a hamlet: the sum of its terms (10 section 5). `isHappy` (below) reads it. */
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
  if (f.hamletAge !== undefined && f.hamletAge <= LOYALTY_YOUNG_HAMLET_YEARS) sum += (LOYALTY_YOUNG_HAMLET_YEARS - f.hamletAge) * LOYALTY_YOUNG_STEP;
  if (f.dominionAge !== undefined && f.dominionAge <= LOYALTY_YOUNG_DOMINION_YEARS) sum += (LOYALTY_YOUNG_DOMINION_YEARS - f.dominionAge) * LOYALTY_YOUNG_STEP;
  if (f.conquestYears !== undefined && f.conquestYears <= LOYALTY_CONQUEST_YEARS) sum += (LOYALTY_CONQUEST_YEARS - f.conquestYears) * LOYALTY_CONQUEST_STEP;
  if (f.belongYears !== undefined && f.belongYears <= LOYALTY_BELONG_YEARS) sum += (LOYALTY_BELONG_YEARS - f.belongYears) * LOYALTY_BELONG_STEP;
  if (f.tenureYears !== undefined && f.tenureYears >= LOYALTY_TENURE_MIN) sum += Math.min(f.tenureYears, LOYALTY_TENURE_CAP);
  if (f.custom !== undefined) sum += f.custom ? LOYALTY_CUSTOM_SAME : LOYALTY_CUSTOM_DIFF;
  if (f.dialect !== undefined) sum += f.dialect ? LOYALTY_DIALECT_SAME : LOYALTY_DIALECT_DIFF;
  if (f.creed !== undefined) sum += f.creed ? LOYALTY_CREED_SAME : LOYALTY_CREED_DIFF;
  if (f.strain !== undefined) sum += f.strain ? LOYALTY_STRAIN_SAME : LOYALTY_STRAIN_DIFF;
  if (f.lineage === false) {
    const traits = f.customTraits ?? [];
    sum += traits.includes('insular') ? LOYALTY_LINEAGE_INSULAR : traits.includes('welcoming') ? LOYALTY_LINEAGE_WELCOMING : LOYALTY_LINEAGE_DIFF;
  }
  if (f.clan !== undefined) sum += f.clan ? LOYALTY_CLAN_SAME : LOYALTY_CLAN_DIFF;
  if (f.rulerSexMismatch) sum += LOYALTY_RULER_SEX;
  return sum;
}

/**
 * Loyalty cache (10 section 5): the sum is recomputed at most every LOYALTY_CACHE_TICKS ticks. TUNE: the 60 is the spec's
 * value, and section 10 says every number in it is TUNE.
 */
export const LOYALTY_CACHE_TICKS = 60;
/**
 * Period of the loyalty task (09 section 4 `checkLoyalty`, 10 section 15 "task every 40"). TUNE, as above. A hamlet is
 * recomputed at the first task at least LOYALTY_CACHE_TICKS after its last computation.
 */
export const LOYALTY_TASK_TICKS = 40;

/** A cached loyalty sum and the tick it was computed. Saved per hamlet (`hamletLoyalty`, adapter.ts). */
export interface LoyaltyCache {
  value: number;
  tick: number;
}

/** isHappy (10 section 5): a hamlet is happy when its loyalty is >= 0. */
export function isHappy(loyalty: number): boolean {
  return loyalty >= 0;
}

/** Whether a hamlet's cache is due at `tick`: no entry, or the entry is at least LOYALTY_CACHE_TICKS old. */
export function loyaltyDue(cache: LoyaltyCache | undefined, tick: number): boolean {
  return cache === undefined || tick - cache.tick >= LOYALTY_CACHE_TICKS;
}
