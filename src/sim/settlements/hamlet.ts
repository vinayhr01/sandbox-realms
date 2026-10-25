import { G, ground } from '../../content/grounds.ts';
import { PARCEL } from '../../shared/constants.ts';
import type { Rng } from '../../shared/rng.ts';
import type { Realm } from '../realm.ts';
import { BUILDING_BY_ID, type BuildingDef } from './catalogue.ts';
import {
  assignJobs,
  CLEAN_COINS,
  DEPOSIT_YIELD,
  FIELD_COINS,
  FIELD_MAX,
  GRAIN_FOOD,
  HERB_FOOD,
  HONEY_FOOD,
  jobOrder,
  MINER_COIN_STEPS,
  ROAD_COINS,
  workMultiplier,
  type JobTargetCounts,
  type Workforce,
  type WorkerJob,
} from './jobs.ts';
import { FLORA, floraCode, cropRipe, fertiliseCrop, harvestCrop, hiveReady, makeRuin, pickManure, plantCrop, takeHoney, till, tillable } from '../flora.ts';
import { BASE_RULES, centreOf, housesMax, lotOk, narrow, zoneOk, ZONE_HOUSING, ZONE_PARCELS, type CustomRules } from './custom-rules.ts';
import { roadTerrainOpen } from './roads.ts';
import { dockPool } from '../boats/docks.ts';

/** Parcels are 8x8 tiles (01 section 2). Defined once in shared constants; re-exported here for existing importers. */
export { PARCEL };

export interface Placed {
  def: BuildingDef;
  x: number;
  y: number;
}

export interface Hamlet {
  /** Parcel indices (py * parcelsPerAxis + px) owned by the hamlet. */
  parcels: Set<number>;
  food: number;
  wood: number;
  stone: number;
  folk: number;
  buildings: Placed[];
  /** Ticks until the next growth check. */
  growTimer: number;
  /** Stone left in the outcrops quarries work (09 section 8; regrows slowly). */
  outcrops: number;
  /** Growth steps taken, used for outcrop regrowth and miner coins. */
  steps: number;
  /** Hamlet gold: the purse that building costs and gear coins are paid from (09 section 10.5). */
  gold: number;
  /** Hamlet iron: the store a transport boat (10 section 13: iron 2) is paid from, fed by iron deposits and mines. Starts at 0. */
  iron: number;
  /** The building under construction (09 section 6): paid for when placed, finished when its progress reaches SITE_PROGRESS. */
  site?: BuildSite;
  /** Road tiles queued for the roadwright, in the order they are laid (09 section 11.3). Saved in the hamlet snapshot. */
  road: number[];
  /**
   * The hamlet leader (09 section 8): the Being slot of the oldest adult Folk standing in the hamlet, or -1 for none. Set
   * each sim-second from the census (adapter.ts), before the hamlet step and the garrison pass that read it. Derived, not saved.
   */
  leader?: number;
}

/** A building under construction: its def and origin, and the builder progress so far (09 section 6 progressNeeded). */
export interface BuildSite {
  def: BuildingDef;
  x: number;
  y: number;
  progress: number;
}

/** Progress a site needs before it is finished (09 section 6 default 50; TUNE: one value for every def). */
export const SITE_PROGRESS = 50;
/** Coins a builder earns when a site finishes (09 section 8). The sim has no builder beings, so the coins go to the hamlet gold (TUNE). */
export const BUILDER_COINS = 6;
/** Garrison build gates (09 section 6 order: pop 50, bldg 16, parcels 20). */
export const GARRISON_FOLK = 50;
export const GARRISON_BUILDINGS = 16;
export const GARRISON_PARCELS = 20;

/** Structural context: the hamlet step needs no Sim import. */
export interface HamletContext {
  realm: Realm;
  rng: Rng;
  tick: number;
  /** Realm Rule lookup (rules.isOn). */
  isOn(id: string): boolean;
  /** True when another hamlet already owns the parcel; expansion must not take it. */
  claimed?: (parcel: number) => boolean;
  /** Build ids this hamlet is drawn to by nearby beacon pillars (18e 2.3), derived each second, never saved. */
  desires?: readonly string[];
  /** Custom building rules (custom-rules.ts), derived each second from the hamlet's custom, never saved. Absent: the base rules. */
  rules?: CustomRules;
  /** Soldier slots the garrison rule allows (garrison-adapter.ts hamletSoldierLimit), read when the round is built, never saved. */
  soldierLimit?: () => number;
  /** Adults, children, ruler and child-labour rule of the hamlet's folk (adapter census), read each second, never saved. Absent: all folk are adults. */
  workforce?: Workforce;
}

/** Folk at which a hamlet is a town (09 section 2 size tier, TOWN_POP; TUNE). A label: build orders gate on pop directly. */
export const TOWN_POP = 40;

