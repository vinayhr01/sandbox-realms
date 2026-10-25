/**
 * Hamlet buildings: the 18c section 4.1 civic buildings the sim can run, plus the legacy slice entries
 * (house, well, storehouse, workshop) that saves may still hold. Costs are in stockpile units. Iron costs are paid
 * from the hamlet iron store (`iron`, fed by iron deposits); only the slipway and the brazier tower carry one (18e). The other 18c iron
 * costs stay cut, as garrison and bazaar already were.
 * Footprints are in tiles: `footprint` is the width (x), `height` the depth (y), absent meaning square.
 * Numbers are TUNE. Construction takes a site and builder progress (hamlet.ts SITE_PROGRESS, one value for every def),
 * so the 18c progress times are not used.
 *
 * Cut from the 09 catalogue (not in this table; reasons in DECISIONS.md "Settlements round 4"):
 * springwell, drill_post, watchspire, shrine, archive, mill_a, mill_b,
 * farmstead, smithy, apothecary, palisade, gatehouse, beacon_tower, lecture_stone, pyre, and the
 * 18e extended set except quarry_lodge and brazier_tower (bastion, slipway, arsenal, paddock, sea_lantern,
 * stargazer, hide_works, brewhouse, bake_oven, bee_shed, grove_lodge). The 18c section 4.2 wild, hazard,
 * resource and wonder objects are map fixtures, not hamlet buildings, and are not in this table.
 */
import type { BoatKind } from '../boats/types.ts';

/** Jobs a building can employ (09 section 8). Output and rules live in jobs.ts. */
export type JobId = 'forager' | 'miner' | 'woodcutter';

export interface JobSlot {
  job: JobId;
  /** Workers the building can employ. */
  slots: number;
}

export interface BuildingDef {
  id: string;
  name: string;
  /** 18c section 4 role (core, store, house, civic, defence, work, trade, food, ...). Absent on legacy entries. */
  role?: string;
  wood: number;
  stone: number;
  /** Gold cost paid from the hamlet purse (18c section 4.1); absent means 0. */
  gold?: number;
  /** Iron cost paid from the hamlet iron store (18e slipway); absent means 0. */
  iron?: number;
  /** Width in tiles. spec-model.ts (UI) prints this as a square footprint. */
  footprint: number;
  /** Depth in tiles; absent means square (equal to `footprint`). */
  height?: number;
  /** Hit points from 18c section 4 (data only; buildings take no damage in this sim). */
  hp?: number;
  /** Food capacity added to the hamlet store (granary). */
  foodCapacity: number;
  /** Food produced per growth step without workers (legacy well). */
  foodYield: number;
  /** Housing slots for folk. */
  housing: number;
  /** Goods capacity recorded on the building; the sim does not cap stock by it (see DECISIONS round 4). */
  storage: number;
  /** Wood produced per growth step without workers (legacy workshop). */
  woodYield: number;
  /** Extra stone per miner from the outcrops, as a fraction (18e quarry_lodge). */
  outcropBonus?: number;
  /** Housing comfort: mood a resident gets from this building's slots (09 section 5; absent 0). */
  housingMood?: number;
  /** Hamlet mood while this building stands (09 section 9 comfort, TUNE; absent 0). */
  moodBonus?: number;
  /** Buildings that must already stand in the hamlet before this one can be placed (09 section 6). */
  needs?: readonly string[];
  /** Job slots this building employs (09 section 8). */
  jobs?: readonly JobSlot[];
  /** Dock only: the boat kinds it berths (10 section 13). Absent for buildings that are not docks. */
  boatTypes?: readonly BoatKind[];
}

const NONE = { foodCapacity: 0, foodYield: 0, housing: 0, storage: 0, woodYield: 0 } as const;

