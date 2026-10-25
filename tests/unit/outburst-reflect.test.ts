import { describe, expect, it } from 'vitest';
import { speciesIndex } from '../../src/content/beasts.ts';
import { BEING_TRAIT_INDEX } from '../../src/content/traits.ts';
import { MOOD_VALUE } from '../../src/content/moods.ts';
import { spawnBeing } from '../../src/sim/beings/system.ts';
import { EMOTIONS_TRAIT } from '../../src/sim/beings/social.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';
import type { Sim } from '../../src/sim/sim.ts';

// 06 section 4.2 (reflect starts an outburst below mood -70, not for stalwartheart) and 08 section 5.4 (an outburst that
// ends gives outburst_done). The reflect decision is picked by the decision layer, so the start tests run the sim and
// force the mood each tick; the negative tests hold for any pick.

/** Mood the start tests force each tick (below the -70 trigger). */
const LOW = -90;
/** Ticks a start test may run before it gives up. */
const START_TICKS = 3000;

function emptyRealm(): Sim {
  return generateRealm({ seed: 21, sizeStep: 2, template: 'continent', startingBeasts: false }).sim;
}

/**
 * One wild Being whose strain feels mood (social.ts: the strain holds EMOTIONS_TRAIT). Placed on the first walkable tile.
 * Nothing else is in the realm, so no other Being is in sight for an outburst to strike.
 */
function feelingBeing(sim: Sim): number {
  const species = speciesIndex('boneshambler');
  const side = sim.realm.side;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const slot = spawnBeing(sim, species, x, y, true);
      if (slot < 0) continue;
      sim.beings.strains.get(sim.beings.store.strain[slot] ?? 0)?.traits.push(EMOTIONS_TRAIT);
      return slot;
    }
  }
  throw new Error('no walkable tile in the realm');
}

describe('outburst trigger (06 section 4.2)', () => {
  it('a feeling Being below mood -70 starts an outburst on a reflect pick', () => {
    const sim = emptyRealm();
    const slot = feelingBeing(sim);
    let started = false;
    for (let t = 0; t < START_TICKS && !started; t++) {
      sim.beings.store.mood[slot] = LOW;
      sim.step();
      started = sim.effects.has(slot, 'outburst');
    }
    expect(started).toBe(true);
  });

  it('a feeling Being at mood -60 never starts an outburst', () => {
    const sim = emptyRealm();
    const slot = feelingBeing(sim);
    for (let t = 0; t < START_TICKS; t++) {
      sim.beings.store.mood[slot] = -60;
      sim.step();
      expect(sim.effects.has(slot, 'outburst')).toBe(false);
    }
  });

  it('a stalwartheart Being never starts an outburst, even at mood -90', () => {
    const sim = emptyRealm();
    const slot = feelingBeing(sim);
    sim.beings.store.setMark(slot, BEING_TRAIT_INDEX.get('stalwartheart') ?? -1, true);
    for (let t = 0; t < START_TICKS; t++) {
      sim.beings.store.mood[slot] = LOW;
      sim.step();
      expect(sim.effects.has(slot, 'outburst')).toBe(false);
    }
  });
});

describe('outburst expiry (08 section 5.4)', () => {
  it('an outburst that ends gives outburst_done to the Being', () => {
    const sim = emptyRealm();
    const slot = feelingBeing(sim);
    sim.effects.add(slot, 'outburst', sim.tick, 5);
    let steps = 0;
    while (sim.effects.has(slot, 'outburst') && steps < 20) {
      // Mood is set to 0 before each tick, so the mood after the expiring tick is the outburst_done value alone.
      sim.beings.store.mood[slot] = 0;
      sim.step();
      steps++;
    }
    expect(sim.effects.has(slot, 'outburst')).toBe(false);
    expect(sim.beings.store.mood[slot]).toBe(MOOD_VALUE.outburst_done);
  });
});
