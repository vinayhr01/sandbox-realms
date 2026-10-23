import { ground } from '../../content/grounds.ts';
import { FLAG } from '../realm.ts';
import type { Sim } from '../sim.ts';
import { startFire, isExplosive } from './fire.ts';
import { addMagma, magmaLevel } from './magma.ts';

/** Heat lost per decay run (04 section 7; TUNE). */
const DECAY = 2;
/** Heat that ignites flammable ground (04 section 6). */
const IGNITE_AT = 12;
/** Heat that evaporates a sea tile (04 section 2). */
const EVAPORATE_AT = 6;
/** Heat that turns bare land into magma (04 section 7 volcano/heat thresholds, TUNE). */
const MAGMA_AT = 100;
const MAGMA_HOT_AT = 160;

/**
 * Heat step (04 section 7, every 20 ticks over the heated set): decays heat and applies its
 * effects: ignition of flammable tiles, evaporation of sea tiles, and magma on hot land.
 */
export function heatStep(sim: Sim): void {
  const realm = sim.realm;
  const snapshot: number[] = [];
  for (let k = 0; k < realm.heated.size; k++) snapshot.push(realm.heated.at(k));
  for (const i of snapshot) {
    const h = realm.heat[i] ?? 0;
    const kind = ground(realm.ground[i] ?? 0);
    if (h >= EVAPORATE_AT && kind.sea) {
      // Evaporation: the sea tile drops a band and becomes a pit (04 section 2).
      realm.setElevation(i, (realm.elevation[i] ?? 0) - 5);
    } else if (h >= IGNITE_AT && !isExplosive(realm.ground[i] ?? 0)) {
      if (!realm.hasFlag(i, FLAG.burning)) startFire(sim, i);
    }
    if (!kind.sea && magmaLevel(realm.ground[i] ?? 0) < 0 && h >= MAGMA_AT && kind.layer !== 'blocked') {
      addMagma(sim, i, h >= MAGMA_HOT_AT ? 1 : 0);
    }
    realm.setHeat(i, h - DECAY);
  }
}
