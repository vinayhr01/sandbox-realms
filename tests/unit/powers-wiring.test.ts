import { describe, expect, it } from 'vitest';
import { CALAMITIES } from '../../src/sim/calamity.ts';
import { decodeChronicle, encodeChronicle } from '../../src/sim/chronicle.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';

/** One calamity roll every 80 sim-seconds (1600 ticks). */
const ROLL_TICKS = 1600;

function seeded(seed: number) {
  return generateRealm({ seed, sizeStep: 2, template: 'continent' }).sim;
}

describe('calamity wiring in Sim.step', () => {
  it('a calamity fires in a seeded continent with the rules on', () => {
    const sim = seeded(4242);
    // Scorch only admits heat_spell with no population gate, so it is the calamity that can fire with zero hamlets.
    sim.ages.current = 'scorch';
    for (let t = 0; t < ROLL_TICKS * 12; t++) sim.step();
    expect(sim.calamityCooldowns.size).toBeGreaterThan(0);
    for (const id of sim.calamityCooldowns.keys()) expect(CALAMITIES.some((c) => c.id === id)).toBe(true);
  });

  it('with natural_calamities off no nature calamity fires', () => {
    const sim = seeded(4242);
    sim.ages.current = 'scorch';
    sim.rules.set('natural_calamities', false);
    const natures = new Set(CALAMITIES.filter((c) => c.category === 'nature').map((c) => c.id));
    for (let t = 0; t < ROLL_TICKS * 12; t++) sim.step();
    for (const id of sim.calamityCooldowns.keys()) expect(natures.has(id)).toBe(false);
  });

  it('the calamity roll is deterministic for a seed', () => {
    const a = seeded(9);
    const b = seeded(9);
    a.ages.current = 'scorch';
    b.ages.current = 'scorch';
    for (let t = 0; t < ROLL_TICKS * 6; t++) {
      a.step();
      b.step();
    }
    expect(a.stateHash()).toBe(b.stateHash());
    expect([...a.calamityCooldowns]).toEqual([...b.calamityCooldowns]);
  });

  it('calamity cooldowns survive a Chronicle round trip', () => {
    const sim = seeded(4242);
    sim.ages.current = 'scorch';
    for (let t = 0; t < ROLL_TICKS * 12; t++) sim.step();
    const back = decodeChronicle(encodeChronicle(sim));
    expect([...back.calamityCooldowns]).toEqual([...sim.calamityCooldowns]);
  });
});

describe('Sim.usePower', () => {
  it('a beast spawner adds a being on a walkable tile', () => {
    const sim = seeded(77);
    const before = sim.beings.store.size;
    let applied = false;
    for (let i = 0; i < sim.realm.tileCount && !applied; i++) {
      applied = sim.usePower('spawn_beast_thistlehart', i % sim.realm.side, Math.floor(i / sim.realm.side));
    }
    expect(applied).toBe(true);
    expect(sim.beings.store.size).toBe(before + 1);
  });

  it('an unknown power id does nothing', () => {
    const sim = seeded(77);
    const before = sim.beings.store.size;
    expect(sim.usePower('no_such_power', 10, 10)).toBe(false);
    expect(sim.beings.store.size).toBe(before);
  });

  it('a terrain brush raises the ground under it', () => {
    const sim = seeded(77);
    const i = 40 * sim.realm.side + 40;
    const before = sim.realm.elevation[i] ?? 0;
    expect(sim.usePower('shape_raise', 40, 40)).toBe(true);
    expect(sim.realm.elevation[i] ?? 0).toBeGreaterThan(before);
  });
});
