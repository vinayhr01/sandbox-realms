/**
 * Maps the running Sim onto the culture slice's structural context. Groups are land regions
 * (`realm.region`, connected land components). Two regions are contacts when a tile of one lies
 * within `CONTACT_RADIUS` tiles of a tile of the other (across water, for example). Regions never
 * change after worldgen, so the contact list is derived once per sim and cached.
 */
import type { Sim } from '../sim.ts';
import type { Realm } from '../realm.ts';
import { ssToTicks } from '../clock.ts';
import { MAX_BEINGS } from '../beings/store.ts';
import { hamletsOf } from '../settlements/adapter.ts';
import { PARCEL } from '../settlements/hamlet.ts';
import {
  addCustom,
  catalogueTraits,
  cultureStep,
  pruneBeingState,
  recordFamily,
  startIntrigue,
  type Book,
  type Creed,
  createCultureState as newCulture,
  type CultureContext,
  type CultureState,
  type Dialect,
  type FamilyRecord,
  type Intrigue,
  type Study,
} from './culture.ts';

/** Chebyshev distance (tiles) within which two regions count as neighbours. */
export const CONTACT_RADIUS = 3;

const contactCache = new WeakMap<Sim, readonly (readonly [number, number])[]>();

/** Region pairs (lower id first) with tiles within CONTACT_RADIUS of each other, in scan order. */
export function regionContacts(realm: Realm): (readonly [number, number])[] {
  const side = realm.side;
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const a = realm.region[y * side + x] ?? 0;
      if (a === 0) continue;
      for (let dy = 0; dy <= CONTACT_RADIUS; dy++) {
        for (let dx = -CONTACT_RADIUS; dx <= CONTACT_RADIUS; dx++) {
          // Half plane: each unordered tile pair is visited once.
          if (dy === 0 && dx <= 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= side || ny >= side) continue;
          const b = realm.region[ny * side + nx] ?? 0;
          if (b === 0 || b === a) continue;
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          const key = `${lo},${hi}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push([lo, hi]);
        }
      }
    }
  }
  return out;
}

function contactsOf(sim: Sim): readonly (readonly [number, number])[] {
  let c = contactCache.get(sim);
  if (!c) {
    c = regionContacts(sim.realm);
    contactCache.set(sim, c);
  }
  return c;
}

/** Culture context for one step; RNG is the sim's named `culture` stream. */
export function cultureContext(sim: Sim): CultureContext {
  return {
    rng: sim.rng('culture'),
    tick: sim.tick,
    isOn: (id) => sim.rules.isOn(id),
    contacts: contactsOf(sim),
    worldSeed: sim.realm.seed,
    alive: (key) => beingAlive(sim, key),
  };
}

/** True when a Being key (generation * MAX_BEINGS + slot, as clans.ts writes it) names a living Being. */
function beingAlive(sim: Sim, key: number): boolean {
  const s = sim.beings.store;
  const slot = key % MAX_BEINGS;
  const gen = Math.floor(key / MAX_BEINGS);
  return slot < s.capacity && (s.alive[slot] ?? 0) !== 0 && (s.generation[slot] ?? 0) === gen;
}

/** Being key of a slot as it is now. */
function keyOf(sim: Sim, slot: number): number {
  return (sim.beings.store.generation[slot] ?? 0) * MAX_BEINGS + slot;
}

/**
 * Family scan (11 section 7), every 10 sim-seconds. A living Folk whose parent and the parent's mate are alive, and who is
 * not yet in a family, is recorded through recordFamily. Only Folk qualify: beasts have no families. Folk are not spawned
 * in the running sim (spawnFolk has no caller), so this scan finds nothing in play today. It draws no rng.
 */
function familiesScan(sim: Sim): void {
  if (!sim.due('families', ssToTicks(10))) return;
  const s = sim.beings.store;
  const linked = new Set(sim.culture.families.map((f) => f.child));
  const perAxis = sim.realm.side / PARCEL;
  const hamlets = hamletsOf(sim);
  let ctx: CultureContext | undefined;
  for (let k = 0; k < s.size; k++) {
    const child = s.at(k);
    const parent = s.parent[child] ?? -1;
    if (parent < 0 || !sim.beings.species(s.species[child] ?? 0).folk) continue;
    const childKey = keyOf(sim, child);
    if (linked.has(childKey)) continue;
    const parentKey = (s.parentGen[child] ?? 0) * MAX_BEINGS + parent;
    const mate = s.mate[parent] ?? -1;
    if (!beingAlive(sim, parentKey) || mate < 0 || !beingAlive(sim, (s.mateGen[parent] ?? 0) * MAX_BEINGS + mate)) continue;
    const parcel = Math.floor((s.y[parent] ?? 0) / PARCEL) * perAxis + Math.floor((s.x[parent] ?? 0) / PARCEL);
    const origin = hamlets.findIndex((h) => h.parcels.has(parcel));
    ctx ??= cultureContext(sim);
    recordFamily(ctx, sim.culture, childKey, parentKey, (s.mateGen[parent] ?? 0) * MAX_BEINGS + mate, origin);
    linked.add(childKey);
  }
}

/**
 * Yearly culture pass for the dominions (11 sections 2 and 3), called from the dominion yearly pass with the dominion ids
 * in order. Each dominion without a custom gets one (`addCustom`, group = dominion id). Each dominion with no intrigue
 * running gets a `scheme` (`startIntrigue`; off when `rituals` is off). Finished intrigues leave the list. Draws from the
 * culture stream only through addCustom and startIntrigue.
 */
export function cultureYearly(sim: Sim, dominionIds: readonly number[]): void {
  const state = sim.culture;
  state.intrigues = state.intrigues.filter((i) => i.outcome === null);
  const ctx = cultureContext(sim);
  for (const id of dominionIds) {
    if (!state.customs.some((c) => c.group === id)) addCustom(ctx, state, id);
    if (state.intrigues.some((i) => i.group === id && i.outcome === null)) continue;
    startIntrigue(ctx, state, id, 'scheme');
  }
}

/**
 * Runs the culture step once per sim-second. With no creeds, dialects or intrigues there is nothing
 * for the step to advance, so it is skipped: no RNG stream is created and no contacts are scanned.
 * The family scan runs first and is independent of that check.
 */
export function cultureTick(sim: Sim): void {
  familiesScan(sim);
  if (sim.due('beingState', ssToTicks(10))) pruneBeingState(cultureContext(sim), sim.culture);
  const c = sim.culture;
  if (c.creeds.length === 0 && c.dialects.length === 0 && c.intrigues.length === 0) return;
  if (!sim.due('culture', ssToTicks(1))) return;
  cultureStep(cultureContext(sim), sim.culture);
}

/** Empty culture state; Sim holds one from construction. */
export const createCultureState = newCulture;
export type { CultureState };

/** Plain JSON form of the culture state (Sets become arrays). */
/** A creed as saved: its holders are a list, and the optional split fields (tenets, creator, born) ride along when set. */
export type CreedSave = Omit<Creed, 'holders'> & { holders: number[] };

export interface CulturePayload {
  customs: CultureState['customs'];
  creeds: CreedSave[];
  dialects: Dialect[];
  intrigues: Intrigue[];
  families: CultureState['families'];
  /** Family records (11 section 7). Written only when present, so older saves and empty states keep their shape. */
  familyRecords?: FamilyRecord[];
  /** Study, defection and book records (11 section 9.1 and 5). Each written only when present. */
  studies?: Record<string, Study>;
  allegiance?: Record<string, number>;
  books?: Book[];
  nextId: number;
}

export function culturePayload(state: CultureState): CulturePayload {
  return {
    customs: state.customs,
    creeds: state.creeds.map((c) => ({ ...c, holders: [...c.holders] })),
    dialects: state.dialects,
    intrigues: state.intrigues,
    families: state.families,
    ...(state.familyRecords !== undefined ? { familyRecords: state.familyRecords } : {}),
    ...(state.studies !== undefined ? { studies: state.studies } : {}),
    ...(state.allegiance !== undefined ? { allegiance: state.allegiance } : {}),
    ...(state.books !== undefined ? { books: state.books } : {}),
    nextId: state.nextId,
  };
}

/** Rebuilds a culture state from its payload. Throws when the shape is wrong. */
export function cultureFromPayload(p: CulturePayload): CultureState {
  const arrays = [p.customs, p.creeds, p.dialects, p.intrigues, p.families];
  if (!arrays.every(Array.isArray) || typeof p.nextId !== 'number') throw new Error('culture: payload is malformed');
  const creeds: Creed[] = p.creeds.map((c) => ({ ...c, holders: new Set(c.holders) }));
  return {
    customs: p.customs.map((c) => ({ ...c, traits: catalogueTraits(c.traits) })),
    creeds,
    dialects: p.dialects,
    intrigues: p.intrigues,
    families: p.families,
    ...(p.familyRecords !== undefined ? { familyRecords: p.familyRecords } : {}),
    ...(p.studies !== undefined ? { studies: p.studies } : {}),
    ...(p.allegiance !== undefined ? { allegiance: p.allegiance } : {}),
    ...(p.books !== undefined ? { books: p.books } : {}),
    nextId: p.nextId,
  };
}
