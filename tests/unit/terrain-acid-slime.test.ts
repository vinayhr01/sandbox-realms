import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/sim/sim.ts';
import { G, groundId } from '../../src/content/grounds.ts';
import { BIOMES, biomeCoverId, biomeOfCover } from '../../src/content/biomes.ts';
import { acidTerraform } from '../../src/sim/terrain/acid.ts';
import { spillSlime } from '../../src/sim/terrain/slime.ts';
import { terrainState } from '../../src/sim/terrain/state.ts';
import { CREEP_GUARD_TICKS } from '../../src/content/creeps.ts';

const ASH = BIOMES.findIndex((b) => b.id === 'ashbarren');
const VERDANT = BIOMES.findIndex((b) => b.id === 'verdant_reach');

describe('acid (04 section 4.1)', () => {
  it('bare soil becomes ashbarren', () => {
    const sim = new Sim(1, 1);
    const r = sim.realm;
    const i = 10 * r.side + 10;
    r.setGround(i, G.lowloam);
    acidTerraform(sim, i);
    expect(biomeOfCover(r.cover[i] ?? 0)).toBe(ASH);
  });

  it('a living biome cover is stripped', () => {
    const sim = new Sim(1, 1);
    const r = sim.realm;
    const i = 11 * r.side + 11;
    r.setGround(i, G.lowloam);
    r.setCover(i, biomeCoverId(VERDANT, false));
    acidTerraform(sim, i);
    expect(r.cover[i]).toBe(0);
  });

  it('ashbarren cover is left alone', () => {
    const sim = new Sim(1, 1);
    const r = sim.realm;
    const i = 12 * r.side + 12;
    r.setGround(i, G.lowloam);
    r.setCover(i, biomeCoverId(ASH, false));
    acidTerraform(sim, i);
    expect(r.cover[i]).toBe(biomeCoverId(ASH, false));
  });

  it('creep is cleaned to lowloam and guarded for 20 s', () => {
    const sim = new Sim(1, 1);
    const r = sim.realm;
    const i = 13 * r.side + 13;
    r.setGround(i, G.gloomgrowth);
    acidTerraform(sim, i);
    expect(r.ground[i]).toBe(G.lowloam);
    expect(terrainState(sim).creepGuard.get(i)).toBe(sim.tick + CREEP_GUARD_TICKS);
  });
});

describe('slime (04 section 4.2)', () => {
  function slimeBlock(sim: Sim, cx: number, cy: number): number[] {
    const r = sim.realm;
    const tiles: number[] = [];
    for (let y = cy - 1; y <= cy + 1; y++) {
      for (let x = cx - 1; x <= cx + 1; x++) {
        r.setGround(y * r.side + x, G.slagooze);
        tiles.push(y * r.side + x);
      }
    }
    return tiles;
  }

  it('slagooze is assigned by spilling onto land and joins the slime set', () => {
    const sim = new Sim(9, 1);
    const r = sim.realm;
    for (let y = 20; y < 30; y++) for (let x = 20; x < 30; x++) r.setGround(y * r.side + x, G.lowloam);
    const turned = spillSlime(sim, 25, 25, 2);
    expect(turned).toBeGreaterThan(0);
    expect(r.ground[25 * r.side + 25]).toBe(G.slagooze);
    expect(r.slime.has(25 * r.side + 25)).toBe(true);
  });

  it('every tile that leaves the slime set becomes a pit, and the set stays bounded', () => {
    const sim = new Sim(9, 1);
    const r = sim.realm;
    for (let y = 20; y < 40; y++) for (let x = 20; x < 40; x++) r.setGround(y * r.side + x, G.lowloam);
    const block = slimeBlock(sim, 30, 30);
    const initial = new Set(block);
    for (let t = 0; t < 2000; t++) sim.step();
    // A pit beside the sea refills to deepmere (04 section 2), so either sea-side kind is correct.
    for (const i of initial) {
      if (!r.slime.has(i)) expect([G.dug_deepmere, G.deepmere]).toContain(r.ground[i]);
    }
    expect(r.slime.size).toBeLessThan(400);
  });

  it('slime never exists under sanctuary_seal', () => {
    const sim = new Sim(9, 1);
    const r = sim.realm;
    sim.rules.set('sanctuary_seal', true);
    for (let y = 20; y < 30; y++) for (let x = 20; x < 30; x++) r.setGround(y * r.side + x, G.lowloam);
    expect(spillSlime(sim, 25, 25, 3)).toBe(0);
    expect(r.slime.size).toBe(0);
    expect(groundId('slagooze')).toBe(G.slagooze);
  });
});
