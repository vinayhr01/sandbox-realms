import { G, ground } from '../content/grounds.ts';
import { BIOMES, biomeOfCover } from '../content/biomes.ts';
import { FLAG } from './realm.ts';
import { n8 } from './grid.ts';
import type { Sim } from './sim.ts';
import type { Rng } from '../shared/rng.ts';
import { TUNING } from './beings/tuning.ts';
import { ssToTicks } from './clock.ts';
import { terrainState, type FloraJob } from './terrain/state.ts';

/**
 * Flora (18d, subset): kinds, the ground they need, growth, spread and environment sensitivity.
 * Numbers are TUNE; ids follow the spec names. A tile holds at most one flora (Realm.flora).
 * Mineral nodes share the same tile code (18d section 6) but never grow, age or spread.
 */
export interface FloraDef {
  id: string;
  kind: 'tree' | 'plant' | 'fungus' | 'mineral';
  /** Biome ids where wild seeding may place it (18c biome plant and tree lists). */
  biomes: readonly string[];
  /** Ticks from planting to mature, sprouts take a third of this. */
  matureTicks: number;
  /** Ticks a mature plant lives before it dies of age; 0 = never. */
  lifespanTicks: number;
  /** Chance per spread run for a mature plant to seed a neighbour. */
  spreadChance: number;
  /** Extra random n8 hops after the first one, so spread distance is 1 + spreadSteps (04 section 10). */
  spreadSteps: number;
  /** Ids a spread may place, drawn uniformly; defaults to the parent's own id (04 section 10). */
  spreadIds?: readonly string[];
  flammable: boolean;
  droughtSensitive: boolean;
  coldSensitive: boolean;
  /** Only on beaches (strand). */
  beach: boolean;
}

const Y = 1200;
const mo = (n: number): number => n * 100;


const mineral = (id: string): FloraDef => ({ id, kind: 'mineral', biomes: [], matureTicks: 0, lifespanTicks: 0, spreadChance: 0, spreadSteps: 0, flammable: false, droughtSensitive: false, coldSensitive: false, beach: false });

export const FLORA: readonly FloraDef[] = [
  { id: 'broadleaf_a', kind: 'tree', biomes: ['verdant_reach', 'russetwood', 'paleglen'], matureTicks: mo(60), lifespanTicks: 40 * Y, spreadChance: 0.02, spreadSteps: 1, flammable: true, droughtSensitive: true, coldSensitive: false, beach: false },
  { id: 'pine', kind: 'tree', biomes: ['rimewaste', 'scree_flats'], matureTicks: mo(60), lifespanTicks: 40 * Y, spreadChance: 0.02, spreadSteps: 1, flammable: true, droughtSensitive: false, coldSensitive: false, beach: false },
  { id: 'palm', kind: 'tree', biomes: ['dunesea'], matureTicks: mo(72), lifespanTicks: 30 * Y, spreadChance: 0.01, spreadSteps: 1, flammable: true, droughtSensitive: false, coldSensitive: true, beach: true },
  { id: 'cactus', kind: 'plant', biomes: ['dunesea'], matureTicks: mo(48), lifespanTicks: 0, spreadChance: 0.01, spreadSteps: 0, flammable: false, droughtSensitive: false, coldSensitive: true, beach: true },
  { id: 'herb', kind: 'plant', biomes: ['verdant_reach', 'paleglen', 'bloomfield'], matureTicks: mo(12), lifespanTicks: 6 * Y, spreadChance: 0.05, spreadSteps: 0, flammable: true, droughtSensitive: false, coldSensitive: true, beach: false },
  { id: 'fieldflower', kind: 'plant', biomes: ['bloomfield', 'verdant_reach', 'gleamwood'], matureTicks: mo(10), lifespanTicks: 5 * Y, spreadChance: 0.06, spreadSteps: 0, flammable: true, droughtSensitive: false, coldSensitive: true, beach: false },
  { id: 'toadstool', kind: 'fungus', biomes: ['sporeglen', 'sodden_hollow'], matureTicks: mo(18), lifespanTicks: 10 * Y, spreadChance: 0.03, spreadSteps: 0, flammable: false, droughtSensitive: false, coldSensitive: false, beach: false },
  { id: 'reed', kind: 'plant', biomes: ['sodden_hollow'], matureTicks: mo(24), lifespanTicks: 0, spreadChance: 0.04, spreadSteps: 0, flammable: true, droughtSensitive: false, coldSensitive: false, beach: false },
  { id: 'tall_grass', kind: 'plant', biomes: ['amberveldt'], matureTicks: mo(24), lifespanTicks: 8 * Y, spreadChance: 0.05, spreadSteps: 0, flammable: true, droughtSensitive: true, coldSensitive: true, beach: false },
  { id: 'fern', kind: 'plant', biomes: ['steamthicket', 'bambooveil'], matureTicks: mo(20), lifespanTicks: 8 * Y, spreadChance: 0.04, spreadSteps: 0, flammable: true, droughtSensitive: false, coldSensitive: true, beach: false },
  mineral('stone_outcrop'),
  mineral('iron_outcrop'),
  mineral('gold_outcrop'),
  mineral('gem_outcrop'),
];

