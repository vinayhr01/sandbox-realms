import { describe, expect, it } from 'vitest';
import { DAY_TICKS, dayPhase, daySegment, isNight, light01, ticksUntilPhase } from '../../src/shared/daytime.ts';

describe('time of day', () => {
  it('opens a new world at the start of day', () => {
    expect(dayPhase(0)).toBeCloseTo(0.3);
    expect(daySegment(dayPhase(0))).toBe('day');
  });

  it('wraps every 200 ticks', () => {
    expect(DAY_TICKS).toBe(200);
    expect(dayPhase(37)).toBeCloseTo(dayPhase(37 + DAY_TICKS * 5));
  });

  it('splits the day at 0.20, 0.30, 0.75 and 0.85', () => {
    expect(daySegment(0.1)).toBe('night');
    expect(daySegment(0.2)).toBe('dawn');
    expect(daySegment(0.3)).toBe('day');
    expect(daySegment(0.75)).toBe('dusk');
    expect(daySegment(0.85)).toBe('night');
  });

  it('is night 35% of each day', () => {
    let nights = 0;
    for (let t = 0; t < DAY_TICKS; t++) if (isNight(t)) nights++;
    expect(nights).toBe(70);
  });

  it('ramps daylight through dawn and dusk', () => {
    expect(light01(0)).toBe(0);
    expect(light01(0.25)).toBeCloseTo(0.5);
    expect(light01(0.5)).toBe(1);
    expect(light01(0.8)).toBeCloseTo(0.5);
  });

  it('counts ticks to the next dawn', () => {
    // Tick 0 is phase 0.30; dawn (0.20) is 0.90 of a day away.
    expect(ticksUntilPhase(0, 0.2)).toBe(180);
    expect(ticksUntilPhase(0, 0.3)).toBe(0);
  });
});
