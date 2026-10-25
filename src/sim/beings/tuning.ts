/**
 * Balance knobs for the beings and flora ecosystem (all TUNE, 06/07/18a/18d). One object so the
 * soak sweep (tests/soak/tune.soak.ts) can vary them without touching the systems.
 */
export interface Tuning {
  /** Fuel gained per grazing bite on flora (06 section 2.2: 30). */
  grazeGain: number;
  /** Fuel gained per nectar bite on a flower (06 section 2.2: 7). */
  nectarGain: number;
  /** Multiplier on every flora spread chance (18d section 5). */
  floraSpread: number;
  /** Flora spread runs per 5 sim-seconds: the share of tiles visited each run (1 = whole map). */
  floraCoverage: number;
  /** Wild seeding attempts per 10 sim-seconds (02 section 7). */
  wildAttempts: number;
  /** Tiles a predator searches for prey (tiles, Chebyshev). */
  huntRadius: number;
  /** Tiles a grazer searches for food. */
  forageRadius: number;
  /** Fuel at or above which a being may mate (06 section 6.1: 50). */
  matingFuel: number;
  /** Fuel below which a being hunts or forages (06 section 2.1: 50). */
  hungryAt: number;
  /** Fuel lost per fuel pass by flesh eaters (06 section 2.1 metabolism stat; grazers use 1). */
  predatorMetabolism: number;
  /** Ticks a tile stays bare after a grazer clears its flora, before flora may re-seed (1200 = 1 Year). */
  regrowDelay: number;
}

export const TUNING: Tuning = {
  grazeGain: 30,
  nectarGain: 7,
  floraSpread: 1,
  floraCoverage: 1,
  wildAttempts: 5,
  huntRadius: 10,
  forageRadius: 8,
  matingFuel: 50,
  hungryAt: 50,
  predatorMetabolism: 1,
  regrowDelay: 1200,
};

/**
 * Beings round 6 knobs (06 sections 4-5, 07 sections 3 and 8). Kept apart from `TUNING` so the soak sweep's
 * object is unchanged. Every value is TUNE unless the comment says the spec states it.
 */
export const ROUND6 = {
  /** Ticks between bond checks for each Being (TUNE). */
  bondCheck: 20,
  /** Tiles (Chebyshev) two same-strain Beings must stay within to count as close (TUNE; 06 4.4 uses a chunk). */
  bondRadius: 3,
  /** Ticks two Beings must stay close before they bond (TUNE). */
  bondTicks: 600,
  /** Sleep with a sleep-cycle trait: uniform range (06 section 5, stated 400 to 1200). */
  sleepMin: 400,
  sleepMax: 1200,
  /** Sleep with no sleep-cycle trait (06 section 5, stated 400). */
  sleepPlain: 400,
  /** Monophasic sleep range (06 section 5, stated 800 to 1800). */
  monoMin: 800,
  monoMax: 1800,
  /** Share of max endurance restored on natural wake-up (06 section 5, stated 20%). */
  sleepEndurance: 0.2,
  /** Tiles within which a hunter makes a Being flee; also the "not safe" radius (07 section 3.3, TUNE). */
  fleeRadius: 4,
  /** Tiles a mate, herd mate or chat partner is searched for (TUNE). */
  partnerRadius: 8,
  /** Herd distance a follower keeps (TUNE). */
  herdGap: 3,
  /** Ticks a `pause5` decision waits (07 section 3.6, read as ticks). */
  pauseTicks: 5,
} as const;

/**
 * Beings round 8 knobs (07 sections 3, 4, 8, 10; 06 sections 3, 5, 6, 8; 18a section 3). TUNE unless the comment
 * says the spec states the value. Kept apart from ROUND6 for the same reason.
 */
