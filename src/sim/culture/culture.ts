/**
 * Reduced culture slice (11-intrigue-customs-creeds-dialects.md): customs, creeds, dialects,
 * families and intrigues. Groups are plain ids (a dominion or hamlet). Structural context: the
 * caller supplies rng, tick and a rule lookup, so this module never imports Sim.
 */
import type { Rng } from '../../shared/rng.ts';
import { CUSTOM_RARITY_WEIGHT, CUSTOM_TRAIT_BY_ID, CUSTOM_TRAITS, type CustomTraitDef } from '../../content/customs.ts';
import { CREED_TENETS, type CreedTenetDef } from '../../content/creeds.ts';
import { CUSTOM_RECIPE, FAMILY_RECIPE, generateName, NAME_KIND, nameSeed } from './names.ts';
import { blocksSplit, levelsPerLevelUp, readingMood, readingXp, XP_PER_LEVEL, xpGain } from './trait-rules.ts';
import { foundPhonology, type DialectPhonology } from './phonology.ts';

export { CUSTOM_TRAITS };

/** Xp and level of one being (11 section 9.1: the study traits). Keyed in CultureState.studies by being key. */
export interface Study {
  xp: number;
  level: number;
}

/**
 * A book written by a group (11 section 5). Keeps only what a reader takes from it: mood and xp. `readAt` is the tick of
 * the last reading (beings close 5); a book is readable again 200 ticks later, and a book never read has none.
 */
export interface Book {
  id: number;
  group: number;
  mood: number;
  xp: number;
  readAt?: number;
}

/** Ticks after a reading before a book can be read again (11 section 5). */
export const BOOK_REST_TICKS = 200;

/** The first book (in write order) that can be read at `tick`, or undefined (11 section 5 `readable`). */
export function readableBook(state: CultureState, tick: number): Book | undefined {
  return (state.books ?? []).find((b) => b.readAt === undefined || tick - b.readAt >= BOOK_REST_TICKS);
}

/**
 * Meta-object provenance (11 section 2 split preconditions). `creator` is the group that founded the meta (for a split,
 * the group that split it off); `born` is the tick it was made. Both optional: records saved before they existed have
 * neither, and the split gate then refuses them (no known age, no known creator).
 */
export interface MetaBirth {
  creator?: number;
  born?: number;
}

export interface Custom extends MetaBirth {
  group: number;
  /** Custom trait ids from the catalogue (content/customs.ts). Unknown ids are dropped when a save loads. */
  traits: string[];
  /** Name from the name generator (names.ts). Optional: customs made before naming have none. */
  name?: string;
}

/** Banner indices (11 section 8): background and frame for a family. Indices only; out-of-range is read as 0. */
export interface BannerRef {
  background: number;
  icon: number;
  frame: number;
}

/** Banner index range per part (TUNE; the art sets are not in this repo, so only the indices are stored). */
export const BANNER_PARTS = 8;

/**
 * A family as the spec defines it (11 section 7): two founders, the members (living Folk ids, capped at FAMILY_MAX),
 * the origin hamlet, a name and a banner. Families are kept beside the genealogy links (`CultureState.families`).
 */
export interface FamilyRecord {
  id: number;
  name: string;
  founders: [number, number];
  members: number[];
  originHamletId: number;
  banner: BannerRef;
}

/** Most members one family holds (11 section 7, FAMILY_MAX = 8, OPEN, design default). */
export const FAMILY_MAX = 8;

export interface Creed extends MetaBirth {
  id: number;
  /** Groups holding this creed. */
  holders: Set<number>;
  /** Tenet ids (content/creeds.ts) drawn at founding or copied by a schism (11 sections 2 and 4.2). Optional: a creed made without tenets has none. */
  tenets?: string[];
}

export interface Intrigue {
  id: number;
  kind: 'rebellion' | 'scheme';
  group: number;
  progress: number;
  /** Progress needed to resolve. */
  goal: number;
  /** Set when resolved. */
  outcome: 'success' | 'failure' | null;
}

