import { YEAR_TICKS } from '../../shared/constants.ts';
import { endWar } from './step.ts';
import { pairKey, RelationMatrix, type Dominion, type Relation } from './types.ts';

/** Folk (settlement census) a hamlet needs before it founds a dominion (TUNE). */
export const FOUND_FOLK = 30;
/** Folk per soldier: a dominion's army cap is its hamlets' folk divided by this (TUNE). */
export const ARMY_DIVISOR = 3;
/** Soldiers an attacker needs before it declares war: 10 section 11 says more than 10 (TUNE). */
export const DECLARE_ARMY = 10;
/** Power ratio (bigger over smaller) that turns a peaceful border tense (10 section 10 power gap, TUNE). */
export const TENSION_RATIO = 2;
/** Power ratio at which a declared war ends in a peace pact (TUNE). */
export const PACT_RATIO = 3;
/** Ticks a declaration keeps its pair in truce: five years (10 section 11). */
export const TRUCE_TICKS = 5 * YEAR_TICKS;
/** Zone range in parcels from a dominion's centre, and the squared claim distance it implies (09 section 3, TUNE). */
export const ZONE_RANGE = 13;
export const CLAIM_RANGE_SQ = (ZONE_RANGE * 0.75) ** 2;
/**
 * Land claims per dominion per sim-year (TUNE). 09 section 3 gives a hamlet one claim per 1200 ticks; one claim a
 * year leaves founded dominions too far apart to meet within a decade, so this default is 3 (DECISIONS.md).
 */
export const CLAIMS_PER_YEAR = 3;

/** A truce on a pair: no new declaration until `until`. `declared` marks wars the yearly pass started (pacts apply only to these). */
export interface Truce {
  a: number;
  b: number;
  until: number;
  declared: boolean;
}

/** The dominion data the yearly pass reads and writes (the adapter's DominionState extends this). */
export interface FoundingState {
  dominions: Dominion[];
  relations: RelationMatrix;
  borders: [number, number][];
  /** Owner byte per parcel: dominion id, or 0 for unowned. */
  owner: Uint8Array;
  truce: Map<string, Truce>;
}

/** A settlement as the yearly pass sees it: its parcels and its population census. */
export interface Settlement {
  parcels: ReadonlySet<number>;
  folk: number;
}

/** What the yearly pass needs from the sim: the parcel grid, the clock, the rules and the land test. */
export interface FoundingEnv {
  perAxis: number;
  tick: number;
  isOn(id: string): boolean;
  /** True when a parcel's centre is land a dominion may hold. */
  land(parcel: number): boolean;
  /** Soldiers a dominion has stationed in hamlet garrisons (garrison-adapter.ts). Absent: none. */
  garrisoned?(dominionId: number): number;
  /** True when the dominion may not declare a campaign (custom peaceable or serenity). Optional: without it none is blocked. */
  warBlocked?(dominionId: number): boolean;
  /** Called when a declaration by the bigger side is blocked. Optional. */
  onWarBlocked?(dominionId: number): void;
}

/** Ids a new dominion may take: 1..255 (the owner byte). Returns 0 when none is free. */
function nextId(dominions: readonly Dominion[]): number {
  let max = 0;
  for (const d of dominions) max = Math.max(max, d.id);
  return max < 255 ? max + 1 : 0;
}

/** The dominion holding most of the given parcels (ties go to the lower id), or 0 when none is owned. */
function majorityOwner(parcels: readonly number[], owner: Uint8Array): number {
  const count = new Map<number, number>();
  for (const p of parcels) {
    const o = owner[p] ?? 0;
    if (o !== 0) count.set(o, (count.get(o) ?? 0) + 1);
  }
  let best = 0;
  let bestN = 0;
  for (const [id, n] of count) {
    if (n > bestN || (n === bestN && id < best)) {
      best = id;
      bestN = n;
    }
  }
  return best;
}

