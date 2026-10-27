/**
 * Achievement catalogue: the 63 entries of 14 section 4, in catalogue order. Names and descriptions
 * are original. Each entry reads a number from the lifetime stats record (src/sim/stats.ts) and
 * unlocks when it reaches `target`; the same number drives the visible progress bar.
 *
 * Counter ids follow 14 section 3. Gauges ("at once" values such as summitRegionMax) keep the
 * highest value seen. Where the sim does not yet produce the input, the counter stays at zero and
 * the entry cannot unlock until a hook feeds it (see docs in the sim-hooks report). Thresholds are
 * TUNE values from 14 section 4.
 */
import type { StatsRecord } from '../sim/stats.ts';
import { PLAIN_ACHIEVEMENTS } from './plain-names.ts';

export type AchievementGroup = 'Creation' | 'Realms' | 'Civilisation' | 'Beings' | 'Destruction' | 'Nature' | 'Experiments' | 'Codex' | 'Curiosities';

export const GROUPS: readonly AchievementGroup[] = ['Creation', 'Realms', 'Civilisation', 'Beings', 'Destruction', 'Nature', 'Experiments', 'Codex', 'Curiosities'];

export interface AchievementDef {
  id: string;
  name: string;
  /** Short description of the condition; hidden entries show it only after unlock. */
  desc: string;
  group: AchievementGroup;
  /** Name and description masked until unlocked (14 section 4, column H). */
  hidden: boolean;
  /** Current value of the condition (a counter, gauge or set size). */
  value: (s: StatsRecord) => number;
  /** The value that unlocks the entry. */
  target: number;
}

/** Traits in the trait catalogue (18b: 144 being traits + 154 strain traits). Used by Trait Collector. */
export const TRAIT_TOTAL = 298;
/** Spawnable roster entries for Naturalist (14 section 4, 18a). */
export const ROSTER_SPAWNABLE = 90;
/** Skystones needed within one minute (sim seconds at x1 speed). */
export const SKYFALL_BURST = 10;

const c = (s: StatsRecord, key: string): number => s.counters[key] ?? 0;
/** Entries of a set, optionally only those starting with a prefix. */
const set = (s: StatsRecord, name: string, prefix = ''): number => {
  const list = s.sets[name] ?? [];
  return prefix === '' ? list.length : list.filter((id) => id.startsWith(prefix)).length;
};

const def = (
  id: string,
  name: string,
  desc: string,
  group: AchievementGroup,
  hidden: boolean,
  value: (s: StatsRecord) => number,
  target: number,
): AchievementDef => ({ id, name, desc, group, hidden, value, target });