export interface Dialect extends MetaBirth {
  group: number;
  /** Lexicon drift counter; groups with equal values speak the same dialect. */
  word: number;
  /** Lexicon ids copied by a divergence. Optional: a dialect made without one has none. */
  lexicon?: number[];
  /** Phonology drawn at founding or divergence (11 section 6.5, phonology.ts). Optional: absent while the inventories are not authored. */
  phonology?: DialectPhonology;
}

export interface CultureState {
  customs: Custom[];
  creeds: Creed[];
  dialects: Dialect[];
  intrigues: Intrigue[];
  /** Genealogy links: one per child recorded by addFamily. */
  families: { child: number; parentA: number; parentB: number }[];
  /** Family records (11 section 7). Optional: absent in saves written before they existed, and while none exist. */
  familyRecords?: FamilyRecord[];
  /** Study records (xp and level) keyed by being key (generation * MAX_BEINGS + slot). Optional: written when present. */
  studies?: Record<string, Study>;
  /** Defectors (convertOrElse): being key -> the dominion group it now follows. Optional: written when present. */
  allegiance?: Record<string, number>;
  /** Books written (11 section 5). Optional: written when present; a group's book count is its entries here. */
  books?: Book[];
  nextId: number;
}

export function createCultureState(): CultureState {
  return { customs: [], creeds: [], dialects: [], intrigues: [], families: [], nextId: 1 };
}

/** Structural context for culture steps. */
export interface CultureContext {
  rng: Rng;
  tick: number;
  /** Realm Rule lookup (`rules.isOn`). */
  isOn(id: string): boolean;
  /** Groups that share a border, as pairs (contact). Dominion ids in play (dominions/adapter.ts dominionBordersOf). */
  contacts: readonly (readonly [number, number])[];
  /** World seed for the name generator (names.ts). Without it, customs and families are unnamed. */
  worldSeed?: number;
  /** True while a Being key (generation * MAX_BEINGS + slot) is alive. Without it, family members are never pruned. */
  alive?(key: number): boolean;
}

/**
 * One weighted draw from the spawn pool (11 section 2): rarity weights from content/customs.ts, locked traits never.
 * Uses one rng draw. Undefined only when the pool has no weight.
 */
export function drawCustomTrait(rng: Rng): CustomTraitDef | undefined {
  let total = 0;
  for (const t of CUSTOM_TRAITS) total += CUSTOM_RARITY_WEIGHT[t.rarity];
  if (total <= 0) return undefined;
  let r = rng.next() * total;
  let last: CustomTraitDef | undefined;
  for (const t of CUSTOM_TRAITS) {
    const w = CUSTOM_RARITY_WEIGHT[t.rarity];
    if (w <= 0) continue;
    last = t;
    r -= w;
    if (r < 0) return t;
  }
  return last;
}

/**
 * Adds a trait id to a custom's list (11 section 2): unknown ids and duplicates are no-ops, and the trait's opposites
 * are removed first. Draws no rng.
 */
export function addCustomTrait(traits: string[], id: string): void {
  const def = CUSTOM_TRAIT_BY_ID.get(id);
  if (!def || traits.includes(id)) return;
  for (const o of def.opposites) {
    const k = traits.indexOf(o);
    if (k >= 0) traits.splice(k, 1);
  }
  traits.push(id);
}

/**
 * A trait list as the catalogue reads it: unknown ids are dropped, duplicates and opposites resolved in order. Saves
 * written before the catalogue (flavour trait names) load with no traits from them.
 */
export function catalogueTraits(list: readonly string[]): string[] {
  const out: string[] = [];
  for (const t of list) addCustomTrait(out, t);
  return out;
}

/** Whether a custom holds a trait id. */
export function customHas(custom: Custom | undefined, id: string): boolean {
  return custom !== undefined && custom.traits.includes(id);
}

/** The custom of a group (a dominion id), or undefined when the group has none. */
export function customOfGroup(state: CultureState, group: number): Custom | undefined {
  return state.customs.find((c) => c.group === group);
}

/**
 * Adds a custom to a group; trait count 1-2, or 3-5 when `chaotic_minds` is on (11 section 2). The name is drawn from
 * the name generator when the context has a world seed; the draw uses the name's own seed, never the rng.
 */
