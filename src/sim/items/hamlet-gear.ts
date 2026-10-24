/**
 * Hamlet gear work (08 sections 7.2, 7.3 and 7.4): a hamlet fetches gear from its stock onto the
 * Beings standing in its parcels, repairs worn gear where it has a garrison, and crafts gear from
 * its stock. The spec runs these as Being tasks (fetch_hamlet_gear, repair_gear, craft_gear); no task
 * layer exists for them yet, so each one runs as a hamlet pass on a fixed period (TUNE below).
 */
import { ITEM_KINDS, ITEM_KIND_BY_ID, type ItemGroup, type ItemKindDef } from '../../content/items.ts';
import { refreshStats } from '../beings/system.ts';
import { hamletsOf } from '../settlements/adapter.ts';
import type { Hamlet } from '../settlements/hamlet.ts';
import type { Sim } from '../sim.ts';
import { createItem, hamletAt, stockPut, unwear, wear } from './system.ts';
import { GEAR_SLOTS, ItemStore, isAccursed, qualityOf, valueOf } from './store.ts';

/** Ticks between stock fetch passes (TUNE). */
export const FETCH_PERIOD = 200;
/** Ticks between craft passes (08 section 7.2 stays 200-300 ticks; TUNE). */
export const CRAFT_PERIOD = 300;
/** Ticks between repair passes (08 section 7.4 cooldown 6000). */
export const REPAIR_PERIOD = 6000;
/** Crafter skill rolls: species.craftSkill, default 1 (08 section 7.1). No species carries craftSkill yet. */
export const CRAFT_TRIES = 1;
/** Armour and jewelry slots a craft pass tries besides the weapon (08 section 7.2). */
const WORN_SLOTS = ['helm', 'body', 'boots', 'ring', 'amulet'] as const;
/** Weapon groups a craft attempt picks from uniformly (08 section 7.2). */
const WEAPON_GROUPS: readonly ItemGroup[] = ['blade', 'cleaver', 'maul', 'pike', 'bow', 'staff'];
/** Kinds a hamlet can craft: every non-unique kind, highest tier first (stable on registry order). */
const CRAFTABLE: readonly ItemKindDef[] = ITEM_KINDS.filter((k) => !k.unique).sort((a, b) => b.tier - a.tier);

/**
 * Coins a crafter or repairer can spend (08 section 7.2 and 7.4). The sim has no purse yet, so the
 * default holds none: coin costs are then never met, and repairs of uncommon gear wait.
 */
export interface Purse {
  coins(slot: number): number;
  spend(slot: number, n: number): boolean;
}

export const NO_PURSE: Purse = {
  coins: () => 0,
  spend: (_slot, n) => n <= 0,
};

/** Being slots standing in each hamlet's parcels, keyed by hamlet index, in being order. */
function residents(sim: Sim): Map<number, number[]> {
  const out = new Map<number, number[]>();
  const s = sim.beings.store;
  for (let k = 0; k < s.size; k++) {
    const slot = s.at(k);
    const h = hamletAt(sim, s.x[slot] ?? 0, s.y[slot] ?? 0);
    if (h < 0) continue;
    const list = out.get(h);
    if (list) list.push(slot);
    else out.set(h, [slot]);
  }
  return out;
}

/** Hamlet index -> hamlet record, read-only. */
function hamletOf(sim: Sim, h: number): Hamlet | undefined {
  return hamletsOf(sim)[h];
}

/**
 * Per-tick hook (called from sim.ts after itemsStep). Each pass runs only on its own tick period, so
 * an idle hamlet costs nothing on the other ticks.
 */
export function hamletGearStep(sim: Sim, purse: Purse = NO_PURSE): void {
  const t = sim.tick;
  if (t % FETCH_PERIOD === 0) fetchPass(sim);
  if (t % CRAFT_PERIOD === 0) craftPass(sim, purse);
  if (t % REPAIR_PERIOD === 0) repairPass(sim, purse);
}

/** fetch_hamlet_gear (08 section 7.3): each Being takes the best stock item that beats its gear in each slot. */
export function fetchPass(sim: Sim): void {
  for (const [h, slots] of residents(sim)) {
    const lists = sim.items.stock.get(h);
    if (!lists) continue;
    for (const slot of slots) for (let index = 0; index < GEAR_SLOTS; index++) fetchSlot(sim, h, lists, slot, index);
  }
}

/**
 * One slot of one Being. Takes the highest-value stock item strictly above the worn item (any item
 * when the slot is empty). Neither side may be accursed (08 section 6.3 and 7.4). The worn item, if
 * any, goes back into the same hamlet's stock.
 */
function fetchSlot(sim: Sim, h: number, lists: number[][], slot: number, index: number): void {
  const store = sim.items;
  const list = lists[index];
  if (!list || list.length === 0) return;
  const current = store.get(store.gearAt(slot, index));
  if (current && isAccursed(current)) return;
  let bestAt = -1;
  let bestValue = current ? valueOf(current) : -1;
  list.forEach((id, k) => {
    const inst = store.get(id);
    if (!inst || isAccursed(inst)) return;
    const v = valueOf(inst);
    if (v > bestValue) {
      bestValue = v;
      bestAt = k;
    }
  });
  if (bestAt < 0) return;
  const [id] = list.splice(bestAt, 1);
  const inst = store.get(id ?? 0);
  if (!inst) return;
  if (current) {
    unwear(sim, slot, index);
    if (!stockPut(sim, current, h)) store.items.delete(current.id);
  }
  wear(sim, slot, index, inst);
  refreshStats(sim, slot);
}