const CATALOGUE: readonly AchievementDef[] = [
  def('ach_cradle', 'Cradle', 'Spawn 100 beings.', 'Beings', false, (s) => c(s, 'beingsSpawned'), 100),
  def('ach_busy_hands', 'Busy Hands', 'Spawn 10,000 beings.', 'Beings', false, (s) => c(s, 'beingsSpawned'), 10000),
  def('ach_firm_ground', 'Firm Ground', 'Raise 1,000 tiles of land.', 'Creation', false, (s) => c(s, 'tilesPaintedLand'), 1000),
  def('ach_island_maker', 'Island Maker', 'Form an island of 500 land tiles ringed by water.', 'Creation', false, (s) => c(s, 'islandMaxSize'), 500),
  def('ach_stonemason', 'Stonemason', 'Place 10,000 walls.', 'Creation', false, (s) => c(s, 'wallsPlaced'), 10000),
  def('ach_full_set', 'Full Set', 'Use all 12 stamps.', 'Creation', false, (s) => set(s, 'stamps'), 12),
  def('ach_green_thumb', 'Green Thumb', 'Land all 23 biome seeds.', 'Nature', false, (s) => set(s, 'seedsUsed'), 23),
  def('ach_circle_of_stones', 'Circle of Stones', 'Have 10 standing stones standing at once.', 'Creation', false, (s) => c(s, 'standingStonesMax'), 10),
  def('ach_peak_maker', 'Peak Maker', 'Join 30 summit tiles into one region.', 'Nature', false, (s) => c(s, 'summitRegionMax'), 30),
  def('ach_five_horizons', 'Five Horizons', 'Create 5 Realms.', 'Realms', false, (s) => c(s, 'realmsCreated'), 5),
  def('ach_cartographer', 'Cartographer', 'Create 40 Realms.', 'Realms', false, (s) => c(s, 'realmsCreated'), 40),
  def('ach_atlas', 'Atlas', 'Create 100 Realms.', 'Realms', false, (s) => c(s, 'realmsCreated'), 100),
  def('ach_made_to_measure', 'Made to Measure', 'Create a non-default Realm after your first.', 'Realms', true, (s) => (c(s, 'realmsCreated') >= 2 ? c(s, 'realmsCustomized') : 0), 1),
  def('ach_long_watch', 'Long Watch', 'Spend 24 hours in Realms.', 'Realms', true, (s) => c(s, 'playtimeMs'), 86_400_000),
  def('ach_hearth', 'Hearth and Home', 'Found a hamlet.', 'Civilisation', false, (s) => c(s, 'hamletsFounded'), 1),
  def('ach_great_town', 'Great Town', 'Grow a hamlet to 150 folk.', 'Civilisation', false, (s) => c(s, 'hamletPopulationMax'), 150),
  def('ach_four_banners', 'Four Banners', 'Hamlets of four Folk lineages live at once.', 'Civilisation', true, (s) => c(s, 'hamletLineagesMax'), 4),
  def('ach_full_house', 'Full House', 'One hamlet with residents of 20 species.', 'Civilisation', true, (s) => c(s, 'hamletSpeciesMax'), 20),
  def('ach_many_fronts', 'Many Fronts', 'Eight dominions in campaigns at once.', 'Civilisation', true, (s) => c(s, 'campaignsOngoingMax'), 8),
  def('ach_peacemaker', 'Peacemaker', 'End 20 campaigns by treaty.', 'Civilisation', false, (s) => c(s, 'campaignsEndedByTreaty'), 20),
  def('ach_grand_pact', 'Grand Pact', 'Join a pact of 6 dominions.', 'Civilisation', false, (s) => c(s, 'pactMembersMax'), 6),
  def('ach_throngs_of_faith', 'Throngs of Faith', 'A creed with 2,000 followers.', 'Civilisation', false, (s) => c(s, 'creedFollowersMax'), 2000),
  def('ach_many_tongues', 'Many Tongues', 'A dialect with 1,500 speakers.', 'Civilisation', false, (s) => c(s, 'dialectSpeakersMax'), 1500),
  def('ach_long_reign', 'Long Reign', 'A ruler in office for 60 years.', 'Civilisation', false, (s) => c(s, 'rulerYearsMax'), 60),
  def('ach_dynasty', 'Dynasty', 'Five successive rulers of one dominion from one family.', 'Civilisation', false, (s) => c(s, 'dynastyRulersMax'), 5),
  def('ach_uprising', 'Uprising', 'A hamlet leaves its dominion through rebellion.', 'Civilisation', false, (s) => c(s, 'hamletsRebelled'), 1),
  def('ach_hundred_year_grudge', "Hundred Years' Grudge", 'One campaign lasts 100 years.', 'Civilisation', false, (s) => c(s, 'campaignYearsMax'), 100),
  def('ach_living_legend', 'Living Legend', 'A being with 30 kills and 12 traits.', 'Beings', false, (s) => c(s, 'legendScoreMax'), 42),
  def('ach_elder', 'Elder', 'A being reaches 90 years.', 'Beings', false, (s) => c(s, 'oldestYears'), 90),
  def('ach_big_family', 'Big Family', 'A family with 12 members.', 'Beings', false, (s) => c(s, 'familyMembersMax'), 12),
  def('ach_swarm_tide', 'Swarm Tide', 'One strain reaches 1,000 beings.', 'Beings', false, (s) => c(s, 'strainPopulationMax'), 1000),
  def('ach_busy_hive', 'Busy Hive', 'An insect colony of 60 members.', 'Beings', true, (s) => c(s, 'colonyMembersMax'), 60),
  def('ach_wyrm_felled', 'Wyrm Felled', 'A wyrm falls to a being, not to a power.', 'Destruction', false, (s) => c(s, 'wyrmsFelledByBeings'), 1),
  def('ach_scarred', 'Scarred but Standing', 'One being survives five drops below 10% health.', 'Destruction', false, (s) => c(s, 'lowHealthDropsMax'), 5),
  def('ach_bombardier', 'Bombardier', 'Launch 750 explosive drops.', 'Destruction', false, (s) => c(s, 'bombsLaunched'), 750),
  def('ach_ashen_realm', 'Ashen Realm', 'Seventy percent of land is scorched or wasted.', 'Destruction', true, (s) => c(s, 'ashenPercentMax'), 70),
  def('ach_plague_year', 'Plague Year', '800 beings infected at once.', 'Destruction', true, (s) => c(s, 'infectedMax'), 800),
  def('ach_lava_lake', 'Lava Lake', '2,000 lava tiles at once.', 'Creation', true, (s) => c(s, 'lavaTilesMax'), 2000),
  def('ach_chain_reaction', 'Chain Reaction', 'One explosion sets off 20 more.', 'Destruction', false, (s) => c(s, 'explosionChainMax'), 20),
  def('ach_clean_slate', 'Clean Slate', 'One power use kills 500 beings.', 'Destruction', false, (s) => c(s, 'powerKillsMax'), 500),
  def('ach_sky_is_falling', 'The Sky Is Falling', 'Ten skystones within one minute.', 'Destruction', false, (s) => c(s, 'skyfallBurstMax'), SKYFALL_BURST),
  def('ach_salvage_rights', 'Salvage Rights', 'Displace 10 boats.', 'Nature', false, (s) => c(s, 'boatsDisplaced'), 10),
  def('ach_storm_season', 'Storm Season', 'Fifteen whirlwinds alive at once.', 'Nature', true, (s) => c(s, 'whirlwindsAliveMax'), 15),
  def('ach_deep_freeze', 'Deep Freeze', 'Sixty percent of land frozen for 100 years.', 'Creation', false, (s) => c(s, 'deepFreezeYearsMax'), 100),
  def('ach_rainmaker', 'Rainmaker', 'Rain falls on 5,000 tiles.', 'Nature', false, (s) => c(s, 'rainTiles'), 5000),
  def('ach_in_bloom', 'In Bloom', 'Grow 50,000 plants.', 'Nature', false, (s) => c(s, 'floraGrown'), 50000),
  def('ach_fault_line', 'Fault Line', 'Trigger 25 tremors.', 'Nature', false, (s) => c(s, 'tremorsTriggered'), 25),
  def('ach_firestorm', 'Firestorm', '1,000 tiles burning at once.', 'Destruction', true, (s) => c(s, 'burningTilesMax'), 1000),
  def('ach_mirror_match', 'Mirror Match', 'Two cloned beings fight each other.', 'Experiments', true, (s) => c(s, 'cloneDuels'), 1),
  def('ach_trait_alchemist', 'Trait Alchemist', 'One being holds 25 traits.', 'Experiments', false, (s) => c(s, 'traitsMax'), 25),
  def('ach_short_candle', 'Short Candle', 'A strain whose mean lifespan is 3 years or less.', 'Experiments', false, (s) => ((c(s, 'strainLifeShortestYears') > 0 && c(s, 'strainLifeShortestYears') <= 3) ? 1 : 0), 1),
  def('ach_methuselah', 'Methuselah', 'A strain whose mean lifespan reaches 1,500 years.', 'Experiments', false, (s) => c(s, 'strainLifeLongestYears'), 1500),
  def('ach_hot_pilgrimage', 'Hot Pilgrimage', 'Offer a grazer to molten ground.', 'Experiments', true, (s) => c(s, 'milestone.offering'), 1),
  def('ach_holiday_crash', 'Holiday Crash', 'The sleigh is destroyed by an explosion.', 'Curiosities', true, (s) => c(s, 'milestone.sleigh_down'), 1),
  def('ach_love_letter', 'Love Letter', 'Use the amorous stamp.', 'Curiosities', true, (s) => c(s, 'milestone.stamp_amorous'), 1),
  def('ach_curious', 'Curious', 'Make 50 discoveries.', 'Codex', false, (s) => set(s, 'discoveries'), 50),
  def('ach_scholar', 'Scholar', 'Make 150 discoveries.', 'Codex', false, (s) => set(s, 'discoveries'), 150),
  def('ach_naturalist', 'Naturalist', 'Discover every spawnable roster entry.', 'Codex', true, (s) => set(s, 'discoveries', 'species:'), ROSTER_SPAWNABLE),
  def('ach_trait_collector', 'Trait Collector', 'Discover 80% of traits.', 'Codex', false, (s) => set(s, 'discoveries', 'trait:'), Math.ceil(TRAIT_TOTAL * 0.8)),
  def('ach_fine_print', 'Read the Fine Print', 'Open the Help and Realm Rules windows.', 'Curiosities', false, (s) => ['help', 'realm_rules'].filter((w) => (s.sets['windowsOpened'] ?? []).includes(w)).length, 2),
  def('ach_loose_letters', 'Loose Letters', 'Tap the title logo ten times within five seconds.', 'Curiosities', true, (s) => c(s, 'looseLetters'), 1),
  def('ach_night_owl', 'Night Owl', 'Stay in a session across local midnight.', 'Curiosities', true, (s) => c(s, 'nightOwl'), 1),
  def('ach_quick_study', 'Quick Study', 'Finish, not skip, the tutorial.', 'Curiosities', false, (s) => c(s, 'tutorialsFinished'), 1),
];

/** Catalogue with the plain names and descriptions of PLAIN_ACHIEVEMENTS applied. */
export const ACHIEVEMENTS: readonly AchievementDef[] = CATALOGUE.map((a) => {
  const plain = PLAIN_ACHIEVEMENTS[a.id];
  return plain ? { ...a, name: plain.name, desc: plain.desc } : a;
});

export const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
