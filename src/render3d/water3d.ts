/**
 * Water in 3D. Two kinds:
 *
 * - Per-tile water: one flat quad on each water tile of a chunk, at the tile's water surface (terrain-mesh.ts). Molten
 *   and slime tiles are marked to glow. Pure geometry; the Terrain3D layer wraps it in a transparent mesh.
 * - The sea mirror: one three.js `Water` (planar reflection) over every sea tile of the realm. Its geometry is built
 *   here, relative to one plane (the lowest sea surface), and its normal map is generated on a canvas at run time.
 *
 * Only the pure builders are unit-tested in node; the canvas and the texture wrap need a browser.
 */
import * as THREE from 'three';
import { GROUNDS } from '../content/grounds.ts';
import { CHUNK, groundLinear, waterSurface } from './terrain-mesh.ts';
import type { HeightField } from './heights.ts';

/** The sea mirror's reflection texture, in pixels a side. */
export const SEA_MIRROR_PX = 512;
/** The normal map's size in pixels a side. It tiles. */
export const WATER_NORMAL_PX = 256;

export interface WaterGeometry {
  positions: Float32Array;
  colors: Float32Array;
  /** 1 on a molten or slime tile (it glows), 0 on water. One per vertex. */
  glow: Float32Array;
  indices: Uint32Array;
}

export interface WaterChunkOptions {
  /** Leave out the sea tiles, which the sea mirror draws instead. */
  skipSea?: boolean;
}

export interface SeaSurface {
  /** Quads of every sea tile, y relative to `planeY`. */
  positions: Float32Array;
  indices: Uint32Array;
  /** World height of the mirror plane: the lowest sea surface. */
  planeY: number;
}

const GLOW_LAYERS: ReadonlySet<string> = new Set(['molten', 'slime']);

function isSea(field: HeightField, x: number, y: number): boolean {
  const g = field.ground[y * field.side + x];
  return g !== undefined && (GROUNDS[g]?.sea ?? false);
}

/** The water quads of one chunk, or null when the chunk has no water to draw. */
export function buildWaterChunk(field: HeightField, cx: number, cy: number, opts: WaterChunkOptions = {}): WaterGeometry | null {
  const side = field.side;
  const x0 = cx * CHUNK;
  const y0 = cy * CHUNK;
  const x1 = Math.min(side, x0 + CHUNK);
  const y1 = Math.min(side, y0 + CHUNK);
  const pos: number[] = [];
  const col: number[] = [];
  const glow: number[] = [];
  const idx: number[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (opts.skipSea && isSea(field, x, y)) continue;
      const h = waterSurface(field, x, y);
      if (h === null) continue;
      const g = field.ground[y * side + x] ?? 0;
      const [r, gg, b] = groundLinear(g);
      const glowing = GLOW_LAYERS.has(GROUNDS[g]?.layer ?? '') ? 1 : 0;
      const base = pos.length / 3;
      // Corners in order: (x, y), (x + 1, y), (x, y + 1), (x + 1, y + 1).
      pos.push(x, h, y, x + 1, h, y, x, h, y + 1, x + 1, h, y + 1);
      for (let k = 0; k < 4; k++) {
        col.push(r, gg, b);
        glow.push(glowing);
      }
      // Same winding as the land mesh: normals point up.
      idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }
  if (idx.length === 0) return null;
  return {
    positions: new Float32Array(pos),
    colors: new Float32Array(col),
    glow: new Float32Array(glow),
    indices: new Uint32Array(idx),
  };
}

/**
 * The sea mirror's geometry: a quad on every sea tile of the realm, at its own surface height, relative to the lowest
 * one. Null when the realm has no sea, which means no mirror at all.
 */
export function buildSeaGeometry(field: HeightField): SeaSurface | null {
  const side = field.side;
  const tiles: { x: number; y: number; h: number }[] = [];
  let planeY = Infinity;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      if (!isSea(field, x, y)) continue;
      const h = waterSurface(field, x, y);
      if (h === null) continue;
      tiles.push({ x, y, h });
      planeY = Math.min(planeY, h);
    }
  }
  if (tiles.length === 0) return null;
  const positions = new Float32Array(tiles.length * 12);
  const indices = new Uint32Array(tiles.length * 6);
  tiles.forEach((t, n) => {
    const b = n * 4;
    const dy = t.h - planeY;
    const p = n * 12;
    positions.set([t.x, dy, t.y, t.x + 1, dy, t.y, t.x, dy, t.y + 1, t.x + 1, dy, t.y + 1], p);
    indices.set([b, b + 2, b + 1, b + 1, b + 2, b + 3], n * 6);
  });
  return { positions, indices, planeY };
}

/** Deterministic hash of a lattice point to [0, 1). */
function lattice(ix: number, iy: number, cells: number): number {
  const x = ((ix % cells) + cells) % cells;
  const y = ((iy % cells) + cells) % cells;
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y + 0x165667b1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca77);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae3d);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Periodic value noise at a pixel: `cells` lattice cells across the tile, smoothly interpolated. */
function valueNoise(x: number, y: number, size: number, cells: number): number {
  const s = size / cells;
  const fx = x / s;
  const fy = y / s;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = lattice(ix, iy, cells);
  const b = lattice(ix + 1, iy, cells);
  const c = lattice(ix, iy + 1, cells);
  const d = lattice(ix + 1, iy + 1, cells);
  const top = a + (b - a) * sx;
  const bottom = c + (d - c) * sx;
  return top + (bottom - top) * sy;
}

/**
 * RGBA pixels of a tiling normal map of wavy water: three octaves of periodic value noise turned into normals by
 * central differences. Alpha is 255. Pure, so it runs in node.
 */
export function waterNormalPixels(size: number): Uint8ClampedArray {
  const height = new Float32Array(size * size);
  const octaves: readonly [number, number][] = [
    [4, 0.5],
    [8, 0.3],
    [16, 0.2],
  ];
  for (const [cells, weight] of octaves) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) height[y * size + x]! += weight * valueNoise(x, y, size, cells);
    }
  }
  const strength = size / 16;
  const out = new Uint8ClampedArray(size * size * 4);
  const at = (x: number, y: number): number => height[((y + size) % size) * size + ((x + size) % size)]!;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const o = (y * size + x) * 4;
      out[o] = Math.round((-dx / len) * 127.5 + 127.5);
      out[o + 1] = Math.round((-dy / len) * 127.5 + 127.5);
      out[o + 2] = Math.round((1 / len) * 127.5 + 127.5);
      out[o + 3] = 255;
    }
  }
  return out;
}

/**
 * The sea's normal map as a texture: drawn on a canvas in the browser, or kept as pixels where there is no DOM (node
 * tests). Repeats, so one small tile covers the sea.
 */
export function makeWaterNormalTexture(size: number = WATER_NORMAL_PX): THREE.Texture {
  const px = waterNormalPixels(size);
  let tex: THREE.Texture;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(px), size, size), 0, 0);
    tex = new THREE.CanvasTexture(canvas);
  } else {
    tex = new THREE.DataTexture(new Uint8Array(px), size, size);
    tex.needsUpdate = true;
  }
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
