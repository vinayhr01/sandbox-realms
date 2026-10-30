/**
 * The elevation mirror of the realm for the 3D view. The terrain texture rows (`applyRows` in render/terrain.ts) carry
 * R ground, G cover, B elevation, A flags per tile; this keeps the four planes as typed arrays so picking and meshes can
 * read heights without touching the GPU. Pure: no three.js.
 */
import type { FrameRows } from '../shared/protocol.ts';

/** World units per elevation unit: 0..255 spans about 10.2 tiles (20 m). */
export const ELEV_SCALE = 0.04;

export class HeightField {
  side: number;
  ground: Uint8Array;
  cover: Uint8Array;
  elev: Uint8Array;
  flags: Uint8Array;

  constructor(side: number) {
    this.side = side;
    const n = side * side;
    this.ground = new Uint8Array(n);
    this.cover = new Uint8Array(n);
    this.elev = new Uint8Array(n);
    this.flags = new Uint8Array(n);
  }

  /** Starts over for a realm of another size (every plane is zeroed). */
  reset(side: number): void {
    this.side = side;
    const n = side * side;
    this.ground = new Uint8Array(n);
    this.cover = new Uint8Array(n);
    this.elev = new Uint8Array(n);
    this.flags = new Uint8Array(n);
  }

  /**
   * Copies rows y0..y1 (RGBA, `side * 4` bytes each) into the planes. Returns the row indices whose tiles actually
   * changed, so the layers rebuild only those.
   */
  applyRows(rows: FrameRows): Set<number> {
    const side = this.side;
    const dirty = new Set<number>();
    const rowBytes = side * 4;
    for (let y = rows.y0; y <= rows.y1; y++) {
      if (y < 0 || y >= side) continue;
      const src = (y - rows.y0) * rowBytes;
      let changed = false;
      for (let x = 0; x < side; x++) {
        const s = src + x * 4;
        const d = y * side + x;
        const g = rows.data[s] ?? 0;
        const c = rows.data[s + 1] ?? 0;
        const e = rows.data[s + 2] ?? 0;
        const f = rows.data[s + 3] ?? 0;
        if (this.ground[d] !== g || this.cover[d] !== c || this.elev[d] !== e || this.flags[d] !== f) {
          changed = true;
          this.ground[d] = g;
          this.cover[d] = c;
          this.elev[d] = e;
          this.flags[d] = f;
        }
      }
      if (changed) dirty.add(y);
    }
    return dirty;
  }

  /**
   * World height at a tile-space point, bilinear between tile centres (tile (i, j) is centred on (i + 0.5, j + 0.5)).
   * Points outside the map clamp to the edge.
   */
  heightAt(x: number, y: number): number {
    const s = this.side;
    if (s === 0) return 0;
    const gx = clamp(x - 0.5, 0, s - 1);
    const gy = clamp(y - 0.5, 0, s - 1);
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const x1 = Math.min(x0 + 1, s - 1);
    const y1 = Math.min(y0 + 1, s - 1);
    const fx = gx - x0;
    const fy = gy - y0;
    const e00 = this.elev[y0 * s + x0] ?? 0;
    const e10 = this.elev[y0 * s + x1] ?? 0;
    const e01 = this.elev[y1 * s + x0] ?? 0;
    const e11 = this.elev[y1 * s + x1] ?? 0;
    const top = e00 + (e10 - e00) * fx;
    const bottom = e01 + (e11 - e01) * fx;
    return (top + (bottom - top) * fy) * ELEV_SCALE;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
