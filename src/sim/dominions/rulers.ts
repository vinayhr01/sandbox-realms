import { PARCEL, YEAR_TICKS } from '../../shared/constants.ts';
import type { Rng } from '../../shared/rng.ts';
import type { BeingStore } from '../beings/store.ts';
import type { Hamlet } from '../settlements/hamlet.ts';
import type { Dominion } from './types.ts';

/**
 * Rulers (10 section 4, reduced; see DECISIONS.md, Rulers release). A ruler is a living folk Being that stands in the
 * dominion's leading hamlet (the capital: most buildings, then most folk, then the lowest parcel). It is held as a
 * (slot, generation) pair, so a dead ruler is seen as stale without any hook in killBeing. Draws its wait from the
 * 'rulers' stream only when a ruler dies, and picks successors by age with no randomness.
 */

/** Wait after a ruler dies before a successor is sought: randomInt(100, 400) ticks (10 section 4, TUNE). */
export const RULER_WAIT_MIN = 100;
export const RULER_WAIT_SPAN = 301;

/** Stored ruler: the being's slot and its generation at the time it took the crown. */
export interface RulerRef {
  slot: number;
  gen: number;
}

/** The ruler stats the opinion terms read (opinion.ts): rapport (diplomacy) and mood. */
export interface RulerStats {
  diplomacy: number;
  mood: number;
}

/** The beings the ruler step reads: the store and the species lookup (folk flag). Structural, so no Sim import. */
export interface RulerBeings {
  readonly store: BeingStore;
  species(index: number): { readonly folk: boolean };
}

/** What one ruler step reads. `rng` is lazy: the stream is created only when a ruler dies. */
export interface RulerEnv {
  tick: number;
  perAxis: number;
  beings: RulerBeings;
  hamlets: readonly Hamlet[];
  /** Owner byte per parcel (dominion id, 0 = unowned). */
  owner: Uint8Array;
  rng(): Rng;
}

/** Index of rapport in the being store's four aptitudes (rapport, valor, husbandry, wit). */
const RAPPORT = 0;

/** The dominion's ruler ref when it still names a living Being, else undefined. */
export function rulerLive(store: BeingStore, d: Dominion): RulerRef | undefined {
  const r = d.ruler;
  return r && store.isCurrent(r.slot, r.gen) ? r : undefined;
}

/** The living ruler's stats, or undefined when the dominion has no living ruler. Draws no randomness. */
export function rulerStatsOf(store: BeingStore, d: Dominion): RulerStats | undefined {
  const r = rulerLive(store, d);
  if (!r) return undefined;
  return { diplomacy: store.attrs[r.slot * 4 + RAPPORT] ?? 0, mood: store.mood[r.slot] ?? 0 };
}

/** The dominion holding most of a hamlet's parcels (ties to the lower id), or 0 when none. Same rule as the yearly pass. */
function hamletOwner(h: Hamlet, owner: Uint8Array): number {
  const counts = new Map<number, number>();
  for (const p of h.parcels) {
    const o = owner[p] ?? 0;
    if (o !== 0) counts.set(o, (counts.get(o) ?? 0) + 1);
  }
  let best = 0;
  let bestN = 0;
  for (const [id, n] of counts) {
    if (n > bestN || (n === bestN && id < best)) {
      best = id;
      bestN = n;
    }
  }
  return best;
}

/** A dominion's leading hamlet: most buildings, then most folk, then the lowest parcel; undefined when it has none. */
export function leadingHamlet(dominionId: number, hamlets: readonly Hamlet[], owner: Uint8Array): Hamlet | undefined {
  let best: Hamlet | undefined;
  let bestAnchor = Infinity;
  for (const h of hamlets) {
    if (hamletOwner(h, owner) !== dominionId) continue;
    let anchor = Infinity;
    for (const p of h.parcels) anchor = Math.min(anchor, p);
    const nb = h.buildings.length;
    if (!best || nb > best.buildings.length || (nb === best.buildings.length && (h.folk > best.folk || (h.folk === best.folk && anchor < bestAnchor)))) {
      best = h;
      bestAnchor = anchor;
    }
  }
  return best;
}

/**
 * Successor from a hamlet: the oldest living adult folk Being standing in the hamlet's parcels that rules no other
 * dominion (`taken`). Ties go to the lower slot. Undefined when none qualifies.
 */
function successorIn(env: RulerEnv, hamlet: Hamlet, taken: ReadonlySet<number>): RulerRef | undefined {
  const s = env.beings.store;
  let best = -1;
  for (let k = 0; k < s.size; k++) {
    const slot = s.at(k);
    if (taken.has(slot) || !env.beings.species(s.species[slot] ?? 0).folk) continue;
    if ((env.tick - (s.born[slot] ?? 0)) / YEAR_TICKS < (s.adultA[slot] ?? 1)) continue;
    const p = Math.floor((s.y[slot] ?? 0) / PARCEL) * env.perAxis + Math.floor((s.x[slot] ?? 0) / PARCEL);
    if (!hamlet.parcels.has(p)) continue;
    if (best < 0 || (s.born[slot] ?? 0) < (s.born[best] ?? 0) || ((s.born[slot] ?? 0) === (s.born[best] ?? 0) && slot < best)) best = slot;
  }
  return best < 0 ? undefined : { slot: best, gen: s.generation[best] ?? 0 };
}

/**
 * One ruler step per sim-second (10 section 4, checkRuler). A dominion with a living ruler is left alone. A ruler found
 * dead is cleared and a wait of randomInt(100, 400) ticks starts. Once the wait is over, a dominion with no ruler takes
 * the oldest adult folk of its leading hamlet, if there is one. Dominions are visited in array order.
 */
export function rulersStep(env: RulerEnv, dominions: readonly Dominion[]): void {
  const s = env.beings.store;
  const taken = new Set<number>();
  for (const d of dominions) {
    const r = rulerLive(s, d);
    if (r) taken.add(r.slot);
  }
  for (const d of dominions) {
    if (rulerLive(s, d)) continue;
    if (d.ruler) {
      delete d.ruler;
      d.rulerWaitUntil = env.tick + RULER_WAIT_MIN + env.rng().int(RULER_WAIT_SPAN);
      continue;
    }
    if (env.tick < (d.rulerWaitUntil ?? 0)) continue;
    const hamlet = leadingHamlet(d.id, env.hamlets, env.owner);
    if (!hamlet) continue;
    const next = successorIn(env, hamlet, taken);
    if (!next) continue;
    d.ruler = next;
    taken.add(next.slot);
    delete d.rulerWaitUntil;
  }
}
