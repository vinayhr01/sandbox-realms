/**
 * Hamlet buildings (reduced slice of 18c section 4.1 and 09 section 7). Costs are in stockpile
 * units; footprints are square side lengths in tiles. Numbers are TUNE.
 */
export interface BuildingDef {
  id: string;
  name: string;
  wood: number;
  stone: number;
  /** Side of the square footprint in tiles. */
  footprint: number;
  /** Food capacity added to the hamlet store (granary). */
  foodCapacity: number;
  /** Food produced per growth step (well). */
  foodYield: number;
  /** Housing slots for folk (house). */
  housing: number;
  /** Goods capacity added to the stockpile (storehouse). */
  storage: number;
  /** Wood produced per 100 ticks when staffed (workshop). */
  woodYield: number;
  /** Stone taken from outcrops per growth step (quarry); 0 for other buildings. */
  stoneYield?: number;
  /** Gold cost paid from the hamlet purse (18c section 4.1); absent means 0. */
  gold?: number;
}

export const BUILDINGS: readonly BuildingDef[] = [
  { id: 'house', name: 'House', wood: 10, stone: 0, footprint: 2, foodCapacity: 0, foodYield: 0, housing: 4, storage: 0, woodYield: 0 },
  { id: 'granary', name: 'Granary', wood: 8, stone: 4, footprint: 2, foodCapacity: 200, foodYield: 0, housing: 0, storage: 0, woodYield: 0 },
  { id: 'well', name: 'Well', wood: 2, stone: 6, footprint: 1, foodCapacity: 0, foodYield: 10, housing: 0, storage: 0, woodYield: 0 },
  { id: 'storehouse', name: 'Storehouse', wood: 12, stone: 6, footprint: 3, foodCapacity: 0, foodYield: 0, housing: 0, storage: 300, woodYield: 0 },
  { id: 'workshop', name: 'Workshop', wood: 14, stone: 4, footprint: 2, foodCapacity: 0, foodYield: 0, housing: 0, storage: 0, woodYield: 3 },
  // Quarry (09 section 7): works stone outcrops; yield per growth step is set by `stoneYield`.
  { id: 'quarry', name: 'Quarry', wood: 10, stone: 0, footprint: 2, foodCapacity: 0, foodYield: 0, housing: 0, storage: 0, woodYield: 0, stoneYield: 2 },
  // Garrison (18c section 4.1: 3x3, cost 0/6/2/14 wood/stone/iron/gold). Iron 2 is cut: the hamlet holds no iron.
  // Holds gear and repairs gear (09 section 7, 08 section 7.4). Its soldier and gear-capacity effects are not built.
  { id: 'garrison', name: 'Garrison', wood: 0, stone: 6, footprint: 3, foodCapacity: 0, foodYield: 0, housing: 0, storage: 0, woodYield: 0, gold: 14 },
];

export const BUILDING_BY_ID = new Map(BUILDINGS.map((b) => [b.id, b]));
