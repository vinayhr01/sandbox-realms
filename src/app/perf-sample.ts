/**
 * Perf samples for crash records (19 section 3 pressure sensors, section 5 perf block). Frame times come from the
 * main thread's ticker, sim times from the worker's smoothed tick time (FrameStats.avgTickMs), and long tasks from a
 * PerformanceObserver where the browser offers one. Each ring is bounded, so the cost stays small.
 */

const FRAME_MAX = 300;
const SIM_MAX = 300;
const LONG_MAX = 100;
/** Frames longer than this are gaps (hidden tab, debugger pause), not load (same rule as the degrade ladder). */
const FRAME_GAP_MS = 500;
const LONG_WINDOW_MS = 30_000;

const frames: number[] = [];
const sims: number[] = [];
/** performance.now() at the start of each long task. */
const longStarts: number[] = [];

function push(ring: number[], value: number, max: number): void {
  ring.push(value);
  if (ring.length > max) ring.splice(0, ring.length - max);
}

/** One main-thread frame interval in ms. */
export function noteFrameMs(ms: number): void {
  if (ms > 0 && ms <= FRAME_GAP_MS) push(frames, ms, FRAME_MAX);
}

/** One sim tick-time sample in ms (the worker's smoothed tick time, sampled on frames where ticks ran). */
export function noteSimMs(ms: number): void {
  if (ms >= 0 && Number.isFinite(ms)) push(sims, ms, SIM_MAX);
}

/** Nearest-rank percentile of `values` (0 to 100). Pure. Empty input gives 0. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((Math.min(100, Math.max(0, p)) / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)] ?? 0;
}

export interface PerfSummary {
  frameMsP50: number;
  frameMsP95: number;
  simMsP95: number;
  longTasks30s: number;
}

/** The perf block of a crash record, or undefined when nothing was sampled yet. Values are rounded to 0.1 ms. */
export function perfSummary(nowMs: number = performance.now()): PerfSummary | undefined {
  if (frames.length === 0 && sims.length === 0) return undefined;
  const round = (v: number): number => Math.round(v * 10) / 10;
  return {
    frameMsP50: round(percentile(frames, 50)),
    frameMsP95: round(percentile(frames, 95)),
    simMsP95: round(percentile(sims, 95)),
    longTasks30s: longStarts.filter((t) => nowMs - t <= LONG_WINDOW_MS).length,
  };
}

/** Starts counting long tasks (more than 50 ms on the main thread). A browser without the observer counts none. */
export function startLongTaskWatch(): void {
  try {
    if (typeof PerformanceObserver === 'undefined') return;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) push(longStarts, entry.startTime, LONG_MAX);
    });
    observer.observe({ type: 'longtask', buffered: false });
  } catch {
    // Not supported here: the long-task count stays at zero.
  }
}
