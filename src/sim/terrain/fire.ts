import { G, ground, groundId } from '../../content/grounds.ts';
import { biomeOfCover, coverFireChance } from '../../content/biomes.ts';
import { FLAG } from '../realm.ts';
import { n4 } from '../grid.ts';
import type { Sim } from '../sim.ts';
import type { Rng } from '../../shared/rng.ts';
import { thaw } from './freeze.ts';

/** Ticks after ignition before a fire may spread (04 section 6: 2 ss). */
const SPREAD_AFTER = 40;
/** Fire is always out after this many ticks (04 section 6: 25 ss). */
const BURNOUT_AFTER = 500;
/** Fires may stop after this many ticks (04 section 6: 5 ss). */
const MAY_STOP_AFTER = 100;
/** Hits to burn a tile's cover away (TUNE). */
const BURN_RATE = 3;

/** Flammable ground kinds other than biome covers and creep (04 section 6). */
const FLAMMABLE_GROUND_CHANCE = 0.3;
const TILLED_CHANCE = 0.4;
const CREEP_CHANCE = 0.5;
const GLOOMGROWTH_CHANCE = 1;

/** Fire chance for a tile's spread attempt, from its cover, else its ground (04 section 6). */
export function fireChanceAt(sim: Sim, i: number): number {
  const realm = sim.realm;
  const cover = realm.cover[i] ?? 0;
  if (biomeOfCover(cover) >= 0) return coverFireChance(cover);
  const g = realm.ground[i] ?? 0;
  if (g === G.gloomgrowth) return GLOOMGROWTH_CHANCE;
  if (g === G.tilled) return TILLED_CHANCE;
  if (g === G.bloatmoss || g === G.gourdgrowth) return CREEP_CHANCE;
  if (ground(g).flammable) return FLAMMABLE_GROUND_CHANCE;
  return 0;
}

/** Ground kinds that detonate on ignition instead of burning (18c section 1). */
export function isExplosive(id: number): boolean {
  return ground(id).blastRadius > 0;
}

/**
 * Starts a fire on tile i if it can burn (04 section 6 startFire). `force` ignites bare ground
 * too (magma and direct ignite tools). Returns true when a fire started.
 */
export function startFire(sim: Sim, i: number, force = false): boolean {
  const realm = sim.realm;
  if (realm.hasFlag(i, FLAG.burning)) return false;
  const g = realm.ground[i] ?? 0;
  const kind = ground(g);
  if (kind.layer === 'water' || kind.layer === 'molten') return false;
  const burnable = fireChanceAt(sim, i) > 0 || kind.flammable;
  if (!burnable && !force) return false;
  thaw(sim, i, 99);
  realm.setFlag(i, FLAG.burning, true);
  realm.fireStart[i] = sim.tick;
  realm.hp[i] = Math.max(0, (realm.hp[i] ?? 10) - BURN_RATE);
  if (realm.hp[i] === 0) {
    realm.hp[i] = 10;
    if (realm.cover[i] !== 0) realm.setCover(i, 0);
    else if (kind.down) realm.setGround(i, groundId(kind.down));
  }
  return true;
}

/** Ends a fire: scar the tile and burn the cover away (04 section 6 stopFire). */
export function stopFire(sim: Sim, i: number): void {
  const realm = sim.realm;
  if (!realm.hasFlag(i, FLAG.burning)) return;
  realm.setFlag(i, FLAG.burning, false);
  if (realm.flora[i] !== 0) realm.setFlora(i, 0, 0);
  if (realm.cover[i] !== 0) realm.setCover(i, 0);
  realm.setScar(i, scarStage(sim.rng('fire')));
}

/** Scar stage drawn for a new scar: 6..15 (04 section 6). */
export function scarStage(rng: Rng): number {
  return 15 - rng.int(10);
}

/** The fire sweep of 04 section 11 (every 20 ticks), over the burning set. */
export function fireSweep(sim: Sim): void {
  const realm = sim.realm;
  const rng = sim.rng('fire');
  const ageMult = sim.ageDef().fireSpreadMult;
  const sealed = sim.rules.isOn('sanctuary_seal');
  const rainy = sim.ageDef().flags.includes('rain');
  const snapshot: number[] = [];
  for (let k = 0; k < realm.burning.size; k++) snapshot.push(realm.burning.at(k));
  for (const i of snapshot) {
    if (!realm.hasFlag(i, FLAG.burning)) continue;
    const age = sim.tick - (realm.fireStart[i] ?? sim.tick);
    if (age >= SPREAD_AFTER && !rainy && !sealed) {
      for (let k = 0; k < 4; k++) {
        const j = n4(i, realm.side, k);
        if (j < 0) continue;
        if (rng.next() < fireChanceAt(sim, j) * ageMult) startFire(sim, j);
      }
    }
    if (age >= BURNOUT_AFTER) {
      stopFire(sim, i);
    } else if (age > MAY_STOP_AFTER && rng.next() < 0.12 + 0.3 * (age / BURNOUT_AFTER)) {
      stopFire(sim, i);
    }
  }
}

/** Scar fade (04 section 11, every 3..8 ss): each scarred, non-burning tile loses one stage. */
export function scarFade(sim: Sim): void {
  const realm = sim.realm;
  const snapshot: number[] = [];
  for (let k = 0; k < realm.scarred.size; k++) snapshot.push(realm.scarred.at(k));
  for (const i of snapshot) {
    if (realm.hasFlag(i, FLAG.burning)) continue;
    realm.setScar(i, (realm.scar[i] ?? 0) - 1);
  }
}

