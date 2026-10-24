import { describe, expect, it } from 'vitest';
import { SPECIES } from '../../src/content/beasts.ts';
import { G } from '../../src/content/grounds.ts';
import { POWER_BY_ID } from '../../src/content/powers.ts';
import { spawnBeing } from '../../src/sim/beings/system.ts';
import { usePowerById } from '../../src/sim/powers/handlers.ts';
import { loreKnown } from '../../src/sim/powers/rites.ts';
import { Sim } from '../../src/sim/sim.ts';

/** A sim whose every tile is lowloam land, so spawns at any tile succeed. */
function landSim(seed = 9): Sim {
  const sim = new Sim(seed, 1);
  const r = sim.realm;
  for (let i = 0; i < r.tileCount; i++) {
    r.setElevation(i, 200);
    r.setGround(i, G.lowloam);
  }
  return sim;
}

/** Wild species indices in SPECIES order. */
const WILD = SPECIES.map((_, k) => k).filter((k) => SPECIES[k]!.wild);

function spawnAt(sim: Sim, species: number, x: number, y: number): number {
  const slot = spawnBeing(sim, species, x, y, true);
  expect(slot, `spawn at ${x},${y}`).toBeGreaterThanOrEqual(0);
  return slot;
}

describe('ritual and insight powers', () => {
  it('registry: bless is gated by rituals, lore is a sim handler with no window', () => {
    const bless = POWER_BY_ID.get('favour_bless')!;
    const lore = POWER_BY_ID.get('insight_lore')!;
    expect(bless.tab).toBe('favour');
    expect(bless.handler).toBe('bless');
    expect(bless.requires).toEqual(['rituals']);
    expect(lore.tab).toBe('insight');
    expect(lore.handler).toBe('lore');
    expect(lore.requires).toEqual([]);
  });

  it('bless is refused while rituals is off and changes nothing', () => {
    const sim = landSim();
    const c = Math.floor(sim.realm.side / 2);
    const slot = spawnAt(sim, WILD[0]!, c, c);
    sim.rules.set('rituals', false);
    expect(usePowerById(sim, 'favour_bless', c, c)).toBe(false);
    expect(sim.effects.has(slot, 'warded')).toBe(false);
  });

  it('bless gives warded to beings within radius 3 and not beyond', () => {
    const sim = landSim();
    const c = Math.floor(sim.realm.side / 2);
    const near = spawnAt(sim, WILD[0]!, c + 3, c - 3);
    const far = spawnAt(sim, WILD[0]!, c + 4, c);
    const centre = spawnAt(sim, WILD[0]!, c, c);
    expect(usePowerById(sim, 'favour_bless', c, c)).toBe(true);
    expect(sim.effects.has(near, 'warded')).toBe(true);
    expect(sim.effects.has(centre, 'warded')).toBe(true);
    expect(sim.effects.has(far, 'warded')).toBe(false);
  });

  it('bless with no being in range still counts as a use', () => {
    const sim = landSim();
    expect(usePowerById(sim, 'favour_bless', 5, 5)).toBe(true);
  });

  it('lore records the species in range as codex discoveries, once each', () => {
    const sim = landSim();
    const c = Math.floor(sim.realm.side / 2);
    const a = WILD[0]!;
    const b = WILD[1]!;
    spawnAt(sim, a, c, c);
    spawnAt(sim, b, c + 2, c);
    spawnAt(sim, WILD[2]!, c + 6, c); // outside radius 4
    expect(usePowerById(sim, 'insight_lore', c, c)).toBe(true);
    expect(loreKnown(sim)).toEqual([SPECIES[a]!.id, SPECIES[b]!.id]);
    expect(sim.lifetime.sets['discoveries']).toEqual([`species:${SPECIES[a]!.id}`, `species:${SPECIES[b]!.id}`]);
    // A second read records nothing new.
    usePowerById(sim, 'insight_lore', c, c);
    expect(loreKnown(sim)).toHaveLength(2);
  });

  it('lore does not need rituals', () => {
    const sim = landSim();
    const c = Math.floor(sim.realm.side / 2);
    spawnAt(sim, WILD[0]!, c, c);
    sim.rules.set('rituals', false);
    expect(usePowerById(sim, 'insight_lore', c, c)).toBe(true);
    expect(loreKnown(sim)).toEqual([SPECIES[WILD[0]!]!.id]);
  });
});
