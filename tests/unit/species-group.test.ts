import { describe, expect, it } from 'vitest';
import { SPECIES } from '../../src/content/beasts.ts';
import { speciesGroup } from '../../src/content/species-group.ts';

describe('speciesGroup', () => {
  it('maps the Folk rows to folk and wild rows to beast, sea, insect, undead, monster or divine', () => {
    const groups = new Set(['folk', 'beast', 'sea', 'insect', 'undead', 'monster', 'divine']);
    SPECIES.forEach((def, i) => {
      expect(groups.has(speciesGroup(i))).toBe(true);
      if (def.folk) expect(speciesGroup(i)).toBe('folk');
    });
  });

  it('maps a wild group A row to beast, and an unknown index to beast', () => {
    const wildA = SPECIES.findIndex((s) => s.group === 'A' && s.wild);
    expect(wildA).toBeGreaterThanOrEqual(0);
    expect(speciesGroup(wildA)).toBe('beast');
    expect(speciesGroup(SPECIES.length + 5)).toBe('beast');
  });
});
