/**
 * Architect possession as a command (07 section 13; beings build 3). An order names a tile and whether to strike; while the
 * control lasts (ROUND9.possessTicks, refreshed by each order) the Being takes no decisions and follows the orders instead.
 * The per-tick behaviour is `possessedStep` in system.ts, which owns the movement and strike helpers. Control is not saved:
 * a loaded save returns its Beings to their AI (07 section 14 and 08 section 5.4 treat `puppeted` the same way).
 */
import type { Sim } from '../sim.ts';
import { MAX_BEINGS } from './store.ts';
import { ROUND9 } from './tuning.ts';

/**
 * Applies one Possess command. `beingId` is generation * MAX_BEINGS + slot; a stale id names nothing and is refused.
 * Returns false when the id is stale or the order tile lies outside the realm.
 */
export function possessCommand(sim: Sim, beingId: number, on: boolean, x: number, y: number, attack: boolean): boolean {
  const s = sim.beings.store;
  const slot = beingId % MAX_BEINGS;
  const gen = Math.floor(beingId / MAX_BEINGS);
  if (!s.isCurrent(slot, gen)) return false;
  if (!on) {
    s.possessUntil[slot] = 0;
    s.orderAttack[slot] = 0;
    return true;
  }
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= sim.realm.side || y >= sim.realm.side) return false;
  s.orderX[slot] = x;
  s.orderY[slot] = y;
  s.orderAttack[slot] = attack ? 1 : 0;
  s.possessUntil[slot] = sim.tick + ROUND9.possessTicks;
  // Control cancels sleep and the running decision task (07 section 13).
  s.sleepUntil[slot] = 0;
  sim.beings.task[slot] = -1;
  return true;
}

/** True while a Being is under the Architect's control. */
export function isPossessed(sim: Sim, slot: number): boolean {
  return (sim.beings.store.possessUntil[slot] ?? 0) > sim.tick;
}
