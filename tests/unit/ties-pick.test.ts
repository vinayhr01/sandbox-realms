import { describe, expect, it } from 'vitest';
import { POWER_BY_ID } from '../../src/content/powers.ts';
import { encodeParcels } from '../../src/shared/parcel-codec.ts';
import type { MapTiles } from '../../src/shared/protocol.ts';
import { UI_HANDLERS, dominionAtTile } from '../../src/ui/powerSupport.ts';

// 12 section 8.8: the Ties select step. The pick reads the dominion owning a tapped tile (dominionAtTile). The pick and
// clear state lives in main.ts and the drawing in insight-layers.ts (DOM and pixi), so they are not tested here.

/** A 4 x 4 realm of 8-tile parcels: parcel 1 belongs to dominion 3, parcel 4 to 7, parcel 8 to 2, the rest to none. */
const TILES: MapTiles = {
  size: 8,
  perAxis: 4,
  dominion: encodeParcels([-1, 3, -1, -1, 7, -1, -1, -1, 2, -1, -1, -1, -1, -1, -1, -1]),
  hamlet: encodeParcels([]),
  groups: [],
};

describe('Ties pick: the dominion under a tapped tile (12 section 8.8)', () => {
  it('a tile inside a parcel gives the dominion of that parcel', () => {
    expect(dominionAtTile(TILES, 9, 1)).toBe(3);
    expect(dominionAtTile(TILES, 0, 8)).toBe(7);
    expect(dominionAtTile(TILES, 0, 16)).toBe(2);
  });

  it('a tile in an unowned parcel gives -1', () => {
    expect(dominionAtTile(TILES, 1, 1)).toBe(-1);
  });

  it('a tile off the realm gives -1', () => {
    expect(dominionAtTile(TILES, 32, 0)).toBe(-1);
    expect(dominionAtTile(TILES, -1, 0)).toBe(-1);
  });

  it('no map tiles in the snapshot gives -1', () => {
    expect(dominionAtTile(undefined, 9, 1)).toBe(-1);
  });
});

describe('Ties row (powers content)', () => {
  it('ins_ties arms select_dominion, and the handler is a UI handler', () => {
    expect(POWER_BY_ID.get('ins_ties')?.handler).toBe('select_dominion');
    expect(UI_HANDLERS).toContain('select_dominion');
  });
});
