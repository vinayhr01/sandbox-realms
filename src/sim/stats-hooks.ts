/**
 * Sim-side wiring for the lifetime stats (14). The sim owns `lifetime` and `unlocked`; systems
 * report what happened through recordStat, and the sim checks achievements once per sim-second.
 * Nothing here reads randomness or changes sim state, so counting never alters the outcome.
 */
import { YEAR_TICKS } from '../shared/constants.ts';
import { evaluateAchievements, recordEvent, type StatsEvent } from './stats.ts';
import type { Sim } from './sim.ts';

/** Counts one event into the sim's lifetime record. */
export function recordStat(sim: Sim, event: StatsEvent): void {
  recordEvent(sim.lifetime, event);
}

/**
 * Emits one sim.year per completed sim year not yet counted, then unlocks every achievement whose
 * predicate now holds. Each id is added to the unlocked set once and never removed. Returns the
 * ids that unlocked on this call, in catalogue order.
 */
export function unlockAchievements(sim: Sim): string[] {
  const years = Math.floor(sim.tick / YEAR_TICKS);
  const counted = sim.lifetime.counters['simYearsElapsed'] ?? 0;
  for (let y = counted; y < years; y++) recordEvent(sim.lifetime, { kind: 'sim.year' });
  const fresh = evaluateAchievements(sim.lifetime, sim.unlocked);
  for (const id of fresh) sim.unlocked.add(id);
  return fresh;
}
