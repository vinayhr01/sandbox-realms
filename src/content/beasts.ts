/**
 * Wild beast species (18a subset; ids from the biome beast pools of 18c section 2). Numbers are
 * TUNE. Diets follow 06 section 2.2: `grass` eats a flora tile, `flesh` hunts a prey species,
 * `nectar` eats flowers. `pace` is tiles per second (07 section 7.1, rounded), `span` is lifespan
 * in Years (06 section 3.1) and `litter` the expected brood.
 */
export type Diet = 'grass' | 'flesh' | 'nectar';

export interface SpeciesDef {
  id: string;
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
  /** Biome ids where wild spawns appear (18c beast pools). */
  biomes: readonly string[];
}

export const SPECIES: readonly SpeciesDef[] = [
  { id: 'thistlehart', name: 'Thistlehart', diet: 'grass', vitality: 40, might: 6, pace: 3, span: 18, litter: 3, gestationMonths: 4, hunters: ['gloamfang', 'mudsnuffler'], prey: [], herding: true, biomes: ['verdant_reach', 'paleglen', 'russetwood', 'heathermoor'] },
  { id: 'burrfleece', name: 'Burrfleece', diet: 'grass', vitality: 30, might: 4, pace: 3, span: 14, litter: 2, gestationMonths: 3, hunters: ['gloamfang'], prey: [], herding: true, biomes: ['verdant_reach', 'citrusdell', 'trefoil_lea'] },
  { id: 'plowhorn', name: 'Plowhorn', diet: 'grass', vitality: 70, might: 12, pace: 2, span: 24, litter: 1, gestationMonths: 6, hunters: ['gloamfang'], prey: [], herding: false, biomes: ['amberveldt', 'verdant_reach'] },
  { id: 'mossback', name: 'Mossback', diet: 'grass', vitality: 60, might: 9, pace: 2, span: 30, litter: 2, gestationMonths: 5, hunters: ['gloamfang'], prey: [], herding: false, biomes: ['verdant_reach', 'paleglen'] },
  { id: 'cluckling', name: 'Cluckling', diet: 'grass', vitality: 12, might: 2, pace: 4, span: 8, litter: 4, gestationMonths: 2, hunters: ['gloamfang', 'mudsnuffler'], prey: [], herding: true, biomes: ['citrusdell', 'verdant_reach'] },
  { id: 'nectarbuzz', name: 'Nectarbuzz', diet: 'nectar', vitality: 6, might: 1, pace: 5, span: 3, litter: 4, gestationMonths: 1, hunters: ['cluckling'], prey: [], herding: true, biomes: ['bloomfield', 'citrusdell'] },
  { id: 'mudsnuffler', name: 'Mudsnuffler', diet: 'flesh', vitality: 45, might: 10, pace: 3, span: 16, litter: 2, gestationMonths: 3, hunters: [], prey: ['cluckling', 'thistlehart'], herding: false, biomes: ['sodden_hollow', 'verdant_reach', 'steamthicket'] },
  { id: 'gloamfang', name: 'Gloamfang', diet: 'flesh', vitality: 80, might: 18, pace: 4, span: 22, litter: 2, gestationMonths: 4, hunters: [], prey: ['burrfleece', 'thistlehart', 'plowhorn', 'mossback', 'cluckling'], herding: false, biomes: ['verdant_reach', 'paleglen', 'rimewaste'] },
];

export const SPECIES_BY_ID = new Map(SPECIES.map((s, k) => [s.id, k]));

export function speciesIndex(id: string): number {
  const k = SPECIES_BY_ID.get(id);
  if (k === undefined) throw new RangeError(`unknown species ${id}`);
  return k;
}
