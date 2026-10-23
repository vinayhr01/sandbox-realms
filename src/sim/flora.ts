import { G, ground } from '../content/grounds.ts';
import { BIOMES, biomeOfCover } from '../content/biomes.ts';
import { FLAG } from './realm.ts';
import { n8 } from './grid.ts';
import type { Sim } from './sim.ts';
import type { Rng } from '../shared/rng.ts';

/**
 * Flora (18d, subset): kinds, the ground they need, growth, spread and environment sensitivity.
 * Numbers are TUNE; ids follow the spec names. A tile holds at most one flora (Realm.flora).
 */
export interface FloraDef {
  id: string;
  kind: 'tree' | 'plant' | 'fungus';
  /** Biome ids where wild seeding may place it (18c biome plant and tree lists). */
  biomes: readonly string[];
  /** Ticks from planting to mature, sprouts take a third of this. */
  matureTicks: number;
  /** Ticks a mature plant lives before it dies of age; 0 = never. */
  lifespanTicks: number;
  /** Chance per spread run for a mature plant to seed a neighbour. */
  spreadChance: number;
  flammable: boolean;
  droughtSensitive: boolean;
  coldSensitive: boolean;
  /** Only on beaches (strand). */
  beach: boolean;
}

const Y = 1200;
const mo = (n: number): number => n * 100;

export const FLORA: readonly FloraDef[] = [
  { id: 'broadleaf_a', kind: 'tree', biomes: ['verdant_reach', 'russetwood', 'paleglen'], matureTicks: mo(60), lifespanTicks: 40 * Y, spreadChance: 0.02, flammable: true, droughtSensitive: true, coldSensitive: false, beach: false },
  { id: 'pine', kind: 'tree', biomes: ['rimewaste', 'scree_flats'], matureTicks: mo(60), lifespanTicks: 40 * Y, spreadChance: 0.02, flammable: true, droughtSensitive: false, coldSensitive: false, beach: false },
  { id: 'palm', kind: 'tree', biomes: ['dunesea'], matureTicks: mo(72), lifespanTicks: 30 * Y, spreadChance: 0.01, flammable: true, droughtSensitive: false, coldSensitive: true, beach: true },
  { id: 'cactus', kind: 'plant', biomes: ['dunesea'], matureTicks: mo(48), lifespanTicks: 0, spreadChance: 0.01, flammable: false, droughtSensitive: false, coldSensitive: true, beach: true },
  { id: 'herb', kind: 'plant', biomes: ['verdant_reach', 'paleglen', 'bloomfield'], matureTicks: mo(12), lifespanTicks: 6 * Y, spreadChance: 0.05, flammable: true, droughtSensitive: false, coldSensitive: true, beach: false },
  { id: 'fieldflower', kind: 'plant', biomes: ['bloomfield', 'verdant_reach', 'gleamwood'], matureTicks: mo(10), lifespanTicks: 5 * Y, spreadChance: 0.06, flammable: true, droughtSensitive: false, coldSensitive: true, beach: false },
  { id: 'toadstool', kind: 'fungus', biomes: ['sporeglen', 'sodden_hollow'], matureTicks: mo(18), lifespanTicks: 10 * Y, spreadChance: 0.03, flammable: false, droughtSensitive: false, coldSensitive: false, beach: false },
  { id: 'reed', kind: 'plant', biomes: ['sodden_hollow'], matureTicks: mo(24), lifespanTicks: 0, spreadChance: 0.04, flammable: true, droughtSensitive: false, coldSensitive: false, beach: false },
  { id: 'tall_grass', kind: 'plant', biomes: ['amberveldt'], matureTicks: mo(24), lifespanTicks: 8 * Y, spreadChance: 0.05, flammable: true, droughtSensitive: true, coldSensitive: true, beach: false },
  { id: 'fern', kind: 'plant', biomes: ['steamthicket', 'bambooveil'], matureTicks: mo(20), lifespanTicks: 8 * Y, spreadChance: 0.04, flammable: true, droughtSensitive: false, coldSensitive: true, beach: false },
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
    const candidates = FLORA.filter((f) => !f.beach && f.biomes.includes(BIOMES[biome]?.id ?? ''));
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
 * Flora pass (18d 7.3): old flora dies, mature flora seeds one neighbour with its spread chance.
 * Budgeted over a runner so cost is proportional to the sweep size.
 */
export function floraPass(sim: Sim, budget: number): void {
  const realm = sim.realm;
  const runner = sim.runner('flora');
  const rng = sim.rng('flora');
  for (let k = 0; k < budget; k++) {
    const i = runner.next();
    const code = realm.flora[i] ?? 0;
    const def = floraAt(code);
    if (!def) continue;
    const age = sim.tick - (realm.floraSince[i] ?? 0);
    const stage = floraStage(def, age);
    if (stage === 3) {
      realm.setFlora(i, 0, 0);
      continue;
    }
    if (stage < 2 || rng.next() >= def.spreadChance) continue;
    const j = n8(i, realm.side, rng.int(8));
    if (j >= 0 && canPlant(sim, j, def)) realm.setFlora(j, code, sim.tick);
  }
}

/** Ruins flora of a sensitivity class on up to `max` random tiles (02 section 5.4 drought/frost). */
function purge(sim: Sim, max: number, pick: (def: FloraDef) => boolean): void {
  const realm = sim.realm;
  const rng = sim.rng('purge');
  let removed = 0;
  for (let tries = 0; tries < 2000 && removed < max; tries++) {
    const i = rng.int(realm.tileCount);
    const def = floraAt(realm.flora[i] ?? 0);
    if (def && pick(def)) {
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

