/**
 * Aggro (07 section 10.4, round 8): who a Being is angry at. Each Being keeps up to AGGRO_SLOTS entries (attacker slot,
 * attacker generation, and the tick the grudge ends) in the store, so the set is saved with the chronicle. Entries
 * expire one by one, and an entry whose attacker has died (generation moved on) counts for nothing.
 *
 * Deviations from 07 section 10.4: the set has a cap of four (the oldest entry is replaced), and expiry is per entry,
 * not for the whole set when seething ends.
 */
import type { Sim } from '../sim.ts';
import { AGGRO_SLOTS } from './store.ts';
import { ROUND8 } from './tuning.ts';

/** Whether entry `i` of a Being names a living attacker whose grudge has not ended. */
function live(sim: Sim, i: number): boolean {
  const s = sim.beings.store;
  const id = s.aggroId[i] ?? -1;
  return id >= 0 && (s.aggroUntil[i] ?? 0) > sim.tick && s.isCurrent(id, s.aggroGen[i] ?? 0);
}

/**
 * Makes `slot` angry at `who` for `ticks` (07 section 10.4 `addAggro`; the seething effect is the grudge's end tick).
 * An existing entry is extended, not duplicated. Self, dead beings and negative ids are ignored.
 */
export function addAggro(sim: Sim, slot: number, who: number, ticks: number = ROUND8.seethingTicks): void {
  const s = sim.beings.store;
  if (who < 0 || who === slot || s.alive[slot] !== 1 || s.alive[who] !== 1) return;
  const gen = s.generation[who] ?? 0;
  const until = sim.tick + ticks;
  const base = slot * AGGRO_SLOTS;
  let free = -1;
  let oldest = base;
  for (let k = 0; k < AGGRO_SLOTS; k++) {
    const i = base + k;
    if (s.aggroId[i] === who && s.aggroGen[i] === gen) {
      if (until > (s.aggroUntil[i] ?? 0)) s.aggroUntil[i] = until;
      return;
    }
    if (free < 0 && !live(sim, i)) free = i;
    if ((s.aggroUntil[i] ?? 0) < (s.aggroUntil[oldest] ?? 0)) oldest = i;
  }
  const i = free >= 0 ? free : oldest;
  s.aggroId[i] = who;
  s.aggroGen[i] = gen;
  s.aggroUntil[i] = until;
}

/** The living attackers `slot` is angry at, in entry order (07 section 10.4). */
export function aggroFoes(sim: Sim, slot: number): number[] {
  const s = sim.beings.store;
  const out: number[] = [];
  const base = slot * AGGRO_SLOTS;
  for (let k = 0; k < AGGRO_SLOTS; k++) {
    const i = base + k;
    if (live(sim, i)) out.push(s.aggroId[i] ?? -1);
  }
  return out;
}

/** Drops every entry of a Being (used when a Being is removed from the world). */
export function clearAggro(sim: Sim, slot: number): void {
  const s = sim.beings.store;
  const base = slot * AGGRO_SLOTS;
  s.aggroId.fill(-1, base, base + AGGRO_SLOTS);
  s.aggroGen.fill(0, base, base + AGGRO_SLOTS);
  s.aggroUntil.fill(0, base, base + AGGRO_SLOTS);
}
