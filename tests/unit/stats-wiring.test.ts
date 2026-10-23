import { describe, expect, it } from 'vitest';
import { decodeChronicle, encodeChronicle } from '../../src/sim/chronicle.ts';
import { emptyStats } from '../../src/sim/stats.ts';
import { recordStat, unlockAchievements } from '../../src/sim/stats-hooks.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';
import { Sim } from '../../src/sim/sim.ts';
import { spawnBeing } from '../../src/sim/beings/system.ts';
import { SPECIES } from '../../src/content/beasts.ts';
import { G } from '../../src/content/grounds.ts';
import { YEAR_TICKS } from '../../src/shared/constants.ts';

function seededSim(seed = 4242): Sim {
  return generateRealm({ seed, sizeStep: 2, template: 'continent' }).sim;
}

function deathTotal(sim: Sim): number {
  return Object.entries(sim.lifetime.counters)
    .filter(([k]) => k.startsWith('deathsByCause.'))
    .reduce((sum, [, v]) => sum + v, 0);
}

describe('lifetime stats wiring', () => {
  it('a seeded run over three sim years counts births and at least one death', () => {
    // A fed pair of adults breeds; one unfed being starves. Both run for three sim years.
    const sim = new Sim(77, 2);
    const r = sim.realm;
    for (let y = 40; y < 50; y++) for (let x = 40; x < 50; x++) r.setGround(y * r.side + x, G.lowloam);
    const species = SPECIES.findIndex((sp) => sp.id === 'burrfleece');
    const pair: number[] = [0, 1].map((k) => {
      const slot = spawnBeing(sim, species, 45 + k, 45, true);
      sim.beings.store.female[slot] = k;
      return slot;
    });
    const starver = spawnBeing(sim, species, 41, 41, true);
    sim.beings.store.fuel[starver] = 0;
    sim.beings.store.vit[starver] = 2;
    for (let t = 0; t < 3 * YEAR_TICKS; t++) {
      for (const slot of pair) if (sim.beings.store.alive[slot] === 1) sim.beings.store.fuel[slot] = 100;
      sim.step();
    }
    expect(sim.lifetime.counters['beingsBorn'] ?? 0).toBeGreaterThan(0);
    expect(sim.lifetime.counters['deathsByCause.starved'] ?? 0).toBeGreaterThanOrEqual(1);
    expect(sim.lifetime.counters['deaths']).toBe(deathTotal(sim));
    expect(sim.lifetime.counters['simYearsElapsed']).toBeGreaterThanOrEqual(2);
  });

  it('clearing the lifetime record mid-run does not change the state hash', () => {
    const counted = seededSim(77);
    const bare = seededSim(77);
    bare.lifetime = emptyStats();
    for (let t = 0; t < 600; t++) {
      counted.step();
      bare.step();
    }
    expect(counted.stateHash()).toBe(bare.stateHash());
  });

  it('an unlocked achievement stays unlocked and unlocks only once', () => {
    const sim = seededSim();
    for (let t = 0; t < YEAR_TICKS + 20; t++) sim.step();
    expect(sim.unlocked.has('ach_first_year')).toBe(true);
    const size = sim.unlocked.size;

    sim.lifetime = emptyStats();
    for (let t = 0; t < 40; t++) sim.step();
    expect(sim.unlocked.has('ach_first_year')).toBe(true);
    expect(unlockAchievements(sim)).not.toContain('ach_first_year');
    expect(sim.unlocked.size).toBeGreaterThanOrEqual(size);
  });

  it('unlockAchievements returns each new id once and records sim years without double counting', () => {
    const sim = seededSim();
    sim.tick = 2 * YEAR_TICKS;
    const first = unlockAchievements(sim);
    expect(first).toContain('ach_first_year');
    expect(sim.lifetime.counters['simYearsElapsed']).toBe(2);
    expect(unlockAchievements(sim)).toEqual([]);
    expect(sim.lifetime.counters['simYearsElapsed']).toBe(2);
  });

  it('recordStat ignores auto events', () => {
    const sim = seededSim();
    recordStat(sim, { kind: 'power.used', power: 'x', auto: true });
    expect(sim.lifetime.counters['powersUsed']).toBeUndefined();
  });

  it('the chronicle round trip keeps stats and unlocked achievements', () => {
    const sim = seededSim();
    for (let t = 0; t < YEAR_TICKS + 40; t++) sim.step();
    const back = decodeChronicle(encodeChronicle(sim));
    expect(back.lifetime.counters).toEqual(sim.lifetime.counters);
    expect(back.lifetime.sets).toEqual(sim.lifetime.sets);
    expect([...back.unlocked]).toEqual([...sim.unlocked]);
    expect(back.unlocked.has('ach_first_year')).toBe(true);
  });
});
