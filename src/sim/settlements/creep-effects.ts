import { BLOAT_UNNERVE_CHANCE, CREEP_IMMUNITY, GLOOM_FEVER_CHANCE, GOURD_GIGGLE_CHANCE } from '../../content/creeps.ts';
import { groundId } from '../../content/grounds.ts';
import { TUMOR_TRAIT, hasTrait, traitIndex } from '../beings/afflictions.ts';
import { addMood } from '../beings/social.ts';
import type { Sim } from '../sim.ts';

/**
 * Creep effects on Beings (18e 1.4). Each evaluation, a Being standing on a creep tile takes that creep's effect.
 *  - gloomgrowth: 5% chance to add growth fever (the trait). Skipped for `immune` (the status flag), warded_blood
 *    and gloom_immune species. Gloomgrowth never kills by itself.
 *  - bloatmoss: adds sluggish every evaluation (refreshed, not stacked), and 15% adds `unnerved` (mood -8 on first
 *    apply). Skipped for bloat_immune species.
 *  - gourdgrowth: no harm. 3% chance to add `giggling` (emote only).
 * Not modelled: the flyer and swimmer exemption (the roster has no flyer or swimmer flag).
 * Called once per sim-second from settlementsStep, which is every 20 ticks (18e 1.4). The 'creepEffect' stream is
 * drawn only for a Being on a creep that rolls (gloomgrowth fever, bloatmoss unnerve, gourdgrowth giggle), so a
 * realm with no creep draws nothing.
 */
export function creepEffectsStep(sim: Sim): void {
  const realm = sim.realm;
  const s = sim.beings.store;
  const side = realm.side;
  const gloom = groundId('gloomgrowth');
  const bloat = groundId('bloatmoss');
  const gourd = groundId('gourdgrowth');
  for (let k = 0; k < s.size; k++) {
    const slot = s.at(k);
    const tile = (s.y[slot] ?? 0) * side + (s.x[slot] ?? 0);
    const g = realm.ground[tile] ?? 0;
    if (g !== gloom && g !== bloat && g !== gourd) continue;
    const species = sim.beings.species(s.species[slot] ?? 0).id;
    if (g === gloom) gloomEffect(sim, slot, species);
    else if (g === bloat) bloatEffect(sim, slot, species);
    else gourdEffect(sim, slot);
  }
}

/** Gourdgrowth (18e 1.4): no harm; a 3% chance per evaluation of giggling (3 s, emote only). */
function gourdEffect(sim: Sim, slot: number): void {
  if (sim.rng('creepEffect').next() < GOURD_GIGGLE_CHANCE) sim.effects.add(slot, 'giggling', sim.tick);
}

/** Gloomgrowth (18e 1.4): a 5% chance per evaluation of growth fever, unless the Being is immune to it. */
function gloomEffect(sim: Sim, slot: number, species: string): void {
  if (CREEP_IMMUNITY.gloom_immune.includes(species)) return;
  if (sim.effects.flag(slot, 'immune') || hasTrait(sim, slot, 'warded_blood')) return;
  const tumor = traitIndex(TUMOR_TRAIT);
  if (tumor < 0 || hasTrait(sim, slot, TUMOR_TRAIT)) return;
  if (sim.rng('creepEffect').next() < GLOOM_FEVER_CHANCE) sim.beings.store.setMark(slot, tumor, true);
}

/**
 * Bloatmoss (18e 1.4): sluggish on every evaluation, unless the species is bloat_immune. A 15% roll adds `unnerved`;
 * its mood -8 is taken only when the status is new (08 section 5.3, "on apply").
 */
function bloatEffect(sim: Sim, slot: number, species: string): void {
  if (CREEP_IMMUNITY.bloat_immune.includes(species)) return;
  sim.effects.add(slot, 'sluggish', sim.tick);
  if (sim.rng('creepEffect').next() >= BLOAT_UNNERVE_CHANCE) return;
  const fresh = !sim.effects.has(slot, 'unnerved');
  if (sim.effects.add(slot, 'unnerved', sim.tick) && fresh) addMood(sim, slot, 'unnerved');
}
