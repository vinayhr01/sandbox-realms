/**
 * Perception (07 section 8, round 8): what a Being can see and when it looks. The sight is approximated by a radius
 * (trait-hooks `sightRadius`, one Patch by default); the search cadence and the choice among candidates follow 07.
 * Random draws use the `beings` stream, in a fixed order, so a loaded run searches exactly as the live one.
 */
import type { Sim } from '../sim.ts';
import { sightRadius } from './trait-hooks.ts';
import { ROUND8 } from './tuning.ts';

/** Patch side in tiles (07 section 8, 16 by 16). */
const PATCH = 16;

/** Whether two tiles lie in the same 16 by 16 Patch. */
function samePatch(sim: Sim, a: number, b: number): boolean {
  const s = sim.beings.store;
  const ax = Math.floor((s.x[a] ?? 0) / PATCH);
  const ay = Math.floor((s.y[a] ?? 0) / PATCH);
  return ax === Math.floor((s.x[b] ?? 0) / PATCH) && ay === Math.floor((s.y[b] ?? 0) / PATCH);
}

/** Squared tile distance between two Beings. */
function dist2(sim: Sim, a: number, b: number): number {
  const s = sim.beings.store;
  const dx = (s.x[a] ?? 0) - (s.x[b] ?? 0);
  const dy = (s.y[a] ?? 0) - (s.y[b] ?? 0);
  return dx * dx + dy * dy;
}

/** Whether a search is due (07 section 8: a Being scans once per 2 to 22 ticks). */
export function searchDue(sim: Sim, slot: number): boolean {
  return sim.tick >= (sim.beings.store.searchAt[slot] ?? 0);
}

/** Schedules the next search: 2 + rand(0..20) ticks from now (07 section 8). */
export function scheduleSearch(sim: Sim, slot: number): void {
  sim.beings.store.searchAt[slot] = sim.tick + ROUND8.searchMin + sim.rng('beings').int(ROUND8.searchSpread);
}

/**
 * Finds one enemy in sight that passes `isEnemy` (07 section 8, `findEnemyObjectTarget`). Candidates are the Beings
 * within sight. With 80% probability the Being's own Patch is preferred when it holds one. With more than 50
 * candidates, 60% of picks are the closest and 40% a random one. Otherwise the closest wins, lowest slot on a tie.
 * Returns the slot or -1.
 */
export function findEnemy(sim: Sim, slot: number, isEnemy: (o: number) => boolean): number {
  const list = sim.beings.within(slot, isEnemy, sightRadius(sim, slot));
  if (list.length === 0) return -1;
  const rng = sim.rng('beings');
  let pool = list;
  if (rng.next() < 0.8) {
    const own = list.filter((o) => samePatch(sim, slot, o));
    if (own.length > 0) pool = own;
  }
  if (pool.length > 50 && rng.next() >= 0.6) return pool[rng.int(pool.length)] ?? -1;
  let best = -1;
  let bestD = Number.POSITIVE_INFINITY;
  for (const o of pool) {
    const d = dist2(sim, slot, o);
    if (d < bestD || (d === bestD && o < best)) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

/** Chebyshev distance between two Beings, in tiles. */
export function tileGap(sim: Sim, a: number, b: number): number {
  const s = sim.beings.store;
  return Math.max(Math.abs((s.x[a] ?? 0) - (s.x[b] ?? 0)), Math.abs((s.y[a] ?? 0) - (s.y[b] ?? 0)));
}
