import { describe, expect, it } from 'vitest';
import { generateRealm } from '../../src/sim/worldgen.ts';
import { hamletsOf } from '../../src/sim/settlements/adapter.ts';

/** Regression: territory expansion once let two hamlets claim the same parcel (seed 11 at tick 400). */
describe('hamlet territory never overlaps', () => {
  it('no parcel is owned by two hamlets over three sim years (seed 11)', () => {
    const sim = generateRealm({ seed: 11, sizeStep: 2, template: 'continent' }).sim;
    for (let t = 0; t < 20 * 60 * 3; t++) {
      sim.step();
      const seen = new Set<number>();
      for (const h of hamletsOf(sim)) {
        for (const p of h.parcels) {
          expect(seen.has(p), `parcel ${p} claimed twice at tick ${t}`).toBe(false);
          seen.add(p);
        }
      }
    }
  }, 30000);
});
