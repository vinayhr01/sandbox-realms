import { describe, expect, it } from 'vitest';
import { POWERS } from '../../src/content/powers.ts';
import { CHIP_IDS, CHIP_LABELS, chipOf, groupsOf, homeOf, recentRow, searchPowers } from '../../src/ui/shell/powerCatalog.ts';
import { createStore } from '../../src/ui/shell/store.ts';

describe('power catalogue (sheet, spec B and calls 2)', () => {
  it('places every power: a chip, or a documented pill or Atlas home, never both and never neither', () => {
    expect(POWERS.length).toBe(250);
    const unplaced = POWERS.filter((p) => (chipOf(p) === null) === (homeOf(p) === null)).map((p) => p.id);
    expect(unplaced).toEqual([]);
  });

  it('only the realm-tab powers have no chip, and each names a speed pill or an Atlas tab', () => {
    const noChip = POWERS.filter((p) => chipOf(p) === null);
    expect(noChip.length).toBeGreaterThan(0);
    expect(noChip.every((p) => p.tab === 'realm')).toBe(true);
    expect(noChip.every((p) => /^(Speed pill|Atlas: )/.test(homeOf(p) ?? ''))).toBe(true);
  });

  it('chipOf maps the old tabs as the mapping table says', () => {
    expect(chipOf(POWERS.find((p) => p.id === 'spawn_beast_thistlehart')!)).toBe('creatures');
    expect(chipOf(POWERS.find((p) => p.id === 'shape_raise')!)).toBe('land');
    expect(chipOf(POWERS.find((p) => p.id === 'ins_inspect')!)).toBe('land');
    expect(chipOf(POWERS.find((p) => p.id === 'grow_flora_herb')!)).toBe('nature');
    expect(chipOf(POWERS.find((p) => p.id === 'sky_rain')!)).toBe('weather');
    expect(chipOf(POWERS.find((p) => p.id === 'havoc_bomb')!)).toBe('disasters');
    expect(chipOf(POWERS.find((p) => p.id === 'fav_vigor')!)).toBe('blessings');
    expect(chipOf(POWERS.find((p) => p.id === 'fav_foundling')!)).toBe('peoples');
    expect(chipOf(POWERS.find((p) => p.id === 'ins_list_dominions')!)).toBe('peoples');
    expect(chipOf(POWERS.find((p) => p.id === 'ins_follow')!)).toBe('inspect');
  });

  it('every chip has a label and at least one power, and its groups hold exactly its powers', () => {
    expect(CHIP_IDS).toEqual(['land', 'nature', 'creatures', 'weather', 'disasters', 'blessings', 'peoples', 'inspect']);
    for (const chip of CHIP_IDS) {
      expect(CHIP_LABELS[chip].length).toBeGreaterThan(0);
      const inChip = POWERS.filter((p) => chipOf(p) === chip).map((p) => p.id);
      const inGroups = groupsOf(chip).flatMap((g) => g.powers.map((p) => p.id));
      expect(inGroups.length).toBeGreaterThan(0);
      expect([...inGroups].sort()).toEqual([...inChip].sort());
    }
  });

  it('groups creatures by art chunk, with Deer under Animals', () => {
    const groups = groupsOf('creatures');
    const labels = groups.map((g) => g.label);
    expect(labels).toEqual(expect.arrayContaining(['Animals', 'Birds', 'Sea', 'Insects', 'Undead', 'Monsters', 'Peoples']));
    const animals = groups.find((g) => g.label === 'Animals');
    expect(animals?.powers.map((p) => p.id)).toContain('spawn_beast_thistlehart');
  });

  it('recentRow puts favourites first, drops duplicates and caps at 9', () => {
    const store = createStore();
    store.favourites.value = ['sky_rain', 'havoc_bomb'];
    store.recent.value = ['havoc_bomb', 'fav_vigor', 'fav_ward', 'fav_spark', 'fav_surge', 'fav_muse', 'fav_kinship', 'fav_strife', 'fav_grudge', 'fav_frenzy'];
    const row = recentRow(store);
    expect(row.slice(0, 3)).toEqual(['sky_rain', 'havoc_bomb', 'fav_vigor']);
    expect(row.length).toBe(9);
    expect(new Set(row).size).toBe(row.length);
  });

  it('searchPowers matches the plain name and the chip label, case-insensitively', () => {
    expect(searchPowers('deer').map((p) => p.id)).toContain('spawn_beast_thistlehart');
    expect(searchPowers('WOLF').map((p) => p.id)).toContain('spawn_beast_gloamfang');
    expect(searchPowers('disasters').length).toBeGreaterThan(5);
    expect(searchPowers('   ')).toEqual([]);
  });
});
