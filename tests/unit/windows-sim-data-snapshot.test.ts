import { describe, expect, it } from 'vitest';
import { SNAPSHOT_DETAIL_ROWS, SNAPSHOT_MAX_BYTES } from '../../src/shared/protocol.ts';
import { addBorder, addDominion } from '../../src/sim/dominions/adapter.ts';
import { buildSnapshot, snapshotBytes } from '../../src/sim/snapshot.ts';
import { seedStartingBeasts } from '../../src/sim/beings/system.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';
import type { Sim } from '../../src/sim/sim.ts';

function emptyRealm(seed = 20240601): Sim {
  return generateRealm({ seed, sizeStep: 2, template: 'continent' }).sim;
}

describe('snapshot pacts block', () => {
  it('is empty when the realm has no dominions', () => {
    const snap = buildSnapshot(emptyRealm());
    expect(snap.pacts).toEqual({ count: 0, rows: [] });
  });

  it('lists border pairs at peace, once each, lower id first', () => {
    const sim = emptyRealm();
    addDominion(sim, 1, 50, [0, 1]);
    addDominion(sim, 2, 30, [2]);
    addDominion(sim, 3, 20, [3]);
    addBorder(sim, 2, 1, 'peace');
    addBorder(sim, 1, 3);
    addBorder(sim, 2, 3, 'war');
    const block = buildSnapshot(sim).pacts;
    expect(block?.count).toBe(2);
    expect(block?.rows.map((r) => [r.a, r.b])).toEqual([
      [1, 2],
      [1, 3],
    ]);
    const first = block?.rows[0];
    expect(first).toMatchObject({ id: 1 * 256 + 2, nameA: 'Dominion 1', nameB: 'Dominion 2', strengthA: 50, strengthB: 30, parcelsA: 2, parcelsB: 1 });
  });

  it('keeps the exact count and caps the rows; the snapshot stays under the byte budget', () => {
    const sim = emptyRealm();
    const n = SNAPSHOT_DETAIL_ROWS + 9;
    for (let id = 1; id <= n; id++) addDominion(sim, id, 10);
    for (let id = 1; id < n; id++) addBorder(sim, id, id + 1);
    const snap = buildSnapshot(sim);
    expect(snap.pacts?.count).toBe(n - 1);
    expect(snap.pacts?.rows.length).toBe(SNAPSHOT_DETAIL_ROWS);
    expect(snapshotBytes(snap)).toBeLessThanOrEqual(SNAPSHOT_MAX_BYTES);
  });

  it('reads only: building the snapshot leaves the state hash alone', () => {
    const sim = emptyRealm();
    seedStartingBeasts(sim, 20);
    addDominion(sim, 1, 50, [0]);
    addDominion(sim, 2, 30, [1]);
    addBorder(sim, 1, 2);
    const before = sim.stateHash();
    buildSnapshot(sim);
    buildSnapshot(sim);
    expect(sim.stateHash()).toBe(before);
  });
});
