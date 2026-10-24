import { describe, expect, it } from 'vitest';
import { BIOMES, biomeCoverId } from '../../src/content/biomes.ts';
import { G } from '../../src/content/grounds.ts';
import { floraCode, grazeFlora, wildSeeding } from '../../src/sim/flora.ts';
import { Sim } from '../../src/sim/sim.ts';
import { TUNING } from '../../src/sim/beings/tuning.ts';

/**
 * Regrowth after grazing (06 section 2.2): a grazed tile is bare and cannot be re-seeded until
 * floraBlockedUntil has passed. Only the target tile can take flora, so any seeding there is
 * attributable to the rule under test.
 */
function setup(): { sim: Sim; i: number } {
  const sim = new Sim(77, 2);
  const r = sim.realm;
  const x = 50;
  const y = 50;
  const i = y * r.side + x;
  r.setGround(i, G.lowloam);
  const bloomfield = BIOMES.findIndex((b) => b.id === 'bloomfield');
  expect(bloomfield).toBeGreaterThanOrEqual(0);
  r.setCover(i, biomeCoverId(bloomfield, false));
  return { sim, i };
}

describe('flora regrowth after grazing', () => {
  it('a grazed flora tile is bare and blocked for regrowDelay ticks', () => {
    const { sim, i } = setup();
    const r = sim.realm;
    r.setFlora(i, floraCode('herb'), sim.tick);
    grazeFlora(sim, i);
    expect(r.flora[i]).toBe(0);
    expect(r.floraBlockedUntil[i]).toBe(sim.tick + TUNING.regrowDelay);
  });

  it('cannot be re-seeded while floraBlockedUntil is still in the future', () => {
    const { sim, i } = setup();
    const r = sim.realm;
    r.setFlora(i, floraCode('herb'), sim.tick);
    grazeFlora(sim, i);
    const blockedUntil = r.floraBlockedUntil[i] ?? 0;
    sim.tick = blockedUntil - 1;
    wildSeeding(sim, 60_000);
    expect(r.flora[i]).toBe(0);
  });

  it('can be re-seeded once the regrowDelay has passed', () => {
    const { sim, i } = setup();
    const r = sim.realm;
    r.setFlora(i, floraCode('herb'), sim.tick);
    grazeFlora(sim, i);
    sim.tick = r.floraBlockedUntil[i] ?? 0;
    wildSeeding(sim, 60_000);
    expect(r.flora[i]).not.toBe(0);
  });
});
