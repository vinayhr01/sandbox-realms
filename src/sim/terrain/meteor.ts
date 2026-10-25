import { explode } from '../explosions.ts';
import { placeMineralNode } from '../flora.ts';
import type { Sim } from '../sim.ts';
import { PARCEL } from '../../shared/constants.ts';

/** Meteor blast profiles (04 section 8.1). Both use radius 20 and power 1. */
export const METEOR_PROFILES = {
  skyrock: { radius: 20, damage: 1000, power: 1 },
  skyrock_small: { radius: 20, damage: 500, power: 1 },
} as const;

export type MeteorProfile = keyof typeof METEOR_PROFILES;

/** Mineral nodes a meteor leaves: the impact tile and four more in the same Parcel (04 section 8.1). */
const NODES_PER_IMPACT = 5;

/**
 * Meteor impact (04 sections 8.1 and 8.6): explodes at (x, y) with the profile's radius and damage,
 * then leaves mineral nodes on the impact tile and four tiles of its Parcel. Returns the number of
 * beings hit by the blast (0 when the guard refused it).
 */
export function meteorImpact(sim: Sim, x: number, y: number, profile: MeteorProfile): number {
  const p = METEOR_PROFILES[profile];
  const hit = explode(sim.explosionContext(), x, y, p.radius, p.damage, 'Explosion', -1, p.power);
  const rng = sim.rng('meteor');
  const realm = sim.realm;
  const px = Math.floor(x / PARCEL) * PARCEL;
  const py = Math.floor(y / PARCEL) * PARCEL;
  placeMineralNode(sim, x, y);
  let placed = 1;
  for (let t = 0; t < 64 && placed < NODES_PER_IMPACT; t++) {
    const tx = px + rng.int(PARCEL);
    const ty = py + rng.int(PARCEL);
    if (!realm.inBounds(tx, ty)) continue;
    if (placeMineralNode(sim, tx, ty)) placed++;
  }
  return hit;
}
