import { describe, expect, it } from 'vitest';
import { killBeing, seedStartingBeasts } from '../../src/sim/beings/system.ts';
import { MAX_BEINGS } from '../../src/sim/beings/store.ts';
import { CLAN_DEFAULT_LIMIT, CLAN_FOUND_MIN, CLAN_SCAN_TICKS } from '../../src/sim/clans/clans.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';

/** A realm seeded with starting beasts, stepped for `ticks`. Same setup as the golden replay. */
function run(seed: number, ticks: number): Sim {
  const sim = generateRealm({ seed, sizeStep: 2, template: 'continent' }).sim;
  seedStartingBeasts(sim, 40);
  for (let t = 0; t < ticks; t++) sim.step();
  return sim;
}

/** Steps until a clan scan has just run (the scan runs inside step, on the same tick). */
function stepToScan(sim: Sim): void {
  do sim.step();
  while (!sim.due('clans', CLAN_SCAN_TICKS));
}

function livingOfStrain(sim: Sim, strain: number): number[] {
  const s = sim.beings.store;
  const out: number[] = [];
  for (let k = 0; k < s.size; k++) {
    const slot = s.at(k);
    if ((s.strain[slot] ?? 0) === strain) out.push(slot);
  }
  return out;
}

describe('clans: founding from strains', () => {
  it('founds clans from strains with enough living members, at most one per strain', () => {
    const sim = run(20240601, 1200);
    const clans = sim.clans.list;
    expect(clans.length).toBeGreaterThan(0);
    const strains = clans.map((c) => c.strain);
    expect(new Set(strains).size).toBe(strains.length);
    const names = clans.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const c of clans) {
      expect(c.limit).toBe(CLAN_DEFAULT_LIMIT);
      expect(c.foundedTick).toBeLessThanOrEqual(sim.tick);
      expect(c.id).toBeLessThan(sim.clans.next);
    }
  });

  it('a clan member count and chief match the strain at each scan', () => {
    const sim = run(20240601, 1000);
    stepToScan(sim);
    const s = sim.beings.store;
    for (const c of sim.clans.list) {
      if (c.extinctTick >= 0) continue;
      const living = livingOfStrain(sim, c.strain);
      expect(c.members).toBe(living.length);
      expect(living.length).toBeGreaterThanOrEqual(1);
      // The chief is the oldest living member (birth tick, then lowest slot).
      const oldest = [...living].sort((a, b) => (s.born[a] ?? 0) - (s.born[b] ?? 0) || a - b)[0] ?? -1;
      expect(c.chief % MAX_BEINGS).toBe(oldest);
      expect(c.chiefBorn).toBe(s.born[oldest] ?? 0);
    }
  });

  it('is deterministic: the same seed gives the same clan records', () => {
    const a = run(20240601, 1200);
    const b = run(20240601, 1200);
    expect(JSON.stringify(a.clans)).toBe(JSON.stringify(b.clans));
    expect(a.stateHash()).toBe(b.stateHash());
  });
});

describe('clans: extinction', () => {
  it('a clan whose strain has no living member is extinct for good and is not founded again', () => {
    const sim = run(20240601, 1000);
    stepToScan(sim);
    const clan = sim.clans.list.find((c) => c.extinctTick < 0);
    expect(clan).toBeDefined();
    if (!clan) return;
    const count = sim.clans.list.length;
    for (const slot of livingOfStrain(sim, clan.strain)) killBeing(sim, slot, 'combat');
    stepToScan(sim);
    expect(clan.extinctTick).toBeGreaterThanOrEqual(0);
    expect(clan.members).toBe(0);
    expect(clan.chief).toBe(-1);
    expect(sim.clans.list.filter((c) => c.strain === clan.strain)).toHaveLength(1);
    expect(sim.clans.list.length).toBeGreaterThanOrEqual(count);
  });
});

describe('clans: ten-year run', () => {
  it('forms clans in a 10-year run from the default seed', () => {
    const sim = run(20240601, 12000);
    expect(sim.clans.list.length).toBeGreaterThan(0);
    expect(sim.clans.list.filter((c) => c.extinctTick < 0).length).toBeGreaterThan(0);
  }, 120000);
});
