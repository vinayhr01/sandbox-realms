import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/sim/sim.ts';
import { YEAR_TICKS } from '../../src/shared/constants.ts';
import { addBorder, addDominion, dominionState, parcelsPerAxis, UNOWNED } from '../../src/sim/dominions/adapter.ts';

/** Two dominions split a continent down the middle; dominion 1 is much stronger. */
function continent(seed: number, strengths: [number, number], relation: 'war' | 'peace' = 'war'): Sim {
  const sim = new Sim(seed, 2);
  const perAxis = parcelsPerAxis(sim);
  const left: number[] = [];
  const right: number[] = [];
  for (let py = 0; py < perAxis; py++) {
    for (let px = 0; px < perAxis; px++) {
      (px < perAxis / 2 ? left : right).push(py * perAxis + px);
    }
  }
  addDominion(sim, 1, strengths[0], left);
  addDominion(sim, 2, strengths[1], right);
  addBorder(sim, 1, 2, relation);
  return sim;
}

function ownerCounts(sim: Sim): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const id of dominionState(sim).owner) counts[id] = (counts[id] ?? 0) + 1;
  return counts;
}

describe('dominions wiring', () => {
  it('a sim with no dominions is untouched: no dominion RNG stream is created', () => {
    const sim = new Sim(11, 1);
    for (let t = 0; t < 200; t++) sim.step();
    expect(dominionState(sim).dominions).toHaveLength(0);
    expect(Object.keys(sim.streamState().streams)).not.toContain('dominions');
    expect(dominionState(sim).owner.every((id) => id === UNOWNED)).toBe(true);
  });

  it('after a few sim years a campaign moves parcels between dominions in the running sim', () => {
    const sim = continent(31, [100, 40]);
    const before = ownerCounts(sim);
    const weak = dominionState(sim).dominions[1];
    expect(weak).toBeDefined();
    let campaignSeen = false;
    for (let t = 0; t < 3 * YEAR_TICKS; t++) {
      sim.step();
      if (dominionState(sim).dominions.some((d) => d.target >= 0)) campaignSeen = true;
    }
    const after = ownerCounts(sim);
    expect(campaignSeen).toBe(true);
    expect(weak?.strength).toBe(0);
    expect(after[1]).toBe((before[1] ?? 0) + 1);
    expect(after[2]).toBe((before[2] ?? 0) - 1);

    // The owner bytes and the dominion parcel sets agree on every moved parcel.
    const state = dominionState(sim);
    for (const d of state.dominions) {
      for (const p of d.parcels) expect(state.owner[p]).toBe(d.id);
    }
  });

  it('with the parley rule off no campaign starts and no parcel changes hands', () => {
    const sim = continent(31, [100, 40]);
    sim.rules.set('parley', false);
    const before = Array.from(dominionState(sim).owner);
    for (let t = 0; t < 3 * YEAR_TICKS; t++) sim.step();
    const state = dominionState(sim);
    expect(state.dominions.every((d) => d.target === -1 && d.campaignSince === -1)).toBe(true);
    expect(state.relations.get(1, 2)).toBe('war');
    expect(state.dominions.map((d) => d.strength)).toEqual([100, 40]);
    expect(Array.from(state.owner)).toEqual(before);
  });

  it('dominions at peace never fight in the running sim', () => {
    const sim = continent(31, [100, 40], 'peace');
    for (let t = 0; t < YEAR_TICKS; t++) sim.step();
    const state = dominionState(sim);
    expect(state.dominions.map((d) => d.strength)).toEqual([100, 40]);
    expect(state.dominions.every((d) => d.target === -1)).toBe(true);
  });

  it('the dominion stream is seeded from the realm, so two identical sims stay identical', () => {
    const a = continent(77, [100, 40]);
    const b = continent(77, [100, 40]);
    for (let t = 0; t < YEAR_TICKS; t++) {
      a.step();
      b.step();
    }
    expect(a.stateHash()).toBe(b.stateHash());
    expect(Array.from(dominionState(a).owner)).toEqual(Array.from(dominionState(b).owner));
  });
});
