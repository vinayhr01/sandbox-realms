/**
 * Taxation up to the dominion (10 section 6). Citizens pay `loot x taxLocal` to the hamlet leader; the leader pays
 * `received x taxTribute` to the ruler; the rest is split between the hamlet and the leader, the hamlet taking the
 * smaller half. Defaults 0.5 and 0.5; dominion traits set local and tribute to 0.7 (`highLocal`, `highTribute`) or 0.2
 * (`lowLocal`, `lowTribute`).
 *
 * What this build does with it (see DECISIONS.md, Dominions and culture release):
 * - Loot is the gold a hamlet gained since the previous yearly pass (settlements own hamlet gold; citizens carry no loot).
 * - There are no rulers or hamlet leaders as entities. The hamlet stands in for its leader, so the leader's share stays
 *   with the hamlet.
 * - Money does not move. The ruler's share is a receipt counted on the dominion (`taxRaised`), because hamlet gold belongs
 *   to the settlements slice, which dominions may not write.
 */

/** Local and tribute tax rates, defaults (10 section 6). */
export const TAX_DEFAULT = 0.5;
export const TAX_HIGH = 0.7;
export const TAX_LOW = 0.2;

/** Tax rates of a dominion from its traits (10 section 6). Opposite traits: the first listed one wins. */
export function taxRatesOf(traits: readonly string[] = []): { local: number; tribute: number } {
  const local = traits.includes('highLocal') ? TAX_HIGH : traits.includes('lowLocal') ? TAX_LOW : TAX_DEFAULT;
  const tribute = traits.includes('highTribute') ? TAX_HIGH : traits.includes('lowTribute') ? TAX_LOW : TAX_DEFAULT;
  return { local, tribute };
}

/** One tax split, in whole units. `toLeader` is what the leader receives; `toRuler` is what it passes up. */
export interface TaxSplit {
  toLeader: number;
  toRuler: number;
  hamletShare: number;
  leaderShare: number;
}

/**
 * The tax chain for one hamlet's loot (10 section 6). Floors at each step, so the parts add up to the loot.
 * Worked example: loot 100 at 0.5 and 0.5 gives 50 to the leader, 25 to the ruler, and the 25 left splits 12 to the
 * hamlet and 13 to the leader. Draws no randomness.
 */
export function taxSplit(loot: number, local: number, tribute: number): TaxSplit {
  const toLeader = Math.max(0, Math.floor(loot * local));
  const toRuler = Math.floor(toLeader * tribute);
  const rest = toLeader - toRuler;
  const hamletShare = Math.floor(rest / 2);
  return { toLeader, toRuler, hamletShare, leaderShare: rest - hamletShare };
}

/**
 * One hamlet's tax flow in one yearly pass (10 section 6). `anchor` is the hamlet's lowest parcel (the key `taxSeen`
 * uses), `dominion` the dominion holding most of its parcels (the one that receives `toRuler`). The shares add up:
 * `toRuler + hamletShare + leaderShare` is `toLeader`, and `toLeader` is at most `loot`. The adapter keeps the records of
 * the latest pass only; `taxRaised` on the dominion stays the cumulative total.
 */
export interface TaxFlow {
  anchor: number;
  dominion: number;
  tick: number;
  loot: number;
  toLeader: number;
  toRuler: number;
  hamletShare: number;
  leaderShare: number;
}

/** The tax flow record of one hamlet's loot (taxSplit, with the hamlet and dominion named). Draws no randomness. */
export function taxFlowOf(anchor: number, dominion: number, loot: number, rates: { local: number; tribute: number }, tick: number): TaxFlow {
  const split = taxSplit(loot, rates.local, rates.tribute);
  return { anchor, dominion, tick, loot, toLeader: split.toLeader, toRuler: split.toRuler, hamletShare: split.hamletShare, leaderShare: split.leaderShare };
}
