import { G, ground } from '../../content/grounds.ts';
import { createRng, hash3 } from '../../shared/rng.ts';
import { n4 } from '../grid.ts';
import { FLAG, type Realm } from '../realm.ts';
import { noise01 } from './noise.ts';

/** Rivers (03 section 7): spring elevation floor, carved height, walk limits. */
const RIVER_SOURCE_ELEVATION = 195;
const RIVER_ELEVATION = 78;
const RIVER_MIN_LENGTH = 20;
const RIVER_MAX_STEPS = 700;
const RIVER_POOL_RADIUS2 = 9;
const RIVER_RIM_RADIUS2 = 10;
/** Interpretation of "landmass >= 4 regions": at least four Patches (4 x 256 tiles). */
const RIVER_MIN_LANDMASS = 4 * 256;

/** Lakes (03 section 7): minimum sea distance, carved heights. Seeds are lowloam or highloam tiles. */
const LAKE_MIN_SEA_DISTANCE = 20;
const LAKE_ELEVATION = 80;
const LAKE_SHORE_ELEVATION = 101;

export interface Landmasses {
  /** Landmass index per tile, -1 for water. */
  label: Int32Array;
  /** Tile count per landmass index. */
  size: number[];
}

const isWater = (realm: Realm, k: number): boolean => ground(realm.ground[k] ?? 0).layer === 'water';
const isBlocked = (realm: Realm, k: number): boolean => ground(realm.ground[k] ?? 0).layer === 'blocked';
const isEdge = (realm: Realm, k: number): boolean => realm.hasFlag(k, FLAG.edgeOfRealm);

/** Connected components of non-water tiles (4-connected). */
export function landmasses(realm: Realm): Landmasses {
  const label = new Int32Array(realm.tileCount).fill(-1);
  const size: number[] = [];
  const stack: number[] = [];
  for (let k = 0; k < realm.tileCount; k++) {
    if (label[k] !== -1 || isWater(realm, k)) continue;
    const id = size.length;
    size.push(0);
    label[k] = id;
    stack.push(k);
    while (stack.length > 0) {
      const i = stack.pop() ?? 0;
      size[id] = (size[id] ?? 0) + 1;
      for (let d = 0; d < 4; d++) {
        const j = n4(i, realm.side, d);
        if (j < 0 || label[j] !== -1 || isWater(realm, j)) continue;
        label[j] = id;
        stack.push(j);
      }
    }
  }
  return { label, size };
}

/** Rolls back a journal of carved tiles (first-seen elevation and ground per tile). */
function rollback(realm: Realm, journal: Map<number, [number, number]>): void {
  for (const [k, [elev, g]] of journal) {
    realm.elevation[k] = elev;
    realm.setGround(k, g);
  }
}

/**
 * Carves `count` rivers (03 section 7). Each river starts on a knoll or crag at elevation >= 195
 * and walks downhill to sea, carving shoal at height 78. A local minimum becomes a pool (disc
 * radius 3) and the walk continues from its lowest rim tile. Rivers shorter than 20 tiles are
 * rolled back. Returns the number of rivers kept.
 *
 * Deviation: the "never cut a landmass into islets" guard is not implemented (see DECISIONS.md).
 */
export function carveRivers(realm: Realm, count: number, seed: number): number {
  if (count <= 0) return 0;
  const rng = createRng(hash3(seed, 0x72697665, 1));
  const side = realm.side;
  const { label, size } = landmasses(realm);
  const springs: number[] = [];
  for (let k = 0; k < realm.tileCount; k++) {
    const g = realm.ground[k] ?? 0;
    if (g !== G.knoll && g !== G.crag) continue;
    if ((realm.elevation[k] ?? 0) < RIVER_SOURCE_ELEVATION || isEdge(realm, k)) continue;
    if ((size[label[k] ?? -1] ?? 0) < RIVER_MIN_LANDMASS) continue;
    springs.push(k);
  }
  let kept = 0;
  for (let r = 0; r < count && springs.length > 0; r++) {
    const start = springs[rng.int(springs.length)] ?? 0;
    const g = realm.ground[start] ?? 0;
    if (g !== G.knoll && g !== G.crag) continue; // carved by an earlier river
    const journal = new Map<number, [number, number]>();
    const length = traceRiver(realm, start, rng, journal, side);
    if (length >= RIVER_MIN_LENGTH) kept++;
    else rollback(realm, journal);
  }
  return kept;
}

