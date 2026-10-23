import type { Rng } from '../../shared/rng.ts';
import { ssToTicks } from '../clock.ts';
import type { Realm } from '../realm.ts';
import type { BeingStore } from '../beings/store.ts';
import { buildable, createHamlet, hamletStep, PARCEL, type Hamlet, type HamletContext } from './hamlet.ts';

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
    hamletStep(ctx, h);
  }
}
