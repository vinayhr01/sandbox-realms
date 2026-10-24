import { describe, expect, it } from 'vitest';
import { edgeBand, edgePanVector } from '../../src/ui/edgePan.ts';

describe('edge pan (13 section 15)', () => {
  it('is still in the middle of the map', () => {
    expect(edgePanVector(400, 300, 800, 600)).toEqual({ dx: 0, dy: 0 });
  });

  it('pans toward the nearer edge, negative on the left and top', () => {
    const band = edgeBand(800, 600);
    const left = edgePanVector(0, 300, 800, 600, band);
    expect(left.dx).toBeCloseTo(-1);
    expect(left.dy).toBe(0);
    const bottomRight = edgePanVector(800 - 1, 600 - 1, 800, 600, band);
    expect(bottomRight.dx).toBeGreaterThan(0.9);
    expect(bottomRight.dy).toBeGreaterThan(0.9);
  });

  it('ramps linearly and stops at the band edge', () => {
    const band = 20;
    expect(edgePanVector(10, 300, 800, 600, band).dx).toBeCloseTo(-0.5);
    expect(edgePanVector(20, 300, 800, 600, band).dx).toBe(0);
  });

  it('ignores pointers outside the map or with bad numbers', () => {
    expect(edgePanVector(-5, 300, 800, 600)).toEqual({ dx: 0, dy: 0 });
    expect(edgePanVector(Number.NaN, 300, 800, 600)).toEqual({ dx: 0, dy: 0 });
    expect(edgePanVector(10, 10, 0, 0)).toEqual({ dx: 0, dy: 0 });
  });

  it('caps the band so large maps keep a narrow edge', () => {
    expect(edgeBand(4000, 4000)).toBe(40);
    expect(edgeBand(100, 100)).toBe(8);
  });
});
