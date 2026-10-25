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

/** Xp multiplier of `swiftStudy` (11 section 9.1: xp x2). Applies to every xp gain of the holder's custom. */
export const SWIFT_STUDY_MULT = 2;
/** Xp each talker gets from a good chat when either custom holds `mentorTrade` (11 section 4.4: +10 xp both). */
export const MENTOR_XP = 10;
/** Xp per level (TUNE). Reaching level L + 1 costs XP_PER_LEVEL x (L + 1) xp. */
export const XP_PER_LEVEL = 100;
/** Book xp multiplier of `eagerReaders` (11 section 9.1: x(1 + value 2) = x3, fixed). */
export const EAGER_READER_MULT = 3;
/** Vitality ratio below which a civil attacker or a weak target counts for `convertOrElse` (11 section 9.1: 30%). */
export const CONVERT_HP_RATIO = 0.3;
/** Chance a defeated weak non-mind target defects under `convertOrElse` (11 section 9.1: 30%). */
export const CONVERT_CHANCE = 0.3;
/** Extra tower limit of `towerPride` (11 section 9.1: +4). Read by the watchspire limit (settlements/custom-rules.ts). */
export const TOWER_PRIDE_BONUS = 4;

/** Xp after the holder's study traits (swiftStudy doubles it). */
export function xpGain(traits: readonly string[], amount: number): number {
  return traits.includes('swiftStudy') ? amount * SWIFT_STUDY_MULT : amount;
}

/** Levels added by one level-up (deepTraining grants an extra level: 2 instead of 1). */
export function levelsPerLevelUp(traits: readonly string[]): number {
  return traits.includes('deepTraining') ? 2 : 1;
}

/** Mood of a book for a reader: under `bookLovers` a negative mood reads as positive (11 section 5). */
export function readingMood(traits: readonly string[], mood: number): number {
  return mood < 0 && traits.includes('bookLovers') ? -mood : mood;
}

/** Xp a reader gains from a book under `eagerReaders` (x3). */
export function readingXp(traits: readonly string[], xp: number): number {
  return traits.includes('eagerReaders') ? xp * EAGER_READER_MULT : xp;
}

/** Whether a custom holds `keepers`: it cannot divide, schism or diverge (11 section 9.1). */
export function blocksSplit(traits: readonly string[]): boolean {
  return traits.includes('keepers');
}

/** Split preconditions (11 section 2, TUNE: 200 members and 100 years in compact worlds). */
export const SPLIT_PEOPLE = 1000;
export const SPLIT_YEARS = 500;
/** The actor must lead a hamlet at this level or above (11 section 2). */
export const SPLIT_LEVEL = 5;

/** Facts a divide, schism or divergence needs (11 section 2 preconditions); the caller reads them from the sim. */
export interface SplitFacts {
  traits: readonly string[];
  /** Living members of the meta. */
  members: number;
  /** Age of the meta in years. */
  ageYears: number;
  /** Level of the actor, a hamlet leader. */
  leaderLevel: number;
  /** Hamlets of the actor's dominion (a multi-hamlet dominion is needed). */
  dominionHamlets: number;
  /** True when the meta is the dominion's own meta. */
  sameMeta: boolean;
  /** True when the meta's creator dominion or clan differs from the actor's. */
  creatorDiffers: boolean;
}

/**
 * Whether a meta may divide, schism or diverge (11 section 2): keepers blocks it, and so does any failed precondition.
 * Pure: the split intrigues call it through intrigue.ts splitOk (DECISIONS.md, "Dominions close 5"). Draws no rng.
 */
export function splitAllowed(f: SplitFacts): boolean {
  if (blocksSplit(f.traits)) return false;
  return (
    f.members >= SPLIT_PEOPLE &&
    f.ageYears >= SPLIT_YEARS &&
    f.leaderLevel >= SPLIT_LEVEL &&
    f.dominionHamlets > 1 &&
    f.sameMeta &&
    f.creatorDiffers
  );
}

/** Members a custom needs before its group may found a creed (11 section 3, newCreed: custom >= 50 members). */
export const FOUND_CREED_MEMBERS = 50;
/** Level of the actor for newDialect (11 section 3: level 1). */
export const FOUND_DIALECT_LEVEL = 1;
/** Intelligence of the actor for newDialect (11 section 3: int 3). */
export const FOUND_DIALECT_INTELLIGENCE = 3;
/** Level of the actor for newCreed (11 section 3: level 5). */
export const FOUND_CREED_LEVEL = 5;
/** Intelligence of the actor for newCreed (11 section 3: int 8). */
export const FOUND_CREED_INTELLIGENCE = 8;

/** Facts a founding (newDialect, newCreed) needs (11 section 3 gates); the caller reads them from the sim. */
export interface FoundFacts {
  /** The group holds a dialect. */
  hasDialect: boolean;
  /** The group holds a creed. */
  hasCreed: boolean;
  /** The group holds a custom. */
  hasCustom: boolean;
  /** The actor's lineage has speech (`hasSpeech`). */
  speech: boolean;
  /** The actor's lineage has memory (`hasMemory`). */
  memory: boolean;
  /** Members of the group's custom (the Folk of its dominion's hamlets). */
  members: number;
  /** Study level of the actor, the ruler. */
  leaderLevel: number;
  /** Intelligence of the actor (the sim's wit aptitude, 05 section 2). */
  intelligence: number;
}

/**
 * Whether a founding may happen (11 section 3). newDialect: no dialect, speech, level 1, intelligence 3. newCreed: no creed,
 * a custom and a dialect, memory, custom >= 50 members, level 5, intelligence 8. Pure: the founding intrigues call it
 * through intrigue.ts foundOk (DECISIONS.md, "Culture founding close 6"). Draws no rng.
 */
export function foundAllowed(kind: 'newDialect' | 'newCreed', f: FoundFacts): boolean {
  if (kind === 'newDialect') {
    return !f.hasDialect && f.speech && f.leaderLevel >= FOUND_DIALECT_LEVEL && f.intelligence >= FOUND_DIALECT_INTELLIGENCE;
  }
  return (
    !f.hasCreed &&
    f.hasCustom &&
    f.hasDialect &&
    f.memory &&
    f.members >= FOUND_CREED_MEMBERS &&
    f.leaderLevel >= FOUND_CREED_LEVEL &&
    f.intelligence >= FOUND_CREED_INTELLIGENCE
  );
}

/** Whether a custom holds `rooted`: conversion cannot replace its members' custom (11 section 9.1). */
export function blocksConversion(traits: readonly string[]): boolean {
  return traits.includes('rooted');
}

/** Extra tower limit from `towerPride` (0 without it). */
export function towerLimitBonus(traits: readonly string[]): number {
  return traits.includes('towerPride') ? TOWER_PRIDE_BONUS : 0;
}

/** Whether a custom lets children work (`childLabour`, opposite of `childShelter`; 11 section 9.1). */
export function childMayWork(traits: readonly string[]): boolean {
  return traits.includes('childLabour');
}
