import type { Sim } from '../sim.ts';
import { PARCEL } from '../settlements/hamlet.ts';
import { hamletsOf } from '../settlements/adapter.ts';
import { garrisonedSoldiers } from '../settlements/garrison-adapter.ts';
import { SS_TICKS } from '../clock.ts';
import { YEAR_TICKS } from '../../shared/constants.ts';
import { dominionStep } from './step.ts';
import { ground } from '../../content/grounds.ts';
import { ARMY_DIVISOR, FOUND_FOLK, foundingYear, type FoundingEnv, type Truce } from './founding.ts';
import { pairKey, RelationMatrix, type Dominion, type DominionContext, type Relation } from './types.ts';
import { addPactRenown, forcePact as forcePactRecord, makePact, newPactState, pactOf, pactYear, PACT_RENOWN_PER_DEFEAT, type Pact, type PactState } from './pacts.ts';
import { armyWon, attackOrders, centroidParcel, marchArmies, raiseArmies, setCaptains, setSlots, syncArmies, type Army } from './armies.ts';
import { newIntrigueState, proposeIntrigues, resolveIntrigues, type Intrigue, type IntrigueEnv, type IntrigueState } from './intrigue.ts';
import { taxRatesOf, taxSplit } from './tax.ts';
import { rulersStep, rulerStatsOf, type RulerRef, type RulerStats } from './rulers.ts';
import { cultureYearly } from '../culture/adapter.ts';

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
    };
    states.set(sim, s);
  }
  return s;
}

/** Pact records of a sim, read only: empty when the dominion state was never created. */
export function pactsOfSim(sim: Sim): readonly Pact[] {
  return states.get(sim)?.pacts.pacts ?? [];
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
  /** `traits` and `taxRaised` are optional: written only when set, so older saves and untaxed dominions keep their shape. */
  /** `ruler` and `rulerWaitUntil` are optional too: written only while a ruler is held or a succession wait runs (rulers.ts). */
  dominions: { id: number; parcels: number[]; strength: number; target: number; campaignSince: number; traits?: string[]; taxRaised?: number; ruler?: RulerRef; rulerWaitUntil?: number }[];
  /** Hamlet gold at the last yearly pass by the hamlet's lowest parcel (tax.ts loot). Optional: written only when present. */
  taxSeen?: [number, number][];
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
    })),
    ...(s.taxSeen.size > 0 ? { taxSeen: [...s.taxSeen] } : {}),
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
      const kinds = ['formPact', 'joinPact', 'dissolvePact'];
      if (!isNum(i.id) || !isNum(i.dominionId) || !isNum(i.targetId) || !isNum(i.startedTick) || !kinds.includes(i.kind) || !dominions.some((d) => d.id === i.dominionId)) bad(`intrigue ${i.id}`);
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
  states.set(sim, { dominions, relations, borders, owner: Uint8Array.from(snap.owner), truce, pacts: newPactState(), armies, intrigues, taxSeen });
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
  foundingYear(s, settlements, env);
  const rulerOf = rulerLookup(sim, s.dominions);
  pactYear(s.pacts, s.dominions, s.borders, s.relations, sim.tick, s.truce, rulerOf);
  // Pact intrigues (intrigue.ts): last year's intrigues resolve through the pact functions, then new ones are proposed.
  const ienv: IntrigueEnv = { dominions: s.dominions, borders: s.borders, relations: s.relations, truce: s.truce, pacts: s.pacts, tick: sim.tick, rulerOf };
  resolveIntrigues(ienv, s.intrigues);
  proposeIntrigues(ienv, s.intrigues);
  // Culture (11 sections 2 and 3): each dominion gets a custom once, and a scheme while none runs (culture/adapter.ts).
  cultureYearly(sim, s.dominions.map((d) => d.id));
  // Standing armies off raises no armies (09 section 8); existing armies still sync below.
  if (sim.rules.isOn('standing_armies')) raiseArmies(s.armies, s.dominions, perAxis);
  // Captains and slots: one captain per hamlet, and the hamlet's folk, both counted by the hamlet's majority owner
  // (no hamlet data leaves one captain and no slots).
  const hamlets = new Map<number, number>();
  const folk = new Map<number, number>();
  const nextSeen = new Map<number, number>();
  for (const h of settlements) {
    // Tax (tax.ts): the gold a hamlet gained since the last pass is its loot. The hamlet's lowest parcel names it.
    let anchor = Infinity;
    for (const p of h.parcels) anchor = Math.min(anchor, p);
    const seen = s.taxSeen.get(anchor);
    const loot = seen === undefined ? 0 : Math.max(0, h.gold - seen);
    nextSeen.set(anchor, h.gold);
    const counts = new Map<number, number>();
    for (const p of h.parcels) {
      const o = s.owner[p] ?? UNOWNED;
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
    if (best !== UNOWNED) {
      const ruler = s.dominions.find((d) => d.id === best);
      if (ruler && loot > 0) {
        const rates = taxRatesOf(ruler.traits);
        const split = taxSplit(loot, rates.local, rates.tribute);
        if (split.toRuler > 0) ruler.taxRaised = (ruler.taxRaised ?? 0) + split.toRuler;
      }
      hamlets.set(best, (hamlets.get(best) ?? 0) + 1);
      folk.set(best, (folk.get(best) ?? 0) + h.folk);
    }
  }
  s.taxSeen = nextSeen;
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
  // Attack orders move parcels, so they also need `border_creep` (09 section 3: border-taking needs the explicit flag).
  if (sim.rules.isOn('parley')) {
    if (sim.rules.isOn('border_creep')) attackOrders(s.armies, s.dominions, s.relations, owner, perAxis);
    marchArmies(s.armies, s.dominions, s.relations, perAxis);
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
  };
  dominionStep(ctx, s.relations);
  syncArmies(s.armies, s.dominions);
  for (const [p, id] of owner) s.owner[p] = id;
  // Rulers (rulers.ts, 10 section 4): once the owner bytes are written back, the leading hamlet of each dominion is
  // read and any dead ruler is replaced (after its wait). The 'rulers' stream is taken only when a ruler dies.
  rulersStep(
    { tick: sim.tick, perAxis, beings: sim.beings, hamlets: hamletsOf(sim), owner: s.owner, rng: () => sim.rng('rulers') },
    s.dominions,
  );
}

/** Ruler stats per dominion id for the opinion terms (rulers.ts). Reads the being store; draws no randomness. */
function rulerLookup(sim: Sim, dominions: readonly Dominion[]): (id: number) => RulerStats | undefined {
  return (id) => {
    const d = dominions.find((x) => x.id === id);
    return d ? rulerStatsOf(sim.beings.store, d) : undefined;
  };
}
