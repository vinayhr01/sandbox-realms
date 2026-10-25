/**
 * Roads (09 section 11.3). Only a hamlet whose culture holds the custom trait `roadworks` lays them; adapter.ts calls
 * planRoads when a roadTo building of that hamlet is placed. A road runs from the new building to each of the two
 * nearest other roadTo buildings of the same hamlet on the same island: A* over 4-neighbour open tiles, step cost 1,
 * 0.01 on an existing road, rejected when the path would exceed ROAD_MAX_TILES tiles, stopping on the target's edge or
 * on an existing road. Road tiles become the ground `wayworn` (18c, walk x1.4). The planned tiles are queued on the
 * hamlet (hamlet.ts `road`), and a roadwright lays them one at a time (09 section 8, DECISIONS.md "Jobs build 3").
 */
import { G, ground } from '../../content/grounds.ts';
import type { Rng } from '../../shared/rng.ts';
import type { Realm } from '../realm.ts';
import type { Placed } from './hamlet.ts';

/** pathDecay interval in sim-seconds: 1 + a random 0..1 (02 section 7). */
export const PATH_DECAY_SS = 1;
export const PATH_DECAY_RANDOM_SS = 1;
/** Chance per run that a road tile outside a Custom's hamlet territory reverts (02 section 7, "decay 50%"). */
export const PATH_DECAY_CHANCE = 0.5;

/** Longest road in tiles (09 11.3). */
export const ROAD_MAX_TILES = 20;
/** Step cost onto a tile that is already road (09 11.3). */
export const ROAD_ON_ROAD_COST = 0.01;
/** Buildings a road may join. The spec's `roadTo` flag is not set on any catalogue row, so this list is TUNE: the civic and trade buildings. */
export const ROAD_TO_IDS: ReadonlySet<string> = new Set(['great_hall_1', 'great_hall_2', 'great_hall_3', 'monument', 'waystop', 'garrison', 'bazaar']);

function heightOf(def: Placed['def']): number {
  return def.height ?? def.footprint;
}

/** Tile indices under a placed building. */
function footprintOf(b: Placed, side: number): Set<number> {
  const tiles = new Set<number>();
  for (let dy = 0; dy < heightOf(b.def); dy++) for (let dx = 0; dx < b.def.footprint; dx++) tiles.add((b.y + dy) * side + b.x + dx);
  return tiles;
}

/** The four neighbours of a tile that lie on the realm. */
function neighbours4(i: number, side: number): number[] {
  const x = i % side;
  const y = Math.floor(i / side);
  const out: number[] = [];
  if (x > 0) out.push(i - 1);
  if (x < side - 1) out.push(i + 1);
  if (y > 0) out.push(i - side);
  if (y < side - 1) out.push(i + side);
  return out;
}

/** True when a tile is walkable land with no flora and no damaging ground: the terrain part of a road tile. */
export function roadTerrainOpen(realm: Realm, i: number): boolean {
  const kind = ground(realm.ground[i] ?? 0);
  return kind.layer === 'land' && kind.damages === 0 && (realm.flora[i] ?? 0) === 0;
}

function isRoad(realm: Realm, i: number): boolean {
  return realm.ground[i] === G.wayworn;
}

/**
 * Cheapest road from building `from` to building `to` (A*, 09 11.3). `open` says whether a tile may carry road (terrain,
 * no building, not another hamlet's). Returns the tiles of the path from the first road tile to the last, or null when no
 * path of at most ROAD_MAX_TILES tiles reaches the target's edge or an existing road. Draws no rng.
 */
