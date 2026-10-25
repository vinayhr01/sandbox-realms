/**
 * 18d flora registry, the part the sim can express: bushes (section 3.3), crops (3.4), remains and
 * the manure pile (3.5). Trees and plants stay in src/sim/flora.ts. Every entry is appended after
 * the existing FLORA entries so flora codes already stored in saves keep their meaning.
 *
 * Cuts (not in this file, see DECISIONS.md "Clock, worldgen and flora release"): bush ripeness and
 * picking (no per-tile ripe bit), crop tending and the cropsGrow pause, manure growth boost, burn
 * results (fire lives in src/sim/terrain), and the wet (W) and strand-ok grounds.
 */
import type { FloraDef } from '../sim/flora.ts';
import { MONTH_TICKS, YEAR_TICKS } from '../shared/constants.ts';

const Y = YEAR_TICKS;
const mo = (n: number): number => n * MONTH_TICKS;

interface BushOpts {
  flam: number;
  d?: boolean;
  c?: boolean;
  fuel?: number;
  /** Rare ids spawn with chance 0.4 (18d 2, wild seeding). */
  rare?: boolean;
}

/** Bush (class B): stages 2 and 4 Months (mature at 6), lifespan 8 Years, spread 0.2 with one hop. */
const bush = (id: string, biomes: readonly string[], o: BushOpts): FloraDef => ({
  id,
  kind: 'bush',
  biomes,
  matureTicks: mo(6),
  lifespanTicks: 8 * Y,
  spreadChance: 0.2,
  spreadSteps: 1,
  flammable: o.flam > 0,
  droughtSensitive: o.d === true,
  coldSensitive: o.c === true,
  beach: false,
  eatenBy: ['fruit', 'leaf'],
  fuel: o.fuel ?? 30,
  spawnChance: o.rare ? 0.4 : 1,
});

const BUSHES_RAW: readonly FloraDef[] = [
  bush('berry_thicket', ['verdant_reach', 'paleglen', 'russetwood', 'heathermoor', 'bloomfield', 'trefoil_lea'], { flam: 2, d: true }),
  bush('sunberry', ['amberveldt'], { flam: 2 }),
  bush('dune_fig', ['dunesea'], { flam: 1 }),
  bush('vineberry', ['steamthicket', 'bambooveil'], { flam: 1, c: true }),
  bush('frostberry', ['rimewaste'], { flam: 2 }),
  bush('fenberry', ['sodden_hollow'], { flam: 1 }),
  bush('glimmerberry', ['gleamwood'], { flam: 2, fuel: 35 }),
  bush('candyberry', ['sugarvale'], { flam: 2 }),
  bush('embercurrant', ['cinderfields'], { flam: 0, rare: true }),
  bush('nutbush', ['sporeglen'], { flam: 1 }),
];

/**
 * Understory spread (18d 2 spreadIds 'home'): a bush may seed any bush whose home biome list shares
 * a biome with its own.
 */
const BUSHES: readonly FloraDef[] = BUSHES_RAW.map((def) => ({
  ...def,
  spreadIds: BUSHES_RAW.filter((other) => other.biomes.some((b) => def.biomes.includes(b))).map((other) => other.id),
}));

/** Crop (class C): seedling 1 Month, young 2 Months (ripe at 3), rots 6 Months after ripening. */
const crop = (id: string, biomes: readonly string[], o: { d?: boolean; c?: boolean }): FloraDef => ({
  id,
  kind: 'crop',
  biomes,
  matureTicks: mo(3),
  lifespanTicks: mo(9),
  spreadChance: 0,
  spreadSteps: 0,
  flammable: true,
  droughtSensitive: o.d === true,
  coldSensitive: o.c === true,
  beach: false,
  tilledOnly: true,
  deathResult: 'withered_stalk',
});

/** Crop varieties (18d 3.4). Emmer is the default for every biome not listed for another variety. */
const CROPS: readonly FloraDef[] = [
  crop('emmer', [], { d: true, c: true }),
  crop('millet', ['amberveldt', 'dunesea', 'cinderfields'], {}),
  crop('rime_oat', ['rimewaste', 'paleglen', 'heathermoor'], {}),
  crop('marsh_rice', ['sodden_hollow', 'steamthicket', 'bambooveil'], {}),
];

/** Remains (18d 3.5): no growth, no spread, no Parcel count, fade after 4 Years. */
const remains = (id: string): FloraDef => ({
  id,
  kind: 'remains',
  biomes: [],
  matureTicks: 0,
  lifespanTicks: 4 * Y,
  spreadChance: 0,
  spreadSteps: 0,
  flammable: true,
  droughtSensitive: false,
  coldSensitive: false,
  beach: false,
});

const REMAINS: readonly FloraDef[] = [remains('charred_stump'), remains('fallen_log'), remains('withered_stalk')];

/**
 * Manure pile (18d 3.5): an object, not a plant. Its age is the flora age, so after 30 Months a
 * sweep may turn it into a biome plant (30% per visit); otherwise it fades at 36 Months.
 */
const MANURE: FloraDef = {
  id: 'manure_pile',
  kind: 'object',
  biomes: [],
  matureTicks: mo(30),
  lifespanTicks: mo(36),
  spreadChance: 0,
  spreadSteps: 0,
  flammable: true,
  droughtSensitive: false,
  coldSensitive: false,
  beach: false,
};

/**
 * Wild hive (18c `hive_hanging`, made an object for the honey gatherer, 09 section 8). It never grows or spreads. Its
 * honey builds up from the tick the hive was last taken (flora.ts HONEY_TICKS); it fades only after 40 Years untouched.
 * Seeded by wildSeeding in the biomes listed.
 */
const HIVE: FloraDef = {
  id: 'hive',
  kind: 'object',
  biomes: ['verdant_reach', 'bloomfield', 'paleglen', 'trefoil_lea'],
  matureTicks: 0,
  lifespanTicks: 40 * Y,
  spreadChance: 0,
  spreadSteps: 0,
  flammable: true,
  droughtSensitive: false,
  coldSensitive: false,
  beach: false,
};

/**
 * Ruins of a civil building (18c ruined_dwelling, ruined_hall; 09 section 6 damage/ruin). Objects with no growth, removed
 * by a cleaner (09 section 8); they fade only after 40 Years.
 */
const ruin = (id: string): FloraDef => ({
  id,
  kind: 'object',
  biomes: [],
  matureTicks: 0,
  lifespanTicks: 40 * Y,
  spreadChance: 0,
  spreadSteps: 0,
  flammable: true,
  droughtSensitive: false,
  coldSensitive: false,
  beach: false,
});

/** 18d flora appended to FLORA in src/sim/flora.ts. The jobs close-out additions (hive, ruins) come last so codes hold. */
export const FLORA_18D: readonly FloraDef[] = [...BUSHES, ...CROPS, ...REMAINS, MANURE, HIVE, ruin('ruined_dwelling'), ruin('ruined_hall')];
