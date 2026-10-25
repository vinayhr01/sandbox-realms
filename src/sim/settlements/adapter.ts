import type { Rng } from '../../shared/rng.ts';
import { ssToTicks } from '../clock.ts';
import type { Realm } from '../realm.ts';
import type { BeingStore } from '../beings/store.ts';
import type { Sim } from '../sim.ts';
import { dominionState, UNOWNED } from '../dominions/adapter.ts';
import { FOUND_FOLK } from '../dominions/founding.ts';
import { buildable, civilTiles, createHamlet, goodFoundingParcel, hamletStep, PARCEL, SITE_PROGRESS, type BuildSite, type Hamlet, type HamletContext, type Placed } from './hamlet.ts';
import { BUILDING_BY_ID } from './catalogue.ts';
import { bazaarStep, SUPPLY_PERIOD, tradeStep } from './trade.ts';
import { desiresOf, structureStep, type Structure } from './landmarks.ts';
import { decayRoads, PATH_DECAY_RANDOM_SS, PATH_DECAY_SS, planRoads, recordRoadBases, roadTerrainOpen } from './roads.ts';
import { addMood } from '../beings/social.ts';
import { customHas, customOfGroup, type Custom } from '../culture/culture.ts';
import { CREEP_HUB_BY_ID, LANDMARK_BY_ID } from '../../content/creeps.ts';
import type { MoodEvent } from '../../content/moods.ts';
import { ground } from '../../content/grounds.ts';
import { MONTH_TICKS } from '../../shared/constants.ts';
import { terrainState, type CreepHub } from '../terrain/state.ts';
import { garrisonSoldiersOf, garrisonStep, garrisonsOf, restoreGarrisons } from './garrison-adapter.ts';
import { rulesOf } from './custom-rules.ts';
import type { GarrisonRecord, GarrisonSave } from './garrison.ts';
import { creepEffectsStep } from './creep-effects.ts';

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
/** Land a parcel needs before a claim takes it (the bar hamlet.ts expandTerritory uses). */
const CLAIM_LAND = 32;
/** Chebyshev tiles within which a Folk feels a creep hub (18e section 2). */
const HUB_MOOD_RANGE = 6;
/** Mood event per creep hub kind (18e section 2): gloom "blighted view" -3, gourd "festive sight" +2. */
const HUB_MOOD: Readonly<Record<string, MoodEvent>> = { gloom_heart: 'blighted_view', gourd_heart: 'festive_sight' };

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
  /** Landmarks and beacon pillars placed in the realm (18e section 2). */
  structures: Structure[];
  /** Base ground of road tiles (queued or laid), keyed by tile, for pathDecay (roads.ts). */
  roadBase: Map<number, number>;
  /** Tick of the next pathDecay run; null until a road record exists. */
  roadDecayNext: number | null;
}

/** Per-sim hamlet state, keyed by the host object (sim.ts has no field for it). */
const states = new WeakMap<object, SettlementState>();

/** Hamlets of a host, in placement order. Empty before the first settlementsStep. */
export function hamletsOf(host: SettlementHost): readonly Hamlet[] {
  return states.get(host)?.hamlets ?? [];
}

/** Live landmark and pillar list of a host (the array placeStructure writes to), or null before the first settlementsStep. */
export function structuresOf(host: SettlementHost): Structure[] | null {
  return states.get(host)?.structures ?? null;
}

/** Plain-data form of one hamlet, JSON-safe; buildings are kept by catalogue id (Chronicle section 16). */
export interface HamletSnapshot {
  /** `gold` is absent in saves written before the hamlet purse; those load with 0 gold. */
  /** `site` (the building under construction, with its builder progress) and `road` (the queued road tiles) are absent when empty or in older saves. */
  hamlets: { parcels: number[]; food: number; wood: number; stone: number; folk: number; buildings: { id: string; x: number; y: number }[]; growTimer: number; outcrops: number; steps: number; gold?: number; iron?: number; site?: { id: string; x: number; y: number; progress: number }; road?: number[] }[];
  /** Landmarks and beacon pillars (18e 2); absent in saves written before them. */
  structures?: { id: string; tile: number; next: number }[];
  /** Creep hubs (18e 1.1); a dead hub stores nextPulse 0. Absent in saves written before them. */
  hubs?: { tile: number; def: string; tiles: number[]; nextPulse: number; alive: boolean }[];
  /** Tile and the tick until which it may not re-spread creep (18e 1.5 acid guard); absent in older saves. */
  creepGuard?: [number, number][];
  /** Garrison records (garrison.ts): one per hamlet with a garrison, once one has been seen. Absent when none exists. */
  garrisons?: GarrisonSave[];
  /** Road decay (roads.ts): the next run tick and the base ground of each road tile. Absent until a road record exists. */
  roadDecay?: { next: number; bases: [number, number][] };
}

