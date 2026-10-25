import { describe, expect, it } from 'vitest';
import { decodeChronicle, encodeChronicle } from '../../src/sim/chronicle.ts';
import { Sim } from '../../src/sim/sim.ts';
import { SPECIES, speciesIndex } from '../../src/content/beasts.ts';
import { G } from '../../src/content/grounds.ts';
import { addStrainTrait, isAwakened } from '../../src/sim/beings/strains.ts';
import { killBeing, spawnBeing, stepBeings } from '../../src/sim/beings/system.ts';

/** A small lowloam field so spawns and walks are never blocked. */
function field(seed: number): Sim {
  const sim = new Sim(seed, 2);
  for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) sim.realm.setGround(y * sim.realm.side + x, G.lowloam);
  return sim;
}

describe('strain traits (18b section 0 exclusion groups)', () => {
  it('a second trait of an exclusion group replaces the first', () => {
    const traits: string[] = [];
    expect(addStrainTrait(traits, 'gestation_brief')).toBe(true);
    expect(addStrainTrait(traits, 'gestation_mid')).toBe(true);
    expect(traits).toEqual(['gestation_mid']);
  });

  it('a strategy trait replaces another strategy, and a method trait does not touch a strategy', () => {
    const traits: string[] = [];
    addStrainTrait(traits, 'birth_live');
    addStrainTrait(traits, 'kin_pairs');
    addStrainTrait(traits, 'birth_egg');
    expect(traits.sort()).toEqual(['birth_egg', 'kin_pairs']);
  });

  it('refuses unknown and already held traits', () => {
    const traits: string[] = ['cheerful'];
    expect(addStrainTrait(traits, 'not_a_trait')).toBe(false);
    expect(addStrainTrait(traits, 'cheerful')).toBe(false);
  });

  it('a strain is awakened only with all four brain organs (18b sapience rule)', () => {
    const organs = ['memory_lobe', 'fear_organ', 'speech_organ', 'planner_lobe'];
    expect(isAwakened(organs)).toBe(true);
    expect(isAwakened(organs.slice(1))).toBe(false);
  });
});

