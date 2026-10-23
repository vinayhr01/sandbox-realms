import { G } from '../../content/grounds.ts';
import { BIOMES, biomeCoverId, biomeOfCover } from '../../content/biomes.ts';
import { FLAG } from '../realm.ts';
import { n4 } from '../grid.ts';
import type { Sim } from '../sim.ts';

/** Base chance per run that a biome spreads into a neighbouring soil tile (TUNE). */
const BASE_SPREAD = 0.05;
/** Chance per run that a biome overtakes a neighbour biome (04 section 8; takeover only). */
const TAKEOVER_FACTOR = 0.3;

/**
 * Biome sweep (01 section 8.2, 04 section 11): a budgeted runner over the map. Biomes spread into
 * neighbouring bare soil, and overtake other biomes when `biome_takeover` is on. Scars block it.
 */
export function biomeSweep(sim: Sim, budget: number): void {
  const realm = sim.realm;
  if (!sim.rules.isOn('ground_greening')) return;
  const runner = sim.runner('biome');
  const rng = sim.rng('biome');
  const takeover = sim.rules.isOn('biome_takeover');
  const bonus = sim.ageDef().biomeGrowthBonus;
  const chance = Math.max(0, BASE_SPREAD + bonus * 0.01);
  for (let k = 0; k < budget; k++) {
    const i = runner.next();
    const g = realm.ground[i] ?? 0;
    if (g !== G.lowloam && g !== G.highloam) continue;
    if (realm.hasFlag(i, FLAG.burning) || (realm.scar[i] ?? 0) > 0) continue;
    const own = biomeOfCover(realm.cover[i] ?? 0);
    if (own >= 0 && !takeover) continue;
    const j = n4(i, realm.side, rng.int(4));
    if (j < 0) continue;
    const other = biomeOfCover(realm.cover[j] ?? 0);
    if (other < 0 || other === own) continue;
    if (own < 0 && rng.next() < chance) {
      realm.setCover(i, biomeCoverId(other, g === G.highloam));
    } else if (own >= 0 && rng.next() < chance * TAKEOVER_FACTOR) {
      realm.setCover(i, biomeCoverId(other, g === G.highloam));
    }
  }
  void BIOMES;
}
