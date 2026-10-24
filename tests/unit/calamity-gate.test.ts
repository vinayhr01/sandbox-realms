import { describe, expect, it } from 'vitest';
import { generateRealm } from '../../src/sim/worldgen.ts';
import { hamletsOf } from '../../src/sim/settlements/adapter.ts';
import { calamityInputs } from '../../src/sim/powers/handlers.ts';

describe('calamity roll inputs (02 section 8.1)', () => {
  it('passes the live hamlet count to the hamlet gate', () => {
    const { sim } = generateRealm({ seed: 11, sizeStep: 2, template: 'continent' });
    expect(calamityInputs(sim).hamlets).toBe(0);
    for (let t = 0; t < 20 * 60 * 3 && hamletsOf(sim).length === 0; t++) sim.step();
    expect(hamletsOf(sim).length).toBeGreaterThan(0);
    expect(calamityInputs(sim).hamlets).toBe(hamletsOf(sim).length);
  });
});