export const FLORA_BY_ID = new Map(FLORA.map((f, k) => [f.id, k]));

/** Flora index + 1 (0 = none) for a flora id. */
export function floraCode(id: string): number {
  const k = FLORA_BY_ID.get(id);
  if (k === undefined) throw new RangeError(`unknown flora ${id}`);
  return k + 1;
}

function floraAt(code: number): FloraDef | null {
  return FLORA[code - 1] ?? null;
}

/** True when flora may stand on tile i: land, not burning, not blocking, no other flora. */
function canPlant(sim: Sim, i: number, def: FloraDef): boolean {
  const realm = sim.realm;
  if (realm.flora[i] !== 0) return false;
  if ((realm.floraBlockedUntil[i] ?? 0) > sim.tick) return false;
  if (realm.hasFlag(i, FLAG.burning)) return false;
  const kind = ground(realm.ground[i] ?? 0);
  if (kind.layer !== 'land') return false;
  if (def.beach) return realm.ground[i] === G.strand;
  if (realm.ground[i] === G.strand) return false;
  const biome = biomeOfCover(realm.cover[i] ?? 0);
  if (biome < 0) return false;
  return def.biomes.includes(BIOMES[biome]?.id ?? '');
}

/**
 * Wild seeding (02 section 7 wildSeeding, 10 + 10 ss): `attempts` random tiles; each may receive a
 * flora listed for its biome. Trees are capped at three per Parcel (8x8) (03 section 8.1).
 */
export function wildSeeding(sim: Sim, attempts: number): void {
  const realm = sim.realm;
  const rng = sim.rng('wild');
  const dense = sim.rules.isOn('dense_flora') ? 1.5 : 1;
  for (let a = 0; a < attempts; a++) {
    // One attempt seeds a small patch: five tiles around a random centre (02 section 7, 03 section 8.1).
    const cx = rng.int(realm.side);
    const cy = rng.int(realm.side);
    for (let p = 0; p < 5; p++) seedTile(sim, rng, cx + rng.int(5) - 2, cy + rng.int(5) - 2, dense);
  }
}

function seedTile(sim: Sim, rng: Rng, x: number, y: number, dense: number): void {
  const realm = sim.realm;
  if (x < 0 || y < 0 || x >= realm.side || y >= realm.side) return;
  const i = y * realm.side + x;
  const biome = biomeOfCover(realm.cover[i] ?? 0);
  if (biome < 0) return;
  const candidates = FLORA.filter((f) => f.kind !== 'mineral' && !f.beach && f.biomes.includes(BIOMES[biome]?.id ?? ''));
  if (candidates.length === 0) return;
  const def = candidates[rng.int(candidates.length)];
  if (!def || !canPlant(sim, i, def)) return;
  if (def.kind === 'tree' && parcelTrees(sim, i) >= Math.floor(3 * dense)) return;
  realm.setFlora(i, floraCode(def.id), sim.tick);
}

/** Trees in the 8x8 parcel containing tile i (03 section 8.1). */
function parcelTrees(sim: Sim, i: number): number {
  const realm = sim.realm;
  const x0 = Math.floor((i % realm.side) / 8) * 8;
  const y0 = Math.floor(Math.floor(i / realm.side) / 8) * 8;
  let count = 0;
  for (let y = y0; y < y0 + 8; y++) {
    for (let x = x0; x < x0 + 8; x++) {
      const code = realm.flora[y * realm.side + x] ?? 0;
      if (floraAt(code)?.kind === 'tree') count++;
    }
  }
  return count;
}

/** Growth stage 0 sprout, 1 young, 2 mature, 3 old, from age in ticks (18d 5.1). */
export function floraStage(def: FloraDef, ageTicks: number): number {
  if (def.lifespanTicks > 0 && ageTicks >= def.lifespanTicks) return 3;
  if (ageTicks >= def.matureTicks) return 2;
  if (ageTicks >= def.matureTicks / 3) return 1;
  return 0;
}

