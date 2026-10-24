import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/sim/sim.ts';
import { G } from '../../src/content/grounds.ts';
import { addHeat, heatStep, raiseHeat } from '../../src/sim/terrain/heat.ts';
import { scarStage, startFire, stopFire } from '../../src/sim/terrain/fire.ts';
import { strikeHeat } from '../../src/sim/weather.ts';
import { createRng } from '../../src/shared/rng.ts';
import { FLAG } from '../../src/sim/realm.ts';

describe('heat decay (04 section 7.1)', () => {
  it('loses exactly one heat per 20 ticks', () => {
    const sim = new Sim(1, 1);
    const r = sim.realm;
    const i = 20 * r.side + 20;
    r.setGround(i, G.lowloam);
    raiseHeat(r, i, 50);
    for (let t = 0; t < 20; t++) sim.step();
    expect(r.heat[i]).toBe(49);
    for (let t = 0; t < 40; t++) sim.step();
    expect(r.heat[i]).toBe(47);
  });

  it('leaves the heated set when it reaches zero', () => {
    const sim = new Sim(1, 1);
    const r = sim.realm;
    const i = 21 * r.side + 21;
    r.setGround(i, G.lowloam);
    raiseHeat(r, i, 1);
    heatStep(sim);
    expect(r.heat[i]).toBe(0);
    expect(r.heated.has(i)).toBe(false);
  });
});

describe('heat effects (04 section 7.1)', () => {
  it('evaporates a sea tile into a pit at heat 6', () => {
    const sim = new Sim(2, 1);
    const r = sim.realm;
    const i = 10 * r.side + 10;
    r.setGround(i, G.shoal);
    addHeat(sim, i, 6);
    expect(r.ground[i]).toBe(G.dug_shoal);
    expect(r.hollow.has(i)).toBe(true);
  });

  it('melts strand into molten_4 at heat 100', () => {
    const sim = new Sim(2, 1);
    const r = sim.realm;
    const i = 11 * r.side + 11;
    r.setGround(i, G.strand);
    addHeat(sim, i, 100);
    expect(r.ground[i]).toBe(G.molten_4);
    expect(r.molten.has(i)).toBe(true);
  });

  it('turns loam into strand at heat 36 but leaves it at 35', () => {
    const sim = new Sim(2, 1);
    const r = sim.realm;
    const a = 12 * r.side + 12;
    const b = 12 * r.side + 13;
    r.setGround(a, G.lowloam);
    r.setGround(b, G.lowloam);
    addHeat(sim, a, 35);
    addHeat(sim, b, 36);
    expect(r.ground[a]).toBe(G.lowloam);
    expect(r.ground[b]).toBe(G.strand);
  });

  it('ignites a flammable tile at heat 12', () => {
    const sim = new Sim(2, 1);
    const r = sim.realm;
    const i = 13 * r.side + 13;
    r.setGround(i, G.tilled);
    addHeat(sim, i, 11);
    expect(r.hasFlag(i, FLAG.burning)).toBe(false);
    addHeat(sim, i, 1);
    expect(r.hasFlag(i, FLAG.burning)).toBe(true);
  });

  it('does nothing under sanctuary_seal', () => {
    const sim = new Sim(2, 1);
    sim.rules.set('sanctuary_seal', true);
    const r = sim.realm;
    const i = 14 * r.side + 14;
    r.setGround(i, G.strand);
    addHeat(sim, i, 150);
    expect(r.ground[i]).toBe(G.strand);
  });

  it('lightning strikes add 9 heat to tiles within the strike radius only', () => {
    const sim = new Sim(3, 1);
    const r = sim.realm;
    strikeHeat(r, 40, 40);
    expect(r.heat[40 * r.side + 40]).toBe(9);
    expect(r.heat[40 * r.side + 42]).toBe(9);
    expect(r.heat[40 * r.side + 43]).toBe(0);
    expect(r.heat[42 * r.side + 42]).toBe(0);
  });
});

describe('scars (04 section 6)', () => {
  it('draws stages 6..15 and both ends occur', () => {
    const rng = createRng(77);
    const seen = new Set<number>();
    for (let k = 0; k < 1000; k++) {
      const s = scarStage(rng);
      expect(s).toBeGreaterThanOrEqual(6);
      expect(s).toBeLessThanOrEqual(15);
      seen.add(s);
    }
    expect(seen.has(6)).toBe(true);
    expect(seen.has(15)).toBe(true);
  });

  it('a burnt-out tile is scarred with a stage in 6..15', () => {
    const sim = new Sim(4, 1);
    const r = sim.realm;
    const i = 30 * r.side + 30;
    r.setGround(i, G.tilled);
    startFire(sim, i);
    stopFire(sim, i);
    expect(r.scar[i]).toBeGreaterThanOrEqual(6);
    expect(r.scar[i]).toBeLessThanOrEqual(15);
  });
});
