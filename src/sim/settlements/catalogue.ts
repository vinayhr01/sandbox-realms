/**
 * Hamlet buildings (reduced slice of 18c section 4.1 and 09 section 3). Costs are in stockpile
 * units; footprints are square side lengths in tiles. Numbers are TUNE.
 */
export interface BuildingDef {
  id: string;
  name: string;
  wood: number;
  stone: number;
  /** Side of the square footprint in tiles. */
  footprint: number;
  /** Food capacity added to the hamlet store (granary) or yield per tick (well). */
  foodCapacity: number;
  /** Housing slots for folk (house). */
  housing: number;
  /** Goods capacity added to the stockpile (storehouse). */
  storage: number;
  /** Wood produced per 100 ticks when staffed (workshop). */
  woodYield: number;
}

export const BUILDINGS: readonly BuildingDef[] = [
  { id: 'house', name: 'House', wood: 10, stone: 0, footprint: 2, foodCapacity: 0, housing: 4, storage: 0, woodYield: 0 },
  { id: 'granary', name: 'Granary', wood: 8, stone: 4, footprint: 2, foodCapacity: 200, housing: 0, storage: 0, woodYield: 0 },
  { id: 'well', name: 'Well', wood: 2, stone: 6, footprint: 1, foodCapacity: 0, housing: 0, storage: 0, woodYield: 0 },
  { id: 'storehouse', name: 'Storehouse', wood: 12, stone: 6, footprint: 3, foodCapacity: 0, housing: 0, storage: 300, woodYield: 0 },
  { id: 'workshop', name: 'Workshop', wood: 14, stone: 4, footprint: 2, foodCapacity: 0, housing: 0, storage: 0, woodYield: 3 },
];

export const BUILDING_BY_ID = new Map(BUILDINGS.map((b) => [b.id, b]));
