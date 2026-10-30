/**
 * Creature sizing, frame choice and crowd rules, as pure functions and data. No renderer import, so the 3D view
 * (src/render3d/beings3d.ts) shares them with the 2D layer (creatures.ts) without pulling the renderer into its chunk.
 * creatures.ts re-exports them.
 */
import type { MapBoat, MapSizeClass } from '../shared/protocol.ts';

/** A building is drawn this many tiles tall, but never under BUILDING_MIN_PX CSS px (so it still reads when zoomed far out). */
const BUILDING_TILES = 1.25;
const BUILDING_MIN_PX = 8;
/** Tiles tall per size class (18a size classes T, S, M, L, H, C). */
const TILES_BY_SIZE: Readonly<Record<MapSizeClass, number>> = { T: 0.5, S: 0.7, M: 1.0, L: 1.4, H: 2.0, C: 3.0 };
/** A young being is drawn at this fraction of its size. */
const CHILD_SCALE = 0.6;
/** A being drawn taller than this many CSS px uses the 128 px frame; at or below it, the 48 px frame (framePxFor). */
const FULL_FRAME_HEIGHT_PX = 56;
/** Beings on screen above which the crowd is animated at a reduced rate (animStep). */
export const CROWD_LIMIT = 1500;
export const BOAT_COLOUR: Readonly<Record<MapBoat['kind'], number>> = { trading: 0x7fd3ff, fishing: 0xa8e6a1, transport: 0xffd27f };

/** Height of a being on screen in CSS px: its size class in tiles times the zoom, and 0.6 of that when young. */
export function worldHeightPx(size: MapSizeClass, zoomPx: number, child: boolean): number {
  return TILES_BY_SIZE[size] * zoomPx * (child ? CHILD_SCALE : 1);
}

/** Height of a building on screen in CSS px: BUILDING_TILES tiles at the zoom, at least BUILDING_MIN_PX. */
export function buildingHeightPx(zoomPx: number): number {
  return Math.max(BUILDING_MIN_PX, BUILDING_TILES * zoomPx);
}

/** The frame size for a sprite drawn `drawnHeightPx` CSS px tall: 128 px above FULL_FRAME_HEIGHT_PX, else 48 px. */
export function framePxFor(drawnHeightPx: number): 48 | 128 {
  return drawnHeightPx > FULL_FRAME_HEIGHT_PX ? 128 : 48;
}

/**
 * How often a being's stride advances, given its rank by distance from the view centre (0 is the nearest) and the number
 * of beings on screen. 1: every frame. 2: every other frame. 0: the frame is held. Up to CROWD_LIMIT all beings get 1; above
 * it the furthest third gets 2, and past twice the limit the furthest sixth holds.
 */
export function animStep(rankFromCentre: number, onScreen: number, crowdAnim = true): 1 | 2 | 0 {
  const share = rankFromCentre / onScreen;
  // Crowd LOD off (degraded): the furthest third holds, whatever the count.
  if (!crowdAnim) return share >= 2 / 3 ? 0 : 1;
  if (onScreen <= CROWD_LIMIT) return 1;
  if (onScreen > 2 * CROWD_LIMIT && share >= 5 / 6) return 0;
  return share >= 2 / 3 ? 2 : 1;
}
