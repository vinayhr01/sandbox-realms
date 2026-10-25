/**
 * Procedural names (11 section 6, reduced). A name is a pure function of (world seed, kind, entity id, salt): it
 * draws from its own stream derived by hash, never from the sim's named RNG streams, so naming never changes the
 * simulation. A recipe is a list of steps over word pools; one alternative is chosen uniformly per name.
 *
 * Cut from 11 section 6 (see DECISIONS.md, Dominions and culture release): the sex gate (no sapient individuals
 * exist in play), the splice, swap and double steps (their sound-shift source is the divide intrigue, not built),
 * and the dictionary templates for campaigns, pacts, armies and books (owned by file 10 campaigns, not built).
 */

/** Name kinds with a recipe here. Numeric ids feed the seed hash. */
export const NAME_KIND = { custom: 1, family: 2, clan: 3 } as const;

export type Gate = { chance?: number; prevEnds?: 'vowel' | 'consonant' };

export type Step =
  | { k: 'pick'; pool: number; gate?: Gate }
  | { k: 'chain'; pools: number[]; gate?: Gate }
  | { k: 'any'; pools: number[]; gate?: Gate }
  | { k: 'lit'; s: string; gate?: Gate }
  | { k: 'gap' | 'seam' | 'hyphen' | 'digit' | 'echo' | 'reverse' | 'upper' | 'erase'; gate?: Gate }
  | { k: 'again'; n: number; gate?: Gate };

export interface NameRecipe {
  alternatives: Step[][];
  pools: string[][];
}

/** Most attempts before a name gives up and reads 'Nameless' (11 section 6.1). */
export const NAME_TRIES = 100;
/** Name length cap after finalising (11 section 6.1). */
export const NAME_MAX_LENGTH = 30;
/** Substrings a name may not contain (a small placeholder list; the real list is OPEN). */
const BLACKLIST = ['cunt', 'fuck', 'shit'];

const VOWELS = 'aeiouy';

/** FNV-1a over the 32-bit words given, least significant byte first. Returns an unsigned 32-bit hash. */
export function hash32(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    let v = part >>> 0;
    for (let i = 0; i < 4; i++) {
      h ^= v & 0xff;
      h = Math.imul(h, 0x01000193);
      v >>>= 8;
    }
  }
  return h >>> 0;
}

/** Seed of one name: hash of (world seed, name kind, entity id, salt). */
export function nameSeed(worldSeed: number, kind: number, id: number, salt: number): number {
  return hash32(worldSeed, kind, id, salt);
}

/** Private stream: mulberry32, values in [0, 1). Created per name. */
function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Last word of a text (words split on space, hyphen and the silent seam mark). */
function lastWord(text: string): string {
  const words = text.split(/[ \-\u0000]/).filter((w) => w.length > 0);
  return words[words.length - 1] ?? '';
}

/** Runs one attempt of an alternative. Returns the raw text (seams still marked). */
function attempt(recipe: NameRecipe, rnd: () => number, alt: number): string {
  const steps = recipe.alternatives[alt] ?? [];
  let out = '';
  let prev: Step | undefined;
  const pick = (pool: string[] | undefined): string => (pool && pool.length > 0 ? (pool[Math.floor(rnd() * pool.length)] ?? '') : '');
  const passes = (gate: Gate | undefined): boolean => {
    if (!gate) return true;
    if (gate.chance !== undefined && rnd() >= gate.chance) return false;
    if (gate.prevEnds !== undefined) {
      const last = out.slice(-1).toLowerCase();
      const isVowel = last !== '' && VOWELS.includes(last);
      if (gate.prevEnds === 'vowel' ? !isVowel : last === '' || isVowel) return false;
    }
    return true;
  };
  const run = (step: Step): void => {
    if (!passes(step.gate)) return;
    switch (step.k) {
      case 'pick':
        out += pick(recipe.pools[step.pool]);
        break;
      case 'chain':
        for (const p of step.pools) out += pick(recipe.pools[p]);
        break;
      case 'any': {
        const usable = step.pools.filter((p) => (recipe.pools[p]?.length ?? 0) > 0);
        if (usable.length > 0) out += pick(recipe.pools[usable[Math.floor(rnd() * usable.length)] ?? 0]);
        break;
      }
      case 'lit':
        out += step.s;
        break;
      case 'gap':
        if (out !== '' && !out.endsWith(' ')) out += ' ';
        break;
      case 'seam':
        out += '\u0000';
        break;
      case 'hyphen':
        if (out !== '') out += '-';
        break;
      case 'digit':
        out += String(Math.floor(rnd() * 10));
        break;
      case 'echo': {
        const w = lastWord(out);
        if (w !== '') out += w;
        break;
      }
      case 'reverse': {
        const w = lastWord(out);
        if (w !== '') out += [...w].reverse().join('');
        break;
      }
      case 'again':
        // Repeats the previous step n more times, each repeat gated on its own.
        if (prev) for (let i = 0; i < step.n; i++) run(prev);
        break;
      case 'erase':
        if (VOWELS.includes(out.slice(-1).toLowerCase())) out = out.slice(0, -1);
        break;
      case 'upper':
        // Read at finalising (see generateName).
        break;
    }
    if (step.k !== 'again') prev = step;
  };
  for (const step of steps) run(step);
  return out;
}

