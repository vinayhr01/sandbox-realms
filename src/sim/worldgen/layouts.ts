import { G, ground } from '../../content/grounds.ts';
import { biomeCoverId } from '../../content/biomes.ts';
import type { Rng } from '../../shared/rng.ts';
import { N4X, N4Y, n4 } from '../grid.ts';
import { FLAG, type Realm } from '../realm.ts';
import { BIOME_WEIGHTS, pickWeightedBiome } from './pick.ts';
import { landmasses } from './water.ts';
import { PARCEL } from '../../shared/constants.ts';

/** Patch size in tiles (01 section 2). */
export const PATCH = 16;

/** Layout ids selected by a template (03 section 9.1). */
export type Layout = 'none' | 'chessboard' | 'cells' | 'warren';

const edge = (realm: Realm, k: number): boolean => realm.hasFlag(k, FLAG.edgeOfRealm);
const isBlocked = (realm: Realm, k: number): boolean => ground(realm.ground[k] ?? 0).layer === 'blocked';

/** Writes ground and its band elevation (the typing invariant holds for the result). */
function put(realm: Realm, k: number, g: number): void {
  realm.elevation[k] = ground(g).band ?? realm.elevation[k] ?? 0;
  realm.setGround(k, g);
  realm.setCover(k, 0);
}

/**
 * Chessboard (03 section 9.1): alternating Patches of highloam (biome A, high cover) and lowloam
 * (biome B, low cover). A and B are distinct weighted draws. The edge ring is left alone.
 */
export function layoutChessboard(realm: Realm, rng: Rng, biomes: boolean): void {
  const per = realm.side / PATCH;
  let a = 0;
  let b = 0;
  if (biomes) {
    a = pickWeightedBiome(rng, BIOME_WEIGHTS);
    do {
      b = pickWeightedBiome(rng, BIOME_WEIGHTS);
    } while (b === a);
  }
  for (let py = 0; py < per; py++) {
    for (let px = 0; px < per; px++) {
      const high = (px + py) % 2 === 0;
      const biome = high ? a : b;
      for (let y = py * PATCH; y < (py + 1) * PATCH; y++) {
        for (let x = px * PATCH; x < (px + 1) * PATCH; x++) {
          const k = y * realm.side + x;
          if (edge(realm, k)) continue;
          put(realm, k, high ? G.highloam : G.lowloam);
          if (biomes) realm.setCover(k, biomeCoverId(biome, high));
        }
      }
    }
  }
}

interface Room {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * Cells (03 section 9.1): rooms grown from random unused Patches (2..cellSize+1 Patches each way),
 * walled with crag on the room outline, each side opened by a 3x3 knoll doorway.
 * Rooms are highloam (bare, biomes flood-fill later) or lowloam with one weighted biome.
 */
export function layoutCells(realm: Realm, rng: Rng, cellSize: number, biomes: boolean): void {
  const side = realm.side;
  const per = side / PATCH;
  const c = Math.min(15, Math.max(2, Math.floor(cellSize)));
  const used = new Uint8Array(per * per);
  const isFree = (px: number, py: number): boolean => px >= 0 && py >= 0 && px < per && py < per && used[py * per + px] === 0;
  const rowFree = (py: number, x0: number, x1: number): boolean => {
    for (let px = x0; px <= x1; px++) if (!isFree(px, py)) return false;
    return true;
  };
  const rooms: Room[] = [];

  for (;;) {
    const unused: number[] = [];
    for (let i = 0; i < used.length; i++) if (used[i] === 0) unused.push(i);
    if (unused.length === 0) break;
    const seed = unused[rng.int(unused.length)] ?? 0;
    const sx = seed % per;
    const sy = Math.floor(seed / per);
    let x0 = sx;
    let x1 = sx;
    let y0 = sy;
    let y1 = sy;
    const right = 2 + rng.int(c);
    for (let s = 0; s < right && isFree(x1 + 1, sy); s++) x1++;
    const left = 2 + rng.int(c);
    for (let s = 0; s < left && isFree(x0 - 1, sy); s++) x0--;
    const down = 2 + rng.int(c);
    for (let s = 0; s < down && rowFree(y1 + 1, x0, x1); s++) y1++;
    const up = 2 + rng.int(c);
    for (let s = 0; s < up && rowFree(y0 - 1, x0, x1); s++) y0--;
    for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) used[py * per + px] = 1;
    rooms.push({ x0: x0 * PATCH, x1: (x1 + 1) * PATCH - 1, y0: y0 * PATCH, y1: (y1 + 1) * PATCH - 1 });
  }

