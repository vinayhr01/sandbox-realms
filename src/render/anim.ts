/**
 * Animation maths for the creature layer (map-graphics, Task 5): which gait a being plays, and how its stride
 * phase advances. Pure: no Pixi, no DOM.
 */
import { BeingState } from '../shared/being-feed.ts';
import type { GaitId, PoseMode, SpeciesGait } from '../art/gaits.ts';

/** The standing breathing pose plays at this rate. */
export const IDLE_CYCLES_PER_S = 0.5;
/** Screen speed above which a walking being plays its run mode. */
export const RUN_SCREEN_TILES_PER_S = 4;
/** High-speed strobe guard: a being never advances more than this many strides per second. */
export const MAX_STRIDES_PER_S = 3;

/** Idle, Sleep and Hit stand still and breathe on the land gait. Swim uses the water gait (or land). Flyers use
 *  their air gait whenever they move, walking or running. */
export function gaitFor(sp: SpeciesGait, state: BeingState): { gait: GaitId; mode: PoseMode } {
  switch (state) {
    case BeingState.Swim:
      return { gait: sp.water ?? sp.land, mode: 'walk' };
    case BeingState.Run:
      return { gait: sp.air ?? sp.land, mode: 'run' };
    case BeingState.Walk:
      return { gait: sp.air ?? sp.land, mode: 'walk' };
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
