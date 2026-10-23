import { describe, expect, it } from 'vitest';
import { decodeChronicle, encodeChronicle } from '../../src/sim/chronicle.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';
import { Sim } from '../../src/sim/sim.ts';

function seededSim(): Sim {
  return generateRealm({ seed: 5, sizeStep: 2, template: 'continent' }).sim;
}

describe('chronicle codec', () => {
  it('round trip after 500 ticks reproduces the state hash, tick and beings', () => {
    const sim = seededSim();
    for (let t = 0; t < 500; t++) sim.step();
    const bytes = encodeChronicle(sim);
    const back = decodeChronicle(bytes);
    expect(back.tick).toBe(sim.tick);
    expect(back.beings.store.size).toBe(sim.beings.store.size);
    expect(back.stateHash()).toBe(sim.stateHash());
  });

  it('a corrupted body byte fails the checksum', () => {
    const bytes = encodeChronicle(seededSim());
    const bad = bytes.slice();
    bad[40] = (bad[40] ?? 0) ^ 0xff;
    expect(() => decodeChronicle(bad)).toThrow(/checksum/);
  });

  it('wrong magic is rejected before anything is read', () => {
    const bytes = encodeChronicle(seededSim());
    const bad = bytes.slice();
    bad[0] = 0x58;
    expect(() => decodeChronicle(bad)).toThrow(/bad magic/);
  });

  it('an unsupported format version is rejected', () => {
    const bytes = encodeChronicle(seededSim());
    const bad = bytes.slice();
    bad[4] = 9;
    expect(() => decodeChronicle(bad)).toThrow(/format version/);
  });

  it('a truncated file is rejected', () => {
    const bytes = encodeChronicle(seededSim());
    expect(() => decodeChronicle(bytes.slice(0, bytes.length - 10))).toThrow();
  });

  // Gap (see DECISIONS.md): the RNG streams, behaviour timers, tile runners and being list order
  // are not reachable through the public Sim API, so a loaded save is not bit-identical to an
  it("a save at tick N continued to tick M matches an uninterrupted run", () => {
    const fresh = () => generateRealm({ seed: 4242, sizeStep: 2, template: "continent" }).sim;
    const straight = fresh();
    for (let t = 0; t < 300; t++) straight.step();
    const saved = encodeChronicle(straight);
    for (let t = 0; t < 300; t++) straight.step();
    const resumed = decodeChronicle(saved);
    for (let t = 0; t < 300; t++) resumed.step();
    expect(resumed.tick).toBe(straight.tick);
    expect(resumed.stateHash()).toBe(straight.stateHash());
  });
});
