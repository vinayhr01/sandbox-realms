/**
 * Item behaviour (08 sections 6 and 7): rolling modifiers (7.1), equipping (7.3 and the equip rule
 * of 7.4), hamlet stock lists, the item rain, the per-tick release of gear whose Being died, and
 * the Chronicle restore. Only commands and the reconcile step write item state; the sim reads it
 * through ItemStore (store.ts) for stat assembly and combat.
 */
import { ITEM_KINDS, ITEM_KIND_BY_ID, ITEM_MOD_BY_ID, ITEM_SLOTS, MOD_POOLS, type ItemKindDef, type ModPool } from '../../content/items.ts';

import type { Rng } from '../../shared/rng.ts';
import { refreshStats } from '../beings/system.ts';
import { MAX_BEINGS } from '../beings/store.ts';
import { PARCEL } from '../settlements/hamlet.ts';
import { hamletsOf } from '../settlements/adapter.ts';
import type { Sim } from '../sim.ts';
import { GEAR_SLOTS, ItemStore, STOCK_LIST_MAX, isAccursed, valueOf, type ItemInstance } from './store.ts';

/** Largest number of beings one item rain reaches (keeps the command within the tick budget). */
export const RAIN_MAX_BEINGS = 32;

const ALL_KIND_IDS: readonly string[] = ITEM_KINDS.map((k) => k.id);

/** Item rolls of 08 section 7.1 use the named stream `items`, so no other system draws from it. */
function rollRng(sim: Sim): Rng {
  return sim.rng('items');
}

/** Mod pool of a kind: weapons, armour (helm, body, boots) or accessories (ring, amulet). */
function poolOf(kind: ItemKindDef): ModPool {
  if (kind.slot === 'weapon') return 'weapon';
  return kind.slot === 'ring' || kind.slot === 'amulet' ? 'accessory' : 'armor';
}

/**
 * Generation roll (08 section 7.1): `tries` times, 50% skip, else one draw from the pool. The
 * `normal` entry wastes the draw; a family already on the item is refused. Rank is uniform 1..5.
 */
export function rollMods(rng: Rng, kind: ItemKindDef, tries: number, mods: string[]): void {
  const weights = Object.entries(MOD_POOLS[poolOf(kind)]) as [string, number][];
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  const families = new Set<string>();
  for (const id of mods) {
    const family = ITEM_MOD_BY_ID.get(id)?.family;
    if (family) families.add(family);
  }
  for (let t = 0; t < tries; t++) {
    if (rng.int(2) === 0) continue;
    let r = rng.int(total);
    let pick = 'normal';
    for (const [key, w] of weights) {
      if (r < w) {
        pick = key;
        break;
      }
      r -= w;
    }
    if (pick === 'normal' || families.has(pick)) continue;
    const rank = rng.int(5) + 1;
    const id = `${pick}_${rank}`;
    if (!ITEM_MOD_BY_ID.has(id)) continue;
    mods.push(id);
    families.add(pick);
  }
}

/** Creates an instance of a kind (not placed anywhere yet). `tries` is the generation roll count (0 for a plain kind). */
export function createItem(sim: Sim, kindId: string, tries: number): ItemInstance | null {
  const kind = ITEM_KIND_BY_ID.get(kindId);
  if (!kind) return null;
  const store = sim.items;
  const mods: string[] = [];
  if (tries > 0) rollMods(rollRng(sim), kind, tries, mods);
  for (const id of kind.modifiers) if (!mods.includes(id)) mods.push(id);
  const inst: ItemInstance = { id: store.nextId++, kind: kindId, mods, durability: kind.durability, favourite: false, holder: { kind: 'none' } };
  store.items.set(inst.id, inst);
  return inst;
}

/** Being id -> slot, or -1 when the id no longer names a living being (generation check, 17 section 4). */
export function slotOfBeing(sim: Sim, beingId: number): number {
  const slot = beingId % MAX_BEINGS;
  const gen = Math.floor(beingId / MAX_BEINGS);
  return sim.beings.store.isCurrent(slot, gen) ? slot : -1;
}

/** Hamlet index of the parcel under a tile, or -1 when no hamlet holds it. */
export function hamletAt(sim: Sim, x: number, y: number): number {
  const perAxis = Math.floor(sim.realm.side / PARCEL);
  const parcel = Math.floor(y / PARCEL) * perAxis + Math.floor(x / PARCEL);
  const hamlets = hamletsOf(sim);
  for (let h = 0; h < hamlets.length; h++) if (hamlets[h]?.parcels.has(parcel)) return h;
  return -1;
}

