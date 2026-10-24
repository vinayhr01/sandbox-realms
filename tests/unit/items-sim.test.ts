import { describe, expect, it } from 'vitest';
import { Cmd } from '../../src/shared/protocol.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';
import { seedStartingBeasts, killBeing } from '../../src/sim/beings/system.ts';
import { MAX_BEINGS } from '../../src/sim/beings/store.ts';
import { itemRain, setGear, setItemRain, setItemFavourite, saveItems, slotOfBeing, itemsStep } from '../../src/sim/items/system.ts';
import { ItemStore } from '../../src/sim/items/store.ts';
import { applyDamage } from '../../src/sim/combat.ts';
import { buildSnapshot, snapshotBytes } from '../../src/sim/snapshot.ts';
import { SNAPSHOT_MAX_BYTES } from '../../src/shared/protocol.ts';
import { decodeChronicle, encodeChronicle } from '../../src/sim/chronicle.ts';
import { Sim } from '../../src/sim/sim.ts';

function realmWithBeings(): Sim {
  const sim = generateRealm({ seed: 4242, sizeStep: 2, template: 'continent' }).sim;
  seedStartingBeasts(sim, 12);
  return sim;
}

/** Stable id of the first living being: generation * MAX_BEINGS + slot, as the snapshot gives it. */
function firstBeing(sim: Sim): { slot: number; id: number } {
  const s = sim.beings.store;
  const slot = s.at(0);
  return { slot, id: (s.generation[slot] ?? 0) * MAX_BEINGS + slot };
}

describe('items on beings (08 section 6.1, 7.3)', () => {
  it('equips a kind and raises the assembled might through the stat assembly', () => {
    const sim = realmWithBeings();
    const { slot, id } = firstBeing(sim);
    const before = sim.beings.store.mightA[slot] ?? 0;
    expect(setGear(sim, id, 'weapon', 'iron_blade')).toBe(true);
    expect(sim.items.mightOf(slot)).toBe(7);
    expect(sim.beings.store.mightA[slot]).toBeGreaterThan(before);
  });

  it('refuses a kind for the wrong slot, an unknown kind and a stale being id', () => {
    const sim = realmWithBeings();
    const { id } = firstBeing(sim);
    expect(setGear(sim, id, 'helm', 'iron_blade')).toBe(false);
    expect(setGear(sim, id, 'weapon', 'no_such_item')).toBe(false);
    expect(setGear(sim, id + MAX_BEINGS, 'weapon', 'iron_blade')).toBe(false);
  });

  it('empties a slot and returns the item to the stock or destroys it', () => {
    const sim = realmWithBeings();
    const { slot, id } = firstBeing(sim);
    setGear(sim, id, 'ring', 'iron_ring');
    expect(setGear(sim, id, 'ring', null)).toBe(true);
    expect(sim.items.gearAt(slot, ItemStore.indexOfSlot('ring'))).toBe(0);
    expect(sim.items.geared.has(slot)).toBe(false);
  });

  it('keeps an accursed item on its being', () => {
    const sim = realmWithBeings();
    const { slot, id } = firstBeing(sim);
    setGear(sim, id, 'boots', 'iron_boots');
    const worn = sim.items.get(sim.items.gearAt(slot, ItemStore.indexOfSlot('boots')));
    expect(worn).toBeDefined();
    if (worn) worn.mods.push('accursed');
    expect(setGear(sim, id, 'boots', null)).toBe(false);
    expect(setGear(sim, id, 'boots', 'steel_boots')).toBe(false);
  });

  it('applies the plating of worn armour in combat', () => {
    const sim = realmWithBeings();
    const { slot, id } = firstBeing(sim);
    setGear(sim, id, 'body', 'iron_body');
    const ctx = sim.combatContext();
    sim.beings.store.vit[slot] = 500;
    sim.combat.hitUntil[slot] = 0;
    const result = applyDamage(ctx, slot, 100, 'Weapon', false);
    // Iron body plating 7 cuts 100 to 93.
    expect(result.dealt).toBe(93);
  });

  it('releases gear when its being dies, so no item stays on a dead slot', () => {
    const sim = realmWithBeings();
    const { slot, id } = firstBeing(sim);
    setGear(sim, id, 'amulet', 'copper_amulet');
    const worn = sim.items.gearAt(slot, ItemStore.indexOfSlot('amulet'));
    killBeing(sim, slot, 'combat');
    itemsStep(sim);
    expect(sim.items.geared.has(slot)).toBe(false);
    expect(sim.items.gearAt(slot, ItemStore.indexOfSlot('amulet'))).toBe(0);
    // With no hamlet on the tile the item is destroyed; with one it is kept in stock.
    const kept = sim.items.get(worn);
    if (kept) expect(kept.holder.kind).toBe('hamlet');
    else expect(sim.items.get(worn)).toBeUndefined();
  });
});

