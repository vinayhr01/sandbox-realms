import { describe, expect, it } from 'vitest';
import { DAY_TICKS, sunState } from '../../src/render3d/lighting3d.ts';

describe('sunState', () => {
  it('is brightest at the middle of the day and dark at the middle of the night', () => {
    const noon = sunState(DAY_TICKS / 4);
    const midnight = sunState((DAY_TICKS * 3) / 4);
    expect(noon.sunIntensity).toBeGreaterThan(0.8);
    expect(noon.night).toBe(0);
    expect(midnight.sunIntensity).toBe(0);
    expect(midnight.night).toBe(1);
  });

  it('repeats every day and keeps negative ticks in the cycle', () => {
    expect(sunState(DAY_TICKS * 2 + 10)).toEqual(sunState(10));
    expect(sunState(-DAY_TICKS + 10)).toEqual(sunState(10));
  });

  it('uses a fixed noon when no snapshot exists yet', () => {
    expect(sunState(null)).toEqual(sunState(DAY_TICKS / 4));
  });

  it('keeps the light direction unit length', () => {
    for (let t = 0; t < DAY_TICKS; t += 137) {
      const [x, y, z] = sunState(t).dir;
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
    }
  });
});
