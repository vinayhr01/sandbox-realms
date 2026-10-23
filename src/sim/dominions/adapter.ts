import type { Sim } from '../sim.ts';
import { PARCEL } from '../settlements/hamlet.ts';
import { SS_TICKS } from '../clock.ts';
import { dominionStep } from './step.ts';
import { RelationMatrix, type Dominion, type DominionContext, type Relation } from './types.ts';

/**
 * Sim adapter for the dominions slice. The dominion state is kept beside the Sim (not on it) and
 * starts empty, so a sim with no dominions behaves exactly as before: no RNG stream is created and
 * no tick does any work beyond a lookup.
 *
 * Parcel ownership: one byte per parcel (parcel = py * (side / PARCEL) + px, as in hamlet.ts).
 * The byte is the owning dominion id, 0 = unowned. Dominion ids must be 1..255.
 */

export const UNOWNED = 0;

export interface DominionState {
  dominions: Dominion[];
  relations: RelationMatrix;
  /** Pairs of dominion ids sharing a border (symmetric). */
  borders: [number, number][];
  /** Owner byte per parcel: dominion id, or UNOWNED. Sized (side / PARCEL) squared. */
  owner: Uint8Array;
}

const states = new WeakMap<Sim, DominionState>();

/** Dominion state of a sim, created empty on first use. */
export function dominionState(sim: Sim): DominionState {
  let s = states.get(sim);
  if (!s) {
    const perAxis = sim.realm.side / PARCEL;
    s = { dominions: [], relations: new RelationMatrix(), borders: [], owner: new Uint8Array(perAxis * perAxis) };
    states.set(sim, s);
  }
  return s;
}

/** Number of parcels along one side of the realm. */
export function parcelsPerAxis(sim: Sim): number {
  return sim.realm.side / PARCEL;
}

/** Adds a dominion holding the given parcels (ownership is written to the owner map). */
export function addDominion(sim: Sim, id: number, strength: number, parcels: readonly number[] = []): Dominion {
  const s = dominionState(sim);
  if (!Number.isInteger(id) || id < 1 || id > 255) throw new RangeError(`dominion id out of range: ${id}`);
  if (s.dominions.some((d) => d.id === id)) throw new Error(`dominion ${id} already exists`);
  const d: Dominion = { id, parcels: new Set(), strength, target: -1, campaignSince: -1 };
  s.dominions.push(d);
  for (const p of parcels) claimParcel(sim, p, id);
  return d;
}

/** Gives a parcel to a dominion, taking it from whoever held it. */
export function claimParcel(sim: Sim, parcel: number, dominionId: number): void {
  const s = dominionState(sim);
  if (parcel < 0 || parcel >= s.owner.length) throw new RangeError(`parcel out of range: ${parcel}`);
  const d = s.dominions.find((x) => x.id === dominionId);
  if (!d) throw new Error(`no dominion ${dominionId}`);
  const prev = s.dominions.find((x) => x.id === s.owner[parcel]);
  prev?.parcels.delete(parcel);
  d.parcels.add(parcel);
  s.owner[parcel] = dominionId;
}

/** Declares a border between two dominions and sets their relation (peace by default). */
export function addBorder(sim: Sim, a: number, b: number, relation: Relation = 'peace'): void {
  const s = dominionState(sim);
  s.borders.push([a, b]);
  s.relations.set(a, b, relation);
}

/**
 * Runs the dominion step once per sim-second (on the tick the second starts). Parcel ownership
 * is read from the owner bytes, the step runs on the structural context, and changed parcels are
 * written back to the owner bytes.
 */
export function stepDominions(sim: Sim): void {
  const s = states.get(sim);
  if (!s || s.dominions.length === 0) return;
  if (sim.tick % SS_TICKS !== 0) return;
  const owner = new Map<number, number>();
  for (let p = 0; p < s.owner.length; p++) {
    const id = s.owner[p] ?? UNOWNED;
    if (id !== UNOWNED) owner.set(p, id);
  }
  const ctx: DominionContext = {
    rng: sim.rng('dominions'),
    tick: sim.tick,
    isOn: (id) => sim.rules.isOn(id),
    dominions: s.dominions,
    borders: s.borders,
    owner,
  };
  dominionStep(ctx, s.relations);
  for (const [p, id] of owner) s.owner[p] = id;
}
