import { describe, expect, it } from 'vitest';
import { dayPhase } from '../../src/shared/daytime.ts';
import { NIGHT_TINT_MAX, nightTint } from '../../src/render/night.ts';
import { TERRAIN_FRAG } from '../../src/render/terrain-shader.ts';

describe('2D night tint', () => {
  it('is 0 by day', () => {
    expect(nightTint(0.5)).toBe(0);
    expect(nightTint(0.3)).toBe(0);
  });

  it('is 0.55 at deep night', () => {
    expect(NIGHT_TINT_MAX).toBeCloseTo(0.55);
    expect(nightTint(0)).toBeCloseTo(0.55);
    expect(nightTint(0.95)).toBeCloseTo(0.55);
  });

  it('ramps through dusk and dawn with light01', () => {
    // Dusk midpoint (0.80): light01 is 0.5, so the tint is half the night value.
    expect(nightTint(0.8)).toBeCloseTo(0.275);
    // Dawn midpoint (0.25): light01 is 0.5 as well.
    expect(nightTint(0.25)).toBeCloseTo(0.275);
  });

  it('follows the tick: midnight is dark, the start of day is not', () => {
    // dayPhase(140) is phase 0 (midnight); dayPhase(0) is 0.3 (start of day).
    expect(dayPhase(140)).toBeCloseTo(0);
    expect(nightTint(dayPhase(140))).toBeCloseTo(0.55);
    expect(nightTint(dayPhase(0))).toBe(0);
  });

  it('the terrain shader declares and applies uNight', () => {
    expect(TERRAIN_FRAG).toContain('uniform float uNight;');
    expect(TERRAIN_FRAG).toContain('uNight');
  });
});