/**
 * Flora pass (18d 7.3): old flora dies. Spread is not here; it runs in its own rule-gated jobs
 * (floraSpreadStep). Budgeted over a runner so cost is proportional to the sweep size.
 */
export function floraPass(sim: Sim, budget: number): void {
  const realm = sim.realm;
  const runner = sim.runner('flora');
  for (let k = 0; k < budget; k++) {
    const i = runner.next();
    const code = realm.flora[i] ?? 0;
    const def = floraAt(code);
    if (!def || def.kind === 'mineral') continue;
    const age = sim.tick - (realm.floraSince[i] ?? 0);
    if (floraStage(def, age) === 3) realm.setFlora(i, 0, 0);
  }
}

/** Spread kinds with their rule gates and periods (04 section 10: 50 / 40 / 30 ss, 10 ss when fast). */
type SpreadKind = 'tree' | 'plant' | 'fungus';
const SPREAD: readonly { kind: SpreadKind; rule: string; fast: string; periodSs: number }[] = [
  { kind: 'tree', rule: 'tree_spread', fast: 'fast_trees', periodSs: 50 },
  { kind: 'plant', rule: 'plant_spread', fast: 'fast_plants', periodSs: 40 },
  { kind: 'fungus', rule: 'fungus_spread', fast: 'fast_fungi', periodSs: 30 },
];
/** Fast-rule period in sim seconds (04 section 10). */
const FAST_PERIOD_SS = 10;
/** Structures processed per tick by the spread jobs (04 section 10). */
const SPREAD_CHUNK = 500;

/**
 * Spread jobs (04 section 10, 02 rules table): one timer per flora kind. On expiry every flora of
 * that kind is queued and each one tries to spread, a chunk of at most 500 per tick. A kind whose
 * rule is off does nothing. Sanctuary seals stop all spread.
 */
export function floraSpreadStep(sim: Sim): void {
  const state = terrainState(sim);
  const realm = sim.realm;
  for (const spec of SPREAD) {
    let job: FloraJob | undefined = state.floraJobs.get(spec.kind);
    if (!job) {
      job = { next: sim.tick + ssToTicks(spec.periodSs), queue: [], cursor: 0 };
      state.floraJobs.set(spec.kind, job);
    }
    if (sim.tick >= job.next) {
      job.next = sim.tick + ssToTicks(sim.rules.isOn(spec.fast) ? FAST_PERIOD_SS : spec.periodSs);
      job.queue = [];
      job.cursor = 0;
      if (sim.rules.isOn(spec.rule) && !sim.rules.isOn('sanctuary_seal')) {
        for (let i = 0; i < realm.tileCount; i++) {
          const def = floraAt(realm.flora[i] ?? 0);
          if (def && def.kind === spec.kind) job.queue.push(i);
        }
      }
    }
    const end = Math.min(job.queue.length, job.cursor + SPREAD_CHUNK);
    for (; job.cursor < end; job.cursor++) {
      const i = job.queue[job.cursor] ?? -1;
      const code = realm.flora[i] ?? 0;
      const def = floraAt(code);
      if (def && def.kind === spec.kind) trySpread(sim, i, def);
    }
  }
}

/**
 * One spread attempt by the flora on tile i (04 section 10 trySpread): roll the spread chance, take
 * one random n8 hop and `spreadSteps` more, choose an id from `spreadIds`, check the Parcel tree
 * limit (x1.5 under dense_flora) and canPlace, then plant.
 */
function trySpread(sim: Sim, i: number, def: FloraDef): void {
  const realm = sim.realm;
  const rng = sim.rng('flora');
  if (rng.next() >= def.spreadChance) return;
  let cur = n8(i, realm.side, rng.int(8));
  if (cur < 0) return;
  for (let s = 0; s < def.spreadSteps; s++) {
    const next = n8(cur, realm.side, rng.int(8));
    if (next >= 0) cur = next;
  }
  const ids = def.spreadIds ?? [def.id];
  const childId = ids[rng.int(ids.length)] ?? def.id;
  const child = FLORA_BY_ID.get(childId);
  if (child === undefined) return;
  const childDef = FLORA[child];
  if (!childDef || !canPlant(sim, cur, childDef)) return;
  if (childDef.kind === 'tree') {
    const dense = sim.rules.isOn('dense_flora') ? 1.5 : 1;
    if (parcelTrees(sim, cur) >= Math.floor(3 * dense)) return;
  }
  realm.setFlora(cur, child + 1, sim.tick);
}

