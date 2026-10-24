import type { Rng } from '../shared/rng.ts';
import { YEAR_TICKS } from '../shared/constants.ts';

/**
 * Ages (02 section 5): eight slots rotate through world-wide eras that modify weather, growth,
 * temperature and mood hooks. Numbers are TUNE; the table follows 02 section 5.3.
 */
export interface AgeDef {
  id: string;
  name: string;
  yearsMin: number;
  yearsMax: number;
  /** 1-based default slots (02 section 5.2). Empty = only reachable by Veiled or player edits. */
  defaultSlots: readonly number[];
  /** Night level target 0..0.6 (0 for day ages). */
  nightTarget: number;
  tempDamageBonus: number;
  fireSpreadMult: number;
  biomeGrowthBonus: number;
  boostedBiomes: readonly string[];
  growVegetation: boolean;
  cropsGrow: boolean;
  freezeWorld: boolean;
  thawWorld: boolean;
  thawMountains: boolean;
  /** Clouds drawn for this age: [cloud id, weight]. */
  clouds: readonly (readonly [string, number])[];
  flags: readonly string[];
  /** Veiled resolves to one of the other ages when its slot is entered. */
  veiled: boolean;
}

const dawn: AgeDef = {
  id: 'dawn',
  name: 'Age of Dawn',
  yearsMin: 32,
  yearsMax: 52,
  defaultSlots: [1, 3, 5, 6],
  nightTarget: 0,
  tempDamageBonus: 6,
  fireSpreadMult: 1,
  biomeGrowthBonus: 0,
  boostedBiomes: ['verdant_reach'],
  growVegetation: true,
  cropsGrow: true,
  freezeWorld: false,
  thawWorld: true,
  thawMountains: false,
  clouds: [['cloud_plain', 1]],
  flags: [],
  veiled: false,
};