/** Size tier of a hamlet (09 section 2): `town` from TOWN_POP folk, else `hamlet`. Derived, never saved. */
export function tierOf(h: Hamlet): 'hamlet' | 'town' {
  return h.folk >= TOWN_POP ? 'town' : 'hamlet';
}

/**
 * Tile indices covered by the civil buildings of the given hamlets (09 section 6 footprints), for rules that keep
 * other things off built ground (creep, 18e 1.3 rule 3). Derived from the buildings; nothing is stored.
 */
export function civilTiles(hamlets: readonly Hamlet[], side: number): Set<number> {
  const tiles = new Set<number>();
  for (const h of hamlets) for (const t of hamletTiles(h, side)) tiles.add(t);
  return tiles;
}

/** Tile indices covered by a hamlet's finished buildings and by its site, if it has one. Derived; nothing is stored. */
export function hamletTiles(h: Hamlet, side: number): Set<number> {
  const tiles = new Set<number>();
  const add = (def: BuildingDef, x: number, y: number): void => {
    for (let dy = 0; dy < heightOf(def); dy++) for (let dx = 0; dx < def.footprint; dx++) tiles.add((y + dy) * side + x + dx);
  };
  for (const b of h.buildings) add(b.def, b.x, b.y);
  if (h.site) add(h.site.def, h.site.x, h.site.y);
  return tiles;
}

/** Share of a parcel's tiles that must be land for it to take a founding (09 section 2, rule 1; TUNE, relaxed from 100%). */
export const FOUNDING_LAND = 0.9;

/**
 * True when parcel `p` is a good founding site (09 section 2): at least FOUNDING_LAND of its tiles are land,
 * and neither it nor any of its 8 neighbour parcels is owned by a hamlet (`owned` holds every hamlet parcel).
 */
export function goodFoundingParcel(realm: HamletContext['realm'], p: number, owned: ReadonlySet<number>): boolean {
  const side = realm.side;
  const perAxis = side / PARCEL;
  const px = p % perAxis;
  const py = Math.floor(p / perAxis);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = px + dx;
      const ny = py + dy;
      if (nx < 0 || ny < 0 || nx >= perAxis || ny >= perAxis) continue;
      if (owned.has(ny * perAxis + nx)) return false;
    }
  }
  let land = 0;
  for (let y = 0; y < PARCEL; y++) {
    for (let x = 0; x < PARCEL; x++) {
      const i = (py * PARCEL + y) * side + px * PARCEL + x;
      if (ground(realm.ground[i] ?? 0).layer === 'land') land++;
    }
  }
  return land >= FOUNDING_LAND * PARCEL * PARCEL;
}

/** Food the hamlet store holds before any granary is built (matches the starting stock). */
export const BASE_FOOD_STORE = 200;

/** Outcrop stock a new hamlet starts with, and the cap regrowth fills back to (TUNE). */
export const OUTCROP_START = 40;
export const OUTCROP_CAP = 60;
/** Growth steps between one unit of outcrop regrowth (TUNE). */
export const OUTCROP_REGROW_STEPS = 5;

/** Housing slots that count as a house for the "houses under four" rule (the 09 house tiers). */
const HOUSE_TIERS = ['dwelling_6', 'dwelling_5', 'dwelling_4', 'dwelling_3', 'dwelling_2', 'dwelling_1', 'lean_to'] as const;
/** Mood: slots filled by folk score per unit of housing comfort, homeless folk score against it (TUNE). */
const HOUSING_MOOD_PER_POINT = 3;
const HOMELESS_MOOD = 30;
/** Mood cap on the buildings' own bonuses (TUNE). */
const MOOD_BUILDING_CAP = 30;

export function createHamlet(parcelIndex: number, folk: number): Hamlet {
  // Gold starts at 0: the spec gives no starting gold for a hamlet (10.1 lists deposits, tax, trade and loot only).
  return { parcels: new Set([parcelIndex]), food: BASE_FOOD_STORE, wood: 60, stone: 30, folk, buildings: [], growTimer: 0, outcrops: OUTCROP_START, steps: 0, gold: 0, iron: 0, road: [] };
}

/** Food capacity of the store: the base store plus the capacity each granary adds. */
export function foodCapacity(h: Hamlet): number {
  return BASE_FOOD_STORE + h.buildings.reduce((s, b) => s + (b.def.id === 'granary' ? b.def.foodCapacity : 0), 0);
}

/** Depth of a building in tiles (square when the def has no height). */
function heightOf(def: BuildingDef): number {
  return def.height ?? def.footprint;
}

