/**
 * Behaviour hooks of the 18b traits (round 8, spec 18b sections 1 and 2). Each function reads the trait marks of
 * one Being (`beingHas`) or its strain (`strainHas`) and returns a number or a flag that the decision, task,
 * life-cycle or perception code uses. Nothing here stores state: the hooks are pure readers, so no save format
 * depends on them. A trait with no hook here is stats-only (its `fx` in content/traits.ts) or cut: see DECISIONS.md
 * "Beings release" for the list.
 */
import { BEING_TRAIT_INDEX, BIRTH_POT } from '../../content/traits.ts';
import { MONTH_TICKS } from '../../shared/constants.ts';
import type { Rng } from '../../shared/rng.ts';
import type { Sim } from '../sim.ts';
import { ROUND8 } from './tuning.ts';

/** Whether a Being holds a being trait (18b section 1). */
export function beingHas(sim: Sim, slot: number, id: string): boolean {
  const k = BEING_TRAIT_INDEX.get(id);
  return k !== undefined && sim.beings.store.hasMark(slot, k);
}

/** Whether a Being's strain holds a strain trait (18b section 2). */
export function strainHas(sim: Sim, slot: number, id: string): boolean {
  const strain = sim.beings.strains.get(sim.beings.store.strain[slot] ?? 0);
  return strain !== undefined && strain.traits.includes(id);
}

/** Vitality as a fraction of its maximum (0 when the maximum is 0). */
export function vitalityRatio(sim: Sim, slot: number): number {
  const s = sim.beings.store;
  const max = s.maxVit[slot] ?? 0;
  return max > 0 ? (s.vit[slot] ?? 0) / max : 0;
}

/**
 * Whether the Being may flee at all (18b MND nerve group). `stout_nerve` flees only below 15% hp; `craven` flees
 * below 60% hp. Without either trait the Being always may.
 */
export function fleeAllowed(sim: Sim, slot: number): boolean {
  const ratio = vitalityRatio(sim, slot);
  if (beingHas(sim, slot, 'stout_nerve') && ratio >= 0.15) return false;
  if (beingHas(sim, slot, 'craven') && ratio >= 0.6) return false;
  return true;
}

/**
 * Sight radius in tiles (18b BOD eyes and FLW eyes). The base is ROUND8.sightTiles; `keen_eyed`, `fine_senses` and
 * `long_neck` add tiles, `near_sighted` takes three away and `one_eyed` cuts the range to 70%. Never below 2.
 */
export function sightRadius(sim: Sim, slot: number): number {
  let r: number = ROUND8.sightTiles;
  if (beingHas(sim, slot, 'keen_eyed')) r += 2;
  if (strainHas(sim, slot, 'fine_senses')) r += 2;
  if (strainHas(sim, slot, 'long_neck')) r += 3;
  if (beingHas(sim, slot, 'near_sighted')) r -= 3;
  if (beingHas(sim, slot, 'one_eyed')) r = Math.floor(r * 0.7);
  return Math.max(2, r);
}

/** Food and prey detection multiplier (18b `keen_nose`: range x2). */
export function foodRangeMult(sim: Sim, slot: number): number {
  return beingHas(sim, slot, 'keen_nose') ? 2 : 1;
}

/** Whether a strain's members may eat their own kind (18b DIE `kin_eater`). */
export function eatsKin(sim: Sim, slot: number): boolean {
  return strainHas(sim, slot, 'kin_eater');
}

/** Whether a strain eats meat whatever its species diet says (18b DIE `flesh_gut`). */
export function eatsFlesh(sim: Sim, slot: number): boolean {
  return strainHas(sim, slot, 'flesh_gut');
}

/**
 * Herd behaviour (18b COG `herd_mind`, `solitary_mind`). The solitary trait wins; a herd mind forms a herd without
 * the species herding flag; otherwise the species flag decides.
 */
export function herds(sim: Sim, slot: number, speciesHerds: boolean): boolean {
  if (strainHas(sim, slot, 'solitary_mind')) return false;
  if (strainHas(sim, slot, 'herd_mind')) return true;
  return speciesHerds;
}

/** Sleep length multiplier (18b `unquiet` needs less sleep; `long_sleeper` needs long rests). */
export function sleepScale(sim: Sim, slot: number): number {
  let k = 1;
  if (beingHas(sim, slot, 'unquiet')) k *= 0.8;
  if (strainHas(sim, slot, 'long_sleeper')) k *= 1.5;
  return k;
}

/** `long_sleeper` recovers all endurance on a natural wake (18b HIB). */
export function recoversFully(sim: Sim, slot: number): boolean {
  return strainHas(sim, slot, 'long_sleeper');
}

/** Endurance multiplier on a natural wake (18b SLP `deep_sleeper`: rests faster). */
export function wakeEnduranceScale(sim: Sim, slot: number): number {
  return strainHas(sim, slot, 'deep_sleeper') ? 1.5 : 1;
}

/** `dream_gland` makes every sleeper dream: one roll, good or bad, +15 or -15 (18b COG). */
export function dreamsAlways(sim: Sim, slot: number): boolean {
  return strainHas(sim, slot, 'dream_gland');
}

