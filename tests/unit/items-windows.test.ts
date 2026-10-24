import { describe, expect, it } from 'vitest';
import { itemRowsOf } from '../../src/ui/specWindows.ts';
import type { ItemRow, Snapshot } from '../../src/shared/protocol.ts';

function row(over: Partial<ItemRow>): ItemRow {
  return {
    id: 1,
    kind: 'iron_blade',
    name: 'Iron blade',
    slot: 'weapon',
    group: 'blade',
    quality: 1,
    value: 30,
    durability: 100,
    mods: [],
    holder: 'worn',
    at: 3,
    favourite: false,
    ...over,
  };
}

function snapWith(rows: ItemRow[]): Snapshot {
  return { items: { count: rows.length, equipped: rows.length, stored: 0, rows, gear: [], rain: [] } } as unknown as Snapshot;
}

describe('item windows rows', () => {
  it('lists favourites first, then the other items, each opening its inspector', () => {
    const rows = itemRowsOf(snapWith([row({ id: 1 }), row({ id: 2, favourite: true, name: 'Steel helm', kind: 'steel_helm', slot: 'helm' })]));
    expect(rows.map((r) => r.id)).toEqual([2, 1]);
    expect(rows[0]?.inspector).toBe('win_item');
    expect(rows[0]?.params).toEqual({ id: 2 });
    expect(rows[0]?.detail.startsWith('Favourite')).toBe(true);
  });

  it('is empty before any item exists', () => {
    expect(itemRowsOf({ items: undefined } as unknown as Snapshot)).toEqual([]);
  });
});
