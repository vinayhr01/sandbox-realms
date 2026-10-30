import { describe, expect, it } from 'vitest';
import { decodeChronicle, encodeChronicle } from '../../src/sim/chronicle.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';
import { Sim } from '../../src/sim/sim.ts';

function seededSim(): Sim {
  return generateRealm({ seed: 5, sizeStep: 2, template: 'continent' }).sim;
}

describe('chronicle codec', () => {
  it('a save whose beings still name a dead lover, friend or close partner loads (the links are stale, the sim ignores them)', () => {
    const sim = seededSim();
    for (let t = 0; t < 200; t++) sim.step();
    const s = sim.beings.store;
    const [a, b] = [s.at(0), s.at(1)];
    // A living Being keeps generation-tagged links to one that then dies without clearing them (the case seen on
    // seeds 20240601/2 at tick 150): the sim reads such links through isCurrent, so they count for nothing.
    for (const [withArr, genArr] of [[s.loverWith, s.loverGen], [s.friendWith, s.friendGen], [s.closeWith, s.closeGen]] as const) {
      withArr[a] = b;
      genArr[a] = s.generation[b] ?? 0;
    }
    s.kill(b);
    const back = decodeChronicle(encodeChronicle(sim));
    expect(back.stateHash()).toBe(sim.stateHash());
  });

  it('a link outside the being table is still rejected as corrupt', () => {
    const sim = seededSim();
    for (let t = 0; t < 50; t++) sim.step();
    const s = sim.beings.store;
    s.friendWith[s.at(0)] = s.alive.length + 5;
    expect(() => decodeChronicle(encodeChronicle(sim))).toThrow(/bond partner/);
  });

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
