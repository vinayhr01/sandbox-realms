import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/shared/rng.ts';
import { dominionStep, signPeace, RelationMatrix, type Dominion, type DominionContext } from '../../src/sim/dominions/index.ts';

function world(rules: Record<string, boolean>, strengths: [number, number]): { ctx: DominionContext; rel: RelationMatrix; a: Dominion; b: Dominion } {
  const a: Dominion = { id: 1, parcels: new Set([10, 11]), strength: strengths[0], target: -1, campaignSince: -1 };
  const b: Dominion = { id: 2, parcels: new Set([20, 21]), strength: strengths[1], target: -1, campaignSince: -1 };
  const owner = new Map<number, number>([[10, 1], [11, 1], [20, 2], [21, 2]]);
  const ctx: DominionContext = {
    rng: createRng(7),
    tick: 0,
    isOn: (id) => rules[id] ?? true,
    dominions: [a, b],
    borders: [[1, 2]],
    owner,
  };
  const rel = new RelationMatrix();
  rel.set(1, 2, 'war');
  return { ctx, rel, a, b };
}

function run(ctx: DominionContext, rel: RelationMatrix, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    ctx.tick = t;
    dominionStep(ctx, rel);
  }
}

describe('dominions', () => {
  it('the stronger army wins a war within a bounded number of ticks', () => {
    const { ctx, rel, a, b } = world({}, [100, 40]);
    run(ctx, rel, 2000);
    const loser = b.strength === 0 ? b : a;
    expect(loser.strength).toBe(0);
    expect(a.strength).toBeGreaterThan(b.strength);
    expect(b.strength === 0 || a.strength === 0).toBe(true);
  });

  it('parley off stops every campaign on the same tick', () => {
    const { ctx, rel, a, b } = world({ parley: false }, [100, 40]);
    a.target = 2;
    a.campaignSince = 0;
    ctx.tick = 0;
    dominionStep(ctx, rel);
    expect(a.target).toBe(-1);
    expect(a.campaignSince).toBe(-1);
    run(ctx, rel, 500);
    expect(b.strength).toBe(40);
    expect(a.strength).toBe(100);
  });

  it('a peace pact ends the war and no campaign starts between pacted dominions', () => {
    const { ctx, rel, a, b } = world({}, [100, 40]);
    signPeace(ctx, rel, 1, 2);
    expect(rel.get(1, 2)).toBe('peace');
    run(ctx, rel, 500);
    expect(a.strength).toBe(100);
    expect(b.strength).toBe(40);
    expect(a.target).toBe(-1);
  });

  it('with border_creep off, a defeated dominion keeps its parcels', () => {
    const { ctx, rel, a, b } = world({ border_creep: false }, [100, 40]);
    run(ctx, rel, 2000);
    expect(b.strength).toBe(0);
    expect(b.parcels.size).toBe(2);
    expect(a.parcels.size).toBe(2);
  });

  it('with border_creep on, the victor takes a parcel from the defeated dominion', () => {
    const { ctx, rel, a, b } = world({ border_creep: true }, [100, 40]);
    run(ctx, rel, 2000);
    expect(b.strength).toBe(0);
    expect(a.parcels.size).toBe(3);
    expect(b.parcels.size).toBe(1);
  });
});
