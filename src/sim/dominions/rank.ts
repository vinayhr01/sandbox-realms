import { powerOf } from './opinion.ts';
import type { Dominion, Rank } from './types.ts';

/**
 * Dominion rank (10 section 4 rankTick, 10 section 5 "rank" loyalty term). Power is the spec formula of opinion.ts
 * (soldiers x 2 + hamlets x 5 + 1). The highest power is supreme, the second is second. Pure: no sim, no rng.
 */

/** Ticks between rank updates: the spec's every 40 ticks (10 section 4). Spec value. */
export const RANK_PERIOD_TICKS = 40;
/** Loyalty a supreme dominion's hamlets gain, once more than one dominion exists (10 section 5). Spec value. */
export const RANK_LOYALTY_SUPREME = 100;
/** Loyalty a second dominion's hamlets gain, once more than two dominions exist (10 section 5). Spec value. */
export const RANK_LOYALTY_SECOND = 50;

/**
 * Ranks the dominions by power: the highest is supreme, the second is second (ties go to the lower id). A realm with one
 * dominion ranks it supreme; with none the map is empty. `hamlets` is the hamlet count per dominion (absent counts as 0).
 */
export function rankDominions(dominions: readonly Dominion[], hamlets?: ReadonlyMap<number, number>): Map<number, Rank> {
  const ranked = [...dominions].sort((x, y) => powerOf(y, hamlets) - powerOf(x, hamlets) || x.id - y.id);
  const out = new Map<number, Rank>();
  const first = ranked[0];
  const second = ranked[1];
  if (first) out.set(first.id, 'supreme');
  if (second) out.set(second.id, 'second');
  return out;
}

/**
 * Loyalty term a rank gives the hamlets of its dominion (10 section 5): supreme +100 with more than one dominion, second
 * +50 with more than two, else 0. The rest of the loyalty sum (10 section 5) is not built, so nothing reads this yet.
 */
export function rankLoyalty(rank: Rank | undefined, dominionCount: number): number {
  if (rank === 'supreme') return dominionCount > 1 ? RANK_LOYALTY_SUPREME : 0;
  if (rank === 'second') return dominionCount > 2 ? RANK_LOYALTY_SECOND : 0;
  return 0;
}
