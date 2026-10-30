import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeChronicle } from '../../src/sim/chronicle.ts';
import { Sim } from '../../src/sim/sim.ts';
import { G } from '../../src/content/grounds.ts';
import { speciesIndex, SPECIES } from '../../src/content/beasts.ts';
import { DECISION_INDEX, DECISION_ROWS } from '../../src/content/decisions.ts';
import { DAY_PHASE_OFFSET, DAY_TICKS } from '../../src/shared/daytime.ts';
import { spawnBeing, spawnFolk, huntTarget } from '../../src/sim/beings/system.ts';
import { beginSleep, isAsleep } from '../../src/sim/beings/social.ts';
import { predate } from '../../src/sim/combat.ts';
import { createHamlet, hamletStep, PARCEL, type Hamlet, type HamletContext } from '../../src/sim/settlements/hamlet.ts';
import { hamletsOf } from '../../src/sim/settlements/adapter.ts';
import { dominionState } from '../../src/sim/dominions/adapter.ts';
import { BUILDING_BY_ID } from '../../src/sim/settlements/catalogue.ts';
import { createRng } from '../../src/shared/rng.ts';

/** Tick at which the day has the given phase (phase 0 is midnight, tick 0 is phase 0.30). */
function tickAt(phase: number): number {
  return (Math.round(phase * DAY_TICKS) - Math.round(DAY_PHASE_OFFSET * DAY_TICKS) + DAY_TICKS * 5) % DAY_TICKS;
}

/** A small lowloam field, so spawns and walks are never blocked (the lineage-strains test pattern). */
function field(seed: number): Sim {
  const sim = new Sim(seed, 2);
  for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) sim.realm.setGround(y * sim.realm.side + x, G.lowloam);
  return sim;
}

function speciesOf(sim: Sim, slot: number): string {
  return SPECIES[sim.beings.store.species[slot] ?? -1]?.id ?? '';
}

/** Steps until the being sleeps, returning the tick it fell asleep at (or -1 when it never does within `limit` steps). */
function stepUntilAsleep(sim: Sim, slot: number, limit: number): number {
  for (let t = 0; t < limit; t++) {
    sim.step();
    if (isAsleep(sim, slot)) return sim.tick;
  }
  return -1;
}

/** Steps until the being is awake, returning the tick it woke at (or -1). */
function stepUntilAwake(sim: Sim, slot: number, limit: number): number {
  for (let t = 0; t < limit; t++) {
    sim.step();
    if (!isAsleep(sim, slot)) return sim.tick;
  }
  return -1;
}

describe('species flags', () => {
  it('nocturnal species are the owl, bats, moths, foxes, wolves and similar, and every other species is diurnal', () => {
    const nocturnal = SPECIES.filter((s) => s.nocturnal).map((s) => s.id);
    expect(nocturnal.sort()).toEqual(
      ['bonehound', 'cinderfox', 'duskflit', 'gleambug', 'gloamfang', 'gnatveil', 'hushowl', 'mothlet', 'shadepard', 'stormhound', 'voidmoth', 'wailwisp'].sort(),
    );
    expect(SPECIES[speciesIndex('burrfleece')]?.nocturnal).toBe(false);
  });
});

