/**
 * Custom-driven building rules (11 section 9.1, 09 sections 5, 6, 8 and 11): house limit, statue limit, placement order,
 * zone plans, lot placements and the levy filter. A hamlet's rules come from its custom's trait list (rulesOf). The
 * base rules (no custom, or no trait of these) are the spec's defaults: density 1, one monument, centre-first placement.
 * Pure: no sim and no rng here. hamlet.ts applies the rules; garrison-adapter.ts applies the levy.
 */
import { PARCEL } from '../../shared/constants.ts';
import { noise01 } from '../worldgen/noise.ts';

/** Houses a building adds to a hamlet's house limit (09 section 9, `maxHouses`; the catalogue ids that have one). */
export const MAX_HOUSES: Readonly<Record<string, number>> = { hearth_fire: 3, great_hall_1: 2, great_hall_2: 2, great_hall_3: 2, monument: 3, bazaar: 2 };

/** Monuments a hamlet may hold without statuePride (one per hamlet, 09 section 6 order list). */
export const BASE_MONUMENT_LIMIT = 1;
/** Monuments added by statuePride (09 section 6: +4 statues). */
export const STATUE_PRIDE_BONUS = 4;
/** Hamlet size (folk in housing, or parcels) at which the zone rules apply (09 section 6: housingTotal >= 10 or parcels >= 20). */
export const ZONE_HOUSING = 10;
export const ZONE_PARCELS = 20;

export type LevySex = 'male' | 'female';
export type ZoneRule = 'ring' | 'cross' | 'lattice2' | 'lattice3' | 'lattice4' | 'checker' | 'grove';
export type LotRule = 'centred' | 'stair' | 'wobble';

/** The rules a hamlet builds by. `worldSeed` feeds the grove noise. */
export interface CustomRules {
  /** Density factor of the house limit (crowded x2, spacious x1/3, swarm x3). */
  density: number;
  /** Monuments allowed in the hamlet (statuePride raises it). */
  monumentLimit: number;
  /** True: the first valid tile is taken (scatteredBuild). False: the valid tile nearest the hamlet centre (09 section 6). */
  scattered: boolean;
  /** Zone plan a building's parcel must satisfy, when the custom has one. */
  zone?: ZoneRule;
  /** Lot placement a building's tile must satisfy, when the custom has one. */
  lot?: LotRule;
  /** Sex that alone may become a soldier (maleLevy, femaleLevy). */
  levy?: LevySex;
  worldSeed: number;
}

const ZONE_OF: Readonly<Record<string, ZoneRule>> = {
  ringPlan: 'ring',
  crossPlan: 'cross',
  lattice2Plan: 'lattice2',
  lattice3Plan: 'lattice3',
  lattice4Plan: 'lattice4',
  checkerPlan: 'checker',
  grovePlan: 'grove',
};

const LOT_OF: Readonly<Record<string, LotRule>> = { centeredLot: 'centred', stairLot: 'stair', wobbleLot: 'wobble' };

/** The spec's default rules: no custom, or a custom with none of the traits below. */
export const BASE_RULES: CustomRules = { density: 1, monumentLimit: BASE_MONUMENT_LIMIT, scattered: false, worldSeed: 0 };

/** Rules of a trait list (11 section 9.1 rows of this file's scope). Opposite traits are resolved by the catalogue. */
export function rulesOf(traits: readonly string[], worldSeed = 0): CustomRules {
  let density = 1;
  if (traits.includes('crowded')) density = 2;
  else if (traits.includes('spacious')) density = 1 / 3;
  else if (traits.includes('swarm')) density = 3;
  const zoneId = traits.find((t) => ZONE_OF[t] !== undefined);
  const lotId = traits.find((t) => LOT_OF[t] !== undefined);
  const male = traits.includes('maleLevy');
  const female = traits.includes('femaleLevy');
  const rules: CustomRules = {
    density,
    monumentLimit: BASE_MONUMENT_LIMIT + (traits.includes('statuePride') ? STATUE_PRIDE_BONUS : 0),
    scattered: traits.includes('scatteredBuild'),
    worldSeed,
  };
  const zone = zoneId === undefined ? undefined : ZONE_OF[zoneId];
  if (zone !== undefined) rules.zone = zone;
  const lot = lotId === undefined ? undefined : LOT_OF[lotId];
  if (lot !== undefined) rules.lot = lot;
  if (male !== female) rules.levy = male ? 'male' : 'female';
  return rules;
}

