/** Fixed simulation rate. One tick is 50 ms of world time at x1 (17 section 3). */
export const TICK_HZ = 20;
export const TICK_MS = 1000 / TICK_HZ;
/** Calendar constants owned by the world clock spec (02); fixed here for M0. */
export const MONTH_TICKS = 100;
export const YEAR_TICKS = 1200;
/** Parcel edge in tiles (01 section 2). One definition shared by settlements, worldgen and terrain. */
export const PARCEL = 8;
/** Parcel edge as a shift (8 = 2^3). Keep in step with PARCEL. */
export const PARCEL_SHIFT = 3;
/** Patch edge in tiles (01 section 2): 16x16 tiles, four Parcels each. */
export const PATCH = 16;
/** Patch edge as a shift (16 = 2^4). Keep in step with PATCH. */
export const PATCH_SHIFT = 4;
/** Largest world-time catch-up after a stall; excess is discarded, never replayed (17 section 3.1). */
export const MAX_CATCHUP_MS = 250;
/** Grid side is 64 * sizeStep (01 section 1). */
export const SIZE_UNIT = 64;
export const DEFAULT_SIZE_STEP = 4;
