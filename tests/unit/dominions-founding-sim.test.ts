import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/sim/sim.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';
import { seedStartingBeasts } from '../../src/sim/beings/system.ts';
import { YEAR_TICKS } from '../../src/shared/constants.ts';
import { dominionState, restoreDominions, snapshotDominions } from '../../src/sim/dominions/adapter.ts';
import { TRUCE_TICKS } from '../../src/sim/dominions/founding.ts';

/** A small continent with starting beasts, as the soak seeds it (the tests use a smaller realm for speed). */
function realm(seed: number): Sim {
  const { sim } = generateRealm({ seed, sizeStep: 2, template: 'continent', startingBeasts: true });
  for (let round = 0; round < 400 && sim.beings.store.size < 1000; round++) seedStartingBeasts(sim, 40);
  return sim;
}

describe('dominion founding in the running sim', () => {
  it('settled regions found dominions during a run, with borders and relations set', () => {
    const sim = realm(555);
    for (let t = 0; t < 10 * YEAR_TICKS; t++) sim.step();
    const s = dominionState(sim);
    expect(s.dominions.length).toBeGreaterThan(0);
    // Every founded dominion holds parcels that the owner bytes agree on.
    for (const d of s.dominions) {
      expect(d.parcels.size).toBeGreaterThan(0);
      for (const p of d.parcels) expect(s.owner[p]).toBe(d.id);
    }
    // Every border joins two dominions and has a relation the yearly pass wrote.
    for (const [a, b] of s.borders) {
      expect(s.dominions.some((d) => d.id === a)).toBe(true);
      expect(s.dominions.some((d) => d.id === b)).toBe(true);
      expect(['peace', 'tension', 'war']).toContain(s.relations.get(a, b));
    }
  }, 120000);

  it('two identical runs found the same dominions, borders and relations', () => {
    const a = realm(555);
    const b = realm(555);
    for (let t = 0; t < 4 * YEAR_TICKS; t++) {
      a.step();
      b.step();
    }
    expect(JSON.stringify(snapshotDominions(a))).toBe(JSON.stringify(snapshotDominions(b)));
    expect(a.stateHash()).toBe(b.stateHash());
  }, 120000);

  it('the truce and declaration flags survive a snapshot and restore', () => {
    const sim = realm(555);
    const s = dominionState(sim);
    s.truce.set('1:2', { a: 1, b: 2, until: 3 * TRUCE_TICKS, declared: true });
    const snap = snapshotDominions(sim);
    expect(snap?.truce).toEqual([{ a: 1, b: 2, until: 3 * TRUCE_TICKS, declared: true }]);
    restoreDominions(sim, JSON.parse(JSON.stringify(snap)));
    expect(snapshotDominions(sim)?.truce).toEqual([{ a: 1, b: 2, until: 3 * TRUCE_TICKS, declared: true }]);
  });

  it('a save without truces restores with none', () => {
    const sim = realm(555);
    dominionState(sim).truce.set('1:2', { a: 1, b: 2, until: 1, declared: false });
    const snap = snapshotDominions(sim);
    expect(snap).not.toBeNull();
    if (!snap) return;
    const old = { dominions: snap.dominions, relations: snap.relations, borders: snap.borders, owner: snap.owner };
    restoreDominions(sim, old);
    expect(dominionState(sim).truce.size).toBe(0);
  });
});