describe('sleep by time of day', () => {
  it('diurnal sleeps at night and wakes at dawn', () => {
    const sim = field(1);
    const slot = spawnBeing(sim, speciesIndex('burrfleece'), 40, 40, true);
    sim.tick = tickAt(0.9);
    const fellAsleep = stepUntilAsleep(sim, slot, 20);
    expect(fellAsleep).toBeGreaterThan(0);
    expect(fellAsleep).toBeLessThanOrEqual(tickAt(0.9) + 5);
    const woke = stepUntilAwake(sim, slot, 120);
    expect(woke).toBeGreaterThanOrEqual(tickAt(0.2) - 2);
    expect(woke).toBeLessThanOrEqual(tickAt(0.2) + 2);
  });

  it('nocturnal sleeps by day and wakes at dusk', () => {
    const sim = field(2);
    const slot = spawnBeing(sim, speciesIndex('hushowl'), 40, 40, true);
    sim.tick = tickAt(0.3);
    const fellAsleep = stepUntilAsleep(sim, slot, 20);
    expect(fellAsleep).toBeGreaterThan(0);
    expect(fellAsleep).toBeLessThanOrEqual(tickAt(0.3) + 5);
    const woke = stepUntilAwake(sim, slot, 150);
    expect(woke).toBeGreaterThanOrEqual(tickAt(0.75) - 2);
    expect(woke).toBeLessThanOrEqual(tickAt(0.75) + 2);
  });

  it('a night sleep lasts until dawn and never more than 70 ticks', () => {
    const sim = field(3);
    const slot = spawnBeing(sim, speciesIndex('burrfleece'), 40, 40, true);
    sim.tick = tickAt(0.85);
    beginSleep(sim, slot, 'mono');
    const until = sim.beings.store.sleepUntil[slot] ?? 0;
    expect(until - tickAt(0.85)).toBeGreaterThan(0);
    expect(until - tickAt(0.85)).toBeLessThanOrEqual(70);
  });

  it('naps and polyphasic sleep last at most 50 ticks', () => {
    const sim = field(4);
    const slot = spawnBeing(sim, speciesIndex('burrfleece'), 40, 40, true);
    for (let k = 0; k < 20; k++) {
      sim.tick = k * 37;
      beginSleep(sim, slot, 'nap');
      expect((sim.beings.store.sleepUntil[slot] ?? 0) - sim.tick).toBeLessThanOrEqual(50);
      beginSleep(sim, slot, 'poly');
      expect((sim.beings.store.sleepUntil[slot] ?? 0) - sim.tick).toBeLessThanOrEqual(50);
    }
  });

  it('monophasic cools down for 150 ticks, so a being can sleep every night', () => {
    expect(DECISION_ROWS[DECISION_INDEX.get('monophasic') ?? -1]?.cooldown).toBe(150);
  });

  it('a night sleeper wakes on damage and flees a hunter in sight', () => {
    const sim = field(5);
    const prey = spawnBeing(sim, speciesIndex('burrfleece'), 40, 40, true);
    sim.tick = tickAt(0.9);
    expect(stepUntilAsleep(sim, prey, 20)).toBeGreaterThan(0);
    // A gloamfang three tiles away, and a blow that wakes the sleeper.
    spawnBeing(sim, speciesIndex('gloamfang'), 43, 40, true);
    const s = sim.beings.store;
    s.vit[prey] = (s.vit[prey] ?? 0) - 1;
    sim.step();
    expect(isAsleep(sim, prey)).toBe(false);
    for (let t = 0; t < 6; t++) sim.step();
    expect(isAsleep(sim, prey)).toBe(false);
  });
});

describe('night hunting', () => {
  it('hunt range is 1.5x at night for hunters (flesh eaters)', () => {
    const sim = field(6);
    const predator = spawnBeing(sim, speciesIndex('gloamfang'), 30, 30, true);
    // Twelve tiles away: beyond the day range of 10, inside the night range of 15.
    const prey = spawnBeing(sim, speciesIndex('burrfleece'), 42, 30, true);
    sim.beings.rebuildBuckets();
    sim.tick = tickAt(0.3);
    expect(huntTarget(sim, predator)).toBe(-1);
    sim.tick = tickAt(0.0);
    expect(huntTarget(sim, predator)).toBe(prey);
  });

  it('a nocturnal predator bites 1.25x harder at night', () => {
    const sim = field(7);
    const owl = spawnBeing(sim, speciesIndex('hushowl'), 30, 30, true);
    // A diurnal flesh eater, as the control: the tiger does not bite harder at night.
    const tiger = spawnBeing(sim, speciesIndex('ridgeprowler'), 31, 30, true);
    const prey = spawnBeing(sim, speciesIndex('burrfleece'), 32, 30, true);
    const bite = Math.floor(0.15 * (sim.beings.store.maxVit[prey] ?? 0)) + 1;
    const dealt = (predator: number, tick: number): number => {
      sim.tick = tick;
      sim.beings.store.vit[prey] = sim.beings.store.maxVit[prey] ?? 0;
      sim.combat.attackTimer[predator] = 1000; // no claw swing: the bite alone
      return predate(sim.combatContext(), predator, prey).dealt;
    };
    expect(dealt(owl, tickAt(0.3))).toBe(bite);
    expect(dealt(owl, tickAt(0.0))).toBe(Math.floor(bite * 1.25));
    expect(dealt(tiger, tickAt(0.0))).toBe(bite);
  });
});

