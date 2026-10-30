/**
 * Animation maths for the creature layer (map-graphics, Task 5): which gait a being plays, and how its stride
 * phase advances. Pure: no renderer, no DOM.
 */
import { BeingState } from '../shared/being-feed.ts';
import { GAITS, type GaitId, type PoseMode, type SpeciesGait } from '../art/gaits.ts';

/** The standing breathing pose plays at this rate. */
export const IDLE_CYCLES_PER_S = 0.5;
/** Screen speed at or above which a walking being starts playing its run mode. */
export const RUN_SCREEN_TILES_PER_S = 4;
/** Screen speed below which a running being goes back to its walk mode: between this and RUN_SCREEN_TILES_PER_S it keeps its mode. */
export const WALK_SCREEN_TILES_PER_S = 3.5;
/** High-speed strobe guard: a being never advances more than this many strides per second. */
export const MAX_STRIDES_PER_S = 3;

/** A gait and the mode it plays. */
export interface Pose {
  gait: GaitId;
  mode: PoseMode;
}

const POSES = new WeakMap<SpeciesGait, (Pose | undefined)[]>();

/**
 * Idle, Sleep and Hit stand still and breathe on the land gait. Swim uses the water gait (or land). Walk uses the land
 * gait, and Run uses the air gait when the species has one (dragon: walk on land, fly when running). A walk at or above
 * RUN_SCREEN_TILES_PER_S (`fast`) plays the run cycle, as a Run does. A species whose land gait is itself 'flyer' (bats,
 * bees, moths) always flies. Poses are cached per species, state and `fast`: no allocation after the first call.
 */
export function gaitFor(sp: SpeciesGait, state: BeingState, fast = false): Pose {
  let row = POSES.get(sp);
  if (!row) {
    row = [];
    POSES.set(sp, row);
  }
  const k = state * 2 + (fast ? 1 : 0);
  let pose = row[k];
  if (!pose) {
    pose = poseOf(sp, state, fast);
    row[k] = pose;
  }
  return pose;
}

function poseOf(sp: SpeciesGait, state: BeingState, fast: boolean): Pose {
  switch (state) {
    case BeingState.Swim:
      return { gait: sp.water ?? sp.land, mode: 'walk' };
    case BeingState.Run:
      return { gait: sp.air ?? sp.land, mode: 'run' };
    case BeingState.Walk:
      return fast ? { gait: sp.air ?? sp.land, mode: 'run' } : { gait: sp.land, mode: 'walk' };
    default:
      return { gait: sp.land, mode: 'idle' };
  }
}

/** The sprite frame for a stride phase in [0, 1), wrapping outside that range. */
export function frameIndex(phase: number, frames: number): number {
  const p = phase - Math.floor(phase);
  return Math.min(frames - 1, Math.floor(p * frames));
}

/** Advances a stride phase by the tiles moved, capped at MAX_STRIDES_PER_S strides per second of dtMs, and wraps
 *  the result into [0, 1). */
export function advancePhase(phase: number, movedTiles: number, strideTiles: number, dtMs: number): number {
  // A stride of 0 tiles (or less, or NaN) has no distance to measure: the phase holds, it never becomes NaN.
  const strides = strideTiles > 0 ? Math.min(movedTiles / strideTiles, (MAX_STRIDES_PER_S * dtMs) / 1000) : 0;
  const next = phase + strides;
  return next - Math.floor(next);
}

/** One being's stride phase after a frame: standing beings breathe at IDLE_CYCLES_PER_S, the moving ones stride by distance. */
export function stepPhase(phase: number, state: BeingState, movedTiles: number, strideTiles: number, dtMs: number): number {
  switch (state) {
    case BeingState.Walk:
    case BeingState.Run:
    case BeingState.Swim:
      return advancePhase(phase, movedTiles, strideTiles, dtMs);
    default: {
      const next = phase + (IDLE_CYCLES_PER_S * dtMs) / 1000;
      return next - Math.floor(next);
    }
  }
}

/** Frame count of a gait's mode. A static gait bakes one frame whatever the mode. */
export function framesOf(gait: GaitId, mode: PoseMode): number {
  return gait === 'static' ? 1 : GAITS[gait].frames[mode];
}

/** One being's animation state. Mutated in place by PhaseByKey; read it, do not keep it past the frame. */
export interface PhaseEntry {
  phase: number;
  x: number;
  y: number;
  seen: number;
  /** Tiles per second moved at the latest step. */
  speed: number;
  /** The run mode flag, with hysteresis: set at RUN_SCREEN_TILES_PER_S, cleared below WALK_SCREEN_TILES_PER_S. */
  fast: boolean;
  /** True when the latest step wrapped the phase past 1: a footfall. */
  wrapped: boolean;
}

/**
 * The stride phase of each being, kept per DrawBeing.key so two beings of one species do not march in step. Tiles moved
 * are measured between this and the last step of the same key, so a stride follows the drawn (smoothed) position. A
 * new key starts at a phase spread from the key itself. `endFrame` drops the keys that were not touched this frame, so a
 * being the caller does not step (off screen) is forgotten and starts afresh when it comes back.
 */
export class PhaseByKey {
  private readonly entries = new Map<number, PhaseEntry>();
  private frame = 0;

  /** The key's entry, created at (x, y) when new, and marked as touched this frame. One map lookup. */
  entry(key: number, x: number, y: number): PhaseEntry {
    let e = this.entries.get(key);
    if (!e) {
      const spread = key * 0.6180339887;
      e = { phase: spread - Math.floor(spread), x, y, seen: this.frame, speed: 0, fast: false, wrapped: false };
      this.entries.set(key, e);
    }
    e.seen = this.frame;
    return e;
  }

  /** Steps an entry: the phase by the tiles moved since its last step, the speed, the run flag and the footfall. */
  advance(e: PhaseEntry, state: BeingState, x: number, y: number, strideTiles: number, dtMs: number): number {
    const moved = Math.max(Math.abs(x - e.x), Math.abs(y - e.y));
    e.x = x;
    e.y = y;
    const before = e.phase;
    e.phase = stepPhase(before, state, moved, strideTiles, dtMs);
    e.wrapped = e.phase < before;
    e.speed = dtMs > 0 ? moved / (dtMs / 1000) : 0;
    if (e.speed >= RUN_SCREEN_TILES_PER_S) e.fast = true;
    else if (e.speed < WALK_SCREEN_TILES_PER_S) e.fast = false;
    return e.phase;
  }

  step(key: number, state: BeingState, x: number, y: number, strideTiles: number, dtMs: number): number {
    return this.advance(this.entry(key, x, y), state, x, y, strideTiles, dtMs);
  }

  /** Keeps a key's phase for this frame without stepping it (a held frame). Its position is not taken, so the distance
   *  it moves still counts at its next step. */
  hold(key: number, x: number, y: number, _strideTiles: number): number {
    const e = this.entry(key, x, y);
    e.wrapped = false;
    return e.phase;
  }

  phaseOf(key: number): number {
    return this.entries.get(key)?.phase ?? 0;
  }

  /** Screen speed of a key in tiles per second as of its latest step (0 when unknown). */
  speedOf(key: number): number {
    return this.entries.get(key)?.speed ?? 0;
  }

  /** The key's run flag (with hysteresis); false when unknown. */
  fastOf(key: number): boolean {
    return this.entries.get(key)?.fast ?? false;
  }

  size(): number {
    return this.entries.size;
  }

  endFrame(): void {
    for (const [key, e] of this.entries) if (e.seen !== this.frame) this.entries.delete(key);
    this.frame++;
  }
}
