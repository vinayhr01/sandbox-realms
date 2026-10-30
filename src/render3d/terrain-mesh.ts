/**
 * Pure geometry for the 3D terrain: chunk meshes built from the height field, the level-of-detail rule and the water
 * surface rule. No three.js here, so the builders are unit-tested in node.
 *
 * Vertices sit on tile corners. World x is the tile x corner, world z is the tile y corner, world y is the height. A
 * vertex's height is the mean of the heights of the tiles that touch it, and its colour is the mean of their colours.
 * A fine chunk (near the camera) puts a vertex every half tile, between the corners; those take the height and colour
 * of the tile they sit in. Each chunk edge gets a skirt: a copy of the edge hanging SKIRT_DROP below it, which hides
 * the cracks where two chunks of different detail meet.
 */
import { BIOMES, biomeOfCover } from '../content/biomes.ts';
import { GROUNDS } from '../content/grounds.ts';
import type { HeightField } from './heights.ts';

/** Tiles per chunk side. */
export const CHUNK = 32;
/** How far a chunk-edge skirt hangs below its edge, in world units. */
export const SKIRT_DROP = 1.2;
/** Brightness jitter per tile, either side of 1. Big areas of one ground don't look flat. */
const JITTER = 0.04;

/** Fallback colour for a ground id outside the table: mid grey, linear. */
const FALLBACK_LINEAR: readonly [number, number, number] = [0.2, 0.2, 0.2];

/** Ground colour in linear RGB (vertex colours are linear). Indexed by ground id. */
const GROUND_LINEAR: readonly (readonly [number, number, number])[] = GROUNDS.map((g) => hexToLinear(parseInt(g.color.slice(1), 16)));

/** Biome families that tint the ground. Multipliers in linear RGB; saturation rises slightly. */
const FOREST_BIOMES: ReadonlySet<string> = new Set(['steamthicket', 'gleamwood', 'bambooveil', 'citrusdell', 'russetwood']);
const GRASS_BIOMES: ReadonlySet<string> = new Set(['verdant_reach', 'paleglen', 'bloomfield', 'trefoil_lea', 'heathermoor']);
const CROP_BIOMES: ReadonlySet<string> = new Set(['amberveldt']);
const TINT_FOREST: readonly [number, number, number] = [0.82, 0.98, 0.74];
const TINT_GRASS: readonly [number, number, number] = [0.96, 1.04, 0.84];
const TINT_CROP: readonly [number, number, number] = [1.08, 1.0, 0.8];
const TINT_NONE: readonly [number, number, number] = [1, 1, 1];

/** sRGB hex to linear RGB components. Exported for the water and insight colours. */
export function hexToLinear(hex: number): [number, number, number] {
  return [srgbChannel((hex >> 16) & 0xff), srgbChannel((hex >> 8) & 0xff), srgbChannel(hex & 0xff)];
}

