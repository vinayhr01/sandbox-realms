/**
 * Spell casting (08 section 9, the table in content/spells.ts). A Being with a spell source may cast in a fight: the blow
 * pool of 08 section 2.1 is {cast, basic}, one picked uniformly (beings/system.ts strike calls tryCast first). A failed cast
 * falls back to the basic blow. Spell sources (08 9.1): the talent traits of 18b TAL (personal, strain gifts), the creed
 * spell tenets of the group the Being follows (culture/effects.ts creedSpellsOfSlot, bloodSecrecy included), and the trait
 * `fated_hero` (all built spells). Item spells (staffs, 08 6.2) are not a source here (DECISIONS.md "Spells and rites close 14").
 *
 * Gates (08 9.1): not `hushed`, not possessed, no recover_cast, no spell cooldown, aether >= cost, the vitality gate, the
 * minimum distance, then the chance roll (chance, less CASTER_SLAYER_PENALTY against a target holding `caster_slayer`). Success
 * runs the effect, spends the cost, and starts recover_cast and any spell cooldown. Draws from the `spells` stream, and only
 * when a Being has a spell source, so a world without casters draws nothing new.
 *
 * Aether is lazy: each caster's entry is (value, tick it was set), and the value regains one point per AETHER_REGEN_TICKS.
 * Regeneration does not check starvation (08 9.1 OPEN). Aether is saved (chronicle tag 23, optional); recover_cast and the
 * spell cooldowns are not (08 section 11: recover markers drop on load).
 */
import type { Sim } from './sim.ts';
import { MAX_BEINGS } from './beings/store.ts';
import { BEING_TRAIT_INDEX } from '../content/traits.ts';
import { SPELLS, SPELL_BY_ID, TALENT_SPELLS, AETHER_BASE, AETHER_REGEN_TICKS, AETHER_WELLSPRING, CASTER_SLAYER_PENALTY, RECOVER_CAST_TICKS, type SpellDef } from '../content/spells.ts';
import { BOMB_PROFILE_BY_ID } from '../content/powers.ts';
import { speciesIndex } from '../content/beasts.ts';
import { PATCH } from '../shared/constants.ts';
import { applyDamage } from './combat.ts';
import { detonateBomb } from './powers/handlers.ts';
import { hexAt } from './powers/rites.ts';
import { startFire } from './terrain/fire.ts';
import { plantFlora } from './powers/terrain-powers.ts';
import { spawnBeing, walkable } from './beings/system.ts';
import { factionOf, relation, type Faction } from './beings/hostility.ts';
import { isPossessed } from './beings/possession.ts';
import { ageDef } from './ages.ts';
import { creedSpellsOfSlot } from './culture/effects.ts';

/** Aether entry of one caster: the value and the tick it was set (see the header). */
interface AetherEntry {
  value: number;
  at: number;
}

/** Spell state of one realm. Keys are being keys (generation * MAX_BEINGS + slot), as culture.studies keys are. */
export class SpellState {
  readonly aether = new Map<number, AetherEntry>();
  /** Tick a caster may cast again (recover_cast), by slot. Not saved. */
  readonly recover = new Map<number, number>();
  /** Tick a spell is ready again for a caster, keyed `slot:spellId`. Not saved. */
  readonly cooldown = new Map<string, number>();
}

/** Spell sources of the tenet and trait kinds that give a Being spells (08 9.1). */
const FATED = 'fated_hero';
const SLAYER = 'caster_slayer';
const SUNMEND = 'sunmend';
/** Traits of the four afflictions that `purify` removes (08 section 8; 18b ACQ). */
const AFFLICTION_TRAITS: readonly string[] = ['rot_touched', 'spore_lodged', 'growth_fever', 'gnawing_ill'];
/** Statuses that `purify` removes besides the afflictions (08 9.2). */
const PURIFY_STATUSES: readonly string[] = ['ash_sickness', 'hexed'];
/** Boneshamblers in the Patch ring above which raise_boneshambler is refused (08 9.2). */
const BONESHAMBLER_LIMIT = 6;
/** Vitality share a mending_rain or purify heal restores (08 9.2). */
const MENDING_HEAL = 0.2;
/** Vitality share a crimson_shower heal restores to allies, and the damage it does to others (08 9.2). */
const CRIMSON_HEAL = 0.15;
const CRIMSON_HARM = 0.08;
/** Vitality share a sunmend carrier restores when sun_lance lands near it (08 9.2). */
const SUNMEND_HEAL = 0.1;
/** Damage of sun_lance before its modifiers (08 9.2). TUNE. */
const SUN_LANCE_DAMAGE = 30;
/** Ticks a rimebound (frost_snap), a sluggish (thorn_snare), a blinded (blind_mist) and a dazed (tremor_stomp) lasts. TUNE: 08 9.2. */
const FROST_TICKS = 150;
const THORN_TICKS = 60;
const MIST_TICKS = 100;
const STOMP_TICKS = 40;
/** Ticks of the warded status from ward_self (08 9.2). */
const WARD_TICKS = 600;
/** Tiles of the drop and the sweep of the spells that work on a tile or on Beings near one. */
const HUSH_RADIUS = 3;
const MENDING_RADIUS = 3;
const PURIFY_RADIUS = 4;
const CRIMSON_RADIUS = 3;
const FROST_RADIUS = 2;
const THORN_RADIUS = 2;
const MIST_RADIUS = 3;
const STOMP_RADIUS = 3;
const KINDLE_SPREAD = 3;
const HEX_RADIUS = 3;
/** Random tiles tried when a spell needs a walkable or free tile. */
const TILE_TRIES = 16;

