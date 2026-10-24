import { describe, expect, it } from 'vitest';
import { SPECIES, speciesIndex } from '../../src/content/beasts.ts';
import { BEING_TRAITS, STRAIN_TRAITS } from '../../src/content/traits.ts';
import { assemble } from '../../src/sim/beings/assembly.ts';

const NONE = { rapport: 0, valor: 0, husbandry: 0, wit: 0 };

function adult(id: string, beingTraits: string[] = [], strainTraits: string[] = [], attrs = NONE) {
  return assemble({ species: SPECIES[speciesIndex(id)]!, strainTraits, generation: 0, beingTraits, attrs, baby: false });
}

describe('stat assembly (05 section 3)', () => {
  it('multipliers add before they apply once (05 section 3.1)', () => {
    // brawny mult_might +0.2 and seasoned mult_might +0.1 give x1.3 of base 10 = 13, not x1.2 x1.1.
    const a = adult('gloamfang', ['brawny', 'seasoned']);
    expect(a.might).toBeCloseTo(19 * 1.3, 6);
  });

  it('vitality multipliers add across sources before they apply (1 + 0.4 + 0.3)', () => {
    const base = adult('burrfleece').vitality;
    const stacked = adult('burrfleece', ['robust_vigor', 'towering']);
    expect(stacked.vitality).toBe(Math.floor(base * 1.7));
  });

  it('a species with no traits assembles to its roster values', () => {
    const a = adult('thistlehart');
    expect(a.vitality).toBe(85);
    expect(a.might).toBe(8);
    expect(a.pace).toBe(17);
    expect(a.span).toBe(28);
    expect(a.litter).toBe(3);
    expect(a.metabolism).toBe(1);
  });

  it('babies halve vitality and might, floored at 1 (05 section 1.1)', () => {
    const grown = assemble({ species: SPECIES[speciesIndex('gloamfang')]!, strainTraits: [], generation: 0, beingTraits: [], attrs: NONE, baby: false });
    const baby = assemble({ species: SPECIES[speciesIndex('gloamfang')]!, strainTraits: [], generation: 0, beingTraits: [], attrs: NONE, baby: true });
    expect(baby.vitality).toBe(Math.floor(grown.vitality / 2));
    expect(baby.might).toBe(Math.floor(grown.might / 2));
    expect(baby.pace).toBe(grown.pace);
  });

  it('a summed multiplier of -1 or less leaves the clamp minimum, never zero (05 section 3.1)', () => {
    // frail -0.4, sickly -0.2, diminutive -0.25, hollow_bones -0.1, scarred -0.05 sum to -1.0 on vitality.
    const a = adult('thistlehart', ['frail_vigor', 'sickly', 'diminutive', 'hollow_bones', 'scarred']);
    expect(a.vitality).toBe(1);
  });

  it('Folk aptitudes are stored stats: they add to the block and grow might by valor / 5', () => {
    const emberkin = SPECIES[speciesIndex('emberkin')]!;
    const plain = assemble({ species: emberkin, strainTraits: [], generation: 0, beingTraits: [], attrs: NONE, baby: false });
    const trained = assemble({ species: emberkin, strainTraits: [], generation: 0, beingTraits: [], attrs: { rapport: 10, valor: 20, husbandry: 0, wit: 30 }, baby: false });
    expect(trained.rapport).toBe(10);
    expect(trained.valor).toBe(20);
    expect(trained.wit).toBe(30);
    expect(trained.might).toBeCloseTo(plain.might + 20 / 5, 6);
  });

  it('a gestation strain trait sets the pregnancy length, and fading_line shrinks litter per generation', () => {
    const species = SPECIES[speciesIndex('cluckling')]!;
    const extended = assemble({ species, strainTraits: ['gestation_extended'], generation: 0, beingTraits: [], attrs: NONE, baby: false });
    expect(extended.gestationMonths).toBe(7);
    const faded = assemble({ species: SPECIES[speciesIndex('plowhorn')]!, strainTraits: ['fading_line'], generation: 0, beingTraits: [], attrs: NONE, baby: false });
    expect(faded.litter).toBe(1);
    const later = assemble({ species: SPECIES[speciesIndex('thistlehart')]!, strainTraits: ['fading_line'], generation: 2, beingTraits: [], attrs: NONE, baby: false });
    expect(later.litter).toBe(1);
  });

  it('longlived lengthens span and so the adult age follows it', () => {
    const plain = adult('burrfleece');
    const long = adult('burrfleece', ['longlived']);
    expect(long.span).toBeCloseTo(plain.span * 1.5, 6);
    expect(long.adultYears).toBeGreaterThan(plain.adultYears);
  });

  it('a span-0 species stays at adult age 1 and never ages (05 section 1)', () => {
    expect(adult('boneshambler').span).toBe(0);
    expect(adult('boneshambler').adultYears).toBe(1);
  });
});

describe('18b trait table as data', () => {
  it('holds all 144 being traits and 154 strain traits, with unique ids', () => {
    expect(BEING_TRAITS.length).toBe(144);
    expect(STRAIN_TRAITS.length).toBe(154);
    expect(new Set(BEING_TRAITS.map((t) => t.id)).size).toBe(144);
    expect(new Set(STRAIN_TRAITS.map((t) => t.id)).size).toBe(154);
  });

  it('every Folk starting trait of 18a section 1.2 exists in 18b', () => {
    const being = new Set(BEING_TRAITS.map((t) => t.id));
    const strain = new Set(STRAIN_TRAITS.map((t) => t.id));
    for (const s of SPECIES) {
      for (const id of s.startTraits?.being ?? []) expect(being.has(id), id).toBe(true);
      for (const id of s.startTraits?.strain ?? []) expect(strain.has(id), id).toBe(true);
    }
  });

  it('the rows the sim applies carry numeric effects and the rest stay data only', () => {
    const fx = BEING_TRAITS.filter((t) => t.fx !== undefined).map((t) => t.id);
    expect(fx).toContain('towering');
    expect(fx).toContain('glutton');
    expect(BEING_TRAITS.find((t) => t.id === 'placid')?.fx).toBeUndefined();
  });
});