/** True when a tile can carry a building: land (not water, molten, slime or blocked), no flora, not a road, free of other buildings. */
export function buildable(ctx: HamletContext, x: number, y: number, h: Hamlet): boolean {
  const side = ctx.realm.side;
  if (x < 0 || y < 0 || x >= side || y >= side) return false;
  const i = y * side + x;
  const kind = ground(ctx.realm.ground[i] ?? 0);
  if (kind.layer !== 'land' || kind.damages > 0) return false;
  if ((ctx.realm.flora[i] ?? 0) !== 0) return false;
  // Road tiles (roads.ts sets them to wayworn) stay open for roads, not buildings. Queued road tiles are kept free too.
  if (ctx.realm.ground[i] === G.wayworn || h.road.includes(i)) return false;
  const p = Math.floor(y / PARCEL) * (side / PARCEL) + Math.floor(x / PARCEL);
  if (!h.parcels.has(p)) return false;
  for (const b of h.buildings) {
    if (x >= b.x && y >= b.y && x < b.x + b.def.footprint && y < b.y + heightOf(b.def)) return false;
    if (x === b.x && y === b.y) return false;
  }
  const s = h.site;
  if (s && x >= s.x && y >= s.y && x < s.x + s.def.footprint && y < s.y + heightOf(s.def)) return false;
  return true;
}

/**
 * Places a building of `def` on the hamlet's parcels (09 section 6 placement, custom-driven). Every valid anchor tile is
 * a candidate. A lot rule (custom-rules.ts) and a zone plan (once the hamlet is large enough) narrow the candidates when
 * any of them passes. Then the first candidate is taken (scatteredBuild), or else the candidate nearest the hamlet centre.
 * A wobble lot draws one roll from the settlements stream, whether or not a tile is found.
 * The cost is paid now and the building becomes the hamlet's site (09 section 6 step 5): builders finish it over the
 * following steps. A hamlet holds one site at a time, so a call with a site open places nothing.
 */
export function placeBuilding(ctx: HamletContext, h: Hamlet, def: BuildingDef): boolean {
  if (h.site) return false;
  if (h.wood < def.wood || h.stone < def.stone || h.gold < (def.gold ?? 0) || h.iron < (def.iron ?? 0)) return false;
  // Docks are sited on the shore, not on land (09 section 6 fishers_pier and harbor).
  if (def.id === 'fishers_pier') return placePier(ctx, h, def);
  if (def.id === 'harbor') return upgradePier(ctx, h, def);
  const rules = ctx.rules ?? BASE_RULES;
  const side = ctx.realm.side;
  const ordered = [...h.parcels].sort((a, b) => a - b);
  const perAxis = side / PARCEL;
  const depth = heightOf(def);
  const shift = rules.lot === 'wobble' && ctx.rng.next() < 0.6;
  const spots: { x: number; y: number }[] = [];
  for (const p of ordered) {
    const px = (p % perAxis) * PARCEL;
    const py = Math.floor(p / perAxis) * PARCEL;
    for (let y = py; y <= py + PARCEL - depth; y++) {
      for (let x = px; x <= px + PARCEL - def.footprint; x++) {
        let ok = true;
        for (let dy = 0; dy < depth && ok; dy++) {
          for (let dx = 0; dx < def.footprint && ok; dx++) {
            ok = buildable(ctx, x + dx, y + dy, h);
          }
        }
        if (ok) spots.push({ x, y });
      }
    }
  }
  if (spots.length === 0) return false;
  const centre = centreOf(h.parcels, perAxis);
  let pool: readonly { x: number; y: number }[] = spots;
  const lot = rules.lot;
  if (lot !== undefined) pool = narrow(pool, (s) => lotOk(lot, s.x, s.y, shift));
  const zone = rules.zone;
  const zoned = housingSlots(h) >= ZONE_HOUSING || h.parcels.size >= ZONE_PARCELS;
  if (zone !== undefined && zoned) {
    pool = narrow(pool, (s) => zoneOk(zone, Math.floor(s.x / PARCEL), Math.floor(s.y / PARCEL), centre.px, centre.py, rules.worldSeed));
  }
  let pick = pool[0];
  if (pick === undefined) return false;
  if (!rules.scattered) {
    let bestD = Number.POSITIVE_INFINITY;
    for (const s of pool) {
      const d = (s.x - centre.tx) * (s.x - centre.tx) + (s.y - centre.ty) * (s.y - centre.ty);
      if (d < bestD) {
        bestD = d;
        pick = s;
      }
    }
  }
  h.wood -= def.wood;
  h.stone -= def.stone;
  h.gold -= def.gold ?? 0;
  h.iron -= def.iron ?? 0;
  h.site = { def, x: pick.x, y: pick.y, progress: 0 };
  return true;
}

/**
 * True when tile (x, y) may hold part of a dock: inside a parcel the hamlet owns, land or water (not blocked or damaging),
 * no flora, not a road tile or queued road, and not under another building or the site. `ignore` is a building whose
 * tiles do not count (the pier a harbor replaces). Reads only.
 */