/** Being key of a slot (generation * MAX_BEINGS + slot), as culture/effects.ts keys them. */
function keyOf(sim: Sim, slot: number): number {
  return (sim.beings.store.generation[slot] ?? 0) * MAX_BEINGS + slot;
}

/** Aether a caster may hold: AETHER_BASE, plus AETHER_WELLSPRING with the trait `mana_wellspring` (18b ELM). */
export function aetherMax(sim: Sim, slot: number): number {
  const k = BEING_TRAIT_INDEX.get('mana_wellspring');
  return AETHER_BASE + (k !== undefined && sim.beings.store.hasMark(slot, k) ? AETHER_WELLSPRING : 0);
}

/** The caster's aether now and the entry it regenerates from (see the header). Reads only. */
function regenerate(sim: Sim, slot: number): AetherEntry {
  const max = aetherMax(sim, slot);
  const e = sim.spells.aether.get(keyOf(sim, slot)) ?? { value: max, at: sim.tick };
  const steps = Math.floor((sim.tick - e.at) / AETHER_REGEN_TICKS);
  if (e.value + steps >= max) return { value: max, at: sim.tick };
  return { value: e.value + steps, at: e.at + steps * AETHER_REGEN_TICKS };
}

/** Aether the Being holds now. */
export function aetherOf(sim: Sim, slot: number): number {
  return regenerate(sim, slot).value;
}

/** Spends aether (a success pays its cost, 08 9.1 design: cost is deducted). */
function spendAether(sim: Sim, slot: number, cost: number): void {
  const now = regenerate(sim, slot);
  sim.spells.aether.set(keyOf(sim, slot), { value: now.value - cost, at: now.at });
}

/**
 * Spell lists a Being may pick from (08 9.1: one list is picked uniformly, then one spell from it). Each list is a source:
 * the talent gifts it holds, its creed's spell tenets, or `fated_hero` (every built spell). Only built spells are listed.
 * Reads only; draws no rng.
 */
export function spellListsOf(sim: Sim, slot: number): string[][] {
  const s = sim.beings.store;
  const lists: string[][] = [];
  const talent: string[] = [];
  for (const [trait, spells] of TALENT_SPELLS) {
    const k = BEING_TRAIT_INDEX.get(trait);
    if (k !== undefined && s.hasMark(slot, k)) talent.push(...spells);
  }
  const builtTalent = talent.filter((id) => SPELL_BY_ID.get(id)?.built === true);
  if (builtTalent.length > 0) lists.push(builtTalent);
  const creed = creedSpellsOfSlot(sim, slot).filter((id) => SPELL_BY_ID.get(id)?.built === true);
  if (creed.length > 0) lists.push(creed);
  const fated = BEING_TRAIT_INDEX.get(FATED);
  if (fated !== undefined && s.hasMark(slot, fated)) lists.push(SPELLS.filter((sp) => sp.built).map((sp) => sp.id));
  return lists;
}

/** Whether a Being holds a spell (any source; the caster-slayer test of 18b U-7 and 06 section 7.5). Draws no rng. */
export function holdsSpells(sim: Sim, slot: number): boolean {
  return spellListsOf(sim, slot).length > 0;
}

/**
 * Caster-slayer credit (06 section 7.5, 18b U-7): a Being that kills a spellcaster gains the trait `caster_slayer`. Called
 * from killBeing (killer known) and from a spell that kills. Draws no rng.
 */
