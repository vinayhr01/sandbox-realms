/**
 * Map sprite group of each species (the snapshot's mapKinds and the creature layer). Pure: a species index in,
 * a group out. The mapping is the 18a group letter (section 2) to the sprite group; Folk rows use 'folk'.
 */
import type { MapKindGroup } from '../shared/protocol.ts';
import { SPECIES } from './beasts.ts';

/** Species group letter (18a section 2) to the map sprite group; 'folk' is the Folk row group. */
const MAP_GROUP_OF_LETTER: Record<string, MapKindGroup> = {
  A: 'beast',
  B: 'beast',
  C: 'beast',
  D: 'sea',
  E: 'insect',
  F: 'undead',
  G: 'monster',
  H: 'divine',
  folk: 'folk',
};

/** Map sprite group of the species at `index` in SPECIES. An index with no species draws as a beast. */
export function speciesGroup(index: number): MapKindGroup {
  return MAP_GROUP_OF_LETTER[SPECIES[index]?.group ?? ''] ?? 'beast';
}
