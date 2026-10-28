import { describe, expect, it } from 'vitest';
import type { HamletRow } from '../../src/shared/protocol.ts';
import { SNAPSHOT_MAX_BYTES } from '../../src/shared/protocol.ts';
import { buildSnapshot, fitSnapshot, snapshotBytes } from '../../src/sim/snapshot.ts';
import { seedStartingBeasts } from '../../src/sim/beings/system.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';

describe('townCount', () => {
  it('counts every town, and fitSnapshot keeps the exact count when hamlet rows are cut', () => {
    const sim = generateRealm({ seed: 20240601, sizeStep: 2, template: 'continent' }).sim;
    seedStartingBeasts(sim, 40);
    for (let t = 0; t < 200; t++) sim.step();
    const base = buildSnapshot(sim);
    expect(base.townCount).toBe(base.hamlets.filter((h) => h.tier === 'town').length);

    // A realm big enough that the hamlet rows must be halved: 400 rows, every other one a town.
    const rows: HamletRow[] = Array.from({ length: 400 }, (_, i) => ({
      name: `Hamlet ${i + 1} with a long placeholder name to push the message size up`,
      folk: 40,
      buildings: 3,
      parcels: 9,
      mood: 0,
      tier: i % 2 === 0 ? 'town' : 'hamlet',
    }));
    const big = { ...base, hamlets: rows, hamletCount: rows.length, townCount: 200 };
    expect(snapshotBytes(big)).toBeGreaterThan(SNAPSHOT_MAX_BYTES);

    const fitted = fitSnapshot(big);
    expect(fitted.truncated).toBe(true);
    expect(fitted.hamlets.length).toBeLessThan(rows.length);
    expect(fitted.hamletCount).toBe(400);
    expect(fitted.townCount).toBe(200);
  });
});