/** True when a mineral node may sit on tile i: land or mountain, not burning, no other flora. */
function mineralSite(sim: Sim, i: number): boolean {
  const realm = sim.realm;
  if (realm.flora[i] !== 0 || realm.hasFlag(i, FLAG.burning)) return false;
  const layer = ground(realm.ground[i] ?? 0).layer;
  return layer === 'land' || layer === 'blocked';
}

/** Weighted hill pool for natural seeding (18d section 6: stone 6, iron 3, gold 1, gem 1). */
const HILL_POOL: readonly [string, number][] = [
  ['stone_outcrop', 6],
  ['iron_outcrop', 3],
  ['gold_outcrop', 1],
  ['gem_outcrop', 1],
];
/** Mineral nodes per Parcel before natural seeding stops (18d section 6). */
const MINERALS_PER_PARCEL = 2;

/** Mineral nodes in the 8x8 Parcel containing tile i. */
function parcelMinerals(sim: Sim, i: number): number {
  const realm = sim.realm;
  const x0 = Math.floor((i % realm.side) / 8) * 8;
  const y0 = Math.floor(Math.floor(i / realm.side) / 8) * 8;
  let count = 0;
  for (let y = y0; y < y0 + 8; y++) {
    for (let x = x0; x < x0 + 8; x++) {
      if (floraAt(realm.flora[y * realm.side + x] ?? 0)?.kind === 'mineral') count++;
    }
  }
  return count;
}

/**
 * Places a mineral node of the given id on (x, y). Natural seeding passes `natural = true`, which
 * also respects the per-Parcel cap; meteor nodes do not. Returns true when placed.
 */
export function placeMineralNode(sim: Sim, x: number, y: number, natural = false, id?: string): boolean {
  const realm = sim.realm;
  if (!realm.inBounds(x, y)) return false;
  const i = y * realm.side + x;
  if (!mineralSite(sim, i)) return false;
  if (natural && parcelMinerals(sim, i) >= MINERALS_PER_PARCEL) return false;
  let node = id;
  if (node === undefined) {
    const rng = sim.rng('mineral');
    let total = 0;
    for (const [, w] of HILL_POOL) total += w;
    let r = rng.int(total);
    node = HILL_POOL[0]?.[0] ?? 'stone_outcrop';
    for (const [key, w] of HILL_POOL) {
      r -= w;
      if (r < 0) {
        node = key;
        break;
      }
    }
  }
  realm.setFlora(i, floraCode(node), sim.tick);
  return true;
}

/**
 * Mineral seeding (02 section 7 mineralSeeding, 04 section 10): on mountain and hill tiles (knoll,
 * crag, highloam), with a 50% skip and the Parcel cap. Gated by rule mineral_growth. Runs a few
 * attempts per call.
 */
export function mineralSeeding(sim: Sim, attempts: number): void {
  if (!sim.rules.isOn('mineral_growth')) return;
  const realm = sim.realm;
  const rng = sim.rng('mineral');
  for (let a = 0; a < attempts; a++) {
    const i = rng.int(realm.tileCount);
    const g = realm.ground[i] ?? 0;
    if (g !== G.knoll && g !== G.crag && g !== G.highloam) continue;
    if (rng.next() < 0.5) continue;
    placeMineralNode(sim, i % realm.side, Math.floor(i / realm.side), true);
  }
}

/**
 * A grazer clears tile i (06 section 2.2): the flora is removed and the tile stays bare for
 * TUNING.regrowDelay ticks before any seeding may take it again.
 */
export function grazeFlora(sim: Sim, i: number): void {
  const realm = sim.realm;
  realm.setFlora(i, 0, 0);
  realm.floraBlockedUntil[i] = sim.tick + TUNING.regrowDelay;
}

/** Ruins flora of a sensitivity class on up to `max` random tiles (02 section 5.4 drought/frost). */
function purge(sim: Sim, max: number, pick: (def: FloraDef) => boolean): void {
  const realm = sim.realm;
  const rng = sim.rng('purge');
  let removed = 0;
  for (let tries = 0; tries < 2000 && removed < max; tries++) {
    const i = rng.int(realm.tileCount);
    const def = floraAt(realm.flora[i] ?? 0);
    if (def && def.kind !== 'mineral' && pick(def)) {
      realm.setFlora(i, 0, 0);
      removed++;
    }
  }
}

/** Scorch drought pass (02 section 5.4): drought-sensitive flora become ruins. */
export function droughtPass(sim: Sim, max: number): void {
  purge(sim, max, (d) => d.droughtSensitive);
}

/** Frost pass (02 section 5.4): cold-sensitive flora become ruins. */
export function frostPass(sim: Sim, max: number): void {
  purge(sim, max, (d) => d.coldSensitive);
}
