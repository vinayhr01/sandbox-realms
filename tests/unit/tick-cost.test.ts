import { describe, expect, it } from 'vitest';
import { Cmd } from '../../src/shared/protocol.ts';
import { Sim } from '../../src/sim/sim.ts';

/**
 * Reports sim tick cost at each size class (PERFORMANCE-PLAN section 4). Absolute budgets are
 * checked on real devices; the assertion here is only a sanity ceiling so a regression by an
 * order of magnitude fails CI. Run `npm run bench` to see the numbers.
 */
function msPerTick(sizeStep: number, brush: boolean): number {
  const sim = new Sim(1, sizeStep);
  const mid = sim.realm.side >> 1;
  const ticks = 60;
  const start = performance.now();
  for (let t = 0; t < ticks; t++) {
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
  const ms = (performance.now() - start) / ticks;
  console.log(`tick ${sim.realm.side}x${sim.realm.side} ${brush ? 'with brush' : 'idle'}: ${ms.toFixed(3)} ms`);
  return ms;
}

describe('sim tick cost', () => {
  for (const sizeStep of [2, 4, 8]) {
    it(`stays far below budget at sizeStep ${sizeStep}`, () => {
      expect(msPerTick(sizeStep, false)).toBeLessThan(8);
      expect(msPerTick(sizeStep, true)).toBeLessThan(8);
    });
  }
});
