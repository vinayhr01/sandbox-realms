/**
 * Affliction sources and death conversions (08 section 8, 06 section 7.4; beings build 3). Sources here are the ones the sim
 * already has: the blow of a combat hit (system.ts strike) and the statuses of effects.ts. The conversion table and gates
 * are data; the spawn of the converted Being is in system.ts (`convertOnDeath`), which owns the Being lifecycle.
 *
 * Tumor tile contact (creep cover) is built (`creepContact`, beings close 4). Not built: the `spore` affliction's cloud
 * drop, the plague, the hex spell (08 sections 5 and 8; no spell state exists) and the tumor tick. A hex source needs the
 * spell, and no combat hit or Favour drop applies the `hexed` status (DECISIONS.md "Beings close 4").
 */
import { ground } from '../../content/grounds.ts';
import { BEING_TRAIT_INDEX } from '../../content/traits.ts';
import type { SpeciesDef } from '../../content/beasts.ts';
import type { Sim } from '../sim.ts';
import { ROUND9 } from './tuning.ts';

/** Species that are conversion targets (06 7.4). They never convert again, which stops a second conversion (`transformed`). */
export const CONVERSION_TARGETS: ReadonlySet<string> = new Set(['rotstride', 'capstroll', 'patchbeast', 'boneshambler']);

/** The species whose bite spreads rot (18a: rotstride, bite 50% on Folk to convert, rotting status). */
export const ROT_BITER = 'rotstride';

/** The affliction traits (18b group ACQ, 08 section 8). Working names: infection, spore, tumor. */
export const ROT_TRAIT = 'rot_touched';
export const SPORE_TRAIT = 'spore_lodged';
export const TUMOR_TRAIT = 'growth_fever';

/** Traits a conversion strips with the afflictions (06 7.4: rot loses swiftfoot, luminary, placid). */
const STRIP_ALWAYS = [ROT_TRAIT, SPORE_TRAIT, TUMOR_TRAIT];
const STRIP_ROT = ['swiftfoot', 'luminary', 'placid'];

/**
 * Affliction traits a conversion removes from the Being that becomes the target (06 7.4 common template: strip the
 * afflictions and `hexed`). `rotting` and `hexed` are statuses and are cleared by the caller.
 */
export function stripped(target: string): string[] {
  return target === 'rotstride' ? [...STRIP_ALWAYS, ...STRIP_ROT] : STRIP_ALWAYS;
}

/** Trait index of a being trait id, or -1 when the id is not in the table. */
export function traitIndex(id: string): number {
  return BEING_TRAIT_INDEX.get(id) ?? -1;
}

/** Whether the Being carries a being trait (a mark, 18b). */
export function hasTrait(sim: Sim, slot: number, id: string): boolean {
  const k = traitIndex(id);
  return k >= 0 && sim.beings.store.hasMark(slot, k);
}

/**
 * Whether a species can become a conversion target: any species that is not itself a target (06 7.4 `canBecome*`
 * flags are not in the roster data, so every non-target species stands in for them; TUNE).
 */
export function convertible(def: SpeciesDef): boolean {
  return !CONVERSION_TARGETS.has(def.id);
}

/**
 * The species a Being turns into when it dies (06 7.4), or null when no conversion applies. Priority follows the table:
 * rot (the `rotting` status or the `rot_touched` trait) to rotstride, spore to capstroll, tumor to patchbeast, the `hexed`
 * status to boneshambler. `haloed` (Architect favour) blocks the rot, spore and tumor rules (18b).
 */
export function conversionOf(sim: Sim, slot: number, def: SpeciesDef): string | null {
  if (!convertible(def)) return null;
  const haloed = hasTrait(sim, slot, 'haloed');
  if (!haloed && (sim.effects.has(slot, 'rotting') || hasTrait(sim, slot, ROT_TRAIT))) return 'rotstride';
  if (!haloed && hasTrait(sim, slot, SPORE_TRAIT)) return 'capstroll';
  if (!haloed && hasTrait(sim, slot, TUMOR_TRAIT)) return 'patchbeast';
  if (sim.effects.has(slot, 'hexed')) return 'boneshambler';
  return null;
}

/**
 * Tumor source by tile contact (08 section 8: a Being on creep cover may catch growth fever). Runs every ROUND9.tumorTicks.
 * The `canBeTumor` species flag is not in the roster data, so every species that is not a conversion target stands in for
 * it (TUNE, as `convertible`). Warded blood blocks it. Draws only on creep, so the stream is unchanged elsewhere.
 */
export function creepContact(sim: Sim, slot: number, rng: { next(): number }): void {
  const s = sim.beings.store;
  const tumor = traitIndex(TUMOR_TRAIT);
  if (tumor < 0 || s.hasMark(slot, tumor) || hasTrait(sim, slot, 'warded_blood')) return;
  if (CONVERSION_TARGETS.has(sim.beings.species(s.species[slot] ?? 0).id)) return;
  const i = (s.y[slot] ?? 0) * sim.realm.side + (s.x[slot] ?? 0);
  if (!ground(sim.realm.ground[i] ?? 0).creep) return;
  if (rng.next() < ROUND9.tumorContact) s.setMark(slot, tumor, true);
}

/**
 * Affliction sources of one landed blow (08 section 8, combat hits and statuses that exist): a rotstride bite may leave
 * the victim `rotting` (ROUND9.rotBite); a spore-lodged attacker may leave its victim spore-lodged (ROUND9.sporeCatch);
 * a growth-fever attacker may leave its victim with growth fever (ROUND9.tumorCatch). `warded_blood` blocks them all.
 * Draws from `rng` only when a source applies, so the stream is the same on every replay.
 */
export function blowAfflictions(sim: Sim, attacker: number, victim: number, rng: { next(): number }, tick: number): void {
  const s = sim.beings.store;
  if (hasTrait(sim, victim, 'warded_blood')) return;
  const attackerSpecies = sim.beings.species(s.species[attacker] ?? 0);
  if (attackerSpecies.id === ROT_BITER && rng.next() < ROUND9.rotBite) sim.effects.add(victim, 'rotting', tick);
  const spore = traitIndex(SPORE_TRAIT);
  if (spore >= 0 && s.hasMark(attacker, spore) && !s.hasMark(victim, spore) && rng.next() < ROUND9.sporeCatch) s.setMark(victim, spore, true);
  const tumor = traitIndex(TUMOR_TRAIT);
  if (tumor >= 0 && s.hasMark(attacker, tumor) && !s.hasMark(victim, tumor) && rng.next() < ROUND9.tumorCatch) s.setMark(victim, tumor, true);
}