  // Room floors (finishRoom): highloam bare, or lowloam under one biome.
  for (const r of rooms) {
    const high = rng.next() < 0.5;
    const cover = !high && biomes ? biomeCoverId(pickWeightedBiome(rng, BIOME_WEIGHTS), false) : 0;
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const k = y * side + x;
        if (edge(realm, k)) continue;
        put(realm, k, high ? G.highloam : G.lowloam);
        realm.setCover(k, cover);
      }
    }
  }

  // Walls: the outline of every room becomes crag (painting over neighbouring rooms' edges).
  for (const r of rooms) {
    for (let x = r.x0; x <= r.x1; x++) {
      wall(realm, r.y0 * side + x);
      wall(realm, r.y1 * side + x);
    }
    for (let y = r.y0; y <= r.y1; y++) {
      wall(realm, y * side + r.x0);
      wall(realm, y * side + r.x1);
    }
  }

  // Doors: a side still fully crag gets a 3x3 knoll doorway at a seeded position in [3, len-3].
  for (const r of rooms) {
    const sides: number[][] = [];
    const top: number[] = [];
    const bottom: number[] = [];
    const left: number[] = [];
    const right: number[] = [];
    for (let x = r.x0; x <= r.x1; x++) {
      top.push(r.y0 * side + x);
      bottom.push(r.y1 * side + x);
    }
    for (let y = r.y0; y <= r.y1; y++) {
      left.push(y * side + r.x0);
      right.push(y * side + r.x1);
    }
    sides.push(top, bottom, left, right);
    for (const tiles of sides) {
      if (!tiles.every((k) => realm.ground[k] === G.crag)) continue;
      const len = tiles.length;
      const idx = len <= 6 ? Math.floor(len / 2) : 3 + rng.int(len - 5);
      const centre = tiles[idx] ?? 0;
      for (let d = 0; d < 9; d++) {
        const dx = (d % 3) - 1;
        const dy = Math.floor(d / 3) - 1;
        const x = (centre % side) + dx;
        const y = Math.floor(centre / side) + dy;
        if (x < 0 || y < 0 || x >= side || y >= side) continue;
        const k = y * side + x;
        if (edge(realm, k)) continue;
        put(realm, k, G.knoll);
      }
    }
  }
}

function wall(realm: Realm, k: number): void {
  if (edge(realm, k)) return;
  put(realm, k, G.crag);
}

/**
 * Warren (03 section 9.1): all tiles crag; chambers are random walks over Parcels from five
 * anchors (four inset corners and the centre), joined by 3-wide tunnels; then random carving
 * walks turn rock into highloam. Carving stalls at walkable tiles, so caverns stay ragged.
 */