/** Plain copy of a host's hamlet state, or null when the state was never created (no settlementsStep yet). */
export function snapshotHamlets(host: SettlementHost): HamletSnapshot | null {
  const state = states.get(host);
  if (!state) return null;
  const terrain = terrainState(host as unknown as Sim);
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
      iron: h.iron,
      ...(h.site ? { site: { id: h.site.def.id, x: h.site.x, y: h.site.y, progress: h.site.progress } } : {}),
      ...(h.road.length > 0 ? { road: [...h.road] } : {}),
    })),
    structures: state.structures.map((s) => ({ id: s.id, tile: s.tile, next: s.next })),
    // A dead hub's pulse is Infinity, which JSON cannot hold; it is stored as 0 and restored as Infinity.
    hubs: terrain.hubs.map((h) => ({ tile: h.tile, def: h.def, tiles: [...h.tiles], nextPulse: h.alive ? h.nextPulse : 0, alive: h.alive })),
    creepGuard: [...terrain.creepGuard.entries()],
    ...(garrisonsOf(host).length > 0 ? { garrisons: garrisonsOf(host).map((r) => ({ ...r })) } : {}),
    ...(state.roadDecayNext !== null ? { roadDecay: { next: state.roadDecayNext, bases: [...state.roadBase.entries()] } } : {}),
  };
}