/**
 * repair_gear (08 section 7.4): needs a garrison in the hamlet. Each worn item below its maximum
 * durability is set back to the kind's durability. Common gear is free; other gear costs
 * floor(cost.coins * 0.5) coins from the Being's purse, and waits when the purse cannot pay.
 */
export function repairPass(sim: Sim, purse: Purse = NO_PURSE): void {
  const store = sim.items;
  for (const [h, slots] of residents(sim)) {
    if (!hamletHasGarrison(sim, h)) continue;
    for (const slot of slots) {
      let changed = false;
      for (let index = 0; index < GEAR_SLOTS; index++) {
        const inst = store.get(store.gearAt(slot, index));
        const kind = inst ? ITEM_KIND_BY_ID.get(inst.kind) : undefined;
        if (!inst || !kind || inst.durability >= kind.durability) continue;
        const cost = repairCost(kind, qualityOf(inst));
        if (!purse.spend(slot, cost)) continue;
        inst.durability = kind.durability;
        changed = true;
      }
      if (changed) refreshStats(sim, slot);
    }
  }
}

/** Coin cost of one repair (08 section 7.4): free for common (quality 0) gear, else floor(cost.coins * 0.5). */
export function repairCost(kind: ItemKindDef, quality: number): number {
  return quality === 0 ? 0 : Math.floor(kind.cost.coins * 0.5);
}

function hamletHasGarrison(sim: Sim, h: number): boolean {
  return hamletOf(sim, h)?.buildings.some((b) => b.def.id === 'garrison') ?? false;
}

/**
 * craft_gear (08 section 7.2). Each pass: one weapon attempt, then up to five armour or jewelry
 * attempts, each of which also tries a weapon; the pass stops at the first attempt where both fail.
 * One random resident is the crafter for the whole pass.
 */
export function craftPass(sim: Sim, purse: Purse = NO_PURSE): void {
  const rng = sim.rng('items');
  for (const [h, slots] of residents(sim)) {
    const hamlet = hamletOf(sim, h);
    const crafter = slots[rng.int(slots.length)];
    if (!hamlet || crafter === undefined) continue;
    craftSlot(sim, h, hamlet, purse, crafter, 'weapon');
    for (let k = 0; k < 5; k++) {
      const armour = craftSlot(sim, h, hamlet, purse, crafter, WORN_SLOTS[rng.int(WORN_SLOTS.length)] ?? 'body');
      const weapon = craftSlot(sim, h, hamlet, purse, crafter, 'weapon');
      if (!armour && !weapon) break;
    }
  }
}

/**
 * One craft attempt for one slot of the crafter. Candidates are the kinds of the slot (for weapons,
 * one random group), highest tier first. The first kind that beats the worn item's value and that the
 * hamlet stock and the purse can pay for is built, paid, and worn. The old item goes to hamlet stock.
 * A worn accursed item blocks crafting. Returns true when an item was built.
 */
function craftSlot(sim: Sim, h: number, hamlet: Hamlet, purse: Purse, crafter: number, slotName: string): boolean {
  const store = sim.items;
  const index = ItemStore.indexOfSlot(slotName);
  if (index < 0) return false;
  const group = slotName === 'weapon' ? (WEAPON_GROUPS[sim.rng('items').int(WEAPON_GROUPS.length)] ?? 'blade') : null;
  const current = store.get(store.gearAt(crafter, index));
  if (current && isAccursed(current)) return false;
  const currentValue = current ? valueOf(current) : 0;
  for (const kind of CRAFTABLE) {
    if (kind.slot !== slotName || (group !== null && kind.group !== group)) continue;
    if (kind.equipmentValue <= currentValue) continue;
    if (!canPay(hamlet, purse, crafter, kind)) continue;
    pay(hamlet, purse, crafter, kind);
    const inst = createItem(sim, kind.id, CRAFT_TRIES);
    if (!inst) return false;
    if (current) {
      unwear(sim, crafter, index);
      if (!stockPut(sim, current, h)) store.items.delete(current.id);
    }
    wear(sim, crafter, index, inst);
    refreshStats(sim, crafter);
    return true;
  }
  return false;
}

/** Hamlet stock that a recipe can draw on. Only wood and stone exist in the hamlet record (09 section 10.2). */
function stockOf(hamlet: Hamlet, resource: string): number {
  if (resource === 'wood') return hamlet.wood;
  if (resource === 'stone') return hamlet.stone;
  return 0;
}

function canPay(hamlet: Hamlet, purse: Purse, crafter: number, kind: ItemKindDef): boolean {
  if (purse.coins(crafter) < kind.cost.coins) return false;
  return kind.cost.resources.every((r) => stockOf(hamlet, r.id) >= r.n);
}

function pay(hamlet: Hamlet, purse: Purse, crafter: number, kind: ItemKindDef): void {
  purse.spend(crafter, kind.cost.coins);
  for (const r of kind.cost.resources) {
    if (r.id === 'wood') hamlet.wood -= r.n;
    else if (r.id === 'stone') hamlet.stone -= r.n;
  }
}

