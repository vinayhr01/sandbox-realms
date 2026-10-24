import { describe, expect, it } from 'vitest';
import { SPECIES } from '../../src/content/beasts.ts';
import { spawnFolk } from '../../src/sim/beings/system.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';
import { hamletsOf } from '../../src/sim/settlements/adapter.ts';
import { goodFoundingParcel, PARCEL } from '../../src/sim/settlements/hamlet.ts';
import { YEAR_TICKS } from '../../src/shared/constants.ts';
import type { Sim } from '../../src/sim/sim.ts';

/** A good founding parcel that no hamlet owns or borders, with its centre tile. */
function sitePick(sim: Sim): { parcel: number; x: number; y: number } {
  const perAxis = sim.realm.side / PARCEL;
  const owned = new Set<number>();
  for (const h of hamletsOf(sim)) for (const p of h.parcels) owned.add(p);
  for (let p = 0; p < perAxis * perAxis; p++) {
    if (!goodFoundingParcel(sim.realm, p, owned)) continue;
    return { parcel: p, x: (p % perAxis) * PARCEL + PARCEL / 2, y: Math.floor(p / perAxis) * PARCEL + PARCEL / 2 };
  }
  throw new Error('no founding site in the realm');
}

const FOLK = SPECIES.findIndex((s) => s.folk);

describe('settlements: MIN_BAND founding (09 section 2, path A)', () => {
  it('two adult Folk of one lineage found a hamlet on suitable ground within a year', () => {
    const sim = generateRealm({ seed: 7, sizeStep: 2, template: 'continent', startingBeasts: false }).sim;
    sim.step();
    const before = hamletsOf(sim).length;
    const site = sitePick(sim);
    expect(spawnFolk(sim, FOLK, site.x, site.y)).toBeGreaterThanOrEqual(0);
    expect(spawnFolk(sim, FOLK, site.x, site.y)).toBeGreaterThanOrEqual(0);
    for (let t = 0; t < YEAR_TICKS && hamletsOf(sim).length === before; t++) sim.step();
    expect(hamletsOf(sim).length).toBe(before + 1);
    expect(hamletsOf(sim).some((h) => h.parcels.has(site.parcel))).toBe(true);
  });

  it('a lone Folk founds nothing', () => {
    const sim = generateRealm({ seed: 7, sizeStep: 2, template: 'continent', startingBeasts: false }).sim;
    sim.step();
    const before = hamletsOf(sim).length;
    const site = sitePick(sim);
    expect(spawnFolk(sim, FOLK, site.x, site.y)).toBeGreaterThanOrEqual(0);
    for (let t = 0; t < YEAR_TICKS; t++) sim.step();
    expect(hamletsOf(sim).length).toBe(before);
  });
});
