import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../../src/shared/protocol.ts';
import { SNAPSHOT_MAX_BYTES } from '../../src/shared/protocol.ts';
import { seedStartingBeasts } from '../../src/sim/beings/system.ts';
import { snapshotBytes, buildSnapshot } from '../../src/sim/snapshot.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';
import { clanRowsOf } from '../../src/ui/specWindows.ts';

function snapAfter(ticks: number): Snapshot {
  const sim = generateRealm({ seed: 20240601, sizeStep: 2, template: 'continent' }).sim;
  seedStartingBeasts(sim, 40);
  for (let t = 0; t < ticks; t++) sim.step();
  return buildSnapshot(sim);
}

describe('clan snapshot block and list rows', () => {
  it('lists every clan on record with counts that match the rows', () => {
    const snap = snapAfter(1200);
    const block = snap.clans;
    expect(block).toBeDefined();
    if (!block) return;
    expect(block.count).toBeGreaterThan(0);
    expect(block.rows.length).toBe(Math.min(block.count, 16));
    expect(block.living).toBeLessThanOrEqual(block.count);
    expect(snapshotBytes(snap)).toBeLessThanOrEqual(SNAPSHOT_MAX_BYTES);
  });

  it('turns each clan row into a list row that opens the clan inspector', () => {
    const snap = snapAfter(1200);
    const rows = clanRowsOf(snap);
    expect(rows).toHaveLength(snap.clans?.rows.length ?? -1);
    const first = rows[0];
    expect(first).toBeDefined();
    if (!first) return;
    expect(first.inspector).toBe('win_clan');
    expect(first.params).toEqual({ id: first.id });
    expect(first.title.length).toBeGreaterThan(0);
    expect(first.detail).toMatch(/member|Extinct/);
  });

  it('an older snapshot without the clan block gives an empty list', () => {
    const snap = snapAfter(10);
    const { clans: _unused, ...rest } = snap;
    expect(clanRowsOf(rest as Snapshot)).toEqual([]);
  });
});
