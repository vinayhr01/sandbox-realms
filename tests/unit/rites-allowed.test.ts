import { describe, expect, it } from 'vitest';
import { generateRealm } from '../../src/sim/worldgen.ts';
import { addDominion, parcelsPerAxis } from '../../src/sim/dominions/adapter.ts';
import { hamletsOf, settlementsStep } from '../../src/sim/settlements/adapter.ts';
import { riteAllowed, type RiteEnv } from '../../src/sim/culture/rites.ts';
import { RITUALS_RULE } from '../../src/sim/rules.ts';
import type { Sim } from '../../src/sim/sim.ts';

// 11 section 3, 4.2: riteAllowed = built, the creed holds the rite's tenet, the `rituals` rule is on, and a target exists.
// wardRite targets the caster's own dominion (needs a parcel); pitRite targets an enemy hamlet (a hamlet held by a dominion
// that is not at peace). Dominion 1 holds one parcel outside the first hamlet; dominion 2 holds that hamlet.

const SEEDS = [4242, 1, 555, 31337, 2024];
const AT_WAR: RiteEnv = { relationOf: () => 'war' };
const AT_PEACE: RiteEnv = { relationOf: () => 'peace' };

function riteWorld(): Sim {
  for (const seed of SEEDS) {
    const sim = generateRealm({ seed, sizeStep: 2, template: 'continent' }).sim;
    settlementsStep(sim);
    const hamlet = hamletsOf(sim)[0];
    if (!hamlet) continue;
    const perAxis = parcelsPerAxis(sim);
    const own = Array.from({ length: perAxis * perAxis }, (_, p) => p).find((p) => !hamlet.parcels.has(p));
    if (own === undefined) continue;
    addDominion(sim, 1, 10, [own]);
    addDominion(sim, 2, 10, [...hamlet.parcels]);
    return sim;
  }
  throw new Error('no seed placed a hamlet');
}

/** Gives dominion 1 a creed that holds these tenets. */
function withCreed(sim: Sim, tenets: string[]): void {
  sim.culture.creeds.push({ id: 1, holders: new Set([1]), tenets });
}

describe('riteAllowed: wardRite (target: own dominion)', () => {
  it('passes with the tenet, the rule on and a parcel', () => {
    const sim = riteWorld();
    withCreed(sim, ['wardRite']);
    expect(riteAllowed(sim, AT_PEACE, 'wardRite', 1)).toBe(true);
  });

  it('fails without the tenet', () => {
    const sim = riteWorld();
    withCreed(sim, ['pitRite']);
    expect(riteAllowed(sim, AT_PEACE, 'wardRite', 1)).toBe(false);
  });

  it('fails while the rituals rule is off', () => {
    const sim = riteWorld();
    withCreed(sim, ['wardRite']);
    expect(sim.rules.set(RITUALS_RULE, false)).toBe(true);
    expect(riteAllowed(sim, AT_PEACE, 'wardRite', 1)).toBe(false);
    sim.rules.set(RITUALS_RULE, true);
    expect(riteAllowed(sim, AT_PEACE, 'wardRite', 1)).toBe(true);
  });

  it('fails when the dominion holds no parcel (no target)', () => {
    const sim = riteWorld();
    withCreed(sim, ['wardRite']);
    expect(riteAllowed(sim, AT_PEACE, 'wardRite', 3)).toBe(false);
    sim.culture.creeds[0]!.holders.add(3);
    addDominion(sim, 3, 10, []);
    expect(riteAllowed(sim, AT_PEACE, 'wardRite', 3)).toBe(false);
  });
});

describe('riteAllowed: pitRite (target: enemy hamlet)', () => {
  it('passes with the tenet, the rule on and an enemy hamlet at war', () => {
    const sim = riteWorld();
    withCreed(sim, ['pitRite']);
    expect(riteAllowed(sim, AT_WAR, 'pitRite', 1)).toBe(true);
  });

  it('fails without the tenet', () => {
    const sim = riteWorld();
    withCreed(sim, ['wardRite']);
    expect(riteAllowed(sim, AT_WAR, 'pitRite', 1)).toBe(false);
  });

  it('fails while the rituals rule is off', () => {
    const sim = riteWorld();
    withCreed(sim, ['pitRite']);
    sim.rules.set(RITUALS_RULE, false);
    expect(riteAllowed(sim, AT_WAR, 'pitRite', 1)).toBe(false);
  });

  it('fails when the only other hamlet is at peace with the caster (no enemy target)', () => {
    const sim = riteWorld();
    withCreed(sim, ['pitRite']);
    expect(riteAllowed(sim, AT_PEACE, 'pitRite', 1)).toBe(false);
  });

  it('fails when the caster holds the only hamlet (own hamlets are not enemies)', () => {
    const sim = riteWorld();
    withCreed(sim, ['pitRite']);
    // Dominion 2 is the hamlet holder; asked for dominion 2 the hamlet is its own, not an enemy.
    sim.culture.creeds[0]!.holders.add(2);
    expect(riteAllowed(sim, AT_WAR, 'pitRite', 2)).toBe(false);
  });
});
