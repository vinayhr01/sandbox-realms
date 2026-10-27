/**
 * Ground kinds (18c section 1; bands and colours from there, numbers TUNE). Table order defines
 * the byte ids stored in the `ground` array; `G` gives readable constants for code.
 * Elevation bands (`band`) apply to the generated kinds only; pits, molten, slime and
 * special charges are placed by systems, never by height.
 */
import { plainName } from './plain-names.ts';

export type GroundLayer = 'water' | 'land' | 'blocked' | 'molten' | 'slime';

export interface GroundKind {
  id: number;
  key: string;
  name: string;
  layer: GroundLayer;
  /** Lower bound of the elevation band, or null when the kind is not placed by height. */
  band: number | null;
  color: string;
  /** Walk multiplier for beings (18c section 0). */
  walk: number;
  /** Sea kinds refill hollows and count as liquid for boats. */
  sea: boolean;
  flammable: boolean;
  canFreeze: boolean;
  fastFreeze: boolean;
  /** Result of freezing (key), or null. */
  frz: string | null;
  /** Result of a raise step and of a lower step (keys), or null at the ends of a chain. */
  up: string | null;
  down: string | null;
  /** Damage per hit tick to beings standing here (molten 120, slime 200; 18c). */
  damages: number;
  /** Creep grounds spread onto life (18c 'C'). */
  creep: boolean;
  /** Hollows: pit kinds that refill to `fillsTo` from the sea. */
  fillsTo: string | null;
  /** Shoal-style snap band height for the shoreSnap generation step (03 section 5). */
  snapBand: number;
  /** Blast radius when this ground explodes on ignition (18c section 1 charges). */
  blastRadius: number;
}

const base = {
  layer: 'land' as GroundLayer,
  walk: 1,
  sea: false,
  flammable: false,
  canFreeze: false,
  fastFreeze: false,
  frz: null,
  up: null,
  down: null,
  damages: 0,
  creep: false,
  fillsTo: null,
  snapBand: 0,
  blastRadius: 0,
};

const def = (id: number, key: string, name: string, color: string, extra: Partial<GroundKind> = {}): GroundKind => ({
  ...base,
  id,
  key,
  name: plainName('ground', key, name),
  color,
  band: null,
  ...extra,
});

export const GROUNDS: readonly GroundKind[] = [
  def(0, 'deepmere', 'Deepmere', '#2E67BD', { layer: 'water', band: 0, walk: 0.1, sea: true, up: 'dug_midmere', down: 'dug_deepmere' }),
  def(1, 'midmere', 'Midmere', '#3B7DD4', { layer: 'water', band: 35, walk: 0.1, sea: true, up: 'dug_shoal', down: 'dug_midmere' }),
  def(2, 'shoal', 'Shoal', '#5BB4F2', { layer: 'water', band: 75, walk: 0.1, sea: true, canFreeze: true, fastFreeze: true, frz: 'rimeplate', up: 'strand', down: 'dug_shoal', snapBand: 0 }),
  def(3, 'dug_deepmere', 'Dug Deepmere', '#878787', { up: 'dug_midmere', fillsTo: 'deepmere' }),
  def(4, 'dug_midmere', 'Dug Midmere', '#A3A3A3', { up: 'dug_shoal', down: 'dug_deepmere', fillsTo: 'midmere' }),
  def(5, 'dug_shoal', 'Dug Shoal', '#C4C4C4', { up: 'strand', down: 'dug_midmere', fillsTo: 'shoal' }),
  def(6, 'strand', 'Strand', '#F2E39A', { band: 101, walk: 0.55, canFreeze: true, frz: 'rimeplate', up: 'lowloam', down: 'dug_shoal', snapBand: 0 }),
  def(7, 'lowloam', 'Lowloam', '#DE9650', { band: 112, canFreeze: true, flammable: false, up: 'highloam', down: 'strand' }),
  def(8, 'highloam', 'Highloam', '#B26B38', { band: 133, canFreeze: true, up: 'knoll', down: 'lowloam', snapBand: 12 }),
  def(9, 'knoll', 'Knoll', '#5E605E', { band: 197, canFreeze: true, up: 'crag', down: 'highloam', snapBand: 4 }),
  def(10, 'crag', 'Crag', '#3F4444', { band: 213, layer: 'blocked', walk: 0.5, canFreeze: true, up: 'pinnacle', down: 'knoll', snapBand: 4 }),
  def(11, 'pinnacle', 'Pinnacle', '#303030', { band: 233, layer: 'blocked', walk: 0.5, canFreeze: true, down: 'crag', snapBand: 4 }),
  def(12, 'molten_1', 'Molten Ember', '#F2331A', { layer: 'molten', walk: 0.2, damages: 120, up: 'molten_2', down: 'strand' }),
  def(13, 'molten_2', 'Molten Orange', '#FF6A08', { layer: 'molten', walk: 0.2, damages: 120, up: 'molten_3', down: 'molten_1' }),
  def(14, 'molten_3', 'Molten Gold', '#FFB11A', { layer: 'molten', walk: 0.2, damages: 120, up: 'molten_4', down: 'molten_2' }),
  def(15, 'molten_4', 'Molten Core', '#FFE04A', { layer: 'molten', walk: 0.2, damages: 120, down: 'molten_3' }),
  def(16, 'slagooze', 'Slag Ooze', '#5C628E', { layer: 'slime', walk: 0.15, damages: 200, flammable: true, down: 'dug_deepmere' }),
  def(17, 'rimeplate', 'Rimeplate', '#CDE8F4', { walk: 1.3, canFreeze: false, down: 'shoal' }),
  def(18, 'cinderscar', 'Cinderscar', '#4A3C38', {}),
  def(19, 'wayworn', 'Wayworn Path', '#BC9378', { walk: 1.4 }),
  def(20, 'tilled', 'Tilled Row', '#A5602E', { flammable: true }),
  def(21, 'wickline', 'Wickline', '#7E4848', { flammable: true }),
  def(22, 'thunderpowder', 'Thunderpowder', '#A00000', { flammable: true, blastRadius: 9 }),
  def(23, 'timedpowder', 'Timedpowder', '#7A0000', { flammable: true, blastRadius: 7 }),
  def(24, 'festive_glimmer', 'Festive Glimmer', '#B040CC', {}),
  def(25, 'quagmire', 'Quagmire', '#4B4638', { walk: 0.55 }),
  def(26, 'webbing', 'Webbing', '#E8E8E0', { walk: 0.5, flammable: true }),
  def(27, 'charge_water', 'Tide Charge', '#3B4FA8', { flammable: true, blastRadius: 9 }),
  def(28, 'charge_mine', 'Step Charge', '#5C4A33', { flammable: true, blastRadius: 3 }),
  def(29, 'hidden_charge', 'Hidden Charge', '#5C4A33', { flammable: true, blastRadius: 6 }),
  def(30, 'gloomgrowth', 'Gloomgrowth', '#E0407A', { walk: 0.8, creep: true, flammable: true, down: 'lowloam' }),
  def(31, 'bloatmoss', 'Bloatmoss', '#3FC03C', { walk: 0.8, creep: true, flammable: true, down: 'lowloam' }),
  def(32, 'gourdgrowth', 'Gourdgrowth', '#8A8E34', { walk: 0.8, creep: true, flammable: true, down: 'lowloam' }),
];