export function roadPath(realm: Realm, from: Placed, to: Placed, open: (i: number) => boolean): number[] | null {
  const side = realm.side;
  const fromTiles = footprintOf(from, side);
  const toTiles = footprintOf(to, side);
  const goal = new Set<number>();
  for (const t of toTiles) for (const n of neighbours4(t, side)) if (!toTiles.has(n) && open(n)) goal.add(n);
  const enter = (i: number): number => (isRoad(realm, i) ? ROAD_ON_ROAD_COST : 1);
  const cost = new Map<number, number>();
  const steps = new Map<number, number>();
  const prev = new Map<number, number>();
  // Frontier as a plain array: the search is bounded by ROAD_MAX_TILES, so it stays small.
  let frontier: number[] = [];
  for (const t of fromTiles) {
    for (const n of neighbours4(t, side)) {
      if (fromTiles.has(n) || !open(n) || cost.has(n)) continue;
      cost.set(n, enter(n));
      steps.set(n, 1);
      frontier.push(n);
    }
  }
  while (frontier.length > 0) {
    // Take the cheapest entry; ties go to the lower tile index.
    let bestAt = 0;
    for (let k = 1; k < frontier.length; k++) {
      const a = frontier[k] ?? 0;
      const b = frontier[bestAt] ?? 0;
      const ca = cost.get(a) ?? Infinity;
      const cb = cost.get(b) ?? Infinity;
      if (ca < cb || (ca === cb && a < b)) bestAt = k;
    }
    const at = frontier[bestAt] ?? 0;
    frontier = frontier.filter((_, k) => k !== bestAt);
    // Stop at the target's edge or on an existing road (the network the road joins).
    if (goal.has(at) || isRoad(realm, at)) {
      const path: number[] = [at];
      let cur = at;
      while (prev.has(cur)) {
        cur = prev.get(cur) ?? cur;
        path.unshift(cur);
      }
      return path;
    }
    const nSteps = steps.get(at) ?? 0;
    if (nSteps >= ROAD_MAX_TILES) continue;
    for (const n of neighbours4(at, side)) {
      if (fromTiles.has(n) || toTiles.has(n) || !open(n)) continue;
      const next = (cost.get(at) ?? 0) + enter(n);
      if (next < (cost.get(n) ?? Infinity)) {
        cost.set(n, next);
        steps.set(n, nSteps + 1);
        prev.set(n, at);
        frontier.push(n);
      }
    }
  }
  return null;
}

/**
 * Lays the roads of a newly placed roadTo building `b` (09 11.3): joins it to the two nearest other roadTo buildings
 * of `buildings` on its island. Returns the tiles of those roads, in the order a roadwright lays them, without laying
 * them: the caller queues them on the hamlet. Tiles that are already road are left out. `open` is checked against the
 * tiles planned so far, so a second road may reuse the first road's line without repeating its tiles. Draws no rng.
 */
export function planRoads(realm: Realm, buildings: readonly Placed[], b: Placed, open: (i: number) => boolean): number[] {
  if (!ROAD_TO_IDS.has(b.def.id)) return [];
  const side = realm.side;
  const home = realm.region[b.y * side + b.x] ?? 0;
  if (home === 0) return [];
  const dist = (p: Placed): number => Math.abs(p.x - b.x) + Math.abs(p.y - b.y);
  const others = buildings
    .filter((o) => o !== b && ROAD_TO_IDS.has(o.def.id) && (realm.region[o.y * side + o.x] ?? 0) === home)
    .sort((p, q) => dist(p) - dist(q));
  const planned: number[] = [];
  const taken = new Set<number>();
  const free = (i: number): boolean => !taken.has(i) && open(i);
  for (const target of others.slice(0, 2)) {
    const path = roadPath(realm, b, target, free);
    if (!path) continue;
    for (const i of path) {
      if (isRoad(realm, i) || taken.has(i)) continue;
      taken.add(i);
      planned.push(i);
    }
  }
  return planned;
}

/**
 * Remembers the base ground of queued road tiles before a roadwright lays them, so a decaying road can revert to it. A
 * tile is recorded only while it is not road yet; the first record wins. Records of tiles that are neither road nor queued
 * are dropped. Draws no rng.
 */
export function recordRoadBases(realm: Realm, queues: readonly (readonly number[])[], bases: Map<number, number>): void {
  const queued = new Set<number>();
  for (const q of queues) for (const t of q) queued.add(t);
  for (const t of queued) {
    if (!bases.has(t) && !isRoad(realm, t)) bases.set(t, realm.ground[t] ?? 0);
  }
  for (const t of [...bases.keys()]) {
    if (!isRoad(realm, t) && !queued.has(t)) bases.delete(t);
  }
}

/**
 * One pathDecay run (02 section 7): each recorded road tile that is still road and is not `shielded` reverts to its base
 * ground with chance PATH_DECAY_CHANCE. Tiles are visited in index order and draw one rng value each, so the run is
 * deterministic. A reverted tile's record is removed. Unused or unrepaired roads are not a spec condition and are not checked.
 */
export function decayRoads(realm: Realm, bases: Map<number, number>, shielded: (i: number) => boolean, rng: Rng): void {
  for (const t of [...bases.keys()].sort((a, b) => a - b)) {
    if (!isRoad(realm, t) || shielded(t)) continue;
    if (rng.next() >= PATH_DECAY_CHANCE) continue;
    const base = bases.get(t);
    if (base === undefined) continue;
    realm.setGround(t, base);
    bases.delete(t);
  }
}
