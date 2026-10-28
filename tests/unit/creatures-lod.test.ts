import { describe, expect, it } from 'vitest';
import { lodOf, worldHeightPx } from '../../src/render/creatures.ts';

describe('creature level of detail', () => {
  it('shows dots when far and icons when near', () => {
    expect(lodOf(2)).toEqual({ dots: 1, icons: 0 });
    expect(lodOf(8)).toEqual({ dots: 0, icons: 1 });
  });

  it('crosses over between 3 and 5 px per tile', () => {
    const mid = lodOf(4);
    expect(mid.dots).toBeGreaterThan(0);
    expect(mid.dots).toBeLessThan(1);
    expect(mid.icons).toBeGreaterThan(0);
    expect(mid.icons).toBeLessThan(1);
  });
});

describe('world-scale creature height', () => {
  it('is size-class tiles times the zoom', () => {
    expect(worldHeightPx('M', 20, false)).toBe(20);
    expect(worldHeightPx('T', 20, false)).toBe(10);
    expect(worldHeightPx('C', 20, false)).toBe(60);
  });

  it('shrinks young beings to 0.6', () => {
    expect(worldHeightPx('C', 20, true)).toBe(36);
  });
});
