import { G, ground, groundId, GROUND_BY_ELEVATION } from '../../content/grounds.ts';
import { FLAG } from '../realm.ts';
import { n4 } from '../grid.ts';
import type { Sim } from '../sim.ts';
import { stopFire } from './fire.ts';
import { magmaQuench } from './magma.ts';
import { detonateChain } from '../explosions.ts';

/** Probability a hollow with a sea neighbour fills in one run (04 section 2). */
const REFILL_CHANCE = 0.7;
/** Hollows examined per refill run (04 section 2). */
const REFILL_BUDGET = 4000;

/** Sea kinds a hollow refills to, by pit (04 section 2). */
const FILL_KIND: Readonly<Record<number, number>> = { [G.dug_deepmere]: G.deepmere, [G.dug_midmere]: G.midmere, [G.dug_shoal]: G.shoal };

/** True when the tile is sea or the realm edge (edges count as open sea for refill). */
function touchesSea(sim: Sim, i: number): boolean {
  const realm = sim.realm;
  for (let k = 0; k < 4; k++) {
    const j = n4(i, realm.side, k);
    if (j < 0) return true;
    if (ground(realm.ground[j] ?? 0).sea) return true;
  }
  return false;
}

/**
 * Fills a hollow from the sea (04 section 2): the tile becomes its sea kind at that depth's band.
 * Any fire on the tile is put out first.
 */
function fillHollow(sim: Sim, i: number, seaId: number): void {
  const realm = sim.realm;
  stopFire(sim, i);
  const band = ground(seaId).band ?? 0;
  realm.elevation[i] = band;
  realm.setGround(i, seaId);
}

/**
 * Sea refill (02 section 7 / 04 section 2, every 4 ticks): hollows next to the sea fill with
 * probability 0.7 per run, in a budgeted cursor pass over the hollow set.
 */
export function seaRefill(sim: Sim): void {
  const realm = sim.realm;
  const rng = sim.rng('refill');
  const size = realm.hollow.size;
  if (size === 0) return;
  const count = Math.min(size, REFILL_BUDGET);
  const start = rng.int(size);
  const pending: number[] = [];
  for (let k = 0; k < count; k++) {
    pending.push(realm.hollow.at((start + k) % size));
  }
  for (const i of pending) {
    if (!realm.hollow.has(i)) continue;
    if (!touchesSea(sim, i)) continue;
    if (rng.next() >= REFILL_CHANCE) continue;
    const seaId = FILL_KIND[realm.ground[i] ?? 0];
    if (seaId !== undefined) fillHollow(sim, i, seaId);
  }
}

/**
 * Rain drop (04 section 2): extinguishes fire, quenches molten ground, and turns hollows to sea.
 * Called by weather drops; the rain-triggered charges are handled by the explosives system.
 */
export function rainDrop(sim: Sim, i: number): void {
  const realm = sim.realm;
  if (realm.hasFlag(i, FLAG.burning)) stopFire(sim, i);
  if (realm.hollow.has(i)) {
    const seaId = FILL_KIND[realm.ground[i] ?? 0];
    if (seaId !== undefined) fillHollow(sim, i, seaId);
  }
  if (realm.molten.has(i)) magmaQuench(sim, i);
  // Water-triggered charges (18e section 5) detonate when rain lands on them (04 section 2).
  if (realm.ground[i] === G.charge_water) detonateChain(sim.explosionContext(), i);
  if (realm.scarred.has(i)) realm.setScar(i, 0);
  void GROUND_BY_ELEVATION;
  void groundId;
}
