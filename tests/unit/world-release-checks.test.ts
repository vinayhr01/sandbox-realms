import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/sim/sim.ts';
import { Realm } from '../../src/sim/realm.ts';
import { G } from '../../src/content/grounds.ts';
import { createRng } from '../../src/shared/rng.ts';
import { detonateChain, explode, groundHardness } from '../../src/sim/explosions.ts';
import { fireSweep, startFire } from '../../src/sim/terrain/fire.ts';
import { rainDrop, seaRefill } from '../../src/sim/terrain/water.ts';
import { connectivityStep, connected, landmassCount, settleConnectivity } from '../../src/sim/terrain/connectivity.ts';

/*
 * Code checks for the world and input release. Written from 01 section 14 (tests 1, 4, 6, 7) and
 * 04 section 14 (tests 2, 5, 6, 7). Not run in this release: they are here so the next test pass
 * can run them as they stand. Statistical checks use wide bands on purpose.
 */

describe('partitions (01 section 14 test 1)', () => {
  it('side, patch and parcel counts for sizeStep 4', () => {
    const r = new Realm(1, 4);
    expect(r.side).toBe(256);
    expect(r.patchesPerAxis).toBe(16);
    expect(r.parcelsPerAxis).toBe(32);
    expect(r.patchAt(255, 255)).toBe(255);
    expect(r.parcelAt(7, 8)).toBe(32);
  });
});

describe('parcel counters (01 section 14 test 4)', () => {
  it('match a fresh recount after 10,000 random ground and cover writes (seed 42)', () => {
    const r = new Realm(42, 2);
    const rng = createRng(42);
    const kinds = [G.deepmere, G.shoal, G.lowloam, G.highloam, G.knoll, G.crag, G.molten_1, G.strand];
    for (let k = 0; k < 10000; k++) {
      const i = rng.int(r.tileCount);
      if (rng.next() < 0.8) r.setGround(i, kinds[rng.int(kinds.length)] ?? G.deepmere);
      else r.setCover(i, rng.int(4));
    }
    expect(r.parcelCountersAgree()).toBe(true);
  });
});

describe('connectivity (01 section 14 tests 6 and 7)', () => {
  it('a one-tile strait of shoal splits two land blocks; one lowloam tile merges them; reverting splits', () => {
    const r = new Realm(7, 1); // 64 x 64, all deepmere at start
    for (let y = 10; y <= 20; y++) {
      for (let x = 4; x <= 30; x++) r.setGround(y * r.side + x, G.lowloam);
      for (let x = 32; x <= 58; x++) r.setGround(y * r.side + x, G.lowloam);
    }
    r.setGround(15 * r.side + 31, G.shoal);
    settleConnectivity(r);
    expect(landmassCount(r, 'land')).toBe(2);
    r.setGround(15 * r.side + 31, G.lowloam);
    settleConnectivity(r);
    expect(landmassCount(r, 'land')).toBe(1);
    r.setGround(15 * r.side + 31, G.shoal);
    settleConnectivity(r);
    expect(landmassCount(r, 'land')).toBe(2);
  });

  it('two diagonal land tiles with both orthogonal corners crag are not linked', () => {
    const r = new Realm(8, 1);
    const a = 10 * r.side + 10;
    const b = 11 * r.side + 11;
    r.setGround(a, G.lowloam);
    r.setGround(b, G.lowloam);
    r.setGround(10 * r.side + 11, G.crag);
    r.setGround(11 * r.side + 10, G.crag);
    settleConnectivity(r);
    expect(connected(r, a, b)).toBe(false);
  });

  it('control: the same diagonal pair with open corners is linked', () => {
    const r = new Realm(8, 1);
    const a = 10 * r.side + 10;
    const b = 11 * r.side + 11;
    r.setGround(a, G.lowloam);
    r.setGround(b, G.lowloam);
    settleConnectivity(r);
    expect(connected(r, a, b)).toBe(true);
  });

  it('the scheduler runs on multiples of 8 ticks and is deferred while busy', () => {
    const r = new Realm(9, 1);
    r.setGround(5 * r.side + 5, G.lowloam);
    connectivityStep(r, 9, false);
    expect(r.connDirty.size).toBeGreaterThan(0);
    connectivityStep(r, 16, true);
    expect(r.connDirty.size).toBeGreaterThan(0);
    connectivityStep(r, 16, false);
    expect(r.connDirty.size).toBe(0);
  });
});

