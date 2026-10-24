import { describe, expect, it } from 'vitest';
import { MONTH_TICKS, PARCEL, TICK_HZ, YEAR_TICKS } from '../../src/shared/constants.ts';
import { PARCEL as HAMLET_PARCEL } from '../../src/sim/settlements/hamlet.ts';
import { ssToTicks } from '../../src/sim/clock.ts';
import { SNAPSHOT_TICKS } from '../../src/sim/snapshot.ts';

describe('review cleanup: shared constants', () => {
  it('PARCEL has one definition, re-exported by hamlet.ts', () => {
    expect(PARCEL).toBe(8);
    expect(HAMLET_PARCEL).toBe(PARCEL);
  });

  it('a year is twelve months of the shared month length', () => {
    expect(YEAR_TICKS).toBe(12 * MONTH_TICKS);
  });
});

describe('review cleanup: documented timing', () => {
  it('ssToTicks rounds to the nearest tick and never returns less than one', () => {
    expect(ssToTicks(0)).toBe(1);
    expect(ssToTicks(0.12)).toBe(2);
    expect(ssToTicks(0.13)).toBe(3);
  });

  it('a periodic snapshot is 40 ticks, two seconds at the fixed tick rate', () => {
    expect(SNAPSHOT_TICKS).toBe(40);
    expect(SNAPSHOT_TICKS / TICK_HZ).toBe(2);
  });
});
