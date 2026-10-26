import { describe, expect, it } from 'vitest';
import { decodeChronicle, encodeChronicle } from '../../src/sim/chronicle.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';
import { seedStartingBeasts } from '../../src/sim/beings/system.ts';
import { MAX_BEINGS } from '../../src/sim/beings/store.ts';
import { addDominion, dominionState, parcelsPerAxis, snapshotDominions } from '../../src/sim/dominions/adapter.ts';
import { snapshotSpells } from '../../src/sim/spells.ts';
import type { Sim } from '../../src/sim/sim.ts';

// Chronicle round trip of the optional dominion fields (campaigns, captures, hamletsRazed) and of the spells section (tag 23).
// All four are written only when present, so a save without them must also load.

function world(): Sim {
  const sim = generateRealm({ seed: 5, sizeStep: 2, template: 'continent' }).sim;
  seedStartingBeasts(sim, 4);
  const perAxis = parcelsPerAxis(sim);
  const all = Array.from({ length: perAxis * perAxis }, (_, p) => p);
  addDominion(sim, 1, 10, all.slice(0, 3));
  addDominion(sim, 2, 10, all.slice(3, 6));
  return sim;
}

describe('chronicle: optional campaigns, captures, hamletsRazed and spells', () => {
  it('keeps them through encode then decode', () => {
    const sim = world();
    const state = dominionState(sim);
    state.campaigns.items.push({ id: 1, kind: 'uprising', attackers: [2], defenders: [1], mainAttacker: 2, mainDefender: 1, startTick: 40 });
    state.campaigns.nextId = 2;
    state.captures.set(1, { ticks: 37.5, defenderTicks: 3 });
    state.hamletsRazed = 4;
    const slot = sim.beings.store.at(0);
    const key = (sim.beings.store.generation[slot] ?? 0) * MAX_BEINGS + slot;
    sim.spells.aether.set(key, { value: 12, at: 30 });

    const back = decodeChronicle(encodeChronicle(sim));
    const snap = snapshotDominions(back);
    expect(snap?.campaigns).toEqual({
      items: [{ id: 1, kind: 'uprising', attackers: [2], defenders: [1], mainAttacker: 2, mainDefender: 1, startTick: 40 }],
      nextId: 2,
    });
    expect(snap?.captures).toEqual([{ anchor: 1, ticks: 37.5, defenderTicks: 3 }]);
    expect(snap?.hamletsRazed).toBe(4);
    expect(snapshotSpells(back)).toEqual({ aether: [[key, 12, 30]] });
    expect(back.stateHash()).toBe(sim.stateHash());
  });

  it('a save without them loads with none (they are optional)', () => {
    const sim = world();
    const back = decodeChronicle(encodeChronicle(sim));
    const snap = snapshotDominions(back);
    expect(snap?.campaigns).toBeUndefined();
    expect(snap?.captures).toBeUndefined();
    expect(snap?.hamletsRazed).toBeUndefined();
    expect(snapshotSpells(back)).toBeNull();
  });
});
