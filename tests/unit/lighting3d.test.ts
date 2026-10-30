import { describe, expect, it } from 'vitest';
import { dayPhase } from '../../src/shared/daytime.ts';
import { lightState } from '../../src/render3d/lighting3d.ts';
import { nightAmount, phaseOf } from '../../src/render3d/sky3d.ts';

describe('lightState', () => {
  it('has the sun up and no moon at noon', () => {
    const noon = lightState(0.5);
    expect(noon.sunIntensity).toBeGreaterThan(0.8);
    expect(noon.moonIntensity).toBe(0);
    expect(noon.night).toBe(0);
  });

  it('has the moon up and no sun at midnight', () => {
    const midnight = lightState(0);
    expect(midnight.sunIntensity).toBe(0);
    expect(midnight.moonIntensity).toBeGreaterThan(0);
    expect(midnight.night).toBe(1);
  });

  it('is warmer at dawn than at noon', () => {
    const dawn = lightState(0.3).sunColour;
    const noon = lightState(0.5).sunColour;
    expect(dawn[2]).toBeLessThan(noon[2]);
    expect(dawn[0]).toBeGreaterThanOrEqual(dawn[2]);
  });

  it('gives the hemisphere light less at night than by day', () => {
    expect(lightState(0).hemiIntensity).toBeLessThan(lightState(0.5).hemiIntensity);
  });

  it('keeps the sun direction unit length', () => {
    for (let i = 0; i < 200; i += 7) {
      const [x, y, z] = lightState(i / 200).sunDir;
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
    }
  });
});

describe('phase and night amount', () => {
  it('uses the sim phase, and noon when no snapshot exists yet', () => {
    expect(phaseOf(null)).toBe(0.5);
    expect(phaseOf(0)).toBe(0.3);
    expect(phaseOf(123)).toBe(dayPhase(123));
  });

  it('is 1 at midnight and 0 at noon', () => {
    expect(nightAmount(0)).toBe(1);
    expect(nightAmount(0.5)).toBe(0);
  });
});
