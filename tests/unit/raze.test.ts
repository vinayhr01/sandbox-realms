import { describe, expect, it } from 'vitest';
import { razeStep, type RazeContext } from '../../src/sim/dominions/capture.ts';
import type { Dominion } from '../../src/sim/dominions/types.ts';

// Parcel grid of 4 x 4: hamlet 0 sits on parcel 0 (empty), hamlet 1 on parcel 5 (inhabited), both held by dominion 1.
function ctx(folk0: number, beings: number[]): { c: RazeContext; owner: Uint8Array; evicted: [number[], number][]; dom: Dominion } {
  const owner = new Uint8Array(16);
  owner[0] = 1;
  owner[5] = 1;
  const dom: Dominion = { id: 1, parcels: new Set([0, 5]), strength: 10, target: -1, campaignSince: -1 };
  const evicted: [number[], number][] = [];
  const c: RazeContext = {
    perAxis: 4,
    hamlets: [
      { parcels: new Set([0]), folk: folk0 },
      { parcels: new Set([5]), folk: 6 },
    ],
    owner,
    dominions: [dom],
    ownerOf: (parcels) => owner[[...parcels][0] ?? 0] ?? 0,
    beingsOn: () => beings,
    evict: (slots, anchor) => evicted.push([[...slots], anchor]),
    feelRazed: () => {},
    isCapital: () => false,
  };
  return { c, owner, evicted, dom };
}

describe('raze check (10 section 7, owner rule: empty hamlet)', () => {
  it('razes a hamlet with no folk, frees its parcels and evicts the beings to the nearest hamlet', () => {
    const { c, owner, evicted, dom } = ctx(0, [3, 4]);
    const falls = razeStep(c, [0, 1]);
    expect(falls).toEqual([{ anchor: 0, loser: 1, evicted: 2, capital: false }]);
    expect(owner[0]).toBe(0);
    expect(dom.parcels.has(0)).toBe(false);
    expect(evicted).toEqual([[[3, 4], 5]]);
    expect(owner[5]).toBe(1);
  });

  it('leaves a hamlet alone while any folk remain', () => {
    const { c, owner } = ctx(1, []);
    expect(razeStep(c, [0])).toEqual([]);
    expect(owner[0]).toBe(1);
  });
});
