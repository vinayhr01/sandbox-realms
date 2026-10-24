/** Fixed simulation rate. One tick is 50 ms of world time at x1 (17 section 3). */
export const TICK_HZ = 20;
export const TICK_MS = 1000 / TICK_HZ;
/** Calendar constants owned by the world clock spec (02); fixed here for M0. */
export const MONTH_TICKS = 100;
export const YEAR_TICKS = 1200;
/** Parcel edge in tiles (01 section 2). One definition shared by settlements, worldgen and terrain. */
export const PARCEL = 8;
/** Largest world-time catch-up after a stall; excess is discarded, never replayed (17 section 3.1). */
export const MAX_CATCHUP_MS = 250;
/** Grid side is 64 * sizeStep (01 section 1). */
export const SIZE_UNIT = 64;
export const DEFAULT_SIZE_STEP = 4;
