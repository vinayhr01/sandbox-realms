import { describe, expect, it } from 'vitest';
import { speciesIndex } from '../../src/content/beasts.ts';
import { seedStartingBeasts, spawnBeing } from '../../src/sim/beings/system.ts';
import { hamletsOf, settlementsStep } from '../../src/sim/settlements/adapter.ts';
import { BUILDING_BY_ID, type BuildingDef } from '../../src/sim/settlements/catalogue.ts';
import { PARCEL } from '../../src/sim/settlements/hamlet.ts';
import { shootStep } from '../../src/sim/projectiles.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';
import type { Sim } from '../../src/sim/sim.ts';

// 10 section 9 (Watchspire): five flint_dart bolts per volley, a first scan at 20 ticks, then a reload of 60 plus 0..60 ticks.
// The scan runs in shootStep, so the test calls shootStep once per sim tick.

/** Seeds tried in order until one places a hamlet (placement depends on the seed; as items-gear.test.ts). */
const SEEDS = [4242, 1, 555, 31337, 2024];

/**
 * A realm whose first hamlet holds a watchspire at its parcel corner, with every other Being moved off the map.
 * Returns the sim and the first parcel's origin tile.
 */
function hamletWithWatchspire(): { sim: Sim; x: number; y: number } {
  for (const seed of SEEDS) {
    const sim = generateRealm({ seed, sizeStep: 2, template: 'continent' }).sim;
    seedStartingBeasts(sim, 12);
    settlementsStep(sim);
    const h = hamletsOf(sim)[0];
    if (!h) continue;
    const s = sim.beings.store;
    for (let k = 0; k < s.size; k++) {
      const slot = s.at(k);
      s.x[slot] = -PARCEL * 100;
      s.y[slot] = -PARCEL * 100;
    }
    const perAxis = sim.realm.side / PARCEL;
    const parcel = [...h.parcels][0] ?? 0;
    const x = (parcel % perAxis) * PARCEL;
    const y = Math.floor(parcel / perAxis) * PARCEL;
    h.buildings.push({ def: BUILDING_BY_ID.get('watchspire') as BuildingDef, x, y });
    return { sim, x, y };
  }
  throw new Error('no seed placed a hamlet');
}

/** Puts one undead Being (boneshambler: hostile to Folk, so a watchspire target) on the first walkable tile of the parcel. */
function placeTarget(sim: Sim, x: number, y: number): void {
  for (let ty = y; ty < y + PARCEL; ty++) {
    for (let tx = x; tx < x + PARCEL; tx++) {
      if (spawnBeing(sim, speciesIndex('boneshambler'), tx, ty, true) >= 0) return;
    }
  }
  throw new Error('no walkable tile for the target');
}

function bolts(sim: Sim): number {
  return sim.projectiles.filter((p) => p.kind === 'flint_dart').length;
}

describe('watchspire bolts (10 section 9)', () => {
  it('the first scan is at 20 ticks, and its volley is five bolts', () => {
    const { sim, x, y } = hamletWithWatchspire();
    placeTarget(sim, x, y);
    for (let t = 0; t < 20; t++) shootStep(sim);
    expect(bolts(sim)).toBe(0);
    shootStep(sim);
    expect(bolts(sim)).toBe(5);
  });

  it('after a volley the next scan waits 60 to 120 ticks', () => {
    const { sim, x, y } = hamletWithWatchspire();
    placeTarget(sim, x, y);
    for (let t = 0; t < 21; t++) shootStep(sim);
    expect(bolts(sim)).toBe(5);
    // The reload is 60 + randomInt(0, 60) ticks, so no second volley lands in the first 60 ticks after the first.
    for (let t = 0; t < 60; t++) shootStep(sim);
    expect(bolts(sim)).toBe(5);
    // The reload is at most 120 ticks, so the second volley has landed by tick 142 (and the third not before tick 143).
    for (let t = 0; t < 61; t++) shootStep(sim);
    expect(bolts(sim)).toBe(10);
  });

  it('with no hostile Being in its patches, a scan fires nothing', () => {
    const { sim } = hamletWithWatchspire();
    for (let t = 0; t < 40; t++) shootStep(sim);
    expect(bolts(sim)).toBe(0);
  });
});
