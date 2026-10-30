/**
 * 2D night tint (spec 2026-10-30-day-night-design). Pure and pixi-free: the strength of the darkening the terrain shader
 * applies by `uNight`. 0 by day, 0.55 at deep night, ramping with the daylight through dawn and dusk.
 */
import { light01 } from '../shared/daytime.ts';

/** The tint at full night: the palette is darkened and cooled by this much. */
export const NIGHT_TINT_MAX = 0.55;

/** Night tint in [0, NIGHT_TINT_MAX] for a day phase (0 = midnight). */
export function nightTint(phase: number): number {
  return NIGHT_TINT_MAX * (1 - light01(phase));
}
