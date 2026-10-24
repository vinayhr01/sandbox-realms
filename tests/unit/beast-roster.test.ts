import { describe, expect, it } from 'vitest';
import { SPECIES } from '../../src/content/beasts.ts';

/** 18a roster values for the 8 species the sim uses: vitality, might, pace, plating, span. */
const ROSTER: Record<string, [number, number, number, number, number]> = {
  thistlehart: [85, 8, 17, 1, 28],
  burrfleece: [60, 5, 6, 0, 35],
  plowhorn: [140, 11, 7, 2, 45],
  mossback: [165, 9, 5, 7, 110],
  cluckling: [16, 1, 8, 0, 10],
  nectarbuzz: [9, 3, 20, 0, 5],
  mudsnuffler: [95, 10, 9, 1, 30],
  gloamfang: [110, 19, 15, 2, 18],
};

describe('beast stats match the 18a roster', () => {
  it('every species carries its roster vitality, might, pace, plating and span', () => {
    expect(SPECIES.map((s) => s.id).sort()).toEqual(Object.keys(ROSTER).sort());
    for (const s of SPECIES) {
      const [vitality, might, pace, , span] = ROSTER[s.id] ?? [];
      expect(s.vitality, `${s.id} vitality`).toBe(vitality);
      expect(s.might, `${s.id} might`).toBe(might);
      expect(s.pace, `${s.id} pace`).toBe(pace);
      expect(s.span, `${s.id} span`).toBe(span);
    }
  });
});
