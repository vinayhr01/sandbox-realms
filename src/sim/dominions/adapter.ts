import type { Sim } from '../sim.ts';
import { PARCEL } from '../settlements/hamlet.ts';
import { hamletsOf } from '../settlements/adapter.ts';
import { garrisonedSoldiers } from '../settlements/garrison-adapter.ts';
import { SS_TICKS } from '../clock.ts';
import { YEAR_TICKS } from '../../shared/constants.ts';
import { dominionStep } from './step.ts';
import { ground } from '../../content/grounds.ts';
import { ARMY_DIVISOR, FOUND_FOLK, foundingYear, type FoundingEnv, type Truce } from './founding.ts';
import { pairKey, RelationMatrix, type Dominion, type DominionContext, type Rank, type Relation, type UnitGuard } from './types.ts';
import { addPactRenown, forcePact as forcePactRecord, makePact, newPactState, pactOf, pactYear, PACT_RENOWN_PER_DEFEAT, type Pact, type PactState } from './pacts.ts';
import { armyWon, attackOrders, centroidParcel, engageArmies, marchArmies, raiseArmies, setCaptains, setSlots, syncArmies, type Army } from './armies.ts';
import {
  formPactOk,
  INTRIGUE_KINDS,
  joinPactOk,
  newIntrigueState,
  proposeIntrigues,
  resolveIntrigues,
  type FoundHooks,
  type FoundKind,
  type Intrigue,
  type IntrigueEnv,
  type IntrigueState,
  type SplitHooks,
  type SplitKind,
} from './intrigue.ts';
import { taxFlowOf, taxRatesOf, type TaxFlow } from './tax.ts';
import { leadingHamlet, rulersStep, rulerLive, rulerStatsOf, RULER_WAIT_MIN, RULER_WAIT_SPAN, type RulerRef, type RulerStats } from './rulers.ts';
import { rankDominions, RANK_PERIOD_TICKS } from './rank.ts';
import { hamletLoyalty, isHappy, loyaltyDue, LOYALTY_TASK_TICKS, type HamletLoyaltyFacts, type LoyaltyCache } from './loyalty.ts';
import { captureStep, CAPTURE_STEP_TICKS, HAMLET_CAPTURE, RAZE_CHECK_TICKS, razeStep, type Capture, type CaptureFall } from './capture.ts';
import { cultureYearly } from '../culture/adapter.ts';
import { blockedWarMood, campaignMood, captureMood, convertLineageUnits, groupOfSlot, lineageHas, razedMood, rulerInstalled, traitsOfGroup, warBlocked as warBlockedBy } from '../culture/effects.ts';
import { addMood } from '../beings/social.ts';
import { customOfGroup, foundCreed, foundDialect, harmonyBonus, sameMeta, splitCreed, splitCustom, splitDialect, type MetaBirth } from '../culture/culture.ts';
import { successionRuleOf, type FoundFacts, type SplitFacts } from '../culture/trait-rules.ts';
import { MAX_BEINGS } from '../beings/store.ts';
import { opinion, powerOf, type DominionLens, type OpinionContext } from './opinion.ts';

/** Aptitude indices of a Being in the store (05 section 2): rapport (diplomacy), husbandry (stewardship), wit (intelligence). */
const APT_RAPPORT = 0;
const APT_HUSBANDRY = 2;
const APT_WIT = 3;

/** Dominion traits a dominion may hold (tax.ts reads the four tax ones; `markFate` is a locked marker, 11 section 9.4). */
const DOMINION_TRAITS = ['highLocal', 'lowLocal', 'highTribute', 'lowTribute', 'markFate'] as const;
/** Opposite pairs of dominion traits: adding one removes the other (11 section 11). */
const DOMINION_OPPOSITES: Readonly<Record<string, string>> = { highLocal: 'lowLocal', lowLocal: 'highLocal', highTribute: 'lowTribute', lowTribute: 'highTribute' };

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
  /** Pact records (pacts.ts). */
  pacts: PactState;
  /** One army per dominion (armies.ts). */
  armies: Army[];
  /** Pact intrigue records (intrigue.ts). */
  intrigues: IntrigueState;
  /** Gold each hamlet held at the last yearly pass, keyed by the hamlet's lowest parcel (tax.ts loot). */
  taxSeen: Map<number, number>;
  /** Per-hamlet tax flows written by the latest yearly pass (tax.ts TaxFlow). Replaced each pass; empty before the first. */
  taxFlows: TaxFlow[];
  /**
   * Hamlet loyalty cache, keyed by the hamlet's index in hamletsOf order (as `hold`). Recomputed by the loyalty task (loyaltyStep,
   * loyalty.ts LOYALTY_CACHE_TICKS). Saved as `hamletLoyalty`.
   */
  loyalty: Map<number, LoyaltyCache>;
  /** Hamlet capture progress by the hamlet's lowest parcel (capture.ts). Saved as `captures`. */
  captures: Map<number, Capture>;
  /**
   * Dominion each hamlet was last seen with, and the tick it was first seen with it, keyed by the hamlet's index in
   * hamletsOf order (the sim never removes a hamlet). Saved as `hamletHolds`; read by the belonging term (10 section 5).
   */
  hold: Map<number, { dominion: number; since: number }>;
  /**
   * Tick each conquered unit was stamped wasConquered (effects.ts captureMood), keyed as a culture key (generation times
   * MAX_BEINGS plus slot). Not saved: a load clears the window (DECISIONS.md, Capture follow-ups close 9).
   */
  conqueredAt: Map<number, number>;
  /** Hamlets this state has taken from another dominion by capture (10 section 2 counter hamletsConquered). Saved as `hamletsConquered`. */
  hamletsConquered: number;
  /** Hamlets razed by the raze check (capture.ts razeStep). Saved as `hamletsRazed`. */
  hamletsRazed: number;
}

const states = new WeakMap<Sim, DominionState>();

/** Dominion state of a sim, created empty on first use. */
export function dominionState(sim: Sim): DominionState {
  let s = states.get(sim);
  if (!s) {
    const perAxis = sim.realm.side / PARCEL;
    s = {
      dominions: [],
      relations: new RelationMatrix(),
      borders: [],
      owner: new Uint8Array(perAxis * perAxis),
      truce: new Map(),
      pacts: newPactState(),
      armies: [],
      intrigues: newIntrigueState(),
      taxSeen: new Map(),
      taxFlows: [],
      loyalty: new Map(),
      captures: new Map(),
      hold: new Map(),
      conqueredAt: new Map(),
      hamletsConquered: 0,
      hamletsRazed: 0,
    };
    states.set(sim, s);
  }
  return s;
}

/** Pairs of dominion ids that share a border, read only: empty when the dominion state was never created (culture contacts). */
export function dominionBordersOf(sim: Sim): readonly (readonly [number, number])[] {
  return states.get(sim)?.borders ?? [];
}

/** Owner byte per parcel of a sim, read only: undefined when the dominion state was never created. */
export function dominionOwnerOf(sim: Sim): Uint8Array | undefined {
  return states.get(sim)?.owner;
}

/** Pact records of a sim, read only: empty when the dominion state was never created. */
export function pactsOfSim(sim: Sim): readonly Pact[] {
  return states.get(sim)?.pacts.pacts ?? [];
}

/** Tax flows of the latest yearly pass, read only: empty when the dominion state was never created (tax.ts TaxFlow). */
export function taxFlowsOfSim(sim: Sim): readonly TaxFlow[] {
  return states.get(sim)?.taxFlows ?? [];
}

/** Dominions of a sim, read only: empty when the dominion state was never created. */
export function dominionsOfSim(sim: Sim): readonly Dominion[] {
  return states.get(sim)?.dominions ?? [];
}

/**
 * Adds a pact record between two dominions that are not in a pact yet (tests and tools; the yearly
 * pass forms pacts itself and keeps the formation timeout). Throws when a dominion is missing or pacted.
 */
export function addPact(sim: Sim, a: number, b: number): Pact {
  const s = dominionState(sim);
  for (const id of [a, b]) {
    if (!s.dominions.some((d) => d.id === id)) throw new Error(`no dominion ${id}`);
    if (pactOf(s.pacts.pacts, id)) throw new Error(`dominion ${id} is already in a pact`);
  }
  return makePact(s.pacts, a, b, sim.tick);
}

/**
 * God-tool forced pact between two dominions (10 section 12; see forcePact in pacts.ts). Throws when a dominion is missing,
 * when the pair is the same dominion, or when either is already in a pact. There is no command path: sim.ts does not route
 * it, so it is called from tests and tools only (DECISIONS.md, Dominions and culture release).
 */
export function forcePact(sim: Sim, a: number, b: number): Pact {
  const s = dominionState(sim);
  for (const id of [a, b]) {
    if (!s.dominions.some((d) => d.id === id)) throw new Error(`no dominion ${id}`);
  }
  return forcePactRecord(s.pacts, a, b, sim.tick);
}

/**
 * Sets a dominion's traits (11 section 11): unknown names throw; adding a trait removes its opposite first. Traits set tax
 * rates (tax.ts). Like forcePact, there is no command path; lineage defaults do not exist here, so this is the only source.
 */
