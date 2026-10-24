import { G, ground } from '../../content/grounds.ts';
import { FLAG } from '../realm.ts';
import { n4 } from '../grid.ts';
import type { Sim } from '../sim.ts';
import { thaw } from './freeze.ts';
import { stopFire, startFire } from './fire.ts';

/** Cooling wait per level in sim seconds: molten_1..molten_4 (04 section 3: 28, 10, 10, 4 ss). */
const COOL_AFTER_SS = [28, 10, 10, 4] as const;
/** Kinds that stop magma from flowing into them (04 section 3). */
const HOLDS_MOLTEN = new Set<number>([G.knoll, G.crag, G.pinnacle]);
/** Tiles examined per magma sweep (04 section 3: 2000 at most). */
const SWEEP_BUDGET = 2000;

const coolTicks = (level: number): number => Math.round((COOL_AFTER_SS[level] ?? 4) * 20);

/** Level 0..3 of a molten ground id, or -1. */
function magmaLevel(id: number): number {
  return id >= G.molten_1 && id <= G.molten_4 ? id - G.molten_1 : -1;
}

/**
 * Adds magma at level `level` (0..3) to tile i (04 section 3 addMagma). Replaces the ground and
 * ignites it; any cover or flora on it is destroyed. A tile already at that level or hotter is
 * left alone.
 */
export function addMagma(sim: Sim, i: number, level: number): void {
  const realm = sim.realm;
  const current = magmaLevel(realm.ground[i] ?? 0);
  if (current >= level) return;
  if (realm.flora[i] !== 0) realm.setFlora(i, 0, 0);
  realm.setCover(i, 0);
  thaw(sim, i, 99);
  realm.setGround(i, G.molten_1 + Math.min(3, level));
  realm.lavaSince[i] = sim.tick;
  if (!realm.hasFlag(i, FLAG.burning)) {
    realm.setFlag(i, FLAG.burning, true);
    realm.fireStart[i] = sim.tick;
  }
}

/** Quench: rain or the quench tool turns magma into cooled rock (04 section 3). */
export function magmaQuench(sim: Sim, i: number): void {
  if (sim.rules.isOn('eternal_magma') || sim.rules.isOn('sanctuary_seal')) return;
  const realm = sim.realm;
  if (realm.hasFlag(i, FLAG.burning)) stopFire(sim, i);
  realm.setGround(i, G.knoll);
  realm.lavaSince[i] = sim.tick;
}

/** Sets a magma tile one level cooler; level 0 solidifies to knoll. */
function cool(sim: Sim, i: number, level: number): void {
  const realm = sim.realm;
  if (level <= 0) {
    realm.setGround(i, G.knoll);
    if (realm.hasFlag(i, FLAG.burning)) stopFire(sim, i);
  } else {
    realm.setGround(i, G.molten_1 + level - 1);
  }
  realm.lavaSince[i] = sim.tick;
}

/**
 * Magma sweep (04 section 3, every 2 ticks while magma exists). A budgeted pass over the molten
 * set: cooling waits, solidification, flow into lower or bare neighbours, and passive cooling.
 */
export function magmaSweep(sim: Sim): void {
  const realm = sim.realm;
  if (sim.rules.isOn('eternal_magma')) return;
  const rng = sim.rng('magma');
  const size = realm.molten.size;
  const count = Math.min(size, SWEEP_BUDGET);
  const start = rng.int(size);
  const pending: number[] = [];
  for (let k = 0; k < count; k++) pending.push(realm.molten.at((start + k) % size));

  for (const i of pending) {
    if (!realm.molten.has(i)) continue;
    const level = magmaLevel(realm.ground[i] ?? 0);
    if (level < 0) continue;
    if (sim.tick - (realm.lavaSince[i] ?? 0) < coolTicks(level)) continue;

    let hotNeighbour = false;
    for (let k = 0; k < 4; k++) {
      const j = n4(i, realm.side, k);
      if (j >= 0 && magmaLevel(realm.ground[j] ?? 0) > 0) hotNeighbour = true;
    }
    if (level === 0 && !hotNeighbour) {
      cool(sim, i, 0);
      continue;
    }

    if (rng.next() < 0.5) {
      // Flow: pick the coolest eligible neighbour, lowest level first, then fixed order.
      let target = -1;
      let targetLevel = 99;
      for (let k = 0; k < 4; k++) {
        const j = n4(i, realm.side, k);
        if (j < 0) continue;
        const gj = realm.ground[j] ?? 0;
        if (HOLDS_MOLTEN.has(gj)) continue;
        const lj = magmaLevel(gj);
        if (lj >= 0 && lj >= level) continue;
        const rank = lj < 0 ? -1 : lj;
        if (rank < targetLevel) {
          targetLevel = rank;
          target = j;
        }
      }
      if (target >= 0) {
        const j = target;
        const gj = realm.ground[j] ?? 0;
        if (gj !== G.molten_4 && !HOLDS_MOLTEN.has(gj)) {
          const lj = magmaLevel(gj);
          if (lj < 0) {
            if (realm.hasFlag(j, FLAG.frozen)) thaw(sim, j, 99);
            realm.setGround(j, G.molten_1);
            realm.lavaSince[j] = sim.tick;
          } else {
            realm.setGround(j, G.molten_1 + Math.min(3, lj + 1));
            realm.lavaSince[j] = sim.tick;
          }
        }
        cool(sim, i, level - 1);
        continue;
      }
      // Passive cooling (design addition, 04 section 3 step 6): ponds close in minutes.
      cool(sim, i, level - 1);
      continue;
    }

    if (!realm.hasFlag(i, FLAG.burning) && rng.next() < 0.995) startFire(sim, i, true);
  }
  void ground;
}
