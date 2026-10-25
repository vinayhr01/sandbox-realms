import { BEACON_DESIRES, BEACON_RANGE, LANDMARK_BY_ID, type LandmarkDef } from '../../content/creeps.ts';
import { ground, groundId } from '../../content/grounds.ts';
import { PARCEL } from '../../shared/constants.ts';
import type { Sim } from '../sim.ts';
import { fallAcid } from '../terrain/eruption.ts';
import { startFire } from '../terrain/fire.ts';
import { freeze } from '../terrain/freeze.ts';
import { terrainState } from '../terrain/state.ts';
import type { Hamlet } from './hamlet.ts';

/**
 * Landmark and beacon structures (18e section 2). A structure is one anchor tile; its footprint is recorded in
 * the content table but not checked. The list is saved in the settlements section (adapter.ts) so pulse timers
 * survive a save. Placement is a function only: the power panel does not reach it yet (the power dispatch lives
 * in src/sim/powers, which this round does not touch).
 */
export interface Structure {
  id: string;
  /** Anchor tile index (y * side + x). */
  tile: number;
  /** Absolute tick of the next pulse; unused by passive structures. */
  next: number;
}

/** Live structures of one kind. */
export function countStructures(list: readonly Structure[], id: string): number {
  let n = 0;
  for (const s of list) if (s.id === id) n++;
  return n;
}

/**
 * Places structure `id` on `tile` (18e 2.2 spawn rules). Refused when the id is unknown, the realm cap is reached,
 * the anchor is not walkable land, another structure or a live creep hub stands there. A creep tile under the anchor
 * becomes lowloam (18e 8 edge 5). Returns true when placed.
 */
export function placeStructure(sim: Sim, list: Structure[], id: string, tile: number): boolean {
  const def = LANDMARK_BY_ID.get(id);
  const realm = sim.realm;
  if (!def || tile < 0 || tile >= realm.side * realm.side) return false;
  if (countStructures(list, id) >= def.realmCap) return false;
  if (list.some((s) => s.tile === tile)) return false;
  if (terrainState(sim).hubs.some((h) => h.alive && h.tile === tile)) return false;
  const kind = ground(realm.ground[tile] ?? 0);
  if (kind.layer !== 'land') return false;
  if (kind.creep) realm.setGround(tile, groundId('lowloam'));
  list.push({ id, tile, next: sim.tick + def.period });
  return true;
}

/** Calls f for every tile of the disc of radius r around (cx, cy) that lies inside the realm, in row order. */
function forDisc(sim: Sim, cx: number, cy: number, r: number, f: (tile: number) => void): void {
  const side = sim.realm.side;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= side || y >= side) continue;
      f(y * side + x);
    }
  }
}

/** One pulse of a structure's effect (18e 2.1). Passive kinds do nothing. */
function pulse(sim: Sim, s: Structure, def: LandmarkDef): void {
  const side = sim.realm.side;
  const cx = s.tile % side;
  const cy = Math.floor(s.tile / side);
  if (def.effect === 'freeze') {
    forDisc(sim, cx, cy, def.radius, (t) => freeze(sim, t));
  } else if (def.effect === 'ignite') {
    const rng = sim.rng('landmark');
    forDisc(sim, cx, cy, def.radius, (t) => {
      if (!ground(sim.realm.ground[t] ?? 0).flammable) return;
      if (rng.next() < def.chance) startFire(sim, t);
    });
  } else if (def.effect === 'acid') {
    fallAcid(sim, s.tile);
  }
}

/**
 * Structure step (18e 2.1, 2.2): a structure whose anchor is no longer walkable land is removed (18e 2.2, 18e 8);
 * a structure with a period pulses when its timer is due. Runs once per sim-second; the periods are multiples of 20
 * ticks, so the pulse lands on the first second tick at or after the timer.
 */
export function structureStep(sim: Sim, list: Structure[]): void {
  const realm = sim.realm;
  for (let k = list.length - 1; k >= 0; k--) {
    const s = list[k];
    if (!s) continue;
    const def = LANDMARK_BY_ID.get(s.id);
    if (!def || ground(realm.ground[s.tile] ?? 0).layer !== 'land') {
      list.splice(k, 1);
      continue;
    }
    if (def.period === 0 || sim.tick < s.next) continue;
    s.next = sim.tick + def.period;
    pulse(sim, s, def);
  }
}

/**
 * Build desires a hamlet adopts from beacon pillars (18e 2.3): the pillars with any parcel centre within
 * BEACON_RANGE tiles of the hamlet, nearest first (ties keep list order), at most BEACON_DESIRES of them, and the
 * union of their build ids in that order. Derived each call; nothing is stored.
 */
export function desiresOf(list: readonly Structure[], h: Hamlet, side: number): string[] {
  const perAxis = side / PARCEL;
  const near: { d: number; desires: readonly string[] }[] = [];
  for (const s of list) {
    const def = LANDMARK_BY_ID.get(s.id);
    if (!def || def.desires.length === 0) continue;
    const sx = s.tile % side;
    const sy = Math.floor(s.tile / side);
    let best = Number.POSITIVE_INFINITY;
    for (const p of h.parcels) {
      const cx = (p % perAxis) * PARCEL + PARCEL / 2;
      const cy = Math.floor(p / perAxis) * PARCEL + PARCEL / 2;
      const d = Math.hypot(cx - sx, cy - sy);
      if (d < best) best = d;
    }
    if (best <= BEACON_RANGE) near.push({ d: best, desires: def.desires });
  }
  near.sort((a, b) => a.d - b.d);
  const out: string[] = [];
  for (const n of near.slice(0, BEACON_DESIRES)) {
    for (const id of n.desires) if (!out.includes(id)) out.push(id);
  }
  return out;
}
