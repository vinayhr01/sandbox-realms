import { describe, expect, it } from 'vitest';
import { billboardSize, nearestFirst, nearestHit, segmentDistSq } from '../../src/render3d/billboard.ts';

describe('billboardSize', () => {
  it('keeps the aspect of the frame', () => {
    expect(billboardSize(2, 0.5)).toEqual([1, 2]);
    expect(billboardSize(1.25, 1)).toEqual([1.25, 1.25]);
    expect(billboardSize(1, 2)).toEqual([2, 1]);
  });
});

describe('nearestFirst', () => {
  it('returns the indices nearest first', () => {
    const d2 = [9, 1, 4, 0.25];
    expect(Array.from(nearestFirst(d2, d2.length, 10))).toEqual([3, 1, 2, 0]);
  });

  it('never returns more than the limit, and the nearest of them', () => {
    const n = 5000;
    const d2 = new Float64Array(n);
    for (let i = 0; i < n; i++) d2[i] = (i * 7919) % 10007;
    const picked = nearestFirst(d2, n, 1500);
    expect(picked.length).toBe(1500);
    for (let k = 1; k < picked.length; k++) expect(d2[picked[k - 1]!]!).toBeLessThanOrEqual(d2[picked[k]!]!);
    const worstPicked = d2[picked[picked.length - 1]!]!;
    const chosen = new Set(picked);
    let closerOutside = 0;
    for (let i = 0; i < n; i++) if (d2[i]! < worstPicked && !chosen.has(i)) closerOutside++;
    expect(closerOutside).toBe(0);
  });
});

describe('segmentDistSq', () => {
  it('is the squared distance to the nearest point of the segment', () => {
    expect(segmentDistSq(5, 3, 0, 0, 10, 0)).toBe(9);
    expect(segmentDistSq(-3, 4, 0, 0, 10, 0)).toBe(25);
    expect(segmentDistSq(2, 0, 2, 0, 2, 0)).toBe(0);
  });
});

describe('nearestHit', () => {
  // A being's projected segment: feet at (fx, fy), head at (hx, hy).
  const beings = [
    { id: 'a', fx: 100, fy: 100, hx: 100, hy: 80 },
    { id: 'b', fx: 104, fy: 100, hx: 104, hy: 80 },
    { id: 'far', fx: 300, fy: 300, hx: 300, hy: 280 },
  ];

  it('finds a being whose projected head and foot are within the slop', () => {
    expect(nearestHit(beings, 99, 90, 10)?.id).toBe('a');
  });

  it('returns the nearest of the beings in slop, and null when none is', () => {
    expect(nearestHit(beings, 103, 90, 10)?.id).toBe('b');
    expect(nearestHit(beings, 200, 200, 10)).toBeNull();
  });
});
