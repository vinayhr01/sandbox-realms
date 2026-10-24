import { G, ground } from '../../content/grounds.ts';
import { FLAG } from '../realm.ts';
import { n4 } from '../grid.ts';
import type { Sim } from '../sim.ts';
import { thaw } from './freeze.ts';

/** Slime tiles examined per sweep run (04 section 4.2). */
const SWEEP_BUDGET = 3000;

/** Ground kinds slime never spreads onto: sea, pits and magma (04 section 4.2, plus molten). */
function spreadable(sim: Sim, j: number): boolean {
  const g = sim.realm.ground[j] ?? 0;
  if (g === G.slagooze || g === G.deepmere || g === G.dug_deepmere) return false;
  return ground(g).layer !== 'molten';
}

/** Terraforms a tile to slagooze: structures and cover go, frost thaws (04 section 4.2). */
function becomeSlime(sim: Sim, j: number): void {
  const realm = sim.realm;
  if (realm.flora[j] !== 0) realm.setFlora(j, 0, 0);
  if (realm.hasFlag(j, FLAG.frozen)) thaw(sim, j, 99);
  realm.setCover(j, 0);
  realm.setGround(j, G.slagooze);
}

/** Spreads slime to the spreadable n4 neighbours of tile i. */
function spreadFrom(sim: Sim, i: number): void {
  const realm = sim.realm;
  for (let k = 0; k < 4; k++) {
    const j = n4(i, realm.side, k);
    if (j >= 0 && spreadable(sim, j)) becomeSlime(sim, j);
  }
}

/**
 * Spills slagooze over the land within `radius` of (cx, cy), skipping sea, magma and pits. Returns
 * the number of tiles turned. Refused under sanctuary_seal (04 section 4.2).
 */
export function spillSlime(sim: Sim, cx: number, cy: number, radius: number): number {
  if (sim.rules.isOn('sanctuary_seal')) return 0;
  const realm = sim.realm;
  let turned = 0;
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (!realm.inBounds(x, y) || (x - cx) ** 2 + (y - cy) ** 2 > radius * radius) continue;
      const j = y * realm.side + x;
      if (!spreadable(sim, j) || ground(realm.ground[j] ?? 0).layer === 'water') continue;
      becomeSlime(sim, j);
      turned++;
    }
  }
  return turned;
}

/**
 * Slime sweep (04 section 4.2, every 2 ticks): a budgeted pass over the slime set. Each tile rolls
 * once: 5% becomes a pit and spreads, 5% only spreads, else 9% becomes a pit when it is walled in by
 * slime or pits. Disabled by sanctuary_seal.
 */
export function slimeSweep(sim: Sim): void {
  const realm = sim.realm;
  if (sim.rules.isOn('sanctuary_seal')) return;
  const size = realm.slime.size;
  if (size === 0) return;
  const rng = sim.rng('slime');
  const count = Math.min(size, SWEEP_BUDGET);
  const start = rng.int(size);
  const pending: number[] = [];
  for (let k = 0; k < count; k++) pending.push(realm.slime.at((start + k) % size));

  for (const i of pending) {
    if (!realm.slime.has(i)) continue;
    const roll = rng.next();
    if (roll < 0.05) {
      realm.setGround(i, G.dug_deepmere);
      spreadFrom(sim, i);
    } else if (roll < 0.1) {
      spreadFrom(sim, i);
    } else {
      let walled = true;
      for (let k = 0; k < 4 && walled; k++) {
        const j = n4(i, realm.side, k);
        if (j < 0) continue;
        const g = realm.ground[j] ?? 0;
        const empty = g === G.deepmere || g === G.dug_deepmere || g === G.dug_midmere || g === G.dug_shoal;
        if (g !== G.slagooze && !empty) walled = false;
      }
      if (walled && rng.next() < 0.09) realm.setGround(i, G.dug_deepmere);
    }
  }
}
