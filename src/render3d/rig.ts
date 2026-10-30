/**
 * Camera math for the one 3D camera: pure, no three.js.
 *
 * World axes: x is tile x, y is height (up), z is tile y. Yaw 0 looks toward -z (tile y decreasing, up the screen).
 * Height is above the ground under the focus, in world units (1 tile = 1 unit). Pitch is -90 deg straight down at
 * overview height and eases to -5 deg at eye height.
 */
import type { TilePoint } from '../render/world-renderer.ts';

/** Eye height above the ground, in tiles (1 tile = 2 m). */
export const EYE_HEIGHT = 0.85;
/** Height at which the camera is fully straight down: 35% of the overview height. */
const TOP_DOWN_FRACTION = 0.35;
const PITCH_GROUND = (-5 * Math.PI) / 180;
const PITCH_TOP = -Math.PI / 2;

export interface RigState {
  focus: TilePoint;
  /** Height above the ground under the focus, world units. */
  height: number;
  /** Radians; 0 looks toward -z. */
  yaw: number;
}

/** The camera's height when it sees the whole map from above. */
export function overviewHeight(side: number): number {
  return side * 1.1;
}

/**
 * Ground level: below 5% of the overview height. The floor of 1.5 eye heights keeps ground reachable on a small map,
 * where 5% of the overview is less than eye height and the rig never goes that low.
 */
export function isAtGround(height: number, side: number): boolean {
  return height < Math.max(0.05 * overviewHeight(side), 1.5 * EYE_HEIGHT);
}

export function rigPose(
  s: RigState,
  side: number,
  groundAt: (x: number, y: number) => number,
): { eye: [number, number, number]; target: [number, number, number]; pitch: number } {
  const h = clampHeight(s.height, side);
  const pitch = pitchFor(h, side);
  const fx = clampTo(s.focus.x, side);
  const fy = clampTo(s.focus.y, side);
  const eye: [number, number, number] = [fx, groundAt(fx, fy) + h, fy];
  const dir = forward(pitch, s.yaw);
  return { eye, target: [eye[0] + dir[0], eye[1] + dir[1], eye[2] + dir[2]], pitch };
}

/** Unit view direction for a pitch and yaw: the same vector three.js gets from Euler order YXZ with (pitch, -yaw). */
export function forward(pitch: number, yaw: number): [number, number, number] {
  return [Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), -Math.cos(pitch) * Math.cos(yaw)];
}

/** Factor above 1 zooms in (height divided by it), as Renderer.zoomAt does in 2D. Clamped to the range. */
export function zoomRig(s: RigState, factor: number, side: number, _groundAt: (x: number, y: number) => number): RigState {
  return { ...s, height: clampHeight(s.height / factor, side) };
}

/**
 * Pans in tile units relative to yaw: dx to the right on screen, dy forward (up on screen). The focus is clamped to
 * [0, side] on both axes; without a side it is left unbounded.
 */
export function panRig(s: RigState, dxTiles: number, dyTiles: number, side = Infinity): RigState {
  const c = Math.cos(s.yaw);
  const n = Math.sin(s.yaw);
  const x = s.focus.x + dxTiles * c + dyTiles * n;
  const y = s.focus.y + dxTiles * n - dyTiles * c;
  return { ...s, focus: { x: clampTo(x, side), y: clampTo(y, side) } };
}

/** Walks at ground level: forward and strafe are -1..1 inputs, speed is tiles per second. */
export function walkRig(
  s: RigState,
  forwardInput: number,
  strafe: number,
  dtMs: number,
  speedTilesPerS: number,
  side = Infinity,
): RigState {
  const k = (speedTilesPerS * dtMs) / 1000;
  return panRig(s, strafe * k, forwardInput * k, side);
}

export function rotateRig(s: RigState, radians: number): RigState {
  return { ...s, yaw: s.yaw + radians };
}

function clampHeight(h: number, side: number): number {
  return Math.min(Math.max(h, EYE_HEIGHT), overviewHeight(side));
}

/** Pitch by log-height: -90 deg from 35% of the overview height up, easing with smoothstep to -5 deg at eye height. */
function pitchFor(h: number, side: number): number {
  const lo = Math.log(EYE_HEIGHT);
  const hi = Math.log(TOP_DOWN_FRACTION * overviewHeight(side));
  const u = hi > lo ? Math.min(Math.max((Math.log(h) - lo) / (hi - lo), 0), 1) : 1;
  const t = u * u * (3 - 2 * u);
  return PITCH_GROUND + (PITCH_TOP - PITCH_GROUND) * t;
}

function clampTo(v: number, side: number): number {
  return v < 0 ? 0 : v > side ? side : v;
}
