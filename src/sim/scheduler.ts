import { MAX_CATCHUP_MS, TICK_MS } from '../shared/constants.ts';
import type { Speed } from '../shared/protocol.ts';

/** Speed -> ticks allowed per pump (17 section 3.1). The tick length never changes. */
export const MAX_TICKS_PER_PUMP: Readonly<Record<Speed, number>> = { 0: 0, 0.5: 1, 1: 1, 2: 2, 5: 5, 10: 10 };

/** Pump faults in a row before the worker stops the sim for good (a single fault is recoverable). */
export const MAX_CONSECUTIVE_PUMP_FAULTS = 3;

/**
 * What the worker does after a pump threw: keep the port re-armed while faults are isolated, and
 * stop with a fatal fault once `consecutiveFaults` (counting the one just thrown) reaches the limit.
 */
export function pumpFaultAction(consecutiveFaults: number): 'rearm' | 'fatal' {
  return consecutiveFaults >= MAX_CONSECUTIVE_PUMP_FAULTS ? 'fatal' : 'rearm';
}

export interface PumpPlan {
  /** Ticks to run this pump. */
  ticks: number;
  /** World-time accumulator after the ticks are run. */
  accMs: number;
}

/**
 * Pure pacing: converts elapsed wall time into a tick count (17 section 3.1). Keeps the
 * accumulator in world milliseconds, clamps catch-up to MAX_CATCHUP_MS and caps ticks per speed.
 */
export function planPump(accMs: number, elapsedWallMs: number, speed: Speed): PumpPlan {
  let acc = accMs + elapsedWallMs * speed;
  if (acc > MAX_CATCHUP_MS) acc = MAX_CATCHUP_MS;
  const cap = MAX_TICKS_PER_PUMP[speed];
  let ticks = 0;
  while (acc >= TICK_MS && ticks < cap) {
    acc -= TICK_MS;
    ticks++;
  }
  return { ticks, accMs: acc };
}