export const BUILDINGS: readonly BuildingDef[] = [
  // Legacy slice entries (not 18c ids). Kept so saves load; the hamlet no longer places them.
  { id: 'house', name: 'House', wood: 10, stone: 0, footprint: 2, ...NONE, housing: 4 },
  { id: 'well', name: 'Well', wood: 2, stone: 6, footprint: 1, ...NONE, foodYield: 10 },
  { id: 'storehouse', name: 'Storehouse', wood: 12, stone: 6, footprint: 3, ...NONE, storage: 300 },
  { id: 'workshop', name: 'Workshop', wood: 14, stone: 4, footprint: 2, ...NONE, woodYield: 3 },

  // 18c section 4.1 civic buildings the sim runs.
  { id: 'hearth_fire', name: 'Hearth Fire', role: 'core', wood: 0, stone: 0, footprint: 2, hp: 120, ...NONE, jobs: [{ job: 'forager', slots: 4 }] },
  { id: 'larder', name: 'Larder', role: 'store', wood: 0, stone: 0, footprint: 2, hp: 200, ...NONE },
  { id: 'granary', name: 'Granary', role: 'store', wood: 6, stone: 4, footprint: 3, height: 2, hp: 250, ...NONE, foodCapacity: 200 },
  { id: 'quarry', name: 'Quarry', role: 'work', wood: 0, stone: 0, gold: 12, footprint: 3, height: 3, hp: 300, ...NONE, jobs: [{ job: 'miner', slots: 5 }] },
  { id: 'lumber_camp', name: 'Lumber Camp', role: 'work', wood: 3, stone: 0, footprint: 2, height: 3, hp: 150, ...NONE, jobs: [{ job: 'woodcutter', slots: 3 }] },
  { id: 'lean_to', name: 'Lean-to', role: 'house', wood: 1, stone: 0, footprint: 1, hp: 40, ...NONE, housing: 2, housingMood: 5, needs: ['hearth_fire'] },
  { id: 'dwelling_1', name: 'Dwelling I', role: 'house', wood: 5, stone: 0, footprint: 2, hp: 90, ...NONE, housing: 3, housingMood: 6, needs: ['lean_to'] },
  { id: 'dwelling_2', name: 'Dwelling II', role: 'house', wood: 4, stone: 0, footprint: 2, hp: 140, ...NONE, housing: 4, housingMood: 7, needs: ['great_hall_1', 'dwelling_1'] },
  { id: 'dwelling_3', name: 'Dwelling III', role: 'house', wood: 0, stone: 5, footprint: 2, hp: 190, ...NONE, housing: 4, housingMood: 7, needs: ['great_hall_2', 'dwelling_2'] },
  { id: 'dwelling_4', name: 'Dwelling IV', role: 'house', wood: 0, stone: 10, footprint: 3, height: 2, hp: 240, ...NONE, housing: 5, housingMood: 9, needs: ['great_hall_2', 'dwelling_3'] },
  { id: 'dwelling_5', name: 'Dwelling V', role: 'house', wood: 0, stone: 14, footprint: 3, hp: 330, ...NONE, housing: 6, housingMood: 10, needs: ['great_hall_3', 'dwelling_4'] },
  { id: 'dwelling_6', name: 'Dwelling VI', role: 'house', wood: 0, stone: 18, gold: 9, footprint: 3, hp: 380, ...NONE, housing: 7, housingMood: 11, needs: ['great_hall_3', 'dwelling_5'] },
  { id: 'great_hall_1', name: 'Great Hall I', role: 'core', wood: 9, stone: 5, footprint: 3, hp: 190, ...NONE, housing: 5, housingMood: 10, needs: ['hearth_fire'] },
  // 09 says great_hall_2 needs a dwelling_3 while dwelling_3 needs great_hall_2 (a cycle); here it needs dwelling_2.
  { id: 'great_hall_2', name: 'Great Hall II', role: 'core', wood: 0, stone: 9, gold: 18, footprint: 4, hp: 380, ...NONE, housing: 8, housingMood: 15, needs: ['dwelling_2'] },
  { id: 'great_hall_3', name: 'Great Hall III', role: 'core', wood: 0, stone: 14, gold: 90, footprint: 5, height: 4, hp: 580, ...NONE, housing: 12, housingMood: 20, needs: ['monument', 'quarry', 'garrison'] },
  { id: 'monument', name: 'Monument', role: 'civic', wood: 0, stone: 6, gold: 22, footprint: 2, hp: 400, ...NONE, moodBonus: 10, needs: ['great_hall_2'] },
  // Waystop: the 18c rest stop. 09 gives it no build order, so its gates are TUNE (see hamlet.ts).
  { id: 'waystop', name: 'Waystop', role: 'trade', wood: 8, stone: 4, gold: 25, footprint: 3, hp: 300, ...NONE, moodBonus: 10, needs: ['great_hall_1'] },
  { id: 'garrison', name: 'Garrison', role: 'defence', wood: 0, stone: 6, gold: 14, footprint: 3, hp: 600, ...NONE, needs: ['great_hall_2'] },
  // 18c bazaar (iron 2 cut). Its effect is the supply-side gold conversion in trade.ts (09 10.5 default design).
  { id: 'bazaar', name: 'Bazaar', role: 'trade', wood: 8, stone: 5, gold: 90, footprint: 4, height: 3, hp: 500, ...NONE, needs: [] },
  // 18e section 3.1 quarry_lodge: one extra digger and +25% outcrop yield, beside a quarry (the 6-tile range is not checked).
  { id: 'quarry_lodge', name: 'Quarry Lodge', role: 'work', wood: 6, stone: 6, gold: 10, footprint: 3, height: 2, hp: 300, ...NONE, outcropBonus: 0.25, jobs: [{ job: 'miner', slots: 1 }], needs: ['quarry'] },
  // Docks (18c 4.1 rows; 10 section 13). Ocean siting and the boat build are in src/sim/boats. Fisher's Pier is
  // the base dock; the harbor is its upgrade. The transport boat is not on these rows: a hamlet with a slipway lists
  // it on its docks (boats.ts docksOf).
  { id: 'fishers_pier', name: "Fisher's Pier", role: 'food', wood: 9, stone: 0, footprint: 3, height: 2, hp: 200, ...NONE, boatTypes: ['fishing'] },
  { id: 'harbor', name: 'Harbor', role: 'trade', wood: 9, stone: 6, footprint: 3, height: 3, hp: 400, ...NONE, boatTypes: ['fishing', 'trading'], needs: ['fishers_pier'] },
  // 18e section 3.1 slipway: cost 14/6/2/30, footprint 4x3, hp 500, needs a harbor in the Hamlet. It unlocks the transport
  // boat on the Hamlet's docks and builds them every 150 ticks (boats.ts). Not modelled: its 300 progress (one
  // SITE_PROGRESS for every def), its 2 shipwright jobs (no such job), and the boat hp +20% (no per-boat max hp).
  { id: 'slipway', name: 'Slipway', role: 'trade', wood: 14, stone: 6, iron: 2, gold: 30, footprint: 4, height: 3, hp: 500, ...NONE, needs: ['harbor'] },
  // 18e section 3.1 brazier_tower (Fire Tower): cost 3/16/2/20, 2x2, hp 1800, prerequisite garrison. It is the owner of
  // blaze_sphere (projectiles.ts brazierStep). Its gunner job is not built (no soldier job in the sim), so it employs nobody.
  { id: 'brazier_tower', name: 'Brazier Tower', role: 'defence', wood: 3, stone: 16, iron: 2, gold: 20, footprint: 2, hp: 1800, ...NONE, needs: ['garrison'] },
];

export const BUILDING_BY_ID = new Map(BUILDINGS.map((b) => [b.id, b]));