export function setDominionTraits(sim: Sim, id: number, traits: readonly string[]): void {
  const s = dominionState(sim);
  const d = s.dominions.find((x) => x.id === id);
  if (!d) throw new Error(`no dominion ${id}`);
  let list: string[] = [...(d.traits ?? [])];
  for (const t of traits) {
    if (!(DOMINION_TRAITS as readonly string[]).includes(t)) throw new RangeError(`unknown dominion trait ${t}`);
    const opposite = DOMINION_OPPOSITES[t];
    list = list.filter((x) => x !== opposite && x !== t);
    list.push(t);
  }
  d.traits = list;
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
  const d: Dominion = { id, parcels: new Set(), strength, target: -1, campaignSince: -1, foundedTick: sim.tick };
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
  /** `traits` and `taxRaised` are optional: written only when set, so older saves and untaxed dominions keep their shape. */
  /** `ruler` and `rulerWaitUntil` are optional too: written only while a ruler is held or a succession wait runs (rulers.ts). `rank` is written only when set (rank.ts). */
  /** `foundedTick`, `rulerSinceTick` and `newConquestTick` are written only when set (older saves have none, so no age or tenure term). */
  dominions: { id: number; parcels: number[]; strength: number; target: number; campaignSince: number; traits?: string[]; taxRaised?: number; ruler?: RulerRef; rulerWaitUntil?: number; rank?: Rank; foundedTick?: number; rulerSinceTick?: number; newConquestTick?: number }[];
  /** Hamlet holdings (`DominionState.hold`): [hamlet index, dominion id, tick first seen]. Optional: written only while one exists. */
  hamletHolds?: [number, number, number][];
  /** Hamlet loyalty cache (`DominionState.loyalty`): [hamlet index, value, tick computed]. Optional: written only while one exists. */
  hamletLoyalty?: [number, number, number][];
  /** Hamlet capture progress (capture.ts) by the hamlet's lowest parcel. Optional: written only while a capture runs. */
  captures?: { anchor: number; ticks: number; defenderTicks: number }[];
  /** Hamlets taken by capture (DominionState.hamletsConquered). Optional: written only when above 0. */
  hamletsConquered?: number;
  /** Hamlets razed (DominionState.hamletsRazed). Optional: written only when above 0. */
  hamletsRazed?: number;
  /** Hamlet gold at the last yearly pass by the hamlet's lowest parcel (tax.ts loot). Optional: written only when present. */
  taxSeen?: [number, number][];
  /** Per-hamlet tax flows of the latest yearly pass (tax.ts TaxFlow). Optional: written only when the pass taxed a hamlet. */
  taxFlows?: TaxFlow[];
  /** Pairs whose relation is not the default peace: [a, b, relation]. */
  relations: [number, number, Relation][];
  borders: [number, number][];
  /** Owner byte per parcel. */
  owner: number[];
  /** Truces (founding.ts). Optional: saves written before the yearly pass have none. */
  truce?: { a: number; b: number; until: number; declared: boolean }[];
  /** Armies (armies.ts). Optional: saves written before armies have none. `slots` and `order` are optional for older saves. */
  armies?: { id: number; name: string; dominionId: number; soldiers: number; renown: number; captains?: number; parcel?: number; slots?: number; order?: number }[];
  /** Pact intrigues (intrigue.ts). Optional: written only when one is pending or a cooldown runs, so older saves load with none. */
  intrigues?: IntrigueSnapshot;
}

/** Plain-data form of the pact intrigue records (intrigue.ts). */
export interface IntrigueSnapshot {
  items: Intrigue[];
  nextId: number;
  cooldowns: { dominionId: number; until: number }[];
}

/** Plain-data form of the pact records (chronicle tag 20, pacts.ts). */
export interface PactSnapshot {
  pacts: Pact[];
  nextId: number;
  lastFormedTick: number;
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
    dominions: s.dominions.map((d) => ({
      id: d.id,
      parcels: [...d.parcels],
      strength: d.strength,
      target: d.target,
      campaignSince: d.campaignSince,
      ...(d.traits !== undefined && d.traits.length > 0 ? { traits: [...d.traits] } : {}),
      ...(d.taxRaised !== undefined && d.taxRaised > 0 ? { taxRaised: d.taxRaised } : {}),
      ...(d.ruler !== undefined ? { ruler: { slot: d.ruler.slot, gen: d.ruler.gen } } : {}),
      ...(d.rulerWaitUntil !== undefined ? { rulerWaitUntil: d.rulerWaitUntil } : {}),
      ...(d.rank !== undefined ? { rank: d.rank } : {}),
      ...(d.foundedTick !== undefined ? { foundedTick: d.foundedTick } : {}),
      ...(d.rulerSinceTick !== undefined ? { rulerSinceTick: d.rulerSinceTick } : {}),
      ...(d.newConquestTick !== undefined ? { newConquestTick: d.newConquestTick } : {}),
    })),
    ...(s.hold.size > 0 ? { hamletHolds: [...s.hold].map(([i, h]): [number, number, number] => [i, h.dominion, h.since]) } : {}),
    ...(s.loyalty.size > 0 ? { hamletLoyalty: [...s.loyalty].map(([i, c]): [number, number, number] => [i, c.value, c.tick]) } : {}),
    ...(s.captures.size > 0 ? { captures: [...s.captures].map(([anchor, c]) => ({ anchor, ticks: c.ticks, defenderTicks: c.defenderTicks })) } : {}),
    ...(s.hamletsConquered > 0 ? { hamletsConquered: s.hamletsConquered } : {}),
    ...(s.hamletsRazed > 0 ? { hamletsRazed: s.hamletsRazed } : {}),
    ...(s.taxSeen.size > 0 ? { taxSeen: [...s.taxSeen] } : {}),
    ...(s.taxFlows.length > 0 ? { taxFlows: s.taxFlows.map((f) => ({ ...f })) } : {}),
    relations,
    borders: s.borders.map(([a, b]) => [a, b]),
    owner: [...s.owner],
    truce: [...s.truce.values()].map((t) => ({ a: t.a, b: t.b, until: t.until, declared: t.declared })),
    armies: s.armies.map((a) => ({ id: a.id, name: a.name, dominionId: a.dominionId, soldiers: a.soldiers, renown: a.renown, captains: a.captains, parcel: a.parcel, slots: a.slots, order: a.order })),
    ...(s.intrigues.items.length > 0 || s.intrigues.cooldowns.length > 0 || s.intrigues.nextId > 1
      ? { intrigues: { items: s.intrigues.items.map((i) => ({ ...i })), nextId: s.intrigues.nextId, cooldowns: s.intrigues.cooldowns.map((c) => ({ ...c })) } }
      : {}),
  };
}

/** Plain copy of the pact records, or null when there are none and no formation has happened (no section then). */
export function snapshotPacts(sim: Sim): PactSnapshot | null {
  const s = states.get(sim);
  if (!s || (s.pacts.pacts.length === 0 && s.pacts.lastFormedTick < 0)) return null;
  return {
    pacts: s.pacts.pacts.map((p) => ({ ...p, memberIds: [...p.memberIds], founders: [p.founders[0], p.founders[1]] })),
    nextId: s.pacts.nextId,
    lastFormedTick: s.pacts.lastFormedTick,
  };
}

