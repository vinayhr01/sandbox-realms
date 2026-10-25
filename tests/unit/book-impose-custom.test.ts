import { describe, expect, it } from 'vitest';
import { SPECIES, speciesIndex } from '../../src/content/beasts.ts';
import { spawnBeing, spawnFolk } from '../../src/sim/beings/system.ts';
import { MAX_BEINGS } from '../../src/sim/beings/store.ts';
import { type Book, type Custom } from '../../src/sim/culture/culture.ts';
import { imposeCustom, readBook } from '../../src/sim/culture/effects.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';
import type { Sim } from '../../src/sim/sim.ts';

// 11 section 5 (the book conversion lottery, readBook) and 07 section 13 / 11 section 9.1 (the Architect's word,
// imposeCustom). The group of a Being comes from the allegiance record when it has one, so the tests set that record
// directly; no dominion needs to exist.

function world(): Sim {
  return generateRealm({ seed: 9, sizeStep: 2, template: 'continent', startingBeasts: false }).sim;
}

/** A custom of a group, as the culture state keeps it (addCustom draws the traits; the tests give them). */
function addCustom(sim: Sim, group: number, traits: string[] = []): void {
  const custom: Custom = { group, traits, creator: group, born: 0 };
  sim.culture.customs.push(custom);
}

/** Culture key of a slot (generation * MAX_BEINGS + slot, as culture/effects.ts keys a Being). */
function keyOf(sim: Sim, slot: number): string {
  return String((sim.beings.store.generation[slot] ?? 0) * MAX_BEINGS + slot);
}

/** A living Folk on the first walkable tile of the realm. */
function folkSlot(sim: Sim): number {
  const folk = SPECIES.findIndex((s) => s.folk);
  const side = sim.realm.side;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const slot = spawnFolk(sim, folk, x, y);
      if (slot >= 0) return slot;
    }
  }
  throw new Error('no walkable tile for a Folk');
}

describe('imposeCustom: the Architect talk (11 section 9.1, 07 section 13)', () => {
  it('a Folk listener takes the custom of the speaker dominion', () => {
    const sim = world();
    addCustom(sim, 2);
    const speaker = folkSlot(sim);
    const listener = folkSlot(sim);
    sim.culture.allegiance = { [keyOf(sim, speaker)]: 2 };
    imposeCustom(sim, speaker, listener);
    expect(sim.culture.allegiance[keyOf(sim, listener)]).toBe(2);
  });

  it('nothing changes when the speaker dominion has no custom', () => {
    const sim = world();
    addCustom(sim, 1);
    const speaker = folkSlot(sim);
    const listener = folkSlot(sim);
    sim.culture.allegiance = { [keyOf(sim, speaker)]: 2 };
    imposeCustom(sim, speaker, listener);
    expect(sim.culture.allegiance[keyOf(sim, listener)]).toBeUndefined();
  });

  it('a rooted custom of the listener blocks the imposition', () => {
    const sim = world();
    addCustom(sim, 1, ['rooted']);
    addCustom(sim, 2);
    const speaker = folkSlot(sim);
    const listener = folkSlot(sim);
    sim.culture.allegiance = { [keyOf(sim, speaker)]: 2, [keyOf(sim, listener)]: 1 };
    imposeCustom(sim, speaker, listener);
    expect(sim.culture.allegiance[keyOf(sim, listener)]).toBe(1);
  });

  it('a listener that is not Folk is not converted', () => {
    const sim = world();
    addCustom(sim, 2);
    const speaker = folkSlot(sim);
    let listener = -1;
    for (let y = 0; y < sim.realm.side && listener < 0; y++) {
      for (let x = 0; x < sim.realm.side && listener < 0; x++) listener = spawnBeing(sim, speciesIndex('boneshambler'), x, y, true);
    }
    expect(listener).toBeGreaterThanOrEqual(0);
    sim.culture.allegiance = { [keyOf(sim, speaker)]: 2 };
    imposeCustom(sim, speaker, listener);
    expect(sim.culture.allegiance[keyOf(sim, listener)]).toBeUndefined();
  });

  it('a speaker that follows no dominion imposes nothing', () => {
    const sim = world();
    addCustom(sim, 2);
    const speaker = folkSlot(sim);
    const listener = folkSlot(sim);
    sim.culture.allegiance = {};
    imposeCustom(sim, speaker, listener);
    expect(sim.culture.allegiance[keyOf(sim, listener)]).toBeUndefined();
  });
});

describe('readBook: the conversion lottery (11 section 5)', () => {
  // Readers are slots 0..199 with no Being in them: the book rule reads only the culture keys and the custom rules.
  const READERS = 200;
  const book: Book = { id: 1, group: 2, mood: 0, xp: 0 };

  it('a reader of another dominion converts to the book group about half the time', () => {
    const sim = world();
    addCustom(sim, 1);
    addCustom(sim, 2);
    sim.culture.allegiance = {};
    for (let r = 0; r < READERS; r++) sim.culture.allegiance[keyOf(sim, r)] = 1;
    for (let r = 0; r < READERS; r++) readBook(sim, r, book);
    const converted = Object.values(sim.culture.allegiance).filter((g) => g === 2).length;
    expect(converted).toBeGreaterThanOrEqual(60);
    expect(converted).toBeLessThanOrEqual(140);
  });

  it('a reader already in the book group is not changed', () => {
    const sim = world();
    addCustom(sim, 1);
    addCustom(sim, 2);
    sim.culture.allegiance = { [keyOf(sim, 0)]: 2 };
    for (let k = 0; k < 20; k++) readBook(sim, 0, book);
    expect(sim.culture.allegiance[keyOf(sim, 0)]).toBe(2);
  });

  it('a rooted reader is never converted', () => {
    const sim = world();
    addCustom(sim, 1, ['rooted']);
    addCustom(sim, 2);
    sim.culture.allegiance = {};
    for (let r = 0; r < READERS; r++) sim.culture.allegiance[keyOf(sim, r)] = 1;
    for (let r = 0; r < READERS; r++) readBook(sim, r, book);
    expect(Object.values(sim.culture.allegiance).every((g) => g === 1)).toBe(true);
  });

  it('without a custom on the book side there is no conversion', () => {
    const sim = world();
    addCustom(sim, 1);
    sim.culture.allegiance = {};
    for (let r = 0; r < READERS; r++) sim.culture.allegiance[keyOf(sim, r)] = 1;
    for (let r = 0; r < READERS; r++) readBook(sim, r, book);
    expect(Object.values(sim.culture.allegiance).every((g) => g === 1)).toBe(true);
  });
});