/** Title Case after a space, hyphen or apostrophe; trims trailing space and hyphen; cuts to NAME_MAX_LENGTH. */
function finalise(raw: string, upper: boolean): string {
  let s = raw.replace(/\u0000/g, '').trim().replace(/[ \-]+$/, '');
  s = s.slice(0, NAME_MAX_LENGTH).replace(/[ \-]+$/, '');
  if (upper) return s.toUpperCase();
  return s.toLowerCase().replace(/(^|[ \-'])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/**
 * The name for one entity: up to NAME_TRIES attempts from the seed's private stream, each with a random alternative.
 * Empty or blacklisted results retry. Returns 'Nameless' when nothing usable comes out.
 */
export function generateName(recipe: NameRecipe, seed: number): string {
  const rnd = stream(seed);
  const alts = recipe.alternatives.length;
  if (alts === 0) return 'Nameless';
  for (let tries = 0; tries < NAME_TRIES; tries++) {
    const alt = Math.floor(rnd() * alts);
    const raw = attempt(recipe, rnd, alt);
    const upper = (recipe.alternatives[alt] ?? []).some((s) => s.k === 'upper');
    const name = finalise(raw, upper);
    if (name === '') continue;
    const low = name.toLowerCase();
    if (BLACKLIST.some((b) => low.includes(b))) continue;
    return name;
  }
  return 'Nameless';
}

const ONSETS = ['b', 'br', 'd', 'dr', 'f', 'g', 'gr', 'h', 'k', 'kr', 'l', 'm', 'n', 'p', 'r', 's', 'st', 't', 'th', 'tr', 'v', 'w'];
const NUCLEI = ['a', 'e', 'i', 'o', 'u', 'ae', 'ea', 'oi'];
const CODAS = ['', 'd', 'k', 'l', 'n', 'r', 's', 'th', 'nd', 'rk', 'st'];
const SYLLABLE_POOLS: string[][] = [ONSETS, NUCLEI, CODAS];
const KIN_WORDS = ['kin', 'folk', 'house', 'line', 'kind'];
const PLACE_WORDS = ['Hall', 'Mere', 'Wood', 'Moor', 'Fell', 'Field'];
const CLAN_PREFIXES = ['Ash', 'Briar', 'Cinder', 'Dun', 'Ember', 'Fen', 'Gale', 'Heath', 'Iron', 'Oak', 'Stone', 'Thorn', 'Vale', 'Wren', 'Yew'];
const CLAN_SUFFIXES = ['hold', 'fell', 'mere', 'wick', 'brand', 'moor', 'reach', 'ford', 'stair', 'kin'];

/** Custom names: a one- or two-syllable stem, or a stem with a place word. */
export const CUSTOM_RECIPE: NameRecipe = {
  alternatives: [
    [{ k: 'chain', pools: [0, 1, 2] }, { k: 'chain', pools: [0, 1, 2], gate: { chance: 0.6 } }],
    [{ k: 'chain', pools: [0, 1] }, { k: 'gap' }, { k: 'pick', pool: 3 }],
  ],
  pools: [...SYLLABLE_POOLS, PLACE_WORDS],
};

/** Family names: a stem and a kin word. */
export const FAMILY_RECIPE: NameRecipe = {
  alternatives: [[{ k: 'chain', pools: [0, 1, 2] }, { k: 'gap' }, { k: 'pick', pool: 3 }]],
  pools: [...SYLLABLE_POOLS, KIN_WORDS],
};

/** Clan names: a prefix and a suffix. */
export const CLAN_RECIPE: NameRecipe = {
  alternatives: [[{ k: 'pick', pool: 0 }, { k: 'pick', pool: 1 }]],
  pools: [CLAN_PREFIXES, CLAN_SUFFIXES],
};