/** Replaces the pact records with a snapshot (Chronicle load). Checks ids, members and counters first. */
export function restorePacts(sim: Sim, snap: PactSnapshot): void {
  const bad = (what: string): never => {
    throw new Error(`pact state: ${what} is not valid`);
  };
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const isInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v);
  const s = dominionState(sim);
  const dominionIds = new Set(s.dominions.map((d) => d.id));
  if (!Array.isArray(snap.pacts) || !isInt(snap.nextId) || !isInt(snap.lastFormedTick) || snap.lastFormedTick < -1) bad('counters');
  const seen = new Set<number>();
  for (const p of snap.pacts) {
    if (!isInt(p.id) || p.id < 1 || seen.has(p.id) || p.id >= snap.nextId) bad(`pact ${p.id}`);
    seen.add(p.id);
    if (typeof p.name !== 'string' || !isNum(p.renown) || p.renown < 0 || !isInt(p.formedTick) || (p.kind !== 'normal' && p.kind !== 'forced')) bad(`pact ${p.id} fields`);
    if (!Array.isArray(p.memberIds) || p.memberIds.length < 2 || !Array.isArray(p.founders) || p.founders.length !== 2) bad(`pact ${p.id} members`);
    for (const m of p.memberIds) if (!isInt(m) || !dominionIds.has(m)) bad(`pact ${p.id} member ${m}`);
    if (new Set(p.memberIds).size !== p.memberIds.length) bad(`pact ${p.id} members repeat`);
  }
  s.pacts = {
    pacts: snap.pacts.map((p) => ({ ...p, memberIds: [...p.memberIds], founders: [p.founders[0], p.founders[1]] })),
    nextId: snap.nextId,
    lastFormedTick: snap.lastFormedTick,
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
    if (d.traits !== undefined && (!Array.isArray(d.traits) || !d.traits.every((t) => (DOMINION_TRAITS as readonly string[]).includes(t)))) bad(`dominion ${d.id} traits`);
    if (d.taxRaised !== undefined && (!isNum(d.taxRaised) || d.taxRaised < 0)) bad(`dominion ${d.id} tax receipts`);
    // The ruler ref names a Being slot and generation; liveness is checked by the ruler step, not here (a stale ref is succession).
    const rulerOk = (r: RulerRef): boolean => Number.isInteger(r.slot) && r.slot >= 0 && r.slot < sim.beings.store.capacity && Number.isInteger(r.gen) && r.gen >= 0;
    if (d.ruler !== undefined && (typeof d.ruler !== 'object' || d.ruler === null || !rulerOk(d.ruler))) bad(`dominion ${d.id} ruler`);
    if (d.rulerWaitUntil !== undefined && (!isNum(d.rulerWaitUntil) || d.rulerWaitUntil < 0)) bad(`dominion ${d.id} ruler wait`);
    if (d.rank !== undefined && d.rank !== 'supreme' && d.rank !== 'second') bad(`dominion ${d.id} rank`);
    for (const t of [d.foundedTick, d.rulerSinceTick, d.newConquestTick]) {
      if (t !== undefined && (!isNum(t) || !Number.isInteger(t) || t < 0)) bad(`dominion ${d.id} tick`);
    }
    dominions.push({
      id: d.id,
      parcels: new Set(d.parcels),
      strength: d.strength,
      target: d.target,
      campaignSince: d.campaignSince,
      ...(d.traits !== undefined ? { traits: [...d.traits] } : {}),
      ...(d.taxRaised !== undefined ? { taxRaised: d.taxRaised } : {}),
      ...(d.ruler !== undefined ? { ruler: { slot: d.ruler.slot, gen: d.ruler.gen } } : {}),
      ...(d.rulerWaitUntil !== undefined ? { rulerWaitUntil: d.rulerWaitUntil } : {}),
      ...(d.rank !== undefined ? { rank: d.rank } : {}),
      ...(d.foundedTick !== undefined ? { foundedTick: d.foundedTick } : {}),
      ...(d.rulerSinceTick !== undefined ? { rulerSinceTick: d.rulerSinceTick } : {}),
      ...(d.newConquestTick !== undefined ? { newConquestTick: d.newConquestTick } : {}),
    });
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
  const armies: Army[] = [];
  for (const a of snap.armies ?? []) {
    if (!isNum(a.id) || !isNum(a.dominionId) || !dominions.some((d) => d.id === a.dominionId) || !isNum(a.soldiers) || !isNum(a.renown) || typeof a.name !== 'string') {
      bad(`army ${a.id}`);
    }
    if ((a.slots !== undefined && (!isNum(a.slots) || a.slots < 0)) || (a.order !== undefined && !isNum(a.order))) bad(`army ${a.id} slots or order`);
    const parcel = a.parcel ?? centroidParcel(dominions.find((d) => d.id === a.dominionId)?.parcels ?? new Set(), perAxis);
    armies.push({ id: a.id, name: a.name, dominionId: a.dominionId, soldiers: a.soldiers, renown: a.renown, captains: a.captains ?? 1, parcel, slots: a.slots ?? 0, order: a.order ?? -1 });
  }
  const intrigues = newIntrigueState();
  if (snap.intrigues !== undefined) {
    const ig = snap.intrigues;
    if (!isNum(ig.nextId) || !Array.isArray(ig.items) || !Array.isArray(ig.cooldowns)) bad('intrigues');
    for (const i of ig.items) {
      if (!isNum(i.id) || !isNum(i.dominionId) || !isNum(i.targetId) || !isNum(i.startedTick) || !INTRIGUE_KINDS.includes(i.kind) || !dominions.some((d) => d.id === i.dominionId)) bad(`intrigue ${i.id}`);
    }
    for (const c of ig.cooldowns) if (!isNum(c.dominionId) || !isNum(c.until)) bad('intrigue cooldown');
    intrigues.items = ig.items.map((i) => ({ ...i }));
    intrigues.nextId = ig.nextId;
    intrigues.cooldowns = ig.cooldowns.map((c) => ({ dominionId: c.dominionId, until: c.until }));
  }
  const taxSeen = new Map<number, number>();
  for (const pair of snap.taxSeen ?? []) {
    if (!Array.isArray(pair) || pair.length !== 2) bad('tax seen');
    const [p, gold] = pair;
    if (!isNum(p) || !Number.isInteger(p) || p < 0 || p >= parcelCount || !isNum(gold) || gold < 0) bad('tax seen');
    taxSeen.set(p, gold);
  }
  // Tax flows (tax.ts TaxFlow): each share is a whole non-negative number, the shares add up to the leader's part, and the
  // leader's part is at most the loot. The dominion must exist; the anchor must be a parcel of the realm.
  const taxFlows: TaxFlow[] = [];
  for (const f of snap.taxFlows ?? []) {
    const whole = [f.anchor, f.dominion, f.tick, f.loot, f.toLeader, f.toRuler, f.hamletShare, f.leaderShare];
    if (!whole.every((v) => isNum(v) && Number.isInteger(v) && v >= 0)) bad('tax flow');
    if (f.anchor >= parcelCount || !dominions.some((d) => d.id === f.dominion)) bad(`tax flow of hamlet ${f.anchor}`);
    if (f.toRuler + f.hamletShare + f.leaderShare !== f.toLeader || f.toLeader > f.loot) bad(`tax flow of hamlet ${f.anchor} shares`);
    taxFlows.push({ ...f });
  }
  // Hamlet holdings (belonging and conquest, 10 section 5): [hamlet index, dominion id, tick]. The dominion must exist.
  const hold = new Map<number, { dominion: number; since: number }>();
  for (const [i, dom, since] of snap.hamletHolds ?? []) {
    if (!isNum(i) || !Number.isInteger(i) || i < 0 || !isNum(dom) || !dominions.some((d) => d.id === dom) || !isNum(since) || !Number.isInteger(since) || since < 0) bad('hamlet hold');
    hold.set(i, { dominion: dom, since });
  }
  // Hamlet loyalty cache (10 section 5): [hamlet index, value, tick]. Saves without it start with no cache, so every hamlet is due.
  const loyalty = new Map<number, LoyaltyCache>();
  for (const [i, value, tick] of snap.hamletLoyalty ?? []) {
    if (!isNum(i) || !Number.isInteger(i) || i < 0 || !isNum(value) || !isNum(tick) || !Number.isInteger(tick) || tick < 0) bad('hamlet loyalty');
    loyalty.set(i, { value, tick });
  }
  // Capture progress (capture.ts): each anchor is a parcel of the realm and appears once. The counts are non-negative; the
  // rise and fall are whole or half ticks. A save without the list loads with no capture running.
  const captures = new Map<number, Capture>();
  for (const c of snap.captures ?? []) {
    if (!isNum(c.anchor) || !Number.isInteger(c.anchor) || c.anchor < 0 || c.anchor >= parcelCount || captures.has(c.anchor)) bad(`capture of hamlet ${c.anchor}`);
    if (!isNum(c.ticks) || c.ticks < 0 || !isNum(c.defenderTicks) || !Number.isInteger(c.defenderTicks) || c.defenderTicks < 0) bad(`capture of hamlet ${c.anchor} counts`);
    captures.set(c.anchor, { ticks: c.ticks, defenderTicks: c.defenderTicks });
  }
  const hamletsConquered = snap.hamletsConquered ?? 0;
  if (!isNum(hamletsConquered) || !Number.isInteger(hamletsConquered) || hamletsConquered < 0) bad('hamlets conquered');
  const hamletsRazed = snap.hamletsRazed ?? 0;
  if (!isNum(hamletsRazed) || !Number.isInteger(hamletsRazed) || hamletsRazed < 0) bad('hamlets razed');
  states.set(sim, { dominions, relations, borders, owner: Uint8Array.from(snap.owner), truce, pacts: newPactState(), armies, intrigues, taxSeen, taxFlows, loyalty, captures, hold, conqueredAt: new Map(), hamletsConquered, hamletsRazed });
}

