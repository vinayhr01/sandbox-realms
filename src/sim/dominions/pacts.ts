import { YEAR_TICKS } from '../../shared/constants.ts';
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

/** The dominion with the most strength (ties go to the lower id): the spec's supreme dominion. */
function supremeId(dominions: readonly Dominion[]): number {
  let best: Dominion | undefined;
  for (const d of dominions) {
    if (!best || d.strength > best.strength || (d.strength === best.strength && d.id < best.id)) best = d;
  }
  return best?.id ?? -1;
}

/** True when a dominion has a tension or war with any other dominion (the spec's "no enemies"). */
function hasEnemy(id: number, dominions: readonly Dominion[], relations: RelationMatrix): boolean {
  return dominions.some((d) => d.id !== id && relations.get(id, d.id) !== 'peace');
}

/** The stronger of two dominions (ties go to the lower id), the side that declared a war in the yearly pass. */
function stronger(a: Dominion, b: Dominion): number {
  if (a.strength !== b.strength) return a.strength > b.strength ? a.id : b.id;
  return Math.min(a.id, b.id);
}

/** A member pair at war, or null. */
function warPair(ids: readonly number[], relations: RelationMatrix): [number, number] | null {
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i] ?? -1;
      const b = ids[j] ?? -1;
      if (relations.get(a, b) === 'war') return [a, b];
    }
  }
  return null;
}

/** Adds a pact record for two dominions. Does not touch the formation timeout (formation does that). */
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
 * Yearly pass over pacts (10 section 12), run after the founding pass:
 * 1. Members that no longer exist leave. Two members at war: the stronger one (the declarer) leaves.
 *    A pact left with fewer than PACT_MIN_MEMBERS dissolves.
 * 2. Formation: when the timeout has passed, the first peace border pair (in border order) whose
 *    dominions are both free of pacts, neither supreme, and neither with any enemy, forms a pact.
 * 3. Joining: a free dominion with no enemy, not supreme, that borders a member joins the first pact
 *    (by id) with no supreme member.
 * Draws no randomness.
 */
export function pactYear(
  state: PactState,
  dominions: readonly Dominion[],
  borders: readonly [number, number][],
  relations: RelationMatrix,
  tick: number,
): void {
  const byId = new Map(dominions.map((d) => [d.id, d]));
  for (const p of state.pacts) {
    p.memberIds = p.memberIds.filter((id) => byId.has(id));
    for (let pair = warPair(p.memberIds, relations); pair; pair = warPair(p.memberIds, relations)) {
      const leaver = stronger(byId.get(pair[0]) as Dominion, byId.get(pair[1]) as Dominion);
      p.memberIds = p.memberIds.filter((id) => id !== leaver);
    }
  }
  state.pacts = state.pacts.filter((p) => p.memberIds.length >= PACT_MIN_MEMBERS);

  const sup = supremeId(dominions);
  if (state.lastFormedTick < 0 || tick - state.lastFormedTick >= PACT_TIMEOUT_TICKS) {
    for (const [a, b] of borders) {
      if (!byId.has(a) || !byId.has(b) || relations.get(a, b) !== 'peace') continue;
      if (pactOf(state.pacts, a) || pactOf(state.pacts, b) || a === sup || b === sup) continue;
      if (hasEnemy(a, dominions, relations) || hasEnemy(b, dominions, relations)) continue;
      makePact(state, a, b, tick);
      state.lastFormedTick = tick;
      break;
    }
  }

  for (const d of dominions) {
    if (d.id === sup || pactOf(state.pacts, d.id) || hasEnemy(d.id, dominions, relations)) continue;
    for (const p of state.pacts) {
      if (p.memberIds.includes(sup)) continue;
      const bordersMember = borders.some(([x, y]) => (x === d.id && p.memberIds.includes(y)) || (y === d.id && p.memberIds.includes(x)));
      if (!bordersMember) continue;
      p.memberIds = [...p.memberIds, d.id].sort((x, y) => x - y);
      break;
    }
  }
}
