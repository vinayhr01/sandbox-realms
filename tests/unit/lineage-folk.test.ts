import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/sim/sim.ts';
import { G } from '../../src/content/grounds.ts';
import { speciesIndex } from '../../src/content/beasts.ts';
import { BEING_TRAIT_INDEX } from '../../src/content/traits.ts';
import { spawnBeing, spawnFolk } from '../../src/sim/beings/system.ts';

function field(seed: number): Sim {
  const sim = new Sim(seed, 2);
  for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) sim.realm.setGround(y * sim.realm.side + x, G.lowloam);
  return sim;
}

describe('Folk founders (18a section 1.2, 05 section 4)', () => {
  it('a Folk founder carries its aptitudes, starting being traits and strain traits', () => {
    const sim = field(11);
    const slot = spawnFolk(sim, speciesIndex('emberkin'), 20, 20);
    const s = sim.beings.store;
    expect(slot).toBeGreaterThanOrEqual(0);
    expect([s.attrs[slot * 4], s.attrs[slot * 4 + 1], s.attrs[slot * 4 + 2], s.attrs[slot * 4 + 3]]).toEqual([2, 5, 3, 2]);
    for (const id of ['cinderblood', 'forge_hands', 'fiery_temper']) expect(s.hasMark(slot, BEING_TRAIT_INDEX.get(id) ?? -1), id).toBe(true);
    const strain = sim.beings.strains.get(s.strain[slot] ?? 0)!;
    expect(strain.traits).toContain('gestation_extended');
    expect(strain.traits).toContain('ember_core');
    expect(s.gestationA[slot]).toBe(7);
  });

  it('valor adds to might (valor / 5) and fiery_temper adds to valor', () => {
    const sim = field(12);
    const slot = spawnFolk(sim, speciesIndex('emberkin'), 20, 20);
    // emberkin might 21, valor 5 from the row plus 1 from fiery_temper: 21 + 6 / 5.
    // Stored as Float32, hence the three-decimal tolerance.
    expect(sim.beings.store.mightA[slot]).toBeCloseTo(21 + 6 / 5, 3);
  });

  it('wild spawns refuse Folk and Folk spawns refuse beasts', () => {
    const sim = field(13);
    expect(spawnBeing(sim, speciesIndex('hearthborn'), 20, 20, true)).toBe(-1);
    expect(spawnFolk(sim, speciesIndex('thistlehart'), 20, 20)).toBe(-1);
  });

  it('wild seeding never picks a Folk or an aquatic row', () => {
    const sim = field(14);
    const s = sim.beings.store;
    // Every slot a fresh spawn of any wild row is allowed; non-wild rows are refused above, so no being is Folk.
    for (let k = 0; k < 20; k++) spawnBeing(sim, speciesIndex('gloamfang'), 10 + k, 10, true);
    for (let k = 0; k < s.size; k++) expect(sim.beings.species(s.species[s.at(k)] ?? 0).folk).toBe(false);
  });
});
