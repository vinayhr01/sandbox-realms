/**
 * Time of day (spec 2026-10-30-day-night-design). Pure functions of the sim tick, shared by the sim (behaviour) and both
 * renderers (sky, light, 2D night tint), so all three agree with no saved state and no snapshot field: the phase is
 * derived from the tick every snapshot already carries.
 *
 * Phase 0 is midnight. Night is 0.85..1 and 0..0.20 (35% of the day), dawn 0.20..0.30, day 0.30..0.75, dusk 0.75..0.85.
 * Tick 0 sits at the start of day, so a new world opens in daylight.
 */

/** One day is 2 game months: 200 ticks, 10 s at 1x. */
export const DAY_TICKS = 200;
/** Phase of tick 0 (the start of day). */
export const DAY_PHASE_OFFSET = 0.3;

export const DAWN_START = 0.2;
export const DAY_START = 0.3;
export const DUSK_START = 0.75;
export const NIGHT_START = 0.85;

export type DaySegment = 'night' | 'dawn' | 'day' | 'dusk';

/** Phase of the day in [0, 1), 0 = midnight. Integer tick maths first, so segment edges land on exact ticks. */
export function dayPhase(tick: number): number {
  const t = tick + Math.round(DAY_PHASE_OFFSET * DAY_TICKS);
  return (((t % DAY_TICKS) + DAY_TICKS) % DAY_TICKS) / DAY_TICKS;
}

export function daySegment(phase: number): DaySegment {
  if (phase >= NIGHT_START || phase < DAWN_START) return 'night';
  if (phase < DAY_START) return 'dawn';
  if (phase < DUSK_START) return 'day';
  return 'dusk';
}

export function isNight(tick: number): boolean {
  return daySegment(dayPhase(tick)) === 'night';
}

/** Daylight in [0, 1]: 0 at night, ramps up through dawn, 1 by day, ramps down through dusk. */
export function light01(phase: number): number {
  if (phase >= NIGHT_START || phase < DAWN_START) return 0;
  if (phase < DAY_START) return (phase - DAWN_START) / (DAY_START - DAWN_START);
  if (phase < DUSK_START) return 1;
  return 1 - (phase - DUSK_START) / (NIGHT_START - DUSK_START);
}

/** Ticks from `tick` until the given phase is next reached (0 when already there). */
export function ticksUntilPhase(tick: number, phase: number): number {
  const now = dayPhase(tick);
  const d = phase - now;
  return Math.round((d < 0 ? d + 1 : d) * DAY_TICKS) % DAY_TICKS;
}