describe('blast hardness (04 section 14 test 2)', () => {
  it('hardness table: sea 0, pits 2, soil and rock 3, devices 0', () => {
    expect(groundHardness(G.shoal)).toBe(0);
    expect(groundHardness(G.dug_shoal)).toBe(2);
    expect(groundHardness(G.lowloam)).toBe(3);
    expect(groundHardness(G.pinnacle)).toBe(3);
    expect(groundHardness(G.thunderpowder)).toBe(0);
  });

  it('spark (power 1) leaves lowloam alone and lowers shoal; blast (power 3) lowers lowloam and pinnacle', () => {
    const sim = new Sim(11, 2);
    const r = sim.realm;
    const ctx = sim.explosionContext();
    const soil = 20 * r.side + 20;
    r.setGround(soil, G.lowloam);
    explode(ctx, 20, 20, 1, 50, 'Explosion', -1, 1);
    expect(r.ground[soil]).toBe(G.lowloam);

    const sea = 30 * r.side + 30;
    r.setGround(sea, G.shoal);
    explode(ctx, 30, 30, 1, 50, 'Explosion', -1, 1);
    expect(r.ground[sea]).toBe(G.dug_shoal);

    r.setGround(soil, G.lowloam);
    explode(ctx, 20, 20, 1, 100, 'Explosion', -1, 3);
    expect(r.ground[soil]).toBe(G.strand);

    const peak = 40 * r.side + 40;
    r.setGround(peak, G.pinnacle);
    explode(ctx, 40, 40, 1, 100, 'Explosion', -1, 3);
    expect(r.ground[peak]).toBe(G.crag);
  });

  it('a covered tile loses its cover first and keeps its ground in that blast', () => {
    const sim = new Sim(12, 2);
    const r = sim.realm;
    const i = 24 * r.side + 24;
    r.setGround(i, G.lowloam);
    r.setCover(i, 1);
    explode(sim.explosionContext(), 24, 24, 1, 100, 'Explosion', -1, 3);
    expect(r.cover[i]).toBe(0);
    expect(r.ground[i]).toBe(G.lowloam);
  });
});

describe('charge chains (04 section 14 test 5)', () => {
  it('a 3x3 patch of thunderpowder detonates once from one trigger, nine times, and no more', () => {
    const sim = new Sim(13, 2);
    const r = sim.realm;
    const cx = 60;
    const cy = 60;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) r.setGround((cy + dy) * r.side + cx + dx, G.thunderpowder);
    }
    const detonated = detonateChain(sim.explosionContext(), cy * r.side + cx);
    expect(detonated).toBe(9);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) expect(r.ground[(cy + dy) * r.side + cx + dx]).toBe(G.cinderscar);
    }
  });
});

describe('refill (04 section 14 test 6)', () => {
  it('a dug_shoal beside shoal fills in a run with probability 0.7 (wide band over many tiles)', () => {
    const sim = new Sim(14, 2);
    const r = sim.realm;
    const pairs: number[] = [];
    for (let y = 2; y < r.side - 2; y += 4) {
      for (let x = 2; x < r.side - 3; x += 4) {
        const sea = y * r.side + x;
        const pit = y * r.side + x + 1;
        r.setGround(sea, G.shoal);
        r.setGround(pit, G.dug_shoal);
        pairs.push(pit);
      }
    }
    seaRefill(sim);
    const filled = pairs.filter((p) => r.ground[p] === G.shoal).length;
    const share = filled / pairs.length;
    expect(share).toBeGreaterThan(0.64);
    expect(share).toBeLessThan(0.76);
  });

  it('an inland hollow never fills over the 2000-tick schedule, and a rain drop fills it at once', () => {
    const sim = new Sim(15, 2);
    const r = sim.realm;
    const i = 50 * r.side + 50;
    r.setGround(i, G.lowloam);
    for (let k = 0; k < 4; k++) {
      const j = [i - 1, i + 1, i - r.side, i + r.side][k] ?? i;
      r.setGround(j, G.lowloam);
    }
    r.setGround(i, G.dug_shoal);
    for (let run = 0; run < 2000 / 4; run++) seaRefill(sim);
    expect(r.ground[i]).toBe(G.dug_shoal);
    rainDrop(sim, i);
    expect(r.ground[i]).toBe(G.shoal);
  });
});

describe('fire pacing (04 section 14 test 7)', () => {
  it('no neighbour ignites before 40 ticks of age', () => {
    const sim = new Sim(3, 2);
    const r = sim.realm;
    const c = 60 * r.side + 60;
    const ring = [c - 1, c + 1, c - r.side, c + r.side];
    r.setGround(c, G.tilled);
    for (const j of ring) r.setGround(j, G.tilled);
    startFire(sim, c, true);
    const start = sim.tick;
    for (const age of [20, 39]) {
      sim.tick = start + age;
      fireSweep(sim);
      for (const j of ring) expect(r.hasFlag(j, 1 << 1)).toBe(false);
    }
  });

  it('extinguish share at age 120 is near 0.12 + 0.3 * 120 / 500 and at age 500 every fire is out', () => {
    const sim = new Sim(3, 2);
    const r = sim.realm;
    const tiles: number[] = [];
    for (let y = 2; y < r.side - 2; y += 2) {
      for (let x = 2; x < r.side - 2; x += 2) {
        const i = y * r.side + x;
        r.setGround(i, G.tilled);
        tiles.push(i);
      }
    }
    const start = sim.tick;
    for (const i of tiles) startFire(sim, i, true);
    sim.tick = start + 120;
    for (const i of tiles) r.fireStart[i] = start;
    fireSweep(sim);
    const out = tiles.filter((i) => !r.hasFlag(i, 1 << 1)).length / tiles.length;
    expect(out).toBeGreaterThan(0.192 - 0.04);
    expect(out).toBeLessThan(0.192 + 0.04);

    sim.tick = start + 500;
    fireSweep(sim);
    expect(tiles.some((i) => r.hasFlag(i, 1 << 1))).toBe(false);
  });
});
