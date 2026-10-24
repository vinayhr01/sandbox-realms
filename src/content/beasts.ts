/**
 * Wild beast species: the 8 species the sim uses, from the 18a roster (vitality, might, pace, plating,
 * span, diet and biomes come from the roster tables). Hunters, prey, gestation and litter are not in
 * the roster; they are the sim's food-web and breeding simplification.
 *
 * Diets follow the roster (18a): `graze` is `grass` (eats a flora tile), `carn` is `flesh` (hunts
 * prey), `nectar` eats flowers, and `omni` eats flora and hunts prey.
 *
 * `pace` is the roster pace stat: movement is pace * 0.2 / 20 tiles per tick (07 section 7.1).
 * `span` is lifespan in Years (06 section 3.1); the adult age follows from it.
 */
export type SizeClass = 'T' | 'S' | 'M' | 'L' | 'H' | 'C';
/** Order of size classes from smallest to largest. */
export const SIZE_RANK: Record<SizeClass, number> = { T: 0, S: 1, M: 2, L: 3, H: 4, C: 5 };

/** `omni` eats flora and hunts prey; the roster's omnivores (18a `omni`) use it. */
export type Diet = 'grass' | 'flesh' | 'nectar' | 'omni';

export interface SpeciesDef {
  id: string;
  /** Roster size class (18a): a flesh eater only hunts prey of its own size class or smaller (07 section 2.2). */
  size: SizeClass;
  name: string;
  diet: Diet;
  vitality: number;
  might: number;
  pace: number;
  span: number;
  /** Maximum brood size (06 section 6.4). */
  litter: number;
  /** Months from mating to birth (06 section 6.3). */
  gestationMonths: number;
  /** Predator species flee nothing; prey flee the species listed in `hunters`. */
  hunters: readonly string[];
  /** Prey for flesh eaters. */
  prey: readonly string[];
  /** Herd animals gather in groups. */
  herding: boolean;
  /** Biome ids where wild spawns appear (18a biome lists). */
  biomes: readonly string[];
}

export const SPECIES: readonly SpeciesDef[] = [
  { id: 'thistlehart', size: 'M', name: 'Thistlehart', diet: 'grass', vitality: 85, might: 8, pace: 17, span: 28, litter: 3, gestationMonths: 4, hunters: ['gloamfang', 'mudsnuffler'], prey: [], herding: true, biomes: ['verdant_reach', 'russetwood', 'heathermoor'] },
  { id: 'burrfleece', size: 'S', name: 'Burrfleece', diet: 'grass', vitality: 60, might: 5, pace: 6, span: 35, litter: 2, gestationMonths: 3, hunters: ['gloamfang'], prey: [], herding: true, biomes: ['verdant_reach', 'trefoil_lea'] },
  { id: 'plowhorn', size: 'L', name: 'Plowhorn', diet: 'grass', vitality: 140, might: 11, pace: 7, span: 45, litter: 1, gestationMonths: 6, hunters: ['gloamfang'], prey: [], herding: false, biomes: ['amberveldt', 'verdant_reach'] },
  { id: 'mossback', size: 'L', name: 'Mossback', diet: 'grass', vitality: 165, might: 9, pace: 5, span: 110, litter: 2, gestationMonths: 5, hunters: ['gloamfang'], prey: [], herding: false, biomes: ['verdant_reach', 'paleglen'] },
  { id: 'cluckling', size: 'T', name: 'Cluckling', diet: 'omni', vitality: 16, might: 1, pace: 8, span: 10, litter: 4, gestationMonths: 2, hunters: ['gloamfang', 'mudsnuffler'], prey: [], herding: true, biomes: ['verdant_reach', 'trefoil_lea'] },
  { id: 'nectarbuzz', size: 'T', name: 'Nectarbuzz', diet: 'nectar', vitality: 9, might: 3, pace: 20, span: 5, litter: 4, gestationMonths: 1, hunters: ['cluckling'], prey: [], herding: true, biomes: ['bloomfield', 'trefoil_lea', 'verdant_reach'] },
  { id: 'mudsnuffler', size: 'M', name: 'Mudsnuffler', diet: 'omni', vitality: 95, might: 10, pace: 9, span: 30, litter: 2, gestationMonths: 3, hunters: [], prey: ['cluckling', 'thistlehart'], herding: false, biomes: ['sodden_hollow', 'bambooveil', 'verdant_reach'] },
  { id: 'gloamfang', size: 'M', name: 'Gloamfang', diet: 'flesh', vitality: 110, might: 19, pace: 15, span: 18, litter: 2, gestationMonths: 4, hunters: [], prey: ['burrfleece', 'thistlehart', 'plowhorn', 'mossback', 'cluckling'], herding: false, biomes: ['paleglen', 'verdant_reach', 'rimewaste'] },
];

export const SPECIES_BY_ID = new Map(SPECIES.map((s, k) => [s.id, k]));

export function speciesIndex(id: string): number {
  const k = SPECIES_BY_ID.get(id);
  if (k === undefined) throw new RangeError(`unknown species ${id}`);
  return k;
}
