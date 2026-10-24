import { describe, expect, it } from 'vitest';
import { Cmd } from '../../src/shared/protocol.ts';
import { Sim } from '../../src/sim/sim.ts';

/**
 * Sim tick cost at each size class (PERFORMANCE-PLAN section 4). Wall-clock timing is noisy under
 * parallel load, so each case takes the median of several timed runs after a warm-up run.
 *
 * - The 8 ms budget is a report only (console.warn). It is checked on real devices via
 *   `npm run bench`, not gated here.
 * - The gate is an order-of-magnitude ceiling (50 ms median per tick), so a real regression fails.
 */
const BUDGET_MS = 8;
const GATE_MS = 50;
const TICKS = 60;
const RUNS = 5;

function timeTicks(sizeStep: number, brush: boolean): { ms: number; side: number } {
  const sim = new Sim(1, sizeStep);
  const mid = sim.realm.side >> 1;
  const start = performance.now();
  for (let t = 0; t < TICKS; t++) {
    if (brush) {
      sim.enqueue({
        kind: Cmd.Stroke,
        seq: t,
        op: 'raise',
        shape: 'circle',
        size: 8,
        x0: mid,
        y0: mid,
        x1: mid + 20,
        y1: mid,
        includeStart: true,
      });
    }
    sim.step();
  }
  return { ms: (performance.now() - start) / TICKS, side: sim.realm.side };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Median ms per tick over RUNS timed runs, after one untimed warm-up run. */
function msPerTick(sizeStep: number, brush: boolean): number {
  timeTicks(sizeStep, brush);
  const runs: number[] = [];
  let side = 0;
  for (let r = 0; r < RUNS; r++) {
    const run = timeTicks(sizeStep, brush);
    runs.push(run.ms);
    side = run.side;
  }
  const ms = median(runs);
  console.log(`tick ${side}x${side} ${brush ? 'with brush' : 'idle'}: median ${ms.toFixed(3)} ms`);
  if (ms > BUDGET_MS) console.warn(`report: median ${ms.toFixed(3)} ms exceeds the ${BUDGET_MS} ms device budget`);
  return ms;
}

describe('sim tick cost', () => {
  for (const sizeStep of [2, 4, 8]) {
    it(`stays under the order-of-magnitude ceiling at sizeStep ${sizeStep}`, () => {
      expect(msPerTick(sizeStep, false)).toBeLessThan(GATE_MS);
      expect(msPerTick(sizeStep, true)).toBeLessThan(GATE_MS);
    }, 120_000);
  }
});
