import { BIOMES } from '../../content/biomes.ts';
import type { Rng } from '../../shared/rng.ts';

/** Gen weights in biome table order (18c section 3; they sum to 63). */
export const BIOME_WEIGHTS: readonly number[] = BIOMES.map((b) => b.genWeight);

/** Weighted draw of a biome index: one `rng.int(total)` then a cumulative walk. */
export function pickWeightedBiome(rng: Rng, weights: readonly number[] = BIOME_WEIGHTS): number {
  let total = 0;
  for (const w of weights) total += w;
  let r = rng.int(total);
  for (let b = 0; b < weights.length; b++) {
    r -= weights[b] ?? 0;
    if (r < 0) return b;
  }
  return 0;
}