/** Replaces a host's hamlet state with a snapshot (Chronicle load). Unknown building ids are rejected. */
export function restoreHamlets(host: SettlementHost, snap: HamletSnapshot): void {
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (!Array.isArray(snap.hamlets)) throw new Error('hamlet state is not valid');
  // Hamlets hold disjoint parcels inside the realm, as placeHamlets guarantees.
  const perAxis = host.realm.side / PARCEL;
  const taken = new Set<number>();
  const cells = host.realm.side * host.realm.side;
  const hamlets: Hamlet[] = snap.hamlets.map((h) => {
    if (!Array.isArray(h.parcels)) throw new Error('hamlet state: parcels are not valid');
    for (const p of h.parcels) {
      if (!Number.isInteger(p) || p < 0 || p >= perAxis * perAxis || taken.has(p)) throw new Error('hamlet state: parcels are not valid');
      taken.add(p);
    }
    const gold = h.gold ?? 0;
    const iron = h.iron ?? 0;
    if (!isNum(h.food) || !isNum(h.wood) || !isNum(h.stone) || !isNum(h.folk) || !isNum(h.growTimer) || !isNum(h.outcrops) || !isNum(h.steps) || !isNum(gold) || gold < 0 || !isNum(iron) || iron < 0 || !Array.isArray(h.parcels) || !Array.isArray(h.buildings)) {
      throw new Error('hamlet state: record is not valid');
    }
    const buildings: Placed[] = h.buildings.map((b) => {
      const def = BUILDING_BY_ID.get(b.id);
      if (!def || !isNum(b.x) || !isNum(b.y)) throw new Error(`hamlet state: building ${b.id} is not valid`);
      return { def, x: b.x, y: b.y };
    });
    // The site and the road queue are optional rows: a site's def must be a catalogue building with progress in [0, SITE_PROGRESS].
    let site: BuildSite | undefined;
    if (h.site !== undefined) {
      const s = h.site;
      const def = BUILDING_BY_ID.get(s.id);
      if (!def || !isNum(s.x) || !isNum(s.y) || !isNum(s.progress) || s.progress < 0 || s.progress > SITE_PROGRESS) throw new Error(`hamlet state: site ${s.id} is not valid`);
      site = { def, x: s.x, y: s.y, progress: s.progress };
    }
    const road = h.road ?? [];
    if (!Array.isArray(road) || !road.every((t) => Number.isInteger(t) && t >= 0 && t < cells)) throw new Error('hamlet state: road queue is not valid');
    return { parcels: new Set(h.parcels), food: h.food, wood: h.wood, stone: h.stone, folk: h.folk, buildings, growTimer: h.growTimer, outcrops: h.outcrops, steps: h.steps, gold, iron, road, ...(site ? { site } : {}) };
  });
  const structures: Structure[] = (snap.structures ?? []).map((s) => {
    if (typeof s.id !== 'string' || !LANDMARK_BY_ID.has(s.id) || !isNum(s.tile) || !isNum(s.next) || s.tile < 0 || s.tile >= cells) {
      throw new Error('hamlet state: structure is not valid');
    }
    return { id: s.id, tile: s.tile, next: s.next };
  });
  const hubs: CreepHub[] = (snap.hubs ?? []).map((h) => {
    if (typeof h.def !== 'string' || !CREEP_HUB_BY_ID.has(h.def) || !isNum(h.tile) || !isNum(h.nextPulse) || typeof h.alive !== 'boolean' || !Array.isArray(h.tiles)) {
      throw new Error('hamlet state: creep hub is not valid');
    }
    if (!h.tiles.every((t) => isNum(t))) throw new Error('hamlet state: creep hub tiles are not valid');
    return { tile: h.tile, def: h.def, tiles: new Set(h.tiles), nextPulse: h.alive ? h.nextPulse : Number.POSITIVE_INFINITY, alive: h.alive };
  });
  const guard = new Map<number, number>();
  for (const pair of snap.creepGuard ?? []) {
    if (!Array.isArray(pair) || pair.length !== 2 || !isNum(pair[0]) || !isNum(pair[1])) throw new Error('hamlet state: creep guard is not valid');
    guard.set(pair[0], pair[1]);
  }
  const terrain = terrainState(host as unknown as Sim);
  terrain.hubs = hubs;
  terrain.creepGuard = guard;
  restoreGarrisons(host, snap.garrisons ?? [], hamlets.length);
  // Road decay (roads.ts): the base ground of each road tile is a tile in the realm and a ground id; absent in older saves.
  const roadBase = new Map<number, number>();
  let roadDecayNext: number | null = null;
  if (snap.roadDecay !== undefined) {
    const rd = snap.roadDecay;
    if (!isNum(rd.next) || !Array.isArray(rd.bases)) throw new Error('hamlet state: road decay is not valid');
    for (const pair of rd.bases) {
      if (!Array.isArray(pair) || pair.length !== 2 || !Number.isInteger(pair[0]) || pair[0] < 0 || pair[0] >= cells) throw new Error('hamlet state: road decay is not valid');
      if (!Number.isInteger(pair[1]) || pair[1] < 0 || pair[1] > 255) throw new Error('hamlet state: road decay is not valid');
      roadBase.set(pair[0], pair[1]);
    }
    roadDecayNext = rd.next;
  }
  states.set(host, { hamlets, structures, roadBase, roadDecayNext });
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
    state = { hamlets: [], structures: [], roadBase: new Map(), roadDecayNext: null };
    states.set(host, state);
    placeHamlets(host, state);
  }
  if (host.tick % SECOND !== 0) return;
  foundHamlets(host, state);
  hubMood(host);
  // Creep effects on Beings standing on creep (18e 1.4), once per sim-second (every 20 ticks).
  creepEffectsStep(host as unknown as Sim);
  // Before the hamlet step lays queued roads, note each queued tile's base ground (roads.ts recordRoadBases).
  recordRoadBases(host.realm, state.hamlets.map((h) => h.road), state.roadBase);
  const ctx = contextOf(host);
  for (const h of state.hamlets) {
    h.folk = census(host, h);
    // Another hamlet owning a parcel blocks this hamlet from expanding into it.
    const custom = customOf(host, h);
    const own: HamletContext = {
      ...ctx,
      claimed: (q) => state.hamlets.some((o) => o !== h && o.parcels.has(q)),
      desires: desiresOf(state.structures, h, host.realm.side),
      rules: rulesOf(custom?.traits ?? [], host.realm.seed),
      garrisoned: garrisonSoldiersOf(host, state.hamlets.indexOf(h)),
    };
    const parcelsBefore = custom && customHas(custom, 'outwardGrowth') ? new Set(h.parcels) : null;
    const buildingsBefore = h.buildings.length;
    hamletStep(own, h);
    if (parcelsBefore) outwardClaim(host, state, h, parcelsBefore);
    if (custom && customHas(custom, 'roadworks') && h.buildings.length > buildingsBefore) layRoads(host, state, h);
    bazaarStep(h, host.tick);
  }
  roadDecayStep(host, state);
  // Garrisons (09 section 8, 10 section 8): soldiers are drawn from the owner's dominion strength. The owner is read only
  // once a dominion exists (dominionState creates the state on first use).
  garrisonStep(
    host as unknown as Sim,
    state.hamlets,
    (h) => majorityOwner(dominionState(host as unknown as Sim).owner, h),
    (h) => rulesOf(customOf(host, h)?.traits ?? []).levy,
  );
  // Landmarks and beacon pillars (18e 2) pulse on their own timers. The effects act on the realm through the
  // terrain modules, which take the Sim; the host is the Sim at runtime (sim.ts passes itself).
  structureStep(host as unknown as Sim, state.structures);
  // Supply round (09 10.4). Dominion owner bytes are read only on a supply tick, and only once a hamlet
  // can found a dominion: dominionState creates the dominion state on first use.
  if (host.tick % SUPPLY_PERIOD === 0 && state.hamlets.some((h) => h.folk >= FOUND_FOLK)) {
    const owner = dominionState(host as unknown as Sim).owner;
    tradeStep(state.hamlets, (h) => majorityOwner(owner, h), host.tick);
  }
}

