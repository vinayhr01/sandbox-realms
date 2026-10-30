/**
 * Per-tile water: one flat quad on each water tile of a chunk, at the tile's water surface (terrain-mesh.ts). Pure
 * geometry; the Terrain3D layer wraps it in a transparent mesh.
 */
import { CHUNK, groundLinear, waterSurface } from './terrain-mesh.ts';
import type { HeightField } from './heights.ts';

export interface WaterGeometry {
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

/** The water quads of one chunk, or null when the chunk has no water. */
export function buildWaterChunk(field: HeightField, cx: number, cy: number): WaterGeometry | null {
  const side = field.side;
  const x0 = cx * CHUNK;
  const y0 = cy * CHUNK;
  const x1 = Math.min(side, x0 + CHUNK);
  const y1 = Math.min(side, y0 + CHUNK);
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const h = waterSurface(field, x, y);
      if (h === null) continue;
      const [r, g, b] = groundLinear(field.ground[y * side + x] ?? 0);
      const base = pos.length / 3;
      // Corners in order: (x, y), (x + 1, y), (x, y + 1), (x + 1, y + 1).
      pos.push(x, h, y, x + 1, h, y, x, h, y + 1, x + 1, h, y + 1);
      for (let k = 0; k < 4; k++) col.push(r, g, b);
      // Same winding as the land mesh: normals point up.
      idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }
  if (idx.length === 0) return null;
  return {
    positions: new Float32Array(pos),
    colors: new Float32Array(col),
    indices: new Uint32Array(idx),
  };
}
