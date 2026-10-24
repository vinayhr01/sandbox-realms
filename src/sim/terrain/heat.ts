import { G, ground } from '../../content/grounds.ts';
import { FLAG, type Realm } from '../realm.ts';
import type { Sim } from '../sim.ts';
import { explode } from '../explosions.ts';
import { fireChanceAt, scarStage, startFire } from './fire.ts';
import { addMagma } from './magma.ts';
import { thaw } from './freeze.ts';

/** Heat lost per decay run, one per 20 ticks (04 section 7.1). */
const DECAY = 1;
/** Heat ceiling per tile (04 section 7.1). */
export const HEAT_MAX = 400;
/** Thresholds of the 04 section 7.1 table. */
const EVAPORATE_AT = 6;
const IGNITE_AT = 12;
const DETONATE_AT = 24;
const MELT_LAND_AT = 36;
const STRAND_AT = 100;
const MAGMA_AT = 160;

/** Sea kinds and the pit each one becomes when its water is removed (04 section 2). */
const PIT_FOR_SEA: Readonly<Record<number, number>> = { [G.deepmere]: G.dug_deepmere, [G.midmere]: G.dug_midmere, [G.shoal]: G.dug_shoal };

/** Raises a tile's heat without applying effects (for callers without a Sim, such as lightning). */
export function raiseHeat(realm: Realm, i: number, amount: number): void {
  realm.setHeat(i, Math.min(HEAT_MAX, (realm.heat[i] ?? 0) + amount));
}

/**
 * Applies every 04 section 7.1 effect that the tile's current heat reaches, in ascending order so a
 * tile can pass several rows in one call (lowloam at 36 becomes strand, which then melts at 100).
 * Nothing happens under sanctuary_seal (02 section 9).
 */
export function applyHeatEffects(sim: Sim, i: number): void {
  const realm = sim.realm;
  const h = realm.heat[i] ?? 0;
  if (h < EVAPORATE_AT || sim.rules.isOn('sanctuary_seal')) return;
  const rng = sim.rng('heat');
  const kind = ground(realm.ground[i] ?? 0);

  // >= 6: sea evaporates into a pit, frost thaws, slime ignites, land scars.
  if (kind.sea) {
    const pit = PIT_FOR_SEA[realm.ground[i] ?? 0];
    if (pit !== undefined) realm.setGround(i, pit);
  } else {
    if (realm.hasFlag(i, FLAG.frozen)) thaw(sim, i, 99);
    if (kind.layer !== 'molten' && kind.layer !== 'water') realm.setScar(i, scarStage(rng));
    if (kind.layer === 'slime') startFire(sim, i, true);
  }
  if (h >= IGNITE_AT && fireChanceAt(sim, i) > 0 && !realm.hasFlag(i, FLAG.burning)) startFire(sim, i);

  // >= 24: explosive devices detonate and covers are stripped.
  const device = ground(realm.ground[i] ?? 0);
  if (h >= DETONATE_AT && device.blastRadius > 0) {
    realm.setGround(i, G.cinderscar);
    explode(sim.explosionContext(), i % realm.side, Math.floor(i / realm.side), device.blastRadius, device.blastRadius * 10, 'Explosion', -1);
  }
  if (h >= DETONATE_AT && (realm.cover[i] ?? 0) !== 0) realm.setCover(i, 0);

  // >= 36: molten tiles are re-heated (their cooling wait restarts); soil and paths become strand.
  const now = ground(realm.ground[i] ?? 0);
  if (h >= MELT_LAND_AT) {
    if (now.layer === 'molten') realm.lavaSince[i] = sim.tick;
    else if (realm.ground[i] === G.lowloam || realm.ground[i] === G.highloam || realm.ground[i] === G.wayworn) realm.setGround(i, G.strand);
  }

  // >= 100: strand melts; >= 160: knoll and crag melt.
  const after = realm.ground[i] ?? 0;
  if (h >= STRAND_AT && after === G.strand) addMagma(sim, i, 3);
  if (h >= MAGMA_AT && (after === G.knoll || after === G.crag)) addMagma(sim, i, 3);
}

/** Adds heat to tile i and applies the effects at the new heat (04 section 7.1 addHeat). */
export function addHeat(sim: Sim, i: number, amount: number): void {
  raiseHeat(sim.realm, i, amount);
  applyHeatEffects(sim, i);
}

/**
 * Heat step (04 section 7.1, every 20 ticks over the heated set): applies the effects at each
 * tile's current heat (heat from lightning is raised without effects, so they land here), then
 * decays it by one. Fire and magma never add heat.
 */
export function heatStep(sim: Sim): void {
  const realm = sim.realm;
  const snapshot: number[] = [];
  for (let k = 0; k < realm.heated.size; k++) snapshot.push(realm.heated.at(k));
  for (const i of snapshot) {
    applyHeatEffects(sim, i);
    realm.setHeat(i, (realm.heat[i] ?? 0) - DECAY);
  }
}
