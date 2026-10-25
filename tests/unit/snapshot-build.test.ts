import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS } from '../../src/content/achievements.ts';
import { SPECIES } from '../../src/content/beasts.ts';
import { Cmd, Ev, PROTOCOL_VERSION, SNAPSHOT_MAX_BYTES, SNAPSHOT_VERSION } from '../../src/shared/protocol.ts';
import { addBorder, addDominion, snapshotDominions } from '../../src/sim/dominions/adapter.ts';
import { addFamily } from '../../src/sim/culture/culture.ts';
import { hamletsOf } from '../../src/sim/settlements/adapter.ts';
import { buildSnapshot, fitSnapshot, snapshotBytes, snapshotDue, SNAPSHOT_TICKS } from '../../src/sim/snapshot.ts';
import { seedStartingBeasts } from '../../src/sim/beings/system.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';
import type { Sim } from '../../src/sim/sim.ts';

/** A seeded realm with beasts and a few hundred ticks of play, so every system has run. */
function playedSim(seed = 20240601, ticks = 200): Sim {
  const sim = generateRealm({ seed, sizeStep: 2, template: 'continent' }).sim;
  seedStartingBeasts(sim, 40);
  for (let t = 0; t < ticks; t++) sim.step();
  return sim;
}

describe('protocol constants', () => {
  it('pins the snapshot message kinds and versions', () => {
    expect(PROTOCOL_VERSION).toBe(3);
    expect(SNAPSHOT_VERSION).toBe(1);
    expect(Cmd.Snapshot).toBe(9);
    expect(Ev.Snapshot).toBe(106);
    expect(SNAPSHOT_MAX_BYTES).toBe(32 * 1024);
  });
});

describe('snapshot cadence', () => {
  it('is two sim-seconds of ticks', () => {
    expect(SNAPSHOT_TICKS).toBe(40);
  });

  it('is due before the first snapshot, then every SNAPSHOT_TICKS', () => {
    expect(snapshotDue(-1, 0)).toBe(true);
    expect(snapshotDue(100, 139)).toBe(false);
    expect(snapshotDue(100, 140)).toBe(true);
  });

  it('is due after a new realm resets the tick below the last snapshot', () => {
    expect(snapshotDue(500, 0)).toBe(true);
  });
});

