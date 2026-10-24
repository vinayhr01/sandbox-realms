/**
 * Read-only item summary for the snapshot (13 section 7.1: the items windows read it). Writes nothing
 * and draws no randomness, so the state hash and the golden replay are unaffected.
 */
import { ITEM_KIND_BY_ID, ITEM_MOD_BY_ID, ITEM_SLOTS } from '../../content/items.ts';
import { MAX_BEINGS } from '../beings/store.ts';
import type { GearRow, ItemBlock, ItemRow } from '../../shared/protocol.ts';
import type { Sim } from '../sim.ts';
import { qualityOf, valueOf, type ItemInstance } from './store.ts';

/** Rows of items and of gear sent per snapshot. The totals stay exact. */
export const ITEM_ROW_CAP = 24;

function rowOf(sim: Sim, inst: ItemInstance): ItemRow | null {
  const kind = ITEM_KIND_BY_ID.get(inst.kind);
  if (!kind) return null;
  const h = inst.holder;
  let holder: ItemRow['holder'] = 'none';
  let at = -1;
  if (h.kind === 'being') {
    holder = 'worn';
    at = h.gen * MAX_BEINGS + h.slot;
  } else if (h.kind === 'hamlet') {
    holder = 'stock';
    at = h.hamlet;
  }
  return {
    id: inst.id,
    kind: kind.id,
    name: kind.name,
    slot: kind.slot,
    group: kind.group,
    quality: qualityOf(inst),
    value: valueOf(inst),
    durability: inst.durability,
    mods: inst.mods.map((id) => ITEM_MOD_BY_ID.get(id)?.name ?? id),
    holder,
    at,
    favourite: inst.favourite,
  };
}

/** Items block of the snapshot: exact totals, favourites first, then worn and stored, capped at ITEM_ROW_CAP. */
export function itemsOf(sim: Sim): ItemBlock {
  const store = sim.items;
  const s = sim.beings.store;
  const gear: GearRow[] = [];
  let equipped = 0;
  for (const slot of [...store.geared].sort((a, b) => a - b)) {
    if (!s.isCurrent(slot, store.gearGen[slot] ?? 0)) continue;
    const worn = store.wornBy(slot);
    equipped += worn.filter((id) => id > 0).length;
    if (gear.length < ITEM_ROW_CAP) {
      gear.push({ being: (store.gearGen[slot] ?? 0) * MAX_BEINGS + slot, kinds: ITEM_SLOTS.map((_, k) => store.kindOf(worn[k] ?? 0)?.id ?? '') });
    }
  }
  let stored = 0;
  for (const lists of store.stock.values()) for (const list of lists) stored += list.length;
  const all = [...store.items.values()];
  const rank = (inst: ItemInstance): number => (inst.favourite ? 0 : inst.holder.kind === 'being' ? 1 : inst.holder.kind === 'hamlet' ? 2 : 3);
  all.sort((a, b) => rank(a) - rank(b) || a.id - b.id);
  const rows: ItemRow[] = [];
  for (const inst of all) {
    if (rows.length >= ITEM_ROW_CAP) break;
    const row = rowOf(sim, inst);
    if (row) rows.push(row);
  }
  return { count: store.items.size, equipped, stored, rows, gear, rain: [...store.rain] };
}
