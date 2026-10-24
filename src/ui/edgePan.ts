/**
 * Edge pan (13 section 15, input.edgePan): a pointer resting near a map edge moves the camera
 * toward that edge. Pure: the caller scales the result by frame time and pan speed.
 */

/** Components are -1..1; 0 when the pointer is outside the margin on that axis. */
export interface EdgePanVector {
  dx: number;
  dy: number;
}

/** Edge band in CSS px, scaled to the map so small maps do not pan everywhere. */
export function edgeBand(width: number, height: number, cap = 40): number {
  return Math.max(8, Math.min(cap, Math.min(width, height) * 0.08));
}

/**
 * Ramp from 0 at the band's inner edge to 1 at the map border, per axis. The left and top edges
 * pan negative (camera moves left or up), right and bottom positive.
 */
export function edgePanVector(x: number, y: number, width: number, height: number, band = edgeBand(width, height)): EdgePanVector {
  if (!Number.isFinite(x) || !Number.isFinite(y) || width <= 0 || height <= 0) return { dx: 0, dy: 0 };
  const axis = (p: number, size: number): number => {
    if (p < 0 || p > size) return 0;
    if (p < band) return -(band - p) / band;
    if (p > size - band) return (p - (size - band)) / band;
    return 0;
  };
  return { dx: axis(x, width), dy: axis(y, height) };
}