/** Walks one river from `start`, carving as it goes. Returns the number of carved tiles. */
function traceRiver(realm: Realm, start: number, rng: ReturnType<typeof createRng>, journal: Map<number, [number, number]>, side: number): number {
  const river = new Set<number>();
  const pool = new Set<number>();
  const recent: number[] = [];

  const carve = (k: number): void => {
    if (k < 0 || isWater(realm, k) || realm.ground[k] === G.pinnacle || river.has(k)) return;
    if (!journal.has(k)) journal.set(k, [realm.elevation[k] ?? 0, realm.ground[k] ?? 0]);
    realm.elevation[k] = RIVER_ELEVATION;
    realm.setGround(k, G.shoal);
    river.add(k);
  };

  let cur = start;
  for (let step = 0; step < RIVER_MAX_STEPS; step++) {
    const here = realm.elevation[cur] ?? 0;
    carve(cur);
    if (rng.next() < 0.5) carve(rng.next() < 0.5 ? n4(cur, side, 1) : n4(cur, side, 2));

    let best = -1;
    let bestE = Number.POSITIVE_INFINITY;
    let ties = 0;
    let reachedSea = false;
    for (let d = 0; d < 4; d++) {
      const j = n4(cur, side, d);
      if (j < 0) continue;
      if (isWater(realm, j) && !river.has(j)) {
        reachedSea = true;
        break;
      }
      if (river.has(j) || pool.has(j) || realm.ground[j] === G.pinnacle || recent.includes(j)) continue;
      const e = realm.elevation[j] ?? 0;
      if (e < bestE) {
        best = j;
        bestE = e;
        ties = 1;
      } else if (e === bestE) {
        ties++;
        if (rng.int(ties) === 0) best = j;
      }
    }
    if (reachedSea) break;

    if (best < 0 || bestE >= here) {
      // Local minimum: carve a pool and continue from the lowest tile on its rim.
      const cx = cur % side;
      const cy = Math.floor(cur / side);
      let rim = -1;
      let rimE = Number.POSITIVE_INFINITY;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const d2 = dx * dx + dy * dy;
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= side || y >= side || d2 > RIVER_RIM_RADIUS2) continue;
          const k = y * side + x;
          if (d2 <= RIVER_POOL_RADIUS2) {
            if (isWater(realm, k) || realm.ground[k] === G.pinnacle) continue;
            carve(k);
            pool.add(k);
          } else if (!isWater(realm, k) && realm.ground[k] !== G.pinnacle && !river.has(k)) {
            const e = realm.elevation[k] ?? 0;
            if (e < rimE) {
              rim = k;
              rimE = e;
            }
          }
        }
      }
      if (rim < 0) break;
      cur = rim;
      continue;
    }

    recent.push(cur);
    if (recent.length > 8) recent.shift();
    cur = best;
  }
  return river.size;
}

/**
 * Seeds `count` lakes (03 section 7): a blob of shoal at height 80 on a land tile of the
 * lowloam..highloam band at least 20 tiles from sea, with a 1-tile strand shore. The radius is
 * 3..9, perturbed per tile by noise. Returns the number of lakes placed.
 */
export function carveLakes(realm: Realm, count: number, seed: number): number {
  if (count <= 0) return 0;
  const rng = createRng(hash3(seed, 0x6c616b65, 1));
  const side = realm.side;
  const dist = distanceFromSea(realm);
  const cands: number[] = [];
  for (let k = 0; k < realm.tileCount; k++) {
    const g = realm.ground[k] ?? 0;
    if (g !== G.lowloam && g !== G.highloam) continue;
    if (isEdge(realm, k)) continue;
    if ((dist[k] ?? 0) < LAKE_MIN_SEA_DISTANCE) continue;
    cands.push(k);
  }
  const noiseSeed = rng.int(0x7fffffff);
  let placed = 0;
  for (let l = 0; l < count && cands.length > 0; l++) {
    const c = cands[rng.int(cands.length)] ?? 0;
    const cx = c % side;
    const cy = Math.floor(c / side);
    const r = 3 + rng.int(7);
    const inside = new Set<number>();
    for (let dy = -r - 2; dy <= r + 2; dy++) {
      for (let dx = -r - 2; dx <= r + 2; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= side || y >= side) continue;
        const rEff = r * (0.8 + 0.4 * noise01(x * 0.25, y * 0.25, noiseSeed));
        if (Math.hypot(dx, dy) <= rEff) inside.add(y * side + x);
      }
    }
    for (const k of inside) {
      if (isWater(realm, k) || isBlocked(realm, k) || isEdge(realm, k)) continue;
      realm.elevation[k] = LAKE_ELEVATION;
      realm.setGround(k, G.shoal);
      realm.setCover(k, 0);
    }
    for (const k of inside) {
      for (let d = 0; d < 4; d++) {
        const j = n4(k, side, d);
        if (j < 0 || inside.has(j) || isWater(realm, j) || isBlocked(realm, j) || isEdge(realm, j)) continue;
        realm.elevation[j] = LAKE_SHORE_ELEVATION;
        realm.setGround(j, G.strand);
        realm.setCover(j, 0);
      }
    }
    placed++;
  }
  return placed;
}

/** Multi-source BFS distance (n4 steps) from every water tile. */
function distanceFromSea(realm: Realm): Int32Array {
  const dist = new Int32Array(realm.tileCount).fill(-1);
  const queue: number[] = [];
  for (let k = 0; k < realm.tileCount; k++) {
    if (isWater(realm, k)) {
      dist[k] = 0;
      queue.push(k);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head] ?? 0;
    for (let d = 0; d < 4; d++) {
      const j = n4(i, realm.side, d);
      if (j < 0 || dist[j] !== -1) continue;
      dist[j] = (dist[i] ?? 0) + 1;
      queue.push(j);
    }
  }
  return dist;
}
