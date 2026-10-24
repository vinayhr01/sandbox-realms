/**
 * Mood, sleep and bonds (06 sections 4 and 5; bonds are a round 6 addition, see DECISIONS.md "Beings round 6").
 * Everything here reads and writes per-Being fields in the store and the strain registry; the decision and
 * life-cycle code in system.ts calls these.
 */
import { MOOD_VALUE, type MoodEvent } from '../../content/moods.ts';
import { STRAIN_TRAIT_BY_ID } from '../../content/traits.ts';
import type { Rng } from '../../shared/rng.ts';
import type { Sim } from '../sim.ts';
import { isAwakened } from './strains.ts';
import { ROUND6 } from './tuning.ts';

/** Mood bounds (06 section 4.1). */
const MOOD_MIN = -100;
const MOOD_MAX = 100;

/**
 * Whether a Being's strain feels mood (06 section 4.1: only strains with the `emotions` tag do). The spec names
 * the tag but no trait in the data grants it. OPEN default here: awakened strains (all four brain organs,
 * 18b section 0). Change this one predicate to widen it.
 */
export function feelsMood(sim: Sim, slot: number): boolean {
  const strain = sim.beings.strains.get(sim.beings.store.strain[slot] ?? 0);
  return strain !== undefined && isAwakened(strain.traits);
}

/** Applies one mood event (06 section 4.1, `changeMood`): mood = clamp(mood + value + extra). */
export function addMood(sim: Sim, slot: number, event: MoodEvent, extra = 0): void {
  if (!feelsMood(sim, slot)) return;
  const s = sim.beings.store;
  const next = (s.mood[slot] ?? 0) + MOOD_VALUE[event] + extra;
  s.mood[slot] = Math.min(MOOD_MAX, Math.max(MOOD_MIN, next));
}

/** Sleep kinds the decision layer starts (06 section 5 decisions: idle_nap, polyphasic, monophasic). */
export type SleepKind = 'nap' | 'poly' | 'mono';

/** Whether the strain holds a sleep-cycle trait (18b group SLP). */
function hasSleepCycle(traits: readonly string[]): boolean {
  return traits.some((id) => STRAIN_TRAIT_BY_ID.get(id)?.group === 'SLP');
}

/**
 * Length of a sleep in ticks (06 section 5): monophasic 800 to 1800; a strain with no sleep-cycle trait 400;
 * otherwise uniform 400 to 1200. The era-linked durations (2000) are not built: no era-to-trait mapping
 * exists in the data.
 */
export function sleepTicks(sim: Sim, slot: number, kind: SleepKind, rng: Rng): number {
  if (kind === 'mono') return ROUND6.monoMin + rng.int(ROUND6.monoMax - ROUND6.monoMin + 1);
  const strain = sim.beings.strains.get(sim.beings.store.strain[slot] ?? 0);
  if (!strain || !hasSleepCycle(strain.traits)) return ROUND6.sleepPlain;
  return ROUND6.sleepMin + rng.int(ROUND6.sleepMax - ROUND6.sleepMin + 1);
}

/** Starts a sleep (06 section 5). The Being stops deciding and moving until it wakes. */
export function beginSleep(sim: Sim, slot: number, kind: SleepKind): void {
  const s = sim.beings.store;
  s.sleepUntil[slot] = sim.tick + sleepTicks(sim, slot, kind, sim.rng('beings'));
  s.sleepVit[slot] = s.vit[slot] ?? 0;
  sim.beings.stats.sleeps++;
}

/**
 * Sleep check, once per tick for a sleeping Being. Returns true while it still sleeps. Damage of any source
 * ends the sleep early with no mood and no endurance (06 section 5: early removal gives none of these).
 * A natural wake restores 20% of max endurance and gives the `slept` mood event (the dream roll is not built).
 */
export function sleepCheck(sim: Sim, slot: number): boolean {
  const s = sim.beings.store;
  if ((s.sleepUntil[slot] ?? 0) === 0) return false;
  const vit = s.vit[slot] ?? 0;
  if (vit < (s.sleepVit[slot] ?? 0)) {
    s.sleepUntil[slot] = 0;
    s.sleepVit[slot] = vit;
    return false;
  }
  s.sleepVit[slot] = vit;
  if (sim.tick < (s.sleepUntil[slot] ?? 0)) return true;
  s.sleepUntil[slot] = 0;
  const max = sim.beings.species(s.species[slot] ?? 0).endurance;
  s.endurance[slot] = Math.min(max, (s.endurance[slot] ?? 0) + Math.round(max * ROUND6.sleepEndurance));
  addMood(sim, slot, 'slept');
  return false;
}

/** A Being is asleep (06 section 5). */
export function isAsleep(sim: Sim, slot: number): boolean {
  return (sim.beings.store.sleepUntil[slot] ?? 0) !== 0;
}

/**
 * Bond check for one Being (round 6, bonds). Two Beings of one strain that stay within `bondRadius` tiles for
 * `bondTicks` ticks, both unbonded, become bonded: each gets the `bonded` mood event. A bond lasts until one
 * partner dies (killBeing, which gives the survivor `friend_died`).
 */
export function bondCheck(sim: Sim, slot: number): void {
  const b = sim.beings;
  const s = b.store;
  if ((s.bondWith[slot] ?? -1) !== -1) return;
  const strain = s.strain[slot] ?? 0;
  const cand = b.nearest(slot, (o) => (s.strain[o] ?? 0) === strain && (s.bondWith[o] ?? -1) === -1, ROUND6.bondRadius);
  if (cand < 0) {
    s.closeWith[slot] = -1;
    return;
  }
  const gen = s.generation[cand] ?? 0;
  if (s.closeWith[slot] !== cand || s.closeGen[slot] !== gen) {
    s.closeWith[slot] = cand;
    s.closeGen[slot] = gen;
    s.closeSince[slot] = sim.tick;
    return;
  }
  if (sim.tick - (s.closeSince[slot] ?? 0) < ROUND6.bondTicks) return;
  s.bondWith[slot] = cand;
  s.bondGen[slot] = gen;
  s.closeWith[slot] = -1;
  s.bondWith[cand] = slot;
  s.bondGen[cand] = s.generation[slot] ?? 0;
  s.closeWith[cand] = -1;
  addMood(sim, slot, 'bonded');
  addMood(sim, cand, 'bonded');
  b.stats.bonds++;
}
