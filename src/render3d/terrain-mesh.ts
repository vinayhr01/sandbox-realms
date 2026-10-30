/**
 * Pure geometry for the 3D terrain: chunk meshes built from the height field, the level-of-detail rule and the water
 * surface rule. No three.js here, so the builders are unit-tested in node.
 *
 * Vertices sit on tile corners. World x is the tile x corner, world z is the tile y corner, world y is the height. A
 * vertex's height is the mean of the heights of the tiles that touch it, and its colour is the mean of their colours.
 */
import { GROUNDS } from '../content/grounds.ts';
import type { HeightField } from './heights.ts';

/** Tiles per chunk side. */
export const CHUNK = 32;

/** Fallback colour for a ground id outside the table: mid grey, linear. */
const FALLBACK_LINEAR: readonly [number, number, number] = [0.2, 0.2, 0.2];

/** Ground colour in linear RGB (vertex colours are linear). Indexed by ground id. */
const GROUND_LINEAR: readonly (readonly [number, number, number])[] = GROUNDS.map((g) => hexToLinear(parseInt(g.color.slice(1), 16)));

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

export interface ChunkGeometry {
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

/**
 * Builds one chunk of the terrain at a level of detail `step` (every step-th tile corner becomes a vertex). Chunks at
 * the far edge of a realm that is not a multiple of CHUNK are narrower.
 */
export function buildChunk(field: HeightField, cx: number, cy: number, step: 1 | 2 | 4): ChunkGeometry {
  const side = field.side;
  const x0 = cx * CHUNK;
  const y0 = cy * CHUNK;
  const wTiles = Math.max(0, Math.min(CHUNK, side - x0));
  const hTiles = Math.max(0, Math.min(CHUNK, side - y0));
  const nx = Math.ceil(wTiles / step);
  const nz = Math.ceil(hTiles / step);
  const vx = nx + 1;
  const vz = nz + 1;
  const positions = new Float32Array(vx * vz * 3);
  const colors = new Float32Array(vx * vz * 3);
  const indices = new Uint32Array(nx * nz * 6);

  for (let j = 0; j < vz; j++) {
    const cornerY = y0 + Math.min(j * step, hTiles);
    for (let i = 0; i < vx; i++) {
      const cornerX = x0 + Math.min(i * step, wTiles);
      let hSum = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let ty = cornerY - 1; ty <= cornerY; ty++) {
        if (ty < 0 || ty >= side) continue;
        for (let tx = cornerX - 1; tx <= cornerX; tx++) {
          if (tx < 0 || tx >= side) continue;
          hSum += field.heightAt(tx + 0.5, ty + 0.5);
          const [cr, cg, cb] = groundLinear(field.ground[ty * side + tx] ?? 0);
          r += cr;
          g += cg;
          b += cb;
          n++;
        }
      }
      const v = (j * vx + i) * 3;
      positions[v] = cornerX;
      positions[v + 1] = n > 0 ? hSum / n : 0;
      positions[v + 2] = cornerY;
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
  return { positions, colors, indices };
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
