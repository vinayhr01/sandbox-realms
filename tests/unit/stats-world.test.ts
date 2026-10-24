import { describe, expect, it } from 'vitest';
import { G } from '../../src/content/grounds.ts';
import { addDominion } from '../../src/sim/dominions/adapter.ts';
import { recordStat, unlockAchievements } from '../../src/sim/stats-hooks.ts';
import { emptyStats } from '../../src/sim/stats.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';
import { Sim } from '../../src/sim/sim.ts';
import { YEAR_TICKS } from '../../src/shared/constants.ts';

/** Sim-building and multi-year runs take a few seconds on a loaded machine. */
const SLOW = 60_000;

function seededSim(seed = 4242): Sim {
  return generateRealm({ seed, sizeStep: 2, template: 'continent' }).sim;
}

/** Index of tile (x, y) in the realm arrays. */
function at(sim: Sim, x: number, y: number): number {
  return y * sim.realm.side + x;
}

/** Seeded realms already have pinnacles; clear them so a test controls the summit tiles. */
function clearSummits(sim: Sim): void {
  for (let i = 0; i < sim.realm.ground.length; i++) if (sim.realm.ground[i] === G.pinnacle) sim.realm.ground[i] = G.lowloam;
}

describe('world observation feeds the gauges', () => {
  it('a 6 by 6 block of summit tiles unlocks Peak Maker', () => {
    const sim = seededSim();
    clearSummits(sim);
    for (let y = 10; y < 16; y++) for (let x = 10; x < 16; x++) sim.realm.ground[at(sim, x, y)] = G.pinnacle;
    const fresh = unlockAchievements(sim);
    expect(sim.lifetime.counters['summitRegionMax']).toBe(36);
    expect(fresh).toContain('ach_peak_maker');
  }, SLOW);

  it('a summit region counts its largest connected part, not the total', () => {
    const sim = seededSim();
    clearSummits(sim);
    // A 6 by 6 block (36 tiles) and a separate 4 by 4 block (16 tiles): 52 pinnacles, two regions.
    for (let y = 10; y < 16; y++) for (let x = 10; x < 16; x++) sim.realm.ground[at(sim, x, y)] = G.pinnacle;
    for (let y = 40; y < 44; y++) for (let x = 40; x < 44; x++) sim.realm.ground[at(sim, x, y)] = G.pinnacle;
    unlockAchievements(sim);
    expect(sim.lifetime.counters['summitRegionMax']).toBe(36);
  }, SLOW);

  it('lava and burning tiles feed their gauges at once', () => {
    const sim = seededSim();
    for (let i = 0; i < 2000; i++) sim.realm.molten.add(i);
    for (let i = 0; i < 1000; i++) sim.realm.burning.add(i);
    unlockAchievements(sim);
    expect(sim.lifetime.counters['lavaTilesMax']).toBe(2000);
    expect(sim.lifetime.counters['burningTilesMax']).toBe(1000);
  }, SLOW);

  it('a skyfall burst of ten inside one minute is recorded; spread out it is not', () => {
    const burst = seededSim();
    for (let k = 0; k < 10; k++) {
      burst.tick = 1000 + k * 60;
      recordStat(burst, { kind: 'calamity.fired', calamity: 'skyfall' });
    }
    expect(burst.lifetime.counters['skyfallBurstMax']).toBe(10);

    const spread = seededSim();
    for (let k = 0; k < 10; k++) {
      spread.tick = 1000 + k * 60 * 60;
      recordStat(spread, { kind: 'calamity.fired', calamity: 'skyfall' });
    }
    expect(spread.lifetime.counters['skyfallBurstMax']).toBe(1);
  }, SLOW);

  it("a campaign that has run 100 sim years unlocks Hundred Years' Grudge", () => {
    const sim = seededSim();
    sim.tick = 500 * YEAR_TICKS;
    const a = addDominion(sim, 1, 10);
    addDominion(sim, 2, 10);
    a.target = 2;
    a.campaignSince = sim.tick - 100 * YEAR_TICKS;
    expect(unlockAchievements(sim)).toContain('ach_hundred_year_grudge');
    expect(sim.lifetime.counters['campaignYearsMax']).toBe(100);
    expect(sim.lifetime.counters['campaignsStarted'] ?? 0).toBe(1);
  }, SLOW);

  it('observation is deterministic: two identical runs give identical counters', () => {
    const a = seededSim(77);
    const b = seededSim(77);
    for (let t = 0; t < 2 * YEAR_TICKS; t++) {
      a.step();
      b.step();
    }
    expect(a.lifetime).toEqual(b.lifetime);
    expect([...a.unlocked]).toEqual([...b.unlocked]);
  }, SLOW);

  it('records the ages a Realm passes through as a set', () => {
    const sim = seededSim();
    unlockAchievements(sim);
    expect(sim.lifetime.sets['agesReached']).toContain(sim.ages.current);
  });

  it('an empty record starts with no gauge values set', () => {
    expect(emptyStats()).toEqual({ counters: {}, sets: {} });
  });
});
