import { CREEP_IMMUNITY, GLOOM_FEVER_CHANCE } from '../../content/creeps.ts';
import { groundId } from '../../content/grounds.ts';
import { TUMOR_TRAIT, hasTrait, traitIndex } from '../beings/afflictions.ts';
import type { Sim } from '../sim.ts';

/**
 * Creep effects on Beings (18e 1.4). Each evaluation, a Being standing on a creep tile takes that creep's effect.
 *  - gloomgrowth: 5% chance to add growth fever (the trait). Skipped for `immune` (the status flag), warded_blood
 *    and gloom_immune species. Gloomgrowth never kills by itself.
 *  - bloatmoss: adds sluggish every evaluation (refreshed, not stacked). Skipped for bloat_immune species.
 *  - gourdgrowth: no harm. Its giggling chance is not modelled: the `giggling` status has no row in effects.ts yet.
 * Not modelled: unnerved (bloatmoss, 15%, no status row yet) and the flyer and swimmer exemption (the roster has
 * no flyer or swimmer flag).
 * Called once per sim-second from settlementsStep, which is every 20 ticks (18e 1.4). The 'creepEffect' stream is
 * drawn only for a Being on gloomgrowth that may catch fever, so a realm with no creep draws nothing.
 */
export function creepEffectsStep(sim: Sim): void {
  const realm = sim.realm;
  const s = sim.beings.store;
  const side = realm.side;
  const gloom = groundId('gloomgrowth');
  const bloat = groundId('bloatmoss');
  for (let k = 0; k < s.size; k++) {
    const slot = s.at(k);
    const tile = (s.y[slot] ?? 0) * side + (s.x[slot] ?? 0);
    const g = realm.ground[tile] ?? 0;
    if (g !== gloom && g !== bloat) continue;
    const species = sim.beings.species(s.species[slot] ?? 0).id;
    if (g === gloom) gloomEffect(sim, slot, species);
    else bloatEffect(sim, slot, species);
  }
}

/** Gloomgrowth (18e 1.4): a 5% chance per evaluation of growth fever, unless the Being is immune to it. */
function gloomEffect(sim: Sim, slot: number, species: string): void {
  if (CREEP_IMMUNITY.gloom_immune.includes(species)) return;
  if (sim.effects.flag(slot, 'immune') || hasTrait(sim, slot, 'warded_blood')) return;
  const tumor = traitIndex(TUMOR_TRAIT);
  if (tumor < 0 || hasTrait(sim, slot, TUMOR_TRAIT)) return;
  if (sim.rng('creepEffect').next() < GLOOM_FEVER_CHANCE) sim.beings.store.setMark(slot, tumor, true);
}

/** Bloatmoss (18e 1.4): sluggish on every evaluation, unless the species is bloat_immune. */
function bloatEffect(sim: Sim, slot: number, species: string): void {
  if (CREEP_IMMUNITY.bloat_immune.includes(species)) return;
  sim.effects.add(slot, 'sluggish', sim.tick);
}