function dockTileOk(ctx: HamletContext, h: Hamlet, x: number, y: number, ignore?: Placed): boolean {
  const side = ctx.realm.side;
  if (x < 0 || y < 0 || x >= side || y >= side) return false;
  const i = y * side + x;
  const kind = ground(ctx.realm.ground[i] ?? 0);
  if ((kind.layer !== 'land' && kind.layer !== 'water') || kind.damages > 0) return false;
  if ((ctx.realm.flora[i] ?? 0) !== 0) return false;
  if (ctx.realm.ground[i] === G.wayworn || h.road.includes(i)) return false;
  const p = Math.floor(y / PARCEL) * (side / PARCEL) + Math.floor(x / PARCEL);
  if (!h.parcels.has(p)) return false;
  for (const b of h.buildings) {
    if (b === ignore) continue;
    if (x >= b.x && y >= b.y && x < b.x + b.def.footprint && y < b.y + heightOf(b.def)) return false;
  }
  const s = h.site;
  if (s && x >= s.x && y >= s.y && x < s.x + s.def.footprint && y < s.y + heightOf(s.def)) return false;
  return true;
}

/**
 * Places a fisher's pier (09 section 6 `pickPierSite`): the site is a dock footprint on the hamlet's shore whose ocean-access
 * test passes (docks.ts dockPool), in a pool the hamlet has no other dock on (09 section 12: one pier per pool per hamlet).
 * The candidate nearest the hamlet centre is taken, as for other civic buildings. The pier becomes the hamlet's site. Draws
 * no randomness.
 */
function placePier(ctx: HamletContext, h: Hamlet, def: BuildingDef): boolean {
  const realm = ctx.realm;
  const perAxis = realm.side / PARCEL;
  const depth = heightOf(def);
  const usedPools = new Set<number>();
  for (const b of h.buildings) {
    if (b.def.boatTypes && b.def.boatTypes.length > 0) usedPools.add(dockPool(realm, b.x, b.y, b.def.footprint, heightOf(b.def)));
  }
  const centre = centreOf(h.parcels, perAxis);
  let best: { x: number; y: number } | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const p of [...h.parcels].sort((a, b) => a - b)) {
    const px = (p % perAxis) * PARCEL;
    const py = Math.floor(p / perAxis) * PARCEL;
    for (let y = py; y < py + PARCEL; y++) {
      for (let x = px; x < px + PARCEL; x++) {
        const pool = dockPool(realm, x, y, def.footprint, depth);
        if (pool < 0 || usedPools.has(pool)) continue;
        let ok = true;
        for (let dy = 0; dy < depth && ok; dy++) {
          for (let dx = 0; dx < def.footprint && ok; dx++) ok = dockTileOk(ctx, h, x + dx, y + dy);
        }
        if (!ok) continue;
        const d = (x - centre.tx) * (x - centre.tx) + (y - centre.ty) * (y - centre.ty);
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    }
  }
  if (!best) return false;
  h.wood -= def.wood;
  h.stone -= def.stone;
  h.gold -= def.gold ?? 0;
  h.iron -= def.iron ?? 0;
  h.site = { def, x: best.x, y: best.y, progress: 0 };
  return true;
}

/**
 * Upgrades a standing fisher's pier to a harbor in place (09 section 6 upgrade: the source building is swapped for the target
 * def at once, the cost is paid, and the footprint is re-checked because the harbor is one row deeper). The pier's own tiles do
 * not block it. Nothing is placed when the pool test fails. Draws no randomness.
 */
function upgradePier(ctx: HamletContext, h: Hamlet, def: BuildingDef): boolean {
  const pier = h.buildings.find((b) => b.def.id === 'fishers_pier');
  if (!pier) return false;
  const depth = heightOf(def);
  for (let dy = 0; dy < depth; dy++) {
    for (let dx = 0; dx < def.footprint; dx++) {
      if (!dockTileOk(ctx, h, pier.x + dx, pier.y + dy, pier)) return false;
    }
  }
  if (dockPool(ctx.realm, pier.x, pier.y, def.footprint, depth) < 0) return false;
  h.wood -= def.wood;
  h.stone -= def.stone;
  h.gold -= def.gold ?? 0;
  h.iron -= def.iron ?? 0;
  pier.def = def;
  return true;
}

/**
 * Finishes the site once its progress reaches SITE_PROGRESS: the building joins the hamlet and its builders' coins are
 * paid. Draws no randomness.
 */
function finishSite(h: Hamlet): void {
  const s = h.site;
  if (!s || s.progress < SITE_PROGRESS) return;
  h.buildings.push({ def: s.def, x: s.x, y: s.y });
  delete h.site;
  h.gold += BUILDER_COINS;
}

