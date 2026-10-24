import type { Sim } from '../sim.ts';
import { PARCEL } from '../settlements/hamlet.ts';
import { hamletsOf } from '../settlements/adapter.ts';
import { SS_TICKS } from '../clock.ts';
import { YEAR_TICKS } from '../../shared/constants.ts';
import { dominionStep } from './step.ts';
import { ground } from '../../content/grounds.ts';
import { FOUND_FOLK, foundingYear, type FoundingEnv, type Truce } from './founding.ts';
import { pairKey, RelationMatrix, type Dominion, type DominionContext, type Relation } from './types.ts';

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
  /** Truces by pair key (founding.ts): no new declaration until `until`. */
  truce: Map<string, Truce>;
}

const states = new WeakMap<Sim, DominionState>();

/** Dominion state of a sim, created empty on first use. */
export function dominionState(sim: Sim): DominionState {
  let s = states.get(sim);
  if (!s) {
    const perAxis = sim.realm.side / PARCEL;
    s = { dominions: [], relations: new RelationMatrix(), borders: [], owner: new Uint8Array(perAxis * perAxis), truce: new Map() };
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

/** Plain-data form of the dominion state, JSON-safe (Chronicle section 15). */
export interface DominionSnapshot {
  dominions: { id: number; parcels: number[]; strength: number; target: number; campaignSince: number }[];
  /** Pairs whose relation is not the default peace: [a, b, relation]. */
  relations: [number, number, Relation][];
  borders: [number, number][];
  /** Owner byte per parcel. */
  owner: number[];
  /** Truces (founding.ts). Optional: saves written before the yearly pass have none. */
  truce?: { a: number; b: number; until: number; declared: boolean }[];
}

/** Plain copy of a sim's dominion state, or null when the state was never created. */
export function snapshotDominions(sim: Sim): DominionSnapshot | null {
  const s = states.get(sim);
  if (!s) return null;
  // Relations live in a keyed map, so every pair that can carry one is listed: all dominion pairs and all borders.
  const pairs = new Map<string, [number, number]>();
  const addPair = (a: number, b: number): void => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    pairs.set(`${lo}:${hi}`, [lo, hi]);
  };
  s.dominions.forEach((a, i) => s.dominions.slice(i + 1).forEach((b) => addPair(a.id, b.id)));
  for (const [a, b] of s.borders) addPair(a, b);
  const relations: [number, number, Relation][] = [];
  for (const [a, b] of pairs.values()) {
    const r = s.relations.get(a, b);
    if (r !== 'peace') relations.push([a, b, r]);
  }
  return {
    dominions: s.dominions.map((d) => ({ id: d.id, parcels: [...d.parcels], strength: d.strength, target: d.target, campaignSince: d.campaignSince })),
    relations,
    borders: s.borders.map(([a, b]) => [a, b]),
    owner: [...s.owner],
    truce: [...s.truce.values()].map((t) => ({ a: t.a, b: t.b, until: t.until, declared: t.declared })),
  };
}

/** Replaces the sim's dominion state with a snapshot (Chronicle load). Checks shape and ranges first. */
export function restoreDominions(sim: Sim, snap: DominionSnapshot): void {
  const bad = (what: string): never => {
    throw new Error(`dominion state: ${what} is not valid`);
  };
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const perAxis = parcelsPerAxis(sim);
  const parcelCount = perAxis * perAxis;
  if (!Array.isArray(snap.owner) || snap.owner.length !== parcelCount || !snap.owner.every((v) => isNum(v) && v >= 0 && v <= 255)) bad('owner map');
  if (!Array.isArray(snap.dominions) || !Array.isArray(snap.relations) || !Array.isArray(snap.borders)) bad('record');
  const dominions: Dominion[] = [];
  // Each parcel is held by at most one dominion, and the owner byte of a parcel names that dominion.
  const claimed = new Map<number, number>();
  for (const d of snap.dominions) {
    if (!isNum(d.id) || !Number.isInteger(d.id) || d.id < 1 || d.id > 255 || dominions.some((x) => x.id === d.id)) bad(`dominion id ${d.id}`);
    if (!isNum(d.strength) || !isNum(d.target) || !isNum(d.campaignSince) || !Array.isArray(d.parcels)) bad(`dominion ${d.id}`);
    for (const p of d.parcels) {
      if (!isNum(p) || !Number.isInteger(p) || p < 0 || p >= parcelCount) bad(`dominion ${d.id} parcels`);
      if (claimed.has(p) || snap.owner[p] !== d.id) bad(`dominion ${d.id} parcel ${p} ownership`);
      claimed.set(p, d.id);
    }
    dominions.push({ id: d.id, parcels: new Set(d.parcels), strength: d.strength, target: d.target, campaignSince: d.campaignSince });
  }
  snap.owner.forEach((id, p) => {
    if (id !== UNOWNED && claimed.get(p) !== id) bad(`owner of parcel ${p}`);
  });
  const relations = new RelationMatrix();
  for (const [a, b, r] of snap.relations) {
    if (!isNum(a) || !isNum(b) || !(r === 'peace' || r === 'tension' || r === 'war')) bad('relation');
    relations.set(a, b, r);
  }
  const borders: [number, number][] = [];
  for (const [a, b] of snap.borders) {
    if (!isNum(a) || !isNum(b)) bad('border');
    borders.push([a, b]);
  }
  const truce = new Map<string, Truce>();
  for (const t of snap.truce ?? []) {
    if (!isNum(t.a) || !isNum(t.b) || !isNum(t.until) || typeof t.declared !== 'boolean') bad('truce');
    truce.set(pairKey(t.a, t.b), { a: t.a, b: t.b, until: t.until, declared: t.declared });
  }
  states.set(sim, { dominions, relations, borders, owner: Uint8Array.from(snap.owner), truce });
}

/**
 * Yearly dominion pass (10 sections 3, 10, 11 and 12; see founding.ts). Runs once per sim-year on a
 * phase derived from its name. Settlements are read through the hamlet adapter; the dominion state is
 * created only when a settlement qualifies, so a sim without one keeps no dominion state.
 */
export function dominionsYearly(sim: Sim): void {
  if (!sim.due('dominions.year', YEAR_TICKS)) return;
  const settlements = hamletsOf(sim);
  const s = states.get(sim) ?? (settlements.some((h) => h.folk >= FOUND_FOLK) ? dominionState(sim) : undefined);
  if (!s) return;
  const perAxis = parcelsPerAxis(sim);
  const env: FoundingEnv = {
    perAxis,
    tick: sim.tick,
    isOn: (id) => sim.rules.isOn(id),
    land: (p) => {
      const i = (Math.floor(p / perAxis) * PARCEL + PARCEL / 2) * sim.realm.side + ((p % perAxis) * PARCEL + PARCEL / 2);
      return ground(sim.realm.ground[i] ?? 0).layer === 'land';
    },
  };
  foundingYear(s, settlements, env);
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