/** Damage a Being reflects to an attacker (18b `thorn_skin`, `spined_tail`, SKN `skin_spined`). */
export function reflectDamage(sim: Sim, slot: number): number {
  let r = 0;
  if (beingHas(sim, slot, 'thorn_skin')) r += 3;
  if (strainHas(sim, slot, 'spined_tail')) r += 2;
  if (strainHas(sim, slot, 'skin_spined')) r += 1;
  return r;
}

/** Chance a struck Being strikes back once (18b `antlered`, 15%). */
export function counterChance(sim: Sim, slot: number): number {
  return strainHas(sim, slot, 'antlered') ? ROUND8.antlerCounter : 0;
}

/**
 * Multiplier on the chance that a Being starts a fight (18b MND `placid` starts fights 50% less; `fiery_temper` 20%
 * more; FLW `quarrelsome` fights more, read as x1.5 (TUNE)).
 */
export function fightStartScale(sim: Sim, slot: number): number {
  let k = 1;
  if (beingHas(sim, slot, 'placid')) k *= 0.5;
  if (beingHas(sim, slot, 'fiery_temper')) k *= 1.2;
  if (beingHas(sim, slot, 'quarrelsome')) k *= 1.5;
  return k;
}

/** Damage multiplier of a Being's blows (18b MER `keen_hunter`: +20% against beasts). Every sim Being is a beast. */
export function strikeScale(sim: Sim, slot: number): number {
  return beingHas(sim, slot, 'keen_hunter') ? 1.2 : 1;
}

/** `mendflesh`: the Being may heal a share of its maximum every ten seconds (18b VIT; not when hungry). */
export function mends(sim: Sim, slot: number): boolean {
  return beingHas(sim, slot, 'mendflesh');
}

/** `jittery`: a chance each Month to stumble (18b FLW). */
export function jittery(sim: Sim, slot: number): boolean {
  return beingHas(sim, slot, 'jittery');
}

/** `wanderlust`: the Being roams two steps per wander (18b MND, read as migration x2). */
export function roamsFar(sim: Sim, slot: number): boolean {
  return beingHas(sim, slot, 'wanderlust');
}

/** `evergreen` is not rolled for natural death (18b VIT; 06 section 3.5). */
export function evergreen(sim: Sim, slot: number): boolean {
  return beingHas(sim, slot, 'evergreen');
}

/** `gestation_stasis`: a pregnancy pauses while the bearer is hungry (18b GST; cold is not modelled). */
export function pregnancyPausesWhenHungry(sim: Sim, slot: number): boolean {
  return strainHas(sim, slot, 'gestation_stasis');
}

/** `season_breeding`: the strain breeds only in the spring months (18b RMT). Months are 100 ticks, twelve to a Year. */
export function breedsInSeason(sim: Sim, slot: number, tick: number): boolean {
  if (!strainHas(sim, slot, 'season_breeding')) return true;
  const month = Math.floor(tick / MONTH_TICKS) % 12;
  return ROUND8.springMonths.includes(month);
}

/** `chimeric_blood`: a newborn gets one random being trait at birth (18b CHA). */
export function chimericBlood(sim: Sim, slot: number): boolean {
  return strainHas(sim, slot, 'chimeric_blood');
}

/** A random birth-pot trait for `chimeric_blood`, or null when the pot is empty. */
export function chimericTrait(rng: Rng): string | null {
  if (BIRTH_POT.length === 0) return null;
  return BIRTH_POT[rng.int(BIRTH_POT.length)] ?? null;
}

/** `likeness`: children copy the bearer's marks exactly instead of the inheritance draw (18b CHA). */
export function copiesMarks(sim: Sim, slot: number): boolean {
  return strainHas(sim, slot, 'likeness');
}

/**
 * Population multiplier of a strain (18b POP; 06 section 8). Returns null when the strain has no POP trait, which
 * means no population cap. The POP traits are exclusive, so the first one held decides.
 */
export function popMultiplier(traits: readonly string[]): number | null {
  if (traits.includes('sparse_kin')) return 0.5;
  if (traits.includes('loose_kin')) return 0.8;
  if (traits.includes('dense_kin')) return 1.3;
  if (traits.includes('teeming_kin')) return 1.8;
  return null;
}

/**
 * How a strain reproduces (06 section 6.3, 18b RST and RMT). `live` is the sexual default (a pairing, then a live
 * birth; `birth_egg` and `birth_rooted` are not built and are live births here). `split` is `birth_clonal`: one
 * parent, a clone takes half of its vitality, endurance, mood and fuel. `bud` is `birth_budded`: one parent, one
 * child after the gestation. `spore` is `birth_spore`: 3 to 9 babies at once, around the parent. `self` is
 * `single_parent`: one parent carries a live birth. A clonal trait wins over the others (the strategy traits oppose).
 */
export type BreedMode = 'live' | 'split' | 'bud' | 'spore' | 'self';

export function breedMode(traits: readonly string[]): BreedMode {
  if (traits.includes('birth_clonal')) return 'split';
  if (traits.includes('birth_spore')) return 'spore';
  if (traits.includes('birth_budded')) return 'bud';
  if (traits.includes('single_parent')) return 'self';
  return 'live';
}
