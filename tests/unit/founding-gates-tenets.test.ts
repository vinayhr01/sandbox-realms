import { describe, expect, it } from 'vitest';
import { CREED_TENETS, CREED_TENET_BY_ID } from '../../src/content/creeds.ts';
import { createCultureState, drawCreedTenet, foundCreed, foundDialect } from '../../src/sim/culture/culture.ts';
import {
  FOUND_CREED_INTELLIGENCE,
  FOUND_CREED_LEVEL,
  FOUND_CREED_MEMBERS,
  FOUND_DIALECT_INTELLIGENCE,
  FOUND_DIALECT_LEVEL,
  foundAllowed,
  type FoundFacts,
} from '../../src/sim/culture/trait-rules.ts';
import { INTRIGUE_COST, newIntrigueState, proposeIntrigues, resolveIntrigues, type FoundHooks, type IntrigueEnv } from '../../src/sim/dominions/intrigue.ts';
import { newPactState } from '../../src/sim/dominions/pacts.ts';
import { RelationMatrix, type Dominion } from '../../src/sim/dominions/types.ts';
import { createRng } from '../../src/shared/rng.ts';

// 11 sections 2, 3, 4.2 and 9.4: the creed and dialect founding gates, the founding intrigues that test them, and the
// tenet table (45 tenets; the 38 with randomSpawn are the founding pool).

/** Facts that meet every newDialect term. */
const DIALECT_READY: FoundFacts = { hasDialect: false, hasCreed: false, hasCustom: false, speech: true, memory: false, members: 0, leaderLevel: FOUND_DIALECT_LEVEL, intelligence: FOUND_DIALECT_INTELLIGENCE };
/** Facts that meet every newCreed term (a group that holds a dialect, a custom of 50 members, memory). */
const CREED_READY: FoundFacts = { hasDialect: true, hasCreed: false, hasCustom: true, speech: true, memory: true, members: FOUND_CREED_MEMBERS, leaderLevel: FOUND_CREED_LEVEL, intelligence: FOUND_CREED_INTELLIGENCE };

describe('founding gates (11 section 3, foundAllowed)', () => {
  it('uses the spec thresholds', () => {
    expect(FOUND_CREED_MEMBERS).toBe(50);
    expect(FOUND_CREED_LEVEL).toBe(5);
    expect(FOUND_CREED_INTELLIGENCE).toBe(8);
    expect(FOUND_DIALECT_LEVEL).toBe(1);
    expect(FOUND_DIALECT_INTELLIGENCE).toBe(3);
  });

  it('a newDialect needs no dialect, speech, level 1 and intelligence 3', () => {
    expect(foundAllowed('newDialect', DIALECT_READY)).toBe(true);
    expect(foundAllowed('newDialect', { ...DIALECT_READY, hasDialect: true })).toBe(false);
    expect(foundAllowed('newDialect', { ...DIALECT_READY, speech: false })).toBe(false);
    expect(foundAllowed('newDialect', { ...DIALECT_READY, leaderLevel: 0 })).toBe(false);
    expect(foundAllowed('newDialect', { ...DIALECT_READY, intelligence: 2 })).toBe(false);
  });

  it('a newCreed needs no creed, a custom, a dialect, memory, 50 members, level 5 and intelligence 8', () => {
    expect(foundAllowed('newCreed', CREED_READY)).toBe(true);
    expect(foundAllowed('newCreed', { ...CREED_READY, hasCreed: true })).toBe(false);
    expect(foundAllowed('newCreed', { ...CREED_READY, hasCustom: false })).toBe(false);
    expect(foundAllowed('newCreed', { ...CREED_READY, hasDialect: false })).toBe(false);
    expect(foundAllowed('newCreed', { ...CREED_READY, memory: false })).toBe(false);
    expect(foundAllowed('newCreed', { ...CREED_READY, members: 49 })).toBe(false);
    expect(foundAllowed('newCreed', { ...CREED_READY, leaderLevel: 4 })).toBe(false);
    expect(foundAllowed('newCreed', { ...CREED_READY, intelligence: 7 })).toBe(false);
  });
});

/** An environment with one dominion (id 1) and a founding hook whose facts the test sets. */
function world(strength: number, facts: { current: FoundFacts | undefined }, applied: string[]): { d: Dominion; env: IntrigueEnv } {
  const d: Dominion = { id: 1, parcels: new Set([0]), strength, target: -1, campaignSince: -1 };
  const found: FoundHooks = {
    facts: () => facts.current,
    apply: (kind) => {
      applied.push(kind);
      return true;
    },
  };
  const env: IntrigueEnv = { dominions: [d], borders: [], relations: new RelationMatrix(), truce: new Map(), pacts: newPactState(), tick: 0, found };
  return { d, env };
}

