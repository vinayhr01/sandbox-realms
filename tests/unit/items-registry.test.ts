import { describe, expect, it } from 'vitest';
import { ITEM_KINDS, ITEM_KIND_BY_ID, ITEM_MODS, ITEM_MOD_BY_ID, ITEM_SLOTS, MOD_POOLS } from '../../src/content/items.ts';

describe('item registry (08 section 6)', () => {
  it('has unique kind ids and every slot is one of the six', () => {
    expect(new Set(ITEM_KINDS.map((k) => k.id)).size).toBe(ITEM_KINDS.length);
    for (const kind of ITEM_KINDS) expect(ITEM_SLOTS).toContain(kind.slot);
  });

  it('carries the ten unique weapons and staffs of 08 section 6.2 with their exact ids', () => {
    const uniques = ITEM_KINDS.filter((k) => k.unique).map((k) => k.id);
    expect(uniques.sort()).toEqual(
      [
        'bone_caller_staff',
        'energy_blaster',
        'ember_staff',
        'flame_blade',
        'flame_maul',
        'frost_maul',
        'frost_staff',
        'plague_healer_staff',
        'scatter_gun',
        'thicket_staff',
      ].sort(),
    );
  });

  it('keeps the spec numbers of the named weapons', () => {
    expect(ITEM_KIND_BY_ID.get('flame_blade')?.stats.might).toBe(33);
    expect(ITEM_KIND_BY_ID.get('frost_staff')?.stats.might).toBe(35);
    expect(ITEM_KIND_BY_ID.get('frost_staff')?.durability).toBe(300);
    expect(ITEM_KIND_BY_ID.get('bone_caller_staff')?.extra['spells']).toEqual(['raise_boneshambler', 'hex_cast']);
  });

  it('generates the tier kinds from the material table (weapons, armour, jewelry)', () => {
    expect(ITEM_KIND_BY_ID.get('iron_blade')?.stats.might).toBe(7);
    expect(ITEM_KIND_BY_ID.get('abyssal_helm')?.stats.plating).toBe(11);
    expect(ITEM_KIND_BY_ID.get('bone_ring')?.stats.crit).toBe(0.02);
    expect(ITEM_KIND_BY_ID.get('flint_blade')?.stats.pace).toBe(-2);
    expect(ITEM_KIND_BY_ID.get('timber_staff')?.group).toBe('staff');
    // Bone has jewelry only: no melee weapon and no armour.
    expect(ITEM_KIND_BY_ID.has('bone_blade')).toBe(false);
    expect(ITEM_KIND_BY_ID.has('bone_helm')).toBe(false);
  });

  it('has 58 modifiers: 50 family ranks and 8 explicit-only ones', () => {
    expect(ITEM_MODS.length).toBe(58);
    expect(ITEM_MODS.filter((m) => m.explicitOnly).length).toBe(8);
    expect(ITEM_MOD_BY_ID.get('swiftness_5')?.stats.pace).toBe(6);
    expect(ITEM_MOD_BY_ID.get('insight_5')?.stats.wit).toBe(7);
  });

  it('refers only to modifiers that exist', () => {
    for (const kind of ITEM_KINDS) for (const mod of kind.modifiers) expect(ITEM_MOD_BY_ID.has(mod)).toBe(true);
  });

  it('gives every family a pool that rolls it (08 section 6.3 pool weights)', () => {
    for (const pool of Object.keys(MOD_POOLS) as (keyof typeof MOD_POOLS)[]) {
      for (const family of Object.keys(MOD_POOLS[pool])) expect(family === 'normal' || ITEM_MODS.some((m) => m.family === family)).toBe(true);
    }
  });
});
