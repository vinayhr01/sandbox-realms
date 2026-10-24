import type { BrushShape } from '../shared/protocol.ts';
import type { Realm } from './realm.ts';

/** Elevation change per brush dab (TUNE): a size-16 circle reaches terminal height in about 3 s held. */
export const RAISE_STEP = 5;
/** Largest brush radius the UI offers and the sim accepts (01/04 section 1.1 range, trimmed). */
export const MAX_BRUSH_RADIUS = 16;

export interface Offset {
  dx: number;
  dy: number;
}

const cache = new Map<string, readonly Offset[]>();

/**
 * Offsets covered by a brush of `radius` tiles, row-major, centre first (04 section 1.1).
 * Cached per (shape, radius); the returned array must not be mutated.
 */
export function brushOffsets(shape: BrushShape, radius: number): readonly Offset[] {
  const r = clampRadius(radius);
  const key = `${shape}:${r}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const out: Offset[] = [{ dx: 0, dy: 0 }];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (inShape(shape, dx, dy, r)) out.push({ dx, dy });
    }
  }
  cache.set(key, out);
  return out;
}

function inShape(shape: BrushShape, dx: number, dy: number, r: number): boolean {
  switch (shape) {
    case 'square':
      return Math.abs(dx) <= r && Math.abs(dy) <= r;
    case 'diamond':
      return Math.abs(dx) + Math.abs(dy) <= r;
    case 'circle':
      return dx * dx + dy * dy <= r * r + r;
  }
}

export function clampRadius(radius: number): number {
  const r = Math.round(radius);
  return r < 0 ? 0 : r > MAX_BRUSH_RADIUS ? MAX_BRUSH_RADIUS : r;
}

/**
 * Integer line between two tiles (Bresenham), both ends included. Deterministic for equal inputs.
 * Endpoints are rounded to whole tiles; a non-finite endpoint visits nothing (it would never be reached).
 */
export function lineTiles(fx0: number, fy0: number, fx1: number, fy1: number, visit: (x: number, y: number) => void): void {
  if (!Number.isFinite(fx0) || !Number.isFinite(fy0) || !Number.isFinite(fx1) || !Number.isFinite(fy1)) return;
  const x0 = Math.round(fx0);
  const y0 = Math.round(fy0);
  const x1 = Math.round(fx1);
  const y1 = Math.round(fy1);
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    visit(x, y);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/**
 * Applies one brush stroke segment: a dab at every tile of the line (x0,y0)->(x1,y1).
 * Tiles are visited in line order and offsets in row-major order, so replays match (12 section 4 step 5).
 * Returns the number of tiles changed. Set includeStart=false for continuation segments so a joint tile is not raised twice.
 */
export function applyStroke(
  realm: Realm,
  op: 'raise' | 'lower',
  shape: BrushShape,
  radius: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  includeStart: boolean,
): number {
  if (![x0, y0, x1, y1].every(Number.isFinite)) return 0;
  // Endpoints are clamped to the realm first, so a far-off stroke costs no more than an on-map one.
  const last = realm.side - 1;
  const tile = (v: number): number => Math.min(last, Math.max(0, Math.round(v)));
  const offsets = brushOffsets(shape, radius);
  const delta = op === 'raise' ? RAISE_STEP : -RAISE_STEP;
  let changed = 0;
  let first = true;
  lineTiles(tile(x0), tile(y0), tile(x1), tile(y1), (cx, cy) => {
    const skip = first && !includeStart;
    first = false;
    if (skip) return;
    for (const { dx, dy } of offsets) {
      const x = cx + dx;
      const y = cy + dy;
      if (!realm.inBounds(x, y)) continue;
      const i = y * realm.side + x;
      const before = realm.elevation[i] ?? 0;
      realm.setElevation(i, before + delta);
      if ((realm.elevation[i] ?? 0) !== before) changed++;
    }
  });
  return changed;
}