/** Puts a loose item into a hamlet's stock list (08 section 7.3). A full list keeps the higher-value items. */
export function stockPut(sim: Sim, inst: ItemInstance, hamlet: number): boolean {
  const store = sim.items;
  const kind = ITEM_KIND_BY_ID.get(inst.kind);
  if (!kind) return false;
  let lists = store.stock.get(hamlet);
  if (!lists) {
    lists = ITEM_SLOTS.map(() => [] as number[]);
    store.stock.set(hamlet, lists);
  }
  const list = lists[ItemStore.slotIndexOf(kind)];
  if (!list) return false;
  if (list.length < STOCK_LIST_MAX) {
    list.push(inst.id);
    inst.holder = { kind: 'hamlet', hamlet, list: ItemStore.slotIndexOf(kind) };
    return true;
  }
  // Full: the lowest-value stored item goes if this one is worth more.
  let worst = -1;
  let worstValue = Infinity;
  list.forEach((id, k) => {
    const other = store.get(id);
    const v = other ? valueOf(other) : -1;
    if (v < worstValue) {
      worstValue = v;
      worst = k;
    }
  });
  if (worst < 0 || valueOf(inst) <= worstValue) return false;
  const dropped = store.get(list[worst] ?? 0);
  if (dropped) store.items.delete(dropped.id);
  list[worst] = inst.id;
  inst.holder = { kind: 'hamlet', hamlet, list: ItemStore.slotIndexOf(kind) };
  return true;
}

/** A loose item at a tile: to the stock of the hamlet that holds the tile, else destroyed (08 section 7.3). */
function placeLoose(sim: Sim, inst: ItemInstance, x: number, y: number): void {
  const hamlet = hamletAt(sim, x, y);
  if (hamlet >= 0 && stockPut(sim, inst, hamlet)) return;
  sim.items.items.delete(inst.id);
}

/** Writes an item into a Being's equipment slot. */
export function wear(sim: Sim, slot: number, index: number, inst: ItemInstance): void {
  const store = sim.items;
  store.gear[slot * GEAR_SLOTS + index] = inst.id;
  store.gearGen[slot] = sim.beings.store.generation[slot] ?? 0;
  store.geared.add(slot);
  inst.holder = { kind: 'being', slot, gen: store.gearGen[slot] ?? 0 };
}

/** Clears one equipment slot of a Being and returns the item that was there (or undefined). */
export function unwear(sim: Sim, slot: number, index: number): ItemInstance | undefined {
  const store = sim.items;
  const id = store.gearAt(slot, index);
  if (id === 0) return undefined;
  store.gear[slot * GEAR_SLOTS + index] = 0;
  if (store.wornBy(slot).every((x) => x === 0)) store.geared.delete(slot);
  return store.get(id);
}

/**
 * Player command: sets one equipment slot of a Being to a kind (a plain item, no roll), or empties it
 * when `kindId` is null. An accursed item cannot be removed or swapped (08 section 6.3). Returns false
 * when the command is refused.
 */
export function setGear(sim: Sim, beingId: number, slotName: string, kindId: string | null): boolean {
  const slot = slotOfBeing(sim, beingId);
  const index = ItemStore.indexOfSlot(slotName);
  if (slot < 0 || index < 0) return false;
  const s = sim.beings.store;
  const current = sim.items.get(sim.items.gearAt(slot, index));
  if (current && isAccursed(current)) return false;
  if (kindId === null) {
    if (!current) return false;
    unwear(sim, slot, index);
    placeLoose(sim, current, s.x[slot] ?? 0, s.y[slot] ?? 0);
    refreshStats(sim, slot);
    return true;
  }
  const kind = ITEM_KIND_BY_ID.get(kindId);
  if (!kind || ItemStore.slotIndexOf(kind) !== index) return false;
  const inst = createItem(sim, kindId, 0);
  if (!inst) return false;
  if (current) {
    unwear(sim, slot, index);
    placeLoose(sim, current, s.x[slot] ?? 0, s.y[slot] ?? 0);
  }
  wear(sim, slot, index, inst);
  refreshStats(sim, slot);
  return true;
}

/**
 * Gives one random item from `list` (every kind when empty) to a Being (08 section 7.3 giveItem).
 * Accepted only when the slot is empty, or the new item is worth strictly more and neither is accursed;
 * otherwise the item goes to the hamlet stock. Returns true when the Being's gear changed.
 */
export function giveItem(sim: Sim, slot: number, list: readonly string[]): boolean {
  const pool = list.length > 0 ? list : ALL_KIND_IDS;
  const kindId = pool[rollRng(sim).int(pool.length)];
  if (!kindId) return false;
  const inst = createItem(sim, kindId, 1);
  const kind = ITEM_KIND_BY_ID.get(kindId);
  if (!inst || !kind) return false;
  const index = ItemStore.slotIndexOf(kind);
  const s = sim.beings.store;
  const current = sim.items.get(sim.items.gearAt(slot, index));
  if (!current) {
    wear(sim, slot, index, inst);
    return true;
  }
  if (!isAccursed(current) && !isAccursed(inst) && valueOf(inst) > valueOf(current)) {
    unwear(sim, slot, index);
    placeLoose(sim, current, s.x[slot] ?? 0, s.y[slot] ?? 0);
    wear(sim, slot, index, inst);
    return true;
  }
  placeLoose(sim, inst, s.x[slot] ?? 0, s.y[slot] ?? 0);
  return false;
}

