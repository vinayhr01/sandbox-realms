/**
 * The fifteen creed rites of 11 section 3 (the rite table). Each rite is a dominion intrigue (intrigue.ts) that a dominion
 * may propose while its creed holds the rite's tenet (creeds.ts: the rite id is the tenet id, 11 section 4.2) and the
 * `rituals` rule is on. `cost` is the spec's money cost; the strength paid is `cost / RITE_COST_DIVISOR` (TUNE; strength is
 * the only pool a dominion has, see intrigue.ts INTRIGUE_COST). `category` is the spec's colour group (11 section 3).
 *
 * The spec's `progress` and `rate` are not modelled: a dominion intrigue resolves in the next yearly pass. `post` is
 * worldTransform on every rite: a creed can never hold a transformation tenet (locked, 11 section 9.4), so that step never
 * runs and is not built. `built` is false for a rite whose effect has no sim hook; those rites are never proposed.
 * Substitutions and reasons are in DECISIONS.md "Spells and rites close 14".
 */

export const RITE_KINDS = [
  'rendRite',
  'starfallRite',
  'thunderRite',
  'galeRite',
  'cinderRite',
  'pitRite',
  'dawnHostRite',
  'boneRite',
  'verdantRite',
  'vigorFeast',
  'wardRite',
  'dreadMistRite',
  'leadenRite',
  'discordRite',
  'ascendRite',
] as const;

export type RiteKind = (typeof RITE_KINDS)[number];

/** Colour group of a rite (11 section 3 categories; UI only). */
export type RiteCategory = 'wrath' | 'summon' | 'merciful' | 'various';

/** Where a rite's effect lands: an enemy hamlet, one of the caster's own hamlets, or the caster's own dominion. */
export type RiteTarget = 'enemyHamlet' | 'ownHamlet' | 'ownDominion';

export interface RiteDef {
  id: RiteKind;
  category: RiteCategory;
  /** Money cost of the spec table (11 section 3). */
  cost: number;
  target: RiteTarget;
  /** False when the sim has no effect for the rite: never proposed (see the header). */
  built: boolean;
}

/** Spec money cost to dominion strength: strength paid is cost / this (TUNE). */
export const RITE_COST_DIVISOR = 10;

export const RITE_TABLE: Readonly<Record<RiteKind, RiteDef>> = {
  rendRite: { id: 'rendRite', category: 'wrath', cost: 600, target: 'enemyHamlet', built: true },
  starfallRite: { id: 'starfallRite', category: 'wrath', cost: 1000, target: 'enemyHamlet', built: true },
  thunderRite: { id: 'thunderRite', category: 'wrath', cost: 500, target: 'enemyHamlet', built: true },
  galeRite: { id: 'galeRite', category: 'wrath', cost: 200, target: 'enemyHamlet', built: true },
  cinderRite: { id: 'cinderRite', category: 'wrath', cost: 300, target: 'enemyHamlet', built: true },
  pitRite: { id: 'pitRite', category: 'summon', cost: 300, target: 'enemyHamlet', built: true },
  dawnHostRite: { id: 'dawnHostRite', category: 'summon', cost: 200, target: 'ownDominion', built: true },
  boneRite: { id: 'boneRite', category: 'summon', cost: 150, target: 'ownDominion', built: true },
  // Crop plots become rootwardens: the sim has no crop-plot building conversion and no rootwarden species.
  verdantRite: { id: 'verdantRite', category: 'summon', cost: 400, target: 'enemyHamlet', built: false },
  vigorFeast: { id: 'vigorFeast', category: 'merciful', cost: 100, target: 'ownHamlet', built: true },
  wardRite: { id: 'wardRite', category: 'merciful', cost: 200, target: 'ownDominion', built: true },
  dreadMistRite: { id: 'dreadMistRite', category: 'wrath', cost: 600, target: 'enemyHamlet', built: true },
  leadenRite: { id: 'leadenRite', category: 'wrath', cost: 150, target: 'enemyHamlet', built: true },
  // An uprising is a Being-level intrigue; the sim has no Being-level intrigue engine (11 section 3 offer lottery).
  discordRite: { id: 'discordRite', category: 'wrath', cost: 400, target: 'enemyHamlet', built: false },
  // ascendRite is ascendClan, a Being-level clan change with no clan chief evolution in the sim.
  ascendRite: { id: 'ascendRite', category: 'various', cost: 100, target: 'ownDominion', built: false },
};

/** Strength each rite costs a dominion to propose (cost / RITE_COST_DIVISOR, TUNE). */
export const RITE_STRENGTH: Readonly<Record<RiteKind, number>> = Object.fromEntries(
  RITE_KINDS.map((id) => [id, Math.round(RITE_TABLE[id].cost / RITE_COST_DIVISOR)]),
) as Record<RiteKind, number>;

export function isRiteKind(id: string): id is RiteKind {
  return (RITE_KINDS as readonly string[]).includes(id);
}
