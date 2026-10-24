import { describe, expect, it } from 'vitest';
import { generateRealm } from '../../src/sim/worldgen.ts';
import { seedStartingBeasts } from '../../src/sim/beings/system.ts';
import { MAX_BEINGS } from '../../src/sim/beings/store.ts';
import { createItem, setGear, stockPut } from '../../src/sim/items/system.ts';
import { BROKEN_SCALE, ItemStore } from '../../src/sim/items/store.ts';
import { wearFor, wearOnHit } from '../../src/sim/items/wear.ts';
import { CRAFT_PERIOD, FETCH_PERIOD, NO_PURSE, craftPass, fetchPass, hamletGearStep, repairPass, type Purse } from '../../src/sim/items/hamlet-gear.ts';
import { hamletsOf, settlementsStep } from '../../src/sim/settlements/adapter.ts';
import { BUILDING_BY_ID, type BuildingDef } from '../../src/sim/settlements/catalogue.ts';
import { PARCEL } from '../../src/sim/settlements/hamlet.ts';
import { ITEM_KIND_BY_ID } from '../../src/content/items.ts';
import type { Sim } from '../../src/sim/sim.ts';

/** Seeds tried in order until one places a hamlet (placement depends on the seed). */
const SEEDS = [4242, 1, 555, 31337, 2024];

/**
 * Realm with beasts, one hamlet placed, and one beast moved into its first parcel. Others are moved
 * off the map. `others` are the living beasts after the first, for attackers.
 */
function hamletWorld(): { sim: Sim; h: number; slot: number; others: number[] } {
  for (const seed of SEEDS) {
    const sim = generateRealm({ seed, sizeStep: 2, template: 'continent' }).sim;
    seedStartingBeasts(sim, 12);
    settlementsStep(sim);
    const hamlets = hamletsOf(sim);
    const first = hamlets[0];
    if (!first) continue;
    const parcel = [...first.parcels][0] ?? 0;
    const perAxis = sim.realm.side / PARCEL;
    const s = sim.beings.store;
    const living: number[] = [];
    for (let k = 0; k < s.size; k++) living.push(s.at(k));
    const slot = living[0] ?? 0;
    for (const other of living) {
      if (other === slot) continue;
      s.x[other] = -PARCEL * 100;
      s.y[other] = -PARCEL * 100;
    }
    s.x[slot] = (parcel % perAxis) * PARCEL + 1;
    s.y[slot] = Math.floor(parcel / perAxis) * PARCEL + 1;
    return { sim, h: 0, slot, others: living.slice(1) };
  }
  throw new Error('no seed placed a hamlet');
}

function idOf(sim: Sim, slot: number): number {
  return (sim.beings.store.generation[slot] ?? 0) * MAX_BEINGS + slot;
}

/** The item worn in one equipment slot of a Being, or undefined. */
function wornAt(sim: Sim, slot: number, slotName: string) {
  return sim.items.get(sim.items.gearAt(slot, ItemStore.indexOfSlot(slotName)));
}

/** A purse with a fixed balance that pays what it can. */
function purseWith(balance: number): Purse & { balance: number } {
  const p = {
    balance,
    coins: () => p.balance,
    spend: (_slot: number, n: number) => {
      if (p.balance < n) return false;
      p.balance -= n;
      return true;
    },
  };
  return p;
}

/** A garrison record placed in hamlet 0 (the catalogue has no garrison yet). */
function addGarrison(sim: Sim, h: number): void {
  const def = { ...(BUILDING_BY_ID.get('house') as BuildingDef), id: 'garrison', name: 'Garrison' };
  hamletsOf(sim)[h]?.buildings.push({ def, x: 0, y: 0 });
}

