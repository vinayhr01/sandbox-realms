import type { Rng } from '../../shared/rng.ts';
import { ssToTicks } from '../clock.ts';
import type { Realm } from '../realm.ts';
import type { BeingStore } from '../beings/store.ts';
import type { Sim } from '../sim.ts';
import { dominionState, UNOWNED } from '../dominions/adapter.ts';
import { FOUND_FOLK } from '../dominions/founding.ts';
import { buildable, createHamlet, goodFoundingParcel, hamletStep, PARCEL, type Hamlet, type HamletContext, type Placed } from './hamlet.ts';
import { BUILDING_BY_ID } from './catalogue.ts';
import { SUPPLY_PERIOD, tradeStep } from './trade.ts';

/** Hamlets placed per realm at worldgen (TUNE). Kept: 09 does not place hamlets at worldgen, but the worldgen placement stays as it was. */
export const HAMLETS_WANTED = 3;
/** Random tile draws tried while placing hamlets before giving up (TUNE). */
const PLACEMENT_ATTEMPTS = 400;
/** Adult Folk of one lineage needed within BAND_RANGE to found a hamlet (09 section 2 path A, MIN_BAND; TUNE). */
export const MIN_BAND = 2;
/** Band radius in tiles (09 section 2 path A, BAND_RANGE; TUNE). */
export const BAND_RANGE = 20;
/** Ticks in one sim-second (hamlets step once per sim-second). */
const SECOND = ssToTicks(1);

/**
 * Structural view of a Sim: the settlements adapter needs only these members, so it never
 * imports Sim (sim.ts imports this module).
 */
export interface SettlementHost {
  readonly realm: Realm;
  readonly rules: { isOn(id: string): boolean };
  readonly beings: { readonly store: BeingStore; species(index: number): { readonly folk: boolean } };
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
  /** `gold` is absent in saves written before the hamlet purse; those load with 0 gold. */
  hamlets: { parcels: number[]; food: number; wood: number; stone: number; folk: number; buildings: { id: string; x: number; y: number }[]; growTimer: number; outcrops: number; steps: number; gold?: number }[];
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
      outcrops: h.outcrops,
      steps: h.steps,
      gold: h.gold,
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
    const gold = h.gold ?? 0;
    if (!isNum(h.food) || !isNum(h.wood) || !isNum(h.stone) || !isNum(h.folk) || !isNum(h.growTimer) || !isNum(h.outcrops) || !isNum(h.steps) || !isNum(gold) || gold < 0 || !Array.isArray(h.parcels) || !Array.isArray(h.buildings)) {
      throw new Error('hamlet state: record is not valid');
    }
    const buildings: Placed[] = h.buildings.map((b) => {
      const def = BUILDING_BY_ID.get(b.id);
      if (!def || !isNum(b.x) || !isNum(b.y)) throw new Error(`hamlet state: building ${b.id} is not valid`);
      return { def, x: b.x, y: b.y };
    });
    return { parcels: new Set(h.parcels), food: h.food, wood: h.wood, stone: h.stone, folk: h.folk, buildings, growTimer: h.growTimer, outcrops: h.outcrops, steps: h.steps, gold };
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

/**
 * Founds hamlets where Folk gather (09 section 2 path A; 12 spawn_folk: two or more adults of one lineage meet on
 * suitable ground with no hamlet nearby). Founders are scanned in slot order. A founder's band is the adults of
 * its lineage within BAND_RANGE, itself included; a band of MIN_BAND or more on a goodFoundingParcel founds
 * there: the parcel and every unowned neighbour parcel become the hamlet's territory (09 foundHamlet step 2).
 * No dominion is made here; the yearly dominion pass creates one once the hamlet reaches FOUND_FOLK.
 * Draws no randomness.
 */
function foundHamlets(host: SettlementHost, state: SettlementState): void {
  const s = host.beings.store;
  const perAxis = host.realm.side / PARCEL;
  const adults: number[] = [];
  for (let k = 0; k < s.size; k++) {
    const slot = s.at(k);
    if (s.baby[slot] === 0 && host.beings.species(s.species[slot] ?? 0).folk) adults.push(slot);
  }
  if (adults.length < MIN_BAND) return;
  const owned = new Set<number>();
  for (const h of state.hamlets) for (const p of h.parcels) owned.add(p);
  const range2 = BAND_RANGE * BAND_RANGE;
  for (const founder of adults) {
    const fx = s.x[founder] ?? 0;
    const fy = s.y[founder] ?? 0;
    const species = s.species[founder];
    let band = 0;
    for (const o of adults) {
      if (s.species[o] !== species) continue;
      const dx = (s.x[o] ?? 0) - fx;
      const dy = (s.y[o] ?? 0) - fy;
      if (dx * dx + dy * dy <= range2) band++;
    }
    if (band < MIN_BAND) continue;
    const p = Math.floor(fy / PARCEL) * perAxis + Math.floor(fx / PARCEL);
    if (owned.has(p) || !goodFoundingParcel(host.realm, p, owned)) continue;
    const h = createHamlet(p, band);
    const px = p % perAxis;
    const py = Math.floor(p / perAxis);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = px + dx;
        const ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= perAxis || ny >= perAxis) continue;
        const q = ny * perAxis + nx;
        if (!owned.has(q)) h.parcels.add(q);
      }
    }
    for (const q of h.parcels) owned.add(q);
    state.hamlets.push(h);
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
  foundHamlets(host, state);
  const ctx = contextOf(host);
  for (const h of state.hamlets) {
    h.folk = census(host, h);
    // Another hamlet owning a parcel blocks this hamlet from expanding into it.
    const own: HamletContext = { ...ctx, claimed: (q) => state.hamlets.some((o) => o !== h && o.parcels.has(q)) };
    hamletStep(own, h);
  }
  // Supply round (09 10.4). Dominion owner bytes are read only on a supply tick, and only once a hamlet
  // can found a dominion: dominionState creates the dominion state on first use.
  if (host.tick % SUPPLY_PERIOD === 0 && state.hamlets.some((h) => h.folk >= FOUND_FOLK)) {
    const owner = dominionState(host as unknown as Sim).owner;
    tradeStep(state.hamlets, (h) => majorityOwner(owner, h), host.tick);
  }
}

/** The dominion holding most of a hamlet's parcels (ties to the lower id), or UNOWNED when none holds one. */
function majorityOwner(owner: Uint8Array, h: Hamlet): number {
  const counts = new Map<number, number>();
  for (const p of h.parcels) {
    const o = owner[p] ?? UNOWNED;
    if (o !== UNOWNED) counts.set(o, (counts.get(o) ?? 0) + 1);
  }
  let best = UNOWNED;
  let bestN = 0;
  for (const [id, n] of counts) {
    if (n > bestN || (n === bestN && id < best)) {
      best = id;
      bestN = n;
    }
  }
  return best;
}
