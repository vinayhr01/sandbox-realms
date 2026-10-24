import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/sim/sim.ts';
import { G, ground } from '../../src/content/grounds.ts';
import { BIOMES, biomeCoverId } from '../../src/content/biomes.ts';
import { FLORA, floraCode } from '../../src/sim/flora.ts';
import { FLAG } from '../../src/sim/realm.ts';
import { runCalamity } from '../../src/sim/powers/handlers.ts';
import { startFire } from '../../src/sim/terrain/fire.ts';
import { quakeActive } from '../../src/sim/terrain/quake.ts';
import { terrainState } from '../../src/sim/terrain/state.ts';
import { POWER_BY_ID } from '../../src/content/powers.ts';

/** A sim whose every tile is lowloam, so random land draws always succeed. */
function landSim(seed = 5): Sim {
  const sim = new Sim(seed, 1);
  const r = sim.realm;
  // Elevation first: setElevation re-derives the ground of land tiles.
  for (let i = 0; i < r.tileCount; i++) {
    r.setElevation(i, 200);
    r.setGround(i, G.lowloam);
  }
  return sim;
}

/** Centre tile of the realm as [x, y]. */
function centre(sim: Sim): [number, number] {
  const half = Math.floor(sim.realm.side / 2);
  return [half, half];
}

function use(sim: Sim, id: string): boolean {
  const [x, y] = centre(sim);
  return sim.usePower(id, x, y);
}

describe('calamity wiring to terrain (02 section 8.2)', () => {
  it('tremor starts a small quake at the rolled tile', () => {
    const sim = landSim();
    expect(quakeActive(sim)).toBe(false);
    expect(runCalamity(sim, 'tremor')).toBe(true);
    expect(quakeActive(sim)).toBe(true);
  });

  it('skyfall drops a small meteor that leaves mineral nodes', () => {
    const sim = landSim();
    expect(runCalamity(sim, 'skyfall')).toBe(true);
    let nodes = 0;
    for (let i = 0; i < sim.realm.tileCount; i++) if (FLORA[(sim.realm.flora[i] ?? 0) - 1]?.kind === 'mineral') nodes++;
    expect(nodes).toBeGreaterThan(0);
  });
});

describe('grow and sky powers (12 section 8.3, 8.4)', () => {
  it('seed biome covers the tile and its neighbours with the biome cover', () => {
    const sim = landSim();
    const r = sim.realm;
    expect(use(sim, 'grow_seed_biome')).toBe(true);
    const [x, y] = centre(sim);
    const cover = biomeCoverId(BIOMES.findIndex((b) => b.id === 'verdant_reach'), false);
    expect(r.cover[y * r.side + x]).toBe(cover);
    expect(r.cover[y * r.side + x + 1]).toBe(cover);
  });

  it('plant flora needs a biome that lists it, then plants the species on a bare tile', () => {
    const sim = landSim();
    const r = sim.realm;
    const [x, y] = centre(sim);
    const i = y * r.side + x;
    expect(use(sim, 'grow_flora_herb')).toBe(false);
    r.setCover(i, biomeCoverId(BIOMES.findIndex((b) => b.id === 'verdant_reach'), false));
    expect(use(sim, 'grow_flora_herb')).toBe(true);
    expect(r.flora[i]).toBe(floraCode('herb'));
    expect(use(sim, 'grow_flora_herb')).toBe(false);
  });

  it('ignite starts a fire even on bare ground', () => {
    const sim = landSim();
    const r = sim.realm;
    const [x, y] = centre(sim);
    expect(use(sim, 'sky_ignite')).toBe(true);
    expect(r.hasFlag(y * r.side + x, FLAG.burning)).toBe(true);
  });

  it('rain douses a fire on the tile', () => {
    const sim = landSim();
    const r = sim.realm;
    const [x, y] = centre(sim);
    const i = y * r.side + x;
    startFire(sim, i, true);
    expect(r.hasFlag(i, FLAG.burning)).toBe(true);
    expect(use(sim, 'sky_rain')).toBe(true);
    expect(r.hasFlag(i, FLAG.burning)).toBe(false);
  });

  it('snow freezes a shoal tile', () => {
    const sim = landSim();
    const r = sim.realm;
    const [x, y] = centre(sim);
    const i = y * r.side + x;
    r.setGround(i, G.shoal);
    expect(use(sim, 'sky_snow')).toBe(true);
    expect(r.hasFlag(i, FLAG.frozen)).toBe(true);
  });

  it('quench cools molten ground to knoll', () => {
    const sim = landSim();
    const r = sim.realm;
    const [x, y] = centre(sim);
    const i = y * r.side + x;
    r.setGround(i, G.molten_4);
    expect(use(sim, 'sky_quench')).toBe(true);
    expect(r.ground[i]).toBe(G.knoll);
  });

  it('quench leaves magma alone under eternal_magma', () => {
    const sim = landSim();
    const r = sim.realm;
    const [x, y] = centre(sim);
    const i = y * r.side + x;
    r.setGround(i, G.molten_4);
    sim.rules.set('eternal_magma', true);
    expect(use(sim, 'sky_quench')).toBe(false);
    expect(r.ground[i]).toBe(G.molten_4);
  });

  it('warm and chill move the tile heat by 15 and clamp at zero', () => {
    const sim = landSim();
    const r = sim.realm;
    const [x, y] = centre(sim);
    const i = y * r.side + x;
    expect(use(sim, 'sky_warm')).toBe(true);
    expect(r.heat[i]).toBe(15);
    expect(use(sim, 'sky_chill')).toBe(true);
    expect(r.heat[i]).toBe(0);
    expect(use(sim, 'sky_chill')).toBe(true);
    expect(r.heat[i]).toBe(0);
  });
});

describe('landmark and creep powers (12 section 8.3)', () => {
  it('fire vent places a small volcano with molten ground at the centre', () => {
    const sim = landSim();
    const r = sim.realm;
    expect(use(sim, 'lm_fire_vent')).toBe(true);
    expect(terrainState(sim).vents).toHaveLength(1);
    expect(terrainState(sim).vents[0]?.kind).toBe('volcano');
    const [x, y] = centre(sim);
    expect(ground(r.ground[y * r.side + x] ?? 0).layer).toBe('molten');
  });

  it('hot spring and acid spring place water and acid geysers', () => {
    const sim = landSim();
    expect(use(sim, 'lm_hotspring')).toBe(true);
    expect(use(sim, 'lm_acidspring')).toBe(true);
    expect(terrainState(sim).vents.map((v) => v.kind)).toEqual(['water', 'acid']);
  });

  it('creep powers place their hub on a tile with a free neighbour', () => {
    const sim = landSim();
    expect(use(sim, 'creep_gloomgrowth')).toBe(true);
    const hubs = terrainState(sim).hubs;
    expect(hubs).toHaveLength(1);
    expect(hubs[0]?.def).toBe('gloom_heart');
    expect(use(sim, 'creep_gloomgrowth')).toBe(false);
  });

  it('every new handler is a catalogue power with its own id', () => {
    for (const id of ['lm_fire_vent', 'lm_hotspring', 'lm_acidspring', 'creep_gloomgrowth', 'creep_bloatmoss', 'creep_gourdgrowth', 'sky_warm', 'sky_chill']) {
      expect(POWER_BY_ID.has(id), id).toBe(true);
    }
    expect(POWER_BY_ID.get('sky_warm')?.tab).toBe('sky');
    expect(POWER_BY_ID.get('creep_bloatmoss')?.tab).toBe('grow');
  });
});