describe('strains and counters (05 section 2 and 6.1)', () => {
  it('adults within 40 tiles of a same-species member share its strain; 41 tiles away founds a new one', () => {
    const sim = field(3);
    const sp = speciesIndex('thistlehart');
    const a = spawnBeing(sim, sp, 10, 10, true);
    const near = spawnBeing(sim, sp, 49, 10, true); // 39 tiles
    const far = spawnBeing(sim, sp, 10, 52, true); // 42 tiles from a and 42 from near (Chebyshev)
    const s = sim.beings.store;
    expect(s.strain[near]).toBe(s.strain[a]);
    expect(s.strain[far]).not.toBe(s.strain[a]);
    expect(sim.beings.strains.size).toBe(2);
  });

  it('an adult spawn counts as newAdults on its strain, not born', () => {
    const sim = field(4);
    const slot = spawnBeing(sim, speciesIndex('burrfleece'), 20, 20, true);
    const strain = sim.beings.strains.get(sim.beings.store.strain[slot] ?? 0)!;
    // The 05 section 2 counters; the strain also holds died and killed (round 8), which this test does not cover.
    expect(strain.counters).toMatchObject({ born: 0, newAdults: 1, reproduced: 0 });
    expect(strain.species).toBe(speciesIndex('burrfleece'));
  });

  it('a newborn joins its bearer strain, links to the bearer, and the bearer counts it as reproduced', () => {
    const sim = field(5);
    const sp = speciesIndex('burrfleece');
    const mother = spawnBeing(sim, sp, 30, 30, true);
    const father = spawnBeing(sim, sp, 31, 30, true);
    const s = sim.beings.store;
    s.female[mother] = 1;
    s.female[father] = 0;
    for (let t = 0; t < 4000 && sim.beings.stats.births < 1; t++) {
      s.fuel[mother] = 100;
      s.fuel[father] = 100;
      stepBeings(sim);
      sim.tick++;
    }
    expect(sim.beings.stats.births).toBeGreaterThanOrEqual(1);
    let child = -1;
    for (let k = 0; k < s.size; k++) {
      const slot = s.at(k);
      if (s.parent[slot] === mother && s.hasLiveParent(slot)) child = slot;
    }
    expect(child).toBeGreaterThanOrEqual(0);
    expect(s.strain[child]).toBe(s.strain[mother]);
    const strain = sim.beings.strains.get(s.strain[mother] ?? 0)!;
    expect(strain.counters.born).toBeGreaterThanOrEqual(1);
    expect(strain.counters.reproduced).toBeGreaterThanOrEqual(1);
    expect(s.childCount[mother]).toBeGreaterThanOrEqual(1);
  });

  it('a child death lowers its bearer count, and a parent death orphans its children (generation check)', () => {
    const sim = field(6);
    const sp = speciesIndex('burrfleece');
    const mother = spawnBeing(sim, sp, 40, 40, true);
    const child = spawnBeing(sim, sp, 41, 40, false, mother);
    const s = sim.beings.store;
    expect(s.childCount[mother]).toBe(1);
    expect(s.hasLiveParent(child)).toBe(true);
    killBeing(sim, child, 'combat');
    expect(s.childCount[mother]).toBe(0);

    const second = spawnBeing(sim, sp, 41, 41, false, mother);
    expect(s.childCount[mother]).toBe(1);
    killBeing(sim, mother, 'combat');
    expect(s.hasLiveParent(second)).toBe(false);
    killBeing(sim, second, 'combat');
    expect(s.childCount[mother]).toBe(1); // the dead bearer's count is not touched again
  });

  it('a newborn copies the species stats at birth and grows up to the adult stats', () => {
    const sim = field(7);
    const sp = speciesIndex('gloamfang');
    const mother = spawnBeing(sim, sp, 50, 50, true);
    const child = spawnBeing(sim, sp, 51, 50, false, mother);
    const s = sim.beings.store;
    expect(s.baby[child]).toBe(1);
    expect(s.maxVit[child]).toBe(Math.floor(SPECIES[sp]!.vitality / 2));
    s.born[child] = sim.tick - Math.ceil((s.adultA[child] ?? 1) * 1200);
    for (let t = 0; t < 60; t++) {
      stepBeings(sim);
      sim.tick++;
    }
    expect(s.baby[child]).toBe(0);
    expect(s.maxVit[child]).toBe(SPECIES[sp]!.vitality);
  });
});

describe('save round trip (chronicle schema 3)', () => {
  it('keeps parent links, strains, counters and aptitudes across a save', () => {
    const sim = field(8);
    const sp = speciesIndex('burrfleece');
    const mother = spawnBeing(sim, sp, 60, 60, true);
    const child = spawnBeing(sim, sp, 61, 60, false, mother);
    sim.beings.store.attrs[child * 4] = 7;
    const back = decodeChronicle(encodeChronicle(sim));
    const s = back.beings.store;
    expect(s.parent[child]).toBe(mother);
    expect(s.hasLiveParent(child)).toBe(true);
    expect(s.childCount[mother]).toBe(1);
    expect(s.strain[child]).toBe(sim.beings.store.strain[child]);
    expect(back.beings.strains.get(s.strain[child] ?? 0)?.counters).toEqual(sim.beings.strains.get(s.strain[child] ?? 0)?.counters);
    expect(s.attrs[child * 4]).toBe(7);
  });

  it('a resumed run matches an uninterrupted run once parent links exist', () => {
    const a = field(9);
    const sp = speciesIndex('burrfleece');
    const m = spawnBeing(a, sp, 20, 20, true);
    a.beings.store.female[m] = 1;
    const b = decodeChronicle(encodeChronicle(a));
    for (let t = 0; t < 300; t++) {
      stepBeings(a);
      a.tick++;
      stepBeings(b);
      b.tick++;
    }
    expect(b.beings.stats).toEqual(a.beings.stats);
    expect(b.beings.strains.size).toBe(a.beings.strains.size);
  });
});