/**
 * House limit (09 section 5): `parcels x densityMod + sum(maxHouses of the buildings)`. A house or lean-to order is blocked
 * when the houses stand at or above it.
 */
export function housesMax(parcels: number, buildingIds: readonly string[], density: number): number {
  let sum = 0;
  for (const id of buildingIds) sum += MAX_HOUSES[id] ?? 0;
  return Math.floor(parcels * density) + sum;
}

/** The hamlet centre in parcel and tile units: the mean parcel, with the parcel that holds it. */
export interface HamletCentre {
  /** Centre parcel column and row. */
  px: number;
  py: number;
  /** Centre tile (x, y), in realm tiles. */
  tx: number;
  ty: number;
}

/** Centre of a set of parcels (hamlet.ts layout: parcel = py * perAxis + px). Reads only the parcel ids. */
export function centreOf(parcels: ReadonlySet<number>, perAxis: number): HamletCentre {
  let sx = 0;
  let sy = 0;
  for (const p of parcels) {
    sx += p % perAxis;
    sy += Math.floor(p / perAxis);
  }
  const n = Math.max(1, parcels.size);
  const mx = sx / n;
  const my = sy / n;
  return { px: Math.floor(mx), py: Math.floor(my), tx: (mx + 0.5) * PARCEL, ty: (my + 0.5) * PARCEL };
}

/**
 * Whether a parcel (px, py) lies in a zone plan (09 section 6 town plans, 11 section 9.1). Distances are parcel steps from
 * the centre parcel (cx, cy); lattices and the checker use the realm's parcel coordinates. Grove is value noise.
 */
export function zoneOk(zone: ZoneRule, px: number, py: number, cx: number, cy: number, worldSeed: number): boolean {
  const dx = px - cx;
  const dy = py - cy;
  switch (zone) {
    case 'ring':
      return Math.max(Math.abs(dx), Math.abs(dy)) % 2 >= 1;
    case 'cross':
      return Math.abs(dx) <= 1 || Math.abs(dy) <= 1;
    case 'lattice2':
      return px % 2 < 1 || py % 2 < 1;
    case 'lattice3':
      return px % 3 < 1 || py % 3 < 1;
    case 'lattice4':
      return px % 4 < 1 || py % 4 < 1;
    case 'checker':
      return (Math.floor(px / 2) + Math.floor(py / 2)) % 2 === 0;
    case 'grove':
      return noise01(0.7 * px, 0.7 * py, worldSeed) > 0.4;
  }
}

/**
 * Whether a building's anchor tile (x, y) meets a lot placement (11 section 9.1). Local coordinates are taken in the
 * parcel; the centre is the middle tile. Stair: 3 tiles above the centre row when x + y is even, 3 below when odd. Wobble:
 * the centre, or with `shift` (a 60% roll) the tile one step right of it.
 */
export function lotOk(lot: LotRule, x: number, y: number, shift: boolean): boolean {
  const lx = x % PARCEL;
  const ly = y % PARCEL;
  const c = PARCEL / 2;
  switch (lot) {
    case 'centred':
      return lx === c && ly === c;
    case 'stair':
      return ly === ((x + y) % 2 === 0 ? c - 3 : c + 3);
    case 'wobble':
      return shift ? lx === c + 1 && ly === c : lx === c && ly === c;
  }
}

/** Keeps the candidates that pass `keep`; when none pass, the candidates stand (the rule is soft: the hamlet keeps growing). */
export function narrow<T>(pool: readonly T[], keep: (t: T) => boolean): readonly T[] {
  const kept = pool.filter(keep);
  return kept.length > 0 ? kept : pool;
}
