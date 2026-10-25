import { ground, type GroundLayer } from '../../content/grounds.ts';
import { N8X, N8Y } from '../grid.ts';
import { PATCH_DIRTY, type Realm } from '../realm.ts';

/**
 * Connectivity layer (01 section 11): regions per Patch, links across Patch edges and corners, and
 * landmasses (union of regions joined by links, one move layer each). Derived data only: nothing
 * here is saved or hashed, and nothing draws randomness, so it cannot change the sim state.
 *
 * Scheduler: every CONNECTIVITY_PERIOD ticks, unless `busy` (a quake is running), the dirty Patches
 * are rebuilt. Only those Patches and the landmasses they touch are relabelled.
 */

/** Scheduler period in ticks (01 section 11: every 8 ticks). */
export const CONNECTIVITY_PERIOD = 8;
/** A landmass with at least this many regions counts as real land (01 section 11, OPEN default 4). */
export const REAL_LAND_REGIONS = 4;

const PATCH = 16;

export interface Region {
  id: number;
  layer: GroundLayer;
  patch: number;
  tiles: number;
  adj: Set<number>;
  /** Landmass id, -1 while unlabelled (only during a settle pass). */
  lm: number;
}

export interface Landmass {
  id: number;
  layer: GroundLayer;
  tileCount: number;
  regionCount: number;
  members: Set<number>;
}

interface Conn {
  regions: Map<number, Region>;
  patchRegions: Map<number, number[]>;
  landmasses: Map<number, Landmass>;
  nextLm: number;
}

const conns = new WeakMap<Realm, Conn>();

function connOf(realm: Realm): Conn {
  let c = conns.get(realm);
  if (!c) {
    c = { regions: new Map(), patchRegions: new Map(), landmasses: new Map(), nextLm: 1 };
    conns.set(realm, c);
  }
  return c;
}

function layerOf(realm: Realm, i: number): GroundLayer {
  return ground(realm.ground[i] ?? 0).layer;
}

/**
 * Corner-cutting rule (01 section 7): a diagonal step is rejected when either orthogonal corner is
 * `blocked` or off the grid. Orthogonal steps always pass.
 */
function diagonalOpen(realm: Realm, i: number, dx: number, dy: number): boolean {
  if (dx === 0 || dy === 0) return true;
  const side = realm.side;
  const x = i % side;
  const y = (i - x) / side;
  const ax = x + dx;
  const by = y + dy;
  if (ax < 0 || ax >= side || by < 0 || by >= side) return false;
  const a = y * side + ax;
  const b = by * side + x;
  return layerOf(realm, a) !== 'blocked' && layerOf(realm, b) !== 'blocked';
}

/** Regions of one Patch: BFS over n8 steps with equal layer, inside the Patch (01 section 11). */
function buildPatchRegions(realm: Realm, conn: Conn, p: number, fresh: Region[]): void {
  const side = realm.side;
  const ppa = realm.patchesPerAxis;
  const px = (p % ppa) * PATCH;
  const py = Math.floor(p / ppa) * PATCH;
  const local = new Int16Array(PATCH * PATCH).fill(-1);
  const queue = new Int32Array(PATCH * PATCH);
  const ids: number[] = [];
  let count = 0;
  for (let seed = 0; seed < PATCH * PATCH; seed++) {
    if (local[seed] !== -1) continue;
    const layer = layerOf(realm, (py + (seed >> 4)) * side + px + (seed & 15));
    const id = (p << 8) | count;
    const region: Region = { id, layer, patch: p, tiles: 0, adj: new Set<number>(), lm: -1 };
    local[seed] = count;
    let head = 0;
    let tail = 0;
    queue[tail++] = seed;
    while (head < tail) {
      const cur = queue[head++] ?? 0;
      const cx = cur & 15;
      const cy = cur >> 4;
      const i = (py + cy) * side + px + cx;
      region.tiles++;
      realm.connRegion[i] = id;
      for (let k = 0; k < 8; k++) {
        const dx = N8X[k] ?? 0;
        const dy = N8Y[k] ?? 0;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= PATCH || ny >= PATCH) continue;
        const nl = ny * PATCH + nx;
        if (local[nl] !== -1) continue;
        const j = (py + ny) * side + px + nx;
        if (layerOf(realm, j) !== layer) continue;
        if (!diagonalOpen(realm, i, dx, dy)) continue;
        local[nl] = count;
        queue[tail++] = nl;
      }
    }
    count++;
    conn.regions.set(id, region);
    ids.push(id);
    fresh.push(region);
  }
  conn.patchRegions.set(p, ids);
}

/** Adds the links from every tile of a Patch to its n8 neighbours in other Patches (both ways). */
function linkPatch(realm: Realm, conn: Conn, p: number): void {
  const side = realm.side;
  const ppa = realm.patchesPerAxis;
  const px = (p % ppa) * PATCH;
  const py = Math.floor(p / ppa) * PATCH;
  for (let cy = 0; cy < PATCH; cy++) {
    for (let cx = 0; cx < PATCH; cx++) {
      const i = (py + cy) * side + px + cx;
      const layer = layerOf(realm, i);
      const ra = realm.connRegion[i] ?? 0;
      for (let k = 0; k < 8; k++) {
        const dx = N8X[k] ?? 0;
        const dy = N8Y[k] ?? 0;
        const nx = px + cx + dx;
        const ny = py + cy + dy;
        if (nx < 0 || ny < 0 || nx >= side || ny >= side) continue;
        const j = ny * side + nx;
        if (realm.patchOf(j) === p) continue;
        if (layerOf(realm, j) !== layer) continue;
        if (!diagonalOpen(realm, i, dx, dy)) continue;
        const rb = realm.connRegion[j] ?? 0;
        const a = conn.regions.get(ra);
        const b = conn.regions.get(rb);
        if (!a || !b) continue;
        a.adj.add(b.id);
        b.adj.add(a.id);
      }
    }
  }
}

