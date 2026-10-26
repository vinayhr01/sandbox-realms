import { describe, expect, it } from 'vitest';
import { anchorOf, indexOfAnchor } from '../../src/sim/dominions/rebellion.ts';

describe('uprising hamlet anchor', () => {
  it('still finds the same hamlet after the list is reordered, and none once it is gone', () => {
    const a = { parcels: new Set([40, 41]) };
    const b = { parcels: new Set([12, 30]) };
    const c = { parcels: new Set([7]) };
    const anchor = anchorOf(b.parcels);
    expect(anchor).toBe(12);
    expect(indexOfAnchor([a, b, c], anchor)).toBe(1);
    expect(indexOfAnchor([c, a, b], anchor)).toBe(2);
    expect(indexOfAnchor([c, a], anchor)).toBe(-1);
  });
});
