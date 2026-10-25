import { MAX_CATCHUP_MS, TICK_MS } from '../shared/constants.ts';
import { PING_LOST_MS, type Speed } from '../shared/protocol.ts';

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
 * True when the page has gone silent for too long (19 section 2, main_hang). `lastPingMs` is null before the first ping,
 * so a worker that never had a page does not judge one. A hidden page is never judged: its timers are throttled.
 */
export function mainPingLost(lastPingMs: number | null, nowMs: number, hidden: boolean): boolean {
  return lastPingMs !== null && !hidden && nowMs - lastPingMs > PING_LOST_MS;
}

/** Window in wall ms in which faults in one part count toward a switch-off (17 section 9: 3 errors in 10 s). */
export const SYS_FAULT_WINDOW_MS = 10_000;
/** Faults in one part inside the window that switch it off (17 section 9). */
export const SYS_FAULTS_TO_DISABLE = 3;
/** Sim ticks a switched-off part stays off (17 section 9: disabled for 600 ticks). */
export const SYS_DISABLE_TICKS = 600;
/** Switch-offs of one part that stop the sim (17 section 9: 3 disable cycles, then Fault error and auto-pause). */
export const SYS_DISABLE_CYCLES = 3;

/** What the worker does after a part faulted: nothing, switch the part off, or switch it off for the last time (stop). */
export type SysVerdict = 'ok' | 'disable' | 'stop';

interface SysPart {
  /** Wall times (ms) of the part's faults still inside the window, oldest first. */
  faults: number[];
  /** The part is off while the sim tick is below this. */
  offUntil: number;
  /** Switch-offs so far in this realm. */
  cycles: number;
}

/**
 * System isolation (17 section 9): counts the faults of each worker part and switches a part off after repeated faults.
 * The switch-off runs on sim ticks, as the spec says, so a paused sim (no ticks) keeps a part off until it runs again.
 * One instance per realm: a new realm starts with every part on. Pure: the caller passes the wall time and the tick.
 */
export class SysIsolation {
  private readonly parts = new Map<string, SysPart>();

  /** Notes one fault in `part` and returns the verdict, with the part's fault count inside the window (this one included). */
  fault(part: string, nowMs: number, tick: number): { verdict: SysVerdict; errorCount: number } {
    const state = this.parts.get(part) ?? { faults: [], offUntil: 0, cycles: 0 };
    this.parts.set(part, state);
    state.faults = [...state.faults.filter((t) => nowMs - t < SYS_FAULT_WINDOW_MS && t <= nowMs), nowMs];
    const errorCount = state.faults.length;
    if (errorCount < SYS_FAULTS_TO_DISABLE) return { verdict: 'ok', errorCount };
    state.faults = [];
    state.cycles += 1;
    state.offUntil = tick + SYS_DISABLE_TICKS;
    return { verdict: state.cycles >= SYS_DISABLE_CYCLES ? 'stop' : 'disable', errorCount };
  }

  /** True while `part` is switched off at sim tick `tick`. */
  isOff(part: string, tick: number): boolean {
    const state = this.parts.get(part);
    return state !== undefined && tick < state.offUntil;
  }
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