export const ROUND8 = {
  /** Sight, in tiles (Chebyshev). 07 section 8 says one Patch around the Being's Patch; the sim approximates it as 16 tiles. */
  sightTiles: 16,
  /** Enemy search cadence: after a search the next is due in 2 + rand(0..20) ticks (07 section 8). */
  searchMin: 2,
  searchSpread: 21,
  /** Chance per search that a Being starts a fight with a hostile in sight (TUNE). */
  fightStartChance: 0.25,
  /** Chance per decision that a Folk starts a brawl with a Folk in sight, before the trait scale (TUNE). */
  brawlStartChance: 0.02,
  /** Chance that a brawl blow stops the fight once the victim is under half its vitality (08 2.5 default; TUNE). */
  brawlStopChance: 0.1,
  /** Aggro lifetime for an attacker, in ticks (07 section 10.4: seething 1200). */
  seethingTicks: 1200,
  /** Aggro from a fight the Being started, in ticks (TUNE: keeps the chase going). */
  grudgeTicks: 200,
  /** Ticks between blows of a fight (TUNE). */
  fightBeat: 10,
  /** A fight target further than this (Chebyshev tiles) is dropped (TUNE; 07 section 10.1 says 50). */
  chaseRange: 12,
  /** Antlered counter-hit chance (18b, 15%). */
  antlerCounter: 0.15,
  /** Mend roll for `mendflesh` (18b: 20% every 10 s, heal 2% hp). Ticks: 10 s = 200. */
  mendTicks: 200,
  mendChance: 0.2,
  mendFraction: 0.02,
  /** `jittery` stumble chance per Month (18b: 2% per Month). */
  jitterChance: 0.02,
  /** Dream pot size (06 section 5: 23 entries, 1 good, 1 bad, 1 nightmare, 20 none). */
  dreamPot: 23,
  /** Venerable caste chance, rolled once a Year for aged Beings (18a 3.3: 3%). */
  venerableChance: 0.03,
  /** Chance a wild adult spawn takes a biome morph when eligible (18a 3.5 rule 1: 70%). */
  morphChance: 0.7,
  /** Albino and melanic chance per wild adult spawn (18a 3.2: 1/500 each). */
  albinoChance: 1 / 500,
  melanicChance: 1 / 500,
  /** Spore birth: spores per birth, and the radius they land in (06 section 6.3: 3 to 9 spores). */
  sporeMin: 3,
  sporeMax: 9,
  sporeRadius: 3,
  /** Population rung by size class for a strain with a POP trait (06 section 8; the 50/100/500/1000/3000 rungs). */
  popRung: { T: 3000, S: 1000, M: 500, L: 100, H: 50, C: 50 } as Readonly<Record<string, number>>,
  /** Months (of 12) in which season_breeding beings may breed: spring, months 2 to 4 (TUNE). */
  springMonths: [2, 3, 4] as readonly number[],
} as const;

/**
 * Beings build 3 knobs (07 sections 4, 7, 13; 06 sections 4.4, 6.3, 7.4; 08 section 8). TUNE unless the comment says the
 * spec states the value. Kept apart from ROUND8 for the same reason.
 */
export const ROUND9 = {
  /** Ticks between lover checks for each Being (TUNE). */
  loveCheck: 100,
  /** Chance per check that two eligible Beings become lovers (TUNE; 06 4.4 gives no chance). */
  loveChance: 0.3,
  /** Best-friend chance: base term (06 4.4 states 0.25), family term (0.1) and foe penalty (-0.5). */
  friendBase: 0.25,
  friendFamily: 0.1,
  friendFoe: 0.5,
  /** Ticks an Architect order keeps a Being possessed, refreshed by each order (07 section 13 `puppeted`: 200). */
  possessTicks: 200,
  /** Tiles searched for the nearest shore when a Being douses itself (TUNE). */
  shoreRadius: 8,
  /** Chance a rotstride bite applies `rotting` to a Folk or Beast victim (18a: 50%). */
  rotBite: 0.5,
  /** Chance a spore-lodged attacker's blow leaves the victim spore-lodged (TUNE). */
  sporeCatch: 0.15,
  /** Chance a growth-fever attacker's blow leaves the victim with growth fever (TUNE). */
  tumorCatch: 0.1,
} as const;
