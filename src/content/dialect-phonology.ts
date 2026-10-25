/**
 * Dialect phonology data (11 section 6.5). A dialect is founded or diverges with a draw from seven original inventories,
 * a syllable count for each of its three syllable slots, and a set of word patterns. Read by culture/phonology.ts.
 *
 * The spec gives the size of every inventory but lists the items of the consonants only (18). The items of the other six
 * inventories are OPEN, so INVENTORY_ITEMS leaves them empty: a dialect gets no phonology until they are authored, and the
 * draw then reports nothing rather than inventing sounds. See DECISIONS.md "Dialect phonology close 10".
 */

export const INVENTORY_KEYS = ['consonant', 'vowel', 'onset', 'onsetCluster', 'coda', 'codaCluster', 'diphthong'] as const;
export type InventoryKey = (typeof INVENTORY_KEYS)[number];

/** Items in each original inventory (11 section 6.5). */
export const INVENTORY_SIZE: Record<InventoryKey, number> = {
  consonant: 18,
  vowel: 6,
  onset: 20,
  onsetCluster: 24,
  coda: 7,
  codaCluster: 14,
  diphthong: 9,
};

/** The items of each inventory. Only the consonants are given by the spec (11 section 6.5); the rest are OPEN. */
export const INVENTORY_ITEMS: Record<InventoryKey, readonly string[]> = {
  consonant: ['p', 'b', 't', 'd', 'k', 'g', 'f', 'v', 's', 'z', 'h', 'm', 'n', 'l', 'r', 'w', 'y', 'j'],
  vowel: [],
  onset: [],
  onsetCluster: [],
  coda: [],
  codaCluster: [],
  diphthong: [],
};

/** Items a dialect keeps from each inventory (TUNE, 11 section 6.5: 4-7 of each). */
export const KEEP_MIN = 4;
export const KEEP_MAX = 7;

/** Syllables generated for each of the start, mid and end slots of one dialect (11 section 6.5: 2-9). */
export const SYLLABLE_COUNT_MIN = 2;
export const SYLLABLE_COUNT_MAX = 9;

/** Syllable slots. A word pattern letter names one: S = start, M = mid, E = end. */
export const SYLLABLE_SLOTS = ['start', 'mid', 'end'] as const;
export type SyllableSlot = (typeof SYLLABLE_SLOTS)[number];

/** Syllable shape pools per slot (11 section 6.5). C is a consonant slot, V a vowel slot, weights as given. */
export const SYLLABLE_SHAPES: Record<SyllableSlot, readonly { shape: string; weight: number }[]> = {
  start: [
    { shape: 'CV', weight: 50 },
    { shape: 'CCV', weight: 25 },
    { shape: 'CVC', weight: 20 },
    { shape: 'V', weight: 5 },
  ],
  mid: [
    { shape: 'CV', weight: 40 },
    { shape: 'CVC', weight: 30 },
    { shape: 'CCV', weight: 10 },
    { shape: 'V', weight: 20 },
  ],
  end: [
    { shape: 'CVC', weight: 40 },
    { shape: 'VC', weight: 30 },
    { shape: 'CV', weight: 20 },
    { shape: 'V', weight: 10 },
  ],
};

/** Chance that a syllable with two vowel slots takes a diphthong (11 section 6.5). */
export const DIPHTHONG_CHANCE = 0.2;

/**
 * Word patterns of a dialect (11 section 6.5). Each entry is a pattern and the number of copies it has in the pool; a dialect
 * draws WORD_PATTERN_COUNT_MIN to MAX patterns from the expanded pool (uniform over copies), each with a random weight.
 */
export const WORD_PATTERN_POOL: readonly { pattern: string; copies: number }[] = [
  { pattern: 'S', copies: 3 },
  { pattern: 'SE', copies: 6 },
  { pattern: 'SME', copies: 2 },
  { pattern: 'SMME', copies: 1 },
];
export const WORD_PATTERN_COUNT_MIN = 3;
export const WORD_PATTERN_COUNT_MAX = 9;
/** Random weight range of a word pattern (11 section 6.5: 0.05 to 1). */
export const WORD_WEIGHT_MIN = 0.05;
export const WORD_WEIGHT_MAX = 1;