/** Extends the territory by one parcel next to an owned one, if the parcel is mostly land. */
function expandTerritory(ctx: HamletContext, h: Hamlet): boolean {
  const side = ctx.realm.side;
  const perAxis = side / PARCEL;
  const candidates: number[] = [];
  for (const p of h.parcels) {
    const px = p % perAxis;
    const py = Math.floor(p / perAxis);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = px + dx;
      const ny = py + dy;
      if (nx < 0 || ny < 0 || nx >= perAxis || ny >= perAxis) continue;
      const q = ny * perAxis + nx;
      if (!h.parcels.has(q) && !candidates.includes(q) && !ctx.claimed?.(q)) candidates.push(q);
    }
  }
  candidates.sort((a, b) => a - b);
  for (const q of candidates) {
    let land = 0;
    for (let y = 0; y < PARCEL; y++) {
      for (let x = 0; x < PARCEL; x++) {
        const i = (Math.floor(q / perAxis) * PARCEL + y) * side + (q % perAxis) * PARCEL + x;
        if (ground(ctx.realm.ground[i] ?? 0).layer === 'land') land++;
      }
    }
    if (land >= 32) {
      h.parcels.add(q);
      return true;
    }
  }
  return false;
}

/** Folk housing slots the hamlet's buildings give. */
export function housingSlots(h: Hamlet): number {
  return h.buildings.reduce((s, b) => s + b.def.housing, 0);
}

function countOf(h: Hamlet, id: string): number {
  return h.buildings.reduce((n, b) => n + (b.def.id === id ? 1 : 0), 0);
}

function hasAll(h: Hamlet, needs: readonly string[]): boolean {
  return needs.every((id) => countOf(h, id) > 0);
}

/**
 * Hamlet mood, -100..100 (09 section 9, hamlet level; TUNE). Housing: folk in slots score the average
 * housing comfort of the slots, homeless folk score against it. Food: stock per folk. Buildings: their
 * own mood bonuses, capped. Derived from state each call; nothing is stored.
 */
export function hamletMood(h: Hamlet): number {
  let housing = 0;
  let comfort = 0;
  let bonus = 0;
  for (const b of h.buildings) {
    housing += b.def.housing;
    comfort += b.def.housing * (b.def.housingMood ?? 0);
    bonus += b.def.moodBonus ?? 0;
  }
  let mood = 0;
  if (h.folk > 0) {
    const housed = Math.min(h.folk, housing);
    const homeless = h.folk - housed;
    const avg = housing > 0 ? comfort / housing : 0;
    mood += (housed * avg * HOUSING_MOOD_PER_POINT - homeless * HOMELESS_MOOD) / h.folk;
    const ratio = h.food / h.folk;
    mood += ratio >= 4 ? 20 : ratio >= 2 ? 10 : ratio >= 1 ? 0 : -20;
  }
  mood += Math.min(bonus, MOOD_BUILDING_CAP);
  return Math.max(-100, Math.min(100, Math.round(mood)));
}

/** A building rule: its gates, on top of the limit of one per hamlet and the building's `needs` (09 section 6). */
interface BuildRule {
  id: string;
  /** Standing buildings of this id allowed in the hamlet (09 section 6 limit). Absent: one. */
  limit?: number;
  minFolk?: number;
  minBuildings?: number;
  minParcels?: number;
  when?: (h: Hamlet) => boolean;
}

/**
 * Build order, in priority (09 section 6 advanced list, reduced). Gates are the spec's where it gives them;
 * waystop's and mine's are TUNE. Each id is built at most once per hamlet unless its rule sets a limit.
 */
const RULES: readonly BuildRule[] = [
  { id: 'hearth_fire' },
  { id: 'larder' },
  { id: 'granary' },
  { id: 'great_hall_1' },
  { id: 'quarry', when: (h) => h.stone < 10 && h.buildings.filter((b) => b.def.housing > 0).length >= 2 },
  { id: 'lumber_camp', when: (h) => h.wood < 30 && h.folk >= 4 },
  // Docks (09 section 6: fishers_pier limit 5, bldg 2, needs hearth_fire and a pier site; harbor is its upgrade).
  { id: 'fishers_pier', limit: 5, minBuildings: 2 },
  { id: 'harbor', minBuildings: 2 },
  // The mine (iron_miner jobs break iron deposits; TUNE gates: folk 20, iron store under 10).
  { id: 'mine', minFolk: 20, when: (h) => h.iron < 10 },
  { id: 'quarry_lodge', minFolk: 20, when: (h) => countOf(h, 'quarry') > 0 },
  { id: 'waystop', minFolk: 25, minBuildings: 10 },
  { id: 'great_hall_2', minFolk: 30, minBuildings: 8 },
  { id: 'garrison', minFolk: GARRISON_FOLK, minBuildings: GARRISON_BUILDINGS, minParcels: GARRISON_PARCELS },
  // 09 section 6 watchspire (pop 30, bldg 10; its limit is raised by towerPride, custom-rules.ts).
  { id: 'watchspire', minFolk: 30, minBuildings: 10 },
  // 18e bastion: build-order weight minPop 60 (18e section 3.2 note); its gates are its needs (great hall II, garrison).
  { id: 'bastion', minFolk: 60 },
  { id: 'monument', minFolk: 70, minBuildings: 15 },
  { id: 'great_hall_3', minFolk: 100, minBuildings: 20 },
  // 09 section 6 bazaar (pop 60, bldg 15).
  { id: 'bazaar', minFolk: 60, minBuildings: 15 },
  // 18e section 3.1 build-order weight: limit 1 per Hamlet, minPop 40. Its harbor prerequisite gates it (no harbor is placed yet).
  { id: 'slipway', minFolk: 40 },
  // 18e section 3.1 build-order weight for restored buildings: limit 1 per Hamlet, minPop 40.
  { id: 'brazier_tower', minFolk: 40 },
];

