/**
 * Dialect phonology draw (11 section 6.5, reduced). Run when a dialect is founded or diverges. It draws from its own stream,
 * seeded by hash from the world seed (names.ts nameSeed), never from the sim's RNG streams, so founding a dialect does not
 * move the simulation. Reduced: the data and the draws the spec states are here (content/dialect-phonology.ts). Not built:
 * the syllable assembly (the spec does not say which shape letter reads which inventory), the diphthong step that depends on
 * it, makeWord, the affixes (they need syllables and the separator weights, which the spec does not give), and the concept
 * slots. See DECISIONS.md "Dialect phonology close 10".
 */
import { createRng, type Rng } from '../../shared/rng.ts';
import {
  INVENTORY_ITEMS,
  INVENTORY_KEYS,
  INVENTORY_SIZE,
  KEEP_MAX,
  KEEP_MIN,
  SYLLABLE_COUNT_MAX,
  SYLLABLE_COUNT_MIN,
  SYLLABLE_SLOTS,
  WORD_PATTERN_COUNT_MAX,
  WORD_PATTERN_COUNT_MIN,
  WORD_PATTERN_POOL,
  WORD_WEIGHT_MAX,
  WORD_WEIGHT_MIN,
  type InventoryKey,
  type SyllableSlot,
} from '../../content/dialect-phonology.ts';
import { nameSeed } from './names.ts';

/** Name-kind id that seeds phonology (names.ts uses 1 to 3 for custom, family and clan). */
export const PHONOLOGY_KIND = 4;

/** What a dialect keeps from its inventories and draws for its syllables and word patterns (11 section 6.5). */
export interface DialectPhonology {
  /** Kept items per inventory (KEEP_MIN to KEEP_MAX each). */
  inventory: Record<InventoryKey, string[]>;
  /** Syllables generated per slot (SYLLABLE_COUNT_MIN to MAX each). */
  syllables: Record<SyllableSlot, number>;
  /** Word patterns with their weights. */
  wordPatterns: { pattern: string; weight: number }[];
}

/**
 * Keeps `KEEP_MIN` to `KEEP_MAX` distinct items of an inventory, drawn with repetition (11 section 6.5). Never more than the
 * inventory holds. Uses the rng it is given.
 */
function keepItems(items: readonly string[], rng: Rng): string[] {
  const target = Math.min(KEEP_MIN + rng.int(KEEP_MAX - KEEP_MIN + 1), items.length);
  const kept: string[] = [];
  for (let guard = 0; kept.length < target && guard < 1000; guard++) {
    const item = items[rng.int(items.length)];
    if (item !== undefined && !kept.includes(item)) kept.push(item);
  }
  return kept;
}

/**
 * Draws a dialect's phonology from `seed`. Returns undefined when any inventory's items are not authored to its size (the
 * spec gives sizes, and only the consonants are listed), so no dialect gets sounds it was not given. Otherwise the draw
 * order is fixed: the seven inventories in INVENTORY_KEYS order, the syllable counts per slot, then the word patterns.
 */
export function draftPhonology(seed: number): DialectPhonology | undefined {
  for (const key of INVENTORY_KEYS) {
    if (INVENTORY_ITEMS[key].length !== INVENTORY_SIZE[key]) return undefined;
  }
  const rng = createRng(seed);
  const inventory = {} as Record<InventoryKey, string[]>;
  for (const key of INVENTORY_KEYS) inventory[key] = keepItems(INVENTORY_ITEMS[key], rng);
  const syllables = {} as Record<SyllableSlot, number>;
  for (const slot of SYLLABLE_SLOTS) syllables[slot] = SYLLABLE_COUNT_MIN + rng.int(SYLLABLE_COUNT_MAX - SYLLABLE_COUNT_MIN + 1);
  const expanded = WORD_PATTERN_POOL.flatMap((p) => Array.from({ length: p.copies }, () => p.pattern));
  const count = WORD_PATTERN_COUNT_MIN + rng.int(WORD_PATTERN_COUNT_MAX - WORD_PATTERN_COUNT_MIN + 1);
  const wordPatterns: { pattern: string; weight: number }[] = [];
  for (let k = 0; k < count; k++) {
    const pattern = expanded[rng.int(expanded.length)];
    if (pattern === undefined) break;
    wordPatterns.push({ pattern, weight: WORD_WEIGHT_MIN + rng.next() * (WORD_WEIGHT_MAX - WORD_WEIGHT_MIN) });
  }
  return { inventory, syllables, wordPatterns };
}

/**
 * The phonology of a dialect founded (or diverged) with id `id` for `group` in the world with `worldSeed`. The seed is a hash
 * of (world seed, PHONOLOGY_KIND, id, group), so the same dialect always draws the same phonology. Draws no sim rng.
 */
export function foundPhonology(worldSeed: number, id: number, group: number): DialectPhonology | undefined {
  return draftPhonology(nameSeed(worldSeed, PHONOLOGY_KIND, id, group));
}
