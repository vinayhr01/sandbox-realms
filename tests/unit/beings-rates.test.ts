import { describe, expect, it } from 'vitest';
import { ground } from '../../src/content/grounds.ts';
import { FLORA } from '../../src/sim/flora.ts';
import { Sim } from '../../src/sim/sim.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';
import { litterRoll, spawnBeing, stepBeings } from '../../src/sim/beings/system.ts';
import { SPECIES } from '../../src/content/beasts.ts';

function walkableSpawn(sim: Sim, species: number): number {
  for (let y = 0; y < sim.realm.side; y++) {
    for (let x = 0; x < sim.realm.side; x++) {
      const slot = spawnBeing(sim, species, x, y, true);
      if (slot >= 0) return slot;
    }
  }
  return -1;
}

describe('beast movement rate (07 section 7.1)', () => {
  it('accumulates pace * 0.2 / 20 movement units per tick', () => {
    const { sim } = generateRealm({ seed: 7, sizeStep: 3, template: 'continent' });
    const idx = SPECIES.findIndex((s) => s.id === 'thistlehart');
    expect(idx).toBeGreaterThanOrEqual(0);
    const slot = walkableSpawn(sim, idx);
    expect(slot).toBeGreaterThanOrEqual(0);
    sim.beings.store.moveAcc[slot] = 0;
    stepBeings(sim);
    // pace * 0.2 / 20 units per tick: pace 15 is 0.15 tiles per tick (3 tiles per second). The pace is the Being's
    // assembled pace (05 section 3, with its morph's spd, 18a 3.5), not the raw species row: a thicket morph is x1.05.
    const i = (sim.beings.store.y[slot] ?? 0) * sim.realm.side + (sim.beings.store.x[slot] ?? 0);
    const tree = (sim.realm.flora[i] ?? 0) > 0 && FLORA[(sim.realm.flora[i] ?? 0) - 1]?.kind === "tree" && sim.rules.isOn("tangle_roots") ? 0.8 : 1;
    const walk = ground(sim.realm.ground[i] ?? 0).walk * tree;
    const pace = sim.beings.store.paceA[slot] ?? 0;
    expect(sim.beings.store.moveAcc[slot]).toBeCloseTo(pace * 0.2 / 20 * walk, 5);
    expect(SPECIES[idx]!.pace * 0.2 / 20 * 100).toBeCloseTo(SPECIES[idx]!.pace, 5);
  });
});

describe('litter (06 section 6.4)', () => {
  const sim = new Sim(11, 3);

  function meanBabies(brood: number, trials: number): number {
    let total = 0;
    for (let k = 0; k < trials; k++) total += litterRoll(sim, brood);
    return total / trials;
  }

  it('gives one baby when there are no extra rolls', () => {
    expect(meanBabies(0, 1000)).toBe(1);
  });

  it('rolls once per brood slot: brood 3 gives about 1.28625 extra babies', () => {
    expect(meanBabies(3, 20000) - 1).toBeCloseTo(1.28625, 1);
  });
});
