import { describe, expect, it } from 'vitest';
import { SNAPSHOT_DETAIL_ROWS, SNAPSHOT_MAX_BYTES } from '../../src/shared/protocol.ts';
import { buildSnapshot, snapshotBytes } from '../../src/sim/snapshot.ts';
import { seedStartingBeasts } from '../../src/sim/beings/system.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';
import type { Sim } from '../../src/sim/sim.ts';

/** A seeded realm with beasts and some play, so beings and counters exist. */
function playedSim(ticks = 200): Sim {
  const sim = generateRealm({ seed: 20240601, sizeStep: 2, template: 'continent' }).sim;
  seedStartingBeasts(sim, 40);
  for (let t = 0; t < ticks; t++) sim.step();
  return sim;
}

describe('snapshot notable rows (beings and structures)', () => {
  it('lists the oldest living beings, capped, with exact totals', () => {
    const sim = playedSim();
    const snap = buildSnapshot(sim);
    const notable = snap.detail?.notable;
    expect(notable).toBeDefined();
    if (!notable) return;
    expect(notable.beingCount).toBe(snap.population.total);
    expect(notable.beings.length).toBe(Math.min(SNAPSHOT_DETAIL_ROWS, snap.population.total));
    expect(new Set(notable.beings.map((b) => b.id)).size).toBe(notable.beings.length);
    // Oldest first: ages never increase down the list.
    for (let i = 1; i < notable.beings.length; i++) {
      expect(notable.beings[i - 1]?.ageYears ?? 0).toBeGreaterThanOrEqual(notable.beings[i]?.ageYears ?? 0);
    }
    for (const b of notable.beings) {
      expect(b.species.length).toBeGreaterThan(0);
      expect(b.ageYears).toBeGreaterThanOrEqual(0);
    }
  });

  it('gives each hamlet building its tile id, hamlet index and totals', () => {
    const snap = buildSnapshot(playedSim());
    const notable = snap.detail?.notable;
    if (!notable) throw new Error('notable rows missing');
    const hamletBuildings = snap.hamlets.reduce((n, h) => n + h.buildings, 0);
    expect(notable.structureCount).toBe(hamletBuildings);
    expect(notable.structures.length).toBe(Math.min(SNAPSHOT_DETAIL_ROWS, notable.structureCount));
    for (const s of notable.structures) {
      expect(s.id).toBe(s.y * 1024 + s.x);
      expect(s.hamlet).toBeGreaterThanOrEqual(0);
      expect(s.hamlet).toBeLessThan(snap.hamlets.length);
    }
  });

  it('keeps the snapshot under the budget', () => {
    expect(snapshotBytes(buildSnapshot(playedSim()))).toBeLessThan(SNAPSHOT_MAX_BYTES);
  });

  it('reads only: building the snapshot leaves the state hash and the tick unchanged', () => {
    const sim = playedSim(120);
    const hash = sim.stateHash();
    const tick = sim.tick;
    buildSnapshot(sim);
    buildSnapshot(sim);
    expect(sim.stateHash()).toBe(hash);
    expect(sim.tick).toBe(tick);
  });
});