/**
 * Buildings the hamlet may try this step, in order; the first that places is built. House tiers come
 * first while folk outnumber housing or fewer than four houses stand, highest tier first. Only
 * buildings whose `needs` are standing are listed.
 */
export function buildChoices(h: Hamlet, desires: readonly string[] = [], rules: CustomRules = BASE_RULES): BuildingDef[] {
  const houseCount = h.buildings.filter((b) => (HOUSE_TIERS as readonly string[]).includes(b.def.id)).length;
  const housingNeeded = h.folk > housingSlots(h) || houseCount < 4;
  // House limit (09 section 5): no house or lean-to once the houses stand at the limit.
  const houseLimit = housesMax(h.parcels.size, h.buildings.map((b) => b.def.id), rules.density);
  const houses: BuildingDef[] = [];
  for (const id of HOUSE_TIERS) {
    const def = BUILDING_BY_ID.get(id);
    if (def && houseCount < houseLimit && hasAll(h, def.needs ?? [])) houses.push(def);
  }
  const specials: BuildingDef[] = [];
  for (const rule of RULES) {
    const def = BUILDING_BY_ID.get(rule.id);
    // One of each civic building per hamlet unless its rule sets a limit; the monument limit is raised by statuePride and the
    // watchspire limit by towerPride (custom-rules.ts).
    const limit = rule.id === 'monument' ? rules.monumentLimit : rule.id === 'watchspire' ? rules.towerLimit : (rule.limit ?? 1);
    if (!def || countOf(h, rule.id) >= limit || !hasAll(h, def.needs ?? [])) continue;
    if (rule.minFolk !== undefined && h.folk < rule.minFolk) continue;
    if (rule.minBuildings !== undefined && h.buildings.length < rule.minBuildings) continue;
    if (rule.minParcels !== undefined && h.parcels.size < rule.minParcels) continue;
    if (rule.when && !rule.when(h)) continue;
    specials.push(def);
  }
  // Beacon desires (18e 2.3) come first among the civic choices. The spec draws uniformly with desires listed
  // twice; the first-fit order here cannot weight, so a desired build simply leads.
  const tail = [...specials.filter((d) => desires.includes(d.id)), ...specials.filter((d) => !desires.includes(d.id))];
  return housingNeeded ? [...houses, ...tail] : tail;
}

/**
 * Territory targets the jobs work on this step, in scan order. The lists are consumed by runJobs, so they are
 * built fresh each step.
 */
export interface JobTargets {
  /** Herb plants (herbalist). */
  herbs: number[];
  /** Deposit nodes with a store (prospector). */
  deposits: { tile: number; stone: number; gold: number; iron: number }[];
  /** Tilled tiles with no flora on them (tiller plants here). */
  tilled: number[];
  /** Open land a tiller may till into a field (only while the hamlet holds fewer than FIELD_MAX fields). */
  farmSpots: number[];
  /** Ripe crops (tiller harvests). */
  ripe: number[];
  /** Crops still growing (manure collector fertilises these). */
  unripe: number[];
  /** Hives with honey built up (honey gatherer). */
  hives: number[];
  /** Ruins to clear (cleaner); wood and stone are the refund of a clean. */
  ruins: { tile: number; wood: number; stone: number }[];
  /** Manure piles (manure collector). */
  manure: number[];
}

/**
 * Scans the hamlet's parcels (row-major inside each parcel, parcels in ascending order, so the same
 * realm always gives the same targets) for herb plants and for deposit nodes the prospectors take.
 * Reads the realm only; draws no randomness.
 */
