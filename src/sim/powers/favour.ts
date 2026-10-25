/**
 * Favour powers (12 section 8.7). Each handler acts on the beings standing on the tapped tile, the
 * way a magic drop lands (fallChance: one roll per application decides whether the drop lands; the
 * beings on that tile then take the effect). Where the spec names a status, trait, opinion or
 * list the sim does not have, the closest existing state is used. Each substitution is recorded
 * in DECISIONS.md "Powers round 4". Rolls come from the named stream `favour` (deterministic).
 */
import { ITEM_KINDS } from '../../content/items.ts';
import { FLORA, type FloraDef } from '../flora.ts';
import { BEING_TRAITS, BEING_TRAIT_INDEX, type BeingTraitDef } from '../../content/traits.ts';
import type { MoodEvent } from '../../content/moods.ts';
import { giveItem, itemRain } from '../items/system.ts';
import { refreshStats, spawnBeing } from '../beings/system.ts';
import { addMood, beginSleep, isAsleep } from '../beings/social.ts';
import { speciesIndex } from '../../content/beasts.ts';
import type { Sim } from '../sim.ts';

/** Named RNG stream for every Favour roll (17 section 7.1). */
const STREAM = 'favour';
/** Statuses the Cleanse rite removes: plague, infection, poison and curse residue (12 section 8.7). */
const CLEANSE_STATUSES = ['coughing', 'venomed', 'rotting', 'hexed'] as const;
/** Traits the Cleanse rite removes: curse residue and plague carriers (12 section 8.7). */
const CLEANSE_TRAITS = ['hexmarked', 'vermin_bearer'] as const;
/** Statuses the Unweave rite removes: the buffs and debuffs of magic origin (12 section 8.7). */
const UNWEAVE_STATUSES = ['warded', 'emboldened', 'empowered', 'hexed'] as const;
/** Highest item tier Loot Rain draws from (TUNE; tiers 1 to 8 in content/items.ts). */
const LOOT_MAX_TIER = 4;
/** Mating lull after a Foundling child, in ticks (matches the birth lull of 06 section 6.1). */
const FOUNDLING_LULL = 1800;
/** Chance a magic drop lands on its tile (12 section 8.7, fallChance). */
const FALL = 0.3;
/** Per-being chance of the Grace and Hex trait rites (12 section 8.7). */
const TRAIT_CHANCE = 0.15;
/** Chance of each independent status in Surge (12 section 8.7). */
const SURGE_CHANCE = 0.2;

/**
 * Good and bad being traits. 18b carries no good or bad tag, so a trait is `bad` when its effect text
 * has a negative figure (`-3`, `x0.8`) and no positive one, `good` in the reverse case, and unclassified
 * when both appear. A few traits with mixed text are named here by hand.
 */