export const AGES: readonly AgeDef[] = [
  dawn,
  {
    id: 'scorch',
    name: 'Scorch Age',
    yearsMin: 32,
    yearsMax: 52,
    defaultSlots: [],
    nightTarget: 0,
    tempDamageBonus: 14,
    fireSpreadMult: 2,
    biomeGrowthBonus: 3,
    boostedBiomes: ['dunesea', 'amberveldt'],
    growVegetation: false,
    cropsGrow: true,
    freezeWorld: false,
    thawWorld: true,
    thawMountains: true,
    clouds: [['cloud_plain', 1]],
    flags: ['harsh_light'],
    veiled: false,
  },
  {
    id: 'long_night',
    name: 'Long Night',
    yearsMin: 32,
    yearsMax: 52,
    defaultSlots: [2, 7],
    nightTarget: 0.6,
    tempDamageBonus: -4,
    fireSpreadMult: 1,
    biomeGrowthBonus: -2,
    boostedBiomes: ['blightmoor'],
    growVegetation: true,
    cropsGrow: false,
    freezeWorld: false,
    thawWorld: false,
    thawMountains: false,
    clouds: [['cloud_plain', 1]],
    flags: ['night'],
    veiled: false,
  },
  {
    id: 'weeping',
    name: 'Weeping Age',
    yearsMin: 32,
    yearsMax: 52,
    defaultSlots: [2, 7],
    nightTarget: 0,
    tempDamageBonus: 0,
    fireSpreadMult: 1,
    biomeGrowthBonus: 5,
    boostedBiomes: ['sodden_hollow', 'sporeglen', 'steamthicket'],
    growVegetation: true,
    cropsGrow: true,
    freezeWorld: false,
    thawWorld: true,
    thawMountains: false,
    clouds: [
      ['cloud_shower', 5],
      ['cloud_storm', 1],
      ['cloud_plain', 2],
    ],
    flags: ['rain'],
    veiled: false,
  },
  {
    id: 'silver_moon',
    name: 'Silver Moon',
    yearsMin: 32,
    yearsMax: 52,
    defaultSlots: [2, 7],
    nightTarget: 0.4,
    tempDamageBonus: -3,
    fireSpreadMult: 1,
    biomeGrowthBonus: 0,
    boostedBiomes: ['prism_hollow'],
    growVegetation: true,
    cropsGrow: true,
    freezeWorld: false,
    thawWorld: true,
    thawMountains: false,
    clouds: [
      ['cloud_shower', 5],
      ['cloud_plain', 5],
    ],
    flags: ['night', 'moon'],
    veiled: false,
  },
  {
    id: 'discord',
    name: 'Age of Discord',
    yearsMin: 32,
    yearsMax: 52,
    defaultSlots: [],
    nightTarget: 0,
    tempDamageBonus: 0,
    fireSpreadMult: 1,
    biomeGrowthBonus: 0,
    boostedBiomes: ['cinderfields'],
    growVegetation: true,
    cropsGrow: true,
    freezeWorld: false,
    thawWorld: true,
    thawMountains: true,
    clouds: [['cloud_wrath', 1]],
    flags: ['chaos'],
    veiled: false,
  },
  {
    id: 'marvels',
    name: 'Age of Marvels',
    yearsMin: 32,
    yearsMax: 52,
    defaultSlots: [2, 7],
    nightTarget: 0,
    tempDamageBonus: 0,
    fireSpreadMult: 1,
    biomeGrowthBonus: 0,
    boostedBiomes: ['gleamwood', 'sugarvale'],
    growVegetation: true,
    cropsGrow: true,
    freezeWorld: false,
    thawWorld: false,
    thawMountains: false,
    clouds: [
      ['cloud_arcane', 5],
      ['cloud_plain', 1],
    ],
    flags: ['magic'],
    veiled: false,
  },
  {
    id: 'frostbound',
    name: 'Frostbound Age',
    yearsMin: 28,
    yearsMax: 38,
    defaultSlots: [],
    nightTarget: 0,
    tempDamageBonus: 5,
    fireSpreadMult: 1,
    biomeGrowthBonus: -20,
    boostedBiomes: ['rimewaste'],
    growVegetation: true,
    cropsGrow: false,
    freezeWorld: true,
    thawWorld: false,
    thawMountains: false,
    clouds: [['cloud_flurry', 1]],
    flags: ['winter'],
    veiled: false,
  },
  {
    id: 'cinder',
    name: 'Cinder Age',
    yearsMin: 32,
    yearsMax: 52,
    defaultSlots: [],
    nightTarget: 0,
    tempDamageBonus: 0,
    fireSpreadMult: 1,
    biomeGrowthBonus: -4,
    boostedBiomes: [],
    growVegetation: true,
    cropsGrow: true,
    freezeWorld: false,
    thawWorld: false,
    thawMountains: false,
    clouds: [['cloud_cinder', 1]],
    flags: ['ash'],
    veiled: false,
  },
  {
    id: 'gloom',
    name: 'Age of Gloom',
    yearsMin: 28,
    yearsMax: 38,
    defaultSlots: [],
    nightTarget: 0.6,
    tempDamageBonus: 3,
    fireSpreadMult: 1,
    biomeGrowthBonus: -2,
    boostedBiomes: ['rimewaste', 'blightmoor'],
    growVegetation: true,
    cropsGrow: false,
    freezeWorld: true,
    thawWorld: false,
    thawMountains: false,
    clouds: [['cloud_flurry', 1]],
    flags: ['night', 'winter'],
    veiled: false,
  },
  {
    id: 'veiled',
    name: 'Veiled Age',
    yearsMin: 32,
    yearsMax: 52,
    defaultSlots: [4, 8],
    nightTarget: 0,
    tempDamageBonus: 0,
    fireSpreadMult: 1,
    biomeGrowthBonus: 0,
    boostedBiomes: [],
    growVegetation: true,
    cropsGrow: true,
    freezeWorld: false,
    thawWorld: false,
    thawMountains: false,
    clouds: [],
    flags: [],
    veiled: true,
  },
];

