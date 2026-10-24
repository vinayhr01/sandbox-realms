import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, ACHIEVEMENT_BY_ID, GROUPS, ROSTER_SPAWNABLE, TRAIT_TOTAL } from '../../src/content/achievements.ts';
import { emptyStats, evaluateAchievements } from '../../src/sim/stats.ts';

/** The 63 ids of 14 section 4, in catalogue order. */
const SPEC_IDS = [
  'ach_cradle', 'ach_busy_hands', 'ach_firm_ground', 'ach_island_maker', 'ach_stonemason', 'ach_full_set', 'ach_green_thumb',
  'ach_circle_of_stones', 'ach_peak_maker', 'ach_five_horizons', 'ach_cartographer', 'ach_atlas', 'ach_made_to_measure',
  'ach_long_watch', 'ach_hearth', 'ach_great_town', 'ach_four_banners', 'ach_full_house', 'ach_many_fronts', 'ach_peacemaker',
  'ach_grand_pact', 'ach_throngs_of_faith', 'ach_many_tongues', 'ach_long_reign', 'ach_dynasty', 'ach_uprising',
  'ach_hundred_year_grudge', 'ach_living_legend', 'ach_elder', 'ach_big_family', 'ach_swarm_tide', 'ach_busy_hive',
  'ach_wyrm_felled', 'ach_scarred', 'ach_bombardier', 'ach_ashen_realm', 'ach_plague_year', 'ach_lava_lake',
  'ach_chain_reaction', 'ach_clean_slate', 'ach_sky_is_falling', 'ach_salvage_rights', 'ach_storm_season', 'ach_deep_freeze',
  'ach_rainmaker', 'ach_in_bloom', 'ach_fault_line', 'ach_firestorm', 'ach_mirror_match', 'ach_trait_alchemist',
  'ach_short_candle', 'ach_methuselah', 'ach_hot_pilgrimage', 'ach_holiday_crash', 'ach_love_letter', 'ach_curious',
  'ach_scholar', 'ach_naturalist', 'ach_trait_collector', 'ach_fine_print', 'ach_loose_letters', 'ach_night_owl', 'ach_quick_study',
];

/** Hidden entries marked H in 14 section 4. */
const SPEC_HIDDEN = [
  'ach_made_to_measure', 'ach_long_watch', 'ach_four_banners', 'ach_full_house', 'ach_many_fronts', 'ach_busy_hive',
  'ach_ashen_realm', 'ach_plague_year', 'ach_lava_lake', 'ach_storm_season', 'ach_firestorm', 'ach_mirror_match',
  'ach_hot_pilgrimage', 'ach_holiday_crash', 'ach_love_letter', 'ach_naturalist', 'ach_loose_letters', 'ach_night_owl',
];

describe('achievement catalogue (14 section 4)', () => {
  it('has exactly the 63 spec ids in catalogue order', () => {
    expect(ACHIEVEMENTS.map((a) => a.id)).toEqual(SPEC_IDS);
    expect(new Set(SPEC_IDS).size).toBe(63);
  });

  it('marks exactly the H entries as hidden', () => {
    expect(ACHIEVEMENTS.filter((a) => a.hidden).map((a) => a.id).sort()).toEqual([...SPEC_HIDDEN].sort());
  });

  it('gives every entry a name, a description, a known group and a positive target', () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.name.length).toBeGreaterThan(0);
      expect(a.desc.length).toBeGreaterThan(0);
      expect(GROUPS).toContain(a.group);
      expect(a.target).toBeGreaterThan(0);
    }
  });

  it('uses every group at least once and sums to 63', () => {
    const counts = new Map<string, number>();
    for (const a of ACHIEVEMENTS) counts.set(a.group, (counts.get(a.group) ?? 0) + 1);
    for (const g of GROUPS) expect(counts.get(g) ?? 0).toBeGreaterThan(0);
    expect([...counts.values()].reduce((x, y) => x + y, 0)).toBe(63);
  });

  it('reads zero from an empty record, so nothing unlocks at start', () => {
    const s = emptyStats();
    for (const a of ACHIEVEMENTS) expect(a.value(s)).toBe(0);
    expect(evaluateAchievements(s, new Set())).toEqual([]);
  });

  it('keeps the codex targets from the spec numbers', () => {
    expect(ROSTER_SPAWNABLE).toBe(90);
    expect(TRAIT_TOTAL).toBe(298);
    expect(ACHIEVEMENT_BY_ID.get('ach_trait_collector')?.target).toBe(Math.ceil(298 * 0.8));
    expect(ACHIEVEMENT_BY_ID.get('ach_naturalist')?.target).toBe(90);
  });
});