export function addCustom(ctx: CultureContext, state: CultureState, group: number): Custom {
  const count = ctx.isOn('chaotic_minds') ? 3 + ctx.rng.int(3) : 1 + ctx.rng.int(2);
  const traits: string[] = [];
  for (let k = 0; k < count; k++) {
    const def = drawCustomTrait(ctx.rng);
    if (def) addCustomTrait(traits, def.id);
  }
  const custom: Custom = { group, traits, creator: group, born: ctx.tick };
  if (ctx.worldSeed !== undefined) custom.name = generateName(CUSTOM_RECIPE, nameSeed(ctx.worldSeed, NAME_KIND.custom, state.customs.length + 1, group));
  state.customs.push(custom);
  return custom;
}

/** Banner of an entity: indices drawn from its name seed, so the same entity always has the same banner. */
export function bannerFor(seed: number): BannerRef {
  return { background: seed % BANNER_PARTS, icon: (seed >>> 8) % BANNER_PARTS, frame: (seed >>> 16) % BANNER_PARTS };
}

/**
 * Records a child of two parents (11 section 7): a genealogy link, and a family record. A child joins the family its
 * first parent belongs to while that family has room (FAMILY_MAX); otherwise a new family is founded by the two parents
 * (only when neither has one). A child already in a family is not added again. Draws no rng: names and banners come
 * from the name seed. `originHamletId` is -1 when the parents are not in a hamlet. Returns the family the child is in, or null.
 */
export function recordFamily(
  ctx: CultureContext,
  state: CultureState,
  child: number,
  parentA: number,
  parentB: number,
  originHamletId: number,
): FamilyRecord | null {
  addFamily(state, child, parentA, parentB);
  const records = state.familyRecords ?? [];
  if (records.some((f) => f.members.includes(child))) return null;
  let family = records.find((f) => f.members.includes(parentA) && f.members.length < FAMILY_MAX);
  if (!family) {
    if (records.some((f) => f.members.includes(parentA) || f.members.includes(parentB))) return null;
    const id = state.nextId++;
    const seed = nameSeed(ctx.worldSeed ?? 0, NAME_KIND.family, id, parentA + parentB);
    family = {
      id,
      name: generateName(FAMILY_RECIPE, seed),
      founders: [parentA, parentB],
      members: [parentA, parentB],
      originHamletId,
      banner: bannerFor(seed),
    };
    records.push(family);
    state.familyRecords = records;
  }
  if (family.members.length >= FAMILY_MAX) return null;
  family.members.push(child);
  return family;
}

/**
 * Drops dead members and dissolves families with one member or none (11 section 7). Runs inside the culture step, so
 * it draws no rng. Without `ctx.alive` nothing is pruned.
 */
function pruneFamilies(ctx: CultureContext, state: CultureState): void {
  const records = state.familyRecords;
  if (!records || !ctx.alive) return;
  for (const f of records) f.members = f.members.filter((m) => ctx.alive?.(m) ?? true);
  state.familyRecords = records.filter((f) => f.members.length > 1);
}

/**
 * Adds xp to a being's study record (11 section 9.1). The gain is `xpGain` of the being's custom traits (swiftStudy x2).
 * Each level costs XP_PER_LEVEL x (level + 1) xp; a level-up adds `levelsPerLevelUp` (deepTraining: 2). Draws no rng.
 */
export function addXp(state: CultureState, key: number, traits: readonly string[], amount: number): Study {
  const studies: Record<string, Study> = state.studies ?? {};
  state.studies = studies;
  const rec: Study = studies[String(key)] ?? { xp: 0, level: 0 };
  rec.xp += xpGain(traits, amount);
  while (rec.xp >= XP_PER_LEVEL * (rec.level + 1)) {
    rec.xp -= XP_PER_LEVEL * (rec.level + 1);
    rec.level += levelsPerLevelUp(traits);
  }
  studies[String(key)] = rec;
  return rec;
}

/**
 * Reading a book (11 section 5): the reader's study record gains `readingXp` (eagerReaders x3) of the book, through
 * addXp. Returns the mood the reading gives (bookLovers flips a negative mood); the caller applies that mood. Draws no rng.
 */
export function readBookEffects(state: CultureState, key: number, traits: readonly string[], book: Book): number {
  addXp(state, key, traits, readingXp(traits, book.xp));
  return readingMood(traits, book.mood);
}

