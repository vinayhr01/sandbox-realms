import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/sim/sim.ts';
import { G } from '../../src/content/grounds.ts';
import { placeCreepHub, removeCreepHub, creepTiles } from '../../src/sim/terrain/creep.ts';
import { acidTerraform } from '../../src/sim/terrain/acid.ts';
import { CREEP_REALM_CAP, CREEP_PULSE_TICKS } from '../../src/content/creeps.ts';
import { n4 } from '../../src/sim/grid.ts';
import { creepStep } from '../../src/sim/terrain/creep.ts';
import { terrainState } from '../../src/sim/terrain/state.ts';

/** A flat lowloam island so creep has room to grow. */
function island(seed: number): Sim {
  const sim = new Sim(seed, 1);
  const r = sim.realm;
  for (let y = 10; y < 90; y++) for (let x = 10; x < 90; x++) r.setGround(y * r.side + x, G.lowloam);
  return sim;
}

function countCreep(sim: Sim, ground: number): number {
  const r = sim.realm;
  let n = 0;
  for (let i = 0; i < r.tileCount; i++) if (r.ground[i] === ground) n++;
  return n;
}

describe('creep hubs (18e section 1, 9)', () => {
  it('a gloom heart fills its four n4 neighbours on its first pulse (a 1x1 hub has only four)', () => {
    const sim = island(1);
    const r = sim.realm;
    const hub = 50 * r.side + 50;
    expect(placeCreepHub(sim, hub, 'gloom_heart')).toBe(true);
    for (let t = 0; t < CREEP_PULSE_TICKS; t++) sim.step();
    expect(countCreep(sim, G.gloomgrowth)).toBe(4);
    let adjacent = 0;
    for (let k = 0; k < 4; k++) {
      const j = n4(hub, r.side, k);
      if (j >= 0 && r.ground[j] === G.gloomgrowth) adjacent++;
    }
    expect(adjacent).toBeGreaterThan(0);
  });

  it('growth stops at the hub size cap', () => {
    const sim = island(2);
    const r = sim.realm;
    placeCreepHub(sim, 50 * r.side + 50, 'gloom_heart');
    // Drive the pulses directly: 100 pulses of 6 tiles would need 600 tiles, so the cap of 500 stops them.
    for (let p = 0; p < 100; p++) {
      const hub = terrainState(sim).hubs[0];
      if (!hub) throw new Error('no hub');
      sim.tick = hub.nextPulse;
      creepStep(sim);
    }
    expect(creepTiles(sim)).toBe(500);
    expect(countCreep(sim, G.gloomgrowth)).toBe(500);
  });

  it('the realm holds at most 12 live hubs', () => {
    const sim = island(3);
    const r = sim.realm;
    let placed = 0;
    for (let k = 0; k < 14; k++) {
      if (placeCreepHub(sim, (20 + 4 * k) * r.side + 20, 'bloat_heart')) placed++;
    }
    expect(placed).toBe(CREEP_REALM_CAP);
  });

  it('a removed hub decays its creep back to lowloam', () => {
    const sim = island(4);
    const r = sim.realm;
    const hub = 50 * r.side + 50;
    placeCreepHub(sim, hub, 'bloat_heart');
    for (let t = 0; t < CREEP_PULSE_TICKS * 6; t++) sim.step();
    expect(countCreep(sim, G.bloatmoss)).toBeGreaterThan(0);
    removeCreepHub(sim, hub);
    for (let t = 0; t < 1400; t++) sim.step();
    expect(countCreep(sim, G.bloatmoss)).toBe(0);
  });

  it('under eternal_creep a removed hub keeps its creep', () => {
    const sim = island(5);
    const r = sim.realm;
    sim.rules.set('eternal_creep', true);
    const hub = 50 * r.side + 50;
    placeCreepHub(sim, hub, 'bloat_heart');
    for (let t = 0; t < CREEP_PULSE_TICKS * 6; t++) sim.step();
    const before = countCreep(sim, G.bloatmoss);
    removeCreepHub(sim, hub);
    for (let t = 0; t < 1400; t++) sim.step();
    expect(countCreep(sim, G.bloatmoss)).toBe(before);
  });

  it('acid on creep sets lowloam and blocks re-spread on that tile', () => {
    const sim = island(6);
    const r = sim.realm;
    const hub = 50 * r.side + 50;
    placeCreepHub(sim, hub, 'gloom_heart');
    for (let t = 0; t < CREEP_PULSE_TICKS; t++) sim.step();
    const j = n4(hub, r.side, 0);
    acidTerraform(sim, j);
    expect(r.ground[j]).toBe(G.lowloam);
    expect(terrainState(sim).creepGuard.get(j)).toBeGreaterThan(sim.tick);
  });
});
