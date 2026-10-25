import { describe, expect, it } from 'vitest';
import { SPECIES, speciesIndex } from '../../src/content/beasts.ts';
import { spawnBeing, spawnFolk } from '../../src/sim/beings/system.ts';
import { BUILDING_BY_ID, type BuildingDef } from '../../src/sim/settlements/catalogue.ts';
import { hamletSoldierLimit } from '../../src/sim/settlements/garrison-adapter.ts';
import { createHamlet, goodFoundingParcel, PARCEL, type Hamlet } from '../../src/sim/settlements/hamlet.ts';
import { assignJobs, QUOTA_ORDER, SOLDIER_PER_ROUND, type JobTargetCounts, type Workforce } from '../../src/sim/settlements/jobs.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';
import type { Sim } from '../../src/sim/sim.ts';

// 09 section 8 quota step 7 (the soldier line of the job round) and 10 section 8 (the soldier limit, hamletSoldierLimit).

const NO_TARGETS: JobTargetCounts = { soldierLimit: 0, herbs: 0, deposits: 0, ironDeposits: 0, hives: 0, tillWork: 0, ruins: 0, manure: 0 };
const house = BUILDING_BY_ID.get('house') as BuildingDef;

function adults(n: number): Workforce {
  return { adults: n, children: 0, leaders: 0, childLabour: false };
}

/** A realm with no beasts and no hamlets: only the test's own Beings exist. */
function emptyRealm(seed: number): Sim {
  return generateRealm({ seed, sizeStep: 2, template: 'continent', startingBeasts: false }).sim;
}

/** Parcel index of a land parcel that could found a hamlet. */
function goodParcel(sim: Sim): number {
  const perAxis = sim.realm.side / PARCEL;
  for (let p = 0; p < perAxis * perAxis; p++) if (goodFoundingParcel(sim.realm, p, new Set())) return p;
  throw new Error('no founding parcel in the realm');
}

/** Spawns `n` Beings through `spawn` on the first walkable tile of a parcel (spawn returns -1 off walkable ground). */
function spawnInParcel(sim: Sim, parcel: number, n: number, spawn: (x: number, y: number) => number): void {
  const perAxis = sim.realm.side / PARCEL;
  const px = (parcel % perAxis) * PARCEL;
  const py = Math.floor(parcel / perAxis) * PARCEL;
  let at: [number, number] | undefined;
  for (let y = py; y < py + PARCEL && !at; y++) {
    for (let x = px; x < px + PARCEL && !at; x++) if (spawn(x, y) >= 0) at = [x, y];
  }
  if (!at) throw new Error('no walkable tile in the parcel');
  for (let k = 1; k < n; k++) spawn(at[0], at[1]);
}

describe('soldier line of the job round (09 section 8, quota step 7)', () => {
  it('the soldier sits after iron miners and before roadwrights in the quota order', () => {
    const at = QUOTA_ORDER.indexOf('soldier');
    expect(at).toBeGreaterThan(QUOTA_ORDER.indexOf('iron_miner'));
    expect(at).toBeLessThan(QUOTA_ORDER.indexOf('roadwright'));
    expect(SOLDIER_PER_ROUND).toBe(2);
  });

  it('each round adds two soldier slots, up to the limit', () => {
    const h: Hamlet = createHamlet(0, 30);
    expect(assignJobs(h, { ...NO_TARGETS, soldierLimit: 5 }, adults(30)).get('soldier')).toBe(5);
    expect(assignJobs(h, { ...NO_TARGETS, soldierLimit: 6 }, adults(30)).get('soldier')).toBe(6);
  });

  it('a zero limit posts no soldiers', () => {
    const h: Hamlet = createHamlet(0, 30);
    expect(assignJobs(h, NO_TARGETS, adults(30)).has('soldier')).toBe(false);
  });

  it('soldier slots take no folk: the folk jobs are the same with and without them', () => {
    const h: Hamlet = createHamlet(0, 30);
    h.site = { def: house, x: 0, y: 0, progress: 0 };
    h.road = [1, 2];
    const without = assignJobs(h, NO_TARGETS, adults(30));
    const withSoldiers = assignJobs(h, { ...NO_TARGETS, soldierLimit: 6 }, adults(30));
    expect(without.get('builder')).toBe(3);
    expect(without.get('roadwright')).toBe(1);
    for (const [job, n] of without) expect(withSoldiers.get(job), job).toBe(n);
    expect(withSoldiers.get('soldier')).toBe(6);
  });

  it('soldiers are posted with no folk in the hamlet', () => {
    const h: Hamlet = createHamlet(0, 0);
    expect(assignJobs(h, { ...NO_TARGETS, soldierLimit: 4 }, adults(0)).get('soldier')).toBe(4);
  });
});

describe('hamletSoldierLimit (10 section 8, garrison-adapter)', () => {
  it('is 0 without the standing_armies rule, even with many adults', () => {
    const sim = emptyRealm(11);
    const parcel = goodParcel(sim);
    spawnInParcel(sim, parcel, 30, (x, y) => spawnFolk(sim, SPECIES.findIndex((s) => s.folk), x, y));
    sim.rules.set('standing_armies', false);
    expect(hamletSoldierLimit(sim, createHamlet(parcel, 30))).toBe(0);
  });

  it('is 0 at 15 adults or fewer, and floor(adults x 0.35) above that', () => {
    const sim = emptyRealm(11);
    const parcel = goodParcel(sim);
    const folk = SPECIES.findIndex((s) => s.folk);
    spawnInParcel(sim, parcel, 15, (x, y) => spawnFolk(sim, folk, x, y));
    expect(hamletSoldierLimit(sim, createHamlet(parcel, 15))).toBe(0);
    spawnInParcel(sim, parcel, 1, (x, y) => spawnFolk(sim, folk, x, y));
    expect(hamletSoldierLimit(sim, createHamlet(parcel, 16))).toBe(5);
  });

  it('a garrison building adds its slot bonus on top', () => {
    const sim = emptyRealm(11);
    const parcel = goodParcel(sim);
    const folk = SPECIES.findIndex((s) => s.folk);
    spawnInParcel(sim, parcel, 16, (x, y) => spawnFolk(sim, folk, x, y));
    const h = createHamlet(parcel, 16);
    h.buildings.push({ def: { ...house, id: 'garrison' }, x: 0, y: 0 });
    expect(hamletSoldierLimit(sim, h)).toBe(7);
  });

  it('counts only folk in the hamlet parcels, not other beings', () => {
    const sim = emptyRealm(11);
    const parcel = goodParcel(sim);
    const folk = SPECIES.findIndex((s) => s.folk);
    spawnInParcel(sim, parcel, 16, (x, y) => spawnFolk(sim, folk, x, y));
    spawnInParcel(sim, parcel, 40, (x, y) => spawnBeing(sim, speciesIndex('boneshambler'), x, y, true));
    expect(hamletSoldierLimit(sim, createHamlet(parcel, 16))).toBe(5);
  });
});
