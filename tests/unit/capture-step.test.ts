import { describe, expect, it } from 'vitest';
import {
  BASTION_THRESHOLD,
  CAPTURE_THRESHOLD,
  DEFENDER_TICKS,
  DEF_PER_TOWER,
  captureStep,
  type Capture,
  type CaptureArmy,
  type CaptureContext,
} from '../../src/sim/dominions/capture.ts';
import { RelationMatrix, type Dominion } from '../../src/sim/dominions/types.ts';

// 10 section 7, 18e section 3.1: captureStep. Grid of 4 x 4 parcels; the hamlet is parcel 5 (reach covers parcels 0 to 10),
// owned by dominion 1. Dominion 2 is at war with it.

function world(buildings: string[], armies: CaptureArmy[]): { ctx: CaptureContext; owner: Uint8Array; captures: Map<number, Capture>; d1: Dominion; d2: Dominion } {
  const owner = new Uint8Array(16);
  owner[5] = 1;
  const d1: Dominion = { id: 1, parcels: new Set([5]), strength: 10, target: -1, campaignSince: -1 };
  const d2: Dominion = { id: 2, parcels: new Set(), strength: 10, target: -1, campaignSince: -1 };
  const relations = new RelationMatrix();
  relations.set(1, 2, 'war');
  const captures = new Map<number, Capture>();
  const ctx: CaptureContext = {
    perAxis: 4,
    hamlets: [{ parcels: new Set([5]), buildings: buildings.map((id) => ({ def: { id } })) }],
    owner,
    dominions: [d1, d2],
    armies,
    relations,
    ownerOf: (parcels) => owner[[...parcels][0] ?? 0] ?? 0,
    captures,
    takerOf: (captor) => captor,
    isCapital: () => false,
  };
  return { ctx, owner, captures, d1, d2 };
}

const ENEMY = (soldiers: number): CaptureArmy => ({ dominionId: 2, parcel: 5, soldiers });
const OWN = (soldiers: number): CaptureArmy => ({ dominionId: 1, parcel: 5, soldiers });

/** Steps until the hamlet falls; returns the step count (capped). */
function stepsToFall(ctx: CaptureContext, cap = 400): number {
  for (let n = 1; n <= cap; n++) if (captureStep(ctx).length > 0) return n;
  return -1;
}

describe('captureStep thresholds', () => {
  it('uses 100 and 130', () => {
    expect(CAPTURE_THRESHOLD).toBe(100);
    expect(BASTION_THRESHOLD).toBe(130);
  });

  it('an undefended hamlet falls on the 100th step, not the 99th', () => {
    const { ctx, owner, d1, d2 } = world([], [ENEMY(3)]);
    for (let n = 1; n < 100; n++) expect(captureStep(ctx)).toEqual([]);
    expect(ctx.captures.get(5)?.ticks).toBe(99);
    expect(captureStep(ctx)).toEqual([{ anchor: 5, loser: 1, winner: 2, capital: false }]);
    expect(owner[5]).toBe(2);
    expect(d1.parcels.has(5)).toBe(false);
    expect(d2.parcels.has(5)).toBe(true);
    expect(ctx.captures.has(5)).toBe(false);
  });

  it('a bastion raises the threshold to 130', () => {
    const { ctx } = world(['bastion'], [ENEMY(3)]);
    expect(stepsToFall(ctx)).toBe(130);
  });
});

describe('captureStep defence', () => {
  it('a watchspire defends with DEF_PER_TOWER: equal points do not lead, one more does', () => {
    expect(DEF_PER_TOWER).toBe(10);
    const tied = world(['watchspire'], [ENEMY(DEF_PER_TOWER)]);
    expect(captureStep(tied.ctx)).toEqual([]);
    expect(tied.captures.get(5)?.ticks).toBe(0);
    const over = world(['watchspire'], [ENEMY(DEF_PER_TOWER + 1)]);
    captureStep(over.ctx);
    expect(over.captures.get(5)?.ticks).toBe(1);
  });

  it('two watchspires add up', () => {
    const w = world(['watchspire', 'watchspire'], [ENEMY(2 * DEF_PER_TOWER)]);
    captureStep(w.ctx);
    expect(w.captures.get(5)?.ticks).toBe(0);
    const w2 = world(['watchspire', 'watchspire'], [ENEMY(2 * DEF_PER_TOWER + 1)]);
    captureStep(w2.ctx);
    expect(w2.captures.get(5)?.ticks).toBe(1);
  });

  it('a defender held for DEFENDER_TICKS steps stops a rising capture (rise x4, then fall 1)', () => {
    expect(DEFENDER_TICKS).toBe(5);
    const { ctx, captures } = world([], [ENEMY(5), OWN(1)]);
    const seen: number[] = [];
    for (let n = 0; n < 6; n++) {
      captureStep(ctx);
      seen.push(captures.get(5)?.ticks ?? -1);
    }
    expect(seen).toEqual([1, 2, 3, 4, 3, 2]);
    expect(captures.get(5)?.defenderTicks).toBe(6);
  });

  it('defenderTicks resets to 0 when nobody defends, and ticks fall by 0.5', () => {
    const { ctx, captures } = world([], [ENEMY(3)]);
    captureStep(ctx);
    captureStep(ctx);
    expect(captures.get(5)).toEqual({ ticks: 2, defenderTicks: 0 });
    (ctx as { armies: readonly CaptureArmy[] }).armies = [];
    captureStep(ctx);
    expect(captures.get(5)).toEqual({ ticks: 1.5, defenderTicks: 0 });
  });

  it('an army of a dominion not at war adds no points', () => {
    const { ctx, captures } = world([], [{ dominionId: 3, parcel: 5, soldiers: 50 }]);
    ctx.relations.set(1, 3, 'peace');
    captureStep(ctx);
    expect(captures.get(5)?.ticks).toBe(0);
  });
});