function srgbChannel(byte: number): number {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Linear RGB of a ground id, or the fallback when the id is outside the table. */
export function groundLinear(ground: number): readonly [number, number, number] {
  return GROUND_LINEAR[ground] ?? FALLBACK_LINEAR;
}

/** Linear RGB multiplier of a cover id: forest and grass biomes and crops tint the ground; bare and other covers do not. */
export function coverTint(cover: number): readonly [number, number, number] {
  const idx = biomeOfCover(cover);
  const id = idx < 0 ? '' : (BIOMES[idx]?.id ?? '');
  if (FOREST_BIOMES.has(id)) return TINT_FOREST;
  if (GRASS_BIOMES.has(id)) return TINT_GRASS;
  if (CROP_BIOMES.has(id)) return TINT_CROP;
  return TINT_NONE;
}

/** A deterministic brightness offset in [-JITTER, JITTER) for a tile, from a integer hash of its position. */
export function tileJitter(x: number, y: number): number {
  let h = Math.imul(x, 0x9e3779b1) ^ Math.imul(y + 0x7f4a7c15, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  const u = (h >>> 0) / 4294967296;
  return (u * 2 - 1) * JITTER;
}

/** Linear RGB of one tile: its ground colour times its cover tint times its jitter. */
export function tileColour(field: HeightField, tx: number, ty: number): [number, number, number] {
  const i = ty * field.side + tx;
  const [r, g, b] = groundLinear(field.ground[i] ?? 0);
  const [tr, tg, tb] = coverTint(field.cover[i] ?? 0);
  const k = 1 + tileJitter(tx, ty);
  return [r * tr * k, g * tg * k, b * tb * k];
}

export interface ChunkGeometry {
  positions: Float32Array;
  colors: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export interface ChunkOptions {
  /** Near chunks: a vertex every half tile instead of every `step` tiles. */
  fine?: boolean;
}

/** The tiles a corner coordinate touches: its two neighbours on a whole number, or the one tile it sits in. */
function touching(p: number, side: number): number[] {
  const list = Number.isInteger(p) ? [p - 1, p] : [Math.floor(p)];
  return list.filter((t) => t >= 0 && t < side);
}

/**
 * Builds one chunk of the terrain at a level of detail `step` (every step-th tile corner becomes a vertex, or every
 * half tile when `fine`). Chunks at the far edge of a realm that is not a multiple of CHUNK are narrower. The grid is
 * followed by four skirts, one per edge, each a copy of its edge hanging SKIRT_DROP lower.
 */
export function buildChunk(field: HeightField, cx: number, cy: number, step: 1 | 2 | 4, opts: ChunkOptions = {}): ChunkGeometry {
  const side = field.side;
  const x0 = cx * CHUNK;
  const y0 = cy * CHUNK;
  const wTiles = Math.max(0, Math.min(CHUNK, side - x0));
  const hTiles = Math.max(0, Math.min(CHUNK, side - y0));
  const spacing = opts.fine ? step / 2 : step;
  const nx = Math.ceil(wTiles / spacing);
  const nz = Math.ceil(hTiles / spacing);
  const vx = nx + 1;
  const vz = nz + 1;
  const grid = vx * vz;
  const total = grid + 2 * (vx + vz);
  const positions = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  const indices = new Uint32Array(nx * nz * 6 + 12 * (nx + nz));

  for (let j = 0; j < vz; j++) {
    const cornerY = y0 + Math.min(j * spacing, hTiles);
    for (let i = 0; i < vx; i++) {
      const cornerX = x0 + Math.min(i * spacing, wTiles);
      const v = (j * vx + i) * 3;
      positions[v] = cornerX;
      positions[v + 2] = cornerY;
      const xs = touching(cornerX, side);
      const ys = touching(cornerY, side);
      const exact = Number.isInteger(cornerX) && Number.isInteger(cornerY);
      let hSum = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (const ty of ys) {
        for (const tx of xs) {
          if (exact) hSum += field.heightAt(tx + 0.5, ty + 0.5);
          const [cr, cg, cb] = tileColour(field, tx, ty);
          r += cr;
          g += cg;
          b += cb;
          n++;
        }
      }
      positions[v + 1] = exact ? (n > 0 ? hSum / n : 0) : field.heightAt(cornerX, cornerY);
      colors[v] = n > 0 ? r / n : 0;
      colors[v + 1] = n > 0 ? g / n : 0;
      colors[v + 2] = n > 0 ? b / n : 0;
    }
  }

  let k = 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * vx + i;
      const b = a + 1;
      const c = a + vx;
      const d = c + 1;
      indices[k++] = a;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = d;
    }
  }
  // Normals come from the grid only, so the skirts don't bend the shading at the edges.
  accumulateNormals(positions, indices.subarray(0, nx * nz * 6), normals);

  // Skirts: copies of the four edges, hanging down, joined to the edge by two triangles per segment.
  let next = grid;
  const edges: { verts: number[]; out: [number, number, number] }[] = [];
  const top: number[] = [];
  const bottom: number[] = [];
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < vx; i++) {
    top.push(i);
    bottom.push((vz - 1) * vx + i);
  }
  for (let j = 0; j < vz; j++) {
    left.push(j * vx);
    right.push(j * vx + vx - 1);
  }
  edges.push({ verts: top, out: [0, 0, -1] }, { verts: bottom, out: [0, 0, 1] }, { verts: left, out: [-1, 0, 0] }, { verts: right, out: [1, 0, 0] });
  let t = nx * nz * 6;
  for (const edge of edges) {
    const copies: number[] = [];
    for (const src of edge.verts) {
      const dst = next++;
      copies.push(dst);
      positions[dst * 3] = positions[src * 3]!;
      positions[dst * 3 + 1] = positions[src * 3 + 1]! - SKIRT_DROP;
      positions[dst * 3 + 2] = positions[src * 3 + 2]!;
      for (let c = 0; c < 3; c++) {
        colors[dst * 3 + c] = colors[src * 3 + c]!;
        normals[dst * 3 + c] = normals[src * 3 + c]!;
      }
    }
    for (let s = 0; s + 1 < edge.verts.length; s++) {
      const a = edge.verts[s]!;
      const b = edge.verts[s + 1]!;
      const al = copies[s]!;
      const bl = copies[s + 1]!;
      t = pushOriented(positions, indices, t, a, al, b, edge.out);
      t = pushOriented(positions, indices, t, b, al, bl, edge.out);
    }
  }
  return { positions, colors, normals, indices };
}

