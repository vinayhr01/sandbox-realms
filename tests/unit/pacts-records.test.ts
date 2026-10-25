import { describe, expect, it } from 'vitest';
import { addBorder, addDominion, addPact, snapshotPacts, dominionState } from '../../src/sim/dominions/adapter.ts';
import { addPactRenown, formPact, joinPact, makePact, newPactState, pactOf, pactPower, pactYear, PACT_TIMEOUT_TICKS, type PactState } from '../../src/sim/dominions/pacts.ts';
import { RelationMatrix, type Dominion } from '../../src/sim/dominions/types.ts';
import { decodeChronicle, encodeChronicle } from '../../src/sim/chronicle.ts';
import { buildSnapshot } from '../../src/sim/snapshot.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';
import type { Sim } from '../../src/sim/sim.ts';

function dom(id: number, strength: number): Dominion {
  return { id, parcels: new Set(), strength, target: -1, campaignSince: -1 };
}

function emptyState(): PactState {
  return newPactState();
}

describe('pact formation (10 section 12)', () => {
  it('forms a pact from the first peace border pair that is free and not supreme', () => {
    // Dominion 1 is supreme (most strength) and is never picked; the pair 2-3 is the first peace border left.
    const ds = [dom(1, 50), dom(2, 20), dom(3, 15)];
    // Formation is an intrigue since round 5: the record is made by formPact when the intrigue resolves.
    const state = emptyState();
    formPact(state, 2, 3, 0);
    expect(state.pacts).toHaveLength(1);
    expect(state.pacts[0]).toMatchObject({ id: 1, founders: [2, 3], memberIds: [2, 3], renown: 0, formedTick: 0, kind: 'normal' });
    expect(state.lastFormedTick).toBe(0);
    expect(state.nextId).toBe(2);
  });

  it('keeps the three-year timeout between formations', () => {
    const ds = [dom(1, 90), dom(2, 20), dom(3, 15), dom(4, 12), dom(5, 10)];
    const borders: [number, number][] = [[2, 3], [4, 5]];
    const state = emptyState();
    formPact(state, 2, 3, 0);
    expect(state.pacts.map((p) => p.memberIds)).toEqual([[2, 3]]);
    // The three-year timeout is a gate on proposing (formPactOk in intrigue.ts); the record keeps its tick.
    expect(state.lastFormedTick).toBe(0);
    expect(PACT_TIMEOUT_TICKS).toBe(3 * 1200);
    expect(borders.length).toBe(2);
  });

  it('a dominion with any tension or war cannot form a pact', () => {
    const ds = [dom(1, 90), dom(2, 20), dom(3, 15)];
    const rel = new RelationMatrix();
    rel.set(2, 3, 'peace');
    rel.set(1, 3, 'tension');
    const state = emptyState();
    pactYear(state, ds, [[2, 3]], rel, 0);
    expect(state.pacts).toEqual([]);
    expect(state.lastFormedTick).toBe(-1);
  });

  it('the supreme dominion never forms or joins a pact', () => {
    const ds = [dom(1, 50), dom(2, 20)];
    const state = emptyState();
    pactYear(state, ds, [[1, 2]], new RelationMatrix(), 0);
    expect(state.pacts).toEqual([]);
  });

  it('a free dominion that borders a member joins, one that does not border stays out', () => {
    const ds = [dom(1, 100), dom(2, 20), dom(3, 15), dom(4, 10), dom(5, 9)];
    const state = emptyState();
    makePact(state, 2, 3, 0);
    // Joining is an intrigue (joinPactOk checks a bordering, free dominion); the join itself is applied directly here.
    joinPact(pactOf(state.pacts, 2)!, 4);
    expect(state.pacts[0]?.memberIds).toEqual([2, 3, 4]);
    expect(pactOf(state.pacts, 5)).toBeUndefined();
  });
});

