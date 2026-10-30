/**
 * Pure helpers for the billboard layers (beings, buildings, boats, trees): sizes, nearest-first selection and the screen
 * hit test. No three.js and no Pixi, so the unit tests load them without a renderer.
 */

/** Width and height in tiles of a billboard whose drawn height is `drawnHeightTiles`, keeping the frame's aspect (w / h). */
export function billboardSize(drawnHeightTiles: number, aspect: number): [number, number] {
  return [drawnHeightTiles * aspect, drawnHeightTiles];
}

/**
 * The indices of the (at most) `limit` smallest `d2` values among the first `n`, nearest first. The caller sets the limit
 * (CROWD_LIMIT, halved on a degrade step); beyond it the furthest beings are not drawn.
 */
export function nearestFirst(d2: ArrayLike<number>, n: number, limit: number): Int32Array {
  const idx = new Int32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  idx.sort((a, b) => d2[a]! - d2[b]!);
  return idx.subarray(0, Math.max(0, Math.min(limit, n)));
}

/** Squared distance from the point (px, py) to the segment (ax, ay)-(bx, by). */
export function segmentDistSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.min(Math.max(t, 0), 1);
  const qx = ax + dx * t - px;
  const qy = ay + dy * t - py;
  return qx * qx + qy * qy;
}

/** A being's projected feet (fx, fy) and head (hx, hy), in canvas CSS px. */
export interface ProjectedBeing {
  fx: number;
  fy: number;
  hx: number;
  hy: number;
}

/**
 * The projected being nearest to a screen point, among those whose feet-to-head segment lies within `slopPx`; null when
 * none does. A tap on a being hits it anywhere along its body, not only at one point.
 */
export function nearestHit<T extends ProjectedBeing>(items: readonly T[], sx: number, sy: number, slopPx: number): T | null {
  let best: T | null = null;
  let bestD2 = slopPx * slopPx;
  for (const it of items) {
    const d2 = segmentDistSq(sx, sy, it.fx, it.fy, it.hx, it.hy);
    if (d2 <= bestD2) {
      best = it;
      bestD2 = d2;
    }
  }
  return best;
}