describe('wear on melee hits (08 section 7.4)', () => {
  it('gives the spec wear values by rigidity pair', () => {
    // Spec test 13: iron (rigidity 4) against leather (1) wears 16, steel (5) wears 0, iron (4) wears 4.
    expect(wearFor(4, 1)).toBe(16);
    expect(wearFor(4, 5)).toBe(0);
    expect(wearFor(4, 4)).toBe(4);
  });

  it('wears defender gear by the weapon rigidity and breaks it at zero', () => {
    const { sim, slot, others } = hamletWorld();
    const victim = slot;
    const attacker = others[0] ?? 0;
    setGear(sim, idOf(sim, victim), 'body', 'hide_body');
    setGear(sim, idOf(sim, attacker), 'weapon', 'iron_blade');
    expect(sim.items.platingOf(victim)).toBe(2);
    for (let k = 0; k < 200; k++) wearOnHit(sim, attacker, victim);
    const body = wornAt(sim, victim, 'body');
    expect(body).toBeDefined();
    expect(body?.durability).toBe(0);
    // Broken gear keeps its slot and counts half stats (08 section 7.4).
    expect(sim.items.gearAt(victim, ItemStore.indexOfSlot('body'))).toBe(body?.id);
    expect(sim.items.platingOf(victim)).toBe(2 * BROKEN_SCALE);
  });

  it('never wears gear below zero or past the wear unit', () => {
    const { sim, slot, others } = hamletWorld();
    const victim = slot;
    const attacker = others[0] ?? 0;
    setGear(sim, idOf(sim, victim), 'body', 'iron_body');
    setGear(sim, idOf(sim, attacker), 'weapon', 'iron_blade');
    for (let k = 0; k < 100; k++) wearOnHit(sim, attacker, victim);
    const body = wornAt(sim, victim, 'body');
    expect(body?.durability).toBeGreaterThanOrEqual(0);
    expect((body?.durability ?? 0) % 4).toBe(0);
  });

  it('does not wear everlasting gear', () => {
    const { sim, slot, others } = hamletWorld();
    const victim = slot;
    const attacker = others[0] ?? 0;
    setGear(sim, idOf(sim, victim), 'body', 'hide_body');
    setGear(sim, idOf(sim, attacker), 'weapon', 'iron_blade');
    wornAt(sim, victim, 'body')?.mods.push('everlasting');
    for (let k = 0; k < 100; k++) wearOnHit(sim, attacker, victim);
    expect(wornAt(sim, victim, 'body')?.durability).toBe(100);
  });

  it('spares a warded defender and an unarmed attacker', () => {
    const { sim, slot, others } = hamletWorld();
    const victim = slot;
    const attacker = others[0] ?? 0;
    setGear(sim, idOf(sim, victim), 'body', 'hide_body');
    setGear(sim, idOf(sim, attacker), 'weapon', 'iron_blade');
    sim.effects.add(victim, 'warded', sim.tick);
    for (let k = 0; k < 50; k++) wearOnHit(sim, attacker, victim);
    expect(wornAt(sim, victim, 'body')?.durability).toBe(100);

    sim.effects.remove(victim, 'warded');
    const bare = others[1] ?? 0;
    for (let k = 0; k < 50; k++) wearOnHit(sim, bare, victim);
    expect(wornAt(sim, victim, 'body')?.durability).toBe(100);
  });
});

describe('fetching gear from hamlet stock (08 section 7.3)', () => {
  it('equips the stock item into an empty slot', () => {
    const { sim, h, slot } = hamletWorld();
    const inst = createItem(sim, 'iron_blade', 0);
    expect(inst).not.toBeNull();
    if (!inst) return;
    expect(stockPut(sim, inst, h)).toBe(true);
    fetchPass(sim);
    expect(sim.items.gearAt(slot, 0)).toBe(inst.id);
    expect(sim.items.stock.get(h)?.[0]).toEqual([]);
  });

  it('swaps for a strictly better item and returns the worse one to the same stock', () => {
    const { sim, h, slot } = hamletWorld();
    setGear(sim, idOf(sim, slot), 'weapon', 'timber_blade');
    const old = wornAt(sim, slot, 'weapon');
    const better = createItem(sim, 'iron_blade', 0);
    if (!better || !old) throw new Error('setup');
    stockPut(sim, better, h);
    fetchPass(sim);
    expect(sim.items.gearAt(slot, 0)).toBe(better.id);
    expect(sim.items.stock.get(h)?.[0]).toContain(old.id);
  });

  it('keeps the worn item when the stock item is not better', () => {
    const { sim, h, slot } = hamletWorld();
    setGear(sim, idOf(sim, slot), 'weapon', 'iron_blade');
    const worse = createItem(sim, 'timber_blade', 0);
    if (!worse) throw new Error('setup');
    stockPut(sim, worse, h);
    fetchPass(sim);
    expect(wornAt(sim, slot, 'weapon')?.kind).toBe('iron_blade');
  });

  it('never takes an accursed item from stock', () => {
    const { sim, h, slot } = hamletWorld();
    const cursed = createItem(sim, 'iron_blade', 0);
    if (!cursed) throw new Error('setup');
    cursed.mods.push('accursed');
    stockPut(sim, cursed, h);
    fetchPass(sim);
    expect(sim.items.gearAt(slot, 0)).toBe(0);
  });

  it('runs only on its period through the per-tick hook', () => {
    const { sim, h, slot } = hamletWorld();
    const inst = createItem(sim, 'iron_helm', 0);
    if (!inst) throw new Error('setup');
    stockPut(sim, inst, h);
    sim.tick = FETCH_PERIOD + 1;
    hamletGearStep(sim);
    expect(sim.items.gearAt(slot, ItemStore.indexOfSlot('helm'))).toBe(0);
    sim.tick = FETCH_PERIOD;
    hamletGearStep(sim);
    expect(sim.items.gearAt(slot, ItemStore.indexOfSlot('helm'))).toBe(inst.id);
  });
});

