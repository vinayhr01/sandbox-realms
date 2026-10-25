/**
 * Factions and the relations matrix (07 section 9.2 and 9.4, round 8). Pure: the caller maps each Being to its
 * faction (`factionOf`, once per species) and asks `relation` for an ordered pair.
 *
 * The roster has no roamer bands, dominions or temperament data, so the archetypes reduce to the kinds below.
 * Rows are the actor and columns the other party, as in 07 section 9.4. `H` hostile (attacks on sight when the
 * fight start rule passes), `N` neutral (never starts a fight; fights back when attacked, see aggro.ts), `F`
 * friendly (never attacks), `I` ignore. "Hungry" is supplied by the caller: fuel at or below half, or an aggro
 * entry for the other party (07 section 9.4 note 1).
 */
import type { SpeciesDef } from '../../content/beasts.ts';

/** Faction kinds (07 section 9.4 archetypes, reduced to what the roster can express). */
export type FactionKind = 'grazer' | 'predator' | 'omni' | 'monster' | 'undead' | 'good' | 'folk' | 'hand' | 'steered';

/**
 * The faction of a possessed Being (07 section 13: `puppeted` forces faction `steered`, hostile to all but nature). Nature,
 * ruins and hand are inert in 07 section 9.4; here `hand` stays ignored (checked first in `relation`).
 */
export const STEERED_FACTION: Faction = { kind: 'steered', id: 0 };

/** A Being's faction. `id` is the species index for a monster (each monster is its own faction), else 0. */
export interface Faction {
  kind: FactionKind;
  id: number;
}

export type Relation = 'H' | 'N' | 'F' | 'I';

/**
 * Faction of a species (07 section 9.4). Folk are `folk`; group H is `hand` (inert); `aegiswing` is `good`; group F is
 * `undead`; group G is `monster` (its own faction per species); diet flesh is `predator`; grass and nectar are `grazer`;
 * everything else (omni, and no diet outside groups F and G) is `omni`, which is neutral to all (no temperament data).
 */
export function factionOf(def: SpeciesDef, speciesIdx: number): Faction {
  if (def.folk) return { kind: 'folk', id: 0 };
  if (def.group === 'H') return { kind: 'hand', id: 0 };
  if (def.id === 'aegiswing') return { kind: 'good', id: 0 };
  if (def.group === 'F') return { kind: 'undead', id: 0 };
  if (def.group === 'G') return { kind: 'monster', id: speciesIdx };
  if (def.diet === 'flesh') return { kind: 'predator', id: 0 };
  if (def.diet === 'grass' || def.diet === 'nectar') return { kind: 'grazer', id: 0 };
  return { kind: 'omni', id: 0 };
}

/**
 * Relation of `a` towards `b` (07 section 9.4 matrix). Monsters ignore other monster factions, and `hand` is ignored by
 * everyone. Predators are hostile to grazers, folk and omni beasts only while hungry, and always to undead and `good`.
 */
export function relation(a: Faction, b: Faction, hungry: boolean): Relation {
  if (a.kind === 'hand' || b.kind === 'hand') return 'I';
  // A possessed Being is hostile to every other faction, and every faction is hostile to it (07 section 13).
  if (a.kind === 'steered' || b.kind === 'steered') return 'H';
  if (a.kind === 'monster' && b.kind === 'monster') return a.id === b.id ? 'F' : 'I';
  switch (a.kind) {
    case 'folk':
      if (b.kind === 'grazer') return 'I';
      if (b.kind === 'predator' || b.kind === 'monster' || b.kind === 'undead') return 'H';
      if (b.kind === 'good') return 'F';
      return 'N';
    case 'monster':
      return 'H';
    case 'undead':
      if (b.kind === 'undead') return 'F';
      if (b.kind === 'monster') return 'I';
      return 'H';
    case 'good':
      if (b.kind === 'predator') return 'N';
      if (b.kind === 'monster' || b.kind === 'undead') return 'H';
      return 'F';
    case 'predator':
      if (b.kind === 'undead' || b.kind === 'good') return 'H';
      if (b.kind === 'predator' || b.kind === 'monster') return 'N';
      return hungry ? 'H' : 'N';
    case 'grazer':
    case 'omni':
      return 'N';
    default:
      return 'I';
  }
}
