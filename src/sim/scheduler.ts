import { MAX_CATCHUP_MS, TICK_MS } from '../shared/constants.ts';
import type { Speed } from '../shared/protocol.ts';
import { MAX_TICKS_PER_PUMP } from './sim.ts';

export interface PumpPlan {
  /** Ticks to run this pump. */
  ticks: number;
  /** World-time accumulator after the ticks are run. */
  accMs: number;
}

/**
 * Pure pacing: converts elapsed wall time into a tick count (17 section 3.1). Keeps the
 * accumulator in world milliseconds and clamps catch-up to MAX_CATCHUP_MS.
 * `budgetTicks` is what the time budget allows, computed by the caller.
 */
export function planPump(accMs: number, elapsedWallMs: number, speed: Speed, budgetTicks: number): PumpPlan {
  let acc = accMs + elapsedWallMs * speed;
  if (acc > MAX_CATCHUP_MS) acc = MAX_CATCHUP_MS;
  const cap = Math.min(MAX_TICKS_PER_PUMP[speed], budgetTicks);
  let ticks = 0;
  while (acc >= TICK_MS && ticks < cap) {
    acc -= TICK_MS;
    ticks++;
  }
  return { ticks, accMs: acc };
}