/** Writes one triangle, wound so its normal faces `out`. Returns the next free index slot. */
function pushOriented(pos: Float32Array, idx: Uint32Array, at: number, a: number, b: number, c: number, out: readonly [number, number, number]): number {
  const n = triNormal(pos, a, b, c);
  const facing = n[0] * out[0] + n[1] * out[1] + n[2] * out[2];
  idx[at] = a;
  idx[at + 1] = facing >= 0 ? b : c;
  idx[at + 2] = facing >= 0 ? c : b;
  return at + 3;
}

/** Unnormalised normal of the triangle (a, b, c), by the same winding as the grid: (b - a) x (c - a). */
function triNormal(pos: Float32Array, a: number, b: number, c: number): [number, number, number] {
  const ax = pos[a * 3]!;
  const ay = pos[a * 3 + 1]!;
  const az = pos[a * 3 + 2]!;
  const e1x = pos[b * 3]! - ax;
  const e1y = pos[b * 3 + 1]! - ay;
  const e1z = pos[b * 3 + 2]! - az;
  const e2x = pos[c * 3]! - ax;
  const e2y = pos[c * 3 + 1]! - ay;
  const e2z = pos[c * 3 + 2]! - az;
  return [e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x];
}

/** Adds each triangle's area-weighted normal to its three vertices, then normalises (flat areas point up). */
function accumulateNormals(pos: Float32Array, idx: Uint32Array, out: Float32Array): void {
  for (let t = 0; t + 2 < idx.length; t += 3) {
    // The face normal in stored index order: the grid stores (a, c, b), which faces up.
    const n = triNormal(pos, idx[t]!, idx[t + 1]!, idx[t + 2]!);
    for (const v of [idx[t]!, idx[t + 1]!, idx[t + 2]!]) {
      out[v * 3] = out[v * 3]! + n[0];
      out[v * 3 + 1] = out[v * 3 + 1]! + n[1];
      out[v * 3 + 2] = out[v * 3 + 2]! + n[2];
    }
  }
  for (let v = 0; v < out.length; v += 3) {
    const x = out[v]!;
    const y = out[v + 1]!;
    const z = out[v + 2]!;
    const len = Math.hypot(x, y, z);
    if (len > 0) {
      out[v] = x / len;
      out[v + 1] = y / len;
      out[v + 2] = z / len;
    } else {
      out[v] = 0;
      out[v + 1] = 1;
      out[v + 2] = 0;
    }
  }
}

/** Level of detail by distance in tiles: full detail near, every 2nd corner mid range, every 4th far. */
export function chunkLod(distanceTiles: number): 1 | 2 | 4 {
  if (distanceTiles < 48) return 1;
  if (distanceTiles < 128) return 2;
  return 4;
}

/** Ground layers that get a water surface: water and sea, molten and slime. */
const SURFACE_LAYERS: ReadonlySet<string> = new Set(['water', 'molten', 'slime']);

/** Water surface height of a tile, or null when the tile has no surface. */
export function waterSurface(field: HeightField, x: number, y: number): number | null {
  const s = field.side;
  if (x < 0 || y < 0 || x >= s || y >= s) return null;
  const g = field.ground[y * s + x];
  if (g === undefined) return null;
  const kind = GROUNDS[g];
  if (!kind) return null;
  if (!SURFACE_LAYERS.has(kind.layer) && !kind.sea) return null;
  return field.heightAt(x + 0.5, y + 0.5) + 0.02;
}
