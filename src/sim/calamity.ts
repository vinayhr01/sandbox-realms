/**
 * Calamity roll (02 section 8): every 80 sim-seconds one draw from a bag weighted by `rate`,
 * filtered by Age, rules, population gates, cooldowns and live caps; then a single chance roll.
 * Numbers are TUNE. Structural context so this module does not import Sim.
 */
import type { Rng } from '../shared/rng.ts';
import { YEAR_TICKS } from '../shared/constants.ts';

export type CalamityCategory = 'nature' | 'beings';

export interface CalamityDef {
  id: string;
  category: CalamityCategory;
  rate: number;
  chance: number;
  minHamlets: number;
  minBeings: number;
  /** Ages where it may occur; empty = any. */
  agesAllow: readonly string[];
  /** Ages where it never occurs. */
  agesForbid: readonly string[];
  /** Cap on living beings of its lineage, or null. */
  maxLive: number | null;
  /** Ticks before it may repeat (02 section 8.1: 2 years nature, 3 years beings). */
  cooldownTicks: number;
}

const YEAR = YEAR_TICKS;
const nature = (
  id: string,
  rate: number,
  chance: number,
  minHamlets: number,
  minBeings: number,
  agesAllow: string[] = [],
  agesForbid: string[] = [],
): CalamityDef => ({ id, category: 'nature', rate, chance, minHamlets, minBeings, agesAllow, agesForbid, maxLive: null, cooldownTicks: 2 * YEAR });
const beings = (
  id: string,
  rate: number,
  chance: number,
  minHamlets: number,
  minBeings: number,
  agesAllow: string[] = [],
  agesForbid: string[] = [],
  maxLive: number | null = null,
): CalamityDef => ({ id, category: 'beings', rate, chance, minHamlets, minBeings, agesAllow, agesForbid, maxLive, cooldownTicks: 3 * YEAR });

/** The calamity table of 02 section 8.2. */
export const CALAMITIES: readonly CalamityDef[] = [
  nature('whirlwind', 3, 0.5, 3, 100, ['weeping', 'cinder', 'discord', 'marvels', 'silver_moon']),
  nature('heat_spell', 4, 0.5, 0, 0, ['scorch']),
  nature('skyfall', 5, 0.5, 3, 400, [], ['dawn', 'scorch']),
  nature('tremor', 3, 0.4, 5, 400, [], ['dawn', 'scorch']),
  beings('magmaling_uprising', 2, 0.9, 5, 300, ['discord']),
  beings('wailwisp_wake', 2, 0.9, 5, 300, ['gloom', 'frostbound']),
  beings('waddlefin_surge', 3, 0.9, 5, 100, ['frostbound'], [], 5),
  beings('gourd_harvest', 1, 0.9, 5, 800, ['scorch', 'marvels'], [], 5),
  beings('stormwyrm_descent', 1, 0.9, 10, 3000, ['discord', 'long_night', 'gloom'], [], 1),
  beings('ember_raiders', 1, 0.9, 10, 700, ['cinder'], [], 10),
  beings('skiff_visitors', 1, 0.9, 10, 1500, ['silver_moon'], [], 1),
  beings('goo_spread', 1, 0.9, 10, 700, ['cinder'], [], 10),
  beings('gloom_bloom', 1, 0.9, 10, 700, ['silver_moon'], [], 10),
  beings('rogue_sorcerer', 1, 0.8, 5, 400, [], ['dawn'], 1),
  beings('crypt_stirring', 2, 0.9, 4, 200, ['long_night', 'gloom']),
  beings('mind_fog', 2, 0.7, 5, 150, [], ['dawn', 'marvels']),
];

export const CALAMITY_BY_ID = new Map(CALAMITIES.map((c) => [c.id, c]));

/** Inputs to one roll. `cooldowns` maps a calamity id to the tick it may next occur. */
export interface CalamityContext {
  rng: Rng;
  tick: number;
  /** Current Age id. */
  age: string;
  /** Realm Rule lookup. */
  isOn(id: string): boolean;
  cooldowns: Map<string, number>;
  hamlets: number;
  beings: number;
  /** Living beings of a calamity's lineage (for maxLive). */
  liveCount(id: string): number;
}

/** Category rule that gates each calamity category (02 section 8.1 step 3). */
function categoryRule(category: CalamityCategory): string {
  return category === 'nature' ? 'natural_calamities' : 'monstrous_calamities';
}

/** True when a calamity may occur in this Age. */
function allowedInAge(def: CalamityDef, age: string): boolean {
  if (def.agesForbid.includes(age)) return false;
  return def.agesAllow.length === 0 || def.agesAllow.includes(age);
}

/**
 * One calamity roll (02 section 8.1). Builds the bag from Age-allowed calamities weighted by rate,
 * draws one entry uniformly, and rejects it on any gate. On success records the cooldown and returns
 * the id; otherwise returns null. Only the drawn entry is checked, so a rejection wastes the roll.
 */
export function calamityRoll(ctx: CalamityContext): string | null {
  const bag: CalamityDef[] = [];
  for (const def of CALAMITIES) {
    if (!allowedInAge(def, ctx.age)) continue;
    for (let k = 0; k < def.rate; k++) bag.push(def);
  }
  if (bag.length === 0) return null;
  const def = bag[ctx.rng.int(bag.length)];
  if (!def) return null;
  if (!ctx.isOn(categoryRule(def.category))) return null;
  if (ctx.hamlets < def.minHamlets || ctx.beings < def.minBeings) return null;
  if ((ctx.cooldowns.get(def.id) ?? 0) > ctx.tick) return null;
  if (def.maxLive !== null && ctx.liveCount(def.id) >= def.maxLive) return null;
  if (ctx.rng.next() >= def.chance) return null;
  ctx.cooldowns.set(def.id, ctx.tick + def.cooldownTicks);
  return def.id;
}