export const GROUND_COUNT = GROUNDS.length;

/** Readable constants for ground ids. Keep in sync with the table above (checked in tests). */
export const G = {
  deepmere: 0,
  midmere: 1,
  shoal: 2,
  dug_deepmere: 3,
  dug_midmere: 4,
  dug_shoal: 5,
  strand: 6,
  lowloam: 7,
  highloam: 8,
  knoll: 9,
  crag: 10,
  pinnacle: 11,
  molten_1: 12,
  molten_2: 13,
  molten_3: 14,
  molten_4: 15,
  slagooze: 16,
  rimeplate: 17,
  cinderscar: 18,
  wayworn: 19,
  tilled: 20,
  wickline: 21,
  thunderpowder: 22,
  timedpowder: 23,
  festive_glimmer: 24,
  quagmire: 25,
  webbing: 26,
  charge_water: 27,
  charge_mine: 28,
  hidden_charge: 29,
  gloomgrowth: 30,
  bloatmoss: 31,
  gourdgrowth: 32,
} as const;

const byKey = new Map(GROUNDS.map((g) => [g.key, g]));

export function ground(id: number): GroundKind {
  return GROUNDS[id] ?? GROUNDS[0]!;
}

export function groundId(key: string): number {
  const g = byKey.get(key);
  if (!g) throw new RangeError(`unknown ground ${key}`);
  return g.id;
}

/** Looks up a ground id's key; unknown ids return 'unknown' (never throws in the render path). */
export function groundKey(id: number): string {
  return GROUNDS[id]?.key ?? 'unknown';
}

/** Kinds placed by elevation, sorted by band ascending (generation and raise/lower use these). */
export const BANDED: readonly GroundKind[] = GROUNDS.filter((g) => g.band !== null).sort((a, b) => (a.band ?? 0) - (b.band ?? 0));

/**
 * Precomputed elevation -> ground id table (256 entries). A tile gets the banded kind whose
 * band is the greatest value <= elevation (01 section 4).
 */
export const GROUND_BY_ELEVATION: Uint8Array = (() => {
  const table = new Uint8Array(256);
  for (let e = 0; e < 256; e++) {
    let best = 0;
    for (const g of BANDED) {
      if ((g.band ?? 0) <= e) best = g.id;
    }
    table[e] = best;
  }
  return table;
})();
