import { YEAR_TICKS } from '../../shared/constants.ts';
import type { Truce } from './founding.ts';
import { opinion, type OpinionContext } from './opinion.ts';
import type { Dominion, RelationMatrix } from './types.ts';

/** Ticks between pact formations: a three-year timeout (10 section 12). Spec value. */
export const PACT_TIMEOUT_TICKS = 3 * YEAR_TICKS;
/** A pact with fewer members than this dissolves (10 section 12). Spec value. */
export const PACT_MIN_MEMBERS = 2;
/** Renown a pact gains when one of its members defeats a dominion outside it (TUNE). */
export const PACT_RENOWN_PER_DEFEAT = 1;

/** A pact record (10 section 12). Members are dominion ids, ascending. */
export interface Pact {
  id: number;
  name: string;
  memberIds: number[];
  founders: [number, number];
  renown: number;
  formedTick: number;
  /** Every pact this build forms is 'normal'; 'forced' belongs to the god tool, which is not built. */
  kind: 'normal' | 'forced';
  /** Tick a member first held a negative opinion of a fellow member, or undefined while none does. Optional: older saves lack it. */
  unhappySince?: number;
}

/** The pact records of one realm. `lastFormedTick` is -1 before the first formation. */
export interface PactState {
  pacts: Pact[];
  nextId: number;
  lastFormedTick: number;
}

export function newPactState(): PactState {
  return { pacts: [], nextId: 1, lastFormedTick: -1 };
}

/** The pact a dominion belongs to, or undefined. */
export function pactOf(pacts: readonly Pact[], dominionId: number): Pact | undefined {
  return pacts.find((p) => p.memberIds.includes(dominionId));
}

/** True when a dominion has a tension or war with any other dominion (the spec's "no enemies"). */
export function hasEnemy(id: number, dominions: readonly Dominion[], relations: RelationMatrix): boolean {
  return dominions.some((d) => d.id !== id && relations.get(id, d.id) !== 'peace');
}

/** True when two member ids are at war, the pair found in member order, or null. */
export function warPair(ids: readonly number[], relations: RelationMatrix): boolean {
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (relations.get(ids[i] ?? -1, ids[j] ?? -1) === 'war') return true;
    }
  }
  return false;
}

/** Adds a pact record for two dominions. Does not touch the formation timeout (formPact does that). */
export function makePact(state: PactState, a: number, b: number, tick: number): Pact {
  const pact: Pact = {
    id: state.nextId,
    name: `Pact ${state.nextId}`,
    memberIds: [Math.min(a, b), Math.max(a, b)],
    founders: [a, b],
    renown: 0,
    formedTick: tick,
    kind: 'normal',
  };
  state.nextId++;
  state.pacts.push(pact);
  return pact;
}

/** Forms a pact between two dominions and starts the realm-wide formation timeout (intrigue formPact resolves to this). */
export function formPact(state: PactState, a: number, b: number, tick: number): Pact {
  const pact = makePact(state, a, b, tick);
  state.lastFormedTick = tick;
  return pact;
}

/** Adds a dominion to a pact, keeping the members ascending. A member already in the pact is left alone. */
export function joinPact(pact: Pact, dominionId: number): void {
  if (pact.memberIds.includes(dominionId)) return;
  pact.memberIds = [...pact.memberIds, dominionId].sort((x, y) => x - y);
}

/** Removes a pact record. Returns false when no pact has that id. */
export function dissolvePact(state: PactState, pactId: number): boolean {
  const before = state.pacts.length;
  state.pacts = state.pacts.filter((p) => p.id !== pactId);
  return state.pacts.length < before;
}

/** Adds renown to the pact a dominion belongs to, if any (campaign wins, see PACT_RENOWN_PER_DEFEAT). */
export function addPactRenown(state: PactState, dominionId: number, amount: number): void {
  const pact = pactOf(state.pacts, dominionId);
  if (pact) pact.renown += amount;
}

/** Strength of a pact: the sum of its members' strength (the spec's "power = sum of member power"). */
export function pactPower(pact: Pact, dominions: readonly Dominion[]): number {
  let sum = 0;
  for (const d of dominions) if (pact.memberIds.includes(d.id)) sum += d.strength;
  return sum;
}

/**
 * Yearly clean-up over pacts (10 section 12, rules mapped to dominion state; see DECISIONS.md), run after the
 * founding pass and before the intrigue pass (intrigue.ts forms, joins and dissolves by intrigue):
 * 1. Members that no longer exist leave. A pact with two members at war dissolves (whole pact).
 *    A pact with a member whose opinion of a fellow member stays below 0 for a year dissolves.
 *    A pact left with fewer than PACT_MIN_MEMBERS dissolves.
 * Draws no randomness. `truce` feeds the opinion terms; without it the truce and peace-time terms are 0.
 */
export function pactYear(
  state: PactState,
  dominions: readonly Dominion[],
  borders: readonly [number, number][],
  relations: RelationMatrix,
  tick: number,
  truce: ReadonlyMap<string, Truce> = new Map(),
): void {
  const byId = new Map(dominions.map((d) => [d.id, d]));
  const ctx = (): OpinionContext => ({ dominions, borders, relations, truce, pacts: state.pacts, tick });

  for (const p of state.pacts) p.memberIds = p.memberIds.filter((id) => byId.has(id));
  state.pacts = state.pacts.filter((p) => !warPair(p.memberIds, relations));

  for (const p of state.pacts) {
    let unhappy = false;
    for (const m of p.memberIds) {
      for (const o of p.memberIds) {
        if (m !== o && opinion(ctx(), m, o) < 0) unhappy = true;
      }
    }
    if (!unhappy) {
      delete p.unhappySince;
    } else {
      p.unhappySince ??= tick;
    }
  }
  state.pacts = state.pacts.filter((p) => p.memberIds.length >= PACT_MIN_MEMBERS && !(p.unhappySince !== undefined && tick - p.unhappySince >= YEAR_TICKS));
}