export function layoutWarren(realm: Realm, rng: Rng): void {
  const side = realm.side;
  const n = side / PARCEL;
  for (let k = 0; k < realm.tileCount; k++) if (!edge(realm, k)) put(realm, k, G.crag);

  const off = Math.floor(n / 10) + 1;
  const anchors: [number, number][] = [
    [off, off],
    [n - 1 - off, off],
    [n - 1 - off, n - 1 - off],
    [off, n - 1 - off],
    [Math.floor(n / 2), Math.floor(n / 2)],
  ];
  const chambers: number[] = [];
  const paintParcel = (p: number): void => {
    const px0 = (p % n) * PARCEL;
    const py0 = Math.floor(p / n) * PARCEL;
    for (let y = py0; y < py0 + PARCEL; y++) {
      for (let x = px0; x < px0 + PARCEL; x++) {
        const k = y * side + x;
        if (!edge(realm, k)) put(realm, k, G.highloam);
      }
    }
  };
  const steps = Math.floor((n * n) / 10);
  for (const [ax, ay] of anchors) {
    if (ax <= 0 || ay <= 0 || ax >= n - 1 || ay >= n - 1) continue;
    for (let rep = 0; rep < 2; rep++) {
      let px = ax;
      let py = ay;
      for (let s = 0; s < steps; s++) {
        const p = py * n + px;
        paintParcel(p);
        chambers.push(p);
        const d = rng.int(4);
        const qx = px + (N4X[d] ?? 0);
        const qy = py + (N4Y[d] ?? 0);
        if (qx >= 0 && qy >= 0 && qx < n && qy < n) {
          px = qx;
          py = qy;
        }
      }
    }
  }

  const tunnelTiles: number[] = [];
  const pairs: [number, number][] = [
    [0, 1],
    [3, 2],
    [0, 3],
    [2, 1],
    [2, 0],
  ];
  for (const [a, b] of pairs) {
    const [ax, ay] = anchors[a] ?? [0, 0];
    const [bx, by] = anchors[b] ?? [0, 0];
    const x0 = ax * PARCEL + PARCEL / 2;
    const y0 = ay * PARCEL + PARCEL / 2;
    const dx = bx * PARCEL + PARCEL / 2 - x0;
    const dy = by * PARCEL + PARCEL / 2 - y0;
    const len = Math.max(Math.abs(dx), Math.abs(dy), 1);
    for (let t = 0; t <= len; t++) {
      const cx = x0 + Math.round((dx * t) / len);
      const cy = y0 + Math.round((dy * t) / len);
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const x = cx + ox;
          const y = cy + oy;
          if (x < 0 || y < 0 || x >= side || y >= side) continue;
          const k = y * side + x;
          if (edge(realm, k)) continue;
          put(realm, k, G.highloam);
          tunnelTiles.push(k);
        }
      }
    }
  }

  // Carving walks: 20 walks of 15 steps per chamber Parcel, 10 walks of 10 per tunnel tile.
  const carve = (start: number, walkSteps: number): void => {
    let cur = start;
    for (let s = 0; s < walkSteps; s++) {
      const j = n4(cur, side, rng.int(4));
      if (j < 0 || !isBlocked(realm, j)) break;
      if (!edge(realm, cur)) put(realm, cur, G.highloam);
      cur = j;
    }
  };
  for (const p of chambers) {
    const px0 = (p % n) * PARCEL;
    const py0 = Math.floor(p / n) * PARCEL;
    for (let w = 0; w < 20; w++) {
      carve((py0 + rng.int(PARCEL)) * side + px0 + rng.int(PARCEL), 15);
    }
  }
  for (const k of tunnelTiles) {
    for (let w = 0; w < 10; w++) carve(k, 10);
  }
}

/**
 * Starter volcano (03 section 8, `startVolcano`): a 6x6 molten_4 footprint centred on the
 * landmass centroid tile when it is knoll/crag/pinnacle, else on the nearest highloam tile of that
 * landmass. Returns the centre tile or -1. The volcano's emitter is not modelled (see DECISIONS.md).
 */
export function placeVolcano(realm: Realm): number {
  const side = realm.side;
  const { label, size } = landmasses(realm);
  let big = -1;
  for (let id = 0; id < size.length; id++) {
    if (big < 0 || (size[id] ?? 0) > (size[big] ?? 0)) big = id;
  }
  if (big < 0) return -1;
  let sx = 0;
  let sy = 0;
  let count = 0;
  for (let k = 0; k < realm.tileCount; k++) {
    if (label[k] !== big) continue;
    sx += k % side;
    sy += Math.floor(k / side);
    count++;
  }
  const mx = Math.round(sx / count);
  const my = Math.round(sy / count);
  let capable = -1;
  let capableD = Number.POSITIVE_INFINITY;
  let highloam = -1;
  let highD = Number.POSITIVE_INFINITY;
  for (let k = 0; k < realm.tileCount; k++) {
    if (label[k] !== big || edge(realm, k)) continue;
    const d = (k % side - mx) ** 2 + (Math.floor(k / side) - my) ** 2;
    const g = realm.ground[k] ?? 0;
    if ((g === G.knoll || g === G.crag || g === G.pinnacle) && d < capableD) {
      capable = k;
      capableD = d;
    } else if (g === G.highloam && d < highD) {
      highloam = k;
      highD = d;
    }
  }
  const centre = capable >= 0 ? capable : highloam;
  if (centre < 0) return -1;
  const cx = centre % side;
  const cy = Math.floor(centre / side);
  for (let y = cy - 2; y <= cy + 3; y++) {
    for (let x = cx - 2; x <= cx + 3; x++) {
      if (x <= 0 || y <= 0 || x >= side - 1 || y >= side - 1) continue;
      const k = y * side + x;
      realm.setGround(k, G.molten_4);
      realm.setCover(k, 0);
    }
  }
  return centre;
}
