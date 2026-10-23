/**
 * Maps the running Sim onto the culture slice's structural context. Groups are land regions
 * (`realm.region`, connected land components). Two regions are contacts when a tile of one lies
 * within `CONTACT_RADIUS` tiles of a tile of the other (across water, for example). Regions never
 * change after worldgen, so the contact list is derived once per sim and cached.
 */
import type { Sim } from '../sim.ts';
import type { Realm } from '../realm.ts';
import { ssToTicks } from '../clock.ts';
import { cultureStep, type Creed, createCultureState as newCulture, type CultureContext, type CultureState, type Dialect, type Intrigue } from './culture.ts';

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
  };
}

/**
 * Runs the culture step once per sim-second. With no creeds, dialects or intrigues there is nothing
 * for the step to advance, so it is skipped: no RNG stream is created and no contacts are scanned.
 */
export function cultureTick(sim: Sim): void {
  const c = sim.culture;
  if (c.creeds.length === 0 && c.dialects.length === 0 && c.intrigues.length === 0) return;
  if (!sim.due('culture', ssToTicks(1))) return;
  cultureStep(cultureContext(sim), sim.culture);
}

/** Empty culture state; Sim holds one from construction. */
export const createCultureState = newCulture;
export type { CultureState };

/** Plain JSON form of the culture state (Sets become arrays). */
export interface CulturePayload {
  customs: CultureState['customs'];
  creeds: { id: number; holders: number[] }[];
  dialects: Dialect[];
  intrigues: Intrigue[];
  families: CultureState['families'];
  nextId: number;
}

export function culturePayload(state: CultureState): CulturePayload {
  return {
    customs: state.customs,
    creeds: state.creeds.map((c) => ({ id: c.id, holders: [...c.holders] })),
    dialects: state.dialects,
    intrigues: state.intrigues,
    families: state.families,
    nextId: state.nextId,
  };
}

/** Rebuilds a culture state from its payload. Throws when the shape is wrong. */
export function cultureFromPayload(p: CulturePayload): CultureState {
  const arrays = [p.customs, p.creeds, p.dialects, p.intrigues, p.families];
  if (!arrays.every(Array.isArray) || typeof p.nextId !== 'number') throw new Error('culture: payload is malformed');
  const creeds: Creed[] = p.creeds.map((c) => ({ id: c.id, holders: new Set(c.holders) }));
  return { customs: p.customs, creeds, dialects: p.dialects, intrigues: p.intrigues, families: p.families, nextId: p.nextId };
}
