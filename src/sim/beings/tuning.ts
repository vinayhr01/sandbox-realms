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