export function slayerCredit(sim: Sim, killer: number, victim: number): void {
  const s = sim.beings.store;
  if (killer === victim || s.alive[killer] !== 1 || !holdsSpells(sim, victim)) return;
  const k = BEING_TRAIT_INDEX.get(SLAYER);
  if (k !== undefined) s.setMark(killer, k, true);
}

/** Faction of a Being (hostility.ts), read from its species. */
function factionOfSlot(sim: Sim, slot: number): Faction {
  const idx = sim.beings.store.species[slot] ?? 0;
  return factionOf(sim.beings.species(idx), idx);
}

/** Whether `b` is an ally of `a`: the caster itself, a lineage kin (same strain), or a `friendly` relation (07 9.4). */
function allyOf(sim: Sim, a: number, b: number): boolean {
  const s = sim.beings.store;
  if (a === b) return true;
  if ((s.strain[a] ?? 0) !== 0 && s.strain[a] === s.strain[b]) return true;
  return relation(factionOfSlot(sim, a), factionOfSlot(sim, b), false) === 'F';
}

/** Whether `b` is hostile to `a` (07 9.4 relation `H`). */
function enemyOf(sim: Sim, a: number, b: number): boolean {
  return a !== b && relation(factionOfSlot(sim, a), factionOfSlot(sim, b), false) === 'H';
}

/** Living Beings within Chebyshev `radius` of (x,y), in alive-list order (deterministic). */
function beingsNear(sim: Sim, x: number, y: number, radius: number): number[] {
  const s = sim.beings.store;
  const out: number[] = [];
  for (let k = 0; k < s.size; k++) {
    const slot = s.at(k);
    if (Math.max(Math.abs((s.x[slot] ?? 0) - x), Math.abs((s.y[slot] ?? 0) - y)) <= radius) out.push(slot);
  }
  return out;
}

/** Tile index of a Being's tile. */
function tileOfSlot(sim: Sim, slot: number): number {
  const s = sim.beings.store;
  return (s.y[slot] ?? 0) * sim.realm.side + (s.x[slot] ?? 0);
}

/** Adds vitality to a Being, up to its maximum. */
function heal(sim: Sim, slot: number, share: number): void {
  const s = sim.beings.store;
  const max = s.maxVit[slot] ?? 0;
  s.vit[slot] = Math.min(max, (s.vit[slot] ?? 0) + Math.floor(max * share));
}

/** Whether the realm is in a night age (ages.ts `night` flag; sun_lance does half damage at night). */
function isNight(sim: Sim): boolean {
  return ageDef(sim.ages).flags.includes('night');
}

/** A walkable tile within `radius` of (x,y), drawn from the spells stream, or -1 after TILE_TRIES draws. */
function walkableNear(sim: Sim, x: number, y: number, radius: number): number {
  const realm = sim.realm;
  const rng = sim.rng('spells');
  for (let n = 0; n < TILE_TRIES; n++) {
    const tx = x + rng.int(2 * radius + 1) - radius;
    const ty = y + rng.int(2 * radius + 1) - radius;
    if (!realm.inBounds(tx, ty)) continue;
    const i = ty * realm.side + tx;
    if (walkable(realm, i)) return i;
  }
  return -1;
}

/**
 * The effect of one built spell (08 9.2), on the caster and the target Being. Returns false when the effect has no valid
 * place to land (no cost is spent then). Each effect uses an existing hook: a bomb profile (detonateBomb), a fire start
 * (startFire), the hex drop (hexAt), a status (EffectStore), damage (applyDamage) or a spawn (spawnBeing).
 */
