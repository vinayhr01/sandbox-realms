import { describe, expect, it, vi } from 'vitest';
import { generateRealm } from '../../src/sim/worldgen.ts';
import { seedStartingBeasts } from '../../src/sim/beings/system.ts';
import { MAX_BEINGS } from '../../src/sim/beings/store.ts';
import { addDominion, parcelsPerAxis } from '../../src/sim/dominions/adapter.ts';
import { AETHER_BASE, AETHER_REGEN_TICKS, RECOVER_CAST_TICKS, SPELL_BY_ID } from '../../src/content/spells.ts';
import { aetherOf, spellListsOf, tryCast } from '../../src/sim/spells.ts';
import type { Sim } from '../../src/sim/sim.ts';

// 08 section 9.1: tryCast gates and lazy aether. The caster's only spell is `ward_self` via a creed tenet (spell ward_self: self target, chance 0.2,
// cost 5, no cooldown, no vitality gate), so the spell pick is fixed. The `spells` stream is stubbed with a queue of next()
// values so each gate is hit on purpose: next() >= 0.5 passes the pool pick, next() < 0.2 passes the chance roll.

const WARD = SPELL_BY_ID.get('ward_self')!;

function casterWorld(): { sim: Sim; slot: number; key: number } {
  const sim = generateRealm({ seed: 4242, sizeStep: 2, template: 'continent' }).sim;
  seedStartingBeasts(sim, 4);
  const slot = sim.beings.store.at(0);
  // The spell source is a creed tenet (`spell_ward_self`) of the dominion that holds every parcel; the talent route is
  // covered by the talent test at the end.
  const perAxis = parcelsPerAxis(sim);
  addDominion(sim, 1, 10, Array.from({ length: perAxis * perAxis }, (_, p) => p));
  sim.culture.creeds.push({ id: 1, holders: new Set([1]), tenets: ['spell_ward_self'] });
  return { sim, slot, key: (sim.beings.store.generation[slot] ?? 0) * MAX_BEINGS + slot };
}

/** Replaces the `spells` stream with fixed next() values (then 0.99) and int() = 0. Returns the draw count. */
function stub(sim: Sim, nexts: number[]): { draws: () => number } {
  let n = 0;
  const fake = { next: () => nexts[n++] ?? 0.99, int: () => 0 };
  const real = sim.rng.bind(sim);
  vi.spyOn(sim, 'rng').mockImplementation(((name: string) => (name === 'spells' ? fake : real(name))) as typeof sim.rng);
  return { draws: () => n };
}

