/**
 * Procedural variants of 18a section 3 (round 8): biome morphs (3.1), castes (3.3) and the colour palettes
 * of 3.2 and 05 section 8. Data only; the rolls and the stat effect live in src/sim/beings/variants.ts.
 * All numbers are TUNE. Grants (chill-proof, fire-proof, and so on) are text: no sim mechanic reads them yet.
 */

export interface MorphDef {
  id: string;
  adjective: string;
  /** Biome ids the morph applies to. A base beast is eligible when its own biome list overlaps this set. */
  biomes: readonly string[];
  /** Multipliers (x) on the assembled stats; `arm` is a flat plating add (18a 3.1). */
  hp: number;
  dmg: number;
  spd: number;
  life: number;
  arm: number;
  grants: string;
  /** Palette name from PALETTES. */
  palette: string;
}

/** The twelve biome morphs of 18a section 3.1, in table order. The morph index plus one is stored per Being. */
export const MORPHS: readonly MorphDef[] = [
  { id: 'rime', adjective: 'Rimed', biomes: ['rimewaste', 'paleglen'], hp: 1.15, dmg: 1, spd: 0.9, life: 1, arm: 0, grants: 'chill-proof', palette: 'pal_frost' },
  { id: 'ember', adjective: 'Embered', biomes: ['cinderfields', 'ashbarren'], hp: 1, dmg: 1.15, spd: 1, life: 1, arm: 0, grants: 'fire-proof; burn on hit 15%', palette: 'pal_cinder' },
  { id: 'dune', adjective: 'Dune-bred', biomes: ['dunesea', 'amberveldt'], hp: 0.9, dmg: 1, spd: 1.1, life: 1, arm: 0, grants: 'thirst-proof', palette: 'pal_sand' },
  { id: 'fen', adjective: 'Fenland', biomes: ['sodden_hollow', 'bambooveil'], hp: 1, dmg: 1, spd: 1, life: 1, arm: 1, grants: 'swim; venom-proof', palette: 'pal_mire' },
  { id: 'gloom', adjective: 'Gloomed', biomes: ['blightmoor'], hp: 0.85, dmg: 1.2, spd: 1, life: 1, arm: 0, grants: 'night vision; dread on kill 20%', palette: 'pal_ash' },
  { id: 'gleam', adjective: 'Gleaming', biomes: ['gleamwood', 'skyhaven'], hp: 1, dmg: 1, spd: 1.1, life: 1, arm: 0, grants: 'emits light; +luck', palette: 'pal_glow' },
  { id: 'stonebound', adjective: 'Stonebound', biomes: ['scree_flats', 'prism_hollow'], hp: 1, dmg: 1, spd: 0.9, life: 1, arm: 3, grants: 'climb crag', palette: 'pal_stone' },
  { id: 'floral', adjective: 'Floral', biomes: ['bloomfield', 'trefoil_lea'], hp: 1, dmg: 1, spd: 1, life: 1.2, arm: 0, grants: 'heal-on-rest', palette: 'pal_blossom' },
  { id: 'fungal', adjective: 'Fungal', biomes: ['sporeglen', 'sugarvale'], hp: 1.1, dmg: 1, spd: 1, life: 1, arm: 0, grants: 'spore puff on hurt', palette: 'pal_fungal' },
  { id: 'umbral', adjective: 'Umbral', biomes: ['voidscar', 'riftmeadow'], hp: 1, dmg: 1.1, spd: 1, life: 1, arm: 0, grants: 'blink 5 tiles every 12 s', palette: 'pal_void' },
  { id: 'tide', adjective: 'Tidal', biomes: ['strand', 'shoal', 'midmere'], hp: 1.05, dmg: 1, spd: 1, life: 1, arm: 0, grants: 'amphibious', palette: 'pal_tide' },
  { id: 'thicket', adjective: 'Thicket-bred', biomes: ['steamthicket', 'heathermoor', 'russetwood'], hp: 1, dmg: 1, spd: 1.05, life: 1, arm: 0, grants: 'camouflage 3 tiles', palette: 'pal_leaf' },
];

/** Morph index by id (0-based; a Being stores index plus one, 0 for none). */
export const MORPH_INDEX = new Map(MORPHS.map((m, k) => [m.id, k]));

/** Castes of 18a section 3.3. A caste's chance is rolled once per eligible Being on its spawn. */
export interface CasteDef {
  id: string;
  /** Chance per eligible Being (3.3, TUNE). */
  chance: number;
  hp: number;
  dmg: number;
  life: number;
  /** Litter multiplier (brood queen x3). */
  litter: number;
  /** Movement multiplier (brood queen x0.5). */
  spd: number;
  /** Who can roll it: any species, insect-group small beasts (group E, sizes T and S), or aged Beings (yearly roll). */
  scope: 'any' | 'small_insect' | 'aged';
}

export const CASTES: readonly CasteDef[] = [
  { id: 'runt', chance: 0.08, hp: 0.7, dmg: 0.8, life: 0.8, litter: 1, spd: 1, scope: 'any' },
  { id: 'venerable', chance: 0.03, hp: 1.2, dmg: 0.9, life: 1, litter: 1, spd: 1, scope: 'aged' },
  { id: 'pack_leader', chance: 0.04, hp: 1.3, dmg: 1.25, life: 1, litter: 1, spd: 1, scope: 'any' },
  { id: 'brood', chance: 0.02, hp: 1, dmg: 1, life: 1, litter: 3, spd: 0.5, scope: 'small_insect' },
];

/** Colour palettes (18a 3.2, 05 section 8). Index 0 is the natural palette; the rare pair are per-Being. */
export const PALETTES: readonly string[] = [
  'pal_natural',
  'pal_frost',
  'pal_cinder',
  'pal_sand',
  'pal_mire',
  'pal_ash',
  'pal_glow',
  'pal_stone',
  'pal_blossom',
  'pal_fungal',
  'pal_void',
  'pal_tide',
  'pal_leaf',
  'pal_albino',
  'pal_melanic',
];

export const PALETTE_ALBINO = PALETTES.indexOf('pal_albino');
export const PALETTE_MELANIC = PALETTES.indexOf('pal_melanic');

/** Combined multipliers of a morph and a caste (18a 4 test 3: hp = base x morph x caste). */
export interface VariantFx {
  hp: number;
  dmg: number;
  spd: number;
  life: number;
  arm: number;
  litter: number;
}

export const NO_VARIANT: VariantFx = { hp: 1, dmg: 1, spd: 1, life: 1, arm: 0, litter: 1 };