/** Item rain command: gives an item to each living Being within `radius` tiles (Chebyshev), up to RAIN_MAX_BEINGS. */
export function itemRain(sim: Sim, x: number, y: number, radius: number): number {
  const s = sim.beings.store;
  const r = Math.max(0, Math.min(12, Math.floor(radius)));
  const reached: number[] = [];
  for (let k = 0; k < s.size && reached.length < RAIN_MAX_BEINGS; k++) {
    const slot = s.at(k);
    if (Math.max(Math.abs((s.x[slot] ?? 0) - x), Math.abs((s.y[slot] ?? 0) - y)) <= r) reached.push(slot);
  }
  let changed = 0;
  for (const slot of reached) {
    if (giveItem(sim, slot, sim.items.rain)) {
      refreshStats(sim, slot);
      changed++;
    }
  }
  return changed;
}

/** Item rain list command: keeps the known kind ids, each once, in the order given. */
export function setItemRain(sim: Sim, ids: readonly string[]): void {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const id of ids) {
    if (!ITEM_KIND_BY_ID.has(id) || seen.has(id)) continue;
    seen.add(id);
    kept.push(id);
  }
  sim.items.rain = kept;
}

/** Favourite command: marks an item (an inspector star); the sim only stores the flag. */
export function setItemFavourite(sim: Sim, itemId: number, on: boolean): void {
  const inst = sim.items.get(itemId);
  if (inst) inst.favourite = on;
}

/**
 * Per-tick step: gear whose Being died (or whose slot now holds a newer Being) goes to the stock of
 * the hamlet holding its last tile, or is destroyed. Touches only the geared slots.
 */
export function itemsStep(sim: Sim): void {
  const store = sim.items;
  if (store.geared.size === 0) return;
  const s = sim.beings.store;
  for (const slot of [...store.geared]) {
    if (s.isCurrent(slot, store.gearGen[slot] ?? 0)) continue;
    for (let index = 0; index < GEAR_SLOTS; index++) {
      const inst = unwear(sim, slot, index);
      if (inst) placeLoose(sim, inst, s.x[slot] ?? 0, s.y[slot] ?? 0);
    }
    store.geared.delete(slot);
  }
}

/** Serialisable form of the item state (Chronicle optional tag). Holders are kept on each item. */
export interface ItemSave {
  next: number;
  items: ItemInstance[];
  gear: { slot: number; gen: number; ids: number[] }[];
  stock: { hamlet: number; lists: number[][] }[];
  rain: string[];
}

export function saveItems(sim: Sim): ItemSave {
  const store = sim.items;
  return {
    next: store.nextId,
    items: [...store.items.values()].map((inst) => ({ ...inst, mods: [...inst.mods] })),
    gear: [...store.geared].map((slot) => ({ slot, gen: store.gearGen[slot] ?? 0, ids: store.wornBy(slot) })),
    stock: [...store.stock].map(([hamlet, lists]) => ({ hamlet, lists: lists.map((l) => [...l]) })),
    rain: [...store.rain],
  };
}

/**
 * Restores the item state after the Beings. Gear is kept only while its Being's generation still
 * matches; each restored Being gets its stats assembled again (08 section 6.1 via refreshStats).
 * Throws on unknown kinds or mods, so a bad save never half-applies.
 */
export function restoreItems(sim: Sim, data: ItemSave): void {
  const store = sim.items;
  if (!Array.isArray(data?.items) || !Array.isArray(data.gear) || !Array.isArray(data.stock) || !Array.isArray(data.rain)) {
    throw new Error('chronicle: items section is not valid');
  }
  for (const inst of data.items) {
    if (!ITEM_KIND_BY_ID.has(inst.kind)) throw new Error(`chronicle: unknown item kind ${inst.kind}`);
    for (const mod of inst.mods) if (!ITEM_MOD_BY_ID.has(mod)) throw new Error(`chronicle: unknown item modifier ${mod}`);
  }
  store.items.clear();
  store.geared.clear();
  store.gear.fill(0);
  store.stock.clear();
  store.nextId = Math.max(1, data.next);
  for (const inst of data.items) store.items.set(inst.id, { ...inst, mods: [...inst.mods], favourite: inst.favourite === true });
  store.rain = data.rain.filter((id) => ITEM_KIND_BY_ID.has(id));
  const s = sim.beings.store;
  for (const row of data.gear) {
    if (!s.isCurrent(row.slot, row.gen)) continue;
    let any = false;
    row.ids.forEach((id, index) => {
      if (id > 0 && store.items.has(id)) {
        store.gear[row.slot * GEAR_SLOTS + index] = id;
        any = true;
      }
    });
    if (any) {
      store.gearGen[row.slot] = row.gen;
      store.geared.add(row.slot);
      refreshStats(sim, row.slot);
    }
  }
  for (const row of data.stock) {
    const lists = ITEM_SLOTS.map((_, k) => (row.lists[k] ?? []).filter((id) => store.items.has(id)));
    store.stock.set(row.hamlet, lists);
    lists.forEach((list, k) => list.forEach((id) => {
      const inst = store.get(id);
      if (inst) inst.holder = { kind: 'hamlet', hamlet: row.hamlet, list: k };
    }));
  }
}
