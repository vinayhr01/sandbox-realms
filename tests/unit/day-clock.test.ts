import { describe, expect, it } from 'vitest';
import { DayClock, PHASE_MAX_RATE, stepPhase } from '../../src/render/day-clock.ts';
import type { FrameInput } from '../../src/render/world-renderer.ts';

const input = (tick: number, speed: number, dtMs: number, phaseOverride?: number | null): FrameInput =>
  ({ snapshot: { tick }, speed, dtMs, phaseOverride }) as unknown as FrameInput;

describe('drawn time of day', () => {
  it('above 2x moves at most one day per 10 s of real time, however fast the sim runs', () => {
    const clock = new DayClock();
    let last = clock.update(input(0, 10, 16));
    let travelled = 0;
    // 625 frames of 16 ms (10 s) at 10x, the sim racing ~17 ticks (most of a tenth of a day) per frame.
    for (let i = 1; i <= 625; i++) {
      const drawn = clock.update(input(i * 17, 10, 16));
      travelled += (drawn - last + 1) % 1;
      last = drawn;
    }
    expect(PHASE_MAX_RATE).toBe(0.1);
    expect(travelled).toBeLessThanOrEqual(1 + 1e-6);
    expect(travelled).toBeGreaterThan(0.9);
  });

  it('never runs backwards', () => {
    let p = 0.6;
    for (let i = 0; i < 100; i++) {
      const next = stepPhase(p, (p + 0.9) % 1, 16);
      const ahead = (next - p + 1) % 1;
      expect(ahead).toBeLessThan(0.5);
      p = next;
    }
  });

  it('the forcePhase override pins the drawn phase in either view', () => {
    const clock = new DayClock();
    expect(clock.update(input(0, 1, 16, 0.02))).toBeCloseTo(0.02, 9);
    expect(clock.update(input(5000, 10, 16, 0.5))).toBeCloseTo(0.5, 9);
    // Back to the sim: tick 0 at 1x is the start of day (0.30).
    expect(clock.update(input(0, 1, 16, null))).toBeCloseTo(0.3, 9);
  });
});
