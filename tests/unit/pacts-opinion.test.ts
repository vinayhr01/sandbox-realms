import { describe, expect, it } from 'vitest';
import { opinion, OPINION_SAME_PACT, OPINION_WAR, type OpinionContext } from '../../src/sim/dominions/opinion.ts';
import { makePact, newPactState, pactYear, type PactState } from '../../src/sim/dominions/pacts.ts';
import { RelationMatrix, type Dominion } from '../../src/sim/dominions/types.ts';
import { marchArmies, centroidParcel, type Army } from '../../src/sim/dominions/armies.ts';
import { YEAR_TICKS } from '../../src/shared/constants.ts';

function dom(id: number, strength: number, parcels: number[] = []): Dominion {
  return { id, parcels: new Set(parcels), strength, target: -1, campaignSince: -1 };
}

function ctx(ds: Dominion[], over: Partial<OpinionContext> = {}): OpinionContext {
  return { dominions: ds, borders: [], relations: new RelationMatrix(), truce: new Map(), pacts: [], tick: 0, ...over };
}

describe('opinion (10 section 10, state-backed terms)', () => {
  it('a bordering pair scores the close term, a far pair the far term', () => {
    const ds = [dom(1, 10), dom(2, 10), dom(3, 10)];
    const near = opinion(ctx(ds, { borders: [[1, 2]] }), 1, 2);
    const far = opinion(ctx(ds, { borders: [[1, 2]] }), 1, 3);
    expect(far - near).toBe(50);
  });

  it('war adds the campaign term; a same-pact pair adds the pact term', () => {
    const ds = [dom(1, 10), dom(2, 10)];
    const base = opinion(ctx(ds), 1, 2);
    const rel = new RelationMatrix();
    rel.set(1, 2, 'war');
    expect(opinion(ctx(ds, { relations: rel }), 1, 2)).toBe(base + OPINION_WAR);
    expect(opinion(ctx(ds, { pacts: [{ memberIds: [1, 2] }] }), 1, 2)).toBe(base + OPINION_SAME_PACT);
  });

  it('is a pure function of its input', () => {
    const ds = [dom(1, 30, [1, 2, 3]), dom(2, 5, [4])];
    expect(opinion(ctx(ds), 2, 1)).toBe(opinion(ctx(ds), 2, 1));
  });
});

describe('pact dissolve by opinion', () => {
  it('a pact dissolves after a year of a negative opinion between members', () => {
    // Supreme member 1 (most strength) is a member of the pact, so members hold a negative opinion of it.
    const ds = [dom(1, 100), dom(2, 20), dom(3, 15), dom(4, 1)];
    const state: PactState = newPactState();
    makePact(state, 1, 2, 0);
    const rel = new RelationMatrix();
    const borders: [number, number][] = [[1, 2]];
    pactYear(state, ds, borders, rel, 10, new Map());
    expect(state.pacts).toHaveLength(1);
    pactYear(state, ds, borders, rel, 10 + YEAR_TICKS, new Map());
    expect(state.pacts).toEqual([]);
  });
});

describe('army march (10 section 8, position)', () => {
  it('an army steps one parcel toward the enemy nearest parcel and stops when adjacent', () => {
    const perAxis = 10;
    const ds = [dom(1, 10, [0]), dom(2, 10, [9])];
    const rel = new RelationMatrix();
    rel.set(1, 2, 'war');
    const armies: Army[] = [{ id: 1, name: 'a', dominionId: 1, soldiers: 10, renown: 0, captains: 1, parcel: 0 }];
    marchArmies(armies, ds, rel, perAxis);
    expect(armies[0]?.parcel).toBe(1);
    for (let i = 0; i < 20; i++) marchArmies(armies, ds, rel, perAxis);
    expect(Math.max(Math.abs((armies[0]?.parcel ?? 0) % perAxis - 9), Math.abs(Math.floor((armies[0]?.parcel ?? 0) / perAxis) - 9))).toBe(1);
  });

  it('centroidParcel picks the parcel nearest the centre', () => {
    // Four corners of a 2x2 block: all tie at the centre, so the lowest index wins.
    expect(centroidParcel(new Set([0, 2, 20, 22]), 10)).toBe(0);
  });
});