describe('item rain and rain list (08 section 7.3 giveItem)', () => {
  it('drops items on beings near a tile, the same way on two identical runs', () => {
    const a = realmWithBeings();
    const b = realmWithBeings();
    const side = a.realm.side;
    setItemRain(a, ['flint_blade', 'copper_helm']);
    setItemRain(b, ['flint_blade', 'copper_helm']);
    const sa = a.beings.store;
    const x = sa.x[sa.at(0)] ?? Math.floor(side / 2);
    const y = sa.y[sa.at(0)] ?? Math.floor(side / 2);
    expect(itemRain(a, x, y, 40)).toBeGreaterThan(0);
    itemRain(b, x, y, 40);
    expect(JSON.stringify(saveItems(a))).toBe(JSON.stringify(saveItems(b)));
  });

  it('keeps only known kind ids in the rain list, each once', () => {
    const sim = realmWithBeings();
    setItemRain(sim, ['flint_blade', 'flint_blade', 'nope', 'ember_staff']);
    expect(sim.items.rain).toEqual(['flint_blade', 'ember_staff']);
  });

  it('applies the item commands through the sim queue', () => {
    const sim = realmWithBeings();
    const { id } = firstBeing(sim);
    sim.enqueue({ kind: Cmd.SetGear, seq: 1, beingId: id, slot: 'weapon', item: 'flame_blade' });
    sim.enqueue({ kind: Cmd.SetItemRain, seq: 2, ids: ['scatter_gun'] });
    sim.step();
    expect(sim.items.rain).toEqual(['scatter_gun']);
    const worn = sim.items.gearAt(slotOfBeing(sim, id), ItemStore.indexOfSlot('weapon'));
    expect(sim.items.get(worn)?.kind).toBe('flame_blade');
  });

  it('marks a favourite', () => {
    const sim = realmWithBeings();
    const { id } = firstBeing(sim);
    setGear(sim, id, 'weapon', 'steel_blade');
    const itemId = sim.items.gearAt(slotOfBeing(sim, id), 0);
    setItemFavourite(sim, itemId, true);
    expect(sim.items.get(itemId)?.favourite).toBe(true);
  });
});

describe('items in the snapshot and the Chronicle', () => {
  it('reports exact totals and the worn gear, within the snapshot budget', () => {
    const sim = realmWithBeings();
    const { id } = firstBeing(sim);
    setGear(sim, id, 'weapon', 'iron_maul');
    const snap = buildSnapshot(sim);
    expect(snap.items?.count).toBe(1);
    expect(snap.items?.equipped).toBe(1);
    expect(snap.items?.rows[0]?.kind).toBe('iron_maul');
    expect(snap.items?.rows[0]?.holder).toBe('worn');
    expect(snap.items?.gear[0]?.kinds[0]).toBe('iron_maul');
    expect(snapshotBytes(snap)).toBeLessThanOrEqual(SNAPSHOT_MAX_BYTES);
  });

  it('writes no items section for a realm with no items', () => {
    const sim = realmWithBeings();
    const bytes = encodeChronicle(sim);
    const back = decodeChronicle(bytes);
    expect(back.items.items.size).toBe(0);
  });

  it('round-trips worn gear, the rain list and the next item id', () => {
    const sim = realmWithBeings();
    const { id } = firstBeing(sim);
    setGear(sim, id, 'weapon', 'iron_blade');
    setGear(sim, id, 'helm', 'hide_helm');
    setItemRain(sim, ['flame_maul']);
    const back = decodeChronicle(encodeChronicle(sim));
    expect(JSON.stringify(saveItems(back))).toBe(JSON.stringify(saveItems(sim)));
    expect(back.items.mightOf(slotOfBeing(back, id))).toBe(sim.items.mightOf(slotOfBeing(sim, id)));
    expect(back.items.nextId).toBe(sim.items.nextId);
  });
});
