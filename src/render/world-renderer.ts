/**
 * The seam between main.ts and the world views. main.ts talks to one WorldRenderer; the 2D view (Pixi, renderer2d.ts)
 * is the only implementation today. Interfaces only: no code, no imports of either view.
 */
import type { Snapshot, FrameRows, MapBoat, MapBuilding } from '../shared/protocol.ts';
import type { DrawBeing } from './feed-interp.ts';
import type { RecipeId } from './effectRecipes.ts';
import type { MarkToggles } from './marks.ts';
import type { InsightToggles } from './insight-layers.ts';
import type { CursorState } from './terrain.ts';
import type { Atlas } from './atlas.ts';

export interface TilePoint {
  x: number;
  y: number;
}

export interface ScreenPoint {
  sx: number;
  sy: number;
}

/**
 * The map toggles a view reads each frame: the creature options (`map.*`, `marks.boats`) and the 3D-only options. The
 * degradation ladder's runtime flags are passed in FrameInput.degradedOff, not here.
 */
export interface MapToggles {
  /** `map.shadows`. */
  shadows: boolean;
  /** `marks.boats`. */
  boats: boolean;
  /** `map.particles`. */
  particles: boolean;
  /** Runtime-only quality flag: off, beings beyond the crowding rank hold a frame. */
  crowdAnim: boolean;
  /** Runtime-only quality flag: off, no footfall dust. */
  dust: boolean;
  /** Runtime-only quality flag: off, every creature shows frame 0 of its gait. */
  creatureAnim: boolean;
  /** `map.nightLights` (3D only). */
  nightLights: boolean;
  /** `map.bloom` (3D only). */
  bloom: boolean;
  /** `map.vignette` (3D only). */
  vignette: boolean;
  /** `map.treeWind` (3D only). */
  treeSway: boolean;
  /** `map.cursorLights` (3D only). */
  cursorLights: boolean;
}

/** One frame's inputs, from the ticker. Everything the view draws comes from here or from the calls below. */
export interface FrameInput {
  dtMs: number;
  nowMs: number;
  beings: readonly DrawBeing[];
  beingCount: number;
  /** simView.current */
  snapshot: Snapshot | null;
  /** Game speed: 0 paused, else 0.5 to 10. Above 2x the 3D sky smooths its drawn time of day. Unset counts as 1x. */
  speed?: number;
  /** Test hook (`__sr.forcePhase`): pins the drawn time of day. Null or unset follows the sim. */
  phaseOverride?: number | null;
  marks: MarkToggles;
  insight: InsightToggles;
  map: MapToggles;
  cursor: CursorState;
  hoverId: number;
  /** Quality-ladder steps that are off right now (the `map.*` keys of the degradation ladder). */
  degradedOff: ReadonlySet<string>;
}

/** The one camera for both views. 2D moves in the plane; 3D also rotates and walks. */
export interface CameraControl {
  panBy(dxPx: number, dyPx: number): void;
  zoomAt(factor: number, sx: number, sy: number): void;
  /** 2D: no-op. */
  rotateBy(radians: number): void;
  centreOn(tile: TilePoint): void;
  /** Tile extents on screen: x0, y0 (top-left) to x1, y1 (bottom-right). */
  visibleTiles(): { x0: number; y0: number; x1: number; y1: number };
  /** 0 = farthest, 1 = closest (music, audio). */
  zoom01(): number;
  /** Tile at the screen centre (audio pan). */
  centreTile(): TilePoint;
  /** 3D only: walk at ground level. forward and strafe are -1..1, dtMs the frame time. */
  walk?(forward: number, strafe: number, dtMs: number): void;
  /** 3D only: turn the view at ground level (yaw) and tilt it (pitch), in radians. */
  look?(dyaw: number, dpitch: number): void;
  /** 3D only: true at ground level. */
  atGround?(): boolean;
  /** 3D only: the camera rig, for the test hook. */
  rig?(): { height: number; focus: TilePoint; yaw: number };
}

export interface WorldRenderer {
  readonly kind: '2d' | '3d';
  readonly canvas: HTMLCanvasElement;
  readonly camera: CameraControl;
  setSide(side: number): void;
  applyRows(rows: FrameRows): void;
  setBuildings(list: readonly MapBuilding[]): void;
  setBoats(list: readonly MapBoat[]): void;
  playEffect(id: RecipeId, x: number, y: number, sizeTiles: number, stroke: boolean): void;
  liveEffects(): number;
  screenToTile(sx: number, sy: number): TilePoint | null;
  tileToScreen(x: number, y: number): ScreenPoint | null;
  beingAt(sx: number, sy: number, slopPx: number): DrawBeing | null;
  /** Returns the draw cost in ms (feeds the creature cost ring). */
  frame(input: FrameInput): number;
  setRenderScale(percent: number): void;
  setFpsCap(fps: number): void;
  /** Replaces renderer.app.ticker.add: `cb` runs once per ticker tick with its delta. */
  onFrame(cb: (dtMs: number) => void): void;
  resize(): void;
  stats(): { drawn: number; dots: number; atlas: ReturnType<Atlas['stats']> | null };
  destroy(): void;
}
