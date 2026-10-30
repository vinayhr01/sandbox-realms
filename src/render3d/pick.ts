/**
 * Ray to tile picking over the height field. Pure: no three.js. The ray is marched at 0.25 tile steps until it dips
 * under the surface, then refined by bisection, so a steep cliff face resolves to the tile in front of the drop.
 *
 * Coordinates are the rig's world axes: x is tile x, y is height, z is tile y (see rig.ts).
 */
import type { TilePoint } from '../render/world-renderer.ts';
import { ELEV_SCALE, type HeightField } from './heights.ts';

const STEP = 0.25;
const BISECTIONS = 6;
const MAX_ELEV = 255;

/**
 * The floored tile the ray hits, or null when the ray is in the sky, misses the map, or never reaches the ground inside
 * the map box. A zero direction gives null.
 */
export function pickTile(
  origin: readonly [number, number, number],
  dir: readonly [number, number, number],
  field: HeightField,
): TilePoint | null {
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  if (!(len > 0)) return null;
  const d: [number, number, number] = [dir[0] / len, dir[1] / len, dir[2] / len];
  const side = field.side;
  if (side === 0) return null;
  const top = MAX_ELEV * ELEV_SCALE;

  const span = slab(origin, d, [0, 0, 0], [side, top, side]);
  if (!span) return null;
  const [t0, t1] = span;

  const below = (t: number): boolean => {
    const x = origin[0] + d[0] * t;
    const y = origin[1] + d[1] * t;
    const z = origin[2] + d[2] * t;
    return y <= field.heightAt(x, z);
  };

  let prev = t0;
  if (below(t0)) return tileOf(origin, d, t0, side, field);
  for (let t = t0 + STEP; ; t += STEP) {
    const t_ = t < t1 ? t : t1;
    if (below(t_)) {
      let lo = prev;
      let hi = t_;
      for (let i = 0; i < BISECTIONS; i++) {
        const mid = (lo + hi) / 2;
        if (below(mid)) hi = mid;
        else lo = mid;
      }
      return tileOf(origin, d, hi, side, field);
    }
    if (t_ >= t1) return null;
    prev = t_;
  }
}

/** The floored tile under the point at distance t along the ray, clamped into the map. */
function tileOf(origin: readonly [number, number, number], d: readonly [number, number, number], t: number, side: number, _field: HeightField): TilePoint {
  const x = clampInt(Math.floor(origin[0] + d[0] * t), side);
  const y = clampInt(Math.floor(origin[2] + d[2] * t), side);
  return { x, y };
}

function clampInt(v: number, side: number): number {
  return v < 0 ? 0 : v >= side ? side - 1 : v;
}

/**
 * The distance interval [tEnter, tExit] (tEnter >= 0) over which the ray is inside the box, or null when it never is.
 */
function slab(
  o: readonly [number, number, number],
  d: readonly [number, number, number],
  lo: readonly [number, number, number],
  hi: readonly [number, number, number],
): [number, number] | null {
  let tMin = 0;
  let tMax = Infinity;
  for (let i = 0; i < 3; i++) {
    const oi = o[i]!;
    const di = d[i]!;
    const a = lo[i]!;
    const b = hi[i]!;
    if (Math.abs(di) < 1e-12) {
      if (oi < a || oi > b) return null;
      continue;
    }
    let t1 = (a - oi) / di;
    let t2 = (b - oi) / di;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  if (!Number.isFinite(tMax)) return null;
  return [tMin, tMax];
}