/** Orders a pair so that `big` has more strength (ties go to the lower id). */
function ordered(a: Dominion, b: Dominion): [Dominion, Dominion] {
  if (a.strength !== b.strength) return a.strength > b.strength ? [a, b] : [b, a];
  return a.id < b.id ? [a, b] : [b, a];
}

/** True when `big` holds at least `ratio` times the strength of `small` (an empty side counts as 1). */
function outweighs(big: Dominion, small: Dominion, ratio: number): boolean {
  return big.strength >= ratio * Math.max(1, small.strength);
}

/**
 * Claims the free land parcel nearest a dominion's centroid among those next to its parcels, inside
 * the claim range. Settlement parcels and parcels that are not land are never taken. Ties go to the lower index.
 */
function claimNearest(d: Dominion, owner: Uint8Array, perAxis: number, settledParcels: ReadonlySet<number>, land: (p: number) => boolean): void {
  if (d.parcels.size === 0) return;
  let cx = 0;
  let cy = 0;
  for (const p of d.parcels) {
    cx += p % perAxis;
    cy += Math.floor(p / perAxis);
  }
  cx /= d.parcels.size;
  cy /= d.parcels.size;
  let best = -1;
  let bestD = Infinity;
  for (const p of d.parcels) {
    const px = p % perAxis;
    const py = Math.floor(p / perAxis);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = px + dx;
        const ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= perAxis || ny >= perAxis) continue;
        const q = ny * perAxis + nx;
        if ((owner[q] ?? 0) !== 0 || settledParcels.has(q) || !land(q)) continue;
        const dist = (nx - cx) ** 2 + (ny - cy) ** 2;
        if (dist > CLAIM_RANGE_SQ) continue;
        if (dist < bestD || (dist === bestD && q < best)) {
          best = q;
          bestD = dist;
        }
      }
    }
  }
  if (best >= 0) {
    owner[best] = d.id;
    d.parcels.add(best);
  }
}

/**
 * Yearly pass (10 sections 3, 10, 11 and 12; 09 section 3 for land).
 * 1. A settlement with no dominion parcels and at least FOUND_FOLK folk founds a dominion on its parcels
 *    (needs rule `realm_expansion`). A settlement already holding a dominion's parcels claims its free ones.
 * 2. Border growth: each dominion claims up to CLAIMS_PER_YEAR free land parcels next to its territory (claimNearest).
 * 3. Army caps follow folk; strength regrows toward the cap and is never cut here.
 * 4. Borders are the parcel adjacencies between dominions. A new border starts tense when one side outweighs the other.
 * 5. Peace turns tense on a power gap. A tense pair whose bigger side has more than DECLARE_ARMY soldiers goes to war
 *    and enters a truce of TRUCE_TICKS. A declared war ends in a pact (peace) once the bigger side reaches PACT_RATIO.
 * Draws no randomness: the result depends only on the state, the settlements and the environment.
 */
