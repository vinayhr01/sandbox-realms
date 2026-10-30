import { describe, expect, it } from 'vitest';
import { HeightField, ELEV_SCALE } from '../../src/render3d/heights.ts';
import type { FrameRows } from '../../src/shared/protocol.ts';

/** Packs side-wide RGBA rows y0..y1 inclusive; R ground, G cover, B elevation, A flags. */
function rowsOf(side: number, y0: number, y1: number, elev: (x: number, y: number) => number): FrameRows {
  const data = new Uint8Array((y1 - y0 + 1) * side * 4);
  for (let y = y0; y <= y1; y++) {
    for (let x = 0; x < side; x++) {
      const o = ((y - y0) * side + x) * 4;
      data[o] = 1;
      data[o + 1] = 2;
      data[o + 2] = elev(x, y);
      data[o + 3] = 0;
    }
  }
  return { y0, y1, data };
}

describe('HeightField.applyRows', () => {
  it('returns no rows when the data is unchanged', () => {
    const f = new HeightField(4);
    f.applyRows(rowsOf(4, 0, 3, () => 50));
    expect(f.applyRows(rowsOf(4, 0, 3, () => 50)).size).toBe(0);
  });

  it('returns exactly the changed row indices', () => {
    const f = new HeightField(4);
    f.applyRows(rowsOf(4, 0, 3, () => 50));
    const dirty = f.applyRows(rowsOf(4, 1, 2, (x, y) => (y === 2 && x === 3 ? 9 : 50)));
    expect([...dirty]).toEqual([2]);
    expect(f.elev[2 * 4 + 3]).toBe(9);
  });

  it('copies ground, cover, elevation and flags per tile', () => {
    const f = new HeightField(2);
    f.applyRows({ y0: 0, y1: 0, data: new Uint8Array([7, 8, 9, 10, 1, 2, 3, 4]) });
    expect([f.ground[0], f.cover[0], f.elev[0], f.flags[0]]).toEqual([7, 8, 9, 10]);
    expect([f.ground[1], f.cover[1], f.elev[1], f.flags[1]]).toEqual([1, 2, 3, 4]);
  });
});

describe('HeightField.heightAt', () => {
  it('is elev times ELEV_SCALE at a tile centre', () => {
    const f = new HeightField(4);
    f.applyRows(rowsOf(4, 0, 3, () => 100));
    expect(f.heightAt(2.5, 1.5)).toBeCloseTo(100 * ELEV_SCALE, 9);
    expect(ELEV_SCALE).toBe(0.04);
  });

  it('interpolates bilinearly between tile centres', () => {
    const f = new HeightField(4);
    f.applyRows(rowsOf(4, 0, 3, (x) => (x === 1 ? 100 : 0)));
    // x = 1.0 is halfway between the centres of tiles 0 (elev 0) and 1 (elev 100).
    expect(f.heightAt(1.0, 0.5)).toBeCloseTo(50 * ELEV_SCALE, 9);
  });

  it('clamps outside the map', () => {
    const f = new HeightField(4);
    f.applyRows(rowsOf(4, 0, 3, () => 20));
    expect(f.heightAt(-5, -5)).toBeCloseTo(20 * ELEV_SCALE, 9);
    expect(f.heightAt(99, 99)).toBeCloseTo(20 * ELEV_SCALE, 9);
  });
});
