import { describe, expect, it } from 'vitest';
import { drawnPhase, fogColour, moonDirection, starOpacity, stepPhase, sunDirection } from '../../src/render3d/sky3d.ts';

/** Wrapped distance from `from` to `to`, in [-0.5, 0.5). */
function wrapDelta(from: number, to: number): number {
  const d = to - from;
  return d - Math.round(d);
}

describe('sun and moon', () => {
  it('is high at noon and below the horizon at midnight', () => {
    expect(sunDirection(0.5)[1]).toBeGreaterThan(0.9);
    expect(sunDirection(0)[1]).toBeLessThan(0);
  });

  it('rises in the east and sets in the west', () => {
    const dawn = sunDirection(0.3);
    const dusk = sunDirection(0.7);
    expect(dawn[1]).toBeGreaterThan(0);
    expect(dawn[0]).toBeGreaterThan(0);
    expect(dusk[1]).toBeGreaterThan(0);
    expect(dusk[0]).toBeLessThan(0);
  });

  it('keeps the sun direction unit length', () => {
    for (let i = 0; i < 200; i++) {
      const [x, y, z] = sunDirection(i / 200);
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
    }
  });

  it('puts the moon opposite the sun', () => {
    for (let i = 0; i < 20; i++) {
      const p = i / 20;
      const [sx, sy, sz] = sunDirection(p);
      const [mx, my, mz] = moonDirection(p);
      expect(mx).toBeCloseTo(-sx, 9);
      expect(my).toBeCloseTo(-sy, 9);
      expect(mz).toBeCloseTo(-sz, 9);
    }
  });
});

describe('stars and fog', () => {
  it('shows no stars by day and full stars at deep night', () => {
    expect(starOpacity(0.5)).toBe(0);
    expect(starOpacity(0)).toBe(1);
    const dusk = starOpacity(0.8);
    expect(dusk).toBeGreaterThan(0);
    expect(dusk).toBeLessThan(1);
  });

  it('gives a day fog colour that differs from the night colour, and is brighter', () => {
    const day = fogColour(0.5);
    const night = fogColour(0);
    expect(day.getHex()).not.toBe(night.getHex());
    const lum = (c: { r: number; g: number; b: number }): number => c.r + c.g + c.b;
    expect(lum(day)).toBeGreaterThan(lum(night));
  });
});

describe('smoothing the drawn phase', () => {
  it('smoothing caps the per-frame step', () => {
    // A long frame gap at 10x would step the full gap; the cap holds it to 0.05.
    expect(drawnPhase(0.2, 0.6, 500, 10)).toBeCloseTo(0.25, 9);
    expect(drawnPhase(0.7, 0.3, 500, 10)).toBeCloseTo(0.65, 9);
    expect(Math.abs(wrapDelta(0.2, stepPhase(0.2, 0.7, 5000)))).toBeLessThanOrEqual(0.05 + 1e-9);
  });

  it('takes the short way across the 1 to 0 wrap', () => {
    const next = stepPhase(0.99, 0.03, 2000);
    const forward = wrapDelta(0.99, next);
    expect(forward).toBeGreaterThan(0);
    expect(forward).toBeLessThanOrEqual(0.05 + 1e-9);
  });

  it('follows the true phase at speeds up to 2x', () => {
    expect(drawnPhase(0.2, 0.7, 16, 1)).toBe(0.7);
    expect(drawnPhase(0.2, 0.7, 16, 2)).toBe(0.7);
  });

  it('starts at the target when there is no drawn phase yet', () => {
    expect(drawnPhase(null, 0.4, 16, 10)).toBe(0.4);
  });

  it('converges on the target over time', () => {
    let p = 0.1;
    for (let i = 0; i < 2000; i++) p = stepPhase(p, 0.4, 16);
    expect(p).toBeCloseTo(0.4, 3);
  });
});
