/**
 * The eighteen spells of 08 section 9.2, the single spell table. Each row gives the strain talent trait that grants it
 * (18b TAL, a gift; `talent` is null for the five spells with no talent), the creed spell tenet `spell_<id>` (11 section
 * 4.2; the tenet id is the spell id with the prefix, see creeds.ts), the chance, the minimum distance in tiles, the aether
 * cost, the per-spell cooldown in ticks (0 for none), the target kind and the vitality gate (null for none).
 *
 * Every number here is TUNE (08 section 9.2 says so). `built` is false for a spell whose effect the sim has no hook for:
 * the row stays in the table and the spell is never chosen (DECISIONS.md "Spells and rites close 14").
 */

/** Target kinds of 08 section 9.2: `self` casts on the caster; the others act on a tile or on Beings near the victim. */
export type SpellTarget = 'self' | 'target' | 'units' | 'tile' | 'friendly';

export interface SpellDef {
  id: string;
  /** Talent trait (18b TAL) that grants the spell, or null. */
  talent: string | null;
  /** Chance per attempt, before skill (08 section 9.1; skill_spell is 0 here). TUNE. */
  chance: number;
  /** Minimum distance from caster to target, in tiles. 0 for none. */
  dist: number;
  /** Aether spent on a success. TUNE. */
  cost: number;
  /** Extra cooldown for this spell on the caster, in ticks. 0 for none. TUNE. */
  cd: number;
  target: SpellTarget;
  /** The caster casts only while vitality / max vitality is below this. Null for none. */
  vitGate: number | null;
  /** False when the sim has no effect for the spell. The row stays in the table; the spell is never chosen. */
  built: boolean;
}

export const SPELLS: readonly SpellDef[] = [
  { id: 'blink', talent: 'rift_gift', chance: 0.3, dist: 0, cost: 15, cd: 0, target: 'self', vitGate: 0.6, built: true },
  { id: 'bolt_call', talent: 'arc_gift', chance: 0.1, dist: 6, cost: 5, cd: 0, target: 'target', vitGate: null, built: true },
  // The sim has no whirlwind entity (the calamity whirlwind is a blast), so the row is not built.
  { id: 'whirl_call', talent: 'gale_gift', chance: 0.1, dist: 6, cost: 10, cd: 0, target: 'target', vitGate: null, built: false },
  { id: 'hex_cast', talent: null, chance: 0.2, dist: 4, cost: 3, cd: 0, target: 'units', vitGate: null, built: true },
  { id: 'kindle', talent: 'ember_gift', chance: 0.2, dist: 3, cost: 3, cd: 0, target: 'tile', vitGate: null, built: true },
  { id: 'hush_cast', talent: null, chance: 0.2, dist: 6, cost: 5, cd: 0, target: 'units', vitGate: null, built: true },
  { id: 'mending_rain', talent: 'mending_gift', chance: 0.3, dist: 0, cost: 2, cd: 0, target: 'self', vitGate: 0.9, built: true },
  { id: 'sow_grass', talent: null, chance: 0.1, dist: 0, cost: 4, cd: 0, target: 'tile', vitGate: null, built: true },
  // Fertilizer for trees: the sim has no tree fertilizer (fertiliseCrop is a manure pile on a crop), so not built.
  { id: 'overgrow', talent: null, chance: 0.1, dist: 0, cost: 5, cd: 0, target: 'tile', vitGate: null, built: false },
  { id: 'raise_boneshambler', talent: null, chance: 0.2, dist: 0, cost: 10, cd: 0, target: 'self', vitGate: null, built: true },
  { id: 'ward_self', talent: 'ward_gift', chance: 0.2, dist: 0, cost: 5, cd: 0, target: 'self', vitGate: null, built: true },
  { id: 'purify', talent: 'mending_gift', chance: 0.3, dist: 0, cost: 3, cd: 0, target: 'friendly', vitGate: null, built: true },
  { id: 'crimson_shower', talent: 'crimson_gift', chance: 0.2, dist: 4, cost: 8, cd: 200, target: 'tile', vitGate: null, built: true },
  { id: 'frost_snap', talent: 'rime_gift', chance: 0.15, dist: 5, cost: 8, cd: 300, target: 'tile', vitGate: null, built: true },
  { id: 'thorn_snare', talent: 'briar_gift', chance: 0.2, dist: 3, cost: 4, cd: 200, target: 'units', vitGate: null, built: true },
  { id: 'blind_mist', talent: 'mist_gift', chance: 0.2, dist: 4, cost: 5, cd: 250, target: 'units', vitGate: null, built: true },
  { id: 'tremor_stomp', talent: 'quake_gift', chance: 0.15, dist: 0, cost: 10, cd: 300, target: 'self', vitGate: null, built: true },
  { id: 'sun_lance', talent: 'sun_gift', chance: 0.1, dist: 6, cost: 9, cd: 400, target: 'target', vitGate: null, built: true },
];

export const SPELL_BY_ID: ReadonlyMap<string, SpellDef> = new Map(SPELLS.map((s) => [s.id, s]));

/** Talent trait id to the spells it grants (08 section 9.2 talent summary; mending_gift grants two). */
export const TALENT_SPELLS: ReadonlyMap<string, readonly string[]> = new Map([
  ['ember_gift', ['kindle']],
  ['arc_gift', ['bolt_call']],
  ['rift_gift', ['blink']],
  ['gale_gift', ['whirl_call']],
  ['crimson_gift', ['crimson_shower']],
  ['mending_gift', ['purify', 'mending_rain']],
  ['ward_gift', ['ward_self']],
  ['rime_gift', ['frost_snap']],
  ['briar_gift', ['thorn_snare']],
  ['mist_gift', ['blind_mist']],
  ['quake_gift', ['tremor_stomp']],
  ['sun_gift', ['sun_lance']],
]);

/** Aether a Being holds with no mana trait (08 section 9.1 names no value; TUNE). */
export const AETHER_BASE = 50;
/** Extra maximum aether from the trait `mana_wellspring` (18b ELM: Mana +50). */
export const AETHER_WELLSPRING = 50;
/** Ticks per point of aether regained (08 section 9.1: +1 per 60 ticks, OPEN). */
export const AETHER_REGEN_TICKS = 60;
/** Ticks a caster may not cast again after a cast (08 section 9.1: recover_cast, 100 ticks). */
export const RECOVER_CAST_TICKS = 100;
/** Chance a spell loses against a target carrying `caster_slayer` (18b U-7: spell chance of foes -10%). */
export const CASTER_SLAYER_PENALTY = 0.1;