export function jobTargets(ctx: HamletContext, h: Hamlet): JobTargets {
  const side = ctx.realm.side;
  const perAxis = side / PARCEL;
  const herbCode = floraCode('herb');
  const targets: JobTargets = { herbs: [], deposits: [], tilled: [], farmSpots: [], ripe: [], unripe: [], hives: [], ruins: [], manure: [] };
  // Tiles under a building are not open ground for a field.
  const occupied = hamletTiles(h, side);
  let fields = 0;
  for (const p of [...h.parcels].sort((a, b) => a - b)) {
    const x0 = (p % perAxis) * PARCEL;
    const y0 = Math.floor(p / perAxis) * PARCEL;
    for (let y = y0; y < y0 + PARCEL; y++) {
      for (let x = x0; x < x0 + PARCEL; x++) {
        const i = y * side + x;
        const tilled = ctx.realm.ground[i] === G.tilled;
        if (tilled) fields++;
        const code = ctx.realm.flora[i] ?? 0;
        if (code === 0) {
          if (occupied.has(i)) continue;
          if (tilled) targets.tilled.push(i);
          else if (tillable(ctx.realm, i)) targets.farmSpots.push(i);
          continue;
        }
        if (code === herbCode) {
          targets.herbs.push(i);
          continue;
        }
        const def = FLORA[code - 1];
        const yielded = DEPOSIT_YIELD.get(def?.id ?? '');
        if (yielded) {
          targets.deposits.push({ tile: i, stone: yielded.stone, gold: yielded.gold, iron: yielded.iron });
          continue;
        }
        if (!def) continue;
        if (def.kind === 'crop') {
          if (cropRipe(ctx.realm, ctx.tick, i)) targets.ripe.push(i);
          else targets.unripe.push(i);
        } else if (def.id === 'hive') {
          if (hiveReady(ctx.realm, ctx.tick, i)) targets.hives.push(i);
        } else if (def.id === 'ruined_dwelling' || def.id === 'ruined_hall') {
          targets.ruins.push({ tile: i, wood: def.id === 'ruined_dwelling' ? 1 : 0, stone: def.id === 'ruined_hall' ? 1 : 0 });
        } else if (def.id === 'manure_pile') {
          targets.manure.push(i);
        }
      }
    }
  }
  // A hamlet with enough fields stops making new ones; the tillers then only plant, harvest and fertilise.
  if (fields >= FIELD_MAX) targets.farmSpots = [];
  return targets;
}

/**
 * Pays out the workers' output into the hamlet store (09 section 8 yields), scaled by the mood
 * multiplier. Food stops at the store cap. Miners take stone from the outcrops, plus any quarry lodge bonus.
 * Herbalists pick herb plants and prospectors break deposit nodes; a picked or broken target leaves the realm.
 */
function runJobs(ctx: HamletContext, h: Hamlet, workers: ReadonlyMap<WorkerJob, number>, mult: number, foodCap: number, targets: JobTargets): void {
  const bonus = h.buildings.reduce((s, b) => s + (b.def.outcropBonus ?? 0), 0);
  const feed = (units: number): void => {
    if (h.food < foodCap) h.food = Math.min(h.food + units, foodCap);
  };
  for (const job of jobOrder(h.food)) {
    const n = workers.get(job.id) ?? 0;
    if (n === 0) continue;
    // At least one unit per worker: the mood multiplier can only trim a yield that is already a whole unit.
    const amount = Math.max(1, Math.floor(n * job.perWorker * mult));
    if (job.id === 'herbalist') {
      for (const i of targets.herbs.splice(0, amount)) {
        ctx.realm.setFlora(i, 0, ctx.tick);
        feed(HERB_FOOD);
      }
    } else if (job.id === 'prospector') {
      for (const d of targets.deposits.splice(0, amount)) {
        ctx.realm.setFlora(d.tile, 0, ctx.tick);
        h.stone += d.stone;
        h.gold += d.gold;
        h.iron += d.iron;
      }
    } else if (job.id === 'iron_miner') {
      // A mine's miner breaks one iron node per unit: the node leaves the realm and its iron goes to the hamlet iron store.
      // Nodes a prospector took this step are already off the list.
      for (let k = 0; k < amount; k++) {
        const at = targets.deposits.findIndex((d) => d.iron > 0);
        if (at < 0) break;
        const [d] = targets.deposits.splice(at, 1);
        if (!d) break;
        ctx.realm.setFlora(d.tile, 0, ctx.tick);
        h.iron += d.iron;
      }
    } else if (job.id === 'honey_gatherer') {
      for (const i of targets.hives.splice(0, amount)) {
        if (takeHoney(ctx.realm, ctx.tick, i) > 0) feed(HONEY_FOOD);
      }
    } else if (job.id === 'tiller') {
      // Each unit of work is one step of the field loop, in order: harvest a ripe crop, else plant a bare tilled tile,
      // else till open ground. A step that finds nothing ends the worker's turn.
      for (let k = 0; k < amount; k++) {
        const ripe = targets.ripe.shift();
        if (ripe !== undefined) {
          if (harvestCrop(ctx.realm, ctx.tick, ripe) > 0) feed(GRAIN_FOOD);
          continue;
        }
        const bare = targets.tilled.shift();
        if (bare !== undefined) {
          if (plantCrop(ctx.realm, ctx.tick, bare)) h.gold += FIELD_COINS;
          continue;
        }
        const spot = targets.farmSpots.shift();
        if (spot === undefined) break;
        if (till(ctx.realm, spot)) h.gold += FIELD_COINS;
      }
    } else if (job.id === 'cleaner') {
      // A cleaned ruin returns its wood or stone (09 section 8 "+1 wood/stone per cost") and pays a coin.
      for (const r of targets.ruins.splice(0, amount)) {
        ctx.realm.setFlora(r.tile, 0, ctx.tick);
        h.wood += r.wood;
        h.stone += r.stone;
        h.gold += CLEAN_COINS;
      }
    } else if (job.id === 'manure_collector') {
      // A pile taken off the ground is spread on the nearest growing crop at once (there is no manure store).
      for (const i of targets.manure.splice(0, amount)) {
        if (!pickManure(ctx.realm, i)) continue;
        const crop = targets.unripe.shift();
        if (crop !== undefined && fertiliseCrop(ctx.realm, ctx.tick, crop)) h.gold += FIELD_COINS;
      }
    } else if (job.id === 'builder') {
      // Builders add their work to the site and finish it when the progress is reached (09 section 6 construction).
      if (h.site) h.site.progress += amount;
      finishSite(h);
    } else if (job.id === 'roadwright') {
      // One queued road tile per roadwright unit, in queue order (09 section 11.3). A tile that is no longer open ground
      // (flora or damaging ground grew there since it was queued) is dropped without a coin.
      for (let k = 0; k < amount; k++) {
        const tile = h.road.shift();
        if (tile === undefined) break;
        if (!roadTerrainOpen(ctx.realm, tile)) continue;
        ctx.realm.setGround(tile, G.wayworn);
        h.gold += ROAD_COINS;
      }
    } else if (job.id === 'forager') {
      feed(amount);
    } else if (job.id === 'woodcutter') {
      h.wood += amount;
    } else if (job.id === 'miner') {
      const take = Math.min(h.outcrops, Math.floor(amount * (1 + bonus)));
      h.outcrops -= take;
      h.stone += take;
      if (h.steps % MINER_COIN_STEPS === 0) h.gold += n;
    }
  }
}

