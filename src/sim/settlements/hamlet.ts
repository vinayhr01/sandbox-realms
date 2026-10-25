import { G, ground } from '../../content/grounds.ts';
import { PARCEL } from '../../shared/constants.ts';
import type { Rng } from '../../shared/rng.ts';
import { BUILDING_BY_ID, type BuildingDef } from './catalogue.ts';
import { assignJobs, DEPOSIT_YIELD, HERB_FOOD, MINER_COIN_STEPS, JOBS, workMultiplier, type JobTargetCounts, type WorkerJob } from './jobs.ts';
import { FLORA, floraCode } from '../flora.ts';

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
}

/** Coins a completing builder earns (09 section 8). The sim has no builder beings, so the coins go to the hamlet gold (TUNE). */
export const BUILDER_COINS = 6;
/** Garrison build gates (09 section 6 order: pop 50, bldg 16, parcels 20). */
export const GARRISON_FOLK = 50;
export const GARRISON_BUILDINGS = 16;
export const GARRISON_PARCELS = 20;

/** Structural context: the hamlet step needs no Sim import. */
export interface HamletContext {
  realm: { side: number; ground: Uint8Array; flags: Uint16Array; cover: Uint8Array; flora: Uint8Array; setFlora(i: number, kind: number, since: number): void };
  rng: Rng;
  tick: number;
  /** Realm Rule lookup (rules.isOn). */
  isOn(id: string): boolean;
  /** True when another hamlet already owns the parcel; expansion must not take it. */
  claimed?: (parcel: number) => boolean;
  /** Build ids this hamlet is drawn to by nearby beacon pillars (18e 2.3), derived each second, never saved. */
  desires?: readonly string[];
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
  for (const h of hamlets) {
    for (const b of h.buildings) {
      const depth = heightOf(b.def);
      for (let dy = 0; dy < depth; dy++) {
        for (let dx = 0; dx < b.def.footprint; dx++) tiles.add((b.y + dy) * side + b.x + dx);
      }
    }
  }
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
  return { parcels: new Set([parcelIndex]), food: BASE_FOOD_STORE, wood: 60, stone: 30, folk, buildings: [], growTimer: 0, outcrops: OUTCROP_START, steps: 0, gold: 0 };
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
  // Road tiles (roads.ts sets them to wayworn) stay open for roads, not buildings.
  if (ctx.realm.ground[i] === G.wayworn) return false;
  const p = Math.floor(y / PARCEL) * (side / PARCEL) + Math.floor(x / PARCEL);
  if (!h.parcels.has(p)) return false;
  for (const b of h.buildings) {
    if (x >= b.x && y >= b.y && x < b.x + b.def.footprint && y < b.y + heightOf(b.def)) return false;
    if (x === b.x && y === b.y) return false;
  }
  return true;
}

/** Tries to place a building of `def` in the first free spot of the hamlet's parcels (scan order). */
export function placeBuilding(ctx: HamletContext, h: Hamlet, def: BuildingDef): boolean {
  if (h.wood < def.wood || h.stone < def.stone || h.gold < (def.gold ?? 0)) return false;
  const side = ctx.realm.side;
  const ordered = [...h.parcels].sort((a, b) => a - b);
  const perAxis = side / PARCEL;
  const depth = heightOf(def);
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
        if (!ok) continue;
        h.wood -= def.wood;
        h.stone -= def.stone;
        h.gold -= def.gold ?? 0;
        h.buildings.push({ def, x, y });
        return true;
      }
    }
  }
  return false;
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
  minFolk?: number;
  minBuildings?: number;
  minParcels?: number;
  when?: (h: Hamlet) => boolean;
}

/**
 * Build order, in priority (09 section 6 advanced list, reduced). Gates are the spec's where it gives them;
 * waystop's are TUNE. Each id is built at most once per hamlet.
 */
const RULES: readonly BuildRule[] = [
  { id: 'hearth_fire' },
  { id: 'larder' },
  { id: 'granary' },
  { id: 'great_hall_1' },
  { id: 'quarry', when: (h) => h.stone < 10 && h.buildings.filter((b) => b.def.housing > 0).length >= 2 },
  { id: 'lumber_camp', when: (h) => h.wood < 30 && h.folk >= 4 },
  { id: 'quarry_lodge', minFolk: 20, when: (h) => countOf(h, 'quarry') > 0 },
  { id: 'waystop', minFolk: 25, minBuildings: 10 },
  { id: 'great_hall_2', minFolk: 30, minBuildings: 8 },
  { id: 'garrison', minFolk: GARRISON_FOLK, minBuildings: GARRISON_BUILDINGS, minParcels: GARRISON_PARCELS },
  { id: 'monument', minFolk: 70, minBuildings: 15 },
  { id: 'great_hall_3', minFolk: 100, minBuildings: 20 },
  // 09 section 6 bazaar (pop 60, bldg 15).
  { id: 'bazaar', minFolk: 60, minBuildings: 15 },
];

