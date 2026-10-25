/**
 * Rebellion (10 section 11 uprising; 10 section 5 for candidacy). Pure: no sim, no rng. adapter.ts reads the facts of a
 * hamlet (rebelHooksOf), intrigue.ts runs the gate (uprisingOk) when it proposes and again when it resolves, and adapter.ts
 * applies the uprising. The cached loyalty (loyalty.ts isHappy, read by the adapter) is the candidacy's unhappy test.
 * See DECISIONS.md "Rebellion close 14".
 */

/** Hamlet leader level at least this (10 section 11, uprising: leader level 2). */
export const REBEL_LEADER_LEVEL = 2;
/** Leader stewardship and warfare at least these (11 section 3 intrigue table, uprising: stew 6, war 5). */
export const REBEL_STEWARDSHIP = 6;
export const REBEL_WARFARE = 5;
/** Hamlet soldiers at least this, and at least the capital's soldiers times (1 - REBEL_SOLDIER_SHARE x unhappy hamlets) (10 section 11). */
export const REBEL_MIN_SOLDIERS = 10;
export const REBEL_SOLDIER_SHARE = 0.1;
/** The dominion must be older than this many years (10 section 11). */
export const REBEL_DOMINION_YEARS = 15;
/** The dominion's hamlet count must be over this, or over its cap (10 section 11, "hamlets > 6 or > max"). */
export const REBEL_HAMLETS = 6;
/**
 * TUNE: stands in for the dominion's maxHamlets (10 section 3: lineage baseHamlets + ruler hamletBonus). The spec's default
 * baseHamlets is 5; the lineage mapping and the ruler bonus are not in the sim, so every dominion uses this value.
 */
export const REBEL_HAMLET_MAX = 5;

/** The hamlet leader's gate values. Stewardship and warfare include the creed harmony bonus (culture.ts harmonyBonus). */
export interface RebelLeaderFacts {
  level: number;
  stewardship: number;
  warfare: number;
  /** The leader is the dominion's ruler. A ruler cannot lead an uprising (10 section 11). */
  isRuler: boolean;
}

/** The facts of one hamlet's uprising gate, read by the adapter (adapter.ts rebelHooksOf). */
export interface UprisingFacts {
  /** The hamlet's cached loyalty is below 0 (loyalty.ts isHappy is false). False before the first computation. */
  unhappy: boolean;
  /** The hamlet is the dominion's capital. */
  isCapital: boolean;
  /** The dominion has a capital hamlet. */
  hasCapital: boolean;
  /** Hamlets the dominion holds. */
  hamlets: number;
  /** Whole years since the dominion was founded. Undefined in saves without the record: no candidacy. */
  dominionYears: number | undefined;
  /**
   * The dominion's custom holds `peaceable` or `serenity`. The sim's stand-in for the spec's pacifist block (10 section 11),
   * the same test that blocks a war declaration (culture/effects.ts warBlocked).
   */
  pacifist: boolean;
  /** An uprising campaign has this dominion as its main defender (campaigns.ts). */
  defendedAgainst: boolean;
  /** The hamlet leader. Undefined when the hamlet has none. */
  leader: RebelLeaderFacts | undefined;
  /** Soldiers garrisoned in the hamlet, and in the capital. */
  soldiers: number;
  capitalSoldiers: number;
  /** Unhappy hamlets of the dominion, this one included. */
  unhappyHamlets: number;
}

/**
 * Rebellion candidacy (10 section 5, section 11): an unhappy hamlet that is not the capital, in a dominion with a capital,
 * more than one hamlet, older than REBEL_DOMINION_YEARS, over the hamlet count of 6 or over the cap, and not held by a pacifist
 * custom or by a rebellion campaign whose main defender is this dominion. Draws no randomness.
 */
export function rebelCandidate(f: UprisingFacts): boolean {
  if (!f.unhappy || f.isCapital || !f.hasCapital) return false;
  if (f.hamlets <= 1) return false;
  if (f.dominionYears === undefined || f.dominionYears <= REBEL_DOMINION_YEARS) return false;
  if (!(f.hamlets > REBEL_HAMLETS || f.hamlets > REBEL_HAMLET_MAX)) return false;
  return !f.pacifist && !f.defendedAgainst;
}

/**
 * The uprising gate (10 section 11): a candidate hamlet whose leader is not the ruler, is at level REBEL_LEADER_LEVEL or more,
 * has stewardship and warfare at their minimums, and whose soldiers meet the share of the capital's (REBEL_MIN_SOLDIERS,
 * then the capital's soldiers times 1 - REBEL_SOLDIER_SHARE per unhappy hamlet). Draws no randomness.
 */
export function uprisingAllowed(f: UprisingFacts): boolean {
  if (!rebelCandidate(f) || f.leader === undefined) return false;
  const l = f.leader;
  if (l.isRuler || l.level < REBEL_LEADER_LEVEL || l.stewardship < REBEL_STEWARDSHIP || l.warfare < REBEL_WARFARE) return false;
  if (f.soldiers < REBEL_MIN_SOLDIERS) return false;
  return f.soldiers >= f.capitalSoldiers * (1 - REBEL_SOLDIER_SHARE * f.unhappyHamlets);
}