/**
 * The custom of a hamlet (11 section 4.1): the custom of the dominion holding most of its parcels. Undefined when no
 * custom exists yet or the hamlet is in no dominion. Reads the dominion state only when customs exist.
 */
export function customOf(host: SettlementHost, h: Hamlet): Custom | undefined {
  const sim = host as unknown as Sim;
  if (sim.culture.customs.length === 0) return undefined;
  const dom = majorityOwner(dominionState(sim).owner, h);
  return dom === UNOWNED ? undefined : customOfGroup(sim.culture, dom);
}

/** Land tiles of a parcel. */
function parcelLand(realm: Realm, q: number): number {
  const side = realm.side;
  const perAxis = side / PARCEL;
  let land = 0;
  for (let y = 0; y < PARCEL; y++) {
    for (let x = 0; x < PARCEL; x++) {
      const i = (Math.floor(q / perAxis) * PARCEL + y) * side + (q % perAxis) * PARCEL + x;
      if (ground(realm.ground[i] ?? 0).layer === 'land') land++;
    }
  }
  return land;
}

/** Region (land component) of a parcel's centre tile; 0 for water. */
function parcelRegion(realm: Realm, q: number): number {
  const side = realm.side;
  const perAxis = side / PARCEL;
  return realm.region[(Math.floor(q / perAxis) * PARCEL + PARCEL / 2) * side + (q % perAxis) * PARCEL + PARCEL / 2] ?? 0;
}

/**
 * outwardGrowth (11 section 9.1, 09 section 3): a claim also takes the free neighbour parcels of the parcels it added,
 * when they are on the same island and hold the land bar. Parcels another hamlet owns are never taken.
 */
function outwardClaim(host: SettlementHost, state: SettlementState, h: Hamlet, before: ReadonlySet<number>): void {
  const perAxis = host.realm.side / PARCEL;
  const fresh = [...h.parcels].filter((p) => !before.has(p));
  for (const p of fresh) {
    const px = p % perAxis;
    const py = Math.floor(p / perAxis);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = px + dx;
      const ny = py + dy;
      if (nx < 0 || ny < 0 || nx >= perAxis || ny >= perAxis) continue;
      const q = ny * perAxis + nx;
      if (h.parcels.has(q) || state.hamlets.some((o) => o !== h && o.parcels.has(q))) continue;
      const sameIsland = parcelRegion(host.realm, q) !== 0 && parcelRegion(host.realm, q) === parcelRegion(host.realm, p);
      if (sameIsland && parcelLand(host.realm, q) >= CLAIM_LAND) h.parcels.add(q);
    }
  }
}

