/**
 * Pure rules of the custom traits (11 section 9.1) that the sim reads: succession order, opinion terms, craft weights,
 * and the war block. No sim, no rng, no imports of runtime modules, so dominions and items can read them freely.
 * The sim-touching effects are in effects.ts; custom-driven building rules are in settlements/custom-rules.ts.
 */
import type { ItemGroup } from '../../content/items.ts';

/** Succession rule of a dominion's custom (rulers.ts reads it). Without custom traits the rule is the base order. */
export interface SuccessionRule {
  /** Preferred sex of the ruler: 0 male (patriarchy), 1 female (matriarchy). Undefined: no preference. */
  sex?: 0 | 1;
  /** Youngest adult first (youngestFirst). The base order is oldest first. */
  youngest: boolean;
  /** Ordering stat, highest first, before age: rapport (envoyLine), valor (warLine), fame (fameLine). */
  stat?: 'rapport' | 'valor' | 'fame';
  /** unbrokenLine: when the capital has no successor, one may be taken from another hamlet of the dominion. */
  unbroken: boolean;
}

/** The succession rule of a trait list. Opposite traits are resolved by the catalogue (customs.ts), so the first match wins. */
export function successionRuleOf(traits: readonly string[]): SuccessionRule {
  const rule: SuccessionRule = { youngest: traits.includes('youngestFirst'), unbroken: traits.includes('unbrokenLine') };
  if (traits.includes('patriarchy')) rule.sex = 0;
  else if (traits.includes('matriarchy')) rule.sex = 1;
  if (traits.includes('envoyLine')) rule.stat = 'rapport';
  else if (traits.includes('warLine')) rule.stat = 'valor';
  else if (traits.includes('fameLine')) rule.stat = 'fame';
  return rule;
}

/** Opinion term for `insular` (-50 to other strains). */
export const INSULAR_OPINION = -50;
/** Opinion term for `welcoming` (+20 to the same strain). */
export const WELCOMING_OPINION = 20;
/** Opinion term for `kinGuard` (-50 to the same strain, other customs). */
export const KIN_GUARD_OPINION = -50;

/**
 * Opinion a dominion with these custom traits holds of another (11 section 9.1, 10 section 10). A dominion's strain is the
 * majority strain of its folk (dominions/adapter.ts). Unknown strains give no term. `insular` and `welcoming` are opposite
 * in the catalogue, so only one of them is in the list.
 */
export function opinionTerm(traits: readonly string[], strainA: number | undefined, strainB: number | undefined): number {
  if (strainA === undefined || strainB === undefined) return 0;
  const same = strainA === strainB;
  let sum = 0;
  if (traits.includes('insular') && !same) sum += INSULAR_OPINION;
  if (traits.includes('welcoming') && same) sum += WELCOMING_OPINION;
  if (traits.includes('kinGuard') && same) sum += KIN_GUARD_OPINION;
  return sum;
}

/** Whether a custom's traits stop its dominion from declaring a campaign (peaceable, serenity). */
export function blocksWar(traits: readonly string[]): boolean {
  return traits.includes('peaceable') || traits.includes('serenity');
}

/** Weapon group weights when `weaponLovers` is held (08 section 7.2 crafting weight: 10, bow 6). Other groups weigh 1. */
export function craftGroupWeights(traits: readonly string[]): Partial<Record<ItemGroup, number>> | undefined {
  if (!traits.includes('weaponLovers')) return undefined;
  return { blade: 10, cleaver: 10, maul: 10, pike: 10, bow: 6, staff: 1 };
}

/** The unique weapons and staffs a `craft` hamlet may build (08 section 6.2, the eight named in 11 section 9.1). */
export const CRAFT_UNIQUE_IDS: ReadonlySet<string> = new Set([
  'flame_maul',
  'frost_maul',
  'flame_blade',
  'ember_staff',
  'frost_staff',
  'thicket_staff',
  'bone_caller_staff',
  'plague_healer_staff',
]);

/** Extra crafting skill from `smithMastery` (11 section 9.1: +5), counted as extra mod rolls (craftSkill is the roll count). */
export const SMITH_SKILL = 5;