/**
 * Destroys the building at index `index` (09 section 6 damage/ruin): it leaves the hamlet, and its origin tile becomes a
 * ruin for a cleaner to clear. Draws no randomness. Nothing in the sim calls it yet: building damage is not simulated
 * and the calamity handlers are outside the settlements touch set.
 */
export function destroyBuilding(ctx: HamletContext, h: Hamlet, index: number): boolean {
  const b = h.buildings[index];
  if (!b) return false;
  h.buildings.splice(index, 1);
  makeRuin(ctx.realm, ctx.tick, b.y * ctx.realm.side + b.x, b.def.housing > 0);
  return true;
}

/**
 * One hamlet tick (09 sections 4-5, 6 and 8, reduced). Every 100 steps: folk eat from the store, the
 * population grows when food covers it and housing has room, the hamlet builds the first choice that
 * places, then its buildings and workers add to the store.
 */
export function hamletStep(ctx: HamletContext, h: Hamlet): void {
  h.growTimer -= 1;
  if (h.growTimer > 0) return;
  h.growTimer = 100;
  const eaten = Math.min(h.food, h.folk);
  h.food -= eaten;
  if (h.food < h.folk) h.folk = Math.max(1, h.folk - 1);
  const housing = housingSlots(h);
  if (ctx.isOn('folk_births') && h.food > h.folk * 2 && h.folk < housing && h.folk < 100) h.folk += 1;
  // One site at a time (09 section 6 step 2): a new building is placed only when no site is open. Territory grows only after
  // a building is actually placed; the site is finished by builders in the jobs below (its coins follow the finish).
  if (!h.site) {
    for (const def of buildChoices(h, ctx.desires ?? [], ctx.rules ?? BASE_RULES)) {
      if (placeBuilding(ctx, h, def)) {
        expandTerritory(ctx, h);
        break;
      }
    }
  }
  // Wells yield food per step; granaries only raise the store cap. Yield stops at the cap; stock above it is kept.
  const cap = foodCapacity(h);
  if (h.food < cap) h.food = Math.min(h.food + h.buildings.reduce((s, b) => s + b.def.foodYield, 0), cap);
  h.wood += h.buildings.reduce((s, b) => s + b.def.woodYield, 0);
  const targets = jobTargets(ctx, h);
  const counts: JobTargetCounts = {
    herbs: targets.herbs.length,
    deposits: targets.deposits.length,
    ironDeposits: targets.deposits.filter((d) => d.iron > 0).length,
    hives: targets.hives.length,
    tillWork: targets.tilled.length + targets.farmSpots.length + targets.ripe.length,
    ruins: targets.ruins.length,
    manure: targets.manure.length,
    soldierLimit: ctx.soldierLimit?.() ?? 0,
  };
  const work = ctx.workforce ?? { adults: h.folk, children: 0, leaders: 0, childLabour: false };
  runJobs(ctx, h, assignJobs(h, counts, work), workMultiplier(hamletMood(h)), cap, targets);
  h.steps += 1;
  if (h.steps % OUTCROP_REGROW_STEPS === 0 && h.outcrops < OUTCROP_CAP) h.outcrops += 1;
}
