import { describe, expect, it } from 'vitest';
import { SPECIES, speciesIndex } from '../../src/content/beasts.ts';
import { BIOMES } from '../../src/content/biomes.ts';

/** 18a roster values for the 8 hand-authored species: vitality, might, pace, plating, span. */
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

/** Spot checks of the rest of 18a section 2 and section 1.1 (vitality, might, pace, plating, span, size). */
const SPOT: Record<string, [number, number, number, number, number, string]> = {
  stormwyrm: [1100, 110, 38, 4, 9000, 'C'],
  skyskiff: [400, 45, 20, 6, 0, 'L'],
  tideclaw: [1400, 80, 9, 12, 2000, 'C'],
  driftleviathan: [900, 45, 9, 6, 600, 'C'],
  gravecaller: [95, 11, 10, 1, 400, 'M'],
  phantom_hand: [100, 80, 30, 0, 0, 'M'],
  aegiswing: [90, 14, 22, 2, 180, 'M'],
  boneshambler: [70, 12, 9, 3, 0, 'M'],
  mothlet: [6, 0, 14, 0, 3, 'T'],
  thornling: [62, 8, 16, 0, 420, 'S'],
  rimeborn: [175, 19, 10, 4, 280, 'L'],
  emberkin: [140, 21, 11, 3, 48, 'M'],
};

describe('beast stats match the 18a roster', () => {
  it('the hand-authored eight carry their roster vitality, might, pace and span', () => {
    for (const [id, [vitality, might, pace, plating, span]] of Object.entries(ROSTER)) {
      const s = SPECIES[speciesIndex(id)]!;
      expect(s.vitality, `${id} vitality`).toBe(vitality);
      expect(s.might, `${id} might`).toBe(might);
      expect(s.pace, `${id} pace`).toBe(pace);
      expect(s.plating, `${id} plating`).toBe(plating);
      expect(s.span, `${id} span`).toBe(span);
    }
  });

  it('the roster holds 84 beasts and 6 Folk lineages, with unique ids', () => {
    expect(SPECIES.length).toBe(90);
    expect(SPECIES.filter((s) => !s.folk).length).toBe(84);
    expect(SPECIES.filter((s) => s.folk).length).toBe(6);
    expect(new Set(SPECIES.map((s) => s.id)).size).toBe(SPECIES.length);
  });

  it('spot-checked rows of 18a have their stated values', () => {
    for (const [id, [vitality, might, pace, plating, span, size]] of Object.entries(SPOT)) {
      const s = SPECIES[speciesIndex(id)]!;
      expect({ id, vitality: s.vitality, might: s.might, pace: s.pace, plating: s.plating, span: s.span, size: s.size }).toEqual({ id, vitality, might, pace, plating, span, size });
    }
  });

  it('the Folk rows carry their 18a aptitudes', () => {
    const apt = (id: string) => SPECIES[speciesIndex(id)]!.aptitudes;
    expect(apt('hearthborn')).toEqual({ rapport: 5, valor: 2, husbandry: 3, wit: 3 });
    expect(apt('thornling')).toEqual({ rapport: 3, valor: 1, husbandry: 2, wit: 7 });
    expect(apt('emberkin')).toEqual({ rapport: 2, valor: 5, husbandry: 3, wit: 2 });
  });

  it('every biome id a species names exists in 18c (biomes.ts), and `any` expands to all of them', () => {
    const known = new Set(BIOMES.map((b) => b.id));
    for (const s of SPECIES) for (const b of s.biomes) expect(known.has(b), `${s.id} ${b}`).toBe(true);
    expect(SPECIES[speciesIndex('boneshambler')]!.biomes.length).toBe(BIOMES.length);
  });
});