/** Majority owner of a hamlet's parcels (ties to the lower id), or UNOWNED. Draws no randomness. */
export function ownerOfHamlet(parcels: ReadonlySet<number>, owner: Uint8Array): number {
  const counts = new Map<number, number>();
  for (const p of parcels) {
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

/**
 * Hamlets per dominion id, for the power formula (10 section 2; opinion.ts powerOf). Each settlement counts once, for
 * the dominion that owns most of its parcels. Read from the settlements adapter; draws no randomness.
 */
export function hamletCountsOf(settlements: readonly { parcels: ReadonlySet<number> }[], owner: Uint8Array): Map<number, number> {
  const out = new Map<number, number>();
  for (const h of settlements) {
    const best = ownerOfHamlet(h.parcels, owner);
    if (best !== UNOWNED) out.set(best, (out.get(best) ?? 0) + 1);
  }
  return out;
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
    garrisoned: (id) => garrisonedSoldiers(sim, id),
    land: (p) => {
      const i = (Math.floor(p / perAxis) * PARCEL + PARCEL / 2) * sim.realm.side + ((p % perAxis) * PARCEL + PARCEL / 2);
      return ground(sim.realm.ground[i] ?? 0).layer === 'land';
    },
  };
  foundFromHamlets(sim, s, settlements, env.isOn);
  // Custom hooks (culture/effects.ts): a bigger side with peaceable or serenity does not declare war.
  foundingYear(s, settlements, {
    ...env,
    warBlocked: (id) => warBlockedBy(sim, id),
    onWarBlocked: (id) => blockedWarMood(sim, id, (p) => s.owner[p] ?? UNOWNED),
  });
  const rulerOf = rulerLookup(sim, s.dominions);
  const lens = lensOf(sim, s);
  // Hamlet counts for the power formula (10 section 2), taken once after founding so every pact and intrigue gate this
  // year reads the same counts.
  const hamletCount = hamletCountsOf(settlements, s.owner);
  pactYear(s.pacts, s.dominions, s.borders, s.relations, sim.tick, s.truce, rulerOf, lens, hamletCount);
  // Pact intrigues (intrigue.ts): last year's intrigues resolve through the pact functions, then new ones are proposed.
  const ienv: IntrigueEnv = {
    dominions: s.dominions,
    borders: s.borders,
    relations: s.relations,
    truce: s.truce,
    pacts: s.pacts,
    tick: sim.tick,
    rulerOf,
    lens,
    hamlets: hamletCount,
    split: splitHooksOf(sim, s, settlements, hamletCount),
    found: foundHooksOf(sim, s, settlements),
  };
  resolveIntrigues(ienv, s.intrigues);
  proposeIntrigues(ienv, s.intrigues);
  // Culture (11 sections 2 and 3): each dominion gets a custom once, and a scheme while none runs (culture/adapter.ts).
  cultureYearly(sim, s.dominions.map((d) => d.id));
  // Hamlet holdings (10 section 5, belonging and conquest) are stamped here, once a year. The loyalty cache reads them
  // (loyaltyStep, run by the loyalty task in stepDominions).
  trackHolds(s, settlements, sim.tick);
  // Standing armies off raises no armies (09 section 8); existing armies still sync below.
  if (sim.rules.isOn('standing_armies')) raiseArmies(s.armies, s.dominions, perAxis);
  // Captains and slots: one captain per hamlet, and the hamlet's folk, both counted by the hamlet's majority owner
  // (no hamlet data leaves one captain and no slots).
  const hamlets = new Map<number, number>();
  const folk = new Map<number, number>();
  const nextSeen = new Map<number, number>();
  const flows: TaxFlow[] = [];
  for (const h of settlements) {
    // Tax (tax.ts): the gold a hamlet gained since the last pass is its loot. The hamlet's lowest parcel names it.
    let anchor = Infinity;
    for (const p of h.parcels) anchor = Math.min(anchor, p);
    const seen = s.taxSeen.get(anchor);
    const loot = seen === undefined ? 0 : Math.max(0, h.gold - seen);
    nextSeen.set(anchor, h.gold);
    const best = ownerOfHamlet(h.parcels, s.owner);
    if (best !== UNOWNED) {
      const ruler = s.dominions.find((d) => d.id === best);
      if (ruler && loot > 0) {
        // The tax flow record (tax.ts taxFlowOf) is the one place the chain's shares are written; taxRaised takes the ruler's share.
        const flow = taxFlowOf(anchor, best, loot, taxRatesOf(ruler.traits), sim.tick);
        if (flow.toRuler > 0) ruler.taxRaised = (ruler.taxRaised ?? 0) + flow.toRuler;
        flows.push(flow);
      }
      hamlets.set(best, (hamlets.get(best) ?? 0) + 1);
      folk.set(best, (folk.get(best) ?? 0) + h.folk);
    }
  }
  s.taxSeen = nextSeen;
  s.taxFlows = flows;
  setCaptains(s.armies, hamlets);
  setSlots(s.armies, new Map([...folk].map(([id, f]) => [id, Math.floor(f / ARMY_DIVISOR)])));
  syncArmies(s.armies, s.dominions);
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
  const perAxis = parcelsPerAxis(sim);
  // Armies first take attack orders (ready armies order the nearest enemy parcel and take it on contact), then march one
  // parcel a second toward their target (armies.ts). The strength exchange needs contact.
  // Parley off stops every campaign (10 section 3), so armies neither order attacks nor march.
  // Attack orders move parcels, so they need `border_creep` (09 section 3: border-taking needs the explicit flag). With
  // HAMLET_CAPTURE on, a hamlet changes hands by capture (10 section 7) instead, so the orders do not take parcels.
  // Each dominion's army is one unit of the fault gate (17 section 9, `dominion:<id>`).
  const unit: UnitGuard = (id, run) => sim.unit('dominion', id, run);
  // Each border pair is one unit too (`border:a-b`), in dominionStep below.
  const borderUnit: UnitGuard = (id, run) => sim.unit('border', id, run);
  if (sim.rules.isOn('parley')) {
    if (sim.rules.isOn('border_creep') && !HAMLET_CAPTURE) attackOrders(s.armies, s.dominions, s.relations, owner, perAxis, unit);
    marchArmies(s.armies, s.dominions, s.relations, perAxis, unit);
    engageContacts(sim, s, perAxis);
  }
  const ctx: DominionContext = {
    rng: sim.rng('dominions'),
    tick: sim.tick,
    isOn: (id) => sim.rules.isOn(id),
    dominions: s.dominions,
    borders: s.borders,
    owner,
    pacts: s.pacts.pacts,
    armyParcel: new Map(s.armies.map((a) => [a.dominionId, a.parcel])),
    perAxis,
    onDefeat: (winnerId) => {
      addPactRenown(s.pacts, winnerId, PACT_RENOWN_PER_DEFEAT);
      armyWon(s.armies, winnerId);
    },
    // Campaign mood (culture/effects.ts, warlikeJoy). The owner map is the live one, since parcels change hands mid-step.
    onCampaign: (kind, winnerId, loserId) => campaignMood(sim, kind, winnerId, loserId, (p) => owner.get(p) ?? UNOWNED),
    borderUnit,
  };
  dominionStep(ctx, s.relations);
  syncArmies(s.armies, s.dominions);
  for (const [p, id] of owner) s.owner[p] = id;
  // Rank (rank.ts, 10 section 4): every RANK_PERIOD_TICKS, after the owner bytes are written back, the dominions are
  // ranked by power (soldiers x 2 + hamlets x 5 + 1). The hamlet counts are read from the settlements adapter.
  if (sim.tick % RANK_PERIOD_TICKS === 0) rankStep(sim, s);
  // Rulers (rulers.ts, 10 section 4): once the owner bytes are written back, the leading hamlet of each dominion is
  // read and any dead ruler is replaced (after its wait). The 'rulers' stream is taken only when a ruler dies.
  // Succession rules and install moods come from the dominion's custom (culture/effects.ts).
  rulersStep(
    {
      tick: sim.tick,
      perAxis,
      beings: sim.beings,
      hamlets: hamletsOf(sim),
      owner: s.owner,
      rng: () => sim.rng('rulers'),
      ruleOf: (id) => successionRuleOf(traitsOfGroup(sim, id)),
      onInstall: (id, slot, capital) =>
        rulerInstalled(sim, id, slot, capital.parcels, (p) => s.owner[p] ?? UNOWNED),
      unit,
    },
    s.dominions,
  );
  // Hamlet loyalty (10 section 5, loyalty.ts): the loyalty task, after the rank (the rank term), the owner write-back and the
  // rulers (the ruler term). Every LOYALTY_TASK_TICKS ticks.
  if (sim.tick % LOYALTY_TASK_TICKS === 0) loyaltyStep(sim, s);
}

/** Hamlet happiness (10 section 5, isHappy): whether the cached loyalty of the hamlet at `index` (hamletsOf order) is >= 0. Undefined before its first computation. Read only. */
export function hamletHappyOf(sim: Sim, index: number): boolean | undefined {
  const c = states.get(sim)?.loyalty.get(index);
  return c === undefined ? undefined : isHappy(c.value);
}

/**
 * Hamlet capture (10 section 7, capture.ts), every CAPTURE_STEP_TICKS ticks and after the dominion step. Needs the
 * HAMLET_CAPTURE switch and the `parley` rule (campaigns, as for the armies). Reads the settlements and the armies, and
 * writes the owner bytes and the dominions' parcel sets when a hamlet falls. Draws no randomness.
 */
export function captureTick(sim: Sim): void {
  if (!HAMLET_CAPTURE) return;
  const s = states.get(sim);
  if (!s || s.dominions.length === 0 || sim.tick % CAPTURE_STEP_TICKS !== 0) return;
  if (!sim.rules.isOn('parley')) return;
  const hamlets = hamletsOf(sim);
  const falls = captureStep({
    perAxis: parcelsPerAxis(sim),
    hamlets,
    unit: (i, run) => sim.unit('hamlet', i, run),
    owner: s.owner,
    dominions: s.dominions,
    armies: s.armies,
    relations: s.relations,
    ownerOf: (parcels) => ownerOfHamlet(parcels, s.owner),
    captures: s.captures,
    takerOf: (captor, loser, anchor) => takerOfCapture(sim, s, captor, loser, anchor, hamlets),
    isCapital: (loser, anchor) => {
      const lh = leadingHamlet(loser, hamlets, s.owner);
      return lh !== undefined && anchorOf(lh.parcels) === anchor;
    },
  });
  for (const f of falls) applyFall(sim, s, f, hamlets);
  // Raze check (10 section 7; capture.ts razeStep): every RAZE_CHECK_TICKS for every hamlet, and after a capture for the hamlet
  // that fell. Both read the settlements census (hamlet folk), so the census of the last second is what counts.
  const indices =
    sim.tick % RAZE_CHECK_TICKS === 0
      ? hamlets.map((_, i) => i)
      : falls.flatMap((f) => {
          const i = hamlets.findIndex((h) => anchorOf(h.parcels) === f.anchor);
          return i >= 0 ? [i] : [];
        });
  const razes = razeStep(
    {
      perAxis: parcelsPerAxis(sim),
      hamlets,
      owner: s.owner,
      dominions: s.dominions,
      ownerOf: (parcels) => ownerOfHamlet(parcels, s.owner),
      beingsOn: (parcels) => beingsOnParcels(sim, parcels),
      evict: (slots, anchor) => moveBeingsTo(sim, slots, anchor),
      feelRazed: (slots, capital) => razedMood(sim, slots, capital, s.conqueredAt, sim.tick),
      isCapital: (loser, anchor) => {
        const lh = leadingHamlet(loser, hamlets, s.owner);
        return lh !== undefined && anchorOf(lh.parcels) === anchor;
      },
    },
    indices,
  );
  s.hamletsRazed += razes.length;
}

/**
 * Living beings standing on the parcels, in slot order: the same beings the settlements census counts for a hamlet's folk.
 * Draws no randomness.
 */
function beingsOnParcels(sim: Sim, parcels: ReadonlySet<number>): number[] {
  const st = sim.beings.store;
  const perAxis = parcelsPerAxis(sim);
  const out: number[] = [];
  for (let k = 0; k < st.size; k++) {
    const slot = st.at(k);
    const p = Math.floor((st.y[slot] ?? 0) / PARCEL) * perAxis + Math.floor((st.x[slot] ?? 0) / PARCEL);
    if (parcels.has(p)) out.push(slot);
  }
  return out;
}

/** Moves beings to the centre of parcel `anchor`, as fleeRuler moves a ruler. Draws no randomness. */
function moveBeingsTo(sim: Sim, slots: readonly number[], anchor: number): void {
  const st = sim.beings.store;
  const perAxis = parcelsPerAxis(sim);
  const x = (anchor % perAxis) * PARCEL + PARCEL / 2;
  const y = Math.floor(anchor / perAxis) * PARCEL + PARCEL / 2;
  for (const slot of slots) {
    st.x[slot] = x;
    st.y[slot] = y;
  }
}

/** Lowest parcel of a hamlet: its key in the capture progress, the hold records and the tax loot (tax.ts). */
function anchorOf(parcels: ReadonlySet<number>): number {
  let anchor = Infinity;
  for (const p of parcels) anchor = Math.min(anchor, p);
  return anchor;
}

/**
 * Whether a hamlet is being captured: its capture progress is above 0 (capture.ts). The settlements gates read it (09
 * section 6 build tick, 09 section 9 soldier gate). Read only; draws no randomness.
 */
export function hamletCaptured(sim: Sim, parcels: ReadonlySet<number>): boolean {
  if (parcels.size === 0) return false;
  return (states.get(sim)?.captures.get(anchorOf(parcels))?.ticks ?? 0) > 0;
}

/**
 * Majority species of the living Folk standing on the parcels that `inScope` picks (ties to the lower species). undefined
 * when none stands there. Used as the lineage of a hamlet or a dominion (10 section 7). Draws no randomness.
 */
function folkSpeciesWhere(sim: Sim, inScope: (parcel: number) => boolean): number | undefined {
  const st = sim.beings.store;
  const perAxis = parcelsPerAxis(sim);
  const counts = new Map<number, number>();
  for (let k = 0; k < st.size; k++) {
    const slot = st.at(k);
    const species = st.species[slot] ?? 0;
    if (!sim.beings.species(species).folk) continue;
    const p = Math.floor((st.y[slot] ?? 0) / PARCEL) * perAxis + Math.floor((st.x[slot] ?? 0) / PARCEL);
    if (!inScope(p)) continue;
    counts.set(species, (counts.get(species) ?? 0) + 1);
  }
  return majorityOf(counts);
}

/**
 * The dominion that takes a hamlet its captor took (10 section 7, findDominionAfterCapture). In an allied campaign a captor
 * from an ally may hand the hamlet to the campaign's main party. This build reads the campaign as the captor's pact: the
 * main party is the pact's first founder, and it must be at war with the loser. The hamlet goes to it only when its lineage
 * (the species of the Folk on the hamlet) is the main party's (the species of the Folk on its parcels). Otherwise the captor
 * takes it. Reads the owner bytes before they change. Draws no randomness.
 */
function takerOfCapture(sim: Sim, s: DominionState, captor: number, loser: number, anchor: number, hamlets: ReturnType<typeof hamletsOf>): number {
  const pact = pactOf(s.pacts.pacts, captor);
  const main = pact?.founders[0];
  if (pact === undefined || main === undefined || main === captor || main === loser) return captor;
  if (s.relations.get(main, loser) !== 'war') return captor;
  const h = hamlets.find((x) => anchorOf(x.parcels) === anchor);
  if (!h) return captor;
  const lineage = folkSpeciesWhere(sim, (p) => h.parcels.has(p));
  return lineage !== undefined && lineage === folkSpeciesWhere(sim, (p) => s.owner[p] === main) ? main : captor;
}

/**
 * The side effects of a hamlet falling (10 sections 5, 7 and 10 section 2 joinAnother), after the owner bytes pass it on:
 * the holdings (belonging restarts at the fall), the taker's newConquestTick, the hamletsConquered counter, the captured
 * Folk's and the loser's moods (captureMood), and the ruler who was in the hamlet (fleeRuler). Draws only from the `rulers`
 * stream, and only when a ruler flees.
 */
function applyFall(sim: Sim, s: DominionState, f: CaptureFall, hamlets: ReturnType<typeof hamletsOf>): void {
  const i = hamlets.findIndex((h) => anchorOf(h.parcels) === f.anchor);
  const hamlet = hamlets[i];
  const taker = s.dominions.find((d) => d.id === f.winner);
  if (hamlet === undefined || taker === undefined) return;
  s.hold.set(i, { dominion: f.winner, since: sim.tick });
  taker.newConquestTick = sim.tick;
  s.hamletsConquered += 1;
  captureMood(sim, f.winner, f.loser, f.capital, hamlet.parcels, (p) => s.owner[p] ?? UNOWNED, s.conqueredAt, sim.tick);
  const loser = s.dominions.find((d) => d.id === f.loser);
  if (loser !== undefined) fleeRuler(sim, s, loser, hamlet, hamlets);
}

/**
 * The ruler of the loser flees a captured hamlet (10 section 14, 10 section 7 finishCapture). Only a ruler standing in the
 * hamlet flees. The crown is cleared, the succession wait of rulers.ts starts (randomInt(100, 400), 10 section 4), and the
 * ruler moves to the loser's leading hamlet after the fall (rulers.ts leadingHamlet), or stays when it holds none. The ruler
 * feels crown_lost (-60).
 */
function fleeRuler(sim: Sim, s: DominionState, loser: Dominion, hamlet: ReturnType<typeof hamletsOf>[number], hamlets: ReturnType<typeof hamletsOf>): void {
  const store = sim.beings.store;
  const r = rulerLive(store, loser);
  if (r === undefined) return;
  const perAxis = parcelsPerAxis(sim);
  const at = Math.floor((store.y[r.slot] ?? 0) / PARCEL) * perAxis + Math.floor((store.x[r.slot] ?? 0) / PARCEL);
  if (!hamlet.parcels.has(at)) return;
  delete loser.ruler;
  loser.rulerWaitUntil = sim.tick + RULER_WAIT_MIN + sim.rng('rulers').int(RULER_WAIT_SPAN);
  const to = leadingHamlet(loser.id, hamlets, s.owner);
  if (to !== undefined) {
    const q = anchorOf(to.parcels);
    store.x[r.slot] = (q % perAxis) * PARCEL + PARCEL / 2;
    store.y[r.slot] = Math.floor(q / perAxis) * PARCEL + PARCEL / 2;
  }
  addMood(sim, r.slot, 'crown_lost');
}

/**
 * Founding (10 section 2; the rule of founding.ts step 1): a hamlet with FOUND_FOLK folk and no dominion parcels founds
 * a dominion through addDominion, with the strength foundingYear would give it. foundingYear then sees the dominion
 * as the hamlet's owner and claims its other parcels as before. Needs rule `realm_expansion`. Draws no randomness.
 */
function foundFromHamlets(sim: Sim, s: DominionState, settlements: ReturnType<typeof hamletsOf>, isOn: (id: string) => boolean): void {
  if (!isOn('realm_expansion')) return;
  for (const h of settlements) {
    if (h.folk < FOUND_FOLK) continue;
    const parcels = [...h.parcels].sort((x, y) => x - y);
    if (parcels.some((p) => (s.owner[p] ?? UNOWNED) !== UNOWNED)) continue;
    let max = 0;
    for (const d of s.dominions) max = Math.max(max, d.id);
    if (max >= 255) return;
    addDominion(sim, max + 1, Math.floor(h.folk / ARMY_DIVISOR), parcels);
  }
}

/**
 * Army contact (10 section 8): each war border whose two armies stand on the same or adjacent parcels engages their
 * Folk (armies.ts engageArmies). Runs once per sim-second after the armies march, so contact is read from their
 * new positions. Draws no randomness.
 */
function engageContacts(sim: Sim, s: DominionState, perAxis: number): void {
  // Each border pair is one unit (17 section 9, `border:a-b`): a throw in one leaves the other pairs their contact.
  for (const [a, b] of s.borders) {
    sim.unit('border', `${a}-${b}`, () => {
      if (s.relations.get(a, b) !== 'war') return;
      const armyA = s.armies.find((x) => x.dominionId === a);
      const armyB = s.armies.find((x) => x.dominionId === b);
      if (!armyA || !armyB) return;
      const dx = Math.abs((armyA.parcel % perAxis) - (armyB.parcel % perAxis));
      const dy = Math.abs(Math.floor(armyA.parcel / perAxis) - Math.floor(armyB.parcel / perAxis));
      if (Math.max(dx, dy) > 1) return;
      engageArmies(sim, armyA, armyB, perAxis);
    });
  }
}

/**
 * Custom and strain lens for the opinion terms (opinion.ts DominionLens). A dominion's strain is the majority strain of
 * its folk on its parcels, read once per call (lazily, on the first opinion term that asks).
 */
function lensOf(sim: Sim, s: DominionState): DominionLens {
  let strains: Map<number, number> | undefined;
  return {
    traitsOf: (id) => traitsOfGroup(sim, id),
    strainOf: (id) => {
      strains ??= majorityStrains(sim, s.owner);
      return strains.get(id);
    },
  };
}

/** Majority strain of the folk on each dominion's parcels (ties to the lower strain id). Draws no randomness. */
function majorityStrains(sim: Sim, owner: Uint8Array): Map<number, number> {
  const st = sim.beings.store;
  const perAxis = parcelsPerAxis(sim);
  const counts = new Map<number, Map<number, number>>();
  for (let k = 0; k < st.size; k++) {
    const slot = st.at(k);
    if (!sim.beings.species(st.species[slot] ?? 0).folk) continue;
    const p = Math.floor((st.y[slot] ?? 0) / PARCEL) * perAxis + Math.floor((st.x[slot] ?? 0) / PARCEL);
    const dom = owner[p] ?? UNOWNED;
    if (dom === UNOWNED) continue;
    let byStrain = counts.get(dom);
    if (!byStrain) {
      byStrain = new Map();
      counts.set(dom, byStrain);
    }
    const strain = st.strain[slot] ?? 0;
    byStrain.set(strain, (byStrain.get(strain) ?? 0) + 1);
  }
  const out = new Map<number, number>();
  for (const [dom, byStrain] of counts) {
    let best = -1;
    let bestN = 0;
    for (const [strain, n] of byStrain) {
      if (n > bestN || (n === bestN && strain < best)) {
        best = strain;
        bestN = n;
      }
    }
    out.set(dom, best);
  }
  return out;
}

/**
 * Ruler stats per dominion id for the opinion terms (rulers.ts). Reads the being store; draws no randomness. The ruler is
 * a follower of its dominion, so the dominion's creed harmony tenet adds to its rapport (11 section 4.2, creed effects).
 */
function rulerLookup(sim: Sim, dominions: readonly Dominion[]): (id: number) => RulerStats | undefined {
  return (id) => {
    const d = dominions.find((x) => x.id === id);
    const stats = d ? rulerStatsOf(sim.beings.store, d) : undefined;
    if (!stats) return undefined;
    return { ...stats, diplomacy: stats.diplomacy + harmonyBonus(sim.culture, id, 'diplomacy') };
  };
}

/**
 * The opinion context of a sim's dominion state, read only: the terms the yearly pass reads (rulers, lens, hamlet counts),
 * with the hamlet counts taken from the settlements as they stand now.
 */
function opinionContextOf(sim: Sim, s: DominionState): OpinionContext {
  return {
    dominions: s.dominions,
    borders: s.borders,
    relations: s.relations,
    truce: s.truce,
    pacts: s.pacts.pacts,
    tick: sim.tick,
    rulerOf: rulerLookup(sim, s.dominions),
    lens: lensOf(sim, s),
    hamlets: hamletCountsOf(hamletsOf(sim), s.owner),
  };
}

/** One opinion value: dominion `a`'s opinion of dominion `b` (opinion.ts opinion()). */
export interface OpinionEntry {
  a: number;
  b: number;
  opinion: number;
}

/**
 * Opinion of each dominion toward each dominion it borders, in both directions (Insight ties, 12 section 8.8). Only border
 * pairs are listed: a pair with no border has no relation line to draw, and listing every pair would scale with the square
 * of the dominion count. Read only: no state is written and no randomness is drawn.
 */
export function opinionsOfSim(sim: Sim): OpinionEntry[] {
  const s = states.get(sim);
  if (!s || s.dominions.length === 0) return [];
  const ctx = opinionContextOf(sim, s);
  const seen = new Set<string>();
  const out: OpinionEntry[] = [];
  for (const [x, y] of s.borders) {
    if (x === y) continue;
    for (const [a, b] of [
      [x, y],
      [y, x],
    ] as const) {
      const key = `${a}:${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ a, b, opinion: opinion(ctx, a, b) });
    }
  }
  return out;
}

/** Pact candidates the intrigue gates allow now (intrigue.ts formPactOk, joinPactOk), for the Insight Accord Finder. */
export interface AccordCandidates {
  /** Bordering pairs [a, b] that a formPact could join now. */
  formPact: [number, number][];
  /** Pairs [dominion, pact id] where the dominion could join the pact now. */
  joinPact: [number, number][];
}

/**
 * Pact candidates the sim's own pact gates allow now (Insight Accord Finder, 12 section 8.8). Reads only. The gates are the
 * ones the yearly intrigue pass uses, so the list is what would be proposed if the pass ran now; the renown and money costs
 * are the sim's stand-ins (intrigue.ts) and are not shown here.
 */
export function accordCandidatesOf(sim: Sim): AccordCandidates {
  const out: AccordCandidates = { formPact: [], joinPact: [] };
  const s = states.get(sim);
  if (!s || s.dominions.length === 0) return out;
  const oc = opinionContextOf(sim, s);
  const env: IntrigueEnv = {
    dominions: s.dominions,
    borders: s.borders,
    relations: s.relations,
    truce: s.truce,
    pacts: s.pacts,
    tick: sim.tick,
    rulerOf: oc.rulerOf,
    lens: oc.lens,
    hamlets: oc.hamlets,
  };
  const seen = new Set<string>();
  for (const [x, y] of s.borders) {
    if (x === y) continue;
    const key = pairKey(x, y);
    if (seen.has(key)) continue;
    seen.add(key);
    if (formPactOk(env, x, y)) out.formPact.push([Math.min(x, y), Math.max(x, y)]);
  }
  for (const d of s.dominions) {
    for (const p of s.pacts.pacts) if (joinPactOk(env, d.id, p.id)) out.joinPact.push([d.id, p.id]);
  }
  return out;
}

/** Rank step (rank.ts): ranks every dominion by power and stores the rank on it; a dominion that is neither keeps none. */
function rankStep(sim: Sim, s: DominionState): void {
  const ranks = rankDominions(s.dominions, hamletCountsOf(hamletsOf(sim), s.owner));
  // Each dominion is one unit (17 section 9, `dominion:<id>`): a throw in one leaves the other ranks stored.
  for (const d of s.dominions) {
    sim.unit('dominion', d.id, () => {
      const r = ranks.get(d.id);
      if (r !== undefined) d.rank = r;
      else delete d.rank;
    });
  }
}

/**
 * A group id that no dominion and no culture record uses, taken from the top of 1..255 (0 when none is free). Split-off
 * metas hold these ids (splitHooksOf). Dominion ids are taken from the bottom up (founding.ts), so the two meet only when
 * the realm nears 255 dominions. Draws no randomness.
 */
function freeGroupId(sim: Sim, s: DominionState): number {
  const used = new Set<number>(s.dominions.map((d) => d.id));
  for (const c of sim.culture.customs) used.add(c.group);
  for (const d of sim.culture.dialects) used.add(d.group);
  for (const c of sim.culture.creeds) for (const h of c.holders) used.add(h);
  for (let id = 255; id >= 1; id--) if (!used.has(id)) return id;
  return 0;
}

/** Folk of each dominion: the Folk of the hamlets it holds by majority (the members of its custom, 11 section 3). */
function folkByDominion(s: DominionState, settlements: ReturnType<typeof hamletsOf>): Map<number, number> {
  const folk = new Map<number, number>();
  for (const h of settlements) {
    const best = ownerOfHamlet(h.parcels, s.owner);
    if (best !== UNOWNED) folk.set(best, (folk.get(best) ?? 0) + h.folk);
  }
  return folk;
}

/**
 * Culture hooks of the split intrigues (11 section 2; intrigue.ts SplitHooks). A divide reads the custom the dominion holds,
 * a schism the creed it holds, and a divergence the dialect it holds, which also needs a creed (11 section 3). The actor is
 * the dominion's ruler: its study level stands in for the hamlet leader's level, since the sim has no hamlet leader.
 * Members are the folk of the dominion's hamlets. A meta with no recorded birth or creator is refused (no known age, no
 * known founder). `apply` writes the split-off meta under a free group id (freeGroupId), then converts the actor and the
 * same-lineage units within patch radius 1 of it to that group (convertLineageUnits). Draws no randomness.
 */
function splitHooksOf(sim: Sim, s: DominionState, settlements: ReturnType<typeof hamletsOf>, hamletCount: ReadonlyMap<number, number>): SplitHooks {
  const culture = sim.culture;
  const folk = folkByDominion(s, settlements);
  const leaderLevel = (d: Dominion): number => {
    const r = rulerLive(sim.beings.store, d);
    return r ? (culture.studies?.[String(r.gen * MAX_BEINGS + r.slot)]?.level ?? 0) : 0;
  };
  const ageYears = (born: number | undefined): number => (born === undefined ? 0 : (sim.tick - born) / YEAR_TICKS);
  return {
    facts: (kind: SplitKind, d: number): SplitFacts | undefined => {
      const dom = s.dominions.find((x) => x.id === d);
      if (!dom) return undefined;
      const custom = customOfGroup(culture, d);
      const common = { members: folk.get(d) ?? 0, leaderLevel: leaderLevel(dom), dominionHamlets: hamletCount.get(d) ?? 0, sameMeta: true };
      if (kind === 'divideCustom') {
        if (!custom) return undefined;
        return { ...common, traits: custom.traits, ageYears: ageYears(custom.born), creatorDiffers: custom.creator !== undefined && custom.creator !== d };
      }
      const creed = culture.creeds.find((c) => c.holders.has(d));
      if (!creed) return undefined;
      if (kind === 'schismCreed') {
        return { ...common, traits: custom?.traits ?? [], ageYears: ageYears(creed.born), creatorDiffers: creed.creator !== undefined && creed.creator !== d };
      }
      const dialect = culture.dialects.find((x) => x.group === d);
      if (!dialect) return undefined;
      return { ...common, traits: custom?.traits ?? [], ageYears: ageYears(dialect.born), creatorDiffers: dialect.creator !== undefined && dialect.creator !== d };
    },
    apply: (kind: SplitKind, d: number): boolean => {
      const newGroup = freeGroupId(sim, s);
      if (newGroup === 0) return false;
      let made = false;
      if (kind === 'divideCustom') made = splitCustom(culture, d, newGroup, sim.tick, sim.realm.seed) !== null;
      else if (kind === 'schismCreed') {
        const creed = culture.creeds.find((c) => c.holders.has(d));
        made = creed !== undefined && splitCreed(culture, creed.id, newGroup, d, sim.tick) !== null;
      } else made = splitDialect(culture, d, newGroup, sim.tick, sim.realm.seed) !== null;
      if (made) {
        const dom = s.dominions.find((x) => x.id === d);
        const actor = dom ? rulerLive(sim.beings.store, dom) : undefined;
        if (actor) convertLineageUnits(sim, actor.slot, newGroup);
      }
      return made;
    },
  };
}

/**
 * Culture hooks of the founding intrigues (11 section 3; intrigue.ts FoundHooks). The actor is the dominion's ruler, as in
 * splitHooksOf: its study level is the level, its wit (plus the dominion's creed harmony bonus) the intelligence, and its
 * lineage the speech and memory flags. A founded dialect or creed is held by the dominion and its creator is the dominion.
 * Draws only from the culture stream.
 */
function foundHooksOf(sim: Sim, s: DominionState, settlements: ReturnType<typeof hamletsOf>): FoundHooks {
  const culture = sim.culture;
  const folk = folkByDominion(s, settlements);
  return {
    facts: (d: number): FoundFacts | undefined => {
      const dom = s.dominions.find((x) => x.id === d);
      const r = dom ? rulerLive(sim.beings.store, dom) : undefined;
      if (!r) return undefined;
      return {
        hasDialect: culture.dialects.some((x) => x.group === d),
        hasCreed: culture.creeds.some((c) => c.holders.has(d)),
        hasCustom: customOfGroup(culture, d) !== undefined,
        speech: lineageHas(sim, r.slot, 'speech_organ'),
        memory: lineageHas(sim, r.slot, 'memory_lobe'),
        members: folk.get(d) ?? 0,
        leaderLevel: culture.studies?.[String(r.gen * MAX_BEINGS + r.slot)]?.level ?? 0,
        intelligence: (sim.beings.store.attrs[r.slot * 4 + APT_WIT] ?? 0) + harmonyBonus(culture, d, 'intelligence'),
      };
    },
    apply: (kind: FoundKind, d: number): boolean => {
      if (kind === 'newDialect') return foundDialect(culture, d, sim.tick, sim.realm.seed) !== null;
      return foundCreed(culture, d, sim.tick, sim.rng('culture'), sim.rules.isOn('chaotic_minds')) !== null;
    },
  };
}

/** Whole years from `since` to `tick` (ageYears and the loyalty terms read whole years, 09 section 1). Zero before `since`. */
function wholeYears(tick: number, since: number): number {
  return Math.max(0, Math.floor((tick - since) / YEAR_TICKS));
}

/**
 * Hamlet holdings (10 section 5, belonging and conquest), read at the yearly pass before the loyalty terms. A hamlet first
 * seen with a dominion starts its belonging tick here. A change of dominion is a capture: the sim has no rebellion and no
 * voluntary join, so the dominion that takes the hamlet gets newConquestTick. A hamlet with no dominion drops its record.
 * Stamps are at the yearly pass that sees the change, not the tick it happened. Draws no randomness.
 */
function trackHolds(s: DominionState, settlements: ReturnType<typeof hamletsOf>, tick: number): void {
  settlements.forEach((h, i) => {
    const owned = ownerOfHamlet(h.parcels, s.owner);
    if (owned === UNOWNED) {
      s.hold.delete(i);
      return;
    }
    const prev = s.hold.get(i);
    if (prev?.dominion === owned) return;
    if (prev !== undefined) {
      const taker = s.dominions.find((d) => d.id === owned);
      if (taker) taker.newConquestTick = tick;
    }
    s.hold.set(i, { dominion: owned, since: tick });
  });
}

/** Majority values of the Folk on one scope (a hamlet or a dominion): the group they follow, their species and their strain. */
interface FolkMajority {
  group?: number | undefined;
  species?: number | undefined;
  strain?: number | undefined;
}

type FolkKey = 'group' | 'species' | 'strain';
const FOLK_KEYS: readonly FolkKey[] = ['group', 'species', 'strain'];
type FolkTally = Record<FolkKey, Map<number, number>>;

function addFolkTally(m: Map<number, FolkTally>, key: number, values: Record<FolkKey, number>): void {
  let t = m.get(key);
  if (!t) {
    t = { group: new Map(), species: new Map(), strain: new Map() };
    m.set(key, t);
  }
  for (const k of FOLK_KEYS) t[k].set(values[k], (t[k].get(values[k]) ?? 0) + 1);
}

/** The value with the most counts (ties to the lower value). undefined when there are none. */
function majorityOf(counts: Map<number, number>): number | undefined {
  let best: number | undefined;
  let bestN = 0;
  for (const [v, n] of counts) {
    if (best === undefined || n > bestN || (n === bestN && v < best)) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

/**
 * Majority group, species and strain of the Folk standing on each hamlet's parcels (by hamlet index) and on each
 * dominion's parcels. The group is the one a Being follows (culture/effects.ts groupOfSlot). Strain 0 (none) gives no
 * majority. Draws no randomness.
 */
function folkMajorities(sim: Sim, s: DominionState, settlements: ReturnType<typeof hamletsOf>): { hamlets: FolkMajority[]; dominions: Map<number, FolkMajority> } {
  const st = sim.beings.store;
  const perAxis = parcelsPerAxis(sim);
  const hamletOf = new Map<number, number>();
  settlements.forEach((h, i) => {
    for (const p of h.parcels) hamletOf.set(p, i);
  });
  const byHamlet = new Map<number, FolkTally>();
  const byDominion = new Map<number, FolkTally>();
  for (let k = 0; k < st.size; k++) {
    const slot = st.at(k);
    if (!sim.beings.species(st.species[slot] ?? 0).folk) continue;
    const p = Math.floor((st.y[slot] ?? 0) / PARCEL) * perAxis + Math.floor((st.x[slot] ?? 0) / PARCEL);
    const values = { group: groupOfSlot(sim, slot), species: st.species[slot] ?? 0, strain: st.strain[slot] ?? 0 };
    const hi = hamletOf.get(p);
    if (hi !== undefined) addFolkTally(byHamlet, hi, values);
    const dom = s.owner[p] ?? UNOWNED;
    if (dom !== UNOWNED) addFolkTally(byDominion, dom, values);
  }
  const majority = (t: FolkTally): FolkMajority => {
    const strain = majorityOf(t.strain);
    return { group: majorityOf(t.group), species: majorityOf(t.species), strain: strain === 0 ? undefined : strain };
  };
  return {
    hamlets: settlements.map((_h, i): FolkMajority => {
      const t = byHamlet.get(i);
      return t ? majority(t) : {};
    }),
    dominions: new Map([...byDominion].map(([id, t]): [number, FolkMajority] => [id, majority(t)])),
  };
}

/**
 * Hamlet loyalty (10 section 5), the loyalty task: every LOYALTY_TASK_TICKS ticks, each hamlet whose cache is due (loyaltyDue)
 * gets the sum of the terms the sim has (loyalty.ts hamletLoyalty), stamped with this tick. A hamlet with no dominion or no
 * capital loses its entry. The folk majorities are read once, and only when a hamlet is due. The rank is set by rankStep and
 * the rulers by rulersStep just before. The holdings are stamped by the yearly pass (trackHolds). Draws no randomness.
 */
function loyaltyStep(sim: Sim, s: DominionState): void {
  const settlements = hamletsOf(sim);
  // Work only when a held hamlet is due, or an unheld hamlet still has an entry to drop. Unheld hamlets with no entry do nothing.
  const work = settlements.some((h, i) => (ownerOfHamlet(h.parcels, s.owner) === UNOWNED ? s.loyalty.has(i) : loyaltyDue(s.loyalty.get(i), sim.tick)));
  if (!work) return;
  const store = sim.beings.store;
  const perAxis = parcelsPerAxis(sim);
  // The ruler and the leader are followers of the dominion that holds the hamlet, so its creed harmony tenets add to both.
  const skill = (slot: number, group: number): number =>
    (store.attrs[slot * 4 + APT_RAPPORT] ?? 0) +
    harmonyBonus(sim.culture, group, 'diplomacy') +
    2 * ((store.attrs[slot * 4 + APT_HUSBANDRY] ?? 0) + harmonyBonus(sim.culture, group, 'stewardship'));
  const centre = (parcels: ReadonlySet<number>): [number, number] => {
    let x = 0;
    let y = 0;
    for (const p of parcels) {
      x += (p % perAxis) * PARCEL + PARCEL / 2;
      y += Math.floor(p / perAxis) * PARCEL + PARCEL / 2;
    }
    const n = Math.max(1, parcels.size);
    return [x / n, y / n];
  };
  // Hamlet counts for the enemy and own power terms, as the rank and the pacts read them (rank.ts).
  const hamletCount = hamletCountsOf(settlements, s.owner);
  const folk = folkMajorities(sim, s, settlements);
  // Culture metas are kept per group (a dominion id): a folk's meta is the one of the group it follows.
  const customOf = (g: number): MetaBirth | undefined => customOfGroup(sim.culture, g);
  const dialectOf = (g: number): MetaBirth | undefined => sim.culture.dialects.find((d) => d.group === g);
  const creedOf = (g: number): MetaBirth | undefined => sim.culture.creeds.find((c) => c.holders.has(g));
  /** Whether the folk's meta of a group is the dominion's (same record, or the same creator and birth). undefined: the dominion has none. */
  const matchOf = (meta: (g: number) => MetaBirth | undefined, folkGroup: number | undefined, dominion: number): boolean | undefined => {
    const own = meta(dominion);
    if (folkGroup === undefined || own === undefined) return undefined;
    const theirs = meta(folkGroup);
    return theirs !== undefined && (theirs === own || sameMeta(theirs, own));
  };
  /** A live clan of a strain: one whose strain, or a strain it absorbed, is this one (clans.ts). */
  const clanOf = (strain: number): boolean => sim.clans.list.some((c) => c.mergedInto < 0 && c.extinctTick < 0 && (c.strain === strain || c.absorbed.includes(strain)));
  for (const [i, h] of settlements.entries()) {
    // Each hamlet is one unit (17 section 9, `hamlet:<index>`): a throw in one leaves the other hamlets their loyalty.
    sim.unit('hamlet', i, () => {
      const owned = ownerOfHamlet(h.parcels, s.owner);
      const dom = s.dominions.find((d) => d.id === owned);
      const capital = dom ? leadingHamlet(owned, settlements, s.owner) : undefined;
      if (!dom || !capital) {
        s.loyalty.delete(i);
        return;
      }
      if (!loyaltyDue(s.loyalty.get(i), sim.tick)) return;
      const ruler = rulerLive(store, dom);
      const leaderSlot = h.leader ?? -1;
      const isCapital = capital === h;
      const [hx, hy] = centre(h.parcels);
      const [cx, cy] = centre(capital.parcels);
      const adjacent = !isCapital && [...h.parcels].some((p) => [...capital.parcels].some((q) => Math.abs((p % perAxis) - (q % perAxis)) <= 1 && Math.abs(Math.floor(p / perAxis) - Math.floor(q / perAxis)) <= 1));
      const enemyPower = s.dominions
        .filter((d) => d.id !== owned && s.relations.get(owned, d.id) !== 'peace')
        .reduce((sum, d) => sum + powerOf(d, hamletCount), 0);
      const hamletFolk: FolkMajority = folk.hamlets[i] ?? {};
      const domainFolk: FolkMajority = folk.dominions.get(owned) ?? {};
      const rule = successionRuleOf(traitsOfGroup(sim, owned));
      const hold = s.hold.get(i);
      // Clan (10 section 5): the leader and the ruler share a strain, and a live clan holds that strain. Skipped at the capital.
      const leaderStrain = leaderSlot >= 0 ? (store.strain[leaderSlot] ?? 0) : 0;
      const rulerStrain = ruler ? (store.strain[ruler.slot] ?? 0) : 0;
      const sameStrain = !isCapital && ruler !== undefined && leaderStrain !== 0 && leaderStrain === rulerStrain;
      const facts: HamletLoyaltyFacts = {
        ruler: ruler ? skill(ruler.slot, owned) : 0,
        hamletAge: h.foundedTick !== undefined ? wholeYears(sim.tick, h.foundedTick) : undefined,
        dominionAge: dom.foundedTick !== undefined ? wholeYears(sim.tick, dom.foundedTick) : undefined,
        tenureYears: ruler && dom.rulerSinceTick !== undefined ? wholeYears(sim.tick, dom.rulerSinceTick) : undefined,
        conquestYears: dom.newConquestTick !== undefined ? wholeYears(sim.tick, dom.newConquestTick) : undefined,
        belongYears: hold !== undefined && hold.dominion === owned ? wholeYears(sim.tick, hold.since) : undefined,
        custom: matchOf(customOf, hamletFolk.group, owned),
        dialect: matchOf(dialectOf, hamletFolk.group, owned),
        creed: matchOf(creedOf, hamletFolk.group, owned),
        customTraits: traitsOfGroup(sim, owned),
        lineage: domainFolk.species !== undefined && hamletFolk.species !== undefined ? hamletFolk.species === domainFolk.species : undefined,
        strain: domainFolk.strain !== undefined && hamletFolk.strain !== undefined ? hamletFolk.strain === domainFolk.strain : undefined,
        clan: sameStrain ? clanOf(leaderStrain) : undefined,
        rulerSexMismatch: ruler && rule.sex !== undefined ? (store.female[ruler.slot] ?? 0) !== rule.sex : undefined,
        folk: h.folk,
        parcels: h.parcels.size,
        capitalFolk: capital.folk,
        capitalParcels: capital.parcels.size,
        isCapital,
        adjacentToCapital: adjacent,
        distance: isCapital ? 0 : Math.hypot(hx - cx, hy - cy),
        enemyPower,
        ownPower: powerOf(dom, hamletCount),
        rank: dom.rank,
        dominionCount: s.dominions.length,
        ...(leaderSlot >= 0 ? { leader: skill(leaderSlot, owned) } : {}),
        ...(ruler ? { rulerAge: (sim.tick - (store.born[ruler.slot] ?? 0)) / YEAR_TICKS } : {}),
      };
      s.loyalty.set(i, { value: hamletLoyalty(facts), tick: sim.tick });
    });
  }
}
