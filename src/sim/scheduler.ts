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
 * Wall-clock frame delta clamp in ms (02 section 2: "frameDt is clamped to 100 ms (tab-switch spike)").
 * Applied before the speed multiplier, so a stall adds at most 100 ms of wall time at any speed.
 */
export const FRAME_DT_CLAMP_MS = 100;

/** Sim ticks between heartbeats: one sim-second (02 section 1). */
export const HEARTBEAT_TICKS = 20;

/**
 * Pumps between heartbeats when no tick ran (paused, or speed 0): about one second at 60 pumps/s.
 * Pumps are scheduling, not sim state, so counting them keeps the sim free of wall-clock reads. TUNE.
 */
export const HEARTBEAT_PUMPS = 60;

/** True when the worker should post a heartbeat: enough ticks since the last one, or enough idle pumps. */
export function heartbeatDue(tick: number, lastHeartbeatTick: number, pumpsSinceHeartbeat: number): boolean {
  return tick - lastHeartbeatTick >= HEARTBEAT_TICKS || pumpsSinceHeartbeat >= HEARTBEAT_PUMPS;
}

/**
 * Pure pacing: converts elapsed wall time into a tick count (17 section 3.1). The wall delta is clamped
 * to FRAME_DT_CLAMP_MS (02 section 2), the accumulator in world milliseconds is clamped to MAX_CATCHUP_MS
 * (17 section 3.1), and ticks are capped per speed.
 */
export function planPump(accMs: number, elapsedWallMs: number, speed: Speed): PumpPlan {
  const dt = Math.min(Math.max(0, elapsedWallMs), FRAME_DT_CLAMP_MS);
  let acc = accMs + dt * speed;
  if (acc > MAX_CATCHUP_MS) acc = MAX_CATCHUP_MS;
  const cap = MAX_TICKS_PER_PUMP[speed];
  let ticks = 0;
  while (acc >= TICK_MS && ticks < cap) {
    acc -= TICK_MS;
    ticks++;
  }
  return { ticks, accMs: acc };
}