describe('buildSnapshot', () => {
  it('population counts every living being once, by species', () => {
    const sim = playedSim();
    const snap = buildSnapshot(sim);
    const p = snap.population;
    expect(p.total).toBe(sim.beings.store.size);
    expect(p.folk + p.wild).toBe(p.total);
    const summed = p.species.reduce((n, row) => n + row.count, 0);
    expect(summed).toBe(p.total);
    for (const row of p.species) {
      expect(row.count).toBeGreaterThan(0);
      expect(SPECIES.some((s) => s.id === row.id && s.name === row.name)).toBe(true);
    }
  });

  it('copies the lifetime counters and set sizes exactly', () => {
    const sim = playedSim();
    sim.lifetime.counters['deaths'] = 7;
    sim.lifetime.sets['agesReached'] = ['age_a', 'age_b'];
    const snap = buildSnapshot(sim);
    expect(snap.counters).toEqual(sim.lifetime.counters);
    expect(snap.sets['agesReached']).toBe(2);
  });

  it('lists every achievement with its unlock state and progress', () => {
    const sim = playedSim();
    const first = ACHIEVEMENTS[0]?.id ?? '';
    sim.unlocked.add(first);
    const snap = buildSnapshot(sim);
    expect(snap.achievements.map((a) => a.id)).toEqual(ACHIEVEMENTS.map((a) => a.id));
    expect(snap.achievements[0]?.unlocked).toBe(true);
    expect(snap.achievements.filter((a) => a.unlocked).length).toBe(sim.unlocked.size);
    for (const row of snap.achievements) expect(row.unlocked).toBe(sim.unlocked.has(row.id));
    for (const row of snap.achievements) expect(row.value).toBeGreaterThanOrEqual(0);
  });

  it('reports codex totals from the discoveries set', () => {
    const sim = playedSim();
    sim.lifetime.sets['discoveries'] = ['trait:a', 'trait:b', 'species:x'];
    const snap = buildSnapshot(sim);
    expect(snap.codex.discoveries).toBe(3);
    expect(snap.codex.traits).toBe(2);
    expect(snap.codex.species).toBe(1);
    expect(snap.codex.traitTotal).toBeGreaterThan(0);
    expect(snap.codex.rosterTotal).toBeGreaterThan(0);
  });

  it('describes dominions with relation counts, neighbours and war state', () => {
    const sim = generateRealm({ seed: 7, sizeStep: 2, template: 'continent' }).sim;
    addDominion(sim, 1, 10, [0, 1]);
    addDominion(sim, 2, 4, [2]);
    addDominion(sim, 3, 6, [3]);
    addBorder(sim, 1, 2, 'war');
    addBorder(sim, 2, 3, 'tension');
    const snap = buildSnapshot(sim);
    expect(snap.dominionCount).toBe(3);
    const d1 = snap.dominions.find((d) => d.id === 1);
    expect(d1).toMatchObject({ name: 'Dominion 1', parcels: 2, strength: 10, neighbours: 1, peace: 1, tension: 0, war: 1, atWar: true, campaignTarget: -1 });
    const d2 = snap.dominions.find((d) => d.id === 2);
    expect(d2).toMatchObject({ neighbours: 2, peace: 0, tension: 1, war: 1, atWar: true });
    const d3 = snap.dominions.find((d) => d.id === 3);
    expect(d3).toMatchObject({ neighbours: 1, peace: 1, tension: 1, war: 0, atWar: false });
  });

  it('describes hamlets with folk, building and parcel counts', () => {
    const sim = playedSim();
    const hamlets = hamletsOf(sim);
    const snap = buildSnapshot(sim);
    expect(snap.hamletCount).toBe(hamlets.length);
    expect(snap.hamlets.length).toBe(hamlets.length);
    hamlets.forEach((h, i) => {
      expect(snap.hamlets[i]).toMatchObject({ name: `Hamlet ${i + 1}`, folk: h.folk, buildings: h.buildings.length, parcels: h.parcels.size });
    });
  });

  it('summarises culture: customs, creeds, dialects, intrigues and families', () => {
    const sim = playedSim();
    sim.culture.dialects.push({ group: 1, word: 3 }, { group: 2, word: 3 }, { group: 3, word: 5 });
    sim.culture.creeds.push({ id: 1, holders: new Set([1, 2]) });
    sim.culture.intrigues.push(
      { id: 1, kind: 'scheme', group: 1, progress: 0, goal: 5, outcome: null },
      { id: 2, kind: 'rebellion', group: 2, progress: 5, goal: 5, outcome: 'success' },
    );
    addFamily(sim.culture, 9, 1, 2);
    const snap = buildSnapshot(sim);
    expect(snap.culture.dialects).toBe(2);
    expect(snap.culture.dialectGroups).toBe(3);
    expect(snap.culture.creedHolders).toBe(2);
    expect(snap.culture.intriguesActive).toBe(1);
    expect(snap.culture.intriguesResolved).toBe(1);
    expect(snap.culture.families).toBe(1);
  });

  it('is deterministic: two identical runs give identical snapshots', () => {
    const a = JSON.stringify(buildSnapshot(playedSim()));
    const b = JSON.stringify(buildSnapshot(playedSim()));
    expect(a).toBe(b);
  });

  it('is read-only: the state hash, lifetime record and dominion state are untouched', () => {
    const sim = playedSim();
    const hashBefore = sim.stateHash();
    const lifetimeBefore = JSON.stringify(sim.lifetime);
    const tickBefore = sim.tick;
    buildSnapshot(sim);
    expect(sim.stateHash()).toBe(hashBefore);
    expect(JSON.stringify(sim.lifetime)).toBe(lifetimeBefore);
    expect(sim.tick).toBe(tickBefore);
  });

  it('leaves the dominion state exactly as it was', () => {
    const sim = generateRealm({ seed: 7, sizeStep: 2, template: 'continent' }).sim;
    addDominion(sim, 1, 10, [0]);
    const before = JSON.stringify(snapshotDominions(sim));
    buildSnapshot(sim);
    expect(JSON.stringify(snapshotDominions(sim))).toBe(before);
  });

  it('stays under the message budget even with the largest dominion count', () => {
    const sim = generateRealm({ seed: 11, sizeStep: 4, template: 'continent' }).sim;
    for (let id = 1; id <= 255; id++) addDominion(sim, id, 50, [id - 1]);
    for (let id = 1; id < 255; id++) addBorder(sim, id, id + 1, 'war');
    const snap = buildSnapshot(sim);
    expect(snapshotBytes(snap)).toBeLessThanOrEqual(SNAPSHOT_MAX_BYTES);
    expect(snap.dominionCount).toBe(255);
    expect(snap.truncated).toBe(true);
    expect(snap.dominions.length).toBeLessThan(255);
  });

  it('fitSnapshot leaves a small snapshot as it is', () => {
    const snap = buildSnapshot(playedSim());
    expect(fitSnapshot(snap)).toBe(snap);
    expect(snap.truncated).toBe(false);
  });
});