export function foundingYear(state: FoundingState, settlements: readonly Settlement[], env: FoundingEnv): void {
  const { dominions, relations, owner } = state;
  const { perAxis, tick, isOn } = env;
  const byId = new Map<number, Dominion>(dominions.map((d) => [d.id, d]));
  const folkOf = new Map<number, number>();
  const settledParcels = new Set<number>();
  for (const s of settlements) for (const p of s.parcels) settledParcels.add(p);

  // 1. Found and claim.
  for (const s of settlements) {
    const sorted = [...s.parcels].sort((x, y) => x - y);
    let domId = majorityOwner(sorted, owner);
    if (domId === 0) {
      if (s.folk < FOUND_FOLK || !isOn('realm_expansion')) continue;
      const id = nextId(dominions);
      if (id === 0) continue;
      const d: Dominion = { id, parcels: new Set(), strength: Math.floor(s.folk / ARMY_DIVISOR), target: -1, campaignSince: -1, foundedTick: tick };
      dominions.push(d);
      byId.set(id, d);
      domId = id;
    }
    const d = byId.get(domId);
    if (!d) continue;
    for (const p of sorted) {
      if ((owner[p] ?? 0) === 0) {
        owner[p] = domId;
        d.parcels.add(p);
      }
    }
    folkOf.set(domId, (folkOf.get(domId) ?? 0) + s.folk);
  }

  // 2. Border growth.
  for (const d of dominions) {
    for (let k = 0; k < CLAIMS_PER_YEAR; k++) claimNearest(d, owner, perAxis, settledParcels, env.land);
  }

  // 3. Army regrowth toward the folk cap. Soldiers stationed in garrisons are not refilled: the field ceiling is the cap
  // less the garrisoned soldiers, so a garrison draw is not replaced by regrowth and the total never passes the cap.
  for (const d of dominions) {
    const held = env.garrisoned?.(d.id) ?? 0;
    const cap = Math.max(0, Math.floor((folkOf.get(d.id) ?? 0) / ARMY_DIVISOR) - held);
    if (d.strength < cap) d.strength = Math.min(cap, d.strength + Math.max(1, Math.floor(cap / 4)));
  }

  // 4. Borders from parcel adjacency (8 neighbours), sorted for a stable order.
  const pairs = new Map<string, [number, number]>();
  for (let p = 0; p < owner.length; p++) {
    const a = owner[p] ?? 0;
    if (a === 0) continue;
    const px = p % perAxis;
    const py = (p - px) / perAxis;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = px + dx;
        const ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= perAxis || ny >= perAxis) continue;
        const b = owner[ny * perAxis + nx] ?? 0;
        if (b === 0 || b === a) continue;
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        pairs.set(pairKey(lo, hi), [lo, hi]);
      }
    }
  }
  const oldKeys = new Set(state.borders.map(([a, b]) => pairKey(a, b)));
  const borders = [...pairs.values()].sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  for (const [a, b] of borders) {
    if (oldKeys.has(pairKey(a, b))) continue;
    const da = byId.get(a);
    const db = byId.get(b);
    if (!da || !db || relations.get(a, b) === 'war') continue;
    const [big, small] = ordered(da, db);
    relations.set(a, b, outweighs(big, small, TENSION_RATIO) ? 'tension' : 'peace');
  }
  state.borders = borders;

  // 5. Diplomacy per border. A border made this pass waits a year before any diplomacy.
  for (const [a, b] of borders) {
    const key = pairKey(a, b);
    if (!oldKeys.has(key)) continue;
    const da = byId.get(a);
    const db = byId.get(b);
    if (!da || !db) continue;
    const [big, small] = ordered(da, db);
    const t = state.truce.get(key);
    const rel: Relation = relations.get(a, b);
    if (rel === 'war') {
      // A war seen at this pass keeps a truce five years out, so a defeated side is not attacked again at once.
      const declared = t?.declared ?? false;
      if (declared && outweighs(big, small, PACT_RATIO)) {
        endWar(dominions, relations, a, b);
        state.truce.set(key, { a, b, until: tick + TRUCE_TICKS, declared: true });
      } else {
        state.truce.set(key, { a, b, until: tick + TRUCE_TICKS, declared });
      }
      continue;
    }
    if (t && t.until > tick) {
      relations.set(a, b, 'peace');
      continue;
    }
    if (rel === 'peace') {
      if (outweighs(big, small, TENSION_RATIO)) relations.set(a, b, 'tension');
      continue;
    }
    // Tension: declare when the bigger side has an army and still holds the power gap; otherwise the tension eases.
    if (outweighs(big, small, TENSION_RATIO) && big.strength > DECLARE_ARMY) {
      if (env.warBlocked?.(big.id)) {
        env.onWarBlocked?.(big.id);
      } else {
        relations.set(a, b, 'war');
        state.truce.set(key, { a, b, until: tick + TRUCE_TICKS, declared: true });
      }
    } else if (!outweighs(big, small, TENSION_RATIO)) {
      relations.set(a, b, 'peace');
    }
  }
}
