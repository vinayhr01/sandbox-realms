import { PARCEL, YEAR_TICKS } from '../../shared/constants.ts';
import type { Rng } from '../../shared/rng.ts';
import type { BeingStore } from '../beings/store.ts';
import type { Hamlet } from '../settlements/hamlet.ts';
import type { SuccessionRule } from '../culture/trait-rules.ts';
import type { Dominion, UnitGuard } from './types.ts';

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
  /** Succession rule of a dominion's custom (culture/trait-rules.ts). Optional: without it the base order holds. */
  ruleOf?(dominionId: number): SuccessionRule | undefined;
  /** Called when a successor takes the crown; `capital` is the leading hamlet it was found in. Optional. */
  onInstall?(dominionId: number, slot: number, capital: Hamlet): void;
  /** Runs one dominion's check under the fault gate (17 section 9, Sim.unit). Optional: without it a throw propagates. */
  unit?: UnitGuard;
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

/** Ordering stat of a being for a succession rule (rapport, valor, or fame as the sum of the four aptitudes). */
function statOf(s: BeingStore, slot: number, stat: 'rapport' | 'valor' | 'fame'): number {
  const a = slot * 4;
  if (stat === 'rapport') return s.attrs[a] ?? 0;
  if (stat === 'valor') return s.attrs[a + 1] ?? 0;
  return (s.attrs[a] ?? 0) + (s.attrs[a + 1] ?? 0) + (s.attrs[a + 2] ?? 0) + (s.attrs[a + 3] ?? 0);
}

/**
 * Whether slot `a` ranks before slot `b` for the crown (10 section 4): the rule's stat first (higher first), then age
 * (oldest first, or youngest first under youngestFirst), then the lower slot.
 */
function ranksBefore(s: BeingStore, a: number, b: number, rule?: SuccessionRule): boolean {
  if (rule?.stat !== undefined) {
    const va = statOf(s, a, rule.stat);
    const vb = statOf(s, b, rule.stat);
    if (va !== vb) return va > vb;
  }
  const ba = s.born[a] ?? 0;
  const bb = s.born[b] ?? 0;
  if (ba !== bb) return rule?.youngest ? ba > bb : ba < bb;
  return a < b;
}

/**
 * Successor from a hamlet: a living adult folk Being standing in the hamlet's parcels that rules no other dominion
 * (`taken`). A sex preference (patriarchy, matriarchy) takes the preferred sex when any candidate has it. Then the order
 * of ranksBefore. Undefined when none qualifies.
 */
function successorIn(env: RulerEnv, hamlet: Hamlet, taken: ReadonlySet<number>, rule?: SuccessionRule): RulerRef | undefined {
  const s = env.beings.store;
  const pool: number[] = [];
  for (let k = 0; k < s.size; k++) {
    const slot = s.at(k);
    if (taken.has(slot) || !env.beings.species(s.species[slot] ?? 0).folk) continue;
    if ((env.tick - (s.born[slot] ?? 0)) / YEAR_TICKS < (s.adultA[slot] ?? 1)) continue;
    const p = Math.floor((s.y[slot] ?? 0) / PARCEL) * env.perAxis + Math.floor((s.x[slot] ?? 0) / PARCEL);
    if (!hamlet.parcels.has(p)) continue;
    pool.push(slot);
  }
  if (pool.length === 0) return undefined;
  let cands = pool;
  if (rule?.sex !== undefined) {
    const sex = rule.sex;
    const preferred = pool.filter((sl) => (s.female[sl] ?? 0) === sex);
    if (preferred.length > 0) cands = preferred;
  }
  let best = cands[0] ?? -1;
  for (const sl of cands) if (ranksBefore(s, sl, best, rule)) best = sl;
  if (best < 0) return undefined;
  return { slot: best, gen: s.generation[best] ?? 0 };
}

/**
 * One ruler step per sim-second (10 section 4, checkRuler). A dominion with a living ruler is left alone. A ruler found
 * dead is cleared and a wait of randomInt(100, 400) ticks starts. Once the wait is over, a dominion with no ruler takes
 * the first folk its succession rule ranks (default: the oldest adult of its leading hamlet). Under unbrokenLine, when the
 * leading hamlet has none, the dominion's other hamlets are searched in order. Dominions are visited in array order.
 */
export function rulersStep(env: RulerEnv, dominions: readonly Dominion[]): void {
  const s = env.beings.store;
  const taken = new Set<number>();
  for (const d of dominions) {
    const r = rulerLive(s, d);
    if (r) taken.add(r.slot);
  }
  // Each dominion is one unit (17 section 9): a throw in one is counted as `dominion:<id>` and the others still check.
  for (const d of dominions) {
    if (env.unit) env.unit(d.id, () => checkRuler(env, d, taken));
    else checkRuler(env, d, taken);
  }
}

/** The ruler check of one dominion (rulersStep). Called once per dominion, in array order. */
function checkRuler(env: RulerEnv, d: Dominion, taken: Set<number>): void {
  const s = env.beings.store;
  if (rulerLive(s, d)) return;
  if (d.ruler) {
    delete d.ruler;
    d.rulerWaitUntil = env.tick + RULER_WAIT_MIN + env.rng().int(RULER_WAIT_SPAN);
    return;
  }
  if (env.tick < (d.rulerWaitUntil ?? 0)) return;
  const hamlet = leadingHamlet(d.id, env.hamlets, env.owner);
  if (!hamlet) return;
  const rule = env.ruleOf?.(d.id);
  let next = successorIn(env, hamlet, taken, rule);
  if (!next && rule?.unbroken) {
    for (const h of env.hamlets) {
      if (h === hamlet || hamletOwner(h, env.owner) !== d.id) continue;
      next = successorIn(env, h, taken, rule);
      if (next) break;
    }
  }
  if (!next) return;
  d.ruler = next;
  d.rulerSinceTick = env.tick;
  taken.add(next.slot);
  delete d.rulerWaitUntil;
  env.onInstall?.(d.id, next.slot, hamlet);
}