describe('founding intrigues (11 section 3, dominions intrigue.ts)', () => {
  it('a ruler who meets the newDialect terms proposes a dialect on the dominion, at no strength cost', () => {
    const applied: string[] = [];
    const { d, env } = world(100, { current: DIALECT_READY }, applied);
    const state = newIntrigueState();
    proposeIntrigues(env, state);
    expect(state.items.map((i) => [i.kind, i.dominionId])).toEqual([['newDialect', 1]]);
    expect(INTRIGUE_COST.newDialect).toBe(0);
    expect(d.strength).toBe(100);
  });

  it('a dominion with a dialect that meets the creed terms proposes a creed and pays 25 strength', () => {
    const applied: string[] = [];
    const { d, env } = world(100, { current: CREED_READY }, applied);
    const state = newIntrigueState();
    proposeIntrigues(env, state);
    expect(state.items.map((i) => i.kind)).toEqual(['newCreed']);
    expect(INTRIGUE_COST.newCreed).toBe(25);
    expect(d.strength).toBe(75);
  });

  it('a creed is not proposed without the strength to pay for it', () => {
    const { env } = world(10, { current: CREED_READY }, []);
    const state = newIntrigueState();
    proposeIntrigues(env, state);
    expect(state.items).toHaveLength(0);
  });

  it('a founding is not proposed when its gate fails', () => {
    const { env } = world(100, { current: { ...DIALECT_READY, speech: false } }, []);
    const state = newIntrigueState();
    proposeIntrigues(env, state);
    expect(state.items).toHaveLength(0);
  });

  it('the gate is checked again on resolution: a creed whose members fell below 50 is not applied', () => {
    const applied: string[] = [];
    const facts = { current: CREED_READY as FoundFacts | undefined };
    const { env } = world(100, facts, applied);
    const state = newIntrigueState();
    proposeIntrigues(env, state);
    facts.current = { ...CREED_READY, members: FOUND_CREED_MEMBERS - 1 };
    resolveIntrigues(env, state);
    expect(applied).toEqual([]);
    expect(state.items).toHaveLength(0);
  });

  it('a creed whose gate still holds on resolution is applied', () => {
    const applied: string[] = [];
    const { env } = world(100, { current: CREED_READY }, applied);
    const state = newIntrigueState();
    proposeIntrigues(env, state);
    resolveIntrigues(env, state);
    expect(applied).toEqual(['newCreed']);
  });
});

describe('founded creeds and dialects (11 section 2)', () => {
  it('a founded creed draws 1 or 2 tenets from the random pool only', () => {
    const state = createCultureState();
    const creed = foundCreed(state, 3, 500, createRng(1), false);
    expect(creed).not.toBeNull();
    expect(creed?.tenets?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(creed?.tenets?.length ?? 0).toBeLessThanOrEqual(2);
    for (const id of creed?.tenets ?? []) expect(CREED_TENET_BY_ID.get(id)?.randomSpawn, id).toBe(true);
  });

  it('a group holds one creed and one dialect: a second founding is refused', () => {
    const state = createCultureState();
    expect(foundCreed(state, 3, 500, createRng(1), false)).not.toBeNull();
    expect(foundCreed(state, 3, 600, createRng(2), false)).toBeNull();
    expect(foundDialect(state, 3, 500)).not.toBeNull();
    expect(foundDialect(state, 3, 600)).toBeNull();
  });

  it('a founded dialect starts with an empty lexicon and its group as creator', () => {
    const dialect = foundDialect(createCultureState(), 4, 700);
    expect(dialect).toMatchObject({ group: 4, word: 0, lexicon: [], creator: 4, born: 700 });
  });

  it('the creed pool never draws a locked, fireWard or insight tenet', () => {
    const rng = createRng(7);
    for (let k = 0; k < 500; k++) {
      const def = drawCreedTenet(rng);
      expect(def).toBeDefined();
      expect(def?.randomSpawn).toBe(true);
      expect(def?.rarity).not.toBe('locked');
    }
  });
});

describe('creed tenet table (11 section 9.4)', () => {
  it('has 45 tenets with unique ids', () => {
    expect(CREED_TENETS).toHaveLength(45);
    expect(new Set(CREED_TENETS.map((t) => t.id)).size).toBe(45);
    expect(CREED_TENET_BY_ID.size).toBe(45);
  });

  it('has 4 harmony, 5 transformation, 18 spell and 15 rite tenets, with one each of bloodSecrecy, fireWard and insight', () => {
    const count = (kind: string): number => CREED_TENETS.filter((t) => t.kind === kind).length;
    expect(count('harmony')).toBe(4);
    expect(count('transform')).toBe(5);
    expect(count('spell')).toBe(18);
    expect(count('rite')).toBe(15);
    expect(count('bloodSecrecy')).toBe(1);
    expect(count('fireWard')).toBe(1);
    expect(count('insight')).toBe(1);
  });

  it('the founding pool is 38 tenets: the 7 locked ones (fireWard, insight, five transformation) are not in it', () => {
    expect(CREED_TENETS.filter((t) => t.randomSpawn)).toHaveLength(38);
    expect(CREED_TENETS.filter((t) => !t.randomSpawn).map((t) => t.id).sort()).toEqual(['ash', 'desert', 'fireWard', 'infernal', 'insight', 'shadow', 'void']);
  });
});
