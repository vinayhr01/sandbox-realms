import { describe, expect, it } from 'vitest';
import { SPECIES } from '../../src/content/beasts.ts';
import { DECISION_INDEX } from '../../src/content/decisions.ts';
import { FLORA_BY_ID, floraCode } from '../../src/sim/flora.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';
import { seedStartingBeasts, spawnBeing, stepBeings } from '../../src/sim/beings/system.ts';
import type { Sim } from '../../src/sim/sim.ts';

/** Biome ids present anywhere on the realm. */
function biomesPresent(sim: Sim): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < sim.realm.tileCount; i++) {
    const biome = sim.biomeAt(i);
    if (biome) out.add(biome.id);
  }
  return out;
}

describe('seedStartingBeasts biome placement', () => {
  it('places beasts only of species with a biome present on the realm', () => {
    const { sim } = generateRealm({ seed: 99, sizeStep: 4, template: 'continent', startingBeasts: false });
    const present = biomesPresent(sim);
    expect(present.size).toBeGreaterThan(0);

    const placed = seedStartingBeasts(sim, 40);
    const store = sim.beings.store;

    expect(placed).toBeGreaterThanOrEqual(20);
    expect(store.size).toBeGreaterThanOrEqual(20);

    for (let j = 0; j < store.size; j++) {
      const slot = store.at(j);
      const def = SPECIES[store.species[slot] ?? -1];
      expect(def, `beast ${slot} has a known species`).toBeDefined();
      const hasBiome = def!.biomes.some((b) => present.has(b));
      expect(hasBiome, `${def!.id} at (${store.x[slot]},${store.y[slot]}) has a biome on this realm`).toBe(true);
    }
  });
});

describe('omnivore diet', () => {
  it('mudsnuffler and cluckling are omnivores', () => {
    const mud = SPECIES.find((s) => s.id === 'mudsnuffler');
    const clu = SPECIES.find((s) => s.id === 'cluckling');
    expect(mud?.diet).toBe('omni');
    expect(clu?.diet).toBe('omni');
  });

  it('a hungry cluckling standing on flora gains fuel after one tick', () => {
    const { sim } = generateRealm({ seed: 99, sizeStep: 4, template: 'continent', startingBeasts: false });
    const speciesIdx = SPECIES.findIndex((s) => s.id === 'cluckling');
    expect(speciesIdx).toBeGreaterThanOrEqual(0);

    // Find a walkable tile for the cluckling by trying spawns in a fixed scan order.
    let slot = -1;
    let tile = -1;
    for (let i = 0; i < sim.realm.tileCount && slot < 0; i++) {
      const x = i % sim.realm.side;
      const y = Math.floor(i / sim.realm.side);
      slot = spawnBeing(sim, speciesIdx, x, y, true);
      if (slot >= 0) tile = i;
    }
    expect(slot).toBeGreaterThanOrEqual(0);

    const store = sim.beings.store;
    store.fuel[slot] = 0;
    sim.realm.setFlora(tile, floraCode('herb'), 0);
    expect(sim.realm.flora[tile]).toBe((FLORA_BY_ID.get('herb') ?? 0) + 1);
    // Close 5 added `reflect` (tier 2, weight 2.5). Under the tier rule (07 section 3.5) one decision in five lets every
    // candidate compete by weight, and `reflect` can then take the single softmax draw, so an unpinned decision no longer
    // reliably picks eat_grass (DECISIONS.md, "Test regressions close 12"). The test pins the running task to eat_grass,
    // which the decide override layer runs first, so it checks the eating itself.
    sim.beings.task[slot] = DECISION_INDEX.get('eat_grass') ?? -1;

    const before = store.fuel[slot] ?? 0;
    stepBeings(sim);
    expect(store.alive[slot]).toBe(1);
    expect(store.fuel[slot] ?? 0).toBeGreaterThan(before);
  });
});
