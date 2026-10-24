import type { Rng } from '../../shared/rng.ts';
import { ssToTicks } from '../clock.ts';
import type { Realm } from '../realm.ts';
import type { BeingStore } from '../beings/store.ts';
import { buildable, createHamlet, hamletStep, PARCEL, type Hamlet, type HamletContext, type Placed } from './hamlet.ts';
import { BUILDING_BY_ID } from './catalogue.ts';

/** Hamlets placed per realm (TUNE). */
export const HAMLETS_WANTED = 3;
/** Random tile draws tried while placing hamlets before giving up (TUNE). */
const PLACEMENT_ATTEMPTS = 400;
/** Ticks in one sim-second (hamlets step once per sim-second). */
const SECOND = ssToTicks(1);

/**
 * Structural view of a Sim: the settlements adapter needs only these members, so it never
 * imports Sim (sim.ts imports this module).
 */
export interface SettlementHost {
  readonly realm: Realm;
  readonly rules: { isOn(id: string): boolean };
  readonly beings: { readonly store: BeingStore };
  readonly tick: number;
  rng(name: string): Rng;
}

interface SettlementState {
  hamlets: Hamlet[];
}

/** Per-sim hamlet state, keyed by the host object (sim.ts has no field for it). */
const states = new WeakMap<object, SettlementState>();

/** Hamlets of a host, in placement order. Empty before the first settlementsStep. */
export function hamletsOf(host: SettlementHost): readonly Hamlet[] {
  return states.get(host)?.hamlets ?? [];
}

/** Plain-data form of one hamlet, JSON-safe; buildings are kept by catalogue id (Chronicle section 16). */
export interface HamletSnapshot {
  hamlets: { parcels: number[]; food: number; wood: number; stone: number; folk: number; buildings: { id: string; x: number; y: number }[]; growTimer: number }[];
}

/** Plain copy of a host's hamlet state, or null when the state was never created (no settlementsStep yet). */
export function snapshotHamlets(host: SettlementHost): HamletSnapshot | null {
  const state = states.get(host);
  if (!state) return null;
  return {
    hamlets: state.hamlets.map((h) => ({
      parcels: [...h.parcels],
      food: h.food,
      wood: h.wood,
      stone: h.stone,
      folk: h.folk,
      buildings: h.buildings.map((b) => ({ id: b.def.id, x: b.x, y: b.y })),
      growTimer: h.growTimer,
    })),
  };
}

/** Replaces a host's hamlet state with a snapshot (Chronicle load). Unknown building ids are rejected. */
export function restoreHamlets(host: SettlementHost, snap: HamletSnapshot): void {
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (!Array.isArray(snap.hamlets)) throw new Error('hamlet state is not valid');
  // Hamlets hold disjoint parcels inside the realm, as placeHamlets guarantees.
  const perAxis = host.realm.side / PARCEL;
  const taken = new Set<number>();
  const hamlets: Hamlet[] = snap.hamlets.map((h) => {
    if (!Array.isArray(h.parcels)) throw new Error('hamlet state: parcels are not valid');
    for (const p of h.parcels) {
      if (!Number.isInteger(p) || p < 0 || p >= perAxis * perAxis || taken.has(p)) throw new Error('hamlet state: parcels are not valid');
      taken.add(p);
    }
    if (!isNum(h.food) || !isNum(h.wood) || !isNum(h.stone) || !isNum(h.folk) || !isNum(h.growTimer) || !Array.isArray(h.parcels) || !Array.isArray(h.buildings)) {
      throw new Error('hamlet state: record is not valid');
    }
    const buildings: Placed[] = h.buildings.map((b) => {
      const def = BUILDING_BY_ID.get(b.id);
      if (!def || !isNum(b.x) || !isNum(b.y)) throw new Error(`hamlet state: building ${b.id} is not valid`);
      return { def, x: b.x, y: b.y };
    });
    return { parcels: new Set(h.parcels), food: h.food, wood: h.wood, stone: h.stone, folk: h.folk, buildings, growTimer: h.growTimer };
  });
  states.set(host, { hamlets });
}

/** Maps the host onto the hamlet step's structural context. */
function contextOf(host: SettlementHost): HamletContext {
  return {
    realm: host.realm,
    rng: host.rng('settlements'),
    tick: host.tick,
    isOn: (id) => host.rules.isOn(id),
  };
}

/** Places hamlets on random buildable land tiles, each in its own parcel. Draws only from the 'settlements' stream. */
function placeHamlets(host: SettlementHost, state: SettlementState): void {
  const ctx = contextOf(host);
  const side = host.realm.side;
  const perAxis = side / PARCEL;
  for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS && state.hamlets.length < HAMLETS_WANTED; attempt++) {
    const x = ctx.rng.int(side);
    const y = ctx.rng.int(side);
    const parcel = Math.floor(y / PARCEL) * perAxis + Math.floor(x / PARCEL);
    if (state.hamlets.some((h) => h.parcels.has(parcel))) continue;
    const candidate = createHamlet(parcel, 0);
    if (!buildable(ctx, x, y, candidate)) continue;
    state.hamlets.push(candidate);
  }
}

/** Counts living beings standing in any parcel of the hamlet. Species is not distinguished. */
function census(host: SettlementHost, h: Hamlet): number {
  const s = host.beings.store;
  const perAxis = host.realm.side / PARCEL;
  let n = 0;
  for (let k = 0; k < s.size; k++) {
    const slot = s.at(k);
    const x = s.x[slot] ?? 0;
    const y = s.y[slot] ?? 0;
    if (h.parcels.has(Math.floor(y / PARCEL) * perAxis + Math.floor(x / PARCEL))) n++;
  }
  return n;
}

/**
 * Per-tick settlements hook. Places the hamlets on the first call, then once per sim-second sets
 * each hamlet's population from the beings census and runs one hamlet step.
 */
export function settlementsStep(host: SettlementHost): void {
  let state = states.get(host);
  if (!state) {
    state = { hamlets: [] };
    states.set(host, state);
    placeHamlets(host, state);
  }
  if (host.tick % SECOND !== 0) return;
  const ctx = contextOf(host);
  for (const h of state.hamlets) {
    h.folk = census(host, h);
    // Another hamlet owning a parcel blocks this hamlet from expanding into it.
    const own: HamletContext = { ...ctx, claimed: (q) => state.hamlets.some((o) => o !== h && o.parcels.has(q)) };
    hamletStep(own, h);
  }
}
