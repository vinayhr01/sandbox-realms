/**
 * The drawn time of day, shared by both views (spec 2026-10-30-day-night-design, "Fast speeds"). No renderer import, so
 * the 2D view and the 3D sky and light read one clock.
 *
 * Up to 2x the drawn phase is the sim phase. Above that the sim can pass several days a second, so the drawn phase only
 * moves forward and at most PHASE_MAX_RATE of a day per real second (one drawn day per 10 s, the 1x pace) and
 * PHASE_MAX_STEP per frame: 5x and 10x show a steady day instead of a strobe. Behaviour always uses the true phase.
 *
 * FrameInput.phaseOverride (the `__sr.forcePhase` test hook) pins the drawn phase, for screenshots and e2e.
 */
import { dayPhase } from '../shared/daytime.ts';
import type { FrameInput } from './world-renderer.ts';

/** Phase used when no snapshot exists yet: a fixed noon. */
export const NOON_PHASE = 0.5;
/** Largest drawn-phase step per frame, as a fraction of a day. */
export const PHASE_MAX_STEP = 0.05;
/** Largest drawn-phase change per real second above 2x: one day per 10 s. */
export const PHASE_MAX_RATE = 0.1;
/** At or below this speed the drawn phase is the sim phase. */
const SMOOTH_ABOVE_SPEED = 2;

function wrap01(p: number): number {
  return ((p % 1) + 1) % 1;
}

/** Phase of a sim tick in [0, 1). No snapshot is a fixed noon. */
export function phaseOf(tick: number | null): number {
  return tick === null ? NOON_PHASE : dayPhase(tick);
}

/** One step forward towards `target` on the day circle, capped per frame and per real second. Never runs backwards. */
export function stepPhase(drawn: number, target: number, dtMs: number): number {
  const ahead = wrap01(target - drawn);
  const step = Math.min(ahead, PHASE_MAX_STEP, (PHASE_MAX_RATE * Math.max(0, dtMs)) / 1000);
  return wrap01(drawn + step);
}

/** The phase to draw: the target itself at speeds up to 2x (or on the first frame), else stepped forward. */
export function drawnPhase(drawn: number | null, target: number, dtMs: number, speed: number): number {
  if (drawn === null || speed <= SMOOTH_ABOVE_SPEED) return target;
  return stepPhase(drawn, target, dtMs);
}

/** Holds the drawn phase across frames. Each user owns one; all see the same input each frame, so they agree. */
export class DayClock {
  private drawn: number | null = null;

  update(input: FrameInput): number {
    if (input.phaseOverride !== undefined && input.phaseOverride !== null) {
      this.drawn = wrap01(input.phaseOverride);
      return this.drawn;
    }
    const target = phaseOf(input.snapshot ? input.snapshot.tick : null);
    this.drawn = drawnPhase(this.drawn, target, input.dtMs, input.speed ?? 1);
    return this.drawn;
  }
}