const NEG = /(^|[\s;,(])-\d|\bx0\./;
const POS = /(^|[\s;,(])\+\d|\bx1\.\d|\bx[2-9]\b/;
const BAD_BY_HAND = new Set(['frenzied_mind', 'hexmarked', 'cursed_line', 'vermin_bearer']);

function polarityOf(t: BeingTraitDef): 'good' | 'bad' | null {
  if (BAD_BY_HAND.has(t.id)) return 'bad';
  const neg = NEG.test(t.effect);
  const pos = POS.test(t.effect);
  if (neg && !pos) return 'bad';
  if (pos && !neg) return 'good';
  return null;
}

const GOOD_INDICES: readonly number[] = BEING_TRAITS.flatMap((t, k) => (polarityOf(t) === 'good' ? [k] : []));
const BAD_INDICES: readonly number[] = BEING_TRAITS.flatMap((t, k) => (polarityOf(t) === 'bad' ? [k] : []));
/** Kinds Loot Rain may give: non-unique equipment up to LOOT_MAX_TIER. */
const LOOT_KINDS: readonly string[] = ITEM_KINDS.filter((k) => !k.unique && k.tier <= LOOT_MAX_TIER).map((k) => k.id);

/** Living beings standing on tile (x,y), in alive-list order (deterministic). */
function beingsOn(sim: Sim, x: number, y: number): number[] {
  const s = sim.beings.store;
  const out: number[] = [];
  for (let k = 0; k < s.size; k++) {
    const slot = s.at(k);
    if ((s.x[slot] ?? -1) === x && (s.y[slot] ?? -1) === y) out.push(slot);
  }
  return out;
}

/** One roll on the favour stream: true when the drop lands on this tile. */
function lands(sim: Sim, chance: number): boolean {
  return sim.rng(STREAM).next() < chance;
}

/** Status drop: every being on the tile gains `status` (refreshes when already held). */
export function statusDrop(sim: Sim, x: number, y: number, status: string, fall: number): boolean {
  if (!lands(sim, fall)) return true;
  for (const slot of beingsOn(sim, x, y)) sim.effects.add(slot, status, sim.tick);
  return true;
}

/**
 * Surge: each being on the tile takes `emboldened` and `warded` with a 20% chance each (spirited and
 * warded in the spec; vigilant has no status and is dropped), and always takes `empowered` (mana_surge).
 */
export function surgeDrop(sim: Sim, x: number, y: number, fall: number): boolean {
  if (!lands(sim, fall)) return true;
  const rng = sim.rng(STREAM);
  for (const slot of beingsOn(sim, x, y)) {
    if (rng.next() < SURGE_CHANCE) sim.effects.add(slot, 'emboldened', sim.tick);
    if (rng.next() < SURGE_CHANCE) sim.effects.add(slot, 'warded', sim.tick);
    sim.effects.add(slot, 'empowered', sim.tick);
  }
  return true;
}

/** Mood drop: every being on the tile gets mood event `event` plus `extra` (12 section 8.7 mood and opinion rites). */
export function moodDrop(sim: Sim, x: number, y: number, event: string, extra: number, fall: number): boolean {
  if (!lands(sim, fall)) return true;
  for (const slot of beingsOn(sim, x, y)) addMood(sim, slot, event as MoodEvent, extra);
  return true;
}

/** Trait drop: sets one being trait on every being on the tile. Stalwartheart beings resist the mind trait frenzied_mind. */
export function traitDrop(sim: Sim, x: number, y: number, trait: string, fall: number): boolean {
  const index = BEING_TRAIT_INDEX.get(trait);
  if (index === undefined) return false;
  if (!lands(sim, fall)) return true;
  const s = sim.beings.store;
  const shield = BEING_TRAIT_INDEX.get('stalwartheart');
  for (const slot of beingsOn(sim, x, y)) {
    if (trait === 'frenzied_mind' && shield !== undefined && s.hasMark(slot, shield)) continue;
    s.setMark(slot, index, true);
  }
  return true;
}

/**
 * Trait Grace or Hex: each being on the tile gains one random good (or bad) trait with probability
 * `chance`. Returns false when the pool is empty.
 */
export function randomTraitDrop(sim: Sim, x: number, y: number, polarity: 'good' | 'bad', chance: number): boolean {
  const pool = polarity === 'good' ? GOOD_INDICES : BAD_INDICES;
  if (pool.length === 0) return false;
  const rng = sim.rng(STREAM);
  const s = sim.beings.store;
  for (const slot of beingsOn(sim, x, y)) {
    if (rng.next() >= chance) continue;
    const pick = pool[rng.int(pool.length)];
    if (pick !== undefined) s.setMark(slot, pick, true);
  }
  return true;
}

/**
 * Slumber: beings on the tile go to sleep (the `dozing` state is the sleep of 06 section 5, which any
 * damage ends). The length follows the nap rule, not the 60 s of the spec.
 */
export function slumberDrop(sim: Sim, x: number, y: number, fall: number): boolean {
  if (!lands(sim, fall)) return true;
  for (const slot of beingsOn(sim, x, y)) {
    if (!isAsleep(sim, slot)) beginSleep(sim, slot, 'nap');
  }
  return true;
}

/** Unweave: removes the magic-origin statuses from beings on the tile. */
export function unweaveDrop(sim: Sim, x: number, y: number, fall: number): boolean {
  if (!lands(sim, fall)) return true;
  for (const slot of beingsOn(sim, x, y)) {
    for (const status of UNWEAVE_STATUSES) sim.effects.remove(slot, status);
  }
  return true;
}

/** Cleanse: removes plague, infection, poison and curse statuses and traits from beings on the tile. */
export function cleanseDrop(sim: Sim, x: number, y: number, fall: number): boolean {
  if (!lands(sim, fall)) return true;
  const s = sim.beings.store;
  for (const slot of beingsOn(sim, x, y)) {
    for (const status of CLEANSE_STATUSES) sim.effects.remove(slot, status);
    for (const trait of CLEANSE_TRAITS) {
      const index = BEING_TRAIT_INDEX.get(trait);
      if (index !== undefined) s.setMark(slot, index, false);
    }
  }
  return true;
}

/** Purify (clearBadTraits): removes every bad trait from beings on the tile. Always lands. */
export function purifyDrop(sim: Sim, x: number, y: number): boolean {
  const s = sim.beings.store;
  for (const slot of beingsOn(sim, x, y)) {
    for (const index of BAD_INDICES) {
      if (s.hasMark(slot, index)) s.setMark(slot, index, false);
    }
  }
  return true;
}

/**
 * Foundling: the first breeding-age being on the tile (not a child, not expecting, not in a mating
 * lull) has a child at once. Returns false when no being on the tile can breed (the rite fails).
 */
export function foundlingAt(sim: Sim, x: number, y: number): boolean {
  const s = sim.beings.store;
  for (const slot of beingsOn(sim, x, y)) {
    if ((s.baby[slot] ?? 0) !== 0 || (s.expecting[slot] ?? 0) !== 0 || (s.lull[slot] ?? 0) > sim.tick) continue;
    const child = spawnBeing(sim, s.species[slot] ?? 0, x, y, false, slot);
    if (child < 0) return false;
    s.lull[slot] = sim.tick + FOUNDLING_LULL;
    return true;
  }
  return false;
}

/**
 * Waking Flora (OPEN-12-4 default): a tree on the tile becomes a rootwarden and the tree is removed.
 * Other flora and structures are not converted. Returns false when the tile holds no tree or the
 * rootwarden cannot be placed.
 */
export function wakeAt(sim: Sim, x: number, y: number): boolean {
  const realm = sim.realm;
  const i = y * realm.side + x;
  const def: FloraDef | undefined = FLORA[(realm.flora[i] ?? 0) - 1];
  if (!def || def.kind !== 'tree') return false;
  const slot = spawnBeing(sim, speciesIndex('rootwarden'), x, y, true);
  if (slot < 0) return false;
  realm.setFlora(i, 0, 0);
  return true;
}

/**
 * Item Rain: beings on the tile are given items from the item-rain list (the list is sim state, set by
 * the item rain editor). With an empty list there is nothing to give and the rite does nothing.
 */
export function itemRainDrop(sim: Sim, x: number, y: number, fall: number): boolean {
  if (sim.items.rain.length === 0) return false;
  if (!lands(sim, fall)) return true;
  itemRain(sim, x, y, 0);
  return true;
}

/** Loot Rain: each being on the tile is given a random item of tier up to LOOT_MAX_TIER. */
export function lootDrop(sim: Sim, x: number, y: number, fall: number): boolean {
  if (!lands(sim, fall)) return true;
  for (const slot of beingsOn(sim, x, y)) {
    if (giveItem(sim, slot, LOOT_KINDS)) refreshStats(sim, slot);
  }
  return true;
}