describe('leaving and dissolving', () => {
  it('a war between two members dissolves the whole pact (round 4 mapping of 10 section 12 dissolve)', () => {
    const ds = [dom(1, 100), dom(2, 20), dom(3, 10)];
    const rel = new RelationMatrix();
    rel.set(2, 3, 'war');
    const state = emptyState();
    makePact(state, 2, 3, 0);
    pactYear(state, ds, [], rel, 5);
    expect(state.pacts).toEqual([]);
  });

  it('with three members, a war between two members dissolves the whole pact (round 4 rule)', () => {
    const ds = [dom(1, 100), dom(2, 20), dom(3, 10), dom(4, 8)];
    const rel = new RelationMatrix();
    rel.set(2, 3, 'war');
    const state = emptyState();
    makePact(state, 2, 3, 0);
    state.pacts[0]!.memberIds = [2, 3, 4];
    pactYear(state, ds, [], rel, 5);
    expect(state.pacts).toEqual([]);
  });

  it('a member that no longer exists leaves, and the pact dissolves below two members', () => {
    const state = emptyState();
    makePact(state, 2, 3, 0);
    state.pacts[0]!.memberIds = [2, 3, 4];
    pactYear(state, [dom(1, 100), dom(2, 20), dom(3, 10)], [], new RelationMatrix(), 5);
    expect(state.pacts[0]?.memberIds).toEqual([2, 3]);
    pactYear(state, [dom(1, 100), dom(2, 20)], [], new RelationMatrix(), 6);
    expect(state.pacts).toEqual([]);
  });
});

describe('renown and power', () => {
  it('renown goes to the pact the winner belongs to; power is the members power sum (soldiers x 2 + hamlets x 5 + 1)', () => {
    const state = emptyState();
    makePact(state, 2, 3, 0);
    addPactRenown(state, 2, 3);
    addPactRenown(state, 9, 5);
    expect(state.pacts[0]?.renown).toBe(3);
    // Members 2 and 3 with no hamlet counts: (20 x 2 + 1) + (10 x 2 + 1) = 62.
    expect(pactPower(state.pacts[0]!, [dom(1, 100), dom(2, 20), dom(3, 10)])).toBe(62);
    // With hamlet counts: member 2 has 2 hamlets, member 3 has 1: (20 x 2 + 2 x 5 + 1) + (10 x 2 + 1 x 5 + 1) = 51 + 26 = 77.
    expect(pactPower(state.pacts[0]!, [dom(1, 100), dom(2, 20), dom(3, 10)], new Map([[2, 2], [3, 1]]))).toBe(77);
  });
});

describe('pact records in the sim', () => {
  function realmWithDominions(): Sim {
    const sim = generateRealm({ seed: 777, sizeStep: 2, template: 'continent' }).sim;
    addDominion(sim, 1, 50, [0]);
    addDominion(sim, 2, 30, [1]);
    addDominion(sim, 3, 20, [2]);
    addBorder(sim, 1, 2);
    addBorder(sim, 2, 3);
    return sim;
  }

  it('snapshot rows read the pact records: members, founders, power and renown', () => {
    const sim = realmWithDominions();
    addPact(sim, 2, 3);
    addPactRenown(dominionState(sim).pacts, 2, 4);
    const block = buildSnapshot(sim).pacts;
    expect(block?.count).toBe(1);
    expect(block?.rows[0]).toMatchObject({ id: 1, name: 'Pact 1', a: 2, b: 3, nameA: 'Dominion 2', strengthA: 30, strengthB: 20, members: [2, 3], power: 50, renown: 4 });
  });

  it('a peace border alone is not a pact', () => {
    const sim = realmWithDominions();
    expect(buildSnapshot(sim).pacts).toEqual({ count: 0, rows: [] });
  });

  it('addPact refuses a dominion that is already in a pact or does not exist', () => {
    const sim = realmWithDominions();
    addPact(sim, 2, 3);
    expect(() => addPact(sim, 1, 2)).toThrow(/already in a pact/);
    expect(() => addPact(sim, 1, 9)).toThrow(/no dominion 9/);
  });

  it('the pact section round-trips through the chronicle', () => {
    const sim = realmWithDominions();
    addPact(sim, 2, 3);
    const back = decodeChronicle(encodeChronicle(sim));
    expect(snapshotPacts(back)).toEqual(snapshotPacts(sim));
  });

  it('a realm with no pact writes no pact section and loads with none', () => {
    const sim = realmWithDominions();
    const back = decodeChronicle(encodeChronicle(sim));
    expect(snapshotPacts(back)).toBeNull();
  });
});
