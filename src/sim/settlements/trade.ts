import type { Hamlet } from './hamlet.ts';

/**
 * Supply network (09 section 10.4): between hamlets of one dominion, a surplus moves to a deficit hamlet
 * on a fixed period. Ticks, not growth steps, set the period, so a save and load keeps the same rounds.
 * Simplification: the spec's custom requirement is not checked (customs are not built), and a hamlet
 * sends at most one transfer per round.
 */

/** Ticks between supply rounds (10.4 SUPPLY = 600 ticks; TUNE). */
export const SUPPLY_PERIOD = 600;
/** Units a giver sends per round (10.4 supplyGive 10), and the gold amount for gold (100). */
export const SUPPLY_GIVE = 10;
export const SUPPLY_GIVE_GOLD = 100;
/** A giver must hold more than this (supplyBoundGive 30), and gold more than 600. */
export const SUPPLY_BOUND_GIVE = 30;
export const SUPPLY_BOUND_GIVE_GOLD = 600;
/** A taker must hold less than this (supplyBoundTake 10 for every good, gold included). */
export const SUPPLY_BOUND_TAKE = 10;

/** Store fields the supply network moves. */
type Good = 'food' | 'wood' | 'stone' | 'gold';
const GOODS: readonly Good[] = ['food', 'wood', 'stone', 'gold'];

/**
 * One supply round when `tick` is a multiple of SUPPLY_PERIOD. `dominionOf` gives each hamlet's dominion id,
 * or 0 for none; transfers stay inside one dominion. Hamlets are visited in array (placement) order and
 * the first deficit hamlet in that order takes the goods. Draws no randomness.
 */
export function tradeStep(hamlets: readonly Hamlet[], dominionOf: (h: Hamlet) => number, tick: number): void {
  if (tick % SUPPLY_PERIOD !== 0) return;
  const groups = hamlets.map((h) => dominionOf(h));
  for (let i = 0; i < hamlets.length; i++) {
    const giver = hamlets[i];
    const group = groups[i] ?? 0;
    if (!giver || group === 0 || !giver.buildings.some((b) => b.def.id === 'larder')) continue;
    for (const good of GOODS) {
      const gold = good === 'gold';
      const bound = gold ? SUPPLY_BOUND_GIVE_GOLD : SUPPLY_BOUND_GIVE;
      if (giver[good] <= bound) continue;
      const j = hamlets.findIndex((o, k) => k !== i && groups[k] === group && o[good] < SUPPLY_BOUND_TAKE);
      const taker = hamlets[j];
      if (!taker) continue;
      const amount = gold ? SUPPLY_GIVE_GOLD : SUPPLY_GIVE;
      giver[good] -= amount;
      taker[good] += amount;
      break;
    }
  }
}
