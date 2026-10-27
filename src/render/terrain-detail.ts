/**
 * Zoom-faded detail weights for the terrain shader. The shader receives the two values as
 * uDetail and does no threshold maths itself, so the ramps live here where they can be tested.
 */

/** Medium detail (speckle, rock, ripples, contours) fades in over these CSS px per tile. */
const MEDIUM_FROM_PX = 8;
const MEDIUM_TO_PX = 16;
/** Close detail (tufts, pebbles, wave crests) fades in over these CSS px per tile. */
const CLOSE_FROM_PX = 32;
const CLOSE_TO_PX = 64;

function smoothstep(from: number, to: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/** Weights from 0 to 1 for the medium and close detail layers at a zoom in CSS px per tile. */
export function detailWeights(zoomPx: number): { medium: number; close: number } {
  return {
    medium: smoothstep(MEDIUM_FROM_PX, MEDIUM_TO_PX, zoomPx),
    close: smoothstep(CLOSE_FROM_PX, CLOSE_TO_PX, zoomPx),
  };
}
