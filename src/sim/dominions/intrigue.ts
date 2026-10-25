import { YEAR_TICKS } from '../../shared/constants.ts';
import type { Truce } from './founding.ts';
import { goodOpinionOfAll, opinion, powerOf, supremeOf, type OpinionContext } from './opinion.ts';
import { dissolvePact, formPact, hasEnemy, joinPact, pactOf, pactPower, PACT_TIMEOUT_TICKS, warPair, type Pact, type PactState } from './pacts.ts';
import type { Dominion, RelationMatrix } from './types.ts';
import { splitAllowed, type SplitFacts } from '../culture/trait-rules.ts';

/**
 * Intrigue records (10 sections 11-12, 11 section 3 catalogue). Rulers and the intrigue engine do not exist here, so an
 * intrigue is a record on the dominion: proposed in the yearly pass when the dominion's state meets the gates, and
 * resolved in the next yearly pass. The pact intrigues resolve through the pact functions in pacts.ts. The three split
 * intrigues (divideCustom, schismCreed, divergeDialect; 11 section 2) resolve through the culture hooks in `split`.
 * See DECISIONS.md "Pacts and armies round 5" and "Dominions close 5" for each substitution.
 */

export type IntrigueKind = 'formPact' | 'joinPact' | 'dissolvePact' | 'divideCustom' | 'schismCreed' | 'divergeDialect';

/** The split intrigues (11 section 2): a custom divides, a creed schisms, a dialect diverges. */
export type SplitKind = 'divideCustom' | 'schismCreed' | 'divergeDialect';
export const SPLIT_KINDS: readonly SplitKind[] = ['divideCustom', 'schismCreed', 'divergeDialect'];

/** Strength a dominion needs to propose formPact, or to be the target of one (TUNE; stands in for renown 60). */
export const FORM_PACT_STRENGTH = 60;
/** Strength a dominion needs to propose joinPact (TUNE; stands in for renown 50). */
export const JOIN_PACT_STRENGTH = 50;
/**
 * Strength paid when an intrigue is proposed (TUNE; the spec's money costs: formPact 20, joinPact 5, dissolvePact 15,
 * divideCustom 20, schismCreed 15, divergeDialect 15; strength is the only pool a dominion has).
 */
export const INTRIGUE_COST: Readonly<Record<IntrigueKind, number>> = {
  formPact: 20,
  joinPact: 5,
  dissolvePact: 15,
  divideCustom: 20,
  schismCreed: 15,
  divergeDialect: 15,
};
/** Every intrigue kind, for the save check (adapter.ts restoreDominions). */
export const INTRIGUE_KINDS: readonly IntrigueKind[] = Object.keys(INTRIGUE_COST) as IntrigueKind[];
/** Ticks a dominion waits after proposing formPact before it proposes it again (the spec's 3-year cooldown, TUNE). */
export const FORM_PACT_COOLDOWN_TICKS = 3 * YEAR_TICKS;
/** Age a pact must reach before a joined member may dissolve it (the spec's 10 years, TUNE). */
export const DISSOLVE_PACT_AGE_TICKS = 10 * YEAR_TICKS;
/** Pact power must be at least this multiple of the power of all dominions outside it (the spec's 2x, TUNE). */
export const DISSOLVE_POWER_RATIO = 2;

/** One intrigue. `targetId` is the asked dominion for formPact, and the pact id for joinPact and dissolvePact. */
export interface Intrigue {
  id: number;
  kind: IntrigueKind;
  dominionId: number;
  targetId: number;
  startedTick: number;
}

/** The intrigue records of one realm, with the formPact cooldowns per proposing dominion. */
export interface IntrigueState {
  items: Intrigue[];
  nextId: number;
  cooldowns: { dominionId: number; until: number }[];
}

export function newIntrigueState(): IntrigueState {
  return { items: [], nextId: 1, cooldowns: [] };
}

/**
 * Culture hooks of the split intrigues (adapter.ts builds them from the culture state). `facts` gives the facts the
 * precondition test reads for the meta a dominion holds, or undefined when it holds no such meta. `apply` performs the
 * split and returns false when it is refused.
 */
export interface SplitHooks {
  facts(kind: SplitKind, dominionId: number): SplitFacts | undefined;
  apply(kind: SplitKind, dominionId: number): boolean;
}

/** What the gates read: the dominions, borders, relations, truces and pacts, and the tick. */
export interface IntrigueEnv {
  dominions: readonly Dominion[];
  borders: readonly [number, number][];
  relations: RelationMatrix;
  truce: ReadonlyMap<string, Truce>;
  pacts: PactState;
  tick: number;
  /** Ruler stats per dominion (rulers.ts). Optional: without it the opinion ruler stand-in holds. */
  rulerOf?: OpinionContext['rulerOf'];
  /** Custom and strain lens for the opinion terms (opinion.ts). Optional. */
  lens?: OpinionContext['lens'];
  /** Hamlets per dominion for the power formula (opinion.ts powerOf). Optional: absent counts as 0. */
  hamlets?: OpinionContext['hamlets'];
  /** Culture hooks for the split intrigues (11 section 2). Optional: without them no split is proposed. */
  split?: SplitHooks;
}

