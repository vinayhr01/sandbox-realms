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
};