function castEffect(sim: Sim, caster: number, target: number, spell: SpellDef): boolean {
  const s = sim.beings.store;
  const tick = sim.tick;
  const tx = s.x[target] ?? 0;
  const ty = s.y[target] ?? 0;
  switch (spell.id) {
    case 'blink': {
      // The sim has no islands, so the landing is any walkable tile (DECISIONS.md "Spells and rites close 14").
      const realm = sim.realm;
      const rng = sim.rng('spells');
      for (let n = 0; n < 64; n++) {
        const i = rng.int(realm.tileCount);
        if (!walkable(realm, i)) continue;
        s.x[caster] = i % realm.side;
        s.y[caster] = Math.floor(i / realm.side);
        sim.beings.task[caster] = -1;
        return true;
      }
      return false;
    }
    case 'bolt_call': {
      const bomb = BOMB_PROFILE_BY_ID.get('bolt_medium');
      return bomb !== undefined && detonateBomb(sim, bomb, tx, ty, false);
    }
    case 'hex_cast':
      hexAt(sim, tx, ty, HEX_RADIUS);
      return true;
    case 'kindle': {
      const realm = sim.realm;
      const rng = sim.rng('spells');
      const lit = startFire(sim, tileOfSlot(sim, target), true);
      for (let k = 0; k < KINDLE_SPREAD; k++) {
        const nx = tx + rng.int(3) - 1;
        const ny = ty + rng.int(3) - 1;
        if (realm.inBounds(nx, ny)) startFire(sim, ny * realm.side + nx, true);
      }
      return lit;
    }
    case 'hush_cast':
      for (const o of beingsNear(sim, tx, ty, HUSH_RADIUS)) sim.effects.add(o, 'hushed', tick);
      return true;
    case 'mending_rain':
      for (const o of beingsNear(sim, s.x[caster] ?? 0, s.y[caster] ?? 0, MENDING_RADIUS)) {
        if (enemyOf(sim, caster, o)) continue;
        sim.effects.remove(o, 'scorched');
        heal(sim, o, MENDING_HEAL);
      }
      return true;
    case 'sow_grass':
      return plantFlora(sim, tileOfSlot(sim, target), 'tall_grass');
    case 'raise_boneshambler': {
      const bi = speciesIndex('boneshambler');
      const cx = s.x[caster] ?? 0;
      const cy = s.y[caster] ?? 0;
      const near = beingsNear(sim, cx, cy, PATCH).filter((o) => s.species[o] === bi);
      if (near.length > BONESHAMBLER_LIMIT) return false;
      const i = walkableNear(sim, cx, cy, 3);
      if (i < 0) return false;
      return spawnBeing(sim, bi, i % sim.realm.side, Math.floor(i / sim.realm.side), true) >= 0;
    }
    case 'ward_self':
      if (sim.effects.has(caster, 'warded')) return true;
      return sim.effects.add(caster, 'warded', tick, WARD_TICKS);
    case 'purify': {
      const k = AFFLICTION_TRAITS.map((id) => BEING_TRAIT_INDEX.get(id)).filter((v): v is number => v !== undefined);
      for (const o of beingsNear(sim, tx, ty, PURIFY_RADIUS)) {
        if (enemyOf(sim, caster, o)) continue;
        for (const idx of k) if (s.hasMark(o, idx)) s.setMark(o, idx, false);
        for (const id of PURIFY_STATUSES) sim.effects.remove(o, id);
      }
      return true;
    }
    case 'crimson_shower': {
      const ctx = sim.combatContext();
      for (const o of beingsNear(sim, tx, ty, CRIMSON_RADIUS)) {
        if (allyOf(sim, caster, o)) {
          heal(sim, o, CRIMSON_HEAL);
        } else if (factionOfSlot(sim, o).kind !== 'undead') {
          applyDamage(ctx, o, Math.floor((s.maxVit[o] ?? 0) * CRIMSON_HARM), 'Other', false);
          if (s.alive[o] === 1) sim.effects.add(o, 'bleeding', tick);
        }
      }
      return true;
    }
    case 'frost_snap': {
      const warded = (o: number): boolean => sim.effects.has(o, 'warded');
      for (const o of beingsNear(sim, tx, ty, FROST_RADIUS)) {
        if (!warded(o)) sim.effects.add(o, 'rimebound', tick, FROST_TICKS);
      }
      return true;
    }
    case 'thorn_snare':
      for (const o of beingsNear(sim, tx, ty, THORN_RADIUS)) {
        if (!allyOf(sim, caster, o)) sim.effects.add(o, 'sluggish', tick, THORN_TICKS);
      }
      return true;
    case 'blind_mist':
      for (const o of beingsNear(sim, tx, ty, MIST_RADIUS)) {
        if (!allyOf(sim, caster, o)) sim.effects.add(o, 'blinded', tick, MIST_TICKS);
      }
      return true;
    case 'tremor_stomp': {
      const cx = s.x[caster] ?? 0;
      const cy = s.y[caster] ?? 0;
      const near = beingsNear(sim, cx, cy, STOMP_RADIUS).filter((o) => o !== caster);
      if (!near.some((o) => enemyOf(sim, caster, o))) return false;
      for (const o of near) if (!allyOf(sim, caster, o)) sim.effects.add(o, 'dazed', tick, STOMP_TICKS);
      return true;
    }
    case 'sun_lance': {
      let dmg = SUN_LANCE_DAMAGE;
      if (factionOfSlot(sim, target).kind === 'undead') dmg = Math.floor(dmg * 1.5);
      if (isNight(sim)) dmg = Math.floor(dmg * 0.5);
      applyDamage(sim.combatContext(), target, dmg, 'Fire', false);
      const sunmend = BEING_TRAIT_INDEX.get(SUNMEND);
      if (sunmend !== undefined) {
        for (const o of beingsNear(sim, s.x[caster] ?? 0, s.y[caster] ?? 0, 3)) {
          if (s.alive[o] === 1 && s.hasMark(o, sunmend) && allyOf(sim, caster, o)) heal(sim, o, SUNMEND_HEAL);
        }
      }
      return true;
    }
    default:
      return false;
  }
}