function opinionOf(env: IntrigueEnv): OpinionContext {
  return { dominions: env.dominions, borders: env.borders, relations: env.relations, truce: env.truce, pacts: env.pacts.pacts, tick: env.tick, rulerOf: env.rulerOf, lens: env.lens, hamlets: env.hamlets };
}

function dom(env: IntrigueEnv, id: number): Dominion | undefined {
  return env.dominions.find((d) => d.id === id);
}

function bordered(env: IntrigueEnv, a: number, b: number): boolean {
  return env.borders.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

/** Free: in no pact and with no tension or war (the spec's "not allied, no enemies"). */
function free(env: IntrigueEnv, id: number): boolean {
  return !pactOf(env.pacts.pacts, id) && !hasEnemy(id, env.dominions, env.relations);
}

/** True when a dominion has an intrigue running: one it proposed, or a formPact aimed at it. */
function active(state: IntrigueState, id: number): boolean {
  return state.items.some((i) => i.dominionId === id || (i.kind === 'formPact' && i.targetId === id));
}

function cooling(state: IntrigueState, id: number, tick: number): boolean {
  return state.cooldowns.some((c) => c.dominionId === id && c.until > tick);
}

/**
 * Gate for a formPact between two bordering dominions (10 section 12): both free, neither supreme, both at least
 * FORM_PACT_STRENGTH, a peace border, the realm-wide formation timeout passed, and a good opinion both ways.
 * Used when proposing and again when resolving.
 */
export function formPactOk(env: IntrigueEnv, a: number, b: number): boolean {
  if (a === b || !dom(env, a) || !dom(env, b)) return false;
  if (!bordered(env, a, b) || env.relations.get(a, b) !== 'peace') return false;
  if (env.pacts.lastFormedTick >= 0 && env.tick - env.pacts.lastFormedTick < PACT_TIMEOUT_TICKS) return false;
  const sup = supremeOf(env.dominions, env.hamlets);
  if (a === sup || b === sup) return false;
  if ((dom(env, a)?.strength ?? 0) < FORM_PACT_STRENGTH || (dom(env, b)?.strength ?? 0) < FORM_PACT_STRENGTH) return false;
  if (!free(env, a) || !free(env, b)) return false;
  const oc = opinionOf(env);
  return opinion(oc, a, b) >= 0 && opinion(oc, b, a) >= 0;
}

/** Gate for a joinPact: a free dominion, not supreme, that borders a member of a war-free pact with no supreme member and holds a good opinion of all its members (10 section 12). */
export function joinPactOk(env: IntrigueEnv, d: number, pactId: number): boolean {
  const p = env.pacts.pacts.find((x) => x.id === pactId);
  if (!p || !dom(env, d)) return false;
  if ((dom(env, d)?.strength ?? 0) < JOIN_PACT_STRENGTH) return false;
  const sup = supremeOf(env.dominions, env.hamlets);
  if (d === sup || p.memberIds.includes(sup)) return false;
  if (!free(env, d) || warPair(p.memberIds, env.relations)) return false;
  if (!p.memberIds.some((m) => bordered(env, d, m))) return false;
  return goodOpinionOfAll(opinionOf(env), d, p.memberIds);
}

/**
 * Gate for a dissolvePact by a joined member (10 section 12): the dominion is in the pact without being a founder,
 * is free, the pact is at least DISSOLVE_PACT_AGE_TICKS old, the dominion is supreme or second, the pact holds the
 * supreme dominion, and its power is at least DISSOLVE_POWER_RATIO times the power of the dominions outside it.
 */
export function dissolvePactOk(env: IntrigueEnv, d: number, pactId: number): boolean {
  const p = env.pacts.pacts.find((x) => x.id === pactId);
  if (!p || !dom(env, d)) return false;
  // A forced pact (god tool, forcePact) is immune to this intrigue (10 section 12).
  if (p.kind === 'forced') return false;
  if (!p.memberIds.includes(d) || p.founders.includes(d)) return false;
  if (!free(env, d)) return false;
  if (env.tick - p.formedTick < DISSOLVE_PACT_AGE_TICKS) return false;
  const ranked = [...env.dominions].sort((x, y) => powerOf(y, env.hamlets) - powerOf(x, env.hamlets) || x.id - y.id).map((x) => x.id);
  if (!ranked.slice(0, 2).includes(d)) return false;
  if (!p.memberIds.includes(supremeOf(env.dominions, env.hamlets))) return false;
  const outside = env.dominions.filter((x) => !p.memberIds.includes(x.id));
  if (outside.length === 0) return false;
  const outsidePower = outside.reduce((sum, x) => sum + powerOf(x, env.hamlets), 0);
  return pactPower(p, env.dominions, env.hamlets) >= DISSOLVE_POWER_RATIO * outsidePower;
}

/**
 * Gate for a split intrigue by dominion `d` (11 section 2): the culture hooks give the facts of the meta it holds, and
 * splitAllowed (trait-rules.ts) tests the common preconditions, keepers included. Used when proposing and again when
 * resolving. Draws no randomness.
 */
export function splitOk(env: IntrigueEnv, kind: SplitKind, d: number): boolean {
  if (!dom(env, d) || !env.split) return false;
  const facts = env.split.facts(kind, d);
  return facts !== undefined && splitAllowed(facts);
}

/** The dominion a formPact by `a` would ask (the lowest-id free neighbour with no intrigue running), or -1. */
function formPactTarget(env: IntrigueEnv, state: IntrigueState, a: number): number {
  if (active(state, a) || cooling(state, a, env.tick)) return -1;
  let best = -1;
  for (const [x, y] of env.borders) {
    const b = x === a ? y : y === a ? x : -1;
    if (b < 0 || active(state, b)) continue;
    if (formPactOk(env, a, b) && (best < 0 || b < best)) best = b;
  }
  return best;
}

/** The lowest-id pact a dominion may join, or -1. */
function joinPactTarget(env: IntrigueEnv, state: IntrigueState, d: number): number {
  if (active(state, d)) return -1;
  for (const p of [...env.pacts.pacts].sort((x, y) => x.id - y.id)) {
    if (joinPactOk(env, d, p.id)) return p.id;
  }
  return -1;
}

/**
 * Yearly proposals (10 sections 11-12). Dominions are visited in id order; one proposal each per pass. A dominion in a
 * pact may propose dissolvePact (its own pact); a free one may propose joinPact, else formPact. The cost in strength
 * is paid at once and the intrigue is resolved in the next yearly pass. Draws no randomness.
 */
export function proposeIntrigues(env: IntrigueEnv, state: IntrigueState): void {
  state.cooldowns = state.cooldowns.filter((c) => c.until > env.tick);
  for (const d of [...env.dominions].sort((x, y) => x.id - y.id)) {
    if (active(state, d.id)) continue;
    let pick: { kind: IntrigueKind; targetId: number } | undefined;
    const pact: Pact | undefined = pactOf(env.pacts.pacts, d.id);
    if (pact) {
      if (dissolvePactOk(env, d.id, pact.id)) pick = { kind: 'dissolvePact', targetId: pact.id };
    } else {
      const joinId = joinPactTarget(env, state, d.id);
      if (joinId >= 0) pick = { kind: 'joinPact', targetId: joinId };
      else {
        const formId = formPactTarget(env, state, d.id);
        if (formId >= 0) pick = { kind: 'formPact', targetId: formId };
      }
    }
    // A split (11 section 2) is tried when no pact intrigue was picked. It targets the dominion's own meta, so the
    // target is the dominion itself.
    if (!pick) {
      for (const kind of SPLIT_KINDS) {
        if (splitOk(env, kind, d.id)) {
          pick = { kind, targetId: d.id };
          break;
        }
      }
    }
    if (!pick) continue;
    const cost = INTRIGUE_COST[pick.kind];
    if (d.strength < cost) continue;
    d.strength -= cost;
    state.items.push({ id: state.nextId, kind: pick.kind, dominionId: d.id, targetId: pick.targetId, startedTick: env.tick });
    state.nextId++;
    if (pick.kind === 'formPact') {
      state.cooldowns = state.cooldowns.filter((c) => c.dominionId !== d.id);
      state.cooldowns.push({ dominionId: d.id, until: env.tick + FORM_PACT_COOLDOWN_TICKS });
    }
  }
}

/**
 * Yearly resolution (in id order): each intrigue is checked against its gate again and, when it still holds, applied
 * through the pact functions (formPact, joinPact, dissolvePact in pacts.ts) or the culture hooks (the split intrigues,
 * `env.split.apply`). Every intrigue is removed after this pass, whether it held or not. An intrigue whose proposer is
 * gone is dropped. Draws no randomness.
 */
export function resolveIntrigues(env: IntrigueEnv, state: IntrigueState): void {
  const items = [...state.items].sort((x, y) => x.id - y.id);
  state.items = [];
  for (const i of items) {
    if (!dom(env, i.dominionId)) continue;
    if (i.kind === 'formPact') {
      if (formPactOk(env, i.dominionId, i.targetId)) formPact(env.pacts, i.dominionId, i.targetId, env.tick);
    } else if (i.kind === 'joinPact') {
      const p = env.pacts.pacts.find((x) => x.id === i.targetId);
      if (p && joinPactOk(env, i.dominionId, p.id)) joinPact(p, i.dominionId);
    } else if (i.kind === 'dissolvePact') {
      if (dissolvePactOk(env, i.dominionId, i.targetId)) dissolvePact(env.pacts, i.targetId);
    } else if (splitOk(env, i.kind, i.dominionId)) {
      env.split?.apply(i.kind, i.dominionId);
    }
  }
}
