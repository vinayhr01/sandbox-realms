import { describe, expect, it } from 'vitest';
import { MAX_CONSECUTIVE_PUMP_FAULTS, pumpFaultAction, planPump } from '../../src/sim/scheduler.ts';

describe('pump re-arm decision (review fix 2)', () => {
  it('a single pump fault keeps the pump re-armed', () => {
    expect(pumpFaultAction(1)).toBe('rearm');
  });

  it('repeated faults stop the pump with a fatal fault', () => {
    expect(pumpFaultAction(MAX_CONSECUTIVE_PUMP_FAULTS - 1)).toBe('rearm');
    expect(pumpFaultAction(MAX_CONSECUTIVE_PUMP_FAULTS)).toBe('fatal');
    expect(pumpFaultAction(MAX_CONSECUTIVE_PUMP_FAULTS + 1)).toBe('fatal');
  });

  it('planPump needs no budget argument and still caps by speed', () => {
    expect(planPump(0, 1000, 2).ticks).toBeLessThanOrEqual(2);
  });
});
