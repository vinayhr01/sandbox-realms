import { describe, expect, it } from 'vitest';
import { detailWeights } from '../../src/render/terrain-detail.ts';

describe('terrain detail weights', () => {
  it('shows no medium or close detail when zoomed far out', () => {
    expect(detailWeights(4)).toEqual({ medium: 0, close: 0 });
  });

  it('fades medium detail in between 8 and 16 px per tile', () => {
    const w = detailWeights(12);
    expect(w.medium).toBeGreaterThan(0);
    expect(w.medium).toBeLessThan(1);
    expect(w.close).toBe(0);
  });

  it('is fully on at the maximum zoom', () => {
    expect(detailWeights(96)).toEqual({ medium: 1, close: 1 });
  });

  it('pins the ramp edges', () => {
    expect(detailWeights(8).medium).toBe(0);
    expect(detailWeights(16).medium).toBe(1);
    expect(detailWeights(32).close).toBe(0);
    expect(detailWeights(64).close).toBe(1);
  });

  it('rises monotonically for close detail between 32 and 64 px', () => {
    let prev = -Infinity;
    for (let px = 32; px <= 64; px += 0.5) {
      const close = detailWeights(px).close;
      expect(close).toBeGreaterThanOrEqual(prev);
      prev = close;
    }
  });
});
