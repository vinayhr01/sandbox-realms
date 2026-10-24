import { G, ground } from '../../content/grounds.ts';
import { BIOMES, biomeCoverId, biomeOfCover } from '../../content/biomes.ts';
import { CREEP_GUARD_TICKS } from '../../content/creeps.ts';
import type { Sim } from '../sim.ts';
import { thaw } from './freeze.ts';
import { terrainState } from './state.ts';

const ASHBARREN = BIOMES.findIndex((b) => b.id === 'ashbarren');

/**
 * Acid on one tile (04 section 4.1 acidTerraform): unfreezes it, leaves ash and waste covers alone,
 * strips any other cover, and turns bare soil into ashbarren. Creep is cleaned to lowloam and
 * guarded from re-spreading for 20 s (18e 1.5). Beings and structures are not touched here.
 */
export function acidTerraform(sim: Sim, i: number): void {
  const realm = sim.realm;
  const g = realm.ground[i] ?? 0;
  thaw(sim, i, 99);
  if (ground(g).creep) {
    realm.setGround(i, G.lowloam);
    realm.setCover(i, 0);
    terrainState(sim).creepGuard.set(i, sim.tick + CREEP_GUARD_TICKS);
    return;
  }
  const cover = realm.cover[i] ?? 0;
  if (cover !== 0) {
    if (biomeOfCover(cover) === ASHBARREN) return;
    realm.setCover(i, 0);
    return;
  }
  if (ASHBARREN >= 0 && (g === G.lowloam || g === G.highloam)) {
    realm.setCover(i, biomeCoverId(ASHBARREN, g === G.highloam));
  }
}