/** Removes a Patch's regions from the graph and records the landmasses they belonged to. */
function dropPatchRegions(conn: Conn, p: number, touched: Set<number>): void {
  const ids = conn.patchRegions.get(p) ?? [];
  for (const id of ids) {
    const r = conn.regions.get(id);
    if (!r) continue;
    for (const a of r.adj) conn.regions.get(a)?.adj.delete(id);
    if (r.lm !== -1) {
      touched.add(r.lm);
      const lm = conn.landmasses.get(r.lm);
      if (lm) {
        lm.members.delete(id);
        lm.regionCount--;
        lm.tileCount -= r.tiles;
      }
    }
    conn.regions.delete(id);
  }
  conn.patchRegions.delete(p);
}

/**
 * Relabels the landmasses that the changed regions touched. Every member of a touched landmass is
 * put back on the work list; a BFS over links gives each connected group a fresh id. A landmass
 * reached from a group but not touched is dissolved the same way, so no stale labels survive.
 */
function relabel(conn: Conn, touched: Set<number>, fresh: Region[]): void {
  const work: number[] = [];
  for (const lmId of touched) {
    const lm = conn.landmasses.get(lmId);
    if (!lm) continue;
    for (const m of lm.members) work.push(m);
    conn.landmasses.delete(lmId);
  }
  for (const r of fresh) work.push(r.id);

  const done = new Set<number>();
  for (let w = 0; w < work.length; w++) {
    const seedId = work[w] ?? -1;
    const seed = conn.regions.get(seedId);
    if (!seed || done.has(seedId)) continue;
    const lmId = conn.nextLm++;
    const lm: Landmass = { id: lmId, layer: seed.layer, tileCount: 0, regionCount: 0, members: new Set<number>() };
    conn.landmasses.set(lmId, lm);
    const stack: Region[] = [seed];
    done.add(seed.id);
    while (stack.length > 0) {
      const r = stack.pop();
      if (!r) break;
      if (r.lm !== -1) {
        // Reached a region still labelled by an old landmass: dissolve that landmass, queue its members.
        const old = conn.landmasses.get(r.lm);
        if (old) {
          for (const m of old.members) if (!done.has(m)) work.push(m);
          conn.landmasses.delete(old.id);
        }
      }
      r.lm = lmId;
      lm.members.add(r.id);
      lm.regionCount++;
      lm.tileCount += r.tiles;
      for (const a of r.adj) {
        if (done.has(a)) continue;
        const nr = conn.regions.get(a);
        if (!nr) continue;
        done.add(a);
        stack.push(nr);
      }
    }
  }
}

/**
 * Rebuilds the listed Patches and relabels the landmasses they touch. Order: drop old regions,
 * build new regions, link, relabel. Patch lists are processed in ascending id order so the result
 * does not depend on insertion order.
 */
function rebuild(realm: Realm, dirty: number[]): void {
  const conn = connOf(realm);
  const touched = new Set<number>();
  const fresh: Region[] = [];
  for (const p of dirty) dropPatchRegions(conn, p, touched);
  for (const p of dirty) buildPatchRegions(realm, conn, p, fresh);
  for (const p of dirty) linkPatch(realm, conn, p);
  relabel(conn, touched, fresh);
}

/** Rebuilds every dirty Patch now, regardless of the schedule (used by the scheduler and by tests). */
export function settleConnectivity(realm: Realm): void {
  if (realm.connDirty.size === 0) return;
  const dirty = [...realm.connDirty].sort((a, b) => a - b);
  realm.connDirty.clear();
  for (const p of dirty) realm.patchDirty[p] = (realm.patchDirty[p] ?? 0) & ~PATCH_DIRTY.connectivity;
  rebuild(realm, dirty);
}

/** Connectivity scheduler (01 section 11, every 8 ticks, deferred while busy). */
export function connectivityStep(realm: Realm, tick: number, busy: boolean): void {
  if (busy || tick % CONNECTIVITY_PERIOD !== 0) return;
  settleConnectivity(realm);
}

/** Landmass id of tile i, or -1 when the tile has no region yet (never settled). */
export function landmassOf(realm: Realm, i: number): number {
  const r = connOf(realm).regions.get(realm.connRegion[i] ?? 0);
  return r ? r.lm : -1;
}

/** True when tiles a and b are in the same landmass (01 section 11: O(1) reachability). */
export function connected(realm: Realm, a: number, b: number): boolean {
  const la = landmassOf(realm, a);
  return la !== -1 && la === landmassOf(realm, b);
}

/** Number of landmasses of one move layer. */
export function landmassCount(realm: Realm, layer: GroundLayer): number {
  let n = 0;
  for (const lm of connOf(realm).landmasses.values()) if (lm.layer === layer) n++;
  return n;
}

/** Landmass record by id, for inspection and tests. */
export function landmassInfo(realm: Realm, id: number): Landmass | undefined {
  return connOf(realm).landmasses.get(id);
}

/** Real land: a Land landmass with at least REAL_LAND_REGIONS regions (01 section 11). */
export function isRealLand(realm: Realm, id: number): boolean {
  const lm = connOf(realm).landmasses.get(id);
  return lm !== undefined && lm.layer === 'land' && lm.regionCount >= REAL_LAND_REGIONS;
}
