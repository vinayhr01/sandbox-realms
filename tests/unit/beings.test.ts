import { describe, expect, it } from 'vitest';
import { generateRealm } from '../../src/sim/worldgen.ts';
import { spawnBeing, killBeing } from '../../src/sim/beings/system.ts';
import { Sim } from '../../src/sim/sim.ts';
import { G } from '../../src/content/grounds.ts';
import { SPECIES } from '../../src/content/beasts.ts';
import { BeingStore } from '../../src/sim/beings/store.ts';
import { createRng } from '../../src/shared/rng.ts';

function walkableSpot(sim: Sim, rng: ReturnType<typeof createRng>): [number, number] {
  for (let tries = 0; tries < 10000; tries++) {
    const x = rng.int(sim.realm.side);
    const y = rng.int(sim.realm.side);
    const g = sim.realm.ground[y * sim.realm.side + x] ?? 0;
    if (g === G.lowloam || g === G.highloam) return [x, y];
  }
  return [10, 10];
}

describe('being store', () => {
  it('generation counters make stale references fail after death and reuse', () => {
    const s = new BeingStore(8);
    const a = s.spawn(0, 1, 1, 0, 10, 100, 0);
    const gen = s.generation[a] ?? 0;
    expect(s.isCurrent(a, gen)).toBe(true);
    s.kill(a);
    expect(s.isCurrent(a, gen)).toBe(false);
    const b = s.spawn(0, 2, 2, 5, 10, 100, 0);
    expect(b).toBe(a);
    expect(s.isCurrent(a, gen)).toBe(false);
    expect(s.size).toBe(1);
  });

  it('returns -1 when full instead of throwing', () => {
    const s = new BeingStore(2);
    s.spawn(0, 0, 0, 0, 1, 1, 0);
    s.spawn(0, 0, 0, 0, 1, 1, 0);
    expect(s.spawn(0, 0, 0, 0, 1, 1, 0)).toBe(-1);
  });
});

describe('beings', () => {
  it('spawns on walkable land only and counts births', () => {
    const { sim } = generateRealm({ seed: 21, sizeStep: 2, template: 'continent', startingBeasts: false });
    const rng = createRng(4);
    const [x, y] = walkableSpot(sim, rng);
    expect(spawnBeing(sim, 0, x, y, true)).toBeGreaterThanOrEqual(0);
    const deep = spawnBeing(sim, 0, 0, 0, true);
    expect(deep).toBe(-1);
  });

  it('a being dies of starvation after its fuel runs out and the hunger rule is on', () => {
    const sim = new Sim(5, 1);
    const [x, y] = [20, 20];
    sim.realm.setGround(y * sim.realm.side + x, G.lowloam);
    const slot = spawnBeing(sim, 0, x, y, true);
    sim.beings.store.fuel[slot] = 0;
    sim.beings.store.vit[slot] = 2;
    for (let t = 0; t < 400; t++) sim.step();
    expect(sim.beings.store.alive[slot]).toBe(0);
    expect(sim.beings.stats.starved).toBeGreaterThanOrEqual(1);
  });

  it('killing a being frees its slot for reuse', () => {
    const sim = new Sim(6, 1);
    sim.realm.setGround(10 * sim.realm.side + 10, G.lowloam);
    const slot = spawnBeing(sim, 0, 10, 10, true);
    killBeing(sim, slot, 'age');
    expect(sim.beings.store.size).toBe(0);
  });

  it('species table is consistent: every hunter and prey name exists', () => {
    const ids = new Set(SPECIES.map((s) => s.id));
    for (const s of SPECIES) {
      for (const h of s.hunters) expect(ids.has(h)).toBe(true);
      for (const p of s.prey) expect(ids.has(p)).toBe(true);
    }
  });

  it("a fed pair of burrfleece produces offspring once they reach adulthood", () => {
    const sim = new Sim(77, 2);
    const r = sim.realm;
    for (let y = 40; y < 50; y++) for (let x = 40; x < 50; x++) r.setGround(y * r.side + x, G.lowloam);
    const species = SPECIES.findIndex((s) => s.id === "burrfleece");
    for (let k = 0; k < 2; k++) {
      const slot = spawnBeing(sim, species, 45 + k, 45, true);
      sim.beings.store.fuel[slot] = 100;
      sim.beings.store.female[slot] = k;
    }
    // Adults at about 5 years of age: spawn as adults but born at tick 0, then run the clock.
    for (let t = 0; t < 9000 && sim.beings.stats.births < 4; t++) {
      for (let k = 0; k < sim.beings.store.size; k++) {
        const slot = sim.beings.store.at(k);
        sim.beings.store.fuel[slot] = 100;
      }
      sim.step();
    }
    // 06 section 6.1: with the first litter alive (cap ceil(litter) = 2) the pair stops; one litter may
    // overshoot the cap by its brood. The old "more than two" held only while children never counted.
    expect(sim.beings.stats.births).toBeGreaterThanOrEqual(2);
    expect(sim.beings.stats.births).toBeLessThanOrEqual(3);
  });
});
