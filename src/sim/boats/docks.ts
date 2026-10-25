import { ground, type GroundLayer } from '../../content/grounds.ts';
import type { Realm } from '../realm.ts';
import { landmassInfo, landmassOf } from '../terrain/connectivity.ts';

/**
 * Docks (09 section 7, 10 section 13): the ocean-pool test and the dock footprint test. Pure reads of the
 * realm and its derived landmass layer; nothing here draws randomness or writes state.
 */

/** An ocean pool needs at least this many tiles for a dock (10 section 13; 09 section 12). */
export const OCEAN_POOL_MIN = 2500;

/** Ocean-access test offsets from a dock's origin tile (10 section 13). */
export const DOCK_OFFSETS: readonly (readonly [number, number])[] = [
  [-4, 0],
  [5, 0],
  [0, -4],
  [0, 7],
];

function layerAt(realm: Realm, x: number, y: number): GroundLayer | null {
  if (x < 0 || y < 0 || x >= realm.side || y >= realm.side) return null;
  return ground(realm.ground[y * realm.side + x] ?? 0).layer;
}

/**
 * Id of the ocean pool that holds tile (x, y): the water landmass of the tile when that landmass has at least
 * OCEAN_POOL_MIN tiles. -1 when the tile is not navigable sea, is not settled yet, or lies in a smaller pool.
 */
export function oceanPoolAt(realm: Realm, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= realm.side || y >= realm.side) return -1;
  const i = y * realm.side + x;
  const kind = ground(realm.ground[i] ?? 0);
  if (kind.layer !== 'water' || !kind.sea) return -1;
  const lm = landmassOf(realm, i);
  if (lm < 0) return -1;
  const info = landmassInfo(realm, lm);
  return info && info.layer === 'water' && info.tileCount >= OCEAN_POOL_MIN ? lm : -1;
}

/**
 * Ocean pool a dock with origin (x, y) and this footprint can use, or -1. Every footprint tile must be land or
 * water (no blocked ground), the footprint must straddle the shore (some land and some water), and at least
 * one ocean-access offset must lie in an ocean pool.
 */
export function dockPool(realm: Realm, x: number, y: number, width: number, height: number): number {
  let land = 0;
  let water = 0;
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const layer = layerAt(realm, x + dx, y + dy);
      if (layer === 'land') land++;
      else if (layer === 'water') water++;
      else return -1;
    }
  }
  if (land === 0 || water === 0) return -1;
  for (const [ox, oy] of DOCK_OFFSETS) {
    const pool = oceanPoolAt(realm, x + ox, y + oy);
    if (pool >= 0) return pool;
  }
  return -1;
}

/** Tile indices of a dock's ocean-access offsets that lie in ocean pools (spawn and berth candidates, in offset order). */
export function accessTiles(realm: Realm, x: number, y: number): number[] {
  const out: number[] = [];
  for (const [ox, oy] of DOCK_OFFSETS) {
    if (oceanPoolAt(realm, x + ox, y + oy) >= 0) out.push((y + oy) * realm.side + x + ox);
  }
  return out;
}