describe('tryCast gates (08 section 9.1)', () => {
  it('a Being with no spell source draws nothing and does not cast', () => {
    const { sim } = casterWorld();
    const other = sim.beings.store.at(1);
    sim.culture.creeds.length = 0;
    const s = stub(sim, [0.9, 0.1]);
    expect(tryCast(sim, other, other)).toBe(false);
    expect(s.draws()).toBe(0);
  });

  it('casts when every gate passes, spends the cost and starts recover_cast', () => {
    const { sim, slot, key } = casterWorld();
    stub(sim, [0.9, 0.1]);
    expect(aetherOf(sim, slot)).toBe(AETHER_BASE);
    expect(tryCast(sim, slot, slot)).toBe(true);
    expect(aetherOf(sim, slot)).toBe(AETHER_BASE - WARD.cost);
    expect(sim.effects.has(slot, 'warded')).toBe(true);
    expect(sim.spells.recover.get(slot)).toBe(sim.tick + RECOVER_CAST_TICKS);
    expect(key).toBeGreaterThanOrEqual(0);
  });

  it('the pool pick below 0.5 falls back to the basic blow', () => {
    const { sim, slot } = casterWorld();
    stub(sim, [0.49, 0.1]);
    expect(tryCast(sim, slot, slot)).toBe(false);
    expect(aetherOf(sim, slot)).toBe(AETHER_BASE);
  });

  it('hushed blocks the cast', () => {
    const { sim, slot } = casterWorld();
    sim.effects.add(slot, 'hushed', sim.tick);
    stub(sim, [0.9, 0.1]);
    expect(tryCast(sim, slot, slot)).toBe(false);
    expect(sim.effects.has(slot, 'warded')).toBe(false);
    sim.effects.remove(slot, 'hushed');
    expect(tryCast(sim, slot, slot)).toBe(true);
  });

  it('recover_cast blocks the cast until its tick', () => {
    const { sim, slot } = casterWorld();
    sim.spells.recover.set(slot, sim.tick + 10);
    stub(sim, [0.9, 0.1, 0.9, 0.1]);
    expect(tryCast(sim, slot, slot)).toBe(false);
    sim.spells.recover.set(slot, sim.tick);
    expect(tryCast(sim, slot, slot)).toBe(true);
  });

  it('a spell cooldown blocks the cast until its tick', () => {
    const { sim, slot } = casterWorld();
    sim.spells.cooldown.set(`${slot}:${WARD.id}`, sim.tick + 5);
    stub(sim, [0.9, 0.9, 0.1]);
    expect(tryCast(sim, slot, slot)).toBe(false);
    sim.spells.cooldown.set(`${slot}:${WARD.id}`, sim.tick);
    expect(tryCast(sim, slot, slot)).toBe(true);
  });

  it('too little aether blocks the cast; exactly the cost casts', () => {
    const { sim, slot, key } = casterWorld();
    sim.spells.aether.set(key, { value: WARD.cost - 1, at: sim.tick });
    stub(sim, [0.9, 0.9, 0.1]);
    expect(tryCast(sim, slot, slot)).toBe(false);
    sim.spells.aether.set(key, { value: WARD.cost, at: sim.tick });
    expect(tryCast(sim, slot, slot)).toBe(true);
    expect(aetherOf(sim, slot)).toBe(0);
  });

  it('a failed chance roll (next() >= 0.2) spends nothing', () => {
    const { sim, slot } = casterWorld();
    stub(sim, [0.9, 0.2]);
    expect(tryCast(sim, slot, slot)).toBe(false);
    expect(aetherOf(sim, slot)).toBe(AETHER_BASE);
    expect(sim.spells.recover.has(slot)).toBe(false);
  });
});

describe('talent spell source (08 section 9.1, 18b TAL)', () => {
  // Talent gifts (ward_gift, arc_gift, ...) are strain traits (content/traits.ts STRAIN_ROWS), so spellListsOf reads them from the Being's strain.
  it('a Being whose strain holds ward_gift can cast ward_self', () => {
    const { sim, slot } = casterWorld();
    sim.culture.creeds.length = 0;
    expect(spellListsOf(sim, slot)).toEqual([]);
    const strain = sim.beings.strains.get(sim.beings.store.strain[slot] ?? 0);
    expect(strain).toBeDefined();
    strain!.traits.push('ward_gift');
    expect(spellListsOf(sim, slot)).toEqual([['ward_self']]);
  });
});

describe('aether regeneration (lazy, one point per AETHER_REGEN_TICKS)', () => {
  it('regains one point per 60 ticks, floored', () => {
    const { sim, slot, key } = casterWorld();
    sim.tick = 1000;
    sim.spells.aether.set(key, { value: 10, at: 1000 - 2 * AETHER_REGEN_TICKS - 59 });
    expect(aetherOf(sim, slot)).toBe(12);
    sim.spells.aether.set(key, { value: 10, at: 1000 - AETHER_REGEN_TICKS + 1 });
    expect(aetherOf(sim, slot)).toBe(10);
  });

  it('is capped at the maximum', () => {
    const { sim, slot, key } = casterWorld();
    sim.tick = 100000;
    sim.spells.aether.set(key, { value: 10, at: 0 });
    expect(aetherOf(sim, slot)).toBe(AETHER_BASE);
  });

  it('a spend keeps the partial regeneration progress', () => {
    const { sim, slot, key } = casterWorld();
    sim.tick = 1000;
    sim.spells.aether.set(key, { value: 20, at: 1000 - AETHER_REGEN_TICKS - 30 });
    stub(sim, [0.9, 0.1]);
    expect(tryCast(sim, slot, slot)).toBe(true);
    // 20 + 1 regained - 5 cost; the entry keeps the 30 ticks of progress toward the next point.
    expect(aetherOf(sim, slot)).toBe(16);
    sim.tick = 1000 + AETHER_REGEN_TICKS - 30;
    expect(aetherOf(sim, slot)).toBe(17);
  });
});
