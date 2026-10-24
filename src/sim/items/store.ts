/**
 * Item store (08 section 6 and 7.3): item instances, the equipment of each Being slot, the hamlet
 * stock lists and the item-rain list. Pure data plus the stat reads that assembly and combat use.
 * No Sim import and no beings import, so beings/system.ts can read it without a cycle.
 */
import { ITEM_KIND_BY_ID, ITEM_MOD_BY_ID, ITEM_SLOTS, type ItemSlot, type ItemKindDef, type ItemStats } from '../../content/items.ts';
import type { EquipmentFx } from '../beings/assembly.ts';

/** Equipment slots per Being (the order of ITEM_SLOTS). */
export const GEAR_SLOTS = ITEM_SLOTS.length;
/** Cap per hamlet stock list (08 section 7.3). */
export const STOCK_LIST_MAX = 15;

/** Where an item is kept: on a Being's slot (with the Being's generation), in a hamlet's stock list, or nowhere. */
export type Holder = { kind: 'none' } | { kind: 'being'; slot: number; gen: number } | { kind: 'hamlet'; hamlet: number; list: number };

export interface ItemInstance {
  id: number;
  /** Kind id from content/items.ts. */
  kind: string;
  /** Modifier ids (content/items.ts). */
  mods: string[];
  durability: number;
  favourite: boolean;
  holder: Holder;
}

/** Multiplier on an item's stats while it is broken (durability 0; 05 section 3 step 10, 08 section 7.4). */
export const BROKEN_SCALE = 0.5;

/** Stat keys assembly reads from equipment. */
const FX_KEYS = ['might', 'pace', 'plating', 'vitality', 'wit', 'rapport', 'valor', 'husbandry'] as const;

export class ItemStore {
  readonly capacity: number;
  /** Live item instances by id. Ids come from `nextId` and are never reused. */
  readonly items = new Map<number, ItemInstance>();
  nextId = 1;
  /** Item id per (being slot, equipment slot): `slot * GEAR_SLOTS + index`; 0 for empty. */
  readonly gear: Int32Array;
  /** Generation of the being when its gear was last written. */
  readonly gearGen: Uint32Array;
  /** Being slots that hold at least one item. Kept so the per-tick reconcile touches only these. */
  readonly geared = new Set<number>();
  /** Hamlet index -> one list of item ids per equipment slot. */
  readonly stock = new Map<number, number[][]>();
  /** Kind ids the item rain draws from; empty means every kind. */
  rain: string[] = [];

  constructor(capacity: number) {
    this.capacity = capacity;
    this.gear = new Int32Array(capacity * GEAR_SLOTS);
    this.gearGen = new Uint32Array(capacity);
  }

  get(id: number): ItemInstance | undefined {
    return this.items.get(id);
  }

  /** Item id in one equipment slot of a Being, or 0. */
  gearAt(slot: number, index: number): number {
    return this.gear[slot * GEAR_SLOTS + index] ?? 0;
  }

  /** Item ids worn by a Being, in equipment-slot order, with 0 for empty slots. */
  wornBy(slot: number): number[] {
    const out: number[] = [];
    for (let k = 0; k < GEAR_SLOTS; k++) out.push(this.gearAt(slot, k));
    return out;
  }

  /** Equipment fields that assembly adds to the stat stack (08 section 6.1: a Being's gear). */
  fxOf(slot: number): EquipmentFx {
    const fx: Partial<Record<(typeof FX_KEYS)[number], number>> = {};
    for (let k = 0; k < GEAR_SLOTS; k++) {
      const id = this.gearAt(slot, k);
      const inst = id > 0 ? this.items.get(id) : undefined;
      if (!inst) continue;
      const scale = inst.durability > 0 ? 1 : BROKEN_SCALE;
      for (const [key, value] of statEntries(statsOf(inst))) fx[key] = (fx[key] ?? 0) + value * scale;
    }
    return fx;
  }

  /** Sum of the might of every worn item (weapon damage, keenness): the melee bonus combat adds. */
  mightOf(slot: number): number {
    return this.fxOf(slot).might ?? 0;
  }

  /** Sum of the plating of every worn item (armour and guarding). */
  platingOf(slot: number): number {
    return this.fxOf(slot).plating ?? 0;
  }

  /** Kind of an item instance, or undefined when the id is unknown. */
  kindOf(id: number): ItemKindDef | undefined {
    const inst = this.items.get(id);
    return inst ? ITEM_KIND_BY_ID.get(inst.kind) : undefined;
  }

  /** Index of an equipment slot name in ITEM_SLOTS, or -1. */
  static indexOfSlot(slot: string): number {
    return (ITEM_SLOTS as readonly string[]).indexOf(slot);
  }

  /** Equipment slot index an item kind belongs to. */
  static slotIndexOf(kind: ItemKindDef): number {
    return ItemStore.indexOfSlot(kind.slot as ItemSlot);
  }
}

/** Every stat an item (kind and its modifiers) adds, as flat key/value pairs. */
export function statsOf(inst: ItemInstance): ItemStats {
  const kind = ITEM_KIND_BY_ID.get(inst.kind);
  const total: ItemStats = { ...(kind?.stats ?? {}) };
  for (const modId of inst.mods) {
    const mod = ITEM_MOD_BY_ID.get(modId);
    if (!mod) continue;
    for (const [key, value] of Object.entries(mod.stats) as [keyof ItemStats, number][]) total[key] = (total[key] ?? 0) + value;
  }
  return total;
}

function statEntries(stats: ItemStats): [(typeof FX_KEYS)[number], number][] {
  const out: [(typeof FX_KEYS)[number], number][] = [];
  for (const key of FX_KEYS) {
    const value = stats[key];
    if (value !== undefined && value !== 0) out.push([key, value]);
  }
  return out;
}

/** Value of an instance (08 section 6.1): kind equipment value, plus rank * 2 for each family modifier. */
export function valueOf(inst: ItemInstance): number {
  const kind = ITEM_KIND_BY_ID.get(inst.kind);
  let value = kind?.equipmentValue ?? 0;
  for (const modId of inst.mods) {
    const mod = ITEM_MOD_BY_ID.get(modId);
    if (mod && mod.rank > 0) value += mod.rank * 2;
  }
  return value;
}

/** Quality of an instance: the highest rarity of its kind and its modifiers (08 section 6.1). */
export function qualityOf(inst: ItemInstance): number {
  const kind = ITEM_KIND_BY_ID.get(inst.kind);
  let q = kind?.quality ?? 0;
  for (const modId of inst.mods) {
    const mod = ITEM_MOD_BY_ID.get(modId);
    if (mod && mod.quality > q) q = mod.quality;
  }
  return q;
}

/** True when the instance carries `accursed`: it cannot be removed or swapped. */
export function isAccursed(inst: ItemInstance): boolean {
  return inst.mods.includes('accursed');
}
