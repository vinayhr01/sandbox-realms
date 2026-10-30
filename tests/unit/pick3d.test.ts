import { describe, expect, it } from 'vitest';
import { HeightField } from '../../src/render3d/heights.ts';
import { pickTile } from '../../src/render3d/pick.ts';

/** A side x side field; elev is a constant or a per-tile function. */
function field(side: number, elev: number | ((x: number, y: number) => number)): HeightField {
  const f = new HeightField(side);
  const data = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      data[(y * side + x) * 4 + 2] = typeof elev === 'number' ? elev : elev(x, y);
    }
  }
  f.applyRows({ y0: 0, y1: side - 1, data });
  return f;
}

describe('pickTile', () => {
  it('picks the floored tile straight down on a flat field', () => {
    const f = field(64, 100);
    expect(pickTile([10.5, 50, 20.5], [0, -1, 0], f)).toEqual({ x: 10, y: 20 });
  });

  it('returns null for a sky ray', () => {
    const f = field(64, 100);
    expect(pickTile([10.5, 50, 20.5], [0, 1, 0], f)).toBeNull();
  });

  it('returns null for a ray that leaves the map edge without hitting', () => {
    const f = field(64, 100);
    expect(pickTile([60.5, 10, 20.5], [1, 0, 0], f)).toBeNull();
  });

  it('hits the cliff tile, never a tile behind it', () => {
    // Tiles x 0..4 at elev 0, tile x 5 and beyond at elev 255 (a 10.2-world-unit cliff).
    const f = field(64, (x) => (x >= 5 ? 255 : 0));
    expect(pickTile([0.5, 9, 5.5], [1, 0, 0], f)).toEqual({ x: 5, y: 5 });
  });

  it('returns null for a zero direction', () => {
    expect(pickTile([1, 1, 1], [0, 0, 0], field(8, 0))).toBeNull();
  });
});
