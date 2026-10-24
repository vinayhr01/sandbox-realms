import { describe, expect, it } from 'vitest';
import { decodeChronicle, encodeChronicle } from '../../src/sim/chronicle.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';
import type { Sim } from '../../src/sim/sim.ts';

function seeded(): Sim {
  return generateRealm({ seed: 5, sizeStep: 2, template: 'continent' }).sim;
}

/** Saves a sim after an edit the decoder must refuse, and returns the bytes. */
function savedWith(edit: (sim: Sim) => void): Uint8Array {
  const sim = seeded();
  edit(sim);
  return encodeChronicle(sim);
}

describe('chronicle payload shapes (review fix 5)', () => {
  it('an untouched save still loads', () => {
    expect(() => decodeChronicle(encodeChronicle(seeded()))).not.toThrow();
  });

  it('rejects an age slot index outside the eight slots', () => {
    expect(() => decodeChronicle(savedWith((s) => (s.ages.slotIndex = 9)))).toThrow(/ages/);
  });

  it('rejects an unknown current age', () => {
    expect(() => decodeChronicle(savedWith((s) => (s.ages.current = 'no_such_age')))).toThrow(/ages/);
  });

  it('rejects a non-finite weather cloud field', () => {
    const bad = savedWith((s) => {
      s.weather.clouds.push({ type: 'ash', x: Number.NaN, y: 1, speed: 1, age: 0, dropTimer: 0, dropInterval: 5 });
    });
    expect(() => decodeChronicle(bad)).toThrow(/weather/);
  });

  it('rejects a creed whose holders are not numbers', () => {
    const bad = savedWith((s) => {
      s.culture.creeds.push({ id: 99, holders: new Set([Number.NaN]) });
    });
    expect(() => decodeChronicle(bad)).toThrow(/culture/);
  });
});