/**
 * Buildings the hamlet may try this step, in order; the first that places is built. House tiers come
 * first while folk outnumber housing or fewer than four houses stand, highest tier first. Only
 * buildings whose `needs` are standing are listed.
 */
export function buildChoices(h: Hamlet, desires: readonly string[] = []): BuildingDef[] {
  const houseCount = h.buildings.filter((b) => (HOUSE_TIERS as readonly string[]).includes(b.def.id)).length;
  const housingNeeded = h.folk > housingSlots(h) || houseCount < 4;
  const houses: BuildingDef[] = [];
  for (const id of HOUSE_TIERS) {
    const def = BUILDING_BY_ID.get(id);
    if (def && hasAll(h, def.needs ?? [])) houses.push(def);
  }
  const specials: BuildingDef[] = [];
  for (const rule of RULES) {
    const def = BUILDING_BY_ID.get(rule.id);
    if (!def || countOf(h, rule.id) > 0 || !hasAll(h, def.needs ?? [])) continue;
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

/** Territory targets the node jobs work on this step: herb tiles and deposit tiles, in scan order. */
export interface JobTargets {
  herbs: number[];
  deposits: { tile: number; stone: number; gold: number }[];
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
  const targets: JobTargets = { herbs: [], deposits: [] };
  for (const p of [...h.parcels].sort((a, b) => a - b)) {
    const x0 = (p % perAxis) * PARCEL;
    const y0 = Math.floor(p / perAxis) * PARCEL;
    for (let y = y0; y < y0 + PARCEL; y++) {
      for (let x = x0; x < x0 + PARCEL; x++) {
        const i = y * side + x;
        const code = ctx.realm.flora[i] ?? 0;
        if (code === 0) continue;
        if (code === herbCode) {
          targets.herbs.push(i);
          continue;
        }
        const yielded = DEPOSIT_YIELD.get(FLORA[code - 1]?.id ?? '');
        if (yielded) targets.deposits.push({ tile: i, stone: yielded.stone, gold: yielded.gold });
      }
    }
  }
  return targets;
}

/**
 * Pays out the workers' output into the hamlet store (09 section 8 yields), scaled by the mood
 * multiplier. Food stops at the store cap. Miners take stone from the outcrops, plus any quarry lodge bonus.
 * Herbalists pick herb plants and prospectors break deposit nodes; a picked or broken target leaves the realm.
 */
function runJobs(ctx: HamletContext, h: Hamlet, workers: ReadonlyMap<WorkerJob, number>, mult: number, foodCap: number, targets: JobTargets): void {
  const bonus = h.buildings.reduce((s, b) => s + (b.def.outcropBonus ?? 0), 0);
  for (const job of JOBS) {
    const n = workers.get(job.id) ?? 0;
    if (n === 0) continue;
    // At least one unit per worker: the mood multiplier can only trim a yield that is already a whole unit.
    const amount = Math.max(1, Math.floor(n * job.perWorker * mult));
    if (job.id === 'herbalist') {
      for (const i of targets.herbs.splice(0, amount)) {
        ctx.realm.setFlora(i, 0, ctx.tick);
        if (h.food < foodCap) h.food = Math.min(h.food + HERB_FOOD, foodCap);
      }
    } else if (job.id === 'prospector') {
      for (const d of targets.deposits.splice(0, amount)) {
        ctx.realm.setFlora(d.tile, 0, ctx.tick);
        h.stone += d.stone;
        h.gold += d.gold;
      }
    } else if (job.id === 'forager') {
      if (h.food < foodCap) h.food = Math.min(h.food + amount, foodCap);
    } else if (job.id === 'woodcutter') {
      h.wood += amount;
    } else {
      const take = Math.min(h.outcrops, Math.floor(amount * (1 + bonus)));
      h.outcrops -= take;
      h.stone += take;
    }
    if (job.id === 'miner' && h.steps % MINER_COIN_STEPS === 0) h.gold += n;
  }
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
  // One building per step. Territory grows only after a building is actually placed; the builder's coins follow the placement.
  for (const def of buildChoices(h, ctx.desires ?? [])) {
    if (placeBuilding(ctx, h, def)) {
      h.gold += BUILDER_COINS;
      expandTerritory(ctx, h);
      break;
    }
  }
  // Wells yield food per step; granaries only raise the store cap. Yield stops at the cap; stock above it is kept.
  const cap = foodCapacity(h);
  if (h.food < cap) h.food = Math.min(h.food + h.buildings.reduce((s, b) => s + b.def.foodYield, 0), cap);
  h.wood += h.buildings.reduce((s, b) => s + b.def.woodYield, 0);
  const targets = jobTargets(ctx, h);
  const counts: JobTargetCounts = { herbs: targets.herbs.length, deposits: targets.deposits.length };
  runJobs(ctx, h, assignJobs(h, counts), workMultiplier(hamletMood(h)), cap, targets);
  h.steps += 1;
  if (h.steps % OUTCROP_REGROW_STEPS === 0 && h.outcrops < OUTCROP_CAP) h.outcrops += 1;
}
