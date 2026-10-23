/**
 * The 24 biomes of 18c section 2. Gen weights sum to 63 (18c section 3, rule 3). Fields the
 * systems read are typed; flavour text stays in the spec. A biome's cover ids are
 * `biomeCoverId(index, rank)`, two per biome (low and high ground, 18c "<id>_low/_high").
 */
export type SpreadSource = 'water' | 'curse' | 'fire' | 'acid' | 'coffee' | 'blessing' | 'boost' | 'none';

export interface BiomeDef {
  id: string;
  name: string;
  low: string;
  high: string;
  genWeight: number;
  /** Per-attempt ignition chance in fire sweeps; null = not burnable (18c `-`). */
  fire: number | null;
  spreadsBy: SpreadSource[];
  /** Forever frozen: thaw never touches it (18c rimewaste). */
  foreverFrozen: boolean;
  /** Feet resist fire (18c cinderfields). */
  fireproofFeet: boolean;
  /** Grows slowly in the drought age (18c amberveldt). */
  slowGrowth: boolean;
  /** Steppers get a faint heal (18c gleamwood). */
  healsSteppers: boolean;
  /** Steppers risk a hex (18c blightmoor). */
  hexes: boolean;
  /** Max tiles per natural patch (18c `max patch`), or null for unlimited. */
  maxPatch: number | null;
  /** Walk multiplier for beings standing on it (18c `wm` where given). */
  walk: number;
}

const b = (
  id: string,
  name: string,
  low: string,
  high: string,
  genWeight: number,
  fire: number | null,
  spreadsBy: SpreadSource[],
  extra: Partial<BiomeDef> = {},
): BiomeDef => ({
  id,
  name,
  low,
  high,
  genWeight,
  fire,
  spreadsBy,
  foreverFrozen: false,
  fireproofFeet: false,
  slowGrowth: false,
  healsSteppers: false,
  hexes: false,
  maxPatch: null,
  walk: 1,
  ...extra,
});

export const BIOMES: readonly BiomeDef[] = [
  b('verdant_reach', 'Verdant Reach', '#7DB047', '#5E8A3B', 8, 0.05, ['water']),
  b('amberveldt', 'Amberveldt', '#EEB330', '#CC921C', 5, 0.07, ['water'], { slowGrowth: true }),
  b('steamthicket', 'Steamthicket', '#47A253', '#217423', 6, 0.04, ['water']),
  b('dunesea', 'Dunesea', '#E6C570', '#DFB95A', 4, null, ['water'], { walk: 0.7 }),
  b('citrusdell', 'Citrusdell', '#D2E770', '#8CCE56', 3, 0.03, ['water']),
  b('rimewaste', 'Rimewaste', '#9BBDDC', '#B2CDE4', 3, null, [], { foreverFrozen: true, walk: 0.8 }),
  b('sodden_hollow', 'Sodden Hollow', '#4C473D', '#443D33', 3, null, ['water'], { maxPatch: 300, walk: 0.6 }),
  b('prism_hollow', 'Prism Hollow', '#67EADD', '#5FD5CA', 2, null, []),
  b('gleamwood', 'Gleamwood', '#8BDB69', '#75B052', 3, 0.03, ['blessing'], { healsSteppers: true }),
  b('blightmoor', 'Blightmoor', '#6E546A', '#523E50', 1, 0.02, ['curse'], { maxPatch: 20, hexes: true }),
  b('cinderfields', 'Cinderfields', '#9B3525', '#67362C', 1, null, ['fire'], { maxPatch: 20, fireproofFeet: true }),
  b('sugarvale', 'Sugarvale', '#FF95AF', '#FA86A3', 1, 0.04, ['water'], { maxPatch: 30 }),
  b('sporeglen', 'Sporeglen', '#667540', '#546237', 1, 0.03, ['water', 'boost'], { maxPatch: 300 }),
  b('ashbarren', 'Ashbarren', '#839270', '#6B7658', 0, null, ['acid']),
  b('paleglen', 'Paleglen', '#92CE3B', '#75AB2C', 4, 0.03, ['water']),
  b('russetwood', 'Russetwood', '#B47E21', '#A65823', 5, 0.03, ['water']),
  b('scree_flats', 'Scree Flats', '#8C8C8C', '#797979', 2, 0.03, []),
  b('heathermoor', 'Heathermoor', '#ABA878', '#8B8D64', 2, 0.03, ['water']),
  b('bloomfield', 'Bloomfield', '#55CB3B', '#3AA235', 3, 0.03, ['water']),
  b('skyhaven', 'Skyhaven', '#B472D9', '#7E5CA1', 1, 0.03, []),
  b('trefoil_lea', 'Trefoil Lea', '#48AA86', '#3D8B7A', 2, 0.03, ['water']),
  b('voidscar', 'Voidscar', '#612F78', '#512162', 0, null, ['coffee']),
  b('riftmeadow', 'Riftmeadow', '#876854', '#735743', 0, 0.02, []),
  b('bambooveil', 'Bambooveil', '#6FB05A', '#4B8E41', 3, 0.04, ['water']),
];

/** Sum of non-zero gen weights (18c rule 3 expects 63). */
export const GEN_WEIGHT_TOTAL = BIOMES.reduce((s, x) => s + x.genWeight, 0);

/** Cover id for a biome's rank. Cover 0 is bare; biome i owns covers 1 + 2i (low) and 2 + 2i (high). */
export function biomeCoverId(biomeIndex: number, high: boolean): number {
  return 1 + biomeIndex * 2 + (high ? 1 : 0);
}

/** Biome index owning a cover id, or -1 for bare / non-biome covers. */
export function biomeOfCover(coverId: number): number {
  if (coverId <= 0) return -1;
  const idx = (coverId - 1) >> 1;
  return idx < BIOMES.length ? idx : -1;
}

/** Fire chance for a cover id: biome covers use their biome's value; 0 otherwise. */
export function coverFireChance(coverId: number): number {
  const idx = biomeOfCover(coverId);
  if (idx < 0) return 0;
  return BIOMES[idx]?.fire ?? 0;
}