/**
 * The casting path (08 9.1, tryCast): the caster tries one spell against `target` (the blow's victim). Returns true when a
 * spell was cast (the blow is replaced), false when the basic blow goes ahead. Draws from the `spells` stream only when the
 * Being holds a spell source.
 */
export function tryCast(sim: Sim, caster: number, target: number): boolean {
  const s = sim.beings.store;
  const lists = spellListsOf(sim, caster);
  if (lists.length === 0) return false;
  if (sim.effects.has(caster, 'hushed') || isPossessed(sim, caster)) return false;
  if ((sim.spells.recover.get(caster) ?? 0) > sim.tick) return false;
  const rng = sim.rng('spells');
  // 08 section 2.1: the pool is {cast spell, basic attack}, one picked uniformly.
  if (rng.next() < 0.5) return false;
  const list = lists[rng.int(lists.length)] ?? [];
  const spell = SPELL_BY_ID.get(list[rng.int(list.length)] ?? '');
  if (!spell || !spell.built) return false;
  const cdKey = `${caster}:${spell.id}`;
  if ((sim.spells.cooldown.get(cdKey) ?? 0) > sim.tick) return false;
  if (aetherOf(sim, caster) < spell.cost) return false;
  const maxVit = s.maxVit[caster] ?? 0;
  if (spell.vitGate !== null && maxVit > 0 && (s.vit[caster] ?? 0) / maxVit >= spell.vitGate) return false;
  const aim = spell.target === 'self' ? caster : target;
  if (s.alive[aim] !== 1) return false;
  if (spell.target !== 'self' && Math.max(Math.abs((s.x[aim] ?? 0) - (s.x[caster] ?? 0)), Math.abs((s.y[aim] ?? 0) - (s.y[caster] ?? 0))) < spell.dist) return false;
  const k = BEING_TRAIT_INDEX.get(SLAYER);
  const foeOfSlayer = k !== undefined && s.hasMark(aim, k) && aim !== caster;
  const chance = spell.chance - (foeOfSlayer ? CASTER_SLAYER_PENALTY : 0);
  if (rng.next() >= chance) return false;
  const holder = aim !== caster && holdsSpells(sim, aim);
  if (!castEffect(sim, caster, aim, spell)) return false;
  spendAether(sim, caster, spell.cost);
  sim.spells.recover.set(caster, sim.tick + RECOVER_CAST_TICKS);
  if (spell.cd > 0) sim.spells.cooldown.set(cdKey, sim.tick + spell.cd);
  // A spell that kills a spellcaster credits the caster (the death hook, as killBeing does for a blow).
  if (holder && s.alive[aim] !== 1) slayerCredit(sim, caster, aim);
  return true;
}

/** Save record of the aether entries (chronicle tag 23). Dead Beings' entries are dropped. */
export interface SpellSave {
  /** [being key, aether value, tick the value was set]. */
  aether: [number, number, number][];
}

/** Plain copy of the aether entries of living casters, or null when there are none. */
export function snapshotSpells(sim: Sim): SpellSave | null {
  const s = sim.beings.store;
  const rows: [number, number, number][] = [];
  for (const [key, e] of sim.spells.aether) {
    if (!s.isCurrent(key % MAX_BEINGS, Math.floor(key / MAX_BEINGS))) continue;
    rows.push([key, e.value, e.at]);
  }
  return rows.length > 0 ? { aether: rows } : null;
}

/** Restores the aether entries of a checked save record. */
export function restoreSpells(sim: Sim, save: SpellSave): void {
  sim.spells.aether.clear();
  for (const [key, value, at] of save.aether) sim.spells.aether.set(key, { value, at });
}
