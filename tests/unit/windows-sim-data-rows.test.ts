import { afterEach, describe, expect, it } from 'vitest';
import type { Snapshot } from '../../src/shared/protocol.ts';
import { addBorder, addDominion } from '../../src/sim/dominions/adapter.ts';
import { buildSnapshot } from '../../src/sim/snapshot.ts';
import { seedStartingBeasts } from '../../src/sim/beings/system.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';
import { favouriteRowsOf, pactRowsOf } from '../../src/ui/specWindows.ts';
import { resetSessionMemory, setFavouriteBeing } from '../../src/ui/session-memory.ts';

afterEach(() => resetSessionMemory());

function realmWithPeace(): Snapshot {
  const sim = generateRealm({ seed: 99, sizeStep: 2, template: 'continent' }).sim;
  addDominion(sim, 4, 60, [0]);
  addDominion(sim, 7, 25, [1]);
  addBorder(sim, 4, 7, 'peace');
  return buildSnapshot(sim);
}

describe('pacts rows', () => {
  it('turns each peace pact into one row that opens its inspector', () => {
    const rows = pactRowsOf(realmWithPeace());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 4 * 256 + 7,
      title: 'Dominion 4 and Dominion 7',
      detail: 'Peace · strength 60 and 25',
      inspector: 'win_pact',
      params: { id: 4 * 256 + 7 },
    });
  });

  it('is empty before any dominion exists', () => {
    const sim = generateRealm({ seed: 99, sizeStep: 2, template: 'continent' }).sim;
    expect(pactRowsOf(buildSnapshot(sim))).toEqual([]);
  });
});

describe('favourite beings rows', () => {
  function playedBeings(): Snapshot {
    const sim = generateRealm({ seed: 4242, sizeStep: 2, template: 'continent' }).sim;
    seedStartingBeasts(sim, 12);
    for (let t = 0; t < 40; t++) sim.step();
    return buildSnapshot(sim);
  }

  it('lists the oldest living beings when nothing is starred yet', () => {
    const snap = playedBeings();
    const beings = snap.detail?.notable?.beings ?? [];
    expect(beings.length).toBeGreaterThan(0);
    const rows = favouriteRowsOf(snap);
    expect(rows.map((r) => r.id)).toEqual(beings.map((b) => b.id));
    expect(rows[0]?.detail).toMatch(/^Oldest living, not a favourite/);
    expect(rows[0]?.inspector).toBe('win_being');
  });

  it('puts starred beings first, once each', () => {
    const snap = playedBeings();
    const beings = snap.detail?.notable?.beings ?? [];
    const last = beings[beings.length - 1];
    if (!last) throw new Error('no beings');
    setFavouriteBeing(last, snap.tick, true);
    const rows = favouriteRowsOf(snap);
    expect(rows[0]?.id).toBe(last.id);
    expect(rows[0]?.detail).toMatch(/^Favourite/);
    expect(rows.filter((r) => r.id === last.id)).toHaveLength(1);
  });
});