/** Writes a book for a group (11 section 5): a new entry in `books` with the book's mood and xp. Draws no rng. */
export function writeBook(state: CultureState, group: number, mood: number, xp: number): Book {
  const book: Book = { id: state.nextId++, group, mood, xp };
  const books: Book[] = state.books ?? [];
  books.push(book);
  state.books = books;
  return book;
}

/** Number of books a group has written (its entries in `books`). */
export function bookCount(state: CultureState, group: number): number {
  return (state.books ?? []).filter((b) => b.group === group).length;
}

/**
 * Divide of a custom (11 sections 2 and 9.1): a new custom for `newGroup` with the parent's traits copied, no random draw.
 * The new custom's creator is the parent's group (the group that split it off) and its birth is `tick`. Refused (null)
 * when the parent has no custom, `newGroup` already has one, or the parent holds `keepers`. The population, age and actor
 * preconditions are splitAllowed (trait-rules.ts), checked by the intrigue gate. The name recipe is cloned: the sim has one
 * recipe for customs (CUSTOM_RECIPE), so the child is named from it with its own seed when `worldSeed` is given. Not built:
 * the sound shift (names.ts). The conversion of the actor's units is made by the caller (culture/effects.ts).
 */
export function splitCustom(state: CultureState, parentGroup: number, newGroup: number, tick: number, worldSeed?: number): Custom | null {
  const parent = customOfGroup(state, parentGroup);
  if (!parent || blocksSplit(parent.traits) || customOfGroup(state, newGroup)) return null;
  const child: Custom = { group: newGroup, traits: [...parent.traits], creator: parentGroup, born: tick };
  if (worldSeed !== undefined) child.name = generateName(CUSTOM_RECIPE, nameSeed(worldSeed, NAME_KIND.custom, state.customs.length + 1, newGroup));
  state.customs.push(child);
  return child;
}

/** One weighted draw from the creed spawn pool (11 section 2): randomSpawn tenets, weighted by rarity. One rng draw. */
export function drawCreedTenet(rng: Rng): CreedTenetDef | undefined {
  const pool = CREED_TENETS.filter((t) => t.randomSpawn && CUSTOM_RARITY_WEIGHT[t.rarity] > 0);
  let total = 0;
  for (const t of pool) total += CUSTOM_RARITY_WEIGHT[t.rarity];
  if (total <= 0) return undefined;
  let r = rng.next() * total;
  let last: CreedTenetDef | undefined;
  for (const t of pool) {
    last = t;
    r -= CUSTOM_RARITY_WEIGHT[t.rarity];
    if (r < 0) return t;
  }
  return last;
}

/**
 * Founds a creed for `group` (11 sections 2 and 3, newCreed): tenet draws 1-2 (3-5 under `chaotic_minds`) from the spawn
 * pool, duplicates dropped. The creator is the group and the birth is `tick`. Refused (null) when the group already holds a
 * creed. The gate is foundAllowed (trait-rules.ts). Uses the rng it is given (the culture stream).
 */
export function foundCreed(state: CultureState, group: number, tick: number, rng: Rng, chaotic: boolean): Creed | null {
  if (state.creeds.some((c) => c.holders.has(group))) return null;
  const count = chaotic ? 3 + rng.int(3) : 1 + rng.int(2);
  const tenets: string[] = [];
  for (let k = 0; k < count; k++) {
    const def = drawCreedTenet(rng);
    if (def && !tenets.includes(def.id)) tenets.push(def.id);
  }
  const creed: Creed = { id: state.nextId++, holders: new Set([group]), tenets, creator: group, born: tick };
  state.creeds.push(creed);
  return creed;
}

/** Points a harmony tenet adds to its stat for the followers of the creed (11 section 4.2: +10). */
export const HARMONY_BONUS = 10;

/** The four stats a harmony tenet names (11 section 9.4). */
export type HarmonyStat = 'intelligence' | 'warfare' | 'diplomacy' | 'stewardship';

/**
 * The harmony bonus a group's creeds give one stat (11 section 4.2, creed effects): HARMONY_BONUS when a creed the group
 * holds carries `harmony_<stat>`, else 0. Several creeds held by one group give the bonus once. Reads only; draws no rng.
 */