describe('folk going home', () => {
  it('folk away from home move toward their home hamlet at dusk', () => {
    const sim = field(8);
    // One step creates the settlement state, so a hamlet can be placed in it.
    sim.step();
    const side = sim.realm.side;
    const perAxis = side / PARCEL;
    const parcelOf = (x: number, y: number): number => Math.floor(y / PARCEL) * perAxis + Math.floor(x / PARCEL);
    const hx = 60;
    const hy = 60;
    const home = parcelOf(hx, hy);
    const away = parcelOf(10, 10);
    expect(away).not.toBe(home);
    const hamlet: Hamlet = createHamlet(home, 5);
    (hamletsOf(sim) as Hamlet[]).push(hamlet);
    // Both parcels belong to one dominion, so the folk's dominion has this hamlet.
    const owner = dominionState(sim).owner;
    owner[home] = 1;
    owner[away] = 1;
    const folk = spawnFolk(sim, speciesIndex('hearthborn'), 10, 10);
    const dist = (): number => Math.max(Math.abs((sim.beings.store.x[folk] ?? 0) - hx), Math.abs((sim.beings.store.y[folk] ?? 0) - hy));
    const before = dist();
    sim.tick = tickAt(0.8);
    // Folk walk at their pace (a tile every several ticks), so run long enough for a few tiles.
    for (let t = 0; t < 60; t++) sim.step();
    expect(dist()).toBeLessThan(before - 3);
  });
});

describe('hamlet work at night', () => {
  it('hamlet job output is 0.3x at night (one unit per worker at least)', () => {
    const sim = field(9);
    const work = (tick: number): number => {
      const ctx: HamletContext = { realm: sim.realm, rng: createRng(9), tick, isOn: () => false };
      const h = createHamlet(0, 6);
      h.food = 5000;
      h.wood = 0;
      h.stone = 0;
      h.buildings.push({ def: BUILDING_BY_ID.get('lumber_camp')!, x: 0, y: 0 });
      hamletStep(ctx, h);
      return h.wood;
    };
    const day = work(tickAt(0.5));
    const night = work(tickAt(0.0));
    expect(day).toBeGreaterThan(0);
    expect(night).toBe(Math.max(1, Math.floor(day * 0.3)));
  });
});

describe('old save', () => {
  it('a schema 7 save from before day and night loads at night, and diurnals fall asleep', () => {
    const bytes = readFileSync('tests/fixtures/day-night-old-save-v7.bin');
    const sim = decodeChronicle(new Uint8Array(bytes));
    expect(sim.tick).toBe(150);
    const s = sim.beings.store;
    const diurnal = (): number[] => {
      const out: number[] = [];
      for (let k = 0; k < s.size; k++) {
        const slot = s.at(k);
        if (s.alive[slot] !== 1 || SPECIES[s.species[slot] ?? -1]?.nocturnal) continue;
        if ((s.fuel[slot] ?? 0) <= 50) continue; // hungry beings hunt or forage, they do not sleep
        out.push(slot);
      }
      return out;
    };
    const candidates = diurnal();
    expect(candidates.length).toBeGreaterThan(0);
    for (let t = 0; t < 20; t++) sim.step();
    const asleep = candidates.filter((slot) => s.alive[slot] === 1 && isAsleep(sim, slot));
    // Most fed diurnal beings are asleep within a few ticks of the load; the rest are fleeing or fighting.
    expect(asleep.length / candidates.length).toBeGreaterThan(0.6);
  });
});

