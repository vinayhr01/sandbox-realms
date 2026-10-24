import { describe, expect, it } from 'vitest';
import { createHamlet, hamletStep, type HamletContext } from '../../src/sim/settlements/hamlet.ts';
import { BUILDING_BY_ID } from '../../src/sim/settlements/catalogue.ts';
import { Sim } from '../../src/sim/sim.ts';
import { spawnBeing } from '../../src/sim/beings/system.ts';
import { SPECIES } from '../../src/content/beasts.ts';
import { createRng } from '../../src/shared/rng.ts';

function ctxFor(sim: Sim): HamletContext {
  return { realm: sim.realm, rng: createRng(3), tick: 0, isOn: () => true };
}

describe('hamlet stone income', () => {
  it('a quarry turns outcrop stock into stone each growth step', () => {
    const sim = new Sim(4, 2);
    const h = createHamlet(0, 4);
    h.buildings.push({ def: BUILDING_BY_ID.get('quarry')!, x: 0, y: 0 });
    h.stone = 0;
    const before = h.outcrops;
    for (let k = 0; k < 5; k++) {
      h.growTimer = 1;
      hamletStep(ctxFor(sim), h);
    }
    expect(h.stone).toBeGreaterThan(0);
    expect(h.outcrops).toBeLessThan(before);
    expect(h.stone + h.outcrops).toBeLessThanOrEqual(before + 1);
  });

  it('without a quarry there is no stone income', () => {
    const sim = new Sim(4, 2);
    const h = createHamlet(0, 4);
    h.stone = 0;
    for (let k = 0; k < 5; k++) {
      h.growTimer = 1;
      hamletStep(ctxFor(sim), h);
    }
    expect(h.stone).toBe(0);
  });

  it('outcrops regrow toward their cap and never exceed it', () => {
    const sim = new Sim(4, 2);
    const h = createHamlet(0, 4);
    h.outcrops = 0;
    for (let k = 0; k < 200; k++) {
      h.growTimer = 1;
      hamletStep(ctxFor(sim), h);
    }
    expect(h.outcrops).toBeGreaterThan(0);
    expect(h.outcrops).toBeLessThanOrEqual(60);
  });
});

describe('birth counters', () => {
  it('a child increments births and an adult increments newAdults', () => {
    const sim = new Sim(9, 2);
    const r = sim.realm;
    for (let y = 40; y < 44; y++) for (let x = 40; x < 44; x++) r.setGround(y * r.side + x, 7);
    const species = SPECIES.findIndex((s) => s.id === 'burrfleece');
    spawnBeing(sim, species, 41, 41, true);
    expect(sim.beings.stats.newAdults).toBe(1);
    expect(sim.beings.stats.births).toBe(0);
    spawnBeing(sim, species, 42, 41, false);
    expect(sim.beings.stats.births).toBe(1);
    expect(sim.beings.stats.newAdults).toBe(1);
  });
});