export function harmonyBonus(state: CultureState, group: number, stat: HarmonyStat): number {
  const id = `harmony_${stat}`;
  return state.creeds.some((c) => c.holders.has(group) && (c.tenets ?? []).includes(id)) ? HARMONY_BONUS : 0;
}

/**
 * Founds a dialect for `group` (11 sections 2 and 3, newDialect). The lexicon starts empty and the birth traits are not
 * built (the dialect trait lists). The phonology is drawn when `worldSeed` is given (11 section 6.5, phonology.ts), and is
 * left unset while the inventories are not authored. The creator is the group and the birth is `tick`. Refused (null) when
 * the group already has a dialect. The gate is foundAllowed (trait-rules.ts). Draws no rng.
 */
export function foundDialect(state: CultureState, group: number, tick: number, worldSeed?: number): Dialect | null {
  if (state.dialects.some((d) => d.group === group)) return null;
  const dialect: Dialect = { group, word: 0, lexicon: [], creator: group, born: tick };
  if (worldSeed !== undefined) {
    const phonology = foundPhonology(worldSeed, state.dialects.length + 1, group);
    if (phonology) dialect.phonology = phonology;
  }
  state.dialects.push(dialect);
  return dialect;
}

/** Two metas are the same one when both record a creator and a birth, and the two are equal (11 section 2 meta identity). */
export function sameMeta(a: MetaBirth, b: MetaBirth): boolean {
  return a.creator !== undefined && a.creator === b.creator && a.born === b.born;
}

/**
 * Meta spread of a dialect by talk (11 section 4.4, dialect side): the loser's dialect is replaced by the winner's, so the
 * loser holds the winner's meta (word, lexicon, creator, birth). The loser's group stays the holder. Returns false, and
 * changes nothing, when the two records are the same meta. Draws no rng.
 */
export function replaceDialect(loser: Dialect, winner: Dialect): boolean {
  if (sameMeta(loser, winner)) return false;
  loser.word = winner.word;
  loser.lexicon = [...(winner.lexicon ?? [])];
  if (winner.phonology !== undefined) loser.phonology = winner.phonology;
  else delete loser.phonology;
  if (winner.creator !== undefined) loser.creator = winner.creator;
  else delete loser.creator;
  if (winner.born !== undefined) loser.born = winner.born;
  else delete loser.born;
  return true;
}

/**
 * Schism of a creed (11 sections 2 and 4.2): a new creed held by `newGroup`, with the parent creed's tenets copied. The new
 * creed's creator is `splitter` (the group that schisms it off) and its birth is `tick`. The parent's holders are kept.
 * Refused (null) when the parent creed is not in the state or `newGroup` already holds it. Draws no rng.
 */
export function splitCreed(state: CultureState, parentId: number, newGroup: number, splitter: number, tick: number): Creed | null {
  const parent = state.creeds.find((c) => c.id === parentId);
  if (!parent || parent.holders.has(newGroup)) return null;
  const child: Creed = { id: state.nextId++, holders: new Set([newGroup]), tenets: [...(parent.tenets ?? [])], creator: splitter, born: tick };
  state.creeds.push(child);
  return child;
}

/**
 * Divergence of a dialect (11 sections 2 and 6.5): a new dialect for `newGroup` with the parent's lexicon word and lexicon
 * copied. Its phonology is a new draw (a creation, 6.5), made when `worldSeed` is given, not a copy of the parent's. The
 * new dialect's creator is the parent's group and its birth is `tick`. Refused (null) when the parent group has no dialect
 * or `newGroup` already has one. Draws no sim rng.
 */
export function splitDialect(state: CultureState, parentGroup: number, newGroup: number, tick: number, worldSeed?: number): Dialect | null {
  const parent = state.dialects.find((d) => d.group === parentGroup);
  if (!parent || state.dialects.some((d) => d.group === newGroup)) return null;
  const child: Dialect = { group: newGroup, word: parent.word, lexicon: [...(parent.lexicon ?? [])], creator: parentGroup, born: tick };
  if (worldSeed !== undefined) {
    const phonology = foundPhonology(worldSeed, state.dialects.length + 1, newGroup);
    if (phonology) child.phonology = phonology;
  }
  state.dialects.push(child);
  return child;
}

