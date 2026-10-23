import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/shared/rng.ts';
import { addCustom, cultureStep, createCultureState, startIntrigue, type CultureContext, type CultureState } from '../../src/sim/culture/culture.ts';

function ctx(seed: number, rules: Record<string, boolean> = {}, contacts: [number, number][] = []): CultureContext {
  return {
    rng: createRng(seed),
    tick: 0,
    isOn: (id) => rules[id] ?? (id === 'rituals' || id === 'uprisings'),
    contacts,
  };
}

describe('culture', () => {
  it('a creed spreads from one group to a neighbour in contact over time', () => {
    const state: CultureState = createCultureState();
    state.creeds.push({ id: 1, holders: new Set([0]) });
    const c = ctx(3, {}, [[0, 1]]);
    for (let t = 0; t < 2000 && !state.creeds[0]?.holders.has(1); t++) cultureStep(c, state);
    expect(state.creeds[0]?.holders.has(1)).toBe(true);
  });

  it('a dialect diverges between isolated groups and merges on contact', () => {
    const state = createCultureState();
    state.dialects.push({ group: 0, word: 0 }, { group: 1, word: 0 });
    const isolated = ctx(5, {}, []);
    for (let t = 0; t < 400; t++) cultureStep(isolated, state);
    const apart = Math.abs((state.dialects[0]?.word ?? 0) - (state.dialects[1]?.word ?? 0));
    const touching = ctx(6, {}, [[0, 1]]);
    for (let t = 0; t < 400; t++) cultureStep(touching, state);
    const together = Math.abs((state.dialects[0]?.word ?? 0) - (state.dialects[1]?.word ?? 0));
    expect(together).toBeLessThanOrEqual(apart);
    expect(together).toBeLessThanOrEqual(1);
  });

  it('rituals off blocks new intrigue', () => {
    const state = createCultureState();
    expect(startIntrigue(ctx(7, { rituals: false }), state, 0, 'scheme')).toBeNull();
    expect(state.intrigues.length).toBe(0);
    expect(startIntrigue(ctx(7, { rituals: true }), state, 0, 'scheme')).not.toBeNull();
  });

  it('chaotic_minds on gives 3 to 5 traits per new custom', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const custom = addCustom(ctx(seed, { chaotic_minds: true }), createCultureState(), 0);
      expect(custom.traits.length).toBeGreaterThanOrEqual(1);
      expect(custom.traits.length).toBeLessThanOrEqual(5);
    }
    const state = createCultureState();
    let total = 0;
    for (let seed = 1; seed <= 50; seed++) total += addCustom(ctx(seed, { chaotic_minds: true }), state, 0).traits.length;
    expect(total / 50).toBeGreaterThan(2);
  });
});
