import { describe, expect, it } from 'vitest';
import { CLAIMS_PER_YEAR, DECLARE_ARMY, FOUND_FOLK, TRUCE_TICKS, foundingYear, type FoundingEnv, type FoundingState, type Settlement } from '../../src/sim/dominions/founding.ts';
import { RelationMatrix, type Dominion } from '../../src/sim/dominions/types.ts';

const PER_AXIS = 8;

function state(dominions: Dominion[] = [], owner?: Uint8Array): FoundingState {
  const bytes = owner ?? new Uint8Array(PER_AXIS * PER_AXIS);
  for (const d of dominions) for (const p of d.parcels) bytes[p] = d.id;
  return { dominions, relations: new RelationMatrix(), borders: [], owner: bytes, truce: new Map() };
}

function env(overrides: Partial<FoundingEnv> = {}): FoundingEnv {
  return { perAxis: PER_AXIS, tick: 0, isOn: () => true, land: () => true, ...overrides };
}

function dom(id: number, parcels: number[], strength: number): Dominion {
  return { id, parcels: new Set(parcels), strength, target: -1, campaignSince: -1 };
}

/** A settlement occupying the given parcels with the given folk. */
function settlement(parcels: number[], folk: number): Settlement {
  return { parcels: new Set(parcels), folk };
}