/**
 * Drops study and defection records of Beings that are gone (keys carry the generation, so a reused slot never
 * inherits them). Draws no rng.
 */
export function pruneBeingState(ctx: CultureContext, state: CultureState): void {
  if (!ctx.alive) return;
  const alive = ctx.alive;
  if (state.studies) for (const k of Object.keys(state.studies)) if (!alive(Number(k))) delete state.studies[k];
  if (state.allegiance) for (const k of Object.keys(state.allegiance)) if (!alive(Number(k))) delete state.allegiance[k];
}

/** Starts an intrigue unless `rituals` is off; rebellions also need `uprisings` on. */
export function startIntrigue(ctx: CultureContext, state: CultureState, group: number, kind: 'rebellion' | 'scheme'): Intrigue | null {
  if (!ctx.isOn('rituals')) return null;
  if (kind === 'rebellion' && !ctx.isOn('uprisings')) return null;
  const intrigue: Intrigue = { id: state.nextId++, kind, group, progress: 0, goal: 20 + ctx.rng.int(20), outcome: null };
  state.intrigues.push(intrigue);
  return intrigue;
}

/** Records a child of two parents (family link). */
export function addFamily(state: CultureState, child: number, parentA: number, parentB: number): void {
  state.families.push({ child, parentA, parentB });
}

/** Creeds spread across contacts at a per-step chance. */
function spreadCreeds(ctx: CultureContext, state: CultureState): void {
  for (const creed of state.creeds) {
    for (const [a, b] of ctx.contacts) {
      const from = creed.holders.has(a) ? a : creed.holders.has(b) ? b : -1;
      if (from < 0) continue;
      const to = from === a ? b : a;
      if (!creed.holders.has(to) && ctx.rng.next() < 0.02) creed.holders.add(to);
    }
  }
}

/**
 * Dialects spread across contacts (11 section 4.4, group form): when two contacting groups hold dialects of different metas,
 * at the creed rate (2% per contact per step), one of the two is replaced by the other (replaceDialect), an even draw
 * choosing which. The spec's talk form needs a dialect per speaker, which the sim does not keep (one per group), so this
 * group form stands in for it (DECISIONS.md, "Culture founding close 6"). Draws from the culture stream.
 */
function spreadDialects(ctx: CultureContext, state: CultureState): void {
  for (const [a, b] of ctx.contacts) {
    const da = state.dialects.find((d) => d.group === a);
    const db = state.dialects.find((d) => d.group === b);
    if (!da || !db || sameMeta(da, db)) continue;
    if (ctx.rng.next() >= 0.02) continue;
    if (ctx.rng.next() < 0.5) replaceDialect(db, da);
    else replaceDialect(da, db);
  }
}

/** Dialects drift per group; groups in contact pull each other's lexicon together. */
function driftDialects(ctx: CultureContext, state: CultureState): void {
  for (const d of state.dialects) {
    if (ctx.rng.next() < 0.05) d.word = d.word + (ctx.rng.next() < 0.5 ? 1 : -1);
  }
  for (const [a, b] of ctx.contacts) {
    const da = state.dialects.find((d) => d.group === a);
    const db = state.dialects.find((d) => d.group === b);
    if (da && db && da.word !== db.word && ctx.rng.next() < 0.1) {
      const merged = Math.round((da.word + db.word) / 2);
      da.word = merged;
      db.word = merged;
    }
  }
}

/** Advances intrigues; each resolves at its goal with a random success or failure. */
function advanceIntrigues(ctx: CultureContext, state: CultureState): void {
  for (const it of state.intrigues) {
    if (it.outcome !== null) continue;
    it.progress += 1 + ctx.rng.int(2);
    if (it.progress >= it.goal) it.outcome = ctx.rng.next() < 0.5 ? 'success' : 'failure';
  }
}

/** One culture step: creeds spread, dialects drift and merge, intrigues advance. */
export function cultureStep(ctx: CultureContext, state: CultureState): void {
  spreadCreeds(ctx, state);
  spreadDialects(ctx, state);
  driftDialects(ctx, state);
  advanceIntrigues(ctx, state);
  pruneFamilies(ctx, state);
}
