import { MONTH_TICKS, YEAR_TICKS } from '../shared/constants.ts';

/** Sim-second is 20 ticks (02 section 1). */
export const SS_TICKS = 20;

/** Seconds (sim time) to ticks, rounded to the nearest tick and never below one (02 section 7). */
export function ssToTicks(seconds: number): number {
  return Math.max(1, Math.round(seconds * SS_TICKS));
}

export interface Calendar {
  year: number;
  month: number;
  day: number;
}

/** Calendar from the tick counter (02 section 1). Day 1..30 within a month. */
export function calendar(tick: number): Calendar {
  const year = Math.floor(tick / YEAR_TICKS) + 1;
  const month = Math.floor((tick % YEAR_TICKS) / MONTH_TICKS) + 1;
  const inMonth = tick % MONTH_TICKS;
  const day = Math.floor((inMonth / MONTH_TICKS) * 30) + 1;
  return { year, month, day };
}
