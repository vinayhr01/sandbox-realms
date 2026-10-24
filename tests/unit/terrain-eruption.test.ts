import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/sim/sim.ts';
import { G } from '../../src/content/grounds.ts';
import { BIOMES, biomeCoverId } from '../../src/content/biomes.ts';
import { startGeyser, startVolcano } from '../../src/sim/terrain/eruption.ts';
import { terrainState } from '../../src/sim/terrain/state.ts';
import { quakeStep, startQuake, quakeActive, QUAKE_SHAPE_COUNT } from '../../src/sim/terrain/quake.ts';

describe('volcanoes (04 section 7.2, 18e section 2)', () => {
  it('a cone paints a 6x6 molten_4 footprint', () => {
    const sim = new Sim(5, 1);
    const r = sim.realm;
    expect(startVolcano(sim, 40, 40, false)).toBe(true);
    let molten = 0;
    for (let y = 37; y <= 42; y++) for (let x = 37; x <= 42; x++) if (r.ground[y * r.side + x] === G.molten_4) molten++;
    expect(molten).toBe(36);
  });

  it('a cone erupts every 2 ticks and a small vent every 1200-3600 ticks', () => {
    const sim = new Sim(5, 1);
    startVolcano(sim, 40, 40, false);
    const cone = terrainState(sim).vents[0];
    expect(cone?.interval).toBe(2);
    const small = new Sim(6, 1);
    startVolcano(small, 40, 40, true);
    const vent = terrainState(small).vents[0];
    expect(vent).toBeDefined();
    if (!vent) return;
    // The first eruption of the small vent comes after an interval drawn from [1200, 3600].
    const first = vent.next;
    expect(first - 0).toBeGreaterThanOrEqual(1200);
    expect(first - 0).toBeLessThanOrEqual(3600);
  });

  it('eruptions drop magma: the cone keeps erupting and the tick counter advances the schedule', () => {
    const sim = new Sim(7, 1);
    startVolcano(sim, 40, 40, false);
    const vent = terrainState(sim).vents[0];
    if (!vent) throw new Error('no vent');
    const before = vent.next;
    for (let t = 0; t < 10; t++) sim.step();
    expect(vent.next).toBeGreaterThan(before);
    expect(vent.next - sim.tick).toBeLessThanOrEqual(2);
  });
});

describe('geysers (04 section 7.2)', () => {
  it('a water geyser is registered with its own cadence', () => {
    const sim = new Sim(8, 1);
    expect(startGeyser(sim, 20, 20, 'water')).toBe(true);
    expect(terrainState(sim).vents[0]?.kind).toBe('water');
  });

  it('an acid geyser strips cover from the land around it', () => {
    const sim = new Sim(9, 1);
    const r = sim.realm;
    const verdant = BIOMES.findIndex((b) => b.id === 'verdant_reach');
    for (let y = 20; y < 60; y++) {
      for (let x = 20; x < 60; x++) {
        r.setGround(y * r.side + x, G.lowloam);
        r.setCover(y * r.side + x, biomeCoverId(verdant, false));
      }
    }
    const count = (): number => {
      let n = 0;
      for (let y = 20; y < 60; y++) for (let x = 20; x < 60; x++) if ((r.cover[y * r.side + x] ?? 0) !== 0) n++;
      return n;
    };
    const before = count();
    startGeyser(sim, 40, 40, 'acid');
    for (let t = 0; t < 400; t++) sim.step();
    expect(count()).toBeLessThan(before);
  });
});

describe('quakes (04 section 9)', () => {
  it('there are 12 fissure shapes', () => {
    expect(QUAKE_SHAPE_COUNT).toBe(12);
  });

  it('a power quake lowers exactly its footprint, in ceil(steps/300) ticks', () => {
    const sim = new Sim(1, 1);
    const r = sim.realm;
    for (let i = 0; i < r.tileCount; i++) r.setElevation(i, 150);
    const ox = Math.floor(r.side / 2);
    const oy = Math.floor(r.side / 2);
    expect(startQuake(sim, ox, oy, 'power')).toBe(true);
    const q = terrainState(sim).quake;
    if (!q) throw new Error('no quake');
    const mode = q.mode;
    const steps = q.steps.slice();
    const footprint = new Set<number>();
    for (let k = 0; k < steps.length; k += 2) {
      const x = ox + (steps[k] ?? 0);
      const y = oy + (steps[k + 1] ?? 0);
      if (r.inBounds(x, y)) footprint.add(y * r.side + x);
    }
    const expectedTicks = Math.ceil(steps.length / 2 / 300);
    let ticks = 0;
    while (quakeActive(sim)) {
      quakeStep(sim);
      ticks++;
    }
    expect(ticks).toBe(expectedTicks);
    for (let i = 0; i < r.tileCount; i++) {
      const expected = footprint.has(i) ? 150 + (mode === 'lower' ? -5 : 5) : 150;
      expect(r.elevation[i]).toBe(expected);
    }
  });

  it('a second quake while one runs is ignored', () => {
    const sim = new Sim(2, 1);
    expect(startQuake(sim, 60, 60, 'small')).toBe(true);
    expect(startQuake(sim, 60, 60, 'power')).toBe(false);
  });

  it('a quake changes no tile under sanctuary_seal', () => {
    const sim = new Sim(3, 1);
    const r = sim.realm;
    for (let i = 0; i < r.tileCount; i++) r.setElevation(i, 150);
    sim.rules.set('sanctuary_seal', true);
    startQuake(sim, 60, 60, 'power');
    for (let t = 0; t < 40; t++) sim.step();
    for (let i = 0; i < r.tileCount; i++) expect(r.elevation[i]).toBe(150);
  });
});
