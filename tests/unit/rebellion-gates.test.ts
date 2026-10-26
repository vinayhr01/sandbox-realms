import { describe, expect, it } from 'vitest';
import { rebelCandidate, uprisingAllowed, REBEL_DOMINION_YEARS, REBEL_HAMLETS, REBEL_MIN_SOLDIERS, type UprisingFacts } from '../../src/sim/dominions/rebellion.ts';

// 10 section 11 and section 5: rebelCandidate and uprisingAllowed. Each gate is failed alone from a passing base.

/** Facts that pass every gate: capital has 100 soldiers, two hamlets are unhappy, so this hamlet needs 100 x 0.8 = 80. */
const BASE: UprisingFacts = {
  unhappy: true,
  isCapital: false,
  hasCapital: true,
  hamlets: REBEL_HAMLETS + 1,
  dominionYears: REBEL_DOMINION_YEARS + 1,
  pacifist: false,
  defendedAgainst: false,
  leader: { level: 2, stewardship: 6, warfare: 5, isRuler: false },
  soldiers: 80,
  capitalSoldiers: 100,
  unhappyHamlets: 2,
};

describe('rebelCandidate (10 section 5)', () => {
  it('passes with the base facts', () => {
    expect(rebelCandidate(BASE)).toBe(true);
  });

  it('each gate fails alone', () => {
    expect(rebelCandidate({ ...BASE, unhappy: false })).toBe(false);
    expect(rebelCandidate({ ...BASE, isCapital: true })).toBe(false);
    expect(rebelCandidate({ ...BASE, hasCapital: false })).toBe(false);
    expect(rebelCandidate({ ...BASE, hamlets: 1 })).toBe(false);
    expect(rebelCandidate({ ...BASE, dominionYears: undefined })).toBe(false);
    expect(rebelCandidate({ ...BASE, dominionYears: REBEL_DOMINION_YEARS })).toBe(false);
    expect(rebelCandidate({ ...BASE, pacifist: true })).toBe(false);
    expect(rebelCandidate({ ...BASE, defendedAgainst: true })).toBe(false);
  });

  it('needs more hamlets than the cap (REBEL_HAMLET_MAX 5 is the binding bound; 5 fails, 6 passes)', () => {
    expect(rebelCandidate({ ...BASE, hamlets: 5 })).toBe(false);
    expect(rebelCandidate({ ...BASE, hamlets: 6 })).toBe(true);
  });

  it('is one year older than 15 at the edge', () => {
    expect(rebelCandidate({ ...BASE, dominionYears: 16 })).toBe(true);
  });
});

describe('uprisingAllowed (10 section 11)', () => {
  const leader = BASE.leader!;

  it('passes with the base facts, exactly on every minimum', () => {
    expect(uprisingAllowed(BASE)).toBe(true);
  });

  it('a non-candidate hamlet is refused', () => {
    expect(uprisingAllowed({ ...BASE, unhappy: false })).toBe(false);
  });

  it('each leader gate fails alone', () => {
    expect(uprisingAllowed({ ...BASE, leader: undefined })).toBe(false);
    expect(uprisingAllowed({ ...BASE, leader: { ...leader, isRuler: true } })).toBe(false);
    expect(uprisingAllowed({ ...BASE, leader: { ...leader, level: 1 } })).toBe(false);
    expect(uprisingAllowed({ ...BASE, leader: { ...leader, stewardship: 5 } })).toBe(false);
    expect(uprisingAllowed({ ...BASE, leader: { ...leader, warfare: 4 } })).toBe(false);
  });

  it('needs REBEL_MIN_SOLDIERS soldiers whatever the capital holds', () => {
    const f = { ...BASE, capitalSoldiers: 0 };
    expect(uprisingAllowed({ ...f, soldiers: REBEL_MIN_SOLDIERS - 1 })).toBe(false);
    expect(uprisingAllowed({ ...f, soldiers: REBEL_MIN_SOLDIERS })).toBe(true);
  });

  it('needs the capital share: 80 of 100 with two unhappy hamlets (79 fails)', () => {
    expect(uprisingAllowed({ ...BASE, soldiers: 79 })).toBe(false);
    expect(uprisingAllowed({ ...BASE, soldiers: 80 })).toBe(true);
    // With one unhappy hamlet the bar is 90.
    expect(uprisingAllowed({ ...BASE, unhappyHamlets: 1, soldiers: 89 })).toBe(false);
    expect(uprisingAllowed({ ...BASE, unhappyHamlets: 1, soldiers: 90 })).toBe(true);
  });
});
