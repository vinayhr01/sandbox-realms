import type { Dominion } from './types.ts';

/** Renown an army gains when its dominion defeats another dominion in a strength exchange (TUNE). */
export const ARMY_RENOWN_PER_DEFEAT = 1;

/**
 * A dominion's army (10 section 8, cut down): a record over the dominion's strength, not a second economy.
 * One army per dominion, and the army id is the dominion id. `soldiers` mirrors the dominion's strength;
 * the campaign strength exchange (step.ts) is the army's march.
 */
export interface Army {
  id: number;
  name: string;
  dominionId: number;
  soldiers: number;
  renown: number;
}

/**
 * Yearly raise: a dominion with strength and no army gets one. Keeps the list sorted by id.
 * Draws no randomness.
 */
export function raiseArmies(armies: Army[], dominions: readonly Dominion[]): void {
  for (const d of dominions) {
    if (d.strength > 0 && !armies.some((a) => a.id === d.id)) {
      armies.push({ id: d.id, name: `Army of Dominion ${d.id}`, dominionId: d.id, soldiers: d.strength, renown: 0 });
    }
  }
  armies.sort((x, y) => x.id - y.id);
}

/** Sets each army's soldiers to its dominion's strength (0 when the dominion is gone). */
export function syncArmies(armies: readonly Army[], dominions: readonly Dominion[]): void {
  const strength = new Map(dominions.map((d) => [d.id, d.strength]));
  for (const a of armies) a.soldiers = strength.get(a.dominionId) ?? 0;
}

/** Adds renown to the army of a dominion that won a strength exchange (ARMY_RENOWN_PER_DEFEAT). */
export function armyWon(armies: readonly Army[], dominionId: number): void {
  const army = armies.find((a) => a.dominionId === dominionId);
  if (army) army.renown += ARMY_RENOWN_PER_DEFEAT;
}
