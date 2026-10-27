/**
 * Animation maths for the creature layer (map-graphics, Task 5): which gait a being plays, and how its stride
 * phase advances. Pure: no Pixi, no DOM.
 */
import { BeingState } from '../shared/being-feed.ts';
import { GAITS, type GaitId, type PoseMode, type SpeciesGait } from '../art/gaits.ts';

/** The standing breathing pose plays at this rate. */
export const IDLE_CYCLES_PER_S = 0.5;
/** Screen speed above which a walking being plays its run mode. */
export const RUN_SCREEN_TILES_PER_S = 4;
/** High-speed strobe guard: a being never advances more than this many strides per second. */
export const MAX_STRIDES_PER_S = 3;

/** Idle, Sleep and Hit stand still and breathe on the land gait. Swim uses the water gait (or land). Walk uses the
 *  land gait, and Run uses the air gait when the species has one (dragon: walk on land, fly when running). A species
 *  whose land gait is itself 'flyer' (bats, bees, moths) always flies. */
export function gaitFor(sp: SpeciesGait, state: BeingState): { gait: GaitId; mode: PoseMode } {
  switch (state) {
    case BeingState.Swim:
      return { gait: sp.water ?? sp.land, mode: 'walk' };
    case BeingState.Run:
      return { gait: sp.air ?? sp.land, mode: 'run' };
    case BeingState.Walk:
      return { gait: sp.land, mode: 'walk' };
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
  const strides = Math.min(movedTiles / strideTiles, (MAX_STRIDES_PER_S * dtMs) / 1000);
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

interface PhaseEntry {
  phase: number;
  x: number;
  y: number;
  seen: number;
}

/**
 * The stride phase of each being, kept per DrawBeing.key so two beings of one species do not march in step. Tiles moved
 * are measured between this and the last step of the same key, so a stride follows the drawn (smoothed) position. A
 * new key starts at a phase spread from the key itself. `endFrame` drops the keys that were not stepped this frame.
 */
export class PhaseByKey {
  private readonly entries = new Map<number, PhaseEntry>();
  private frame = 0;

  step(key: number, state: BeingState, x: number, y: number, strideTiles: number, dtMs: number): number {
    let e = this.entries.get(key);
    if (!e) {
      const spread = key * 0.6180339887;
      e = { phase: spread - Math.floor(spread), x, y, seen: this.frame };
      this.entries.set(key, e);
    }
    const moved = Math.max(Math.abs(x - e.x), Math.abs(y - e.y));
    e.x = x;
    e.y = y;
    e.phase = stepPhase(e.phase, state, moved, strideTiles, dtMs);
    e.seen = this.frame;
    return e.phase;
  }

  phaseOf(key: number): number {
    return this.entries.get(key)?.phase ?? 0;
  }

  size(): number {
    return this.entries.size;
  }

  endFrame(): void {
    for (const [key, e] of this.entries) if (e.seen !== this.frame) this.entries.delete(key);
    this.frame++;
  }
}
