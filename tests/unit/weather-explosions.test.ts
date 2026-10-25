import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/sim/sim.ts';
import { BeingStore } from '../../src/sim/beings/store.ts';
import { EffectStore } from '../../src/sim/effects.ts';
import { applyDamage, CombatState, type CombatContext } from '../../src/sim/combat.ts';
import { explode, ExplosionGuard, type ExplosionContext } from '../../src/sim/explosions.ts';
import { createWeatherState, MAX_CLOUDS, weatherStep, type WeatherContext } from '../../src/sim/weather.ts';
import { rainDrop } from '../../src/sim/terrain/water.ts';
import { startFire } from '../../src/sim/terrain/fire.ts';
import { freeze } from '../../src/sim/terrain/freeze.ts';
import { G } from '../../src/content/grounds.ts';
import { createRng } from '../../src/shared/rng.ts';
import { FLAG } from '../../src/sim/realm.ts';

/** Builds a sim plus the structural contexts the explosion and weather modules take. */
function world(seed: number, rules: Record<string, boolean> = {}) {
  const sim = new Sim(seed, 1);
  const beings = { store: new BeingStore(64), kill: (slot: number) => beings.store.kill(slot) };
  const effects = new EffectStore(64);
  const combat = new CombatState(64);
  const rng = createRng(seed + 1);
  const guard = new ExplosionGuard();
  const combatCtx: CombatContext = {
    beings,
    effects,
    combat,
    tick: 0,
    rng,
    might: () => 10,
  };
  const blast: ExplosionContext = {
    ...combatCtx,
    realm: sim.realm,
    guard,
    startFire: (tile, force) => startFire(sim, tile, force),
  };
  const isOn = (id: string): boolean => rules[id] ?? true;
  const weather: WeatherContext = {
    realm: sim.realm,
    rng,
    tick: 0,
    isOn,
    ageClouds: [
      ['cloud_shower', 3],
      ['cloud_storm', 1],
    ],
    cloudIntervalSs: 15,
    rainDrop: (tile) => rainDrop(sim, tile),
    freeze: (tile) => freeze(sim, tile),
    ashDrop: (_tile) => {},
    startFire: (tile, force) => startFire(sim, tile, force),
    blast,
  };
  return { sim, beings, effects, combat, rng, blast, weather };
}

describe('explosions', () => {
  it('damages beings inside the radius and not outside', () => {
    const w = world(3);
    const inside = w.beings.store.spawn(0, 20, 20, 0, 100, 100, 0);
    const outside = w.beings.store.spawn(0, 30, 30, 0, 100, 100, 0);
    const hit = explode(w.blast, 20, 20, 3, 40, 'Explosion', -1);
    expect(hit).toBe(1);
    expect(w.beings.store.vit[inside]).toBeLessThan(100);
    expect(w.beings.store.vit[outside]).toBe(100);
  });

  it('plating does not reduce Explosion damage', () => {
    const w = world(4);
    const slot = w.beings.store.spawn(0, 20, 20, 0, 100, 100, 0);
    w.combat.plating[slot] = 90;
    explode(w.blast, 20, 20, 2, 40, 'Explosion', -1);
    expect(w.beings.store.vit[slot]).toBe(100 - 40);
  });

  it("plating does reduce Weapon damage (control)", () => {
    const w = world(4);
    const slot = w.beings.store.spawn(0, 20, 20, 0, 100, 100, 0);
    w.combat.plating[slot] = 90;
    const ctx: CombatContext = { beings: w.beings, effects: w.effects, combat: w.combat, tick: 0, rng: w.rng, might: () => 10 };
    applyDamage(ctx, slot, 40, "Weapon", false);
    // Float rounding: 40 * (1 - 0.9) is 3.99..., so the truncated damage is 3 or 4.
    const taken = 100 - (w.beings.store.vit[slot] ?? 0);
    expect(taken === 3 || taken === 4).toBe(true);
  });

  it('the guard refuses blasts once it is saturated and recovers with decay', () => {
    const w = world(5);
    const guard = w.blast.guard;
    for (let k = 0; k < 20; k++) expect(guard.tryAcquire()).toBe(true);
    expect(guard.tryAcquire()).toBe(false);
    for (let k = 0; k < 400; k++) guard.decay();
    expect(guard.tryAcquire()).toBe(true);
  });
});

describe('weather', () => {
  it('rain extinguishes a burning tile', () => {
    const sim = new Sim(8, 1);
    const i = 40 * sim.realm.side + 40;
    sim.realm.setGround(i, G.lowloam);
    sim.realm.setCover(i, 1);
    expect(startFire(sim, i, true)).toBe(true);
    expect(sim.realm.hasFlag(i, FLAG.burning)).toBe(true);
    rainDrop(sim, i);
    expect(sim.realm.hasFlag(i, FLAG.burning)).toBe(false);
  });

  it('a shower cloud over a burning patch puts the fire out', () => {
    const w = world(9);
    const side = w.sim.realm.side;
    const cx = 40;
    const cy = 40;
    for (let y = cy - 1; y <= cy + 1; y++) {
      for (let x = cx - 1; x <= cx + 1; x++) startFire(w.sim, y * side + x, true);
    }
    const state = createWeatherState();
    state.clouds.push({ type: 'cloud_shower', x: cx, y: cy, speed: 0, age: 100, dropTimer: 0, dropInterval: 1 });
    w.weather.rainDrop = (tile) => rainDrop(w.sim, tile);
    w.weather.realm = w.sim.realm;
    for (let t = 0; t < 400; t++) {
      w.weather.tick = t;
      weatherStep(w.weather, state);
    }
    let burning = 0;
    for (let y = cy - 1; y <= cy + 1; y++) {
      for (let x = cx - 1; x <= cx + 1; x++) if (w.sim.realm.hasFlag(y * side + x, FLAG.burning)) burning++;
    }
    expect(burning).toBe(0);
  });

  it('storm clouds never spawn when natural_calamities is off', () => {
    const w = world(10, { natural_calamities: false });
    w.weather.ageClouds = [['cloud_storm', 1]];
    const state = createWeatherState();
    for (let t = 0; t < 4000; t++) {
      w.weather.tick = t;
      weatherStep(w.weather, state);
      expect(state.clouds.some((c) => c.type === 'cloud_storm')).toBe(false);
    }
  });

  it('the cloud count never exceeds the cap', () => {
    const w = world(11);
    w.weather.ageClouds = [['cloud_plain', 1]];
    w.weather.cloudIntervalSs = 0.05;
    const state = createWeatherState();
    let peak = 0;
    for (let t = 0; t < 3000; t++) {
      w.weather.tick = t;
      state.nextSpawn = 0;
      weatherStep(w.weather, state);
      peak = Math.max(peak, state.clouds.length);
    }
    expect(peak).toBeLessThanOrEqual(MAX_CLOUDS);
    expect(peak).toBe(MAX_CLOUDS);
  });

  it('freezing clouds freeze the tile under them', () => {
    const w = world(12);
    const side = w.sim.realm.side;
    const cell = 50 * side + 50;
    w.sim.realm.setGround(cell, G.shoal);
    const state = createWeatherState();
    state.clouds.push({ type: 'cloud_flurry', x: 50, y: 50, speed: 0, age: 100, dropTimer: 0, dropInterval: 1 });
    for (let t = 0; t < 200; t++) {
      w.weather.tick = t;
      weatherStep(w.weather, state);
    }
    expect(w.sim.realm.ground[cell] === G.rimeplate || w.sim.realm.hasFlag(cell, FLAG.frozen)).toBe(true);
  });
});
