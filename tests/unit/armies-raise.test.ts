import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/shared/rng.ts';
import { ARMY_RENOWN_PER_DEFEAT, armyWon, raiseArmies, syncArmies, type Army } from '../../src/sim/dominions/armies.ts';
import { addBorder, addDominion, dominionsOfSim, pactsOfSim, snapshotDominions } from '../../src/sim/dominions/adapter.ts';
import { dominionStep, RelationMatrix, type Dominion, type DominionContext } from '../../src/sim/dominions/index.ts';
import { decodeChronicle, encodeChronicle } from '../../src/sim/chronicle.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { YEAR_TICKS } from '../../src/shared/constants.ts';

function dom(id: number, strength: number): Dominion {
  return { id, parcels: new Set(), strength, target: -1, campaignSince: -1 };
}

describe('armies (one per dominion, derived from strength)', () => {
  it('raises an army for each dominion with strength, once, sorted by id', () => {
    const armies: Army[] = [];
    const ds = [dom(3, 7), dom(1, 0), dom(2, 12)];
    raiseArmies(armies, ds);
    raiseArmies(armies, ds);
    expect(armies.map((a) => [a.id, a.dominionId, a.soldiers, a.renown])).toEqual([
      [2, 2, 12, 0],
      [3, 3, 7, 0],
    ]);
    expect(armies[0]?.name).toBe('Army of Dominion 2');
  });

  it('soldiers follow the dominion strength; a gone dominion leaves its army at 0', () => {
    const armies: Army[] = [];
    const ds = [dom(1, 10), dom(2, 4)];
    raiseArmies(armies, ds);
    ds[0]!.strength = 6;
    syncArmies(armies, ds);
    expect(armies.find((a) => a.id === 1)?.soldiers).toBe(6);
    syncArmies(armies, [dom(2, 4)]);
    expect(armies.find((a) => a.id === 1)?.soldiers).toBe(0);
  });

  it('a won strength exchange adds renown to the winner army only', () => {
    const armies: Army[] = [];
    raiseArmies(armies, [dom(1, 10), dom(2, 4)]);
    armyWon(armies, 2);
    expect(armies.find((a) => a.id === 2)?.renown).toBe(ARMY_RENOWN_PER_DEFEAT);
    expect(armies.find((a) => a.id === 1)?.renown).toBe(0);
  });

  it('the campaign exchange reports each defeat once, to the winner', () => {
    const a = dom(1, 100);
    const b = dom(2, 40);
    const rel = new RelationMatrix();
    rel.set(1, 2, 'war');
    const defeats: number[] = [];
    const ctx: DominionContext = {
      rng: createRng(7),
      tick: 0,
      isOn: () => true,
      dominions: [a, b],
      borders: [[1, 2]],
      owner: new Map([
        [10, 1],
        [20, 2],
      ]),
      onDefeat: (winner) => defeats.push(winner),
    };
    for (let t = 0; t < 2000; t++) {
      ctx.tick = t;
      dominionStep(ctx, rel);
    }
    expect(b.strength).toBe(0);
    expect(defeats).toEqual([1]);
  });
});

describe('yearly wiring in the sim', () => {
  // Four equal dominions on a row of parcels: dominion 1 is supreme (ties go to the lower id), so the first
  // free peace pair 2-3 forms a pact and the free dominion 4, which borders 3, joins it in the same pass.
  function fourDominions(): Sim {
    const sim = generateRealm({ seed: 777, sizeStep: 2, template: 'continent' }).sim;
    addDominion(sim, 1, 15, [0]);
    addDominion(sim, 2, 15, [1]);
    addDominion(sim, 3, 15, [2]);
    addDominion(sim, 4, 15, [3]);
    addBorder(sim, 1, 2);
    addBorder(sim, 2, 3);
    addBorder(sim, 3, 4);
    return sim;
  }

  it('after a sim year the yearly pass raises one army per dominion and keeps soldiers at strength', () => {
    const sim = fourDominions();
    for (let t = 0; t < YEAR_TICKS; t++) sim.step();
    // Formation needs 60 strength on both sides (intrigue gate, round 5), and these dominions have 15: no pact forms.
    expect(pactsOfSim(sim)).toHaveLength(0);
    const snap = snapshotDominions(sim);
    expect(snap?.armies?.map((a) => a.dominionId)).toEqual([1, 2, 3, 4]);
    for (const a of snap?.armies ?? []) {
      const d = dominionsOfSim(sim).find((x) => x.id === a.dominionId);
      expect(a.soldiers).toBe(d?.strength);
    }
  });

  it('pacts and armies survive a chronicle round trip', () => {
    const sim = fourDominions();
    for (let t = 0; t < YEAR_TICKS; t++) sim.step();
    const back = decodeChronicle(encodeChronicle(sim));
    expect(pactsOfSim(back)).toEqual(pactsOfSim(sim));
    expect(snapshotDominions(back)?.armies).toEqual(snapshotDominions(sim)?.armies);
  });
});
