import { describe, expect, it } from 'vitest';
import { BIOMES, GEN_WEIGHT_TOTAL } from '../../src/content/biomes.ts';
import { createRng } from '../../src/shared/rng.ts';
import { BIOME_WEIGHTS, pickWeightedBiome } from '../../src/sim/worldgen/pick.ts';

/** 03 section 9 / 18c section 3 rule 3: weighted biome draws follow genWeight / 63. */
describe('weighted biome share', () => {
  it('gen weights sum to 63 and the pick table matches the biome table', () => {
    expect(GEN_WEIGHT_TOTAL).toBe(63);
    expect(BIOME_WEIGHTS.reduce((s, w) => s + w, 0)).toBe(63);
    expect(BIOME_WEIGHTS.length).toBe(BIOMES.length);
  });

  it('10,000 seeded draws give each biome its weight share within 3 percentage points', () => {
    const rng = createRng(0x51a7e);
    const n = 10000;
    const counts = new Array<number>(BIOMES.length).fill(0);
    for (let k = 0; k < n; k++) {
      const b = pickWeightedBiome(rng, BIOME_WEIGHTS);
      counts[b] = (counts[b] ?? 0) + 1;
    }
    BIOMES.forEach((b, i) => {
      const expected = b.genWeight / 63;
      const observed = (counts[i] ?? 0) / n;
      expect(Math.abs(observed - expected), `${b.id}: observed ${observed}, expected ${expected}`).toBeLessThanOrEqual(0.03);
      if (b.genWeight === 0) expect(counts[i]).toBe(0);
    });
  });

  it('the same seed gives the same draw sequence', () => {
    const a = createRng(7);
    const b = createRng(7);
    for (let k = 0; k < 500; k++) expect(pickWeightedBiome(a, BIOME_WEIGHTS)).toBe(pickWeightedBiome(b, BIOME_WEIGHTS));
  });
});