describe('repairing worn gear (08 section 7.4)', () => {
  it('needs a garrison in the hamlet', () => {
    const { sim, slot } = hamletWorld();
    setGear(sim, idOf(sim, slot), 'body', 'iron_body');
    const body = wornAt(sim, slot, 'body');
    if (!body) throw new Error('setup');
    body.durability = 40;
    repairPass(sim, purseWith(100));
    expect(body.durability).toBe(40);
  });

  it('restores uncommon gear to full for the coin cost, and waits without coins', () => {
    const { sim, h, slot } = hamletWorld();
    addGarrison(sim, h);
    setGear(sim, idOf(sim, slot), 'body', 'iron_body');
    const body = wornAt(sim, slot, 'body');
    if (!body) throw new Error('setup');
    body.durability = 40;
    repairPass(sim, NO_PURSE);
    expect(body.durability).toBe(40);
    const purse = purseWith(10);
    repairPass(sim, purse);
    expect(body.durability).toBe(ITEM_KIND_BY_ID.get('iron_body')?.durability);
    // iron body costs 2 coins; uncommon gear pays floor(2 * 0.5) = 1.
    expect(purse.balance).toBe(9);
  });

  it('repairs common gear for free', () => {
    const { sim, h, slot } = hamletWorld();
    addGarrison(sim, h);
    setGear(sim, idOf(sim, slot), 'body', 'hide_body');
    const body = wornAt(sim, slot, 'body');
    if (!body) throw new Error('setup');
    body.durability = 10;
    repairPass(sim, NO_PURSE);
    expect(body.durability).toBe(100);
  });
});

describe('crafting gear from hamlet stock (08 section 7.2)', () => {
  it('builds nothing without coins', () => {
    const { sim, h, slot } = hamletWorld();
    const hamlet = hamletsOf(sim)[h];
    if (!hamlet) throw new Error('setup');
    hamlet.wood = 30;
    craftPass(sim, NO_PURSE);
    expect(wornAt(sim, slot, 'weapon')).toBeUndefined();
    expect(hamlet.wood).toBe(30);
  });

  it('builds a timber weapon from wood and coins, and spends both', () => {
    const { sim, h, slot } = hamletWorld();
    const hamlet = hamletsOf(sim)[h];
    if (!hamlet) throw new Error('setup');
    hamlet.wood = 30;
    hamlet.stone = 0;
    const purse = purseWith(100);
    craftPass(sim, purse);
    const weapon = wornAt(sim, slot, 'weapon');
    expect(weapon).toBeDefined();
    expect(ITEM_KIND_BY_ID.get(weapon?.kind ?? '')?.material).toBe('timber');
    // Each craft spends 3 wood and 2 coins; the pass made at least one craft.
    expect(hamlet.wood).toBeLessThan(30);
    expect((30 - hamlet.wood) % 3).toBe(0);
    expect(purse.balance).toBe(100 - ((30 - hamlet.wood) / 3) * 2);
  });

  it('keeps a worn weapon that is worth more than anything the stock can build', () => {
    const { sim, h, slot } = hamletWorld();
    const hamlet = hamletsOf(sim)[h];
    if (!hamlet) throw new Error('setup');
    hamlet.wood = 30;
    setGear(sim, idOf(sim, slot), 'weapon', 'iron_blade');
    craftPass(sim, purseWith(100));
    expect(wornAt(sim, slot, 'weapon')?.kind).toBe('iron_blade');
  });

  it('does not craft over an accursed worn item', () => {
    const { sim, h, slot } = hamletWorld();
    const hamlet = hamletsOf(sim)[h];
    if (!hamlet) throw new Error('setup');
    hamlet.wood = 30;
    setGear(sim, idOf(sim, slot), 'weapon', 'timber_blade');
    wornAt(sim, slot, 'weapon')?.mods.push('accursed');
    craftPass(sim, purseWith(100));
    expect(wornAt(sim, slot, 'weapon')?.kind).toBe('timber_blade');
  });

  it('runs only on its period through the per-tick hook', () => {
    const { sim, h, slot } = hamletWorld();
    const hamlet = hamletsOf(sim)[h];
    if (!hamlet) throw new Error('setup');
    hamlet.wood = 30;
    sim.tick = CRAFT_PERIOD + 1;
    hamletGearStep(sim, purseWith(100));
    expect(wornAt(sim, slot, 'weapon')).toBeUndefined();
    sim.tick = CRAFT_PERIOD;
    hamletGearStep(sim, purseWith(100));
    expect(wornAt(sim, slot, 'weapon')).toBeDefined();
  });
});