export const AGE_BY_ID = new Map(AGES.map((a) => [a.id, a]));
const NORMAL_AGES = AGES.filter((a) => !a.veiled);

export interface AgeState {
  /** Eight slot ids; index 0 is slot 1. */
  slots: string[];
  slotIndex: number;
  /** Id of the age in effect (the resolved id when the slot was Veiled). */
  current: string;
  /** Sim ticks elapsed in the current age, weighted by the speed multiplier. */
  elapsed: number;
  durationTicks: number;
  speedMultiplier: number;
  startedAtTick: number;
}

/** Slot pools fill: slots 2 and 7 are linked (they never repeat the same age). 02 section 5.2. */
export function fillDefaultSlots(rng: Rng): string[] {
  const slots: string[] = new Array<string>(8).fill('dawn');
  const pool = ['long_night', 'weeping', 'silver_moon', 'marvels'];
  const pick = (list: readonly string[]): string => list[rng.int(list.length)] ?? list[0] ?? 'dawn';
  const slot2 = pick(pool);
  let slot7 = pick(pool);
  while (slot7 === slot2) slot7 = pick(pool);
  slots[1] = slot2;
  slots[6] = slot7;
  slots[3] = 'veiled';
  slots[7] = 'veiled';
  return slots;
}

export function newAgeState(rng: Rng, startTick: number): AgeState {
  const slots = fillDefaultSlots(rng);
  const state: AgeState = {
    slots,
    slotIndex: 0,
    current: 'dawn',
    elapsed: 0,
    durationTicks: 0,
    speedMultiplier: 1,
    startedAtTick: startTick,
  };
  enterAge(state, 'dawn', rng, startTick);
  return state;
}

/** Duration roll: uniform over whole years in [yearsMin, yearsMax] expressed in ticks (02 section 5.1). */
export function rollDuration(def: AgeDef, rng: Rng): number {
  const minTicks = def.yearsMin * YEAR_TICKS;
  const maxTicks = def.yearsMax * YEAR_TICKS;
  return minTicks + rng.int(maxTicks - minTicks + 1);
}

function enterAge(state: AgeState, id: string, rng: Rng, tick: number): void {
  const def = AGE_BY_ID.get(id) ?? dawn;
  state.current = def.id;
  state.elapsed = 0;
  state.durationTicks = rollDuration(def, rng);
  state.startedAtTick = tick;
}

/**
 * Advances the age clock by one tick. Returns the id of a newly entered age or null.
 * Speed multiplier 0 freezes progress (02 edge cases). Disabled ages are skipped (02 section 5.2).
 */
export function tickAge(state: AgeState, rng: Rng, tick: number, isEnabled: (id: string) => boolean): string | null {
  if (state.speedMultiplier <= 0) return null;
  state.elapsed += state.speedMultiplier;
  if (state.elapsed < state.durationTicks) return null;
  state.slotIndex = (state.slotIndex + 1) % 8;
  let next = resolveSlot(state, state.slotIndex, rng);
  for (let guard = 0; guard < 8 && !isEnabled(next); guard++) {
    state.slotIndex = (state.slotIndex + 1) % 8;
    next = resolveSlot(state, state.slotIndex, rng);
  }
  if (!isEnabled(next)) next = 'dawn';
  enterAge(state, next, rng, tick);
  return next;
}

/** Veiled slots resolve to a uniform normal age when entered (02 section 5.2). */
function resolveSlot(state: AgeState, index: number, rng: Rng): string {
  const id = state.slots[index] ?? 'dawn';
  if (id !== 'veiled') return id;
  const pick = NORMAL_AGES[rng.int(NORMAL_AGES.length)];
  return pick?.id ?? 'dawn';
}

export function ageDef(state: AgeState): AgeDef {
  return AGE_BY_ID.get(state.current) ?? dawn;
}