/**
 * roadworks (11 section 9.1, 09 section 11.3): a roadTo building the hamlet has just finished is joined to its nearest
 * roadTo buildings by road (roads.ts). The road is queued on the hamlet for a roadwright, and planned only while the queue
 * is empty. Roads avoid buildings and sites of every hamlet and parcels other hamlets own.
 */
function layRoads(host: SettlementHost, state: SettlementState, h: Hamlet): void {
  if (h.road.length > 0) return;
  const newest = h.buildings[h.buildings.length - 1];
  if (!newest) return;
  const side = host.realm.side;
  const perAxis = side / PARCEL;
  const occupied = civilTiles(state.hamlets, side);
  const open = (i: number): boolean => {
    if (occupied.has(i) || !roadTerrainOpen(host.realm, i)) return false;
    const p = Math.floor(Math.floor(i / side) / PARCEL) * perAxis + Math.floor((i % side) / PARCEL);
    return !state.hamlets.some((o) => o !== h && o.parcels.has(p));
  };
  h.road.push(...planRoads(host.realm, h.buildings, newest, open));
}

/**
 * pathDecay (02 section 7): wayworn roads outside any Custom's hamlet territory revert to their base ground, one run per
 * 1 + 0..1 sim-seconds. The timer runs only while road records exist, so a realm with no roads draws nothing from the
 * 'roadDecay' stream. The run's jitter is drawn after the decay draws.
 */
function roadDecayStep(host: SettlementHost, state: SettlementState): void {
  if (state.roadBase.size === 0) return;
  if (state.roadDecayNext === null) state.roadDecayNext = host.tick + ssToTicks(PATH_DECAY_SS);
  if (host.tick < state.roadDecayNext) return;
  const side = host.realm.side;
  const perAxis = side / PARCEL;
  // Parcels of hamlets that hold a Custom are shielded (02 section 7: outside any Custom's hamlet territory).
  const sheltered = new Set<number>();
  for (const h of state.hamlets) {
    if (customOf(host, h) === undefined) continue;
    for (const p of h.parcels) sheltered.add(p);
  }
  const shielded = (i: number): boolean => sheltered.has(Math.floor(Math.floor(i / side) / PARCEL) * perAxis + Math.floor((i % side) / PARCEL));
  const rng = host.rng('roadDecay');
  decayRoads(host.realm, state.roadBase, shielded, rng);
  state.roadDecayNext = host.tick + ssToTicks(PATH_DECAY_SS) + rng.int(ssToTicks(PATH_DECAY_RANDOM_SS) + 1);
}

/**
 * Creep hub mood (18e section 2, 09 section 9): a Folk within HUB_MOOD_RANGE tiles of a living gloom or gourd heart feels
 * its event once per Month, one event per kind. Only Folk feel it. Runs on the Month tick, so each Folk gets one event
 * per Month without a timer of its own.
 */
function hubMood(host: SettlementHost): void {
  if (host.tick % MONTH_TICKS !== 0) return;
  const sim = host as unknown as Sim;
  const hubs = terrainState(sim).hubs.filter((h) => h.alive && HUB_MOOD[h.def] !== undefined);
  if (hubs.length === 0) return;
  const s = host.beings.store;
  const side = host.realm.side;
  for (let k = 0; k < s.size; k++) {
    const slot = s.at(k);
    if (!host.beings.species(s.species[slot] ?? 0).folk) continue;
    const x = s.x[slot] ?? 0;
    const y = s.y[slot] ?? 0;
    const events = new Set<MoodEvent>();
    for (const hub of hubs) {
      const event = HUB_MOOD[hub.def];
      if (event === undefined) continue;
      const hx = hub.tile % side;
      const hy = Math.floor(hub.tile / side);
      if (Math.max(Math.abs(hx - x), Math.abs(hy - y)) <= HUB_MOOD_RANGE) events.add(event);
    }
    for (const event of events) addMood(sim, slot, event);
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
