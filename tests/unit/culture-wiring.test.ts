import { describe, expect, it } from 'vitest';
import { decodeChronicle, encodeChronicle } from '../../src/sim/chronicle.ts';
import { culturePayload, regionContacts } from '../../src/sim/culture/adapter.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';
import type { Sim } from '../../src/sim/sim.ts';

function realmSim(): Sim {
  return generateRealm({ seed: 11, sizeStep: 2, template: 'continent' }).sim;
}

/** A pair of neighbouring regions in this realm (the test needs one to exist). */
function firstContact(sim: Sim): [number, number] {
  const pair = regionContacts(sim.realm)[0];
  if (!pair) throw new Error('test realm has no neighbouring regions');
  return [pair[0], pair[1]];
}

describe('culture wiring', () => {
  it('a sim starts with an empty culture state', () => {
    const sim = realmSim();
    expect(culturePayload(sim.culture)).toEqual({ customs: [], creeds: [], dialects: [], intrigues: [], families: [], nextId: 1 });
  });

  it('a creed in one region spreads to a neighbouring region in a running sim', () => {
    const sim = realmSim();
    const [a, b] = firstContact(sim);
    sim.culture.creeds.push({ id: 1, holders: new Set([a]) });
    for (let t = 0; t < 8000 && !sim.culture.creeds[0]?.holders.has(b); t++) sim.step();
    expect(sim.culture.creeds[0]?.holders.has(b)).toBe(true);
  });

  it('two identical runs with culture content keep the same state hash and culture state', () => {
    const run = (): { hash: number; culture: string } => {
      const sim = realmSim();
      const [a] = firstContact(sim);
      sim.culture.creeds.push({ id: 1, holders: new Set([a]) });
      for (let t = 0; t < 1000; t++) sim.step();
      return { hash: sim.stateHash(), culture: JSON.stringify(culturePayload(sim.culture)) };
    };
    const first = run();
    const second = run();
    expect(second.hash).toBe(first.hash);
    expect(second.culture).toBe(first.culture);
  });

  it('a save taken mid-run resumes to the same culture state and hash as an uninterrupted run', () => {
    const base = realmSim();
    const [a] = firstContact(base);
    base.culture.creeds.push({ id: 1, holders: new Set([a]) });
    for (let t = 0; t < 400; t++) base.step();
    const resumed = decodeChronicle(encodeChronicle(base));
    expect(culturePayload(resumed.culture)).toEqual(culturePayload(base.culture));
    for (let t = 0; t < 400; t++) {
      base.step();
      resumed.step();
    }
    expect(resumed.stateHash()).toBe(base.stateHash());
    expect(JSON.stringify(culturePayload(resumed.culture))).toBe(JSON.stringify(culturePayload(base.culture)));
  });
});