describe('dominion founding rules (yearly pass)', () => {
  it('a settlement with enough folk founds a dominion on its parcels', () => {
    const s = state();
    foundingYear(s, [settlement([0, 1], FOUND_FOLK)], env({ land: () => false }));
    expect(s.dominions.map((d) => d.id)).toEqual([1]);
    expect([...(s.dominions[0]?.parcels ?? [])].sort((a, b) => a - b)).toEqual([0, 1]);
    expect(s.owner[0]).toBe(1);
    expect(s.dominions[0]?.strength).toBe(Math.floor(FOUND_FOLK / 3));
  });

  it('a settlement below the folk threshold founds nothing', () => {
    const s = state();
    foundingYear(s, [settlement([0], FOUND_FOLK - 1)], env({ land: () => false }));
    expect(s.dominions).toHaveLength(0);
    expect(s.owner[0]).toBe(0);
  });

  it('with realm_expansion off no dominion is founded', () => {
    const s = state();
    foundingYear(s, [settlement([0], 100)], env({ isOn: (id) => id !== 'realm_expansion', land: () => false }));
    expect(s.dominions).toHaveLength(0);
  });

  it('a settlement already inside a dominion does not found a second one', () => {
    const s = state([dom(1, [0], 5)]);
    foundingYear(s, [settlement([0, 1], 100)], env({ land: () => false }));
    expect(s.dominions.map((d) => d.id)).toEqual([1]);
    expect(s.owner[1]).toBe(1);
  });

  it('a dominion claims up to CLAIMS_PER_YEAR free land parcels next to its territory, never a settlement parcel', () => {
    const s = state();
    // Settlement parcels 0 and 1 found dominion 1; parcel 2 belongs to an unfounded settlement and must stay free.
    foundingYear(s, [settlement([0, 1], FOUND_FOLK), settlement([2], 3)], env());
    const d = s.dominions[0];
    expect(d?.parcels.size).toBe(2 + CLAIMS_PER_YEAR);
    expect(s.owner[2]).toBe(0);
    for (const p of d?.parcels ?? []) expect(s.owner[p]).toBe(1);
  });

  it('border growth keeps to the land predicate', () => {
    const s = state([dom(1, [27], 10)]);
    foundingYear(s, [], env({ land: () => false }));
    expect(s.dominions[0]?.parcels.size).toBe(1);
  });

  it('dominions whose parcels touch get a border; far ones do not', () => {
    const near = state([dom(1, [0], 40), dom(2, [9], 10)], undefined);
    foundingYear(near, [], env({ land: () => false }));
    expect(near.borders).toEqual([[1, 2]]);

    const far = state([dom(1, [0], 40), dom(2, [63], 10)]);
    foundingYear(far, [], env({ land: () => false }));
    expect(far.borders).toHaveLength(0);
  });

  it('a new border between an outweighed pair starts in tension, between equals in peace', () => {
    const uneven = state([dom(1, [0], 40), dom(2, [9], 10)]);
    foundingYear(uneven, [], env({ land: () => false }));
    expect(uneven.relations.get(1, 2)).toBe('tension');

    const even = state([dom(1, [0], 20), dom(2, [9], 15)]);
    foundingYear(even, [], env({ land: () => false }));
    expect(even.relations.get(1, 2)).toBe('peace');
  });

  it('a tense pair goes to war when the bigger side has an army, and a truce follows the declaration', () => {
    const s = state([dom(1, [0], 40), dom(2, [9], 10)]);
    s.relations.set(1, 2, 'tension');
    s.borders.push([1, 2]);
    foundingYear(s, [], env({ tick: 5000, land: () => false }));
    expect(s.relations.get(1, 2)).toBe('war');
    expect(s.truce.get('1:2')).toEqual({ a: 1, b: 2, until: 5000 + TRUCE_TICKS, declared: true });
  });

  it('a tense pair does not go to war when the bigger side is not above DECLARE_ARMY', () => {
    const s = state([dom(1, [0], DECLARE_ARMY), dom(2, [9], 1)]);
    s.relations.set(1, 2, 'tension');
    s.borders.push([1, 2]);
    foundingYear(s, [], env({ land: () => false }));
    expect(s.relations.get(1, 2)).toBe('tension');
  });

  it('during a truce a pair stays at peace even with a power gap', () => {
    const s = state([dom(1, [0], 40), dom(2, [9], 10)]);
    s.relations.set(1, 2, 'tension');
    s.borders.push([1, 2]);
    s.truce.set('1:2', { a: 1, b: 2, until: 10 * TRUCE_TICKS, declared: false });
    foundingYear(s, [], env({ tick: 100, land: () => false }));
    expect(s.relations.get(1, 2)).toBe('peace');
  });

  it('a declared war ends in a pact (peace) once the bigger side reaches PACT_RATIO', () => {
    const s = state([dom(1, [0], 60), dom(2, [9], 10)]);
    s.relations.set(1, 2, 'war');
    s.borders.push([1, 2]);
    s.truce.set('1:2', { a: 1, b: 2, until: 100, declared: true });
    foundingYear(s, [], env({ tick: 200, land: () => false }));
    expect(s.relations.get(1, 2)).toBe('peace');
    expect(s.truce.get('1:2')?.until).toBe(200 + TRUCE_TICKS);
  });

  it('a war nobody declared through the yearly pass is left at war, and a truce starts from the pass that sees it', () => {
    const s = state([dom(1, [0], 60), dom(2, [9], 10)]);
    s.relations.set(1, 2, 'war');
    s.borders.push([1, 2]);
    foundingYear(s, [], env({ tick: 300, land: () => false }));
    expect(s.relations.get(1, 2)).toBe('war');
    expect(s.truce.get('1:2')).toEqual({ a: 1, b: 2, until: 300 + TRUCE_TICKS, declared: false });
  });

  it('after an undeclared war ends in defeat, the pair is not declared on again during the truce', () => {
    const s = state([dom(1, [0], 60), dom(2, [9], 10)]);
    s.relations.set(1, 2, 'war');
    s.borders.push([1, 2]);
    foundingYear(s, [], env({ tick: 0, land: () => false }));
    s.relations.set(1, 2, 'peace');
    foundingYear(s, [], env({ tick: 1200, land: () => false }));
    expect(s.relations.get(1, 2)).toBe('peace');
  });

  it('army strength regrows toward the folk cap and is never cut', () => {
    const s = state();
    foundingYear(s, [settlement([0], 60)], env({ land: () => false }));
    expect(s.dominions[0]?.strength).toBe(20);
    s.dominions[0]!.strength = 3;
    foundingYear(s, [settlement([0], 60)], env({ land: () => false }));
    expect(s.dominions[0]?.strength).toBe(8);
    s.dominions[0]!.strength = 50;
    foundingYear(s, [settlement([0], 60)], env({ land: () => false }));
    expect(s.dominions[0]?.strength).toBe(50);
  });

  it('is deterministic: the same inputs give the same state', () => {
    const run = (): string => {
      const s = state();
      const settlements = [settlement([0, 1], 40), settlement([40], 35)];
      for (let y = 0; y < 6; y++) foundingYear(s, settlements, env({ tick: y * 1200 }));
      return JSON.stringify({ d: s.dominions.map((d) => [d.id, [...d.parcels], d.strength]), b: s.borders, o: [...s.owner] });
    };
    expect(run()).toBe(run());
  });
});
