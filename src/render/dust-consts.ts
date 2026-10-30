/**
 * Footfall dust limits, as pure data. No renderer import, so the 3D view (src/render3d/beings3d.ts) shares the pool size and
 * puff life with the 2D pool (dust.ts) without pulling the renderer into its chunk. dust.ts re-exports them.
 */

/** Most puff sprites the pool ever creates. */
export const DUST_MAX = 256;
/** A puff lives this long, fading out as it drifts back and rises. */
export const DUST_LIFE_MS = 300;
